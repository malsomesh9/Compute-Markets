import {
  chain,
  keypair,
  PublicKey,
  account,
  send,
  BN,
} from "../packages/solana/client.ts";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { commitment } from "../packages/receipts/index.ts";
const signer = keypair(process.env.AUTHORITY_KEYPAIR!),
  c = chain(signer),
  command = process.argv[2];
if (command === "register-provider") {
  console.log(
    await send(
      c,
      "registerProvider",
      [
        [
          ...Buffer.from(
            commitment({ name: process.argv[3] ?? "Independent provider" }),
            "hex",
          ),
        ],
      ],
      {
        authority: signer.publicKey,
        config: c.pda("config"),
        provider: c.pda("provider", signer.publicKey),
      },
    ),
  );
} else if (command === "authorize-worker") {
  const worker = new PublicKey(process.argv[3]!),
    provider = c.pda("provider", signer.publicKey);
  console.log(
    await send(
      c,
      "authorizeWorker",
      [new BN(Math.floor(Date.now() / 1000) + 86400 * 30)],
      {
        authority: signer.publicKey,
        provider,
        worker,
        workerAuth: c.pda("worker", provider, worker),
      },
    ),
  );
} else if (command === "register-machine") {
  const report = JSON.parse(readFileSync(process.argv[3]!, "utf8")),
    provider = c.pda("provider", signer.publicKey),
    worker = new PublicKey(report.worker),
    id = randomBytes(32),
    machine = c.pda("machine", provider, id);
  console.log(
    await send(
      c,
      "registerMachine",
      [
        [...id],
        [...Buffer.from(commitment(report), "hex")],
        report.gpu.length,
        report.gpu.length
          ? Math.min(...report.gpu.map((g: any) => g.vramMb))
          : 0,
      ],
      {
        authority: signer.publicKey,
        provider,
        workerAuth: c.pda("worker", provider, worker),
        machine,
      },
    ),
  );
  console.log("Machine:", machine.toBase58());
} else if (command === "create-offer") {
  const machine = new PublicKey(process.argv[3]!),
    id = randomBytes(32),
    rate = new BN(process.argv[4]!),
    provider = c.pda("provider", signer.publicKey);
  console.log(
    await send(
      c,
      "createOffer",
      [[...id], rate, 1, 3600, new BN(Math.floor(Date.now() / 1000) + 86400)],
      {
        authority: signer.publicKey,
        provider,
        machine,
        offer: c.pda("offer", machine, id),
      },
    ),
  );
} else if (command === "revoke-worker") {
  const provider = c.pda("provider", signer.publicKey),
    worker = new PublicKey(process.argv[3]!);
  console.log(
    await send(c, "revokeWorker", [], {
      authority: signer.publicKey,
      provider,
      workerAuth: c.pda("worker", provider, worker),
    }),
  );
} else
  throw new Error(
    "Commands: register-provider <name>, authorize-worker <worker>, register-machine <report.json>, create-offer <machine> <base-units/second>, revoke-worker <worker>",
  );
