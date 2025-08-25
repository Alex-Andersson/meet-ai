"use client";

import { LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTRPC } from "@/trpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  StreamCall,
  StreamVideo,
  StreamVideoClient,
  Call,
  CallingState,
} from "@stream-io/video-react-sdk";
import "@stream-io/video-react-sdk/dist/css/styles.css";
import { CallUI } from "./call-ui";

interface Props {
    meetingId: string;
    meetingName: string;
    userId: string;
    userName: string;
    userImage: string; 
}

export const CallConnect = ({ meetingId, meetingName, userId, userName, userImage }: Props) => {
    const trpc = useTRPC();
    const { mutateAsync: generatedToken } = useMutation(
        trpc.meetings.generatedToken.mutationOptions()
    );
    const { mutateAsync: getOrCreateCall } = useMutation(
        trpc.meetings.getOrCreateCall.mutationOptions()
    );

    const [client, setClient] = useState<StreamVideoClient>();
    useEffect(() => {
      const apiKey = process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY;
      
      if (!apiKey) {
        console.error('NEXT_PUBLIC_STREAM_VIDEO_API_KEY is not set');
        return;
      }

      const _client = new StreamVideoClient({
        apiKey,
        user: {
            id: userId,
            name: userName,
            image: userImage,
        },
        tokenProvider: generatedToken,
      });
        setClient(_client);

        return () => {
            _client.disconnectUser();
            setClient(undefined);
        };
    }, [userId, userName, userImage, generatedToken]);

    const [call, setCall] = useState<Call>();
        useEffect(() => {
            if (!client) return;

            const initializeCall = async () => {
                try {
                    // Ensure the call exists on Stream's servers
                    await getOrCreateCall({ meetingId });
                    
                    // Now create the client-side call
                    const _call = client.call("default", meetingId);
                    _call.camera.disable();
                    _call.microphone.disable();
                    setCall(_call);
                } catch (error) {
                    console.error('Error initializing call:', error);
                }
            };

            initializeCall();

            return () => {
                if (call && call.state.callingState !== CallingState.LEFT) {
                    call.leave();
                    call.endCall();
                    setCall(undefined);
                }
            };
        }, [client, meetingId, getOrCreateCall]);

        if (!client || !call) {
            return (
                <div className="flex h-screen items-center justify-center bg-radial from-sidebar-accent to-sidebar">
                    <LoaderIcon className="animate-spin size-6 text-white" />
                </div>
            );
        }

    return (
        <StreamVideo client={client}>
            <StreamCall call={call}>
                <CallUI meetingName={meetingName} />
            </StreamCall>
        </StreamVideo>
    );
};
