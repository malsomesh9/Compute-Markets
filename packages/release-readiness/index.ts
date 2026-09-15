export type ReleaseGate = {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
};

const enabled = (value: string | undefined) => value === "true";

export function releaseReadiness(
  environment: NodeJS.ProcessEnv,
  maxOnchainPolicy: number,
) {
  const gates: ReleaseGate[] = [
    {
      id: "solana-v1",
      label: "Solana escrow and settlement",
      ready: maxOnchainPolicy >= 1,
      detail: "The deployed program accepts BASIC and STANDARD jobs.",
    },
    {
      id: "advanced-policies",
      label: "Challenge and redundant policies",
      ready: maxOnchainPolicy >= 3,
      detail: "Requires the policy 2–5 program upgrade on the public cluster.",
    },
    {
      id: "nvidia",
      label: "NVIDIA execution qualification",
      ready: enabled(environment.RELEASE_GPU_QUALIFIED),
      detail: "Requires a recorded CUDA and inference run on a qualified host.",
    },
    {
      id: "confidential-gpu",
      label: "Confidential GPU qualification",
      ready: enabled(environment.RELEASE_TEE_QUALIFIED),
      detail: "Requires qualified confidential hardware and attestation roots.",
    },
    {
      id: "proof-circuit",
      label: "Production proof circuit",
      ready: enabled(environment.RELEASE_PROOF_QUALIFIED),
      detail:
        "Requires an audited workload circuit and pinned verification key.",
    },
    {
      id: "verifier-market",
      label: "Permissionless verifier market",
      ready: enabled(environment.RELEASE_PERMISSIONLESS_VERIFIERS),
      detail: "Requires verifier staking, rewards, rotation, and arbitration.",
    },
    {
      id: "operations",
      label: "Production operations qualification",
      ready: enabled(environment.RELEASE_OPERATIONS_QUALIFIED),
      detail:
        "Requires multi-cluster load, outage, recovery, and alert testing.",
    },
    {
      id: "audit",
      label: "Independent security audit",
      ready: enabled(environment.RELEASE_AUDITED),
      detail:
        "Requires an external protocol and provider-host security review.",
    },
  ];
  const completed = gates.filter((gate) => gate.ready).length;
  return {
    release: "development-network",
    softwareMvpReady: gates[0]!.ready,
    fullV1V3Ready: completed === gates.length,
    completedGates: completed,
    totalGates: gates.length,
    readinessPercent: Math.round((completed / gates.length) * 100),
    gates,
  };
}
