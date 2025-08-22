"use client";

import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/client";
import { useSuspenseQuery } from "@tanstack/react-query";
import { columns } from "../components/columns";
import { EmptyState } from "@/components/empty-state";
import { useRouter } from "next/navigation";
import { useMeetingsFilters } from "../../hooks/use-meetings-filters";
import { DataPagination } from "@/components/data-pagination";

export const MeetingsView = () => {
  const trpc = useTRPC();
  const router = useRouter();
  const [filters, setFilters] = useMeetingsFilters();

  const { data } = useSuspenseQuery(trpc.meetings.getMany.queryOptions({
    ...filters,
  }));

  return (
    <div className="flex-1 p-b-4 px-4 md:px-8 flex flex-col gap-y-4">
      <DataTable data={data.items} columns={columns} onRowClick={(row) => router.push(`/meetings/${row.id}`)}/>
      <DataPagination 
        page={filters.page}
        totalPages={data.totalPages}
        onPageChange={(page) => setFilters({ page })}
      />
      {(Array.isArray(data) ? data.length === 0 : data.items.length === 0) && (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            title="No Meeting Found"
            description="Create your first meeting to get started."
          />
        </div>
      )}
    </div>
  );
};

export const MeetingsViewLoading = () => {
  return (
    <LoadingState
      title="Loading Meetings"
      description="Please wait while we fetch the meetings."
    />
  );
};

export const MeetingsViewError = () => {
  return (
    <ErrorState
      title="An error occurred"
      description="Please try again later or contact support if the issue persists."
    />
  );
};
