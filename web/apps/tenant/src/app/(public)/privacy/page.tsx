import { DocsHero } from "@/components/docs";
import { UserShield } from "lucide-react";

const Page = () => (
  <div>
    <DocsHero eyebrow="Company" icon={UserShield} title="Privacy Policy" subtitle="" />
    <section className="py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6"></div>
    </section>
  </div>
);

export default Page;
