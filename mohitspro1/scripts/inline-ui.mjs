// Packs the built UI into one HTML file, dist/mohits-ui.html. The plugin ships this
// single file, so it needs no separate asset server. Run after `vite build`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
let html = readFileSync(dist + "index.html", "utf8");

let scripts = 0;
html = html.replace(
  /<script[^>]*\bsrc="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g,
  (_, file) => {
    scripts++;
    // Keep a literal "</script" out of the inlined code so it can't end the tag early.
    const code = readFileSync(dist + file, "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script type="module">${code}</script>`;
  },
);

let styles = 0;
html = html.replace(
  /<link[^>]*\brel="stylesheet"[^>]*\bhref="\.\/(assets\/[^"]+\.css)"[^>]*>/g,
  (_, file) => {
    styles++;
    return `<style>${readFileSync(dist + file, "utf8")}</style>`;
  },
);

if (scripts === 0) throw new Error("inline-ui: no script tags found in dist/index.html");
writeFileSync(dist + "mohits-ui.html", html);
console.log(`inline-ui: packed ${scripts} script(s) and ${styles} stylesheet(s) into dist/mohits-ui.html`);
