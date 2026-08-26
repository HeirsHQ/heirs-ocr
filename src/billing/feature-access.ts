import type { Feature } from "../types/subscription";
import { resolveSubscription } from "./subscriptions";
import { hasFeature } from "./entitlements";

/**
 * Plan feature lookup for callers that have a `tenantId` rather than a resolved
 * {@link import("../types/subscription").Subscription}.
 *
 * `hasFeature` in ./entitlements is pure and takes a subscription; the enforcement
 * points for boolean capabilities (the tenant portal, webhook dispatch) start from an
 * id instead, and were each about to grow their own copy of the resolve-then-check
 * dance. One copy, one set of edge cases.
 *
 * **No subscription row means unlimited**, matching `requireSubscription`
 * (src/http/middleware/require-subscription.ts). Every tenant predating the billing
 * system has no row, and treating that as "no features" would revoke capabilities
 * from tenants who never subscribed to anything.
 *
 * A store *error* is not that, and is not swallowed here — it propagates, so each
 * caller decides how to fail. Collapsing "no row" and "cannot read the row" would
 * turn a Postgres blip into either a fleet-wide bypass or a fleet-wide outage,
 * depending which way it was collapsed.
 */
export const tenantHasFeature = async (tenantId: string, feature: Feature): Promise<boolean> => {
  const subscription = await resolveSubscription(tenantId);
  if (!subscription) return true;
  return hasFeature(subscription, feature);
};
