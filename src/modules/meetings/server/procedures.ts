import { db } from "@/db";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { meetings, agents } from "@/db/schema";
import { z } from "zod";
import { and, count, desc, eq, getTableColumns, ilike, is, sql } from "drizzle-orm";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/constants";
import { TRPCError } from "@trpc/server";
import { meetingsInsertSchema, meetingsUpdateSchema } from "../schemas";
import { MeetingStatus } from "../types";
import { streamVideo } from "@/lib/stream-video";
import { generatedAvatarUri } from "@/lib/avatar";

export const meetingsRouter = createTRPCRouter({
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
        } catch (error) {
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
    create: protectedProcedure
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
