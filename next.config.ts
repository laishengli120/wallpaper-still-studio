import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] || "";
const basePath = isGitHubPages && repositoryName ? `/${repositoryName}` : "";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: isGitHubPages,
  images: { unoptimized: isGitHubPages },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
