import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateReputation } from "../packages/reputation/index.ts";

test("reputation separates current uptime and benchmark evidence from job history", () => {
  const now = 2_000_000_000;
  const healthy = calculateReputation({
    now,
    heartbeatAt: now - 10,
    benchmarkPassed: true,
    jobs: [
      {
        state: "COMPLETED",
        deadline: now - 100,
        timeoutSeconds: 60,
        startedAt: now - 120,
        submittedAt: now - 70,
        updatedAt: now * 1000,
        verificationPassed: true,
      },
    ],
  });
  const failed = calculateReputation({
    now,
    heartbeatAt: now - 1000,
    benchmarkPassed: false,
    jobs: [
      {
        state: "DISPUTED",
        deadline: now - 200,
        timeoutSeconds: 60,
        startedAt: now - 100,
        submittedAt: now,
        updatedAt: now * 1000,
        verificationPassed: false,
      },
    ],
  });
  assert.ok(healthy.score > failed.score);
  assert.equal(healthy.components.uptime, 100);
  assert.equal(failed.components.disputeFree < 100, true);
});
