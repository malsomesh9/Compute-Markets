import { admin, checked } from "../config/backend.ts";
import { commitment } from "../receipts/index.ts";
export async function storeReceipt(bundle: any) {
  const jobId = bundle.envelope.payload.jobId,
    hash = commitment(bundle.envelope.payload);
  const existing = await checked(
    admin.database
      .from("receipts")
      .select("receipt_hash,storage_key,storage_url")
      .eq("job_id", jobId)
      .maybeSingle(),
  );
  if (existing) {
    if (existing.receipt_hash !== hash)
      throw new Error("Conflicting receipt for this job");
    return existing;
  }
  const stored = await checked(
    admin.storage.from("execution-evidence").upload(
      `${jobId}/${hash}.json`,
      new Blob([JSON.stringify(bundle.evidence)], {
        type: "application/json",
      }),
    ),
  );
  const row = {
    job_id: jobId,
    receipt_hash: hash,
    envelope: bundle.envelope,
    storage_key: stored!.key,
    storage_url: stored!.url,
  };
  await checked(
    admin.database
      .from("receipts")
      .upsert([row], { onConflict: "job_id", ignoreDuplicates: true }),
  );
  return row;
}
