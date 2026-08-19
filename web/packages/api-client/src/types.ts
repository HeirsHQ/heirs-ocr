/**
 * The envelope every list endpoint on the OCR service returns. Mirrors
 * `src/http/pagination.ts` on the backend — keep the two in step.
 *
 * `totalPages` comes from the server rather than being derived here so the client
 * can never disagree with it about the divide (and so a page component does not
 * have to know the page size to render "page 2 of 7").
 */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Query params accepted by any paginated list endpoint. Both are optional: omitting
 * them yields the server's first page at its default size.
 */
// A type alias, not an interface: only aliases get an implicit index signature, and
// these get handed straight to `http.get(url, params)` as `Record<string, unknown>`.
export type PaginatedParams = {
  page?: number;
  pageSize?: number;
};

/**
 * The largest page the API will serve (mirrors `MAX_PAGE_SIZE` in
 * `src/http/pagination.ts`). Pass it when a view genuinely needs the whole
 * collection — a `<Select>` of every plan, or a summary computed over all rows —
 * so the truncation is deliberate and visible rather than a silent first page.
 */
export const MAX_PAGE_SIZE = 200;

/** An empty page, for rendering before the first response lands. */
export const emptyPage = <T>(pageSize = 25): Paginated<T> => ({
  items: [],
  page: 1,
  pageSize,
  total: 0,
  totalPages: 1,
});

/**
 * MFA state for the signed-in user, from `GET /security/mfa` on either surface.
 * Mirrors `MfaStatus` in `src/auth/mfa.ts`.
 */
export interface MfaStatus {
  enabled: boolean;
  /** A secret exists but the confirming code hasn't been supplied yet. */
  pending: boolean;
  recoveryCodesRemaining: number;
}

/** The pending enrolment from `POST /security/mfa` — the secret and its QR payload. */
export interface MfaEnrolment {
  secret: string;
  otpauthUri: string;
}

/** `POST /security/mfa/verify`. The codes are returned once and stored only as hashes. */
export interface MfaConfirmation {
  enabled: true;
  recoveryCodes: string[];
}

/**
 * What a login POST resolves to when the account has a second factor: no session
 * cookie yet, just a short-lived handle to redeem with a code at `/login/mfa`.
 * Login responses are `Session | MfaChallengeRequired` — narrow with
 * {@link isMfaChallenge} before assuming a session came back.
 */
export interface MfaChallengeRequired {
  mfaRequired: true;
  challenge: string;
}

/** Narrows a login response to the "second factor still needed" branch. */
export const isMfaChallenge = <T extends object>(result: T | MfaChallengeRequired): result is MfaChallengeRequired =>
  "mfaRequired" in result && result.mfaRequired === true;

/**
 * One processed document, from the document registry. Mirrors `DocumentRecord` in
 * `src/observability/documents.ts`.
 *
 * Metadata only — the service never stores file bytes or extracted text. Documents
 * run through `pii`/`restricted` functions are not recorded at all, so this list is
 * deliberately not a complete account of everything a tenant submitted.
 */
export interface ProcessedDocument {
  id: string;
  tenantId: string;
  functionKey: string;
  fileName: string;
  byteSize: number;
  pageCount: number;
  outcome: "success" | "error";
  provider: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  createdAt: string;
  /** Object-storage key for the archived file; `null` when the bytes were not kept. */
  storageKey: string | null;
}

/** The aggregated view behind the portal's reports page. */
export interface DocumentReport {
  totals: { documents: number; pages: number; errors: number; bytes: number };
  byFunction: { functionKey: string; documents: number; pages: number; errors: number }[];
  daily: { date: string; documents: number; errors: number }[];
  windowDays: number;
  /** Why the history stops where it does — so a trimmed window doesn't read as data loss. */
  retention: { enabled: boolean; documentRetentionDays: number };
}

/** Platform-wide retention policy (admin-editable, tenant-visible). */
export interface RetentionSettings {
  enabled: boolean;
  documentRetentionDays: number;
  auditRetentionDays: number;
}

/** Lifecycle of an async OCR job. Mirrors `JobStatus` in `src/jobs/queue.ts`. */
export type OcrJobStatus = "queued" | "active" | "completed" | "failed";

