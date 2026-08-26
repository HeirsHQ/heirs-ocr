import type { NextFunction, Request, Response } from "express";

import { tenantHasFeature } from "../../billing/feature-access";
import type { Feature } from "../../types/subscription";
import { logger } from "../../observability/logger";

/**
 * Plan gate for tenant-portal routes — the capability twin of `requireTenantRole`.
 * Role answers "may this person do it?"; this answers "does this org's plan include
 * it at all?". Both have to pass.
 *
 * Assumes {@link import("./tenant-auth").tenantAuth} ran first, so the tenant comes
 * from the session rather than anything the caller sent.
 *
 * Fails **closed** on a billing-store fault, matching `requireSubscription`: 503
 * rather than waiving the gate. Serving through a billing outage would ungate every
 * tenant at once, which is the failure you find out about from a customer.
 */
export const requireTenantFeature =
  (feature: Feature) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantId = req.tenantUser?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Not signed in" } });
      return;
    }

    try {
      if (!(await tenantHasFeature(tenantId, feature))) {
        res.status(403).json({
          error: { code: "NOT_ENTITLED", message: `Your plan does not include '${feature}'.` },
        });
        return;
      }
      next();
    } catch (err) {
      logger.warn("tenant feature gate unavailable", {
        tenantId,
        feature,
        err: err instanceof Error ? err.message : String(err),
      });
      res.status(503).json({ error: { code: "PROVIDER_UNAVAILABLE", message: "Billing store unavailable" } });
    }
  };
