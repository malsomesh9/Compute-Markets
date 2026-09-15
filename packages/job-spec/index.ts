import { z } from "zod";
import { verificationPolicies } from "../verification/policies.ts";
export const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const jobSpecSchema = z
  .strictObject({
    version: z.literal("1"),
    runtime: z.literal("oci"),
    image: z.strictObject({
      repository: z
        .string()
        .regex(/^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+$/)
        .max(200),
      digest,
    }),
    command: z.array(z.string().max(4096)).min(1).max(64),
    resources: z.strictObject({
      gpu: z.strictObject({
        count: z.number().int().min(0).max(16),
        minimumVramMb: z.number().int().min(0).max(200000),
        allowedModels: z.array(z.string().max(80)).max(16),
      }),
      cpuCores: z.number().int().min(1).max(128),
      ramMb: z.number().int().min(128).max(1048576),
      storageMb: z.number().int().min(64).max(1048576),
    }),
    execution: z.strictObject({
      timeoutSeconds: z.number().int().min(1).max(86400),
      maxStartDelaySeconds: z.number().int().min(1).max(86400),
    }),
    network: z.strictObject({
      mode: z.literal("deny-by-default"),
      allow: z.array(z.never()).max(0),
    }),
    verification: z.strictObject({ policy: z.enum(verificationPolicies) }),
    service: z
      .strictObject({
        kind: z.literal("vllm"),
        model: z.string().min(1).max(300),
        contextTokens: z.number().int().min(128).max(1048576),
        replicas: z.number().int().min(1).max(32),
        durationSeconds: z.number().int().min(60).max(86400),
      })
      .optional(),
    distributed: z
      .strictObject({
        framework: z.literal("ray"),
        workers: z.number().int().min(1).max(128),
        gpusPerWorker: z.number().int().min(0).max(16),
        entrypoint: z.string().min(1).max(4096),
      })
      .optional(),
    security: z
      .strictObject({
        isolation: z.enum(["runc", "gvisor", "tee"]),
        confidentialGpu: z.boolean(),
      })
      .optional(),
    proof: z
      .strictObject({
        system: z.enum(["groth16", "plonk"]),
        circuitHash: hash,
        verificationKeyHash: hash,
      })
      .optional(),
    inputs: z
      .array(
        z.strictObject({
          key: z
            .string()
            .regex(/^[a-zA-Z0-9/_-]+$/)
            .max(256),
          sha256: hash,
        }),
      )
      .max(16)
      .default([]),
  })
  .superRefine((spec, context) => {
    if (spec.service && spec.distributed)
      context.addIssue({
        code: "custom",
        path: ["distributed"],
        message: "A job cannot be both a persistent service and a Ray job",
      });
    if (
      spec.service &&
      spec.service.durationSeconds > spec.execution.timeoutSeconds
    )
      context.addIssue({
        code: "custom",
        path: ["service", "durationSeconds"],
        message: "Service duration exceeds the escrowed execution timeout",
      });
    if (
      spec.distributed &&
      spec.distributed.workers * spec.distributed.gpusPerWorker !==
        spec.resources.gpu.count
    )
      context.addIssue({
        code: "custom",
        path: ["distributed"],
        message:
          "Distributed GPU allocation must equal the requested GPU count",
      });
    if (
      (spec.security?.isolation === "tee" || spec.security?.confidentialGpu) &&
      !["TEE", "PROOF"].includes(spec.verification.policy)
    )
      context.addIssue({
        code: "custom",
        path: ["verification", "policy"],
        message:
          "TEE or confidential GPU execution requires VERIFY_4 or stronger",
      });
    if (
      spec.verification.policy === "TEE" &&
      spec.security?.isolation !== "tee"
    )
      context.addIssue({
        code: "custom",
        path: ["security", "isolation"],
        message: "TEE verification requires TEE isolation",
      });
    if (spec.verification.policy === "PROOF" && !spec.proof)
      context.addIssue({
        code: "custom",
        path: ["proof"],
        message: "Proof verification requires a pinned proof system and keys",
      });
  });
export type ComputeJobSpecV1 = z.infer<typeof jobSpecSchema>;
