import "dotenv/config";

import { generateApiKey, putTenant, revokeApiKey, type Tenant } from "../auth/tenants";
import { getRedis } from "../redis";

/**
 * Database-free tenant provisioning CLI. Writes tenants into the Redis-backed
 * registry (see src/auth/tenants.ts) — no schema, no admin service.
 *
 *   ts-node src/scripts/provision-tenant.ts create <tenantId> [--rate N] [--origins a,b]
 *   ts-node src/scripts/provision-tenant.ts revoke <apiKey>
 *
 * `create` prints the raw API key **once** — it is never stored (only its
 * sha256 is), so copy it now; it cannot be recovered.
 */
const usage = () => {
  console.error(
    [
      "Usage:",
      "  provision-tenant create <tenantId> [--rate <perWindow>] [--functions <A,B>] [--origins <a,b,c>] [--name <name>]",
      "  provision-tenant revoke <apiKey>",
    ].join("\n"),
  );
};

const getFlag = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const main = async (): Promise<number> => {
  const [command, positional, ...rest] = process.argv.slice(2);

  if (command === "create") {
    if (!positional) {
      usage();
      return 1;
    }
    const rate = getFlag(rest, "--rate");
    const origins = getFlag(rest, "--origins");
    const functions = getFlag(rest, "--functions");
    const csv = (v: string | undefined): string[] | undefined =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    const tenant: Tenant = {
      tenantId: positional,
      name: getFlag(rest, "--name"),
      rateLimit: rate ? Number(rate) : undefined,
      allowedOrigins: csv(origins),
      allowedFunctions: csv(functions),
      createdAt: new Date().toISOString(),
    };

    const apiKey = generateApiKey();
    await putTenant(apiKey, tenant);

    console.log(`\n✅ Provisioned tenant '${tenant.tenantId}'.`);
    console.log(`\n   API key (shown once — store it now):\n\n   ${apiKey}\n`);
    console.log("   Send it as:  Authorization: Bearer <key>\n");
    return 0;
  }

  if (command === "revoke") {
    if (!positional) {
      usage();
      return 1;
    }
    const removed = await revokeApiKey(positional);
    console.log(removed > 0 ? "✅ Key revoked." : "⚠️  Key not found (already revoked?).");
    return 0;
  }

  usage();
  return 1;
};

main()
  .then((code) => {
    getRedis().disconnect();
    process.exit(code);
  })
  .catch((err) => {
    console.error("provision-tenant failed:", err instanceof Error ? err.message : err);
    getRedis().disconnect();
    process.exit(1);
  });
