import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server (`.next/standalone`) with only the traced runtime
  // deps, so the Docker runtime image stays small and needs no `node_modules` copy.
  output: "standalone",
  // This app is its own pnpm project; pin the trace root here so Next doesn't walk up
  // to the backend workspace when both are present in the build context.
  outputFileTracingRoot: __dirname,
  allowedDevOrigins: ["192.168.100.3"],
};

export default nextConfig;
