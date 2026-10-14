import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function templateBody(marker) {
  const prefix = `${marker} = \``;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${marker} template was not found`);
  const bodyStart = start + prefix.length;
  const end = source.indexOf("\n      `;", bodyStart);
  assert.notEqual(end, -1, `${marker} template was not terminated`);
  return source.slice(bodyStart, end);
}

test("the injected iframe bridge is valid JavaScript", () => {
  const bridge = templateBody("prelude.textContent")
    .replace("${token}", '"test-token"')
    .replace("${serializedAssets}", "{}")
    .replace("${serializedProperties}", "{}")
    .replace("${initialConfig}", "{}");
  assert.doesNotThrow(() => new Function(bridge));
  assert.match(source, /ELEMENT_RULES\.values\(\)\]\.join\('\\\\n'\)/);
});

test("the capture bridge is valid JavaScript", () => {
  assert.doesNotThrow(() => new Function(templateBody("captureBridge.textContent")));
});

test("the capture bridge materializes Lycoris pseudo-elements before PNG export", () => {
  const bridge = templateBody("captureBridge.textContent");
  assert.match(bridge, /onclone:\s*clonedDocument\s*=>/);
  assert.match(bridge, /data-we-export-static-pole/);
  assert.match(bridge, /we-exporting-static-poles/);
  assert.match(bridge, /pseudo\.item\(i\)/);
  assert.match(bridge, /content: none !important; display: none !important/);
});

test("the preview uses srcDoc so the complete rewritten project reaches the iframe", () => {
  assert.match(source, /srcDoc=\{previewHtml\}/);
  assert.doesNotMatch(source, /src=\{previewUrl\}/);
});

test("the preview keeps the selected wallpaper aspect ratio after a project is mounted", () => {
  assert.match(source, /useLayoutEffect\(\(\) => \{/);
  assert.match(source, /\}, \[project, previewHeight\]\);/);
  assert.match(source, /style=\{\{ aspectRatio: `\$\{previewWidth\} \/ \$\{previewHeight\}` \}\}/);
});

test("the preview stays visible while desktop controls scroll", () => {
  assert.match(styles, /\.preview-column\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*14px;/);
  assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*?\.preview-column\s*\{\s*position:\s*static;/);
});

test("range controls use continuous input events", () => {
  assert.match(source, /data-testid="scene-zoom"[\s\S]*?onInput=/);
  assert.match(source, /data-testid="element-scale"[\s\S]*?onInput=/);
  assert.match(source, /data-testid="pole-curve"[\s\S]*?onInput=/);
  assert.doesNotMatch(source, /type="range"[^>]*onChange=/);
});

test("elements can be dragged directly and overrides win over project styles", () => {
  assert.match(source, /data\.type === "we-element-drag"/);
  assert.match(source, /document\.addEventListener\('mousemove'/);
  assert.match(source, /html body \[data-we-studio-key=/);
  assert.match(source, /ELEMENT_RULES\.clear\(\)/);
  assert.match(source, /candidate !== document\.documentElement && candidate !== document\.body/);
  assert.match(source, /aria-label="鼠标直接拖动"/);
  assert.match(source, /targetAt: \(x, y\)/);
  assert.match(source, /aria-label="壁纸预览拖动区域"/);
  assert.match(source, /onPointerDown=\{beginPreviewDrag\}/);
  assert.match(source, /setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /data\.type === 'we-clear-selection'/);
});

test("the Lycoris adapter keeps both character containers and static poles editable", () => {
  assert.match(source, /"div\.takina\.sakana-box"/);
  assert.match(source, /"div\.chisato\.sakana-box"/);
  assert.match(source, /"div\.takina\.sakana-box": \{ \.\.\.DEFAULT_ELEMENT_EDIT, x: 2\.5, y: 2 \}/);
  assert.match(source, /we-lycoris-layout \.sakana-box::after/);
  assert.match(source, /支撑杆弯曲/);
  assert.match(source, /支撑杆粗细/);
});
