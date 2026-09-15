import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
export async function detectHardware(machineId: string, worker: string) {
  const { stdout } = await promisify(execFile)(
    "nvidia-smi",
    [
      "--query-gpu=name,uuid,memory.total,driver_version",
      "--format=csv,noheader,nounits",
    ],
    { timeout: 10000, maxBuffer: 65536 },
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return { stdout: "" };
    throw error;
  });
  return {
    version: "1" as const,
    machineId,
    worker,
    gpu: stdout.trim()
      ? stdout
          .trim()
          .split("\n")
          .map((line) => {
            const [model, uuid, vram, driver] = line
              .split(",")
              .map((s) => s.trim());
            return {
              model: model!,
              uuid: uuid!,
              vramMb: Number(vram),
              driver: driver!,
            };
          })
      : [],
    cpuCores: os.cpus().length,
    ramMb: Math.floor(os.totalmem() / 1048576),
    capturedAt: Math.floor(Date.now() / 1000),
  };
}
