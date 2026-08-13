"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "../ui/button";

/** One-time reveal of a freshly minted secret (API key) — never retrievable again. */
export const SecretCallout = ({
  value,
  title = "Copy this secret now",
  note = "Shown once — only a hash is stored. Store it somewhere safe.",
  onDismiss,
}: {
  value: string;
  title?: string;
  note?: string;
  onDismiss?: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy it manually.");
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">{value}</code>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        {onDismiss && (
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
};
