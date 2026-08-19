import { ApiReferenceContent, LiveFunctionCatalog } from "@/components/docs";
import { PageLayout } from "@/components/shared";
import { publicApiUrl } from "@/lib/ocr";

/**
 * Portal copy of the API reference. Same body as the public page at
 * `/api-reference`, with the Functions section generated from the live catalog —
 * which is why this one is behind the session.
 */
const Page = () => (
  <PageLayout title="API Reference" subtitle="Integrate with the OCR API directly from your own systems.">
    <div className="w-full">
      <ApiReferenceContent functions={<LiveFunctionCatalog />} host={publicApiUrl()} />
    </div>
  </PageLayout>
);

export default Page;
