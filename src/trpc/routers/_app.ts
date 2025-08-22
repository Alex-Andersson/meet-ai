import { z } from 'zod';
import { agentsRouter } from '@/modules/agents/server/procedures';

import { baseProcedure, createTRPCRouter } from '../init';
import { meetingsRouter } from '@/modules/meetings/server/procedures';
export const appRouter = createTRPCRouter({
  agents: agentsRouter,
  meetings: meetingsRouter,
  // Add other routers here
  healthCheck: baseProcedure.query(() => {
    return { status: 'ok' };
  }),
});
// export type definition of API
export type AppRouter = typeof appRouter;