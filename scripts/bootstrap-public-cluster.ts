import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  account,
  BN,
  chain,
  keypair,
  PublicKey,
  send,
} from "../packages/solana/client.ts";

const rpc = process.env.SOLANA_RPC_URL;
if (!rpc || /127\.0\.0\.1|localhost/.test(rpc))
  throw new Error("SOLANA_RPC_URL must name an explicit public cluster RPC");

const deployerPath = resolve(
  process.env.DEPLOYER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`,
);
const deployer = keypair(deployerPath);
const c = chain(deployer);
const programInfo = await c.connection.getAccountInfo(
  c.program.programId,
  "confirmed",
);
if (!programInfo?.executable)
  throw new Error(
    `Program ${c.program.programId.toBase58()} is not executable on ${rpc}`,
  );

const treasury = new PublicKey(
  process.env.TREASURY_PUBKEY ??
    (() => {
      throw new Error("TREASURY_PUBKEY is required");
    })(),
);
const verifier = new PublicKey(
  process.env.VERIFIER_PUBKEY ??
    (() => {
      throw new Error("VERIFIER_PUBKEY is required");
    })(),
);
const config = c.pda("config");
const existingInfo = await c.connection.getAccountInfo(config, "confirmed");
if (existingInfo) {
  const existing = await account(c, "protocolConfig", config);
  console.log(
    JSON.stringify({
      status: "already-initialized",
      rpc,
      programId: c.program.programId.toBase58(),
      config: config.toBase58(),
      admin: existing.admin.toBase58(),
      mint: existing.mint.toBase58(),
      treasury: existing.treasury.toBase58(),
      verifier: existing.verifier.toBase58(),
      feeBps: existing.feeBps,
      disputeSeconds: existing.disputeSeconds.toString(),
    }),
  );
  process.exit(0);
}

let mint: PublicKey;
if (process.env.SETTLEMENT_MINT) {
  mint = new PublicKey(process.env.SETTLEMENT_MINT);
} else if (process.env.CREATE_TEST_MINT === "true") {
  mint = await createMint(c.connection, deployer, deployer.publicKey, null, 6);
} else {
  throw new Error(
    "SETTLEMENT_MINT is required; use CREATE_TEST_MINT=true only for a clearly labelled test deployment",
  );
}
const mintInfo = await getMint(c.connection, mint, "confirmed");
if (mintInfo.decimals !== 6)
  throw new Error(
    `Settlement mint must have 6 decimals; got ${mintInfo.decimals}`,
  );

const feeBps = Number(process.env.PROTOCOL_FEE_BPS ?? "200");
const disputeSeconds = Number(process.env.DISPUTE_SECONDS ?? "3600");
if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 300)
  throw new Error("PROTOCOL_FEE_BPS must be an integer from 0 through 300");
if (
  !Number.isInteger(disputeSeconds) ||
  disputeSeconds < 1 ||
  disputeSeconds > 604800
)
  throw new Error("DISPUTE_SECONDS must be an integer from 1 through 604800");

const programData = PublicKey.findProgramAddressSync(
  [c.program.programId.toBuffer()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
)[0];
const initializeTx = await send(
  c,
  "initializeProtocol",
  [feeBps, new BN(disputeSeconds)],
  {
    admin: deployer.publicKey,
    config,
    mint,
    treasury,
    verifier,
    program: c.program.programId,
    programData,
  },
);
const treasuryToken = await getOrCreateAssociatedTokenAccount(
  c.connection,
  deployer,
  mint,
  treasury,
);
console.log(
  JSON.stringify({
    status: "initialized",
    rpc,
    programId: c.program.programId.toBase58(),
    config: config.toBase58(),
    admin: deployer.publicKey.toBase58(),
    mint: mint.toBase58(),
    treasury: treasury.toBase58(),
    treasuryToken: treasuryToken.address.toBase58(),
    verifier: verifier.toBase58(),
    feeBps,
    disputeSeconds,
    initializeTx,
  }),
);
