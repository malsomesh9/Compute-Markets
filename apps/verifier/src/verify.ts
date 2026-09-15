import { readFileSync } from "node:fs";
import { storeReceipt } from "../../../packages/storage/index.ts";
import {
  chain,
  keypair,
  PublicKey,
  account,
  send,
} from "../../../packages/solana/client.ts";
import { jobSpecSchema } from "../../../packages/job-spec/index.ts";
import { verifyReceipt } from "../../../packages/verification/index.ts";
import { commitment } from "../../../packages/receipts/index.ts";
import { policyFromCode } from "../../../packages/verification/policies.ts";
import { verifyRedundantResults } from "../../../packages/verification/redundancy.ts";
import { Indexer } from "../../indexer/src/indexer.ts";
import { admin, checked } from "../../../packages/config/backend.ts";

export async function verifyBundle(bundle: any) {
  if (!process.env.VERIFIER_KEYPAIR)
    throw new Error("VERIFIER_KEYPAIR is required");
  const spec = jobSpecSchema.parse(bundle.spec),
    c = chain(keypair(process.env.VERIFIER_KEYPAIR)),
    job = new PublicKey(bundle.envelope.payload.jobId);
  const info = await c.connection.getAccountInfo(job, "finalized");
  if (!info || !info.owner.equals(c.program.programId))
    throw new Error("No finalized protocol job");
  const j = c.program.coder.accounts.decode("job", info.data) as any;
  if (![8, 9, 12].includes(j.state) || !j.verifier.equals(c.signer.publicKey))
    throw new Error("Job is not assigned to this verifier");
  const machine = await account(c, "machine", j.machine),
    workerAuth = await account(
      c,
      "workerAuthorization",
      c.pda("worker", j.provider, j.worker),
    );
  const evidence = {
    ...bundle.evidence,
    stdout: Buffer.from(bundle.evidence.stdout, "base64"),
    stderr: Buffer.from(bundle.evidence.stderr, "base64"),
    result: Buffer.from(bundle.evidence.result, "base64"),
  };
  let decision: any = verifyReceipt(
    bundle.envelope,
    spec,
    {
      jobId: job.toBase58(),
      jobSpecHash: Buffer.from(j.specHash).toString("hex"),
      verificationPolicy: policyFromCode(j.policy),
      provider: j.provider.toBase58(),
      machineId: j.machine.toBase58(),
      worker: j.worker.toBase58(),
      cluster: await c.connection.getGenesisHash(),
      program: c.program.programId.toBase58(),
      startedAt: Number(j.startedAt),
      submittedAt: Number(j.submittedAt),
      hardwareReportHash: Buffer.from(machine.hardwareHash).toString("hex"),
      receiptHash: Buffer.from(j.receiptHash).toString("hex"),
      workerActive:
        workerAuth.active && Number(workerAuth.expiresAt) > Date.now() / 1000,
    },
    evidence,
  );
  if (decision.passed && spec.verification.policy === "CHALLENGE") {
    const challenge = await checked(
      admin.database
        .from("verification_challenges")
        .select("passed")
        .eq("job_id", job.toBase58())
        .maybeSingle(),
    );
    if (challenge?.passed == null)
      throw new Error("VERIFY_2 challenge response is pending");
    decision = {
      ...decision,
      passed: challenge.passed,
      assurance: "VERIFY_2",
      requiresAdditionalEvidence: false,
      failures: challenge.passed
        ? decision.failures
        : [...decision.failures, "Hidden challenge failed"],
    };
  } else if (decision.passed && spec.verification.policy === "REDUNDANT") {
    const replica = await checked(
      admin.database
        .from("redundant_job_replicas")
        .select("group_id")
        .eq("job_id", job.toBase58())
        .maybeSingle(),
    );
    if (!replica) throw new Error("VERIFY_3 replica group is missing");
    await checked(
      admin.database
        .from("redundant_job_replicas")
        .update({
          provider_id: j.provider.toBase58(),
          machine_id: j.machine.toBase58(),
          result_hash: bundle.envelope.payload.resultHash,
          verify1_passed: true,
        })
        .eq("job_id", job.toBase58()),
    );
    const [group, replicas] = await Promise.all([
      checked(
        admin.database
          .from("redundant_job_groups")
          .select("required_matches,state,consensus_result_hash")
          .eq("id", replica.group_id)
          .single(),
      ),
      checked(
        admin.database
          .from("redundant_job_replicas")
          .select("job_id,provider_id,machine_id,result_hash,verify1_passed")
          .eq("group_id", replica.group_id)
          .order("ordinal", { ascending: true })
          .limit(5),
      ),
    ]);
    if (!group) throw new Error("VERIFY_3 replica group is missing");
    const completed = (replicas ?? []).filter(
      (value) =>
        value.provider_id && value.machine_id && value.result_hash != null,
    );
    if (completed.length < Number(group.required_matches))
      throw new Error("VERIFY_3 is waiting for independent replicas");
    const redundant = verifyRedundantResults(
      completed.map((value) => ({
        jobId: value.job_id,
        provider: value.provider_id,
        machineId: value.machine_id,
        resultHash: value.result_hash,
        verify1Passed: value.verify1_passed === true,
      })),
      Number(group.required_matches),
    );
    if (!redundant.passed && completed.length < (replicas ?? []).length)
      throw new Error("VERIFY_3 is waiting for its tie-breaking replica");
    const state = redundant.passed ? "PASSED" : "DISPUTED";
    await checked(
      admin.database
        .from("redundant_job_groups")
        .update({
          state,
          consensus_result_hash: redundant.resultHash,
          updated_at: new Date().toISOString(),
        })
        .eq("id", replica.group_id),
    );
    const replicaPassed =
      redundant.passed &&
      redundant.resultHash === bundle.envelope.payload.resultHash;
    decision = {
      ...decision,
      passed: replicaPassed,
      assurance: "VERIFY_3",
      requiresAdditionalEvidence: false,
      failures: replicaPassed
        ? decision.failures
        : [
            ...decision.failures,
            ...redundant.failures,
            "Replica is outside the result quorum",
          ],
    };
  } else if (decision.passed && decision.requiresAdditionalEvidence) {
    throw new Error(
      `${decision.requestedAssurance} evidence is required before an on-chain verification decision`,
    );
  }
  const existingVerification = await checked(
    admin.database
      .from("verifications")
      .select("receipt_hash,verifier,passed,assurance,failures,tx_signature")
      .eq("job_id", job.toBase58())
      .maybeSingle(),
  );
  if (existingVerification) {
    if (j.state === 8)
      throw new Error(
        "Database verification exists while finalized chain job is still VERIFYING",
      );
    if (
      existingVerification.receipt_hash !==
        commitment(bundle.envelope.payload) ||
      existingVerification.verifier !== c.signer.publicKey.toBase58() ||
      existingVerification.passed !== decision.passed ||
      (j.state === 9) !== decision.passed
    )
      throw new Error(
        "Existing verification conflicts with finalized evidence",
      );
    return {
      decision,
      signature: existingVerification.tx_signature,
      recovered: false,
      alreadyRecorded: true,
    };
  }
  const projectedJob = await checked(
    admin.database
      .from("jobs")
      .select("id")
      .eq("id", job.toBase58())
      .maybeSingle(),
  );
  if (!projectedJob) await new Indexer(c).reconcile();
  await storeReceipt(bundle);
  let signature: string | null = null;
  let recovered = false;
  if (j.state === 8) {
    const submitted = await send(
      c,
      "submitVerification",
      [
        [...Buffer.from(commitment(bundle.envelope.payload), "hex")],
        decision.passed,
      ],
      { verifier: c.signer.publicKey, job },
    );
    signature = submitted;
    await c.connection.confirmTransaction(submitted, "finalized");
    await new Indexer(c).reconcile();
  } else {
    if ((j.state === 9) !== decision.passed)
      throw new Error("Recovered chain decision conflicts with evidence");
    recovered = true;
  }
  await checked(
    admin.database.from("verifications").upsert([
      {
        job_id: job.toBase58(),
        receipt_hash: commitment(bundle.envelope.payload),
        verifier: c.signer.publicKey.toBase58(),
        passed: decision.passed,
        assurance: decision.assurance,
        failures: decision.failures,
        tx_signature: signature,
      },
    ]),
  );
  return { decision, signature, recovered, alreadyRecorded: false };
}
