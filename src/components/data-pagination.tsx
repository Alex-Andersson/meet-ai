import { Button } from "@/components/ui/button";

interface Props {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

 export const DataPagination = ({ page, totalPages, onPageChange }: Props) => {
    return (
        <div className="flex items-center justify-between">
            <div className="text-sm flex-1 text-muted-foreground">
                Page {page} of {totalPages || 1}
            </div>
            <div className="flex items-center justify-end space-x-2 py-4">
                <Button
                    onClick={() => onPageChange(Math.max(page - 1, 1))}
                    disabled={page === 1}
                    variant="outline"
                    size="sm"
                    >
                    Previous
                </Button>
                <Button
                    onClick={() => onPageChange(Math.min(page + 1, totalPages))}
                    disabled={page === totalPages || totalPages === 0}
                    variant="outline"
                    size="sm">
                    Next
                </Button>
            </div>
        </div>
    );
};