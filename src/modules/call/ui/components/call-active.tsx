import Link from "next/link";
import Image from "next/image";
import { CallControls, SpeakerLayout, useCallStateHooks, useCall } from "@stream-io/video-react-sdk";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { BotIcon, CheckIcon, MicIcon, MicOffIcon } from "lucide-react";

interface Props {
  onLeave: () => void;
  meetingName: string;
  meetingId?: string;
}

export const CallActive = ({ onLeave, meetingName, meetingId }: Props) => {
  const trpc = useTRPC();
  const [aiJoined, setAiJoined] = useState(false);
  const { useMicrophoneState } = useCallStateHooks();
  const { microphone } = useMicrophoneState();
  const call = useCall();
  
  // Enhanced debugging
  useEffect(() => {
    console.log('=== MICROPHONE DEBUG ===');
    console.log('Microphone enabled:', microphone.enabled);
    console.log('Call object:', call);
    console.log('Microphone object:', microphone);
    
    if (call) {
      console.log('Call state:', {
        callingState: call.state.callingState,
        microphoneState: call.microphone
      });
    }
  }, [microphone.enabled, call]);
  
  const handleToggleMicrophone = async () => {
    try {
      console.log('Toggling microphone, current state:', microphone.enabled);
      
      if (!call) {
        console.error('No call object available');
        return;
      }
      
      if (microphone.enabled) {
        await call.microphone.disable();
        console.log('Microphone disabled via call object');
      } else {
        // Try to enable microphone
        await call.microphone.enable();
        console.log('Microphone enabled via call object');
        
        // Double check if it's actually enabled
        setTimeout(() => {
          console.log('Microphone state after enable:', call.microphone.enabled);
        }, 1000);
      }
    } catch (error) {
      console.error('Error toggling microphone via call object:', error);
      
      // Fallback: try direct Web API
      try {
        console.log('Trying fallback microphone access...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Fallback microphone access successful');
        
        // Try to set the stream to the call
        if (call && call.microphone) {
          stream.getTracks().forEach(track => track.stop()); // Clean up test stream
          await call.microphone.enable();
        }
      } catch (fallbackError) {
        console.error('Fallback microphone access failed:', fallbackError);
        alert('Microphone access failed. Please check browser permissions and try refreshing the page.');
      }
    }
  };
  
  const { mutateAsync: triggerAI, isPending } = useMutation(
    trpc.meetings.triggerAI.mutationOptions({
      onSuccess: () => {
        setAiJoined(true);
      },
      onError: (error) => {
        console.error('Error triggering AI:', error);
      }
    })
  );

  const handleJoinAI = async () => {
    if (!meetingId) return;
    await triggerAI({ meetingId });
  };

  return (
    <div className="flex flex-col justify-between p-4 h-full text-white">
      <div className="bg-[#101213] rounded-full p-4 flex items-center gap-4">
        <Link
          href="/"
          className="flex items-center justify-center p-1 bg-white/10 rounded-full w-fit"
        >
          <Image src="/logo.svg" alt="MeetAI Logo" width={22} height={22} />
        </Link>
        <h4 className="text-base">{meetingName}</h4>
        <div className="flex gap-2 ml-auto">
          {/* Microphone Toggle Button */}
          <Button
            variant={microphone.enabled ? "default" : "outline"}
            size="sm"
            onClick={handleToggleMicrophone}
          >
            {microphone.enabled ? (
              <>
                <MicIcon className="w-4 h-4 mr-2" />
                Mic On
              </>
            ) : (
              <>
                <MicOffIcon className="w-4 h-4 mr-2" />
                Mic Off
              </>
            )}
          </Button>
          
          {meetingId && (
            <Button
              variant={aiJoined ? "secondary" : "default"}
              size="sm"
              onClick={handleJoinAI}
              disabled={isPending || aiJoined}
            >
              {aiJoined ? (
                <>
                  <CheckIcon className="w-4 h-4 mr-2" />
                  AI Joined
                </>
              ) : (
                <>
                  <BotIcon className="w-4 h-4 mr-2" />
                  {isPending ? "Joining..." : "Join AI"}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
      <SpeakerLayout />
      <div className="bg-[#101213] round-full px-4">
        <CallControls onLeave={onLeave} />
      </div>
    </div>
  );
};
