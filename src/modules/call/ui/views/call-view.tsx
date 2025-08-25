"use client";

import { ErrorState } from "@/components/error-state";
import { useTRPC } from "@/trpc/client";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CallProvider } from "../components/call-provider";

interface Props {
    meetingId: string;
}

export const Callview = ({ meetingId }: Props) => {
    const trpc = useTRPC();
    const { data } = useSuspenseQuery(
        trpc.meetings.getOne.queryOptions({ id: meetingId }),
    );

    if (data.status === "completed") {
        return (
            <div className="flex h-screen items-center justify-center">
                <ErrorState 
                    title="Meeting not found"
                    description="The meeting you are looking for does not exist."
                />
            </div>
        )
    }

    return <CallProvider meetingId={data.id} meetingName={data.name} />
}
    

