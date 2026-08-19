import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { logger } from "./observability/logger";
import { env } from "./config/env";

/**
 * Shared Postgres pool for the durable stores — tenants, admins, and per-tenant
 * usage (see src/auth/tenants.ts, src/auth/admins.ts, src/observability/usage.ts).
 * Redis still backs the ephemeral/infrastructure concerns (BullMQ queue, rate
 * limiter, extraction cache, sessions); this is only the data that must survive a
 * restart and be backed up.
 *
 * A single lazily-created pool is reused process-wide. `connectionTimeoutMillis`
 * keeps a call from hanging when Postgres is unreachable — the auth path turns a
 * failure into a fail-closed rejection, while usage/cache callers degrade. The
 * `error` handler prevents an unhandled-error crash on an idle-client drop.
 */
let pool: Pool | undefined;

export const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
    });
    pool.on("error", (err) => logger.warn("postgres pool error", { err: err.message }));
  }
  return pool;
};

/**
 * Convenience wrapper over the shared pool. `T` is the row shape; callers pass a
 * parameterized statement (`$1`, `$2`, …) — never interpolate values into SQL.
 */
export const query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> => getPool().query<T>(text, params as never);

/**
 * Idempotent schema bootstrap. Runs `CREATE TABLE IF NOT EXISTS` for the durable
 * tables so a fresh deploy is usable without an out-of-band migration
 * step — the same "seed on boot" ethos as {@link ensureBootstrapAdmin}. Called
 * from both entrypoints (web + worker) and the provisioning CLIs. When the schema
 * outgrows this, swap it for a real migration runner; the call sites stay.
 */
