import Link from "next/link";
import { ScanText } from "lucide-react";

const cols = [
  {
    heading: "Product",
    links: [
      { href: "#features", label: "Features" },
      { href: "#how-it-works", label: "How it works" },
      { href: "#pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { href: "/api-reference", label: "API Reference" },
      { href: "/sdks", label: "SDKs" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "#", label: "About" },
      { href: "#", label: "Privacy" },
      { href: "#", label: "Terms" },
    ],
  },
];

export const Footer = () => (
  <footer className="border-t bg-background">
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
            <ScanText className="size-5 text-primary" />
            <span>Heirs OCR</span>
          </Link>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Turn any document into structured, validated data through one uniform API.
          </p>
        </div>
        {cols.map((col) => (
          <div key={col.heading} className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{col.heading}</p>
            <ul className="flex flex-col gap-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-10 border-t pt-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Heirs Technologies. All rights reserved.
      </div>
    </div>
  </footer>
);
