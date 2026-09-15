import { readFile, writeFile, readdir } from "node:fs/promises";
const green = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
];
const classify = (license: string) =>
  green.includes(license)
    ? "GREEN"
    : /MPL|LGPL/.test(license)
      ? "YELLOW"
      : "REVIEW";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const lines = [
  "# Third-party notices",
  "",
  "Generated from the installed lockfile. No upstream application source was copied. Architecture references are recorded separately in docs/OPEN_SOURCE_RESEARCH.md. Dependency packages retain their own license files. REVIEW is a release gate, not permission to copy.",
  "",
  "| Package | Version | License | Classification |",
  "|---|---|---|---|",
];
for (const [path, p] of Object.entries(lock.packages) as [string, any][]) {
  if (!path.includes("node_modules/")) continue;
  lines.push(
    `| ${path.split("node_modules/").pop()} | ${p.version ?? ""} | ${p.license ?? "unknown"} | ${classify(p.license ?? "unknown")} |`,
  );
}
await writeFile("THIRD_PARTY_NOTICES.md", lines.join("\n") + "\n");
console.log(`Audited ${lines.length - 6} npm dependency entries`);
