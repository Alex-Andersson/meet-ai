"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { DataTable } from "../components/data-table";
import { columns } from "../components/columns";
import { EmptyState } from "@/components/empty-state";
import { useAgentsFilters } from "../../hooks/use-agents-filters";
import { DataPagination } from "../components/data-pagination";



export const AgentsView = () => {
    const [filters, setFilters] = useAgentsFilters();

    const trpc = useTRPC();
    const { data } = useSuspenseQuery(trpc.agents.getMany.queryOptions({
        ...filters,
    }));

    return (
        <div className="flex-1 pb-4 px-4 md:px-8 flex flex-col gap-y-4">
            <DataTable data={Array.isArray(data) ? data : data.items} columns={columns} />
            <DataPagination 
              page={filters.page}
              totalPages={Array.isArray(data) ? 1 : data.totalPages}
              onPageChange={(page) => setFilters({ page })}
            />
            {(Array.isArray(data) ? data.length === 0 : data.items.length === 0) && (
                <div className="flex-1 flex items-center justify-center">
                    <EmptyState
                        title="No Agents Found"
                        description="Create your first agent to get started."
                    />
                </div>
            )}
        </div>
    )
}

export const AgentsViewLoading = () => {
    return (
        <LoadingState
            title="Loading Agents"
            description="Please wait while we fetch the agents."
        />
    )
}

export const AgentsViewError = () => {
  return (
    <ErrorState
      title="An error occurred"
      description="Please try again later or contact support if the issue persists."
    />
  );
}
