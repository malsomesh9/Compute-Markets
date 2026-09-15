import { Indexer } from "./indexer.ts";
const stop = await new Indexer().start();
console.log(
  "Indexer running: finalized live subscription, history backfill, 15s reconciliation",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void stop().then(() => process.exit(0));
  });
