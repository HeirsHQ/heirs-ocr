import { DocsHero } from "@/components/docs";
import { Handshake } from "lucide-react";

const Page = () => (
  <div>
    <DocsHero eyebrow="Company" icon={Handshake} title="Terms of Service" subtitle="" />
    <section className="py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6"></div>
    </section>
  </div>
);

export default Page;
