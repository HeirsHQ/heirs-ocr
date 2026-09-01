#!/usr/bin/env bash
#
# One-time Postgres data migration: dump SOURCE, restore into TARGET, verify.
#
# This repo has no migration runner — src/db.ts `ensureSchema()` creates the
# tables with CREATE TABLE IF NOT EXISTS on every boot. That means pointing
# DATABASE_URL at an empty database SILENTLY creates 15 empty tables and looks
# healthy. So the data must be moved *before* .env is touched. This script does
# not modify .env; swapping the string stays a deliberate manual step.
#
# pg_dump/psql are not installed on the dev machine, so everything runs in a
# throwaway postgres container. The image tag is chosen from the source server's
# own version — pg_dump refuses to dump a server newer than itself.
#
# Usage:
#   SOURCE_URL='postgres://...' TARGET_URL='postgres://...' scripts/migrate-db.sh preflight
#   SOURCE_URL='postgres://...' TARGET_URL='postgres://...' scripts/migrate-db.sh dump
#   SOURCE_URL='postgres://...' TARGET_URL='postgres://...' scripts/migrate-db.sh restore
#   SOURCE_URL='postgres://...' TARGET_URL='postgres://...' scripts/migrate-db.sh verify
#
# Run them in that order. Each step is independently re-runnable.

set -euo pipefail

DUMP_DIR="${DUMP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.dbdump}"
DUMP_FILE="heirs-ocr.dump"
STEP="${1:-}"

die() { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
note() { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ok\033[0m %s\n' "$*"; }

case "$STEP" in
  preflight|dump|restore|verify) ;;
  *) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

[ -n "${SOURCE_URL:-}" ] || die "SOURCE_URL is not set"
[ -n "${TARGET_URL:-}" ] || die "TARGET_URL is not set"
command -v docker >/dev/null || die "docker is required (pg_dump is not installed locally)"

# The docker daemon may not be reachable without sudo. Rather than silently
# failing mid-dump, detect it now and fall back to `sudo docker` (override by
# exporting DOCKER yourself). Fix permanently with:
#   sudo usermod -aG docker "$USER"   # then log out and back in
DOCKER="${DOCKER:-docker}"
if ! $DOCKER info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
  else
    die "cannot reach the docker daemon (tried both docker and sudo docker)"
  fi
  note "using '$DOCKER' — add yourself to the docker group to avoid this"
fi

mkdir -p "$DUMP_DIR"

# Run psql/pg_dump/pg_restore in a container. --network host so a locally-run
# Postgres on localhost is reachable the same way a remote host is.
pg() {
  local image="$1"; shift
  $DOCKER run --rm --network host \
    -v "$DUMP_DIR:/dump" \
    --user "$(id -u):$(id -g)" \
    -e PGCONNECT_TIMEOUT=30 \
    "postgres:${image}-alpine" "$@"
}

# Ask the server its major version so pg_dump is never older than it.
server_major() {
  local url="$1" out
  out="$(pg 17 psql "$url" -tAc 'show server_version_num' 2>&1)" || {
    printf '%s\n' "$out" >&2
    return 1
  }
  echo $(( ${out//[!0-9]/} / 10000 ))
}

# Row counts for every public table, as "table<TAB>count", sorted.
counts() {
  pg "$1" psql "$2" -tA -F$'\t' -c "
    select relname, n_live_tup
      from pg_stat_user_tables
     where schemaname = 'public'
     order by relname"
}

case "$STEP" in
  preflight)
    note "checking SOURCE reachability"
    SRC_MAJOR="$(server_major "$SOURCE_URL")" || die "cannot reach SOURCE — nothing can be exported until this succeeds"
    ok "source is Postgres $SRC_MAJOR"

    note "checking TARGET reachability"
    TGT_MAJOR="$(server_major "$TARGET_URL")" || die "cannot reach TARGET"
    ok "target is Postgres $TGT_MAJOR"

    [ "$TGT_MAJOR" -ge "$SRC_MAJOR" ] || die "target ($TGT_MAJOR) is older than source ($SRC_MAJOR); restore will fail"

    note "source row counts (exact)"
    pg "$SRC_MAJOR" psql "$SOURCE_URL" -c "
      select relname as table, n_live_tup as approx_rows
        from pg_stat_user_tables where schemaname='public' order by relname"

    note "checking TARGET is empty"
    existing="$(pg "$TGT_MAJOR" psql "$TARGET_URL" -tAc \
      "select count(*) from pg_tables where schemaname='public'")"
    if [ "${existing//[!0-9]/}" -gt 0 ]; then
      cat >&2 <<'WARN'

  !! TARGET already contains tables in the public schema.

     This almost certainly means the app has already booted against it and
     ensureSchema() created them empty. Restoring on top will fail on
     conflicting objects, and --clean would DROP whatever is there.

     Confirm the target holds nothing you need, then drop the schema:
       DROP SCHEMA public CASCADE; CREATE SCHEMA public;

WARN
      exit 1
    fi
    ok "target public schema is empty — safe to restore into"
    ;;

  dump)
    SRC_MAJOR="$(server_major "$SOURCE_URL")" || die "cannot reach SOURCE"
    note "dumping source (Postgres $SRC_MAJOR) → $DUMP_DIR/$DUMP_FILE"
    # -Fc  custom format: compressed, restores selectively, survives version drift
    # --no-owner / --no-acl: source roles don't exist on the new provider
    pg "$SRC_MAJOR" pg_dump "$SOURCE_URL" \
      --format=custom --no-owner --no-acl --verbose \
      --file="/dump/$DUMP_FILE"

    [ -s "$DUMP_DIR/$DUMP_FILE" ] || die "dump file is empty — do NOT proceed"
    ok "wrote $(du -h "$DUMP_DIR/$DUMP_FILE" | cut -f1)"

    note "dump contents"
    pg "$SRC_MAJOR" pg_restore --list "/dump/$DUMP_FILE" | grep -cE 'TABLE DATA' \
      | xargs -I{} echo "  {} tables with data"
    ;;

  restore)
    [ -s "$DUMP_DIR/$DUMP_FILE" ] || die "no dump at $DUMP_DIR/$DUMP_FILE — run 'dump' first"
    TGT_MAJOR="$(server_major "$TARGET_URL")" || die "cannot reach TARGET"
    note "restoring into target (Postgres $TGT_MAJOR)"
    # --no-owner/--no-acl again: ownership is assigned to the connecting role.
    # Deliberately NOT --clean: it would DROP existing objects. Fail loudly instead.
    pg "$TGT_MAJOR" pg_restore "$TARGET_URL" \
      --no-owner --no-acl --verbose --exit-on-error \
      "/dump/$DUMP_FILE"
    ok "restore completed with no errors"
    ;;

  verify)
    SRC_MAJOR="$(server_major "$SOURCE_URL")" || die "cannot reach SOURCE to compare against"
    TGT_MAJOR="$(server_major "$TARGET_URL")" || die "cannot reach TARGET"

    note "recomputing exact counts on both sides"
    # ANALYZE first: pg_stat_user_tables is an estimate until stats are fresh.
    pg "$SRC_MAJOR" psql "$SOURCE_URL" -qc 'analyze' >/dev/null
    pg "$TGT_MAJOR" psql "$TARGET_URL" -qc 'analyze' >/dev/null

    counts "$SRC_MAJOR" "$SOURCE_URL" > "$DUMP_DIR/counts.source"
    counts "$TGT_MAJOR" "$TARGET_URL" > "$DUMP_DIR/counts.target"

    if diff -u "$DUMP_DIR/counts.source" "$DUMP_DIR/counts.target"; then
      ok "row counts match on every table"
      echo
      echo "  Safe to switch DATABASE_URL in .env now. Keep the old Prisma URL"
      echo "  commented alongside it, and keep $DUMP_DIR/$DUMP_FILE until the new"
      echo "  database has been running clean for a few days."
    else
      die "row counts DIFFER (- source / + target above) — do not switch DATABASE_URL"
    fi
    ;;

  *)
    sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
