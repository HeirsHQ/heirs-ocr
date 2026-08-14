"use client";

import { useEffect } from "react";

import { Button } from "@heirs/ui";

/**
 * Route-segment error boundary for the portal. Without one, any render-time throw
 * inside `(tenant)` unmounts the tree and leaves a blank page with no way back —
 * the failure mode that made an unhandled async-job response look like the app
 * had died.
 */
const Error = ({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) => {
  useEffect(() => {
    console.error("[tenant] unhandled render error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="space-y-1.5">
        <p className="text-lg font-medium">Something went wrong on this page.</p>
        <p className="text-sm text-muted-foreground">
          The error has been logged. Try again, and if it keeps happening quote this reference to support.
        </p>
        {error.digest && <p className="font-mono text-xs text-muted-foreground">{error.digest}</p>}
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
};

export default Error;
