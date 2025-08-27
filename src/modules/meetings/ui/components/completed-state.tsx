import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MeetingGetOne } from "../../types";
import Link from "next/link";
import Markdown from "react-markdown";
import { GeneratedAvatar } from "@/components/generated-avatar";
import {
  BookOpenTextIcon,
  SparklesIcon,
  FileTextIcon,
  FileVideoIcon,
  ClockFadingIcon,
} from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/utils";
import { Transcript } from "./transcript";
import { ChatProvider } from "./chat-provider";

interface Props {
  data: MeetingGetOne;
}

export const CompletedState = ({ data }: Props) => {
  return (
    <div className="flex flex-col gap-y-4">
      <Tabs defaultValue="summary">
        <div className="bg-white rounded-lg border px-3">
          <ScrollArea>
            <TabsList className="p-0 bg-background justify-start rounded-none h-13">
              <TabsTrigger 
              className="text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-white data-[state=active]:shadow-sm [&>svg]:size-4"
              value="summary"
              >
                <BookOpenTextIcon />
                Summary
              </TabsTrigger>
              <TabsTrigger 
              className="text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-white data-[state=active]:shadow-sm [&>svg]:size-4"
              value="transcript"
              >
                <FileTextIcon />
                Transcript
              </TabsTrigger>
              <TabsTrigger 
              className="text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-white data-[state=active]:shadow-sm [&>svg]:size-4"
              value="recording"
              >
                <FileVideoIcon />
                Recording
              </TabsTrigger>
              <TabsTrigger 
              className="text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-white data-[state=active]:shadow-sm [&>svg]:size-4"
              value="chat"
              >
                <SparklesIcon />
                Ask AI
              </TabsTrigger>
            </TabsList>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
        <TabsContent value="chat">
            <ChatProvider meetingId={data.id} meetingName={data.name} />
        </TabsContent>
        <TabsContent value="transcript">
            <Transcript meetingId={data.id} />
        </TabsContent>
        <TabsContent value="recording" className="mt-4">
            <div className="bg-white rounded-lg border px-4 py-5">
                <video
                    src={data.recordingUrl!}
                    className="w-full rounded-lg"
                    controls
                />
            </div>
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
            <div className="bg-white rounded-lg border px-4 py-5">
                <div className="px-4 py-5 gap-y-5 flex flex-col col-span-5">
                   <h2 className="text-2xl font-medium capitalize">{data.name}</h2>
                   <div className="flex gap-x-2 items-center">
                       <Link
                            href={`/agents/${data.agents.id}`}
                            className="flex items-center gap-x-2 underline underline-offset-4 capitalize"
                       >
                            <GeneratedAvatar 
                                variant="botttsNeutral"
                                seed={data.agents.name}
                                className="size-5"
                            />
                            {data.agents.name}
                       </Link> {" "}
                       <p>{data.startedAt ? format(data.startedAt, "PPpp") : "N/A"}</p>
                   </div>
                   <div className="flex gap-x-2 items-center">
                     <SparklesIcon className="size-4 text-blue-700" />
                      <p>General summary</p>
                    </div>     
                    <Badge variant="outline" className="flex items-center gap-x-2 [&>svg]:size-4">
                        <ClockFadingIcon className="text-blue-700" />
                        {data.duration ? formatDuration(data.duration) : "N/A"}
                    </Badge>
                    <div>
                       <Markdown 
                        components={{
                            h1: (props) => (
                                <h1 
                                    className="text-2xl font-semibold my-2" 
                                    {...props}
                                />
                            )
                        }}
                       >
                        {data.summary || "No summary available."}
                       </Markdown>
                    </div>            
                </div>
            </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
