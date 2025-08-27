"use client";

import { ColumnDef } from "@tanstack/react-table";
import { GeneratedAvatar } from "@/components/generated-avatar";
import {
  CircleCheckIcon,
  CircleXIcon,
  ClockArrowUpIcon,
  ClockFadingIcon,
  CornerDownRightIcon,
  LoaderIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MeetingGetMany } from "../../types";
import { format } from "date-fns";
import { cn, formatDuration } from "@/lib/utils";


const statusIconMap = {
  upcoming: ClockArrowUpIcon,
  active: LoaderIcon,
  completed: CircleCheckIcon,
  cancelled: CircleXIcon,
  processing: LoaderIcon,
};

const statusColorMap = {
  upcoming: "text-black-500 bg-black-500/20 border-black-800/5",
  active: "text-blue-500 bg-blue-500/20 border-blue-800/5",
  completed: "text-green-500 bg-green-500/20 border-green-800/5",
  cancelled: "text-red-500 bg-red-500/20 border-red-800/5",
  processing: "text-gray-500 bg-gray-500/20 border-gray-800/5",
};

export const columns: ColumnDef<MeetingGetMany[number]>[] = [
  {
    accessorKey: "name",
    header: "Meeting Name",
    cell: ({ row }: { row: { original: MeetingGetMany[number] } }) => {
      return (
        <div className="flex flex-col gap-y-1">
          <span className="font-semibold capitalize">{row.original.name}</span>
          <div className="flex items-center gap-x-2">
            <div className="flex items-center gap-x-1">
            <CornerDownRightIcon className="size-3 text-muted-foreground" />
            <span className="text-sm text-muted-foreground max-w-[200px] truncate capitalize">
              {row.original.agents.name}
            </span>
            </div>
            <GeneratedAvatar 
              variant="botttsNeutral"
              seed={row.original.agents.name}
              className="size-4"
            />
            <span className="text-sm text-muted-foreground">
              {row.original.startedAt ? format(row.original.startedAt, "MMM dd, yyyy") : "N/A"}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const Icon = statusIconMap[row.original.status as keyof typeof statusIconMap];

      return (
        <Badge
          variant="outline"
          className={cn("capitalize text-muted-foreground [&>svg]:size-4",
          statusColorMap[row.original.status as keyof typeof statusColorMap]
          )}
        >
          <Icon 
            className={cn(row.original.status === "processing" && "animate-spin")}
          />
          {row.original.status}
        </Badge>
      )
    },
  },
  {
    accessorKey: "duration",
    header: "Duration",
    cell : ({ row }) => {
      <Badge
        variant="outline"
        className="capitalize flex items-center gap-x-2 [&>svg]:size-4"
      >
        <ClockFadingIcon className="text-blue-700" />
        {row.original.duration ? formatDuration(row.original.duration) : "N/A"}
      </Badge>
    },
  },
];
