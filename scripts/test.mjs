import { spawnSync } from "node:child_process";
import { rmSync, readdirSync } from "node:fs";
rmSync(".test-build", { recursive: true, force: true });
let result = spawnSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tests/tsconfig.json"],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const files = readdirSync("tests")
  .filter((f) => f.endsWith(".test.cjs"))
  .map((f) => `tests/${f}`);
result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
