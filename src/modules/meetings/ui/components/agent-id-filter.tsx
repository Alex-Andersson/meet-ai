import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { CommandSelect } from "@/components/command-select";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { useMeetingsFilters } from "../../hooks/use-meetings-filters";


export const AgentIdFilter = () => {
    const [filters, setFilters] = useMeetingsFilters();
    
    const trpc = useTRPC();

    const [agentSearch, setAgentSearch] = useState("");
    const { data } = useQuery(
        trpc.agents.getMany.queryOptions({
            search: agentSearch,
            pageSize: 100,
        }),
    );

    return (
        <CommandSelect 
            placeholder="Agent"
            className="h-9"
            options={(data?.items ?? []).map((agent) => ({
                id: agent.id,
                value: agent.id,
                children: (
                    <div className="flex items-center gap-x-2">
                        <GeneratedAvatar 
                            variant="botttsNeutral"
                            seed={agent.name}
                            className="size-4"
                        />
                        <span className="font-semibold capitalize">{agent.name}</span>
                    </div>
                ),
            }))} 
            onSelect={(value) => setFilters({ agentId: value })}
            onSearch={setAgentSearch}
            value={filters.agentId ?? ""}
        />
    )
};