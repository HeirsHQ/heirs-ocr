"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { motion } from "framer-motion";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Button } from "../ui/button";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  showPageSizeChange?: boolean;
  selectedCount?: number;
}

const ROWS_PER_PAGE = ["10", "15", "20", "25", "30", "50"];

export const Pagination = ({
  onPageChange,
  page,
  pageSize,
  total,
  onPageSizeChange,
  showPageSizeChange = false,
  selectedCount,
}: Props) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const canPreviousPage = page > 1;
  const canNextPage = page < totalPages;

  return (
    <motion.div
      className="flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
      animate={{ opacity: 1 }}
    >
      <p className="text-muted-foreground">
        {selectedCount != null ? (
          <>
            {selectedCount} of {total} rows.
          </>
        ) : (
          <>
            {start}-{end} of {total} rows
          </>
        )}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
        {showPageSizeChange && (
          <div className="flex items-center justify-between gap-x-3 sm:justify-start">
            <p className="text-muted-foreground">Rows per page</p>
            <Select onValueChange={(value) => onPageSizeChange?.(Number(value))} value={pageSize.toString()}>
              <SelectTrigger className="text-muted-foreground w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROWS_PER_PAGE.map((row) => (
                  <SelectItem key={row} value={row}>
                    {row}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 sm:justify-start">
          <p className="text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2 sm:gap-1">
            <Button
              aria-label="First page"
              variant="outline"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => onPageChange?.(1)}
              disabled={!canPreviousPage}
            >
              <ChevronsLeft className="size-4" />
            </Button>
            <Button
              aria-label="Previous page"
              variant="outline"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => onPageChange?.(page - 1)}
              disabled={!canPreviousPage}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              aria-label="Next page"
              variant="outline"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => onPageChange?.(page + 1)}
              disabled={!canNextPage}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              aria-label="Last page"
              variant="outline"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => onPageChange?.(totalPages)}
              disabled={!canNextPage}
            >
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