/**
 * One async OCR job, from `GET /tenant/api/jobs`.
 *
 * The list endpoint omits `result` — a page of completed jobs would otherwise carry
 * a full OCR payload each. Fetch the job by id when the result itself is needed.
 * Timestamps are epoch ms; `startedAt`/`finishedAt` are absent while the job is
 * still waiting or still running.
 */
export interface OcrJob {
  jobId: string;
  status: OcrJobStatus;
  tenantId?: string;
  function?: string;
  meta?: { provider?: string; pageCount?: number; durationMs?: number; tokensUsed?: number };
  error?: { code: string; message: string };
  createdAt?: number;
  startedAt?: number;
  finishedAt?: number;
  /** Deliveries so far; above 1 means the job was retried or redelivered. */
  attempts?: number;
}

/**
 * Estate-wide subscription totals for the console's stat tiles. Mirrors
 * `SubscriptionSummary` in `src/billing/subscriptions.ts`.
 *
 * Fetched separately from the paginated list so the tiles describe the whole estate
 * while the table below them shows one page.
 */
export interface SubscriptionSummary {
  total: number;
  serving: number;
  attention: number;
  byStatus: Record<string, number>;
  /** Grouped by currency — summing across currencies would be meaningless. */
  accruedByCurrency: { currency: string; amountMinor: number }[];
}

/**
 * One live sign-in, from `GET /security/sessions` on either surface. Mirrors
 * `SessionView` in `src/auth/session-store.ts`.
 *
 * `id` is a short non-secret prefix of the token — enough to tell two rows apart and
 * useless for authenticating. The token itself is never sent to the browser.
 */
export interface ActiveSession {
  id: string;
  /** Epoch ms. */
  createdAt: number;
  ip?: string;
  userAgent?: string;
  /** The session making the request; the UI marks it and never revokes it. */
  current: boolean;
}

/** A tenant's own security settings, from `GET /tenant/api/security/ip-allowlist`. */
export interface TenantIpAllowlist {
  /** Off by default — an allowlist is a lockout risk, so it is opt-in. */
  ipAllowlistEnabled: boolean;
  /** Bare addresses or CIDR ranges. Empty allows everything. */
  ipAllowlist: string[];
}

/** Events a webhook endpoint can subscribe to. Mirrors `WEBHOOK_EVENTS`. */
export type WebhookEventName = "document.processed" | "document.failed";

/**
 * A registered webhook endpoint. The signing secret is **not** part of this shape —
 * it is returned only by create and rotate, and is unrecoverable afterwards.
 */
export interface WebhookEndpoint {
  id: string;
  tenantId: string;
  url: string;
  description: string | null;
  events: WebhookEventName[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Create/rotate responses, which carry the secret exactly once. */
export type WebhookEndpointWithSecret = WebhookEndpoint & { secret: string };

/** One delivery attempt record, from `GET /tenant/api/webhooks/deliveries`. */
export interface WebhookDelivery {
  id: string;
  endpointId: string;
  tenantId: string;
  event: string;
  /** `pending` is still being retried; `dead` gave up after the attempt ceiling. */
  status: "pending" | "succeeded" | "dead";
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One API call the tenant made, from `GET /tenant/api/logs`.
 *
 * The HTTP-level view — it includes calls that never became documents (quota
 * denials, rate limits, unsupported media), which is what makes it useful for
 * debugging an integration. No request or response body is recorded.
 */
export interface TenantRequestLog {
  id: string;
  tenantId: string;
  requestId: string | null;
  method: string;
  path: string;
  functionKey: string | null;
  statusCode: number;
  errorCode: string | null;
  durationMs: number | null;
  createdAt: string;
}

/**
 * What a tenant data export would contain, from `GET /tenant/api/backup`.
 *
 * `excluded` is served by the API rather than hardcoded in the UI: what is left out
 * is a property of how the data is stored, and the two must not be able to drift.
 */
export interface TenantExportSummary {
  counts: { documents: number; keys: number; team: number };
  excluded: string[];
}

/** The export itself, from `GET /tenant/api/backup/export`. */
export interface TenantExport extends TenantExportSummary {
  version: number;
  tenantId: string;
  generatedAt: string;
  /** True when the document history was cut at the export cap. */
  truncated: boolean;
  documents: unknown[];
  keys: unknown[];
  team: unknown[];
}
