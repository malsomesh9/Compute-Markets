import { admin, checked } from "../../../packages/config/backend.ts";
import type { LeaseRecord, LeaseStore } from "./coordinator.ts";

export class InsForgeLeaseStore implements LeaseStore {
  async claim(lease: string, owner: string, ttlSeconds: number) {
    const result = await checked(
      admin.database.rpc("claim_scheduler_lease", {
        p_lease: lease,
        p_owner: owner,
        p_ttl_seconds: ttlSeconds,
      }),
    );
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) return null;
    return {
      lease: row.lease,
      owner: row.owner_id,
      fencingToken: Number(row.fencing_token),
      expiresAt: row.expires_at,
    } satisfies LeaseRecord;
  }

  async release(lease: string, owner: string, fencingToken: number) {
    const result = await checked(
      admin.database.rpc("release_scheduler_lease", {
        p_lease: lease,
        p_owner: owner,
        p_fencing_token: fencingToken,
      }),
    );
    return result === true;
  }
}
