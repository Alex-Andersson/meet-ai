"use client";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/client";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { MeetingIdViewHeader } from "../components/meetingt-id-view-header";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/hooks/use-confirm";
import { UpdateMeetingDialog } from "../components/update-meeting-dialog";
import { useState } from "react";
import { da } from "date-fns/locale";
import { UpcomingState } from "../components/upcoming-state";
import { ActiveState } from "../components/active-state";
import { CancelledState } from "../components/cancelled-state";
import { ProcessingState } from "../components/processing-state";

interface Props {
  meetingId: string;
}

export const MeetingIdView = ({ meetingId }: Props) => {
    const trpc = useTRPC();
    const router = useRouter();
    const queryClient = useQueryClient();

    const [updateMeetingDialogOpen, setUpdateMeetingDialogOpen] = useState(false);

    const [RemoveConfirmation, confirmRemove] = useConfirm(
        "Are you sure?",
        "The following meeting will be permanently deleted.",
    )

    const { data } = useSuspenseQuery(
        trpc.meetings.getOne.queryOptions({ id: meetingId }),
    );

  const removeMeeting = useMutation(
    trpc.meetings.remove.mutationOptions({
        onSuccess: () => {
            queryClient.invalidateQueries(trpc.meetings.getMany.queryOptions({}));
            router.push('/meetings');
        },
    }),
  );

  const handleRemoveMeeting = async () => {
      const confirmed = await confirmRemove();
      if (confirmed) {
          await removeMeeting.mutateAsync({ id: meetingId });
      }
  };

  const isActive = data.status === 'active';
  const isUpcoming = data.status === 'upcoming';
  const isCancelled = data.status === 'cancelled';
  const isCompleted = data.status === 'completed';
  const isProcessing = data.status === 'processing';

  return (
    <>
      <RemoveConfirmation />
      <UpdateMeetingDialog 
        open={updateMeetingDialogOpen}
        onOpenChange={setUpdateMeetingDialogOpen}
        initialValues={data}
      />
      <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-4">
        <MeetingIdViewHeader 
            meetingId={meetingId}
            meetingName={data.name}
            onEdit={() => setUpdateMeetingDialogOpen(true)}
            onRemove={handleRemoveMeeting}
        />
         {isCancelled && <CancelledState />}
         {isProcessing && <ProcessingState />}
         {isCompleted && <div>Meeting has been completed.</div>}
         {isActive && <ActiveState meetingId={meetingId} />}
         {isUpcoming && <UpcomingState 
            meetingId={meetingId}
            onCancelMeeting={handleRemoveMeeting}
            isCancelling={false}
         />}
      </div>
    </>
  );
};

export const MeetingIdViewLoading = () => {
  return (
    <LoadingState 
        title="Loading Meeting Details"
        description="Please wait while we fetch the meeting details."
    />
  );
};

export const MeetingIdViewError = () => {
  return (
    <ErrorState
        title="Error Loading Meeting Details"
        description="There was an error loading the meeting details. Please try again later."
    />
  );
};