import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { eq, count } from "drizzle-orm";
import { polarClient } from "@/lib/polar";
import {
  createTRPCRouter,
  protectedProcedure,
} from "@/trpc/init";

export const premiumRouter = createTRPCRouter({
    getCurrentSubscription: protectedProcedure.query(async({ ctx }) => {
        try {
            const customer = await polarClient.customers.getStateExternal({
                externalId: ctx.auth.user.id
            });

            const subscription = customer.activeSubscriptions[0];

            if (!subscription) {
                return null;
            }

            const product = await polarClient.products.get({
                id: subscription.productId
            });

            return product;
        } catch (error) {
            console.log('Customer not found in Polar, returning null subscription');
            return null;
        }
    }),

    getProducts: protectedProcedure.query(async() => {
        const products = await polarClient.products.list({
            isArchived: false,
            isRecurring: true,
            sorting: ["price_amount"]
        });

        return products.result.items;
    }),

    getFreeUsage: protectedProcedure.query(async({ ctx }) => {
        try {
            const customer = await polarClient.customers.getStateExternal({
                externalId: ctx.auth.user.id
            });

            const subscription = customer.activeSubscriptions[0];

            if (subscription) {
                return null;
            }
        } catch (error) {
            console.log('Customer not found in Polar, showing free usage');
        }

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
        };
    })
});