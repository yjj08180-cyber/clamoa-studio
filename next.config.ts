import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    "/*": ["./content/**/*"],
  },
  serverExternalPackages: ["sharp"],
};
export default config;
