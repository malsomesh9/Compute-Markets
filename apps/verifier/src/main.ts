import { readFileSync } from "node:fs";
import { verifyBundle } from "./verify.ts";
const file = process.argv[2];
if (!file) throw new Error("Pass an evidence bundle file");
console.log(
  JSON.stringify(await verifyBundle(JSON.parse(readFileSync(file, "utf8")))),
);
