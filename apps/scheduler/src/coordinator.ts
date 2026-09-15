import { createHash, randomUUID } from "node:crypto";

export type LeaseRecord = {
  lease: string;
  owner: string;
  fencingToken: number;
  expiresAt: string;
};

export interface LeaseStore {
  claim(
    lease: string,
    owner: string,
    ttlSeconds: number,
  ): Promise<LeaseRecord | null>;
  release(lease: string, owner: string, fencingToken: number): Promise<boolean>;
}

export function schedulerShard(key: string, shardCount: number): number {
  if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 1024)
    throw new Error("Invalid scheduler shard count");
  const value = createHash("sha256").update(key).digest().readUInt32BE(0);
  return value % shardCount;
}

/**
 * A database-backed lease with fencing tokens. Callers must persist the token
 * with any decision so a scheduler that lost its lease cannot overwrite a
 * newer leader's work.
 */
export class SchedulerCoordinator {
  readonly owner: string;
  private current: LeaseRecord | null = null;

  constructor(
    private store: LeaseStore,
    private lease: string,
    private ttlSeconds = 15,
    owner = randomUUID(),
  ) {
    if (!lease || ttlSeconds < 3 || ttlSeconds > 300)
      throw new Error("Invalid scheduler lease configuration");
    this.owner = owner;
  }

  async acquire() {
    this.current = await this.store.claim(
      this.lease,
      this.owner,
      this.ttlSeconds,
    );
    return this.current;
  }

  async renew() {
    if (!this.current) return null;
    const next = await this.store.claim(
      this.lease,
      this.owner,
      this.ttlSeconds,
    );
    if (!next || next.fencingToken !== this.current.fencingToken) {
      this.current = null;
      return null;
    }
    this.current = next;
    return next;
  }

  assertLeader(token: number) {
    if (!this.current || this.current.fencingToken !== token)
      throw new Error("Scheduler lease lost");
  }

  async release() {
    const lease = this.current;
    this.current = null;
    return lease
      ? this.store.release(lease.lease, lease.owner, lease.fencingToken)
      : false;
  }
}
