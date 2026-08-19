"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import Prism from "prismjs";

/*
 * Prism's core already carries markup, css, clike and javascript; every other
 * grammar is imported by hand so the bundle holds only what the docs render.
 * Order matters — each file attaches itself to the Prism instance the core
 * import created, and php reads its placeholders from markup-templating.
 */
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-go";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-java";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-rust";

import { Button, cn } from "@heirs/ui";

/**
 * A copyable, syntax-highlighted snippet.
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
  /** Prism grammar id (`typescript`, `bash`, …). Doubles as the corner label. */
  language: string;
  className?: string;
}) => {
  const [copied, setCopied] = useState(false);

  // Null for a grammar Prism doesn't know: highlight() throws on an undefined
  // grammar, and a snippet nobody can read is worse than an unpainted one.
  const highlighted = useMemo(() => {
    const grammar = Prism.languages[language];
    return grammar ? Prism.highlight(code, grammar, language) : null;
  }, [code, language]);

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
        {highlighted === null ? (
          <code>{code}</code>
        ) : (
          // Prism escapes every character it did not emit itself, so this markup is
          // its own <span> scaffolding wrapped around escaped source text.
          <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
        )}
      </pre>
    </div>
  );
};
