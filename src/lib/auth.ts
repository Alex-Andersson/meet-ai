import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
// import { polar, checkout, portal } from "@polar-sh/better-auth"; 
// import { polarClient } from "./polar";


import { db } from "@/db";
import * as schema from "@/db/schema";
 
export const auth = betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: [
        process.env.NEXT_PUBLIC_APP_URL as string,
        "http://localhost:3000", // for development
    ],
    // Temporarily disable polar for production
    // plugins:[
    //     polar({
    //         client: polarClient,
    //         createCustomerOnSignUp: true,
    //         use: [
    //             checkout({
    //                 authenticatedUsersOnly: true,
    //                 successUrl: "/upgrade"
    //             }),
    //             portal(),
    //         ]
    //     })
    // ],
    socialProviders: {
        github: { 
            clientId: process.env.GITHUB_CLIENT_ID as string, 
            clientSecret: process.env.GITHUB_CLIENT_SECRET as string, 
        }, 
            google: { 
            clientId: process.env.GOOGLE_CLIENT_ID as string, 
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string, 
        }, 
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