export const ensureSchema = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS tenants (
      key_hash           text PRIMARY KEY,
      tenant_id          text NOT NULL,
      name               text,
      disabled           boolean NOT NULL DEFAULT false,
      rate_limit         integer,
      allowed_origins    jsonb,
      allowed_functions  jsonb,
      expires_at         timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS expires_at timestamptz;

    CREATE TABLE IF NOT EXISTS admins (
      id             uuid PRIMARY KEY,
      email          text NOT NULL UNIQUE,
      name           text NOT NULL,
      role           text NOT NULL,
      password_hash  text NOT NULL,
      disabled       boolean NOT NULL DEFAULT false,
      created_at     timestamptz NOT NULL,
      updated_at     timestamptz NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenant_users (
      id             uuid PRIMARY KEY,
      tenant_id      text NOT NULL,
      email          text NOT NULL UNIQUE,
      name           text NOT NULL,
      role           text NOT NULL,
      password_hash  text NOT NULL,
      disabled       boolean NOT NULL DEFAULT false,
      created_at     timestamptz NOT NULL,
      updated_at     timestamptz NOT NULL
    );

    CREATE INDEX IF NOT EXISTS tenant_users_tenant_id_idx ON tenant_users (tenant_id);

    -- Second factor for both login surfaces (src/auth/mfa.ts). Added by ALTER so an
    -- existing deployment picks them up on the next boot without a migration step.
    -- \`mfa_secret\` is present-but-unconfirmed during enrolment; \`mfa_last_counter\`
    -- pins the last TOTP step consumed so a code can't be replayed inside its window;
    -- \`mfa_recovery_codes\` holds sha256 hashes of the single-use fallback codes.
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS mfa_secret text;
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS mfa_last_counter bigint;
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS mfa_recovery_codes jsonb;

    ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS mfa_secret text;
    ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
    ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS mfa_last_counter bigint;
    ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS mfa_recovery_codes jsonb;

    CREATE TABLE IF NOT EXISTS tenant_usage (
      tenant_id  text PRIMARY KEY,
      requests   bigint NOT NULL DEFAULT 0,
      errors     bigint NOT NULL DEFAULT 0,
      tokens     bigint NOT NULL DEFAULT 0
    );

    -- Per-function rollup behind the admin console's analytics page. Written by
    -- *both* processes (web + worker), so unlike the in-process Prometheus registry
    -- it survives a restart and includes queued jobs. Deliberately unlabelled by
    -- tenant: that lives in tenant_usage, and crossing the two here would make the
    -- row count grow with tenants x functions.
    CREATE TABLE IF NOT EXISTS function_usage (
      function_key             text PRIMARY KEY,
      requests                 bigint NOT NULL DEFAULT 0,
      errors                   bigint NOT NULL DEFAULT 0,
      tokens                   bigint NOT NULL DEFAULT 0,
      confidence_observations  bigint NOT NULL DEFAULT 0,
      low_confidence           bigint NOT NULL DEFAULT 0,
      fallbacks                bigint NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      tenant_id   text PRIMARY KEY,
      plan_id     text NOT NULL,
      status      text NOT NULL,
      data        jsonb NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plans (
      id          text PRIMARY KEY,
      tier        text NOT NULL,
      hidden      boolean NOT NULL DEFAULT false,
      data        jsonb NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    -- Per-tenant API request history, behind the portal's Logs page
    -- (src/observability/request-log.ts). This is the HTTP-level view: every call the
    -- org made, including the ones that never became documents — quota denials, rate
    -- limits, unsupported media. Deliberately distinct from the platform log ring
    -- buffer, which is operator-facing and spans all tenants.
    --
    -- Records no request or response body: the path, the outcome, and how long it
    -- took. Swept on the document retention window.
    CREATE TABLE IF NOT EXISTS request_logs (
      id            uuid PRIMARY KEY,
      tenant_id     text NOT NULL,
      request_id    text,
      method        text NOT NULL,
      path          text NOT NULL,
      function_key  text,
      status_code   integer NOT NULL,
      error_code    text,
      duration_ms   integer,
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS request_logs_tenant_idx ON request_logs (tenant_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS request_logs_created_at_idx ON request_logs (created_at);

    -- Tenant-registered webhook endpoints (src/webhooks/store.ts). The signing secret
    -- is stored in the clear because HMAC signing needs the original bytes to sign
    -- with — unlike an API key, it is a shared secret rather than a credential we
    -- only ever verify. It is returned to the tenant once at creation and on rotate.
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id           uuid PRIMARY KEY,
      tenant_id    text NOT NULL,
      url          text NOT NULL,
      secret       text NOT NULL,
      description  text,
      events       jsonb NOT NULL DEFAULT '[]'::jsonb,
      enabled      boolean NOT NULL DEFAULT true,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS webhook_endpoints_tenant_idx ON webhook_endpoints (tenant_id, created_at DESC);

    -- Delivery outbox *and* delivery log — deliberately one table. The retry state a
    -- worker needs (attempts, next_attempt_at) is the same state the tenant's
    -- deliveries page displays, so splitting a queue from a log would mean keeping two
    -- copies of it in step. The status column drives the sweep: pending -> succeeded | dead.
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id               uuid PRIMARY KEY,
      endpoint_id      uuid NOT NULL,
      tenant_id        text NOT NULL,
      event            text NOT NULL,
      payload          jsonb NOT NULL,
      status           text NOT NULL DEFAULT 'pending',
      attempts         integer NOT NULL DEFAULT 0,
      response_status  integer,
      last_error       text,
      next_attempt_at  timestamptz NOT NULL DEFAULT now(),
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );

    -- Serves the worker's "what is due?" scan.
    CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
      ON webhook_deliveries (status, next_attempt_at);
    -- Serves the tenant's deliveries page.
    CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_idx
      ON webhook_deliveries (tenant_id, created_at DESC, id DESC);

    -- Per-organisation settings (src/config/tenant-settings.ts). Separate from
    -- platform_settings because the access rules differ in kind: a tenant owner edits
    -- their own row and must never see another's.
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id   text PRIMARY KEY,
      data        jsonb NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      namespace   text PRIMARY KEY,
      data        jsonb NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id          uuid PRIMARY KEY,
      action      text NOT NULL,
      actor       text NOT NULL,
      target      text,
      metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    -- Human-readable names for the actor and the target, snapshotted at record time.
    -- Stored rather than joined on read for two reasons: the row must survive the
    -- thing it names being deleted (that is often the event), and it must show the
    -- name as it was then, not as it is now after a rename.
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_label text;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS target_label text;

    CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC);

    -- Per-document processing record behind the tenant portal's document list and
    -- reports (src/observability/documents.ts). **Metadata only** — no file bytes and
    -- no extracted text ever land here, and functions classified pii/restricted
    -- are not recorded at all (the filename alone leaks, e.g. "jane-passport.pdf").
    -- Subject to the retention sweep, so unlike audit_events it does not grow forever.
    CREATE TABLE IF NOT EXISTS documents (
      id            uuid PRIMARY KEY,
      tenant_id     text NOT NULL,
      function_key  text NOT NULL,
      file_name     text NOT NULL,
      byte_size     bigint NOT NULL DEFAULT 0,
      page_count    integer NOT NULL DEFAULT 0,
      outcome       text NOT NULL,
      provider      text,
      tokens_used   bigint,
      duration_ms   integer,
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    -- Object-storage key for the archived source file, when blob storage is enabled
    -- (src/storage/blob.ts). NULL means the bytes were never kept — storage off, or
    -- the upload failed — so the row lists normally but has nothing to download.
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_key text;

    -- Serves the portal's list (one tenant, newest first) directly from the index.
    CREATE INDEX IF NOT EXISTS documents_tenant_created_idx ON documents (tenant_id, created_at DESC, id DESC);
    -- Serves the retention sweep, which scans by age across all tenants.
    CREATE INDEX IF NOT EXISTS documents_created_at_idx ON documents (created_at);

    CREATE TABLE IF NOT EXISTS backups (
      id          uuid PRIMARY KEY,
      created_by  text NOT NULL,
      note        text,
      counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
      size_bytes  integer NOT NULL DEFAULT 0,
      data        jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
};

/**
 * Resolves once the pool can serve a query (`SELECT 1`). Short-lived processes
 * (the provisioning CLIs, boot-time bootstrap) call this so their first real
 * statement doesn't race a cold pool against a remote/TLS Postgres. Rejects on
 * timeout so a CLI fails fast rather than hanging.
 */
export const whenDbReady = async (timeoutMs = env.DB_CONNECT_TIMEOUT_MS): Promise<void> => {
  let client: PoolClient | undefined;
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Postgres not ready after ${timeoutMs}ms`)), timeoutMs).unref(),
  );
  try {
    client = await Promise.race([getPool().connect(), timer]);
    await Promise.race([client.query("SELECT 1"), timer]);
  } finally {
    client?.release();
  }
};

/**
 * Closes the shared pool on graceful shutdown; a no-op if it was never created.
 * Safe to call more than once.
 */
export const closeDb = async (): Promise<void> => {
  if (!pool) return;
  const closing = pool;
  pool = undefined;
  await closing.end();
};
