// Anchor 0.32.1 requires web3.js internally. Keep that compatibility boundary here;
// independent RPC consumers use Solana Kit 8.2.0.
import {
  AnchorProvider,
  Program,
  Wallet,
  BN,
  type Idl,
} from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
export {
  Keypair,
  PublicKey,
  BN,
  SystemProgram,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
};
export function keypair(file: string) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))),
  );
}
export function chain(signer = Keypair.generate()) {
  const idl = JSON.parse(
    readFileSync(
      new URL("../../idl/compute_market.json", import.meta.url),
      "utf8",
    ),
  ) as Idl;
  const connection = new Connection(
    process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
    "confirmed",
  );
  const provider = new AnchorProvider(connection, new Wallet(signer), {
    commitment: "confirmed",
  });
  const program = new Program(idl, provider);
  return {
    program,
    connection,
    provider,
    signer,
    pda: (...seeds: (string | Uint8Array | PublicKey)[]) =>
      PublicKey.findProgramAddressSync(
        seeds.map((s) =>
          typeof s === "string"
            ? Buffer.from(s)
            : s instanceof PublicKey
              ? s.toBuffer()
              : Buffer.from(s),
        ),
        program.programId,
      )[0],
  };
}
export type Chain = ReturnType<typeof chain>;
export async function account(
  c: Chain,
  name: string,
  id: PublicKey,
): Promise<any> {
  return (c.program.account as any)[name].fetch(id);
}
export async function instruction(
  c: Chain,
  name: string,
  args: unknown[],
  accounts: Record<string, PublicKey>,
) {
  return (c.program.methods as any)
    [name](...args)
    .accountsPartial(accounts)
    .instruction();
}
export async function send(
  c: Chain,
  name: string,
  args: unknown[],
  accounts: Record<string, PublicKey>,
) {
  return (c.program.methods as any)
    [name](...args)
    .accountsPartial(accounts)
    .rpc();
}
