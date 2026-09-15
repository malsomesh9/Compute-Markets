import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ComputeClient } from "../../../packages/sdk/index.ts";
import { jobSpecSchema } from "../../../packages/job-spec/index.ts";
const client = new ComputeClient({
  apiUrl: process.env.COMPUTE_API_URL ?? "http://localhost:4000",
  accessToken: process.env.COMPUTE_ACCESS_TOKEN ?? "",
  walletProof: process.env.COMPUTE_WALLET_PROOF ?? "",
});
const server = new McpServer({ name: "vericompute", version: "0.1.0" });
const result = (x: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(x) }],
});
server.registerTool(
  "compute_search",
  {
    description: "Find one cursor-paginated page of published compute offers",
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    },
  },
  async (input) => result(await client.findCompute(input)),
);
server.registerTool(
  "compute_quote",
  {
    description: "Compare non-binding quotes for a digest-pinned OCI workload",
    inputSchema: { spec: jobSpecSchema, maxSpendBaseUnits: z.string() },
  },
  async (input) => result(await client.quote(input)),
);
server.registerTool(
  "compute_create_intent",
  {
    description:
      "Construct an unsigned Solana compute intent. Requires an external wallet signature; does not spend funds.",
    inputSchema: { spec: jobSpecSchema, maxSpendBaseUnits: z.string() },
  },
  async (input) => result(await client.createJob(input)),
);
server.registerTool(
  "compute_run",
  {
    description:
      "Begin a compute run by returning the atomic create-and-fund transaction for external wallet approval.",
    inputSchema: { spec: jobSpecSchema, maxSpendBaseUnits: z.string() },
  },
  async (input) => result(await client.createJob(input)),
);
server.registerTool(
  "compute_market_price",
  {
    description: "Read current best and median hourly market prices",
    inputSchema: {},
  },
  async () => result(await client.prices()),
);
server.registerTool(
  "compute_verify",
  {
    description:
      "Read the committed receipt and independent verification decisions for an owned job",
    inputSchema: { jobId: z.string() },
  },
  async ({ jobId }) => result(await client.verify(jobId)),
);
server.registerTool(
  "compute_agent_policies",
  {
    description: "Read the authenticated owner's on-chain agent policies",
    inputSchema: {},
  },
  async () => result(await client.agentPolicies()),
);
server.registerTool(
  "compute_agent_create_job",
  {
    description:
      "Construct an agent-signed job transaction under an owner's on-chain spending policy",
    inputSchema: {
      agent: z.string(),
      spec: jobSpecSchema,
      maxSpendBaseUnits: z.string(),
      proof: z.array(z.string()),
    },
  },
  async (input) => result(await client.createAgentJob(input)),
);
server.registerTool(
  "compute_agent_accept_bid",
  {
    description:
      "Construct an agent-signed bid acceptance under the job's on-chain policy",
    inputSchema: {
      jobId: z.string(),
      agent: z.string(),
      bidId: z.string(),
      proof: z.array(z.string()),
    },
  },
  async ({ jobId, ...input }) =>
    result(await client.acceptAgentBid(jobId, input)),
);
server.registerTool(
  "compute_agent_cancel",
  {
    description:
      "Construct an agent-signed cancellation under the job's on-chain policy",
    inputSchema: {
      jobId: z.string(),
      agent: z.string(),
      proof: z.array(z.string()),
    },
  },
  async ({ jobId, ...input }) =>
    result(await client.cancelAgentJob(jobId, input)),
);
for (const [name, method] of [
  ["compute_status", "status"],
  ["compute_logs", "logs"],
  ["compute_result", "result"],
  ["compute_receipt", "receipt"],
  ["compute_cancel", "cancelJob"],
] as const)
  server.registerTool(
    name,
    {
      description: `${name} for an owned job; cancellation returns an unsigned instruction`,
      inputSchema: { jobId: z.string() },
    },
    async ({ jobId }) => result(await client[method](jobId)),
  );
await server.connect(new StdioServerTransport());
