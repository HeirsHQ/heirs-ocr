/**
 * Every React Query key used by the admin console, in one place.
 *
 * Two reasons this is a registry rather than a string literal at each call site:
 *
 *  1. **Invalidation is prefix-based.** `invalidateQueries({ queryKey: ["admin"] })`
 *     only reaches a query whose key actually *starts* with `["admin"]` — the
 *     console's session key was `["auth", "me"]`, outside that root, so the
 *     restore-backup handler's blanket invalidation quietly skipped it. Rooting
 *     everything here makes that class of miss impossible.
 *  2. **One mutation usually affects several screens.** Onboarding a tenant creates
 *     the tenant, seeds a portal user, and assigns a plan — three lists on three
 *     pages. The set of things a change touches belongs next to the keys rather than
 *     being rediscovered at each call site; see {@link adminInvalidations}.
 *
 * Keys are hierarchical, so a parent invalidates its children: invalidating
 * `tenants` covers the list, every detail page, and each tenant's nested users and
 * subscription.
 */

const root = ["admin"] as const;

export const adminKeys = {
  /** The whole console. Used on sign-out and after a configuration restore. */
  all: root,

  /** The signed-in operator. */
  me: [...root, "auth", "me"] as const,

  tenants: [...root, "tenants"] as const,
  tenantList: (params?: unknown) => [...root, "tenants", "list", params] as const,
  tenant: (id: string) => [...root, "tenants", "detail", id] as const,
  tenantUsers: (tenantId: string) => [...root, "tenants", tenantId, "users"] as const,
  tenantSubscription: (tenantId: string) => [...root, "tenants", tenantId, "subscription"] as const,

  plans: [...root, "plans"] as const,
  planList: (params?: unknown) => [...root, "plans", "list", params] as const,

  subscriptions: [...root, "subscriptions"] as const,
  subscriptionList: (params?: unknown) => [...root, "subscriptions", "list", params] as const,
  /** Estate-wide totals behind the stat tiles; sits under `subscriptions` so any
   *  change that invalidates the list refreshes the tiles with it. */
  subscriptionSummary: [...root, "subscriptions", "summary"] as const,

  admins: [...root, "admins"] as const,
  adminList: (params?: unknown) => [...root, "admins", "list", params] as const,

  /** Observability reads. These also poll, but a mutation should not wait for the tick. */
  health: [...root, "health"] as const,
  queue: [...root, "queue"] as const,
  metrics: [...root, "metrics"] as const,
  metricsTimeseries: (hours: number) => [...root, "metrics", "timeseries", hours] as const,
  usage: [...root, "usage"] as const,
  usageList: (params?: unknown) => [...root, "usage", "list", params] as const,
  usageByFunctionList: (params?: unknown) => [...root, "usage", "by-function", params] as const,
  functions: [...root, "functions"] as const,

  documents: [...root, "documents"] as const,

  audit: [...root, "audit"] as const,
  auditList: (filter?: unknown) => [...root, "audit", "list", filter] as const,

  logs: [...root, "logs"] as const,
  logList: (params?: unknown) => [...root, "logs", "list", params] as const,

  settings: [...root, "settings"] as const,
  settingsNamespace: (ns: string) => [...root, "settings", ns] as const,

  security: [...root, "security"] as const,
  /** Second-factor status for the signed-in operator. */
  mfa: [...root, "security", "mfa"] as const,
  /** Live sign-ins for the signed-in operator. */
  sessions: [...root, "security", "sessions"] as const,

  backups: [...root, "backups"] as const,
  backupList: (params?: unknown) => [...root, "backups", "list", params] as const,
} as const;

/**
 * What each kind of change makes stale.
 *
 * **Every entry includes `audit`.** The backend records an audit event for each
 * administrative mutation, so the audit trail is stale after all of them — it was
 * previously refreshed only by the retention sweep, which meant an operator watching
 * that page saw nothing until they reloaded.
 */
export const adminInvalidations = {
  /**
   * A tenant was created, edited, or revoked. The usage and metrics rollups are keyed
   * by tenant, so a list of them goes stale alongside the tenant list itself.
   */
  tenants: [adminKeys.tenants, adminKeys.usage, adminKeys.metrics, adminKeys.audit],

  /**
   * Full onboarding: tenant + seeded portal owner + assigned plan. Touches the tenant
   * list, that tenant's nested users and subscription, and the subscription estate.
   */
  onboard: [adminKeys.tenants, adminKeys.subscriptions, adminKeys.usage, adminKeys.metrics, adminKeys.audit],

  /**
   * A subscription was assigned. The tenant list renders the plan name, and the
   * subscriptions page aggregates the estate, so neither can be left alone.
   */
  subscription: [adminKeys.tenants, adminKeys.subscriptions, adminKeys.audit],

  /**
   * The plan catalog changed. The subscriptions page reads the catalog to render and
   * to offer assignable plans, so it is stale even though no subscription moved.
   */
  plans: [adminKeys.plans, adminKeys.subscriptions, adminKeys.audit],

  /** Console operators changed. */
  admins: [adminKeys.admins, adminKeys.audit],

  /** A platform settings namespace was saved. */
  settings: [adminKeys.settings, adminKeys.audit],

  /** Security policy saved. Also re-reads the live posture the same endpoint returns. */
  security: [adminKeys.security, adminKeys.audit],

  /** Second-factor state for the signed-in operator changed. */
  mfa: [adminKeys.mfa, adminKeys.me],

  /** A configuration backup was taken. */
  backups: [adminKeys.backups, adminKeys.audit],

  /**
   * The retention sweep ran. It deletes document records *and* audit events, so both
   * of those move — and the sweep itself is recorded as an audit event.
   */
  retention: [adminKeys.documents, adminKeys.audit],
} satisfies Record<string, readonly (readonly unknown[])[]>;

/**
 * Invalidates several key prefixes at once.
 *
 * Returns the combined promise so a caller that needs the refetch to have landed
 * (a redirect, a toast that reports counts) can await it; mutation `onSuccess`
 * handlers normally just let it run.
 */
export const invalidate = (
  qc: import("@tanstack/react-query").QueryClient,
  keys: readonly (readonly unknown[])[],
): Promise<unknown> => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
