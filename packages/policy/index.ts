import { jobSpecSchema, type ComputeJobSpecV1 } from "../job-spec/index.ts";
export function enforceExecutionPolicy(
  input: unknown,
  allowedRegistries: string[],
): ComputeJobSpecV1 {
  const spec = jobSpecSchema.parse(input);
  if (!allowedRegistries.includes(spec.image.repository.split("/")[0]!))
    throw new Error("Registry is not allowed by this provider");
  if (spec.inputs.length)
    throw new Error("Input materialization is not enabled for this executor");
  if (spec.service)
    throw new Error("Persistent services require the vLLM executor");
  if (spec.distributed)
    throw new Error("Distributed jobs require the Ray executor");
  if (spec.security?.isolation === "tee" || spec.security?.confidentialGpu)
    throw new Error("Hardware attestation requires a TEE executor");
  if (spec.proof)
    throw new Error("Proof workloads require a proof-capable executor");
  return spec;
}
