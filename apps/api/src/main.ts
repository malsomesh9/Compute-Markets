import { createServer } from "./server.ts";
import { Indexer } from "../../indexer/src/indexer.ts";
const app = await createServer();
await app.listen({
  port: Number(process.env.API_PORT ?? 4000),
  host: "0.0.0.0",
});
const stopIndexer =
  process.env.RUN_INDEXER === "true" ? await new Indexer().start() : undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void (async () => {
      await stopIndexer?.();
      await app.close();
      process.exit(0);
    })();
  });
