"use client";

import { Check, Copy } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

import { humanizeFunctionKey, statusTone } from "@/config/columns/logs";
import { TenantRequestLog } from "@heirs/api-client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextLabel,
} from "@heirs/ui";

/** Where a tenant escalates a call they think went wrong. */
const SUPPORT_EMAIL = "support@heirstechnologies.com";

interface Props {
  log: TenantRequestLog;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

/** The request ID is the one value support asks for, so copying it is a button, not a selection. */
const RequestId = ({ requestId }: { requestId: string | null }) => {
  const [copied, setCopied] = useState(false);

  if (!requestId) return <span className="text-muted-foreground">—</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy it manually.");
    }
  };

  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-xs">{requestId}</span>
      <Button size="icon-xs" variant="ghost" onClick={copy} aria-label="Copy request ID">
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
    </span>
  );
};

/**
 * The full record behind one row of the logs table.
 *
 * Everything here is already in the table except the exact second, which is what makes
 * a report actionable — support matches on request ID first and timestamp second.
 */
export const ViewLog = ({ log, onOpenChange, open }: Props) => {
  /*
   * There is no report endpoint: a refused or wrong-looking call is a support
   * conversation, not a record we store. The mailto carries the identifying fields so
   * the tenant does not have to transcribe them, which is where they get mistyped.
   */
  const report = () => {
    const subject = `Request report: ${log.requestId ?? `${log.method} ${log.path}`}`;
    const body = [
      `Request ID: ${log.requestId ?? "(none recorded)"}`,
      `Time: ${format(new Date(log.createdAt), "dd/MM/yyyy, HH:mm:ss")}`,
      `Request: ${log.method} ${log.path}`,
      `Function: ${log.functionKey ? humanizeFunctionKey(log.functionKey) : "—"}`,
      `Status: ${log.statusCode}${log.errorCode ? ` (${log.errorCode})` : ""}`,
      `Duration: ${log.durationMs === null ? "—" : `${log.durationMs} ms`}`,
      "",
      "What I expected to happen:",
      "",
    ].join("\n");

    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-150">
        <DialogHeader>
          <DialogTitle>Request details</DialogTitle>
          <DialogDescription>What the API received and returned for this call.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-6">
          <TextLabel
            className="col-span-2"
            label="Request"
            value={
              <span className="font-mono text-xs">
                {log.method} {log.path}
              </span>
            }
          />
          <TextLabel label="When" value={format(new Date(log.createdAt), "dd/MM/yyyy, HH:mm:ss")} />
          <TextLabel label="Function" value={log.functionKey ? humanizeFunctionKey(log.functionKey) : "—"} />
          <TextLabel
            label="Status"
            value={
              <span className={`font-mono text-xs font-medium ${statusTone(log.statusCode)}`}>
                {log.statusCode}
                {log.errorCode && <span className="ml-2 font-normal text-muted-foreground">{log.errorCode}</span>}
              </span>
            }
          />
          <TextLabel label="Duration" value={log.durationMs === null ? "—" : `${log.durationMs} ms`} />
          <TextLabel className="col-span-2" label="Request ID" value={<RequestId requestId={log.requestId} />} />
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Close
          </Button>
          <Button onClick={report}>Report Request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
