import { randomBytes } from "node:crypto";
import { Transaction } from "@solana/web3.js";
import {
  account,
  BN,
  chain,
  instruction,
  keypair,
  SystemProgram,
  TOKEN_PROGRAM_ID,
} from "../packages/solana/client.ts";

const signer = keypair(
  process.env.DEPLOYER_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
);
const client = chain(signer);
const configAddress = client.pda("config");
const config = await account(client, "protocolConfig", configAddress);
const results: Array<{ policy: number; accepted: boolean; error?: unknown }> =
  [];

for (let policy = 0; policy <= 5; policy++) {
  const id = randomBytes(32);
  const job = client.pda("job", signer.publicKey, id);
  const create = await instruction(
    client,
    "createJob",
    [
      [...id],
      [...randomBytes(32)],
      new BN(1),
      new BN(Math.floor(Date.now() / 1000) + 600),
      60,
      policy,
    ],
    {
      buyer: signer.publicKey,
      config: configAddress,
      job,
      mint: config.mint,
      escrow: client.pda("escrow", job),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    },
  );
  const latest = await client.connection.getLatestBlockhash();
  const transaction = new Transaction({
    ...latest,
    feePayer: signer.publicKey,
  }).add(create);
  const simulation = await client.connection.simulateTransaction(transaction, [
    signer,
  ]);
  results.push({
    policy,
    accepted: simulation.value.err == null,
    ...(simulation.value.err ? { error: simulation.value.err } : {}),
  });
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.accepted)) process.exitCode = 1;
