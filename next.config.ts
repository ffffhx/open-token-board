import type { NextConfig } from "next";

function getPagesBasePath() {
  const explicitBasePath = process.env.PAGES_BASE_PATH?.trim();

  if (!explicitBasePath || explicitBasePath === "/") {
    return "";
  }

  return explicitBasePath.startsWith("/")
    ? explicitBasePath.replace(/\/+$/, "")
    : `/${explicitBasePath.replace(/\/+$/, "")}`;
}

const pagesBasePath = getPagesBasePath();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "export",
  trailingSlash: true,
  basePath: pagesBasePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: pagesBasePath,
  },
};

export default nextConfig;
