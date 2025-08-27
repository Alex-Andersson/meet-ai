import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { polar, checkout, portal } from "@polar-sh/better-auth"; 
import { polarClient } from "./polar";

import { db } from "@/db";
import * as schema from "@/db/schema";
 
export const auth = betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    trustedOrigins: [
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "http://localhost:3000", // for development
        "https://meet-ai-alex-anderssons-projects.vercel.app", // production
    ],
    plugins:[
        polar({
            client: polarClient,
            createCustomerOnSignUp: false, // Disable automatic customer creation
            use: [
                checkout({
                    authenticatedUsersOnly: true,
                    successUrl: "/upgrade"
                }),
                portal(),
            ]
        })
    ],
    socialProviders: {
        ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && {
            github: { 
                clientId: process.env.GITHUB_CLIENT_ID, 
                clientSecret: process.env.GITHUB_CLIENT_SECRET, 
            }
        }),
        ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && {
            google: { 
                clientId: process.env.GOOGLE_CLIENT_ID, 
                clientSecret: process.env.GOOGLE_CLIENT_SECRET, 
            }
        }),
    },
    emailAndPassword: {
    enabled: true, 
  },
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            ...schema,
        }
    }),
});