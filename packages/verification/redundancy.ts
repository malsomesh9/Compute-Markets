import { z } from "zod";

const replicaSchema = z.strictObject({
  jobId: z.string().min(32),
  provider: z.string().min(32),
  machineId: z.string().min(32),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/),
  verify1Passed: z.boolean(),
});

export type ReplicaResult = z.infer<typeof replicaSchema>;

export function verifyRedundantResults(
  raw: ReplicaResult[],
  requiredMatches = 2,
) {
  const replicas = z.array(replicaSchema).min(2).max(5).parse(raw);
  if (
    !Number.isInteger(requiredMatches) ||
    requiredMatches < 2 ||
    requiredMatches > replicas.length
  )
    throw new Error("Invalid redundancy quorum");
  const providers = new Set(replicas.map((r) => r.provider));
  const machines = new Set(replicas.map((r) => r.machineId));
  const failures: string[] = [];
  if (providers.size !== replicas.length)
    failures.push("Replicas are not provider-independent");
  if (machines.size !== replicas.length)
    failures.push("Replicas are not machine-independent");
  if (replicas.some((r) => !r.verify1Passed))
    failures.push("A replica failed VERIFY_1");
  const votes = new Map<string, number>();
  for (const replica of replicas)
    votes.set(replica.resultHash, (votes.get(replica.resultHash) ?? 0) + 1);
  const [resultHash, matches] = [...votes.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]!;
  if (matches < requiredMatches) failures.push("No result hash reached quorum");
  return {
    passed: failures.length === 0,
    assurance: "VERIFY_3" as const,
    failures,
    resultHash: matches >= requiredMatches ? resultHash : null,
    matches,
    requiredMatches,
    dispatchTieBreaker: replicas.length === 2 && matches === 1,
  };
}
