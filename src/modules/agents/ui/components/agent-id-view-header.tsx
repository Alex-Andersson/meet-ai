import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon, MoreVerticalIcon } from "lucide-react";

interface Props {
  agentId: string;
  agentName: string;
  onEdit: () => void;
  onRemove: () => void;
}

export const AgentIdViewHeader = ({
  agentId,
  agentName,
  onEdit,
  onRemove,
}: Props) => {
  return (
    <div className="flex items-center justify-between">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/agents" className="font-medium text-xl">
              Agents
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="text-foreground text-xl font-medium [&>svg]:size-4 pt-1" />
          <BreadcrumbItem>
            <BreadcrumbLink
              href={`/agents/${agentId}`}
              className="font-medium text-xl"
            >
              {agentName}
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="cursor-pointer">
                <MoreVerticalIcon className="size-4" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="right">
            <DropdownMenuItem onClick={onEdit} className="cursor-pointer">
                <PencilIcon className="size-4 text-black" />
                Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove} className="cursor-pointer">
                <TrashIcon className="size-4 text-red-600" />
                Remove
            </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
