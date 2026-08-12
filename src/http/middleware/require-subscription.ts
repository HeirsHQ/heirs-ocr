import type { NextFunction, Request, Response } from "express";

import type { OcrFunctionKey, Sensitivity } from "../../functions/define";
import type { EntitlementDenialCode, Subscription } from "../../types/subscription";
import {
  canUseFunction,
  checkDocumentQuota,
  effectiveRateLimitPerMinute,
  requireActive,
} from "../../billing/entitlements";
import { resolveSubscription } from "../../billing/subscriptions";
import { getFunction } from "../../functions/registry";
import { OcrError, type OcrErrorCode } from "../errors";

/**
 * Subscription enforcement (runs after `authorizeFunction`, before `rateLimit`).
 * Loads the tenant's subscription, then gates the request on plan status,
 * entitlement, sensitivity ceiling, and document quota. Also publishes the plan's
 * effective per-minute rate ceiling onto `req.rateLimitMax` for the rate limiter.
 *
 * Backward-compatible: a tenant with **no subscription row** (or a briefly
 * unreachable billing store) is treated as unlimited — nothing is gated. Only an
 * explicit subscription imposes limits.
 */

/** Billing denial codes → HTTP error codes. */
const CODE_MAP: Record<EntitlementDenialCode, OcrErrorCode> = {
  SUBSCRIPTION_INACTIVE: "PAYMENT_REQUIRED",
  NOT_ENTITLED: "FORBIDDEN",
  SENSITIVITY_BLOCKED: "FORBIDDEN",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
};

/**
 * Pure gate: runs every subscription check for a function and returns the first
 * failure as an {@link OcrError}, or `null` if the request is allowed. Exposed
 * separately so it can be unit-tested without Express or a database.
 */
export const evaluateSubscription = (
  sub: Subscription,
  fnKey: string,
  sensitivity: Sensitivity,
  now: Date = new Date(),
): OcrError | null => {
  const decisions = [
    requireActive(sub, now),
    canUseFunction(sub, fnKey as OcrFunctionKey, { sensitivity }),
    checkDocumentQuota(sub, now),
  ];
  for (const decision of decisions) {
    if (!decision.allowed) {
      return new OcrError(CODE_MAP[decision.code], decision.reason, {
        retryable: decision.code === "QUOTA_EXCEEDED",
      });
    }
  }
  return null;
};

export const requireSubscription = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.tenantId) {
      next();
      return;
    }
    const sub = await resolveSubscription(req.tenantId);
    if (!sub) {
      next(); // no subscription = unlimited (backward-compatible)
      return;
    }
    req.subscription = sub;
    req.rateLimitMax = effectiveRateLimitPerMinute(sub) ?? req.rateLimitMax;

    const fnKey = String(req.params.function ?? "");
    const sensitivity = getFunction(fnKey)?.sensitivity ?? "standard";
    const err = evaluateSubscription(sub, fnKey, sensitivity);
    if (err) {
      next(err);
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};
