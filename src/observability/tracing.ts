/**
 * Tracing seam. `pii` functions must disable response-body capture here
 * — the sensitivity middleware is responsible for calling
 * `withSpan` with `captureResult: false`.
 */
export type SpanOptions = {
  attributes?: Record<string, string | number | boolean>;
  captureResult?: boolean;
};

/** Runs `fn` inside a named span. Currently a pass-through; wire to OTel later. */
export const withSpan = async <T>(_name: string, fn: () => Promise<T>, _opts?: SpanOptions): Promise<T> => {
  // TODO: start an OpenTelemetry span, set attributes, record status/duration.
  return fn();
};
