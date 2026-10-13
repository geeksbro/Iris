import type { NextConfig } from "next";

/*
 * IRIS runs entirely in the browser, so the build is a static site in out/:
 * plain files that `scripts/iris.mjs` serves on this computer only. There is
 * no Next server at runtime, no API and no backend.
 */
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
