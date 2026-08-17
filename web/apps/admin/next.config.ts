import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@heirs/ui", "@heirs/api-client"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  allowedDevOrigins: ["192.168.100.3"]
};

export default nextConfig;
