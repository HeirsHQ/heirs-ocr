import { getSettings } from "../config/settings-store";

/**
 * The platform's password rules, applied wherever a password is set.
 *
 * `passwordMinLength` lived in the security settings namespace and was enforced
 * nowhere — displayed on the console's policy panel and ignored by every path that
 * actually set a password. A control that exists only on its own settings page is
 * worse than no control, because it reads as protection that isn't there.
 *
 * Deliberately only a *minimum length*. Composition rules (a digit, a symbol, mixed
 * case) push people toward predictable substitutions and shorter passwords overall;
 * length is the requirement that actually correlates with strength, and it is the one
 * the settings schema exposes.
 */

/** Absolute floor, regardless of what the setting says. */
const HARD_MINIMUM = 8;
/**
 * Upper bound. argon2 hashes whatever it is given, but an unbounded field is a free
 * way to make every login do more work than it needs to.
 */
const MAXIMUM = 200;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

/**
 * Throws {@link PasswordPolicyError} when `password` fails the current policy.
 *
 * Reads the setting on each call rather than caching it: raising the minimum should
 * apply to the next password set, not from the next deploy. A settings-store outage
 * falls back to the hard minimum instead of failing the change — refusing every
 * password reset because a settings read blipped would be the worse outcome.
 */
export const assertPasswordPolicy = async (password: string): Promise<void> => {
  let minimum = HARD_MINIMUM;
  try {
    const security = await getSettings("security");
    minimum = Math.max(HARD_MINIMUM, security.passwordMinLength);
  } catch {
    // Fall through on the hard minimum.
  }

  if (password.length < minimum) {
    throw new PasswordPolicyError(`Password must be at least ${minimum} characters`);
  }
  if (password.length > MAXIMUM) {
    throw new PasswordPolicyError(`Password must be at most ${MAXIMUM} characters`);
  }
};
