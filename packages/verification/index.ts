import bs58 from "bs58";
import {
  commitment,
  sha256,
  receiptSchema,
  verifyPayload,
  type SignedReceipt,
} from "../receipts/index.ts";
import { type ComputeJobSpecV1 } from "../job-spec/index.ts";
export type Assignment = {
  jobId: string;
  jobSpecHash: string;
  verificationPolicy: string;
  provider: string;
  machineId: string;
  worker: string;
  cluster: string;
  program: string;
  startedAt: number;
  submittedAt: number;
  hardwareReportHash: string;
  receiptHash: string;
  workerActive: boolean;
};
export type Evidence = {
  stdout: Uint8Array;
  stderr: Uint8Array;
  result: Uint8Array;
  telemetry: {
    gpuUuids: string[];
    samples: number;
    peakVramMb: number;
    durationSeconds: number;
  };
  hardware: unknown;
};
export function verifyReceipt(
  envelope: SignedReceipt,
  spec: ComputeJobSpecV1,
  a: Assignment,
  e: Evidence,
) {
  const p = receiptSchema.parse(envelope.payload);
  const failures: string[] = [];
  const check = (ok: boolean, reason: string) => {
    if (!ok) failures.push(reason);
  };
  check(
    verifyPayload(p, envelope.signature, bs58.decode(a.worker)),
    "Invalid worker signature",
  );
  for (const key of [
    "jobId",
    "provider",
    "machineId",
    "worker",
    "cluster",
    "program",
  ] as const)
    check(p[key] === a[key], `Assignment mismatch: ${key}`);
  check(a.workerActive, "Worker revoked or expired");
  check(commitment(p) === a.receiptHash, "Receipt commitment mismatch");
  check(
    p.jobSpecHash === commitment(spec) && p.jobSpecHash === a.jobSpecHash,
    "Job specification mismatch",
  );
  check(
    spec.verification.policy === a.verificationPolicy,
    "Verification policy downgrade",
  );
  check(p.imageDigest === spec.image.digest, "Image digest mismatch");
  check(p.inputRoot === commitment(spec.inputs), "Input commitment mismatch");
  check(
    p.startTimestamp >= a.startedAt - 5 && p.startTimestamp <= a.startedAt + 30,
    "Invalid start time",
  );
  check(
    p.finishTimestamp >= p.startTimestamp &&
      p.finishTimestamp - p.startTimestamp <= spec.execution.timeoutSeconds &&
      p.finishTimestamp <= a.submittedAt + 5,
    "Invalid execution duration",
  );
  check(p.exitCode === 0, "Execution failed");
  check(
    p.stdoutHash === sha256(e.stdout) && p.stderrHash === sha256(e.stderr),
    "Log commitment mismatch",
  );
  check(
    p.resultHash === sha256(e.result) &&
      p.outputRoot === commitment({ result: sha256(e.result) }),
    "Output commitment mismatch",
  );
  check(
    p.hardwareReportHash === commitment(e.hardware) &&
      p.hardwareReportHash === a.hardwareReportHash,
    "Hardware commitment mismatch",
  );
  check(
    p.telemetryHash === commitment(e.telemetry),
    "Telemetry commitment mismatch",
  );
  check(
    p.gpuUuidCommitment === commitment(e.telemetry.gpuUuids),
    "GPU identity commitment mismatch",
  );
  if (spec.verification.policy !== "BASIC") {
    check(
      e.telemetry.samples > 0 &&
        e.telemetry.durationSeconds >= 0 &&
        Math.abs(
          e.telemetry.durationSeconds - (p.finishTimestamp - p.startTimestamp),
        ) <= 5,
      "Telemetry timing inconsistency",
    );
    check(
      e.telemetry.gpuUuids.length === spec.resources.gpu.count,
      "GPU count mismatch",
    );
    check(e.telemetry.peakVramMb >= 0, "Invalid memory measurement");
  }
  return {
    passed: failures.length === 0,
    assurance: spec.verification.policy === "BASIC" ? "VERIFY_0" : "VERIFY_1",
    requestedAssurance: `VERIFY_${[
      "BASIC",
      "STANDARD",
      "CHALLENGE",
      "REDUNDANT",
      "TEE",
      "PROOF",
    ].indexOf(spec.verification.policy)}`,
    requiresAdditionalEvidence: !["BASIC", "STANDARD"].includes(
      spec.verification.policy,
    ),
    failures,
    limitation:
      "Signed evidence consistency does not prove correct computation or hardware identity.",
  };
}
