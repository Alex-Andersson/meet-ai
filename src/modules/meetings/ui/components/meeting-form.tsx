import { useTRPC } from "@/trpc/client";
import { MeetingGetOne } from "../../types"; 
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { meetingsInsertSchema } from "../../schemas";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CommandSelect } from "@/components/command-select";
import { GeneratedAvatar } from "@/components/generated-avatar";

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { useState } from "react";
import { NewAgentDialog } from "@/modules/agents/ui/components/new-agent-dialog";



interface MeetingFormProps {
  onSuccess?: (id?: string) => void;
  onCancel?: () => void;
  initialValues?: MeetingGetOne;
}

export const MeetingForm = ({
  onSuccess,
  onCancel,
  initialValues,
}: MeetingFormProps) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [openNewAgentDialog, setOpenNewAgentDialog] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");

  const agents = useQuery(
    trpc.agents.getMany.queryOptions({
      pageSize: 100,
      search: agentSearch,
    }),
  );

  const createMeeting = useMutation(
    trpc.meetings.create.mutationOptions({
      onSuccess: async (data) => {
        await queryClient.invalidateQueries(
            trpc.meetings.getMany.queryOptions({}),
        );

        onSuccess?.(data.id);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const updateMeeting = useMutation(
    trpc.meetings.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
            trpc.meetings.getMany.queryOptions({}),
        );

        if (initialValues?.id) {
            await queryClient.invalidateQueries(
                trpc.meetings.getOne.queryOptions({ id: initialValues.id }),
            );
        }
        onSuccess?.();
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const form = useForm<z.infer<typeof meetingsInsertSchema>>({
    resolver: zodResolver(meetingsInsertSchema),
    defaultValues: {
      name: initialValues?.name ?? "",
      agentId: initialValues?.agentId ?? "",
    },
  });

  const isEdit = !!initialValues?.id;
  const isPending = createMeeting.isPending || updateMeeting.isPending;

  const onSubmit = (values: z.infer<typeof meetingsInsertSchema>) => {
    if (isEdit) {
      updateMeeting.mutate({ ...values, id: initialValues!.id });
    } else {
      createMeeting.mutate(values);
    }
  };

  return (
    <>
    <NewAgentDialog open={openNewAgentDialog} onOpenChange={setOpenNewAgentDialog} />
    <Form {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField 
                name="name"
                control={form.control}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                            <Input placeholder="Enter meeting name" {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField 
                name="agentId"
                control={form.control}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Agent</FormLabel>
                        <FormControl>
                            <CommandSelect 
                              options={(
                                Array.isArray(agents.data)
                                  ? agents.data
                                  : agents.data?.items ?? []
                              ).map((agent) => ({
                                id: agent.id,
                                value: agent.id,
                                children: (
                                  <div className="flex items-center gap-x-2">
                                    <GeneratedAvatar 
                                      variant="botttsNeutral"
                                      seed={agent.name}
                                      className="size-6 border"
                                    />
                                    <span className="ml-2">{agent.name}</span>
                                  </div>
                                ),
                              }))}
                              onSelect={field.onChange}
                              onSearch={setAgentSearch}
                              value={field.value}
                              placeholder="Select an agent"
                            />
                        </FormControl>
                        <FormDescription>
                           Not found what you are looking for?{" "}
                           <Button
                            type="button" 
                            variant="link"
                            onClick={() => setOpenNewAgentDialog(true)}
                           >
                            Create a new agent
                           </Button>
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <div className="flex justify-between gap-2">
                {onCancel && (
                    <Button variant="ghost" onClick={onCancel} type="button" className="mr-2">
                        Cancel
                    </Button>
                )}
                <Button type="submit" disabled={isPending}>
                    {isEdit ? "Update Meeting" : "Create Meeting"}
                </Button>
            </div>
        </form>
    </Form>
    </>
  )
};
