import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export async function sampleGpu(gpuUuids: string[]) {
  if (!gpuUuids.length) return { gpuUuids: [], peakVramMb: 0 };
  const { stdout } = await exec(
    "nvidia-smi",
    ["--query-gpu=uuid,memory.used", "--format=csv,noheader,nounits"],
    { timeout: 5000, maxBuffer: 65536 },
  );
  const readings = new Map(
    stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [id, memory] = line.split(",").map((s) => s.trim());
        return [id, Number(memory)] as const;
      }),
  );
  for (const id of gpuUuids)
    if (!readings.has(id) || !Number.isFinite(readings.get(id)))
      throw new Error(`No valid telemetry for assigned GPU ${id}`);
  return {
    gpuUuids,
    peakVramMb: Math.max(...gpuUuids.map((id) => readings.get(id)!)),
  };
}
