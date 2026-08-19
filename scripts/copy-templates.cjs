#!/usr/bin/env node
/**
 * Stages the HTML email templates into the build output.
 *
 * `tsc` only emits JavaScript, so `src/templates/*.html` never reaches `build/`.
 * The runtime resolves them relative to `__dirname` (see src/notification/mail/
 * templates.ts), which means the compiled tree needs its own copy — otherwise the
 * image builds clean and then throws on the first email it tries to send.
 */
const fs = require("fs");
const path = require("path");

const from = path.join(__dirname, "..", "src", "templates");
const to = path.join(__dirname, "..", "build", "templates");

if (!fs.existsSync(from)) {
  console.error(`✗ No templates directory at ${from}`);
  process.exit(1);
}

fs.mkdirSync(to, { recursive: true });

const templates = fs.readdirSync(from).filter((f) => f.endsWith(".html"));
for (const file of templates) {
  fs.copyFileSync(path.join(from, file), path.join(to, file));
}

console.log(`✓ Copied ${templates.length} email templates → build/templates`);
