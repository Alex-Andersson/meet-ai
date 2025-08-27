import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { eq, count } from "drizzle-orm";
// import { polarClient } from "@/lib/polar"; // Disabled for production
import {
  createTRPCRouter,
  protectedProcedure,
} from "@/trpc/init";

// Temporarily disable premium features for production
export const premiumRouter = createTRPCRouter({
    getCurrentSubscription: protectedProcedure.query(async({ ctx }) => {
        // Return null (no subscription) for now
        return null;
    }),

    getProducts: protectedProcedure.query(async() => {
        // Return empty array for now
        return [];
    }),

    getFreeUsage: protectedProcedure.query(async({ ctx }) => {
        // For now, show unlimited usage
        const [userMeetings] = await db
            .select({
                count: count(meetings.id)
            })
            .from(meetings)
            .where(eq(meetings.userId, ctx.auth.user.id));

        const [userAgents] = await db
            .select({
                count: count(agents.id)
            })
            .from(agents)
            .where(eq(agents.userId, ctx.auth.user.id));

        return {
            meetingCount: userMeetings.count,
            agentCount: userAgents.count,
            // Show high limits to simulate unlimited usage
            meetingsLimit: 999,
            agentsLimit: 999
        };
    })
});