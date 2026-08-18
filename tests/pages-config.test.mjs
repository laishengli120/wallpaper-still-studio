import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const nextConfig = fs.readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

test("GitHub Pages builds with the repository base path", () => {
  assert.match(nextConfig, /process\.env\.GITHUB_REPOSITORY/);
  assert.match(nextConfig, /output: isGitHubPages \? "export"/);
  assert.match(nextConfig, /basePath,/);
  assert.match(nextConfig, /assetPrefix: basePath/);
  assert.match(nextConfig, /NEXT_PUBLIC_BASE_PATH: basePath/);
});

test("public assets respect the GitHub Pages subdirectory", () => {
  assert.match(page, /PUBLIC_BASE_PATH.*NEXT_PUBLIC_BASE_PATH/);
  assert.match(page, /`\$\{PUBLIC_BASE_PATH\}\/html2canvas\.min\.js`/);
  assert.match(layout, /`\$\{publicBasePath\}\/favicon\.png`/);
});

test("the Pages workflow uploads the static export", () => {
  assert.match(workflow, /npm run build:pages/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /path: out/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});
