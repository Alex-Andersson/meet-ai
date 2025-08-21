import { z } from 'zod';
import { agentsRouter } from '@/modules/agents/server/procedures';

import { baseProcedure, createTRPCRouter } from '../init';
export const appRouter = createTRPCRouter({
  agents: agentsRouter,
  // Add other routers here
  healthCheck: baseProcedure.query(() => {
    return { status: 'ok' };
  }),
});
// export type definition of API
export type AppRouter = typeof appRouter;