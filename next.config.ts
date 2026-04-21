import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit browser source maps in prod so errors show real file names / line
  // numbers instead of minified `2d225524f2efb425.js:1:45805`.
  productionBrowserSourceMaps: true,
};

export default nextConfig;
