"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, cn } from "@heirs/ui";

/**
 * A copyable snippet.
 *
 * Every block on the API reference is something a developer is meant to paste, so
 * copying is the primary action rather than an afterthought — selecting wrapped shell
 * commands by hand is exactly where people lose a trailing character.
 */
export const CodeBlock = ({
  code,
  language,
  className,
}: {
  code: string;
  /** Shown as a label in the corner; purely informational, no highlighting. */
  language?: string;
  className?: string;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy it manually.");
    }
  };

  return (
    <div className={cn("group relative", className)}>
      {language && (
        <span className="absolute left-3 top-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {language}
        </span>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={copy}
        aria-label="Copy to clipboard"
        className="absolute right-2 top-1.5"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </Button>
      <pre
        className={cn(
          "overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed",
          language && "pt-7",
        )}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
};
