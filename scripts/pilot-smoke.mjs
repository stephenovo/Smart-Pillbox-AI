import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const origin = process.argv[2] || "http://127.0.0.1:3218";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Smoke test only accepts a local server.");
const credentials = JSON.parse(
  readFileSync(".pilot-secrets/credentials.json", "utf8"),
);
async function req(resource, method = "GET", body, identity = "caregiver-a") {
  const device = identity === "PILOT-BOX-A";
  const response = await fetch(`${origin}/api/pilot/${resource}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(device
        ? { "X-Device-Key": credentials.devices[identity] }
        : { Authorization: `Bearer ${credentials.caregivers[identity]}` }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
const query = "?deviceId=PILOT-BOX-A";
assert.equal(
  (await req(`events${query}`, "GET", null, "caregiver-c")).status,
  403,
);
const plan = (await req(`plan${query}`)).data;
assert.equal(
  (
    await req("plan", "POST", {
      deviceId: "PILOT-BOX-A",
      expectedVersion: plan.version,
      slots: [
        {
          slotId: 1,
          medication: "本地测试记录",
          scheduledTime: "08:00",
          bufferTimeMinutes: 30,
          highRisk: false,
        },
      ],
    })
  ).status,
  200,
);
const event = {
  deviceId: "PILOT-BOX-A",
  eventId: randomUUID(),
  slotId: 1,
  eventType: "lid_open",
  deviceTimestamp: new Date().toISOString(),
};
assert.equal(
  (await req("events", "POST", event, "PILOT-BOX-A")).data.duplicate,
  false,
);
assert.equal(
  (await req("events", "POST", event, "PILOT-BOX-A")).data.duplicate,
  true,
);
const id = randomUUID();
assert.equal(
  (
    await req("tasks", "POST", {
      deviceId: "PILOT-BOX-A",
      id,
      title: "本地联调：确认设备已连接",
    })
  ).status,
  201,
);
assert.equal(
  (
    await req("tasks", "PATCH", {
      deviceId: "PILOT-BOX-A",
      id,
      version: 1,
      status: "claimed",
    })
  ).status,
  200,
);
assert.equal(
  (
    await req("tasks", "PATCH", {
      deviceId: "PILOT-BOX-A",
      id,
      version: 2,
      status: "resolved",
      resolution: "本地 D1 与 API 联调完成。",
    })
  ).status,
  200,
);
const login = await fetch(`${origin}/api/pilot/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ accessCode: credentials.caregivers["caregiver-a"] }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
assert.equal(
  (await fetch(`${origin}/api/pilot/session`, { headers: { Cookie: cookie } }))
    .status,
  200,
);
assert.equal((await fetch(`${origin}/api/profile`)).status, 404);
console.log(
  "Local D1 smoke passed: login cookie, family isolation, versioned plan, durable retry deduplication, task lifecycle, disabled demo profile.",
);
