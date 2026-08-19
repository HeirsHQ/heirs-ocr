"use client";

import { format, formatDistanceToNow } from "date-fns";

import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextLabel,
} from "@heirs/ui";
import { chipTone } from "@/config/columns/audit-log";
import { AuditEvent } from "@/types/admin-console";

interface Props {
  event: AuditEvent;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

/**
 * One identity — the readable name over the raw id.
 *
 * Both are shown because they answer different questions: the name is what a person
 * scans for, the id is what they paste into the actor filter or quote to support.
 * The name is snapshotted at write time, so it can legitimately be absent on older
 * rows — in that case the id stands alone rather than sitting under a dash.
 */
const Identity = ({ label, id }: { label: string | null; id: string | null }) => {
  if (!id && !label) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {label && <span className="block">{label}</span>}
      {id && (
        <span className={cn("block font-mono text-xs text-muted-foreground", !label && "text-foreground")}>{id}</span>
      )}
    </>
  );
};

export const ViewAuditEvent = ({ event, onOpenChange, open }: Props) => {
  const at = new Date(event.createdAt);
  const hasMetadata = Object.keys(event.metadata ?? {}).length > 0;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          {/* The sentence, not the key — the key is shown below as data. */}
          <DialogTitle>{event.actionLabel}</DialogTitle>
          <DialogDescription>
            {format(at, "d MMM yyyy, HH:mm:ss")} · {formatDistanceToNow(at, { addSuffix: true })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextLabel
              label="Action"
              value={
                <span
                  className={cn("inline-block rounded-full px-2 py-0.5 font-mono text-[11px]", chipTone(event.action))}
                >
                  {event.action}
                </span>
              }
            />
            <TextLabel label="Event ID" value={<span className="font-mono text-xs">{event.id}</span>} />
            <TextLabel label="Actor" value={<Identity label={event.actorLabel} id={event.actor} />} />
            <TextLabel label="Target" value={<Identity label={event.targetLabel} id={event.target} />} />
          </div>

          {/* Most events carry none; an empty block would be worse than no block. */}
          {hasMetadata && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Metadata</p>
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
