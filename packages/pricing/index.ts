import type { ComputeJobSpecV1 } from "../job-spec/index.ts";
import {
  policyCode,
  type VerificationPolicy,
} from "../verification/policies.ts";
export type Supply = {
  id: string;
  provider: string;
  machine: string;
  gpuModel: string;
  gpuCount: number;
  vramMb: number;
  rateBaseUnitsPerSecond: string;
  region: string;
  reputation: number;
  stakeBaseUnits?: string;
  active: boolean;
  available: boolean;
  expiresAt: number;
  heartbeatAt: number;
  estimatedStartSeconds: number;
  verification: VerificationPolicy;
  runtime: "oci";
  maxSeconds: number;
};
export function quoteSupply(
  supplies: Supply[],
  spec: ComputeJobSpecV1,
  budget: bigint,
  now: number,
  region?: string,
) {
  return supplies
    .filter(
      (s) =>
        s.active &&
        s.available &&
        s.runtime === spec.runtime &&
        s.expiresAt > now &&
        now - s.heartbeatAt < 90 &&
        s.heartbeatAt <= now + 5 &&
        s.gpuCount >= spec.resources.gpu.count &&
        s.vramMb >= spec.resources.gpu.minimumVramMb &&
        (!spec.resources.gpu.allowedModels.length ||
          spec.resources.gpu.allowedModels.includes(s.gpuModel)) &&
        (!region || s.region === region) &&
        s.estimatedStartSeconds <= spec.execution.maxStartDelaySeconds &&
        s.maxSeconds >= spec.execution.timeoutSeconds &&
        policyCode(s.verification) >= policyCode(spec.verification.policy),
    )
    .map((s) => ({
      supply: s,
      totalBaseUnits: (
        BigInt(s.rateBaseUnitsPerSecond) * BigInt(spec.execution.timeoutSeconds)
      ).toString(),
    }))
    .filter(
      (q) =>
        BigInt(q.totalBaseUnits) > 0n && BigInt(q.totalBaseUnits) <= budget,
    )
    .sort((a, b) => {
      const priceA = BigInt(a.totalBaseUnits),
        priceB = BigInt(b.totalBaseUnits);
      return priceA === priceB
        ? b.supply.reputation - a.supply.reputation
        : priceA < priceB
          ? -1
          : 1;
    });
}
export function splitEscrow(deposit: bigint, price: bigint, feeBps: number) {
  if (
    deposit < 0n ||
    price < 0n ||
    price > deposit ||
    !Number.isInteger(feeBps) ||
    feeBps < 0 ||
    feeBps > 300
  )
    throw new Error("Invalid escrow accounting");
  const fee = (price * BigInt(feeBps)) / 10000n;
  return { provider: price - fee, fee, refund: deposit - price };
}
