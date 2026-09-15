import { admin, checked } from "../../../packages/config/backend.ts";
import { verifyBundle } from "./verify.ts";
let stop = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stop = true;
  });
while (!stop) {
  try {
    const jobs = await checked(
      admin.database
        .from("jobs")
        .select("id,spec_hash")
        .in("state", ["VERIFYING", "COMPLETED", "FAILED"])
        .limit(100),
    );
    const recorded = await checked(
      admin.database.from("verifications").select("job_id").limit(1000),
    );
    const recordedJobs = new Set(
      (recorded ?? []).map((verification) => verification.job_id),
    );
    for (const job of jobs ?? []) {
      if (recordedJobs.has(job.id)) continue;
      try {
        const receipt = await checked(
          admin.database
            .from("receipts")
            .select("envelope,storage_key")
            .eq("job_id", job.id)
            .maybeSingle(),
        );
        if (!receipt) continue;
        const specs = await checked(
          admin.database
            .from("job_specs")
            .select("spec")
            .eq("hash", job.spec_hash)
            .limit(1),
        );
        if (!specs?.length) continue;
        const blob = await checked(
          admin.storage
            .from("execution-evidence")
            .download(receipt.storage_key),
        );
        const evidence = JSON.parse(await blob!.text());
        console.log(
          await verifyBundle({
            envelope: receipt.envelope,
            spec: specs[0]!.spec,
            evidence,
          }),
        );
      } catch (e) {
        console.error("Verification deferred:", (e as Error).message);
      }
    }
  } catch (e) {
    console.error(e);
  }
  await new Promise((r) => setTimeout(r, 10000));
}
