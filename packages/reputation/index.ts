export type ReputationJob = {
  state: string;
  deadline: number;
  timeoutSeconds: number;
  startedAt?: number | null;
  submittedAt?: number | null;
  updatedAt: string | number;
  verificationPassed?: boolean | null;
};

export type ReputationInput = {
  jobs: ReputationJob[];
  heartbeatAt?: number | null;
  benchmarkPassed?: boolean;
  now?: number;
};

export function calculateReputation(input: ReputationInput) {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const halfLife = 30 * 86400;
  const observations = input.jobs.map((job) => ({
    job,
    weight: Math.exp(
      -Math.max(0, now - new Date(job.updatedAt).getTime() / 1000) / halfLife,
    ),
  }));
  const rate = (select: (job: ReputationJob) => boolean | null) => {
    let positive = 2;
    let total = 3;
    for (const { job, weight } of observations) {
      const value = select(job);
      if (value === null) continue;
      total += weight;
      if (value) positive += weight;
    }
    return (positive / total) * 100;
  };
  const completion = rate((job) =>
    ["COMPLETED"].includes(job.state)
      ? true
      : ["FAILED", "REFUNDED", "DISPUTED"].includes(job.state)
        ? false
        : null,
  );
  const startupSla = rate((job) =>
    job.startedAt == null ? null : job.startedAt <= job.deadline,
  );
  const completionSla = rate((job) =>
    job.startedAt == null || job.submittedAt == null
      ? null
      : job.submittedAt <= job.startedAt + job.timeoutSeconds,
  );
  const receiptValidity = rate((job) => job.verificationPassed ?? null);
  const disputeFree = rate((job) =>
    ["COMPLETED", "FAILED", "REFUNDED", "DISPUTED"].includes(job.state)
      ? job.state !== "DISPUTED"
      : null,
  );
  const uptime = input.heartbeatAt && now - input.heartbeatAt <= 90 ? 100 : 0;
  const benchmark = input.benchmarkPassed ? 100 : 0;
  const score =
    completion * 0.35 +
    startupSla * 0.15 +
    completionSla * 0.15 +
    receiptValidity * 0.15 +
    disputeFree * 0.1 +
    uptime * 0.05 +
    benchmark * 0.05;
  return {
    score: Math.round(score),
    sampleSize: input.jobs.length,
    components: {
      completion: Math.round(completion),
      startupSla: Math.round(startupSla),
      completionSla: Math.round(completionSla),
      receiptValidity: Math.round(receiptValidity),
      disputeFree: Math.round(disputeFree),
      uptime,
      benchmark,
    },
    methodology: "30-day exponential decay with a 2-of-3 Bayesian prior",
  };
}
