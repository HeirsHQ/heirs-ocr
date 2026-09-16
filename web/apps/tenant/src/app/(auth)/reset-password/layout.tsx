import type { Metadata } from "next";

/**
 * The reset link's token rides in this page's query string. `no-referrer` keeps it
 * out of the `Referer` header of anything the page loads or links to.
 */
export const metadata: Metadata = {
  title: "Reset password",
  referrer: "no-referrer",
};

const ResetPasswordLayout = ({ children }: { children: React.ReactNode }) => children;

export default ResetPasswordLayout;
