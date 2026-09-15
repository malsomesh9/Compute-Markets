import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

export type JournalState =
  "PREPARING" | "RUNNING" | "EVIDENCE_READY" | "RECEIPT_COMMITTED" | "FAILED";

export type Journal = {
  version: 1;
  jobId: string;
  state: JournalState;
  data: Record<string, unknown>;
  updatedAt: string;
  history: Array<{ state: JournalState; at: string }>;
};

export function journalPath(jobId: string) {
  return `keys/journal/${jobId}.json`;
}

export function evidencePath(jobId: string) {
  return `keys/journal/${jobId}-evidence.json`;
}

export function loadJournal(jobId: string): Journal | null {
  const path = journalPath(jobId);
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.jobId !== jobId || typeof value.state !== "string")
    throw new Error("Invalid execution journal");
  return {
    version: 1,
    jobId,
    state: value.state,
    data: value.data ?? {},
    updatedAt: value.updatedAt ?? value.at ?? new Date(0).toISOString(),
    history: value.history ?? [{ state: value.state, at: value.at }],
  };
}

export function recordJournal(
  jobId: string,
  state: JournalState,
  data: Record<string, unknown> = {},
) {
  mkdirSync("keys/journal", { recursive: true });
  const previous = loadJournal(jobId);
  const at = new Date().toISOString();
  const journal: Journal = {
    version: 1,
    jobId,
    state,
    data,
    updatedAt: at,
    history: [...(previous?.history ?? []), { state, at }].slice(-32),
  };
  const path = journalPath(jobId);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
  return journal;
}

export function readEvidence(jobId: string) {
  const path = evidencePath(jobId);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function writeEvidence(jobId: string, bundle: unknown) {
  mkdirSync("keys/journal", { recursive: true });
  const path = evidencePath(jobId);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(bundle), { mode: 0o600 });
  renameSync(temporary, path);
  return path;
}
