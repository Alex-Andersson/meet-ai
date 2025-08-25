import { and, eq, not } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  CallEndedEvent,
  CallTranscriptionReadyEvent,
  CallSessionParticipantLeftEvent,
  CallRecordingReadyEvent,
  CallSessionEndedEvent,
  CallSessionStartedEvent,
} from "@stream-io/node-sdk";
import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { streamVideo } from "@/lib/stream-video";
import { inngest } from "@/inngest/client";

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
    } catch (error) {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }   

    const eventType = (payload as Record<string, string>)?.type;
    console.log('Webhook received event:', eventType);
    
    if (eventType === "call.session_started") {
        console.log('Processing call.session_started event');
        const event = payload as CallSessionStartedEvent;
        const meetingId = event.call.custom?.meetingId;

        console.log('Meeting ID from event:', meetingId);

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId in call custom data" }, { status: 400 });
        }

        const [existingMeeting] = await db
            .select()
            .from(meetings)
            .where(
                and(
                    eq(meetings.id, meetingId),
                    not(eq(meetings.status, "completed")),
                    not(eq(meetings.status, "active")),
                    not(eq(meetings.status, "cancelled")),
                    not(eq(meetings.status, "processing")),
                    

                )
            );

        if (!existingMeeting) {
            return NextResponse.json({ error: "Meeting not found or already completed/cancelled/active" }, { status: 404 });
        }

        await db
            .update(meetings)
            .set({
                status: "active",
                startedAt: new Date(),
            })
            .where(eq(meetings.id, existingMeeting.id));

        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, existingMeeting.agentId));

            if (!existingAgent) {
                console.log('Agent not found for meeting:', meetingId);
                return NextResponse.json({ error: "Agent not found" }, { status: 404 });
            }

        console.log('Connecting OpenAI agent:', existingAgent.id);
        console.log('Agent name:', existingAgent.name);
        console.log('Agent instructions:', existingAgent.instructions);
        
        try {
            const call = streamVideo.video.call("default", meetingId);
            
            // Ensure the agent user exists in Stream
            await streamVideo.upsertUsers([
                {
                    id: existingAgent.id,
                    name: existingAgent.name,
                    role: 'user',
                }
            ]);
            
            console.log('Agent user upserted successfully');
            
            const realtimeClient = await streamVideo.video.connectOpenAi({
                call,
                openAiApiKey: process.env.OPENAI_API_KEY!,
                agentUserId: existingAgent.id,
            });

            console.log('OpenAI client connected, updating session...');
            
            // Add event listeners for debugging
            realtimeClient.on('session.created', () => {
                console.log('OpenAI session created');
            });
            
            realtimeClient.on('session.updated', () => {
                console.log('OpenAI session updated');
            });
            
            realtimeClient.on('conversation.item.created', (event: any) => {
                console.log('OpenAI conversation item created:', event);
            });
            
            realtimeClient.on('response.audio_transcript.delta', (event: any) => {
                console.log('OpenAI audio transcript:', event.delta);
            });
            
            realtimeClient.on('error', (event: any) => {
                console.error('OpenAI error:', event);
            });
            
            realtimeClient.updateSession({
                instructions: `${existingAgent.instructions}

Important: You are participating in a live voice conversation. Actively listen and respond when appropriate. Always be conversational and helpful. When you hear someone speaking, feel free to respond naturally.

When you first join the call, introduce yourself briefly with something like "Hello! I'm ${existingAgent.name}, your AI assistant. I'm here and ready to help with the meeting."`,
                voice: 'alloy',
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.3,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 1000
                },
                tool_choice: 'auto'
            });
            
            // Send an initial greeting message
            setTimeout(() => {
                realtimeClient.sendUserMessageContent([{
                    type: 'input_text',
                    text: `Hello! I'm ${existingAgent.name}, your AI assistant. I just joined the call and I'm ready to help.`
                }]);
            }, 2000);
            
            console.log('OpenAI agent session configured successfully');
        } catch (error) {
            console.error('Error connecting OpenAI agent:', error);
            return NextResponse.json({ error: "Failed to connect AI agent" }, { status: 500 });
        }
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