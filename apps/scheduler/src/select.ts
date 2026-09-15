export type OnChainBid = {
  id: string;
  price: bigint;
  expiresAt: number;
  providerReputation: number;
  estimatedStart: number;
};
// Scheduling is advisory; only the buyer signs an assignment.
export function selectBid(
  bids: OnChainBid[],
  budget: bigint,
  deadline: number,
  now: number,
) {
  return (
    bids
      .filter(
        (b) =>
          b.price > 0n &&
          b.price <= budget &&
          b.expiresAt > now &&
          b.estimatedStart <= deadline,
      )
      .sort((a, b) =>
        a.price === b.price
          ? b.providerReputation - a.providerReputation
          : a.price < b.price
            ? -1
            : 1,
      )[0] ?? null
  );
}
