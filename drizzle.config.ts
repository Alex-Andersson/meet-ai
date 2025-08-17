import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',    // or your database dialect
  schema: './src/db/schema.ts', // path to your schema files
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    // or host/port/user/password/database instead of url
  },
});
