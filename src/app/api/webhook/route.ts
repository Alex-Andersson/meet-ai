import { and, eq, not } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  CallEndedEvent,
  CallTranscriptionReadyEvent,
  CallSessionParticipantLeftEvent,
  CallSessionParticipantJoinedEvent,
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
            
            console.log('Attempting to connect OpenAI with call:', call.cid);
            console.log('Using API key:', process.env.OPENAI_API_KEY ? 'present' : 'missing');
            console.log('Agent user ID:', existingAgent.id);
            
            // Add a small delay to ensure everything is properly initialized
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Implement retry logic for the mask function issue
            let realtimeClient: Awaited<ReturnType<typeof streamVideo.video.connectOpenAi>> | null = null;
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
                try {
                    // Add progressive delay for each retry
                    if (retryCount > 0) {
                        console.log(`Webhook retry attempt ${retryCount}/${maxRetries} for OpenAI connection...`);
                        await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
                    }
                    
                    realtimeClient = await streamVideo.video.connectOpenAi({
                        call,
                        openAiApiKey: process.env.OPENAI_API_KEY!,
                        agentUserId: existingAgent.id,
                    });
                    
                    console.log('Webhook OpenAI connection successful');
                    break;
                    
                } catch (error) {
                    retryCount++;
                    console.error(`Webhook OpenAI connection attempt ${retryCount} failed:`, error);
                    
                    if (error instanceof Error && error.message.includes('mask is not a function')) {
                        console.log('Webhook: Mask function error detected, implementing workaround...');
                        
                        if (retryCount >= maxRetries) {
                            return NextResponse.json({ 
                                error: "Failed to connect AI agent", 
                                details: 'OpenAI connection failed after multiple attempts due to SDK initialization issue. Please try manual trigger.' 
                            }, { status: 500 });
                        }
                        
                        // Continue to next retry
                        continue;
                    } else {
                        // For other errors, fail immediately
                        throw error;
                    }
                }
            }
            
            if (!realtimeClient) {
                return NextResponse.json({ 
                    error: "Failed to connect AI agent", 
                    details: 'Failed to establish OpenAI connection after all retry attempts.' 
                }, { status: 500 });
            }

            console.log('OpenAI client connected, updating session...');
            
            // Add event listeners for debugging
            realtimeClient.on('session.created', () => {
                console.log('OpenAI session created');
            });
            
            realtimeClient.on('session.updated', () => {
                console.log('OpenAI session updated');
            });
            
            realtimeClient.on('conversation.item.created', (event: unknown) => {
                console.log('OpenAI conversation item created:', event);
            });
            
            realtimeClient.on('response.audio_transcript.delta', (event: unknown) => {
                console.log('OpenAI audio transcript:', event);
            });
            
            realtimeClient.on('error', (event: unknown) => {
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
            console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
            console.error('Error message:', error instanceof Error ? error.message : String(error));
            
            return NextResponse.json({ error: "Failed to connect AI agent", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
        }
    } else if (eventType === "call.session_participant_joined") {
        console.log('Processing call.session_participant_joined event');
        const event = payload as CallSessionParticipantJoinedEvent;
        const meetingId = event.call_cid.split(":")[1];
        const joinedUserId = event.participant?.user?.id;

        console.log('Participant joined - Meeting ID:', meetingId);
        console.log('Participant joined - User ID:', joinedUserId);

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId in call custom data" }, { status: 400 });
        }

        // Get meeting details
        const [existingMeeting] = await db
            .select()
            .from(meetings)
            .where(eq(meetings.id, meetingId));

        if (!existingMeeting) {
            console.log('Meeting not found for participant join event');
            return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
        }

        // Get agent details
        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, existingMeeting.agentId));

        if (!existingAgent) {
            console.log('Agent not found for meeting:', meetingId);
            return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        }

        // Check if the joined user is NOT the agent (avoid triggering AI when AI joins)
        if (joinedUserId === existingAgent.id) {
            console.log('AI agent joined, skipping auto-trigger');
            return NextResponse.json({ message: "AI agent joined, no action needed" });
        }

        // Check if meeting is not already active (avoid duplicate triggers)
        if (existingMeeting.status === "active") {
            console.log('Meeting already active, skipping auto-trigger');
            return NextResponse.json({ message: "Meeting already active" });
        }

        console.log('Real user joined, auto-triggering AI agent:', existingAgent.id);

        try {
            // Update meeting status to active
            await db
                .update(meetings)
                .set({
                    status: "active",
                    startedAt: new Date(),
                })
                .where(eq(meetings.id, existingMeeting.id));

            const call = streamVideo.video.call("default", meetingId);
            
            // Ensure the agent user exists in Stream
            await streamVideo.upsertUsers([
                {
                    id: existingAgent.id,
                    name: existingAgent.name,
                    role: 'user',
                }
            ]);
            
            console.log('Auto-connecting OpenAI agent on participant join:', existingAgent.id);
            
            // Add a small delay to ensure everything is properly initialized
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Implement retry logic for the mask function issue
            let realtimeClient: Awaited<ReturnType<typeof streamVideo.video.connectOpenAi>> | null = null;
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
                try {
                    // Add progressive delay for each retry
                    if (retryCount > 0) {
                        console.log(`Auto-trigger retry attempt ${retryCount}/${maxRetries} for OpenAI connection...`);
                        await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
                    }
                    
                    realtimeClient = await streamVideo.video.connectOpenAi({
                        call,
                        openAiApiKey: process.env.OPENAI_API_KEY!,
                        agentUserId: existingAgent.id,
                    });
                    
                    console.log('Auto-trigger OpenAI connection successful');
                    break;
                    
                } catch (error) {
                    retryCount++;
                    console.error(`Auto-trigger OpenAI connection attempt ${retryCount} failed:`, error);
                    
                    if (error instanceof Error && error.message.includes('mask is not a function')) {
                        console.log('Auto-trigger: Mask function error detected, implementing workaround...');
                        
                        if (retryCount >= maxRetries) {
                            console.error('Auto-trigger failed after all retries');
                            return NextResponse.json({ 
                                error: "Failed to auto-connect AI agent", 
                                details: 'OpenAI connection failed after multiple attempts due to SDK initialization issue.' 
                            }, { status: 500 });
                        }
                        
                        // Continue to next retry
                        continue;
                    } else {
                        // For other errors, fail immediately
                        throw error;
                    }
                }
            }
            
            if (!realtimeClient) {
                return NextResponse.json({ 
                    error: "Failed to auto-connect AI agent", 
                    details: 'Failed to establish OpenAI connection after all retry attempts.' 
                }, { status: 500 });
            }

            console.log('Auto-trigger OpenAI client connected, updating session...');
            
            // Add event listeners for debugging
            realtimeClient.on('session.created', () => {
                console.log('Auto-trigger: OpenAI session created');
            });
            
            realtimeClient.on('session.updated', () => {
                console.log('Auto-trigger: OpenAI session updated');
            });
            
            realtimeClient.on('conversation.item.created', (event: unknown) => {
                console.log('Auto-trigger: OpenAI conversation item created:', event);
            });
            
            realtimeClient.on('response.audio_transcript.delta', (event: unknown) => {
                console.log('Auto-trigger: OpenAI audio transcript:', event);
            });
            
            realtimeClient.on('error', (event: unknown) => {
                console.error('Auto-trigger: OpenAI error:', event);
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
            
            // Send an initial greeting message after a short delay
            setTimeout(() => {
                realtimeClient.sendUserMessageContent([{
                    type: 'input_text',
                    text: `Hello! I'm ${existingAgent.name}, your AI assistant. I just joined the call automatically and I'm ready to help.`
                }]);
            }, 3000);
            
            console.log('Auto-trigger: OpenAI agent session configured successfully');
            return NextResponse.json({ message: "AI agent auto-connected successfully" });
            
        } catch (error) {
            console.error('Auto-trigger: Error connecting OpenAI agent:', error);
            return NextResponse.json({ 
                error: "Failed to auto-connect AI agent", 
                details: error instanceof Error ? error.message : String(error) 
            }, { status: 500 });
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