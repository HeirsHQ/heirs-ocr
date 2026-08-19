import { Download } from "lucide-react";

import type { ProcessedDocument } from "@heirs/api-client";
import { formatSize } from "@heirs/ui";

import { createColumns, DateTimeCell, NumberCell, StatusCell, TextCell } from "./core";

interface DocumentColumnHandlers {
  onDownload: (doc: ProcessedDocument) => void;
}

/** Turns `RECEIPT_PARSING` into `Receipt parsing` — the catalog key is not a label. */
const humanizeFunction = (key: string): string => {
  const words = key.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function createDocumentColumns({ onDownload }: DocumentColumnHandlers) {
  return createColumns<ProcessedDocument>({
    columns: [
      {
        accessorKey: "fileName",
        header: "Document",
        cell: ({ row }) => <span className="font-medium">{row.original.fileName}</span>,
      },
      {
        accessorKey: "functionKey",
        header: "Function",
        cell: ({ row }) => <TextCell value={humanizeFunction(row.original.functionKey)} />,
      },
      {
        accessorKey: "outcome",
        header: "Outcome",
        cell: ({ row }) => (
          <StatusCell
            status={row.original.outcome === "error" ? "failed" : "success"}
            config={{ failed: "danger", success: "success" }}
            default="neutral"
          />
        ),
      },
      {
        accessorKey: "pageCount",
        header: "Pages",
        cell: ({ row }) => <NumberCell value={row.original.pageCount} />,
      },
      {
        accessorKey: "byteSize",
        header: "Size",
        cell: ({ row }) => <TextCell value={formatSize(row.original.byteSize)} />,
      },
      {
        accessorKey: "createdAt",
        header: "Processed",
        cell: ({ row }) => <DateTimeCell date={row.original.createdAt ?? null} />,
      },
    ],
    actions: (doc) => [
      {
        label: "Download",
        icon: Download,
        // Hidden rather than disabled when nothing was archived: storage is opt-in,
        // so on a deployment with it off the action would otherwise be dead on every row.
        hidden: !doc.storageKey,
        onClick: () => onDownload(doc),
      },
    ],
  });
}
