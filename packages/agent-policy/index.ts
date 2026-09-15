import { createHash } from "node:crypto";

export type SpecAllowlist = {
  root: string;
  proofs: Record<string, string[]>;
};

type HashBytes = Buffer<ArrayBufferLike>;

const hashPair = (left: HashBytes, right: HashBytes): HashBytes => {
  const ordered =
    Buffer.compare(left, right) <= 0 ? [left, right] : [right, left];
  return createHash("sha256").update(Buffer.concat(ordered)).digest();
};

function parseHash(value: string) {
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(
      "Spec hashes must be 32-byte lowercase or uppercase hex strings",
    );
  }
  return Buffer.from(normalized, "hex");
}

/**
 * Builds the sorted-pair SHA-256 tree verified by the Solana program. Unpaired
 * nodes move to the next level unchanged, so their proof needs no placeholder.
 */
export function buildSpecAllowlist(specHashes: string[]): SpecAllowlist {
  if (!specHashes.length) throw new Error("At least one spec hash is required");
  const normalized = specHashes.map((value) => value.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Duplicate spec hashes are not allowed");
  }
  const leaves = normalized.map(parseHash).sort(Buffer.compare);
  if (leaves.length > 65_536) throw new Error("Spec allowlist is too large");

  const proofs = new Map<string, HashBytes[]>();
  const descendants = new Map<string, string[]>();
  for (const leaf of leaves) {
    const id = leaf.toString("hex");
    proofs.set(id, []);
    descendants.set(id, [id]);
  }

  let level: HashBytes[] = leaves;
  while (level.length > 1) {
    const next: HashBytes[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      const leftId = left.toString("hex");
      const rightId = right.toString("hex");
      for (const leaf of descendants.get(leftId)!)
        proofs.get(leaf)!.push(right);
      for (const leaf of descendants.get(rightId)!)
        proofs.get(leaf)!.push(left);
      const parent = hashPair(left, right);
      const parentId = parent.toString("hex");
      descendants.set(parentId, [
        ...descendants.get(leftId)!,
        ...descendants.get(rightId)!,
      ]);
      next.push(parent);
    }
    level = next;
  }

  return {
    root: level[0]!.toString("hex"),
    proofs: Object.fromEntries(
      [...proofs.entries()].map(([leaf, proof]) => [
        leaf,
        proof.map((value) => value.toString("hex")),
      ]),
    ),
  };
}

export function verifySpecProof(
  specHash: string,
  proof: string[],
  root: string,
) {
  let node: HashBytes = parseHash(specHash);
  if (proof.length > 16) return false;
  for (const sibling of proof) node = hashPair(node, parseHash(sibling));
  return node.equals(parseHash(root));
}

export const proofBytes = (proof: string[]) =>
  proof.map((value) => [...parseHash(value)]);
