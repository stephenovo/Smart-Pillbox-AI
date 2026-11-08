import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
const directory = ".pilot-secrets";
if (existsSync(`${directory}/environment.json`)) {
  console.error(
    "Credentials already exist. Back them up and rotate deliberately; nothing was overwritten.",
  );
  process.exit(1);
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
const token = () => randomBytes(32).toString("base64url");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const alice = token(),
  bob = token(),
  eve = token(),
  boxA = token(),
  boxB = token();
const registry = {
  members: [
    {
      id: "caregiver-a",
      familyId: "family-a",
      name: "照护者 A",
      tokenHash: hash(alice),
    },
    {
      id: "caregiver-b",
      familyId: "family-a",
      name: "照护者 B",
      tokenHash: hash(bob),
    },
    {
      id: "caregiver-c",
      familyId: "family-b",
      name: "另一家庭照护者",
      tokenHash: hash(eve),
    },
  ],
  devices: [
    {
      id: "PILOT-BOX-A",
      familyId: "family-a",
      name: "家人的药盒",
      timeZone: "Asia/Hong_Kong",
      tokenHash: hash(boxA),
    },
    {
      id: "PILOT-BOX-B",
      familyId: "family-b",
      name: "另一家庭药盒",
      timeZone: "Asia/Hong_Kong",
      tokenHash: hash(boxB),
    },
  ],
};
const environment = {
  PILLBOX_MODE: "pilot",
  PILOT_ACCESS_REGISTRY: JSON.stringify(registry),
  PILOT_SESSION_SECRET: token(),
  PILOT_SCHEDULER_SECRET: token(),
};
writeFileSync(
  `${directory}/environment.json`,
  JSON.stringify(environment, null, 2),
  { mode: 0o600, flag: "wx" },
);
writeFileSync(
  `${directory}/credentials.json`,
  JSON.stringify(
    {
      caregivers: {
        "caregiver-a": alice,
        "caregiver-b": bob,
        "caregiver-c": eve,
      },
      devices: { "PILOT-BOX-A": boxA, "PILOT-BOX-B": boxB },
    },
    null,
    2,
  ),
  { mode: 0o600, flag: "wx" },
);
if (!existsSync("wrangler.pilot.local.jsonc"))
  writeFileSync(
    "wrangler.pilot.local.jsonc",
    JSON.stringify(
      {
        name: "pillbox-pilot-local",
        main: ".open-next/worker.js",
        compatibility_date: "2026-08-05",
        compatibility_flags: ["nodejs_compat"],
        d1_databases: [
          {
            binding: "PILOT_DB",
            database_name: "pillbox-pilot-local",
            database_id: randomUUID(),
            migrations_dir: "migrations",
          },
        ],
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
console.log(
  "Local-only credentials saved to .pilot-secrets/credentials.json (0600). No credentials were printed. Apply local migrations, then run npm run pilot:dev.",
);
