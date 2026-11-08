import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
let config;
try {
  config = JSON.parse(readFileSync(".pilot-secrets/environment.json", "utf8"));
} catch {
  console.error(
    "Run npm run pilot:credentials and npm run pilot:migrate:local first.",
  );
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...config,
      PILOT_WRANGLER_CONFIG: "wrangler.pilot.local.jsonc",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
