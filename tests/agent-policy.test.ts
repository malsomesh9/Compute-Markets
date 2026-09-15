import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSpecAllowlist,
  proofBytes,
  verifySpecProof,
} from "../packages/agent-policy/index.ts";

const hash = (byte: number) => byte.toString(16).padStart(2, "0").repeat(32);

test("builds and verifies one-leaf allowlists", () => {
  const leaf = hash(7);
  const list = buildSpecAllowlist([leaf]);
  assert.equal(list.root, leaf);
  assert.deepEqual(list.proofs[leaf], []);
  assert.equal(verifySpecProof(leaf, [], list.root), true);
});

test("builds proofs for odd and unordered allowlists", () => {
  const leaves = [hash(9), hash(2), hash(5)];
  const list = buildSpecAllowlist(leaves);
  for (const leaf of leaves) {
    assert.equal(verifySpecProof(leaf, list.proofs[leaf]!, list.root), true);
    assert.ok(
      proofBytes(list.proofs[leaf]!).every((node) => node.length === 32),
    );
  }
  assert.equal(
    verifySpecProof(hash(3), list.proofs[leaves[0]!]!, list.root),
    false,
  );
});

test("rejects malformed and duplicate leaves", () => {
  assert.throws(() => buildSpecAllowlist([]));
  assert.throws(() => buildSpecAllowlist(["nope"]));
  assert.throws(() => buildSpecAllowlist([hash(1), hash(1)]));
});
