import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server (`.next/standalone`) with only the traced runtime
  // deps, so the Docker runtime image stays small and needs no `node_modules` copy.
  output: "standalone",
  // Trace from the monorepo root so the shared workspace packages (@heirs/ui,
  // @heirs/api-client) are included in the standalone output.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The shared packages ship TypeScript/JSX source, so Next must transpile them.
  transpilePackages: ["@heirs/ui", "@heirs/api-client"],
  allowedDevOrigins: ["192.168.100.3"],
};

export default nextConfig;
