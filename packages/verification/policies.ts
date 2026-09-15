export const verificationPolicies = [
  "BASIC",
  "STANDARD",
  "CHALLENGE",
  "REDUNDANT",
  "TEE",
  "PROOF",
] as const;

export type VerificationPolicy = (typeof verificationPolicies)[number];

const assuranceByPolicy = {
  BASIC: "VERIFY_0",
  STANDARD: "VERIFY_1",
  CHALLENGE: "VERIFY_2",
  REDUNDANT: "VERIFY_3",
  TEE: "VERIFY_4",
  PROOF: "VERIFY_5",
} as const satisfies Record<VerificationPolicy, string>;

export type VerificationAssurance =
  (typeof assuranceByPolicy)[VerificationPolicy];

export function policyCode(policy: VerificationPolicy): number {
  return verificationPolicies.indexOf(policy);
}

export function policyFromCode(code: number): VerificationPolicy {
  const policy = verificationPolicies[code];
  if (!policy) throw new Error(`Unsupported verification policy code: ${code}`);
  return policy;
}

export function assuranceFor(
  policy: VerificationPolicy,
): VerificationAssurance {
  return assuranceByPolicy[policy];
}
