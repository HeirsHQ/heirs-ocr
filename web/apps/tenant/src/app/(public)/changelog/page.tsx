import { History } from "lucide-react";
import type { Metadata } from "next";

import { ChangelogContent, DocsHero } from "@/components/docs";

export const metadata: Metadata = {
  title: "Changelog — Heirs OCR",
  description: "New functions, security controls and API changes in the Heirs OCR service, newest first.",
};

const Page = () => (
  <div>
    <DocsHero
      eyebrow="Release notes"
      icon={History}
      title="Changelog"
      subtitle="What's new in the Heirs OCR service."
    />
    <section className="py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <ChangelogContent />
      </div>
    </section>
  </div>
);

export default Page;
