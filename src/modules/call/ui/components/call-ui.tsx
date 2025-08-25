import { StreamTheme, useCall, CallingState } from "@stream-io/video-react-sdk";
import { useState } from "react";
import { CallLobby } from "./call-lobby";
import { CallActive } from "./call-active";
import { CallEnded } from "./call-ended";

interface Props {
    meetingName: string;
};

export const CallUI = ({ meetingName }: Props) => {
    const call = useCall();
    const [show, setShow] = useState<"lobby" | "call" | "ended">("lobby");

    const handleJoin = async () => {
        if (!call) return;
        
        try {
            await call.join();
            setShow("call");
        } catch (error) {
            console.error('Error joining call:', error);
            // You could add toast notification here
        }
    };

    const handleLeave = async () => {
        if (!call) return;
        
        try {
            // Check if the call is still active before trying to leave
            if (call.state.callingState !== CallingState.LEFT && 
                call.state.callingState !== CallingState.IDLE) {
                await call.leave();
            }
            
            // Only end the call if it hasn't been ended already
            if (call.state.callingState !== CallingState.IDLE) {
                await call.endCall();
            }
            
            setShow("ended");
        } catch (error) {
            console.error('Error leaving call:', error);
            // Still show ended screen even if there's an error
            setShow("ended");
        }
    };

    return (
        <StreamTheme className="h-full">
            {show === "lobby" && <CallLobby onJoin={handleJoin} />}
            {show === "call" && <CallActive onLeave={handleLeave} meetingName={meetingName} />}
            {show === "ended" && <CallEnded />}
        </StreamTheme>
    )
}