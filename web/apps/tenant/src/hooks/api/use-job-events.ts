"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { tenantKeys } from "./query-keys";

/**
 * Subscribes to the backend's job event stream and refreshes the jobs cache when
 * something moves.
 *
 * The stream carries *that* a job changed, not the job list itself — the event is a
 * cache invalidation, and `useTenantJobs` remains the one thing that knows the shape
 * of a job. Two records of the same thing would eventually disagree.
 *
 * Polling is not removed, only slowed (see `useTenantJobs`). `EventSource` reconnects
 * on its own, but the gap between a drop and the retry is invisible from here, so the
 * slow interval stays as the floor on staleness. Returns the connection state so the
 * caller can pick its interval and tell the user which mode it is in.
 */
export function useJobEvents(): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Same-origin: the stream goes through the BFF proxy like every other call, so
    // the session cookie rides along and the backend stays CORS-closed.
    const source = new EventSource("/api/tenant/jobs/stream");

    source.onopen = () => setConnected(true);

    // Fired on a drop *and* on each failed retry. EventSource handles the reconnect;
    // flipping the flag is what puts polling back to its faster cadence meanwhile.
    source.onerror = () => setConnected(false);

    source.addEventListener("job", () => {
      void queryClient.invalidateQueries({ queryKey: tenantKeys.jobs });
    });

    return () => source.close();
  }, [queryClient]);

  return { connected };
}
