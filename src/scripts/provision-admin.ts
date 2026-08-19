import "dotenv/config";

import { createAdmin, deleteAdmin, getAdminByEmail, listAdmins } from "../auth/admins";
import { closeDb, ensureSchema, whenDbReady } from "../db";
import type { AdminRole } from "../types/user";

/**
 * Admin-user recovery CLI.
 *
 *   ts-node src/scripts/provision-admin.ts create --email E --password P [--role R] [--name N]
 *   ts-node src/scripts/provision-admin.ts list
 *   ts-node src/scripts/provision-admin.ts delete <email>
 *
 * **Not the normal way to get an admin.** `ensureBootstrapAdmin` (src/auth/admins.ts)
 * seeds the first owner from `ADMIN_BOOTSTRAP_EMAIL`/`ADMIN_BOOTSTRAP_PASSWORD` on
 * every boot, and owners manage everyone else from the console. This exists for the
 * one case neither covers: being locked out. The bootstrap only fires when the
 * `admins` table is *completely empty* — any row blocks it, even a disabled one — so
 * a forgotten owner password cannot be fixed by restarting. `delete` the account and
 * restart, and the seed runs again.
 *
 * `--email` and `--password` are required. They were once defaulted to a literal pair
 * in this file, which meant a bare `create` minted an **owner** whose password was
 * published in the repository.
 *
 * Runs only from a source checkout: the production image ships `build/` with
 * `--prod` dependencies, and `ts-node` is a devDependency. Point DATABASE_URL at the
 * environment you need to recover.
 */

const usage = (): void => {
  console.error(
    [
      "Usage:",
      "  provision-admin create --email <e> --password <p> [--role owner|manager|viewer] [--name <n>]",
      "  provision-admin list",
      "  provision-admin delete <email>",
    ].join("\n"),
  );
};

const getFlag = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const isRole = (v: string): v is AdminRole => v === "owner" || v === "manager" || v === "viewer";

const main = async (): Promise<number> => {
  await whenDbReady();
  await ensureSchema();
  const [command, ...rest] = process.argv.slice(2);

  if (command === "list") {
    const admins = await listAdmins();
    if (admins.length === 0) {
      console.log("No admins provisioned.");
      return 0;
    }
    console.log(`\nAdmins (${admins.length}):\n`);
    for (const a of admins) {
      const state = a.disabled ? " [disabled]" : "";
      console.log(`  ${a.email}${state}`);
      console.log(`    id:      ${a.id}`);
      console.log(`    name:    ${a.name}`);
      console.log(`    role:    ${a.role}`);
      console.log(`    created: ${a.createdAt.toISOString()}\n`);
    }
    return 0;
  }

  if (command === "create") {
    const email = getFlag(rest, "--email");
    const password = getFlag(rest, "--password");
    // Required, not defaulted: a default here is a credential in version control,
    // and the account it creates is an owner.
    if (!email || !password) {
      console.error("Both --email and --password are required.\n");
      usage();
      return 1;
    }
    const roleRaw = getFlag(rest, "--role") ?? "owner";
    const name = getFlag(rest, "--name") ?? email.split("@")[0]!;

    if (!isRole(roleRaw)) {
      console.error(`Invalid role '${roleRaw}' (expected owner|manager|viewer).`);
      return 1;
    }
    if (await getAdminByEmail(email)) {
      console.error(`⚠️  An admin with email '${email}' already exists.`);
      return 1;
    }

    const admin = await createAdmin({ email, name, role: roleRaw, password }, "provision-admin");
    console.log(`\n✅ Provisioned admin '${admin.email}' (${admin.role}).`);
    console.log("   Change the password after first login.\n");
    return 0;
  }

  if (command === "delete") {
    const email = rest[0];
    if (!email) {
      usage();
      return 1;
    }
    const admin = await getAdminByEmail(email);
    if (!admin) {
      console.log("⚠️  No admin with that email.");
      return 0;
    }
    await deleteAdmin(admin.id, "provision-admin");
    console.log("✅ Admin deleted.");
    return 0;
  }

  usage();
  return 1;
};

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error("provision-admin failed:", err instanceof Error ? err.message : err);
    await closeDb();
    process.exit(1);
  });
