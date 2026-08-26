/**
 * Product changelog shown in the portal.
 *
 * Held as data rather than fetched: there is no changelog API, and inventing one
 * would mean an editing surface, a table, and a permission model for content that
 * changes when a release ships — i.e. when this file ships. Adding an entry is a
 * code change because a release is a code change.
 *
 * **Written for tenants, not for us.** Entries describe what someone integrating with
 * the service can now do, or must now account for — not which modules moved. If a
 * change is invisible from outside the API, it does not belong here.
 *
 * Newest first; the page renders them in array order.
 */

export type ChangeKind = "added" | "improved" | "fixed" | "security";

export interface ChangelogEntry {
  /** ISO date, rendered as a heading. */
  date: string;
  /** Short release title. */
  title: string;
  changes: { kind: ChangeKind; text: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-08-26",
    title: "Webhook plan requirement, endpoint limit and destination checks",
    changes: [
      {
        kind: "improved",
        text: "Webhooks now require a Business or Enterprise plan. Registering an endpoint, editing one, rotating its secret and sending a test all need the feature. If your plan stops including it, deliveries stop, but your endpoints stay listed so you can still remove them.",
      },
      {
        kind: "improved",
        text: "An organisation may register up to 10 webhook endpoints. Adding another is refused until you delete one — every endpoint multiplies the requests we make for each document you process.",
      },
      {
        kind: "security",
        text: "A webhook URL must resolve to a public address. An endpoint pointed at a private, loopback or link-local host is refused when you save it, and checked again before every delivery — so a hostname re-pointed inward later stops being delivered to rather than retried.",
      },
    ],
  },
  {
    date: "2026-08-19",
    title: "Webhooks, request logs, and data export",
    changes: [
      {
        kind: "added",
        text: "Webhooks. Register an endpoint under Webhooks to receive signed `document.processed` and `document.failed` events. Every delivery carries an `X-Heirs-Signature` header you can verify with your endpoint's signing secret — see the API reference for the verification snippet.",
      },
      {
        kind: "added",
        text: "Request Logs. Every API call your organisation makes, including the ones that were refused — over quota, rate limited, unsupported file type. These never appear under Documents, so this is the place to debug a failing integration.",
      },
      {
        kind: "added",
        text: "Backup. Download a copy of your documents, API key metadata and team as JSON. It is an export for your records, not a restore point — key secrets and passwords are deliberately unrecoverable and are not included.",
      },
      {
        kind: "added",
        text: "Job Queues. Large documents are processed in the background; this page shows their status, duration and retry count while they run.",
      },
    ],
  },
  {
    date: "2026-08-18",
    title: "Security controls and document history",
    changes: [
      {
        kind: "security",
        text: "Two-factor authentication. Enable TOTP under Security. Once enabled, signing in requires a code from your authenticator app — a password alone will not establish a session. Enrolment issues ten single-use recovery codes; store them somewhere safe, as they are shown only once.",
      },
      {
        kind: "security",
        text: "Active sessions. See where your account is signed in, and sign out every other device at once. Changing your password now also revokes all other sessions.",
      },
      {
        kind: "security",
        text: "IP allowlist. Owners can restrict portal sign-ins to specific addresses or CIDR ranges. Existing sessions are unaffected, and a list that would lock you out is rejected rather than saved.",
      },
      {
        kind: "added",
        text: "Documents and Reports. Every document processed through a standard function is listed with its outcome, page count and duration, with a trailing-window report. Documents run through identity and other PII functions are never recorded — not even their filenames — so this list is deliberately not a complete account of everything you submitted. Billing remains the authoritative usage total.",
      },
      {
        kind: "added",
        text: "API key expiry. Keys can be minted with an expiry date, after which they stop authenticating but remain visible in the list as expired.",
      },
      {
        kind: "improved",
        text: "API keys now follow a consistent `hok_live_…` / `hok_test_…` pattern. Existing keys continue to work unchanged.",
      },
    ],
  },
  {
    date: "2026-08-15",
    title: "Billing and usage",
    changes: [
      {
        kind: "added",
        text: "Billing & Usage. Your current plan, documents and pages processed this period, accrued charges, and the plan's limits.",
      },
      {
        kind: "improved",
        text: "Runs started from the portal's OCR page are now attributed to your organisation, so in-app usage counts toward the same totals as direct API calls.",
      },
    ],
  },
];
