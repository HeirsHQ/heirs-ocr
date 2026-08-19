import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, KeyRound } from "lucide-react";

import { ApiReferenceContent, DocsHero, Prose } from "@/components/docs";
import { Button, EmptyState } from "@heirs/ui";
import { publicApiUrl } from "@/lib/ocr";

export const metadata: Metadata = {
  title: "API Reference — Heirs OCR",
  description:
    "Authenticate, send a document, handle errors and verify webhooks. The full integration contract for the Heirs OCR API.",
};

/**
 * Stands in for the live catalog on the signed-out page.
 *
 * `GET /v1/ocr/functions` is session- or key-scoped, so this page cannot render the
 * per-function detail the portal does. Saying so — and pointing at the endpoint and
 * the sign-in — is more use to a developer evaluating the API than omitting the
 * section and leaving them to wonder which functions exist.
 */
const CatalogSignIn = () => (
  <>
    <Prose>
      Every function shares the contract above; they differ only in what they return and what they accept. The
      per-function detail — description, accepted file types, page cap and arguments schema — is generated from the live
      catalog, so it is rendered in the portal rather than hard-coded here. Any valid API key can read the same catalog
      from <code className="font-mono text-xs">GET /v1/ocr/functions</code>.
    </Prose>
    <EmptyState
      icon={BookOpen}
      title="The function catalog is in the portal"
      description="Sign in to browse every function with its arguments schema, accepted file types and page limits — always matching what the service currently offers."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button render={<Link href="/developer/api-reference">Open in the portal</Link>}></Button>
          <Button
            variant="outline"
            render={
              <Link href="/login">
                <KeyRound className="size-4" /> Get an API key
              </Link>
            }
          ></Button>
        </div>
      }
    />
  </>
);

const Page = () => (
  <div>
    <DocsHero
      eyebrow="Developers"
      icon={BookOpen}
      title="API Reference"
      subtitle="Integrate with the OCR API directly from your own systems."
    />
    <section className="py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <ApiReferenceContent functions={<CatalogSignIn />} host={publicApiUrl()} />
      </div>
    </section>
  </div>
);

export default Page;
