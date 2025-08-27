import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { eq, and, not } from "drizzle-orm";
import { streamChat } from "@/lib/stream-chat";
import { generatedAvatarUri } from "@/lib/avatar";
import OpenAI from "openai";

const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, 
});

export async function POST(req: NextRequest) {
    try {
        const { meetingId, message } = await req.json();

        if (!meetingId || !message) {
            return NextResponse.json({ error: "Missing meetingId or message" }, { status: 400 });
        }

        // Get the meeting and agent - try exact match first, then fallback to active meetings
        let activeMeeting = await db
            .select()
            .from(meetings)
            .where(eq(meetings.id, meetingId))
            .then(results => results[0]);

        // If not found by exact match, try to find by any active/upcoming meeting
        if (!activeMeeting) {
            console.log('No exact meeting match for ID:', meetingId);
            console.log('Looking for active/upcoming meetings...');
            
            const activeMeetings = await db
                .select()
                .from(meetings)
                .where(
                    and(
                        not(eq(meetings.status, "completed")),
                        not(eq(meetings.status, "cancelled"))
                    )
                )
                .limit(5);

            console.log('Found active meetings:', activeMeetings.map(m => ({ 
                id: m.id, 
                name: m.name, 
                status: m.status 
            })));

            // If we have exactly one active meeting, use it
            if (activeMeetings.length === 1) {
                activeMeeting = activeMeetings[0];
                console.log('Using single active meeting:', activeMeeting.id);
            } else if (activeMeetings.length > 1) {
                // Use the most recent active meeting
                activeMeeting = activeMeetings[0];
                console.log('Using most recent active meeting:', activeMeeting.id);
            }
        }

        if (!activeMeeting) {
            return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
        }

        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, activeMeeting.agentId));

        if (!existingAgent) {
            return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        }

        // Generate AI response
        const gptResponse = await openaiClient.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: existingAgent.instructions },
                { role: "user", content: message },
            ]
        });

        const aiMessage = gptResponse.choices[0].message.content;

        if (!aiMessage) {
            return NextResponse.json({ error: "Failed to generate AI response" }, { status: 500 });
        }

        // Send message to chat
        const channel = streamChat.channel("messaging", meetingId);
        await channel.watch();

        const avatarUrl = generatedAvatarUri({
            seed: existingAgent.name,
            variant: "botttsNeutral",
        });

        await streamChat.upsertUsers([{
            id: existingAgent.id,
            name: existingAgent.name,
            image: avatarUrl,
        }]);

        await channel.sendMessage({
            text: aiMessage,
            user: {
                id: existingAgent.id,
                name: existingAgent.name,
                image: avatarUrl,
            }
        });

        return NextResponse.json({ 
            success: true, 
            message: "AI response sent",
            aiResponse: aiMessage 
        });

    } catch (error) {
        console.error('Test chat error:', error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
