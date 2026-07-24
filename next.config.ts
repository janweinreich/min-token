import type { NextConfig } from "next";

const config: NextConfig = {
  // onnxruntime-node ships ~220MB of native .node binaries. Tracing them through
  // the bundler breaks the build; keep them external and required at runtime.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // packages/core is authored with ESM-style `.js` specifiers so tsx and vitest
  // resolve it directly with no build step. Webpack needs to be told that a
  // `.js` specifier may be satisfied by a `.ts` file.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default config;
