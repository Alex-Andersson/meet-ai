import { and, eq, not } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  CallEndedEvent,
  CallTranscriptionReadyEvent,
  CallSessionParticipantLeftEvent,
  CallRecordingReadyEvent,
  CallSessionStartedEvent,
  MessageNewEvent,
} from "@stream-io/node-sdk";
import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { streamVideo } from "@/lib/stream-video";
import { inngest } from "@/inngest/client";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { generatedAvatarUri } from "@/lib/avatar";
import { streamChat } from "@/lib/stream-chat";
import { cleanupConnection } from "@/lib/ai-connection-tracker";

const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, 
});

function verifySignatureWithSDK(body: string, signature: string): boolean {
    return streamVideo.verifyWebhook(body, signature);
}

export async function POST(req: NextRequest) {
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Headers:', Object.fromEntries(req.headers.entries()));
    
    const signature = req.headers.get("x-signature");
    const apiKey = req.headers.get("x-api-key");

    if (!signature || !apiKey) {
        console.log('Missing signature or API key');
        return NextResponse.json({ error: "Missing signature or API key" }, { status: 400 });
    };

    const body = await req.text();

    if (!verifySignatureWithSDK(body, signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }   

    const eventType = (payload as Record<string, string>)?.type;
    console.log('Webhook received event:', eventType);
    console.log('Full payload:', JSON.stringify(payload, null, 2));
    
    if (eventType === "call.session_started") {
        console.log('Processing call.session_started event - DISABLED FOR MANUAL CONTROL');
        const event = payload as CallSessionStartedEvent;
        const meetingId = event.call.custom?.meetingId;

        console.log('Meeting ID from event:', meetingId);
        console.log('Session started but auto-trigger disabled - user must manually trigger AI');

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId in call custom data" }, { status: 400 });
        }

        // Only update the meeting status to "upcoming" when session starts, don't auto-trigger AI
        const [existingMeeting] = await db
            .select()
            .from(meetings)
            .where(
                and(
                    eq(meetings.id, meetingId),
                    not(eq(meetings.status, "completed")),
                    not(eq(meetings.status, "cancelled")),
                    not(eq(meetings.status, "processing"))
                )
            );

        if (!existingMeeting) {
            return NextResponse.json({ error: "Meeting not found or already completed/cancelled/processing" }, { status: 404 });
        }

        // Only mark the session as started, but don't activate the meeting or connect AI
        console.log('Session started for meeting:', meetingId, '- waiting for manual AI trigger');
        
        return NextResponse.json({ message: "Session started - waiting for manual AI trigger" });
    } else if (eventType === "call.session_participant_joined") {
        console.log('Processing call.session_participant_joined event - DISABLED for now to prevent loops');
        console.log('Event details:', JSON.stringify(payload, null, 2));
        
        // TEMPORARY DISABLE: This was causing loops with session_started
        // We'll re-enable this later with better logic
        return NextResponse.json({ message: "Participant joined event logged but auto-trigger disabled" });
    } else if (eventType === "call.session_participant_left") {
        const event = payload as CallSessionParticipantLeftEvent;
        const meetingId = event.call_cid.split(":")[1];

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId in call CID" }, { status: 400 });
        }

        const call = streamVideo.video.call("default", meetingId);
        await call.end();
    } else if (eventType === "call.session_ended") {
        const event = payload as CallEndedEvent;
        const meetingId = event.call.custom?.meetingId;

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId in call custom data" }, { status: 400 });
        }

        // Clean up AI connection tracking when call ends
        cleanupConnection(meetingId);

        await db
            .update(meetings)
            .set({
                status: "processing",
                endedAt: new Date(),
            })
            .where(and(eq(meetings.id, meetingId), (eq(meetings.status, "active"))));
    } else if (eventType === "call.transcription_ready") {
        const event = payload as CallTranscriptionReadyEvent;
        const meetingId = event.call_cid.split(":")[1];

        const updatedMeetings = await db
            .update(meetings)
            .set({
                transcriptUrl: event.call_transcription.url,
            })
            .where(eq(meetings.id, meetingId))
            .returning();

        const updatedMeeting = updatedMeetings[0];

        if (!updatedMeeting) {
            return NextResponse.json({ error: "Failed to update meeting transcript URL"}, {status: 404 });
        }
        await inngest.send({
            name: "meetings/processing",
            data: {
                meetingId: updatedMeeting.id,
                transcriptUrl: updatedMeeting.transcriptUrl,
            }
        });
    } else if (eventType === "call.recording_ready") {
        const event = payload as CallRecordingReadyEvent;
        const meetingId = event.call_cid.split(":")[1];

        await db
            .update(meetings)
            .set({
                recordingUrl: event.call_recording.url,
            })
            .where(eq(meetings.id, meetingId))
            .returning();

    } else if (eventType === "message.new") {
        console.log('Processing message.new event');
        const event = payload as MessageNewEvent;

        const userId = event.user?.id;
        const channelId = event.channel_id;
        const text = event.message?.text;

        console.log('Message details:', { userId, channelId, text });

        if (!userId || !channelId || !text) {
            console.log('Missing required fields in message.new event');
            return NextResponse.json({ error: "Missing userId, channelId, or text in message.new event" }, { status: 400 });
        }

        // First try to find meeting by exact channelId match
        let existingMeeting = await db
            .select()
            .from(meetings)
            .where(eq(meetings.id, channelId))
            .then((results: typeof meetings.$inferSelect[]) => results[0]);

        console.log('Initial meeting lookup result:', existingMeeting ? {
            id: existingMeeting.id,
            name: existingMeeting.name,
            status: existingMeeting.status
        } : 'No match');

        // If we found a completed meeting, or no meeting at all, look for active alternatives
        if (!existingMeeting || existingMeeting.status === "completed") {
            console.log('Looking for active/upcoming meetings as alternative...');
            
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

            console.log('Found active meetings:', activeMeetings.map((m: typeof meetings.$inferSelect) => ({ 
                id: m.id, 
                name: m.name, 
                status: m.status 
            })));

            // If we have exactly one active meeting, use it
            if (activeMeetings.length === 1) {
                existingMeeting = activeMeetings[0];
                console.log('Using single active meeting:', existingMeeting.id);
            } else if (activeMeetings.length > 1) {
                // If multiple meetings, try to find one that matches the channel pattern
                const possibleMeeting = activeMeetings.find((m: typeof meetings.$inferSelect) => 
                    channelId.includes(m.id) || m.id.includes(channelId.slice(-8))
                );
                if (possibleMeeting) {
                    existingMeeting = possibleMeeting;
                    console.log('Using pattern-matched meeting:', existingMeeting.id);
                } else {
                    // Use the most recent active meeting
                    existingMeeting = activeMeetings[0];
                    console.log('Using most recent active meeting:', existingMeeting.id);
                }
            }
        }

        if (!existingMeeting) {
            console.log('No suitable meeting found for channel:', channelId);
            console.log('Available meetings in database:');
            const allMeetings = await db.select().from(meetings).limit(5);
            console.log(allMeetings.map((m: typeof meetings.$inferSelect) => ({ id: m.id, name: m.name, status: m.status })));
            return NextResponse.json({ error: "No active meeting found" }, { status: 404 });
        }

        console.log('Using meeting:', {
            id: existingMeeting.id,
            name: existingMeeting.name,
            status: existingMeeting.status,
            agentId: existingMeeting.agentId
        });

        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, existingMeeting.agentId));

        if (!existingAgent) {
            console.log('Agent not found for meeting:', channelId);
            return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        }

        console.log('Agent found:', existingAgent.name, 'Agent ID:', existingAgent.id);
        console.log('User ID from message:', userId);

        if (userId === existingAgent.id) {
            console.log('Message from agent itself, ignoring to prevent loop.');
            return NextResponse.json({ status: "ok" });
        }

        console.log('Processing message from user, generating AI response...');

        const instructions = existingAgent.instructions;

        try {
            const channel = streamChat.channel("messaging", channelId);
            await channel.watch();

            const previousMessages = channel.state.messages
              .slice(-5)
              .filter((msg) => msg.user?.id === existingAgent.id || msg.user?.id === existingMeeting.userId);

            console.log('Found', previousMessages.length, 'previous messages for context');

            // Map previousMessages to ChatCompletionMessageParam format
            const mappedMessages: ChatCompletionMessageParam[] = previousMessages.map((msg) => ({
                role: msg.user?.id === existingAgent.id ? "assistant" : "user",
                content: msg.text || ""
            }));

            console.log('Calling OpenAI with', mappedMessages.length + 1, 'messages...');

            const gptResponse = await openaiClient.chat.completions.create({
                model: "gpt-4",
                messages: [
                    { role: "system", content: instructions },
                    ...mappedMessages,
                    { role: "user", content: text },
                ]
            });

            const gptResponseText = gptResponse.choices[0].message.content;

            if (!gptResponseText) {
                console.error('OpenAI response text is empty');
                return NextResponse.json({ error: "Failed to get response from OpenAI" }, { status: 500 });
            }

            console.log('OpenAI response generated:', gptResponseText.substring(0, 100) + '...');

            const avatarUrl = generatedAvatarUri({
                seed: existingAgent.name,
                variant: "botttsNeutral",
            });

            // Ensure agent user exists in Stream Chat
            await streamChat.upsertUsers([{
                id: existingAgent.id,
                name: existingAgent.name,
                image: avatarUrl,
            }]);

            console.log('Sending message to channel as agent...');

            await channel.sendMessage({
                text: gptResponseText,
                user: {
                    id: existingAgent.id,
                    name: existingAgent.name,
                    image: avatarUrl,
                }
            });

            console.log('Message sent successfully');

        } catch (error) {
            console.error('Error processing message.new event:', error);
            return NextResponse.json({ error: "Failed to process message" }, { status: 500 });
        }
    } else {
        console.log('Unhandled event type:', eventType);
        console.log('Event payload:', JSON.stringify(payload, null, 2));
    }

    return NextResponse.json({ status: "ok" });
}

// Add a GET endpoint to test if the webhook URL is accessible
export async function GET() {
    console.log('Webhook endpoint accessed via GET');
    return NextResponse.json({ 
        status: "Webhook endpoint is working",
        timestamp: new Date().toISOString()
    });
}