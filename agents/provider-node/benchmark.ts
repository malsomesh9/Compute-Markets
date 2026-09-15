import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import {
  chain,
  keypair,
  PublicKey,
  account,
} from "../../packages/solana/client.ts";
import { commitment, signPayload } from "../../packages/receipts/index.ts";
import { benchmarkReportSchema } from "../../packages/benchmark/index.ts";
import { detectHardware } from "./hardware.ts";

const exec = promisify(execFile);
const defaultImage =
  "docker.io/library/alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce";

export async function runBenchmark() {
  const worker = keypair(process.env.WORKER_KEYPAIR!);
  const c = chain(worker);
  const machineId = new PublicKey(process.env.MACHINE_ID!);
  const machine = await account(c, "machine", machineId);
  if (machine.worker.toBase58() !== worker.publicKey.toBase58())
    throw new Error("Worker is not assigned to this machine");
  const authorization = await account(
    c,
    "workerAuthorization",
    c.pda("worker", machine.provider, worker.publicKey),
  );
  if (
    !authorization.active ||
    Number(authorization.expiresAt) <= Date.now() / 1000
  )
    throw new Error("Worker delegation is inactive");

  const image = process.env.BENCHMARK_IMAGE ?? defaultImage;
  const [repository, imageDigest] = image.split("@");
  if (!repository || !/^sha256:[a-f0-9]{64}$/.test(imageDigest ?? ""))
    throw new Error("BENCHMARK_IMAGE must be digest-pinned");
  if (!process.env.HARDWARE_REPORT)
    throw new Error("HARDWARE_REPORT must point to the committed report");
  const hardware = JSON.parse(
    readFileSync(process.env.HARDWARE_REPORT, "utf8"),
  );
  if (
    commitment(hardware) !== Buffer.from(machine.hardwareHash).toString("hex")
  )
    throw new Error("Hardware report does not match the on-chain commitment");
  const detected = await detectHardware(
    machineId.toBase58(),
    worker.publicKey.toBase58(),
  );
  if (
    detected.gpu.length !== machine.gpuCount ||
    detected.gpu.some(
      (gpu, index) =>
        gpu.uuid !== hardware.gpu?.[index]?.uuid ||
        gpu.model !== hardware.gpu?.[index]?.model ||
        gpu.vramMb !== hardware.gpu?.[index]?.vramMb,
    )
  )
    throw new Error("Live GPU inventory does not match the committed report");

  const startedAt = Math.floor(Date.now() / 1000);
  await exec("docker", ["pull", image], {
    timeout: 300000,
    maxBuffer: 1024 * 1024,
  });
  const diskStart = performance.now();
  await exec(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--user",
      "65532:65532",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--pids-limit",
      "64",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      image,
      "dd",
      "if=/dev/zero",
      "of=/tmp/benchmark",
      "bs=1048576",
      "count=32",
      "conv=fsync",
    ],
    { timeout: 120000, maxBuffer: 1024 * 1024 },
  );
  const diskSeconds = (performance.now() - diskStart) / 1000;
  const block = Buffer.alloc(1024 * 1024, 0x5a);
  const cpuStart = performance.now();
  for (let i = 0; i < 64; i++) createHash("sha256").update(block).digest();
  const cpuSeconds = (performance.now() - cpuStart) / 1000;
  const report = benchmarkReportSchema.parse({
    version: "1",
    domain: "vericompute:benchmark:v1",
    cluster: await c.connection.getGenesisHash(),
    program: c.program.programId.toBase58(),
    machineId: machineId.toBase58(),
    worker: worker.publicKey.toBase58(),
    hardwareReportHash: commitment(hardware),
    imageDigest,
    startedAt,
    finishedAt: Math.floor(Date.now() / 1000),
    cpuSha256MibPerSecond: 64 / cpuSeconds,
    diskWriteMibPerSecond: 32 / diskSeconds,
    gpu: detected.gpu.map((gpu) => ({ uuid: gpu.uuid, vramMb: gpu.vramMb })),
    nonce: randomUUID(),
  });
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(worker.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const envelope = signPayload(report, privateKey);
  const response = await fetch(
    `${process.env.COMPUTE_API_URL ?? "http://localhost:4000"}/v1/provider/benchmark`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    },
  );
  if (!response.ok) throw new Error(await response.text());
  return { envelope, accepted: await response.json() };
}
