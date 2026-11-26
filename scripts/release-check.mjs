// Validate release metadata for a tag, or print that version's changelog notes.
// Usage: node scripts/release-check.mjs v1.2.3 [--notes]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [tag, flag] = process.argv.slice(2);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));

assert.match(tag ?? "", /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Tag must look like v1.2.3");
assert.equal(tag, `v${pkg.version}`, "Tag must match package.json version");
assert.equal(pkg.license, "MIT");
assert(read("LICENSE").includes("MIT License"), "LICENSE must contain the MIT text");
if (process.env.GITHUB_REPOSITORY) {
  assert.equal(pkg.repository.url, `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git`);
}

// Keep a Changelog: "## [1.2.3] - 2026-01-01" up to the next "## " heading.
const changelog = read("CHANGELOG.md");
const heading = new RegExp(`^## \\[${pkg.version.replaceAll(".", "\\.")}\\][^\\n]*$`, "m");
const match = heading.exec(changelog);
assert(match, `CHANGELOG.md needs a "## [${pkg.version}]" section`);
const rest = changelog.slice(match.index + match[0].length);
const notes = rest.slice(0, rest.search(/^## /m) === -1 ? undefined : rest.search(/^## /m)).trim();
assert(notes, `CHANGELOG.md section ${pkg.version} is empty`);

if (flag === "--notes") console.log(notes);
else console.log(`Release metadata for ${tag} is valid.`);
