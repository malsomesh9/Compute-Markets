import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import {
  evidencePath,
  journalPath,
  loadJournal,
  readEvidence,
  recordJournal,
  writeEvidence,
} from "../agents/provider-node/journal.ts";

test("execution journal preserves transitions and durable evidence", () => {
  const job = `test-${process.pid}-${Date.now()}`;
  try {
    recordJournal(job, "PREPARING");
    recordJournal(job, "RUNNING", { recovered: false });
    const current = loadJournal(job)!;
    assert.equal(current.state, "RUNNING");
    assert.deepEqual(
      current.history.map((item) => item.state),
      ["PREPARING", "RUNNING"],
    );
    writeEvidence(job, { receipt: "durable-before-chain" });
    assert.deepEqual(readEvidence(job), { receipt: "durable-before-chain" });
  } finally {
    rmSync(journalPath(job), { force: true });
    rmSync(evidencePath(job), { force: true });
  }
});
