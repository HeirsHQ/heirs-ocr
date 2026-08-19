import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@heirs/ui", "@heirs/api-client"],
  // Emits .next/standalone — a self-contained server plus only the traced
  // dependencies. apps/admin/Dockerfile copies it as the whole runtime image.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  allowedDevOrigins: ["192.168.100.3"]
};

export default nextConfig;
