import React from "react";

import { Navbar } from "@/components/shared/navbar";
import { Footer } from "@/components/shared/footer";

interface Props {
  children: React.ReactNode;
}

export default function MainLayout({ children }: Props) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
