import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export async function enforceOpa(input: unknown) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "opa",
      [
        "eval",
        "--stdin-input",
        "--format",
        "json",
        "--data",
        fileURLToPath(
          new URL("../../infra/policy/execution.rego", import.meta.url),
        ),
        "data.vericompute.execution.allow",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      error = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("OPA policy check timed out"));
    }, 5000);
    child.stdout.on("data", (x) => {
      output += x.toString();
      if (output.length > 65536) child.kill("SIGKILL");
    });
    child.stderr.on("data", (x) => {
      error += x.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error("OPA is required on provider hosts", { cause: e }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (
          code !== 0 ||
          JSON.parse(output).result?.[0]?.expressions?.[0]?.value !== true
        )
          throw new Error(`Execution denied by OPA: ${error}`);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
