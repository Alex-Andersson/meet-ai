import { db } from "@/db";
import JSONL from "jsonl-parse-stringify";
import { createTRPCRouter, premiumProcedure, protectedProcedure } from "@/trpc/init";
import { meetings, agents, user } from "@/db/schema";
import { z } from "zod";
import { and, count, desc, eq, getTableColumns, ilike, inArray, sql } from "drizzle-orm";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/constants";
import { TRPCError } from "@trpc/server";
import { meetingsInsertSchema, meetingsUpdateSchema } from "../schemas";
import { MeetingStatus, StreamTranscriptItem } from "../types";
import { streamVideo } from "@/lib/stream-video";
import { generatedAvatarUri } from "@/lib/avatar";
import { streamChat } from "@/lib/stream-chat";

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
      console.log('=== TRIGGER AI PROCEDURE CALLED ===');
      console.log('Meeting ID:', input.meetingId);
      console.log('User ID:', ctx.auth.user.id);
      
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
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Agent not found',
          });
        }

        // Update meeting status
        await db
          .update(meetings)
          .set({
            status: "active",
            startedAt: new Date(),
          })
          .where(eq(meetings.id, existingMeeting.id));

        const call = streamVideo.video.call("default", input.meetingId);
        
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
        
        const realtimeClient = await streamVideo.video.connectOpenAi({
          call,
          openAiApiKey: process.env.OPENAI_API_KEY!,
          agentUserId: existingAgent.id,
        });

        // Add event listeners for debugging
        realtimeClient.on('session.created', () => {
          console.log('Manual trigger: OpenAI session created');
        });
        
        realtimeClient.on('session.updated', () => {
          console.log('Manual trigger: OpenAI session updated');
        });
        
        realtimeClient.on('conversation.item.created', (event: unknown) => {
          console.log('Manual trigger: OpenAI conversation item created:', event);
        });
        
        realtimeClient.on('response.audio_transcript.delta', (event: unknown) => {
          console.log('Manual trigger: OpenAI audio transcript:', event);
        });
        
        realtimeClient.on('error', (event: unknown) => {
          console.error('Manual trigger: OpenAI error:', event);
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
            threshold: 0.3,
            prefix_padding_ms: 300,
            silence_duration_ms: 1000
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

        return { success: true, message: 'AI agent connected successfully', agentName: existingAgent.name };
      } catch (error) {
        console.error('=== ERROR IN TRIGGER AI ===');
        console.error('Error details:', error);
        console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
        console.error('Error message:', error instanceof Error ? error.message : String(error));
        
        // Check for specific mask function error
        if (error instanceof Error && error.message.includes('mask is not a function')) {
          console.error('MASK ERROR DETECTED in manual trigger: This appears to be a known issue with OpenAI Realtime API');
          
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'OpenAI connection failed due to SDK issue (mask function). This is a known temporary issue. Please try again in a few moments.',
          });
        }
        
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to connect AI agent',
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
