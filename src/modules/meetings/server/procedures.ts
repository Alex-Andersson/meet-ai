import { db } from "@/db";
import JSONL from "jsonl-parse-stringify";
import { createTRPCRouter, premiumProcedure, protectedProcedure } from "@/trpc/init";
import { meetings, agents, user, aiConnectionLocks } from "@/db/schema";
import { z } from "zod";
import { and, count, desc, eq, getTableColumns, ilike, inArray, sql } from "drizzle-orm";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/constants";
import { TRPCError } from "@trpc/server";
import { meetingsInsertSchema, meetingsUpdateSchema } from "../schemas";
import { MeetingStatus, StreamTranscriptItem } from "../types";
import { streamVideo } from "@/lib/stream-video";
import { generatedAvatarUri } from "@/lib/avatar";
import { streamChat } from "@/lib/stream-chat";
import { 
  getConnectionState, 
  markConnectionInProgress, 
  markConnectionCompleted, 
  cleanupConnection,
  cleanupOldConnections
} from "@/lib/ai-connection-tracker";
import { AISingletonGuard } from "@/lib/ai-singleton-guard";

export const meetingsRouter = createTRPCRouter({
  generateChatToken: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      // Ensure user exists in Stream Chat
      await streamChat.upsertUsers([
        {
          id: ctx.auth.user.id,
          name: ctx.auth.user.name,
          role: 'admin',
          image: ctx.auth.user.image || generatedAvatarUri({
            seed: ctx.auth.user.name, 
            variant: "initials"
          }),
        }
      ]);
      
      // Generate token for the user
      const token = streamChat.createToken(ctx.auth.user.id);
      
      return token; // Return token directly, not wrapped in object
    } catch (error) {
      console.error('Error generating chat token:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to generate chat token',
      });
    }
  }),

  getTranscript: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [existingMeeting] = await db
        .select()
        .from(meetings)
        .where(
          and(
            eq(meetings.id, input.id),
            eq(meetings.userId, ctx.auth.user.id)
          )
        );
      if (!existingMeeting) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
      }

      if (!existingMeeting.transcriptUrl) {
        return [];
      }

      const transcript = await fetch(existingMeeting.transcriptUrl)
        .then((res) => res.text())
        .then((text) => JSONL.parse<StreamTranscriptItem>(text))
        .catch(() => {
          return [];
        });

      const speakerIds = [
        ...new Set(transcript.map((item) => item.speaker_id)),
      ];

      const userSpeakers = await db
        .select()
        .from(user)
        .where(inArray(user.id, speakerIds))
        .then((users) =>
          users.map((user) => ({
            ...user,
            image:
              user.image ?? generatedAvatarUri({ seed: user.name, variant: "initials" }),
          }))
      );

      const agentSpeakers = await db
        .select()
        .from(agents)
        .where(inArray(agents.id, speakerIds))
        .then((agents) =>
          agents.map((agent) => ({
            ...agent,
            image: generatedAvatarUri({
              seed: agent.name,
              variant: "botttsNeutral"
            }),
          }))
      );

        const speakers = [...userSpeakers, ...agentSpeakers];

        const transcriptWithSpeakers = transcript.map((item) => {
          const speaker = speakers.find(
            (speaker) => speaker.id === item.speaker_id
          );

          if (!speaker) {
            return {
              ...item,
              user: {
                name: "Unknown",
                image: generatedAvatarUri({
                  seed: "Unknown",
                  variant: "initials"
                }),
              },
            }; 
          }

          return {
            ...item,
            user: {
              name: speaker.name,
              image: speaker.image,
            },
          };
        });

        return transcriptWithSpeakers;
    }),
      
  generatedToken: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      // Check if Stream Video API keys are configured
      if (!process.env.STREAM_VIDEO_API_KEY || !process.env.STREAM_VIDEO_SECRET_KEY) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Stream Video API keys are not configured. Please check your environment variables.',
        });
      }

      // Log API key format for debugging (first 8 chars only for security)
      console.log('Stream API Key format check:', {
        apiKeyPrefix: process.env.STREAM_VIDEO_API_KEY.substring(0, 8),
        apiKeyLength: process.env.STREAM_VIDEO_API_KEY.length,
        secretKeyLength: process.env.STREAM_VIDEO_SECRET_KEY.length,
      });

      await streamVideo.upsertUsers([
        {
          id: ctx.auth.user.id,
          name: ctx.auth.user.name,
          role: 'admin',
          image: 
            ctx.auth.user.image ?? 
            generatedAvatarUri({seed: ctx.auth.user.name, variant: "initials"}),
        },
      ]);

      const expirationTime = Math.floor(Date.now() / 1000) + (60 * 60); // 1 hour from now
      const issuedAt = Math.floor(Date.now() / 1000) - 60; // 1 minute ago

      const token = streamVideo.generateUserToken({
        user_id: ctx.auth.user.id,
        exp: expirationTime,
        validity_in_seconds: issuedAt,
      });

      return token;
    } catch (error) {
      console.error('Error generating Stream token:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to generate Stream token',
      });
    }
  }),

  getOrCreateCall: protectedProcedure
    .input(z.object({ meetingId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        // First, get the meeting details
        const [meeting] = await db
          .select()
          .from(meetings)
          .where(
            and(
              eq(meetings.id, input.meetingId),
              eq(meetings.userId, ctx.auth.user.id)
            )
          );

        if (!meeting) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Meeting not found',
          });
        }

        // Create or get the call from Stream
        const call = streamVideo.video.call("default", meeting.id);
        
        try {
          // Try to get existing call first
          await call.get();
        } catch {
          // If call doesn't exist, create it
          await call.create({
            data: {
              created_by_id: ctx.auth.user.id,
              custom: {
                meetingId: meeting.id,
                meetingName: meeting.name,
              },
              settings_override: {
                transcription: {
                  language: "en",
                  mode: "available",
                },
              },
            },
          });
        }

        return { success: true, callId: meeting.id };
      } catch (error) {
        console.error('Error creating/getting call:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create or get call',
        });
      }
    }),

  triggerAI: protectedProcedure
    .input(z.object({ meetingId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      console.log('=== TRIGGER AI PROCEDURE CALLED ===');
      console.log('Request ID:', requestId);
      console.log('Meeting ID:', input.meetingId);
      console.log('User ID:', ctx.auth.user.id);
      console.log('Timestamp:', new Date().toISOString());
      console.log('Call stack preview:', new Error().stack?.split('\n').slice(1, 5).join('\n'));
      
      // STEP 1: Use AI Singleton Guard for absolute protection
      console.log('=== AI SINGLETON GUARD CHECK ===');
      console.log('Request ID:', requestId);
      
      if (AISingletonGuard.isLocked(input.meetingId)) {
        console.log('SINGLETON GUARD: Meeting already locked in memory');
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'AI is already active for this meeting. Only one AI per meeting is allowed.',
        });
      }
      
      // STEP 2: Check database tracking to prevent any duplicates
      const existingConnection = await getConnectionState(input.meetingId);
      console.log('=== DATABASE CONNECTION CHECK ===');
      console.log('Request ID:', requestId);
      console.log('Existing connection found:', existingConnection ? 'YES' : 'NO');
      
      if (existingConnection) {
        console.log('DUPLICATE PREVENTED: AI connection already exists for meeting:', input.meetingId);
        console.log('Request ID:', requestId);
        console.log('Existing connection details:', {
          meetingId: existingConnection.meetingId,
          agentId: existingConnection.agentId,
          isInProgress: existingConnection.isInProgress,
          createdAt: existingConnection.createdAt,
          ageInMinutes: (Date.now() - existingConnection.createdAt.getTime()) / (1000 * 60)
        });
        
        // ALWAYS reject if any connection exists (in progress or completed)
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'AI is already connected to this meeting. Only one AI per meeting is allowed.',
        });
      }
      
      console.log('=== NO EXISTING CONNECTION - PROCEEDING ===');
      console.log('Request ID:', requestId);
      
      try {
        console.log('Looking for meeting in database...');
        const [existingMeeting] = await db
          .select()
          .from(meetings)
          .where(
            and(
              eq(meetings.id, input.meetingId),
              eq(meetings.userId, ctx.auth.user.id)
            )
          );

        console.log('Meeting found:', existingMeeting ? 'YES' : 'NO');
        if (existingMeeting) {
          console.log('Meeting details:', {
            id: existingMeeting.id,
            name: existingMeeting.name,
            status: existingMeeting.status,
            agentId: existingMeeting.agentId
          });
        }

        if (!existingMeeting) {
          // Clean up lock on error
          await cleanupConnection(input.meetingId);
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Meeting not found',
          });
        }

        const [existingAgent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, existingMeeting.agentId));

        if (!existingAgent) {
          // Clean up lock on error
          await cleanupConnection(input.meetingId);
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Agent not found',
          });
        }

        // STEP 3: Try to acquire the singleton guard lock
        const guardLockAcquired = await AISingletonGuard.checkAndLock(input.meetingId, existingAgent.id);
        
        if (!guardLockAcquired) {
          console.log('SINGLETON GUARD: Failed to acquire lock');
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Another AI connection is already in progress for this meeting.',
          });
        }
        
        console.log('=== SINGLETON GUARD LOCK ACQUIRED ===');
        console.log('Request ID:', requestId);
        console.log('Guard lock acquired for meeting:', input.meetingId, 'agent:', existingAgent.id);

        const call = streamVideo.video.call("default", input.meetingId);
        
        // Double-check Stream call state to ensure no AI is already connected
        try {
            const callState = await call.get();
            console.log('Call state retrieved, checking for existing AI participants');
            
            // Check if the agent is already in the call participants
            const participants = callState.call?.session?.participants || [];
            const agentAlreadyInCall = participants.some(p => p.user?.id === existingAgent.id);
            
            if (agentAlreadyInCall) {
                console.log('Agent already in call participants, canceling connection');
                // Clean up the tracking since agent is already connected
                await cleanupConnection(input.meetingId);
                throw new TRPCError({
                  code: 'CONFLICT',
                  message: 'AI agent is already connected to this call',
                });
            }
            
        } catch (callError) {
            console.log('Could not get call state for duplicate check:', callError);
            // If we can't check call state, continue but be extra careful
        }
        
        // Update meeting status
        await db
          .update(meetings)
          .set({
            status: "active",
            startedAt: new Date(),
          })
          .where(eq(meetings.id, existingMeeting.id));
        
        // Ensure the agent user exists in Stream
        await streamVideo.upsertUsers([
          {
            id: existingAgent.id,
            name: existingAgent.name,
            role: 'user',
          }
        ]);
        
        console.log('Connecting OpenAI agent manually:', existingAgent.id);
        console.log('Agent instructions:', existingAgent.instructions);
        
        // Implement retry logic for the mask function issue
        let realtimeClient: Awaited<ReturnType<typeof streamVideo.video.connectOpenAi>> | null = null;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            // Add progressive delay for each retry
            if (retryCount > 0) {
              console.log(`Retry attempt ${retryCount}/${maxRetries} for OpenAI connection...`);
              await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
            }
            
            realtimeClient = await streamVideo.video.connectOpenAi({
              call,
              openAiApiKey: process.env.OPENAI_API_KEY!,
              agentUserId: existingAgent.id,
            });
            
            console.log('OpenAI connection successful');
            break;
            
          } catch (error) {
            retryCount++;
            console.error(`OpenAI connection attempt ${retryCount} failed:`, error);
            
            if (error instanceof Error && error.message.includes('mask is not a function')) {
              console.log('Mask function error detected, implementing workaround...');
              
              if (retryCount >= maxRetries) {
                // Clean up tracking on failure
                await cleanupConnection(input.meetingId);
                
                throw new TRPCError({
                  code: 'INTERNAL_SERVER_ERROR',
                  message: 'OpenAI connection failed after multiple attempts due to SDK initialization issue. Please try again in a few moments.',
                });
              }
              
              // Continue to next retry
              continue;
            } else {
              // For other errors, clean up and fail immediately
              await cleanupConnection(input.meetingId);
              throw error;
            }
          }
        }
        
        if (!realtimeClient) {
          // Clean up tracking on failure
          await cleanupConnection(input.meetingId);
          
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to establish OpenAI connection after all retry attempts.',
          });
        }

        // CONNECTION SUCCESSFUL - Mark as completed (not in progress)
        await markConnectionCompleted(input.meetingId);

        // Add event listeners for debugging
        realtimeClient.on('session.created', () => {
          console.log('Manual trigger: OpenAI session created');
          console.log('Request ID:', requestId);
        });
        
        realtimeClient.on('session.updated', () => {
          console.log('Manual trigger: OpenAI session updated');
          console.log('Request ID:', requestId);
        });
        
        realtimeClient.on('conversation.item.created', (event: unknown) => {
          console.log('Manual trigger: OpenAI conversation item created:', event);
          console.log('Request ID:', requestId);
        });
        
        realtimeClient.on('response.audio_transcript.delta', (event: unknown) => {
          console.log('Manual trigger: OpenAI audio transcript:', event);
          console.log('Request ID:', requestId);
        });

        realtimeClient.on('input_audio_buffer.speech_started', (event: unknown) => {
          console.log('VOICE ACTIVITY DETECTED: Speech started');
          console.log('Request ID:', requestId);
          console.log('Event:', event);
        });

        realtimeClient.on('input_audio_buffer.speech_stopped', (event: unknown) => {
          console.log('VOICE ACTIVITY DETECTED: Speech stopped');
          console.log('Request ID:', requestId);
          console.log('Event:', event);
        });

        realtimeClient.on('response.created', (event: unknown) => {
          console.log('OpenAI response created (might indicate new conversation):');
          console.log('Request ID:', requestId);
          console.log('Event:', event);
        });
        
        realtimeClient.on('error', (event: unknown) => {
          console.error('Manual trigger: OpenAI error:', event);
          console.log('Request ID:', requestId);
        });

        realtimeClient.updateSession({
          instructions: `${existingAgent.instructions}

Important: You are participating in a live voice conversation. Actively listen and respond when appropriate. Always be conversational and helpful. When you hear someone speaking, feel free to respond naturally.

When you first join the call, introduce yourself briefly with something like "Hello! I'm ${existingAgent.name}, your AI assistant. I'm here and ready to help with the meeting."`,
          voice: 'alloy',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5, // Increased from 0.3 to make it less sensitive
            prefix_padding_ms: 300,
            silence_duration_ms: 2000 // Increased from 1000ms to reduce false triggers
          },
          tool_choice: 'auto'
        });
        
        // Send an initial greeting message
        setTimeout(() => {
          realtimeClient.sendUserMessageContent([{
            type: 'input_text',
            text: `Hello! I'm ${existingAgent.name}, your AI assistant. I just joined the call and I'm ready to help.`
          }]);
        }, 2000);

        console.log('Manual AI trigger completed successfully');
        console.log('Request ID:', requestId);

        return { success: true, message: 'AI agent connected successfully', agentName: existingAgent.name };
      } catch (error) {
        console.error('=== ERROR IN TRIGGER AI ===');
        console.error('Request ID:', requestId);
        console.error('Error details:', error);
        console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
        console.error('Error message:', error instanceof Error ? error.message : String(error));
        
        // ALWAYS clean up tracking on any error
        await cleanupConnection(input.meetingId);
        await AISingletonGuard.release(input.meetingId);
        console.log('Cleaned up tracking and singleton guard due to error for meeting:', input.meetingId);
        
        // Check for specific mask function error
        if (error instanceof Error && error.message.includes('mask is not a function')) {
          console.error('MASK ERROR DETECTED in manual trigger: This appears to be a known issue with OpenAI Realtime API');
          
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'OpenAI connection failed due to SDK issue (mask function). This is a known temporary issue. Please try again in a few moments.',
          });
        }
        
        // Re-throw existing TRPCError or create new one
        if (error instanceof TRPCError) {
          throw error;
        }
        
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to connect AI agent',
        });
      }
    }),

  // Debug procedure to clean up old AI connection locks
  cleanupAILocks: protectedProcedure
    .mutation(async () => {
      try {
        await cleanupOldConnections();
        return { success: true, message: 'Old AI connection locks cleaned up' };
      } catch (error) {
        console.error('Error cleaning up AI locks:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to clean up AI locks',
        });
      }
    }),

  // Debug procedure to view current AI connection locks
  debugAILocks: protectedProcedure
    .query(async () => {
      try {
        const locks = await db.select().from(aiConnectionLocks).limit(50);
        return {
          success: true,
          locks: locks.map(lock => ({
            ...lock,
            ageInMinutes: (Date.now() - lock.createdAt.getTime()) / (1000 * 60)
          }))
        };
      } catch (error) {
        console.error('Error fetching AI locks:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch AI locks',
        });
      }
    }),

  update: protectedProcedure
    .input(meetingsUpdateSchema)
    .mutation(async ({ input, ctx }) => {
      const [updatedMeeting] = await db
        .update(meetings)
          .set(input)
          .where(
            and(
              eq(meetings.id, input.id),
              eq(meetings.userId, ctx.auth.user.id)
            ),
          )
          .returning();

        if (!updatedMeeting) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
        }

        return updatedMeeting;
      }),
      remove: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const [removedMeeting] = await db
          .delete(meetings)
          .where(
            and(
              eq(meetings.id, input.id),
              eq(meetings.userId, ctx.auth.user.id)
            ),
          )
          .returning();

        if (!removedMeeting) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
        }

        return removedMeeting;
      }),
    create: premiumProcedure("meetings")
      .input(meetingsInsertSchema)
      .mutation(async ({ input, ctx }) => {
        const [createdMeeting] = await db
          .insert(meetings)
          .values({
            ...input,
            userId: ctx.auth.user.id,
          })
          .returning();

        const call = streamVideo.video.call("default", createdMeeting.id);
        await call.create({
          data: {
            created_by_id: ctx.auth.user.id,
            custom: {
              meetingId: createdMeeting.id,
              meetingName: createdMeeting.name,
            },
            settings_override: {
              transcription:{
                language: "en",
                mode: "auto-on",
                closed_caption_mode: "auto-on",
              },
              recording:{
                mode: "auto-on",
                quality: "1080p",
              },
            },
          },
        });

      const [existingAgent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, createdMeeting.agentId));

      if (!existingAgent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      }

      await streamVideo.upsertUsers([
        {
          id: existingAgent.id,
          name: existingAgent.name,
          role: 'user',
          image: generatedAvatarUri({
            seed: existingAgent.name,
            variant: "botttsNeutral"
          })
        },
      ]);

        return createdMeeting;
      }),
  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [existingMeeting] = await db
        .select({
          ...getTableColumns(meetings),
          agents: agents,
          duration: sql<number>`EXTRACT(EPOCH FROM (ended_at - started_at))`.as("duration"),
        })
        .from(meetings)
        .innerJoin(agents, eq(meetings.agentId, agents.id))
        .where(and(
          eq(meetings.id, input.id),
          eq(meetings.userId, ctx.auth.user.id),
        )
      );

      if (!existingMeeting) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
      }

      return existingMeeting;
    }),

  getMany: protectedProcedure
    .input(
      z
        .object({
          page: z.number().default(DEFAULT_PAGE),
          pageSize: z.number().min(MIN_PAGE_SIZE).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
          search: z.string().nullish(),
          agentId: z.string().nullish(),
          status: z
            .enum([
              MeetingStatus.Upcoming,
              MeetingStatus.Active,
              MeetingStatus.Completed,
              MeetingStatus.Cancelled,
              MeetingStatus.Processing,
            ])
            .nullish(),
        })
    )
    .query(async ({ctx, input }) => {
      const { search, page, pageSize, agentId, status } = input;

      const data = await db
        .select({
          ...getTableColumns(meetings),
          agents: agents,
          duration: sql<number>`EXTRACT(EPOCH FROM (ended_at - started_at))`.as("duration"),
        })
        .from(meetings)
        .innerJoin(agents, eq(meetings.agentId, agents.id))
        .where(
          and(
            eq(meetings.userId, ctx.auth.user.id),
            search ? ilike(meetings.name, `%${search}%`) : undefined,
            status ? eq(meetings.status, status) : undefined,
            agentId ? eq(meetings.agentId, agentId) : undefined,
          )
        )
        .orderBy(desc(meetings.createdAt), desc(meetings.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      const total = await db
        .select({ count: count() })
        .from(meetings)
        .innerJoin(agents, eq(meetings.agentId, agents.id))
        .where(
          and(
            eq(meetings.userId, ctx.auth.user.id),
            search ? ilike(meetings.name, `%${search}%`) : undefined,
            status ? eq(meetings.status, status) : undefined,
            agentId ? eq(meetings.agentId, agentId) : undefined,
          )
        );

      const totalPages = Math.ceil(total[0].count / pageSize);

      return {
        items: data,
        total: total[0].count,
        totalPages
      }
    }),
});
