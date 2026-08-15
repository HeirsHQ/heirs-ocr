"use client";

import { format } from "date-fns";

import { StatusCell } from "@/config/columns/core";
import { LogEntry } from "@/types/admin-console";
import { Button, capitalizeWords } from "@heirs/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  fromCamelCase,
  TextLabel,
} from "@heirs/ui";

interface Props {
  log: LogEntry;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export const ViewLog = ({ log, onOpenChange, open }: Props) => {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>View Log Entry</DialogTitle>
          <DialogDescription></DialogDescription>
          <div className="grid grid-cols-2 gap-6">
            <TextLabel label="Time" value={format(log.time, "MMM d, yyyy HH:mm:ss")} />
            <TextLabel
              label="Level"
              value={
                <StatusCell
                  status={log.level}
                  config={{ debug: "neutral", error: "danger", info: "info", warn: "amber" }}
                />
              }
            />
            <TextLabel label="Message" value={log.msg} />
            {log.fields &&
              Object.entries(log.fields).map(([key, value]) => (
                <TextLabel key={key} label={capitalizeWords(fromCamelCase(key))} value={value as string} />
              ))}
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
