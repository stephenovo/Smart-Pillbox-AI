const { test } = require("node:test");
const assert = require("node:assert/strict");
const { database } = require("./sqlite.cjs");
const {
  handlePilot,
  legacyUnavailable,
} = require("../.test-build/src/lib/pilot/api.js");
const {
  hashToken,
  parseRegistry,
  createSession,
  authenticate,
} = require("../.test-build/src/lib/pilot/auth.js");
const { PilotStore } = require("../.test-build/src/lib/pilot/store.js");
const {
  tickDevice,
  scheduledInstant,
} = require("../.test-build/src/lib/pilot/scheduler.js");
const tokens = {
  alice: "a".repeat(48),
  bob: "b".repeat(48),
  eve: "e".repeat(48),
  device: "d".repeat(48),
  other: "o".repeat(48),
};
const registry = {
  members: [
    {
      id: "alice",
      familyId: "family-a",
      name: "Alice",
      tokenHash: hashToken(tokens.alice),
    },
    {
      id: "bob",
      familyId: "family-a",
      name: "Bob",
      tokenHash: hashToken(tokens.bob),
    },
    {
      id: "eve",
      familyId: "family-b",
      name: "Eve",
      tokenHash: hashToken(tokens.eve),
    },
  ],
  devices: [
    {
      id: "box-a",
      familyId: "family-a",
      name: "Box A",
      tokenHash: hashToken(tokens.device),
      timeZone: "Asia/Hong_Kong",
    },
    {
      id: "box-b",
      familyId: "family-b",
      name: "Box B",
      tokenHash: hashToken(tokens.other),
      timeZone: "Asia/Hong_Kong",
    },
  ],
};
const env = {
  PILOT_ACCESS_REGISTRY: JSON.stringify(registry),
  PILOT_SESSION_SECRET: "s".repeat(48),
  PILOT_SCHEDULER_SECRET: "t".repeat(48),
};
const now = "2026-11-08T00:00:00.000Z";
const slot = {
  slotId: 1,
  medication: "Existing prescription",
  scheduledTime: "08:00",
  bufferTimeMinutes: 30,
  highRisk: false,
};
function fixture() {
  const db = database();
  async function request(
    resource,
    {
      method = "GET",
      body,
      identity = "alice",
      query = "deviceId=box-a",
      headers = {},
      at = now,
    } = {},
  ) {
    const auth =
      identity === "device"
        ? { "X-Device-Key": tokens.device }
        : identity === "other"
          ? { "X-Device-Key": tokens.other }
          : identity
            ? { Authorization: `Bearer ${tokens[identity]}` }
            : {};
    const req = new Request(
      `https://pillbox.test/api/pilot/${resource}?${query}`,
      {
        method,
        headers: { ...auth, "Content-Type": "application/json", ...headers },
        ...(body !== undefined
          ? { body: typeof body === "string" ? body : JSON.stringify(body) }
          : {}),
      },
    );
    const response = await handlePilot(req, resource, env, () => db, at);
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  }
  return { db, request, store: new PilotStore(db) };
}
async function plan(f) {
  return f.request("plan", {
    method: "POST",
    body: { deviceId: "box-a", slots: [slot], expectedVersion: 0 },
    at: "2026-11-07T23:00:00.000Z",
  });
}
function event(id = "event-000001", extra = {}) {
  return {
    deviceId: "box-a",
    eventId: id,
    slotId: 1,
    eventType: "lid_open",
    deviceTimestamp: now,
    ...extra,
  };
}

test("registry fails closed for missing config, invalid zones and duplicate credentials", () => {
  assert.throws(() => parseRegistry());
  assert.throws(() =>
    parseRegistry(
      JSON.stringify({
        ...registry,
        devices: [{ ...registry.devices[0], timeZone: "Mars/Crater" }],
      }),
    ),
  );
  assert.throws(() =>
    parseRegistry(
      JSON.stringify({
        ...registry,
        members: [registry.members[0], registry.members[0]],
      }),
    ),
  );
});
test("unauthenticated and cross-family reads and writes are denied", async () => {
  const f = fixture();
  assert.equal((await f.request("events", { identity: null })).status, 401);
  for (const resource of ["plan", "events", "state", "tasks", "telemetry"])
    assert.equal((await f.request(resource, { identity: "eve" })).status, 403);
  assert.equal(
    (
      await f.request("plan", {
        method: "POST",
        identity: "eve",
        body: { deviceId: "box-a", slots: [slot], expectedVersion: 0 },
      })
    ).status,
    403,
  );
  assert.equal((await f.request("state", { identity: "other" })).status, 403);
});
test("device cannot change plans, read history, manage tasks or log in as caregiver", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.request("plan", {
        method: "POST",
        identity: "device",
        body: { deviceId: "box-a", slots: [slot], expectedVersion: 0 },
      })
    ).status,
    403,
  );
  for (const resource of ["events", "tasks", "session"])
    assert.equal(
      (await f.request(resource, { identity: "device" })).status,
      403,
    );
  assert.equal(
    (
      await f.request("session", {
        method: "POST",
        identity: null,
        body: { accessCode: tokens.device },
      })
    ).status,
    401,
  );
});
test("caregiver cannot forge hardware observations or heartbeats", async () => {
  const f = fixture();
  assert.equal(
    (await f.request("events", { method: "POST", body: event() })).status,
    403,
  );
  assert.equal(
    (await f.request("state", { query: "deviceId=box-a&heartbeat=1" })).status,
    403,
  );
});
test("session cookie is signed, expiring, HttpOnly, Secure and immediately revocable", async () => {
  const f = fixture();
  const login = await f.request("session", {
    method: "POST",
    identity: null,
    body: { accessCode: tokens.alice },
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.match(login.headers.get("set-cookie"), /Secure/);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const req = new Request("https://pillbox.test", {
    headers: { Cookie: cookie },
  });
  assert.equal(
    authenticate(req, registry, env.PILOT_SESSION_SECRET, Date.parse(now)).id,
    "alice",
  );
  assert.throws(() =>
    authenticate(
      req,
      registry,
      env.PILOT_SESSION_SECRET,
      Date.parse(now) + 8 * 3600000,
    ),
  );
  const rotated = structuredClone(registry);
  rotated.members[0].tokenHash = hashToken("new");
  assert.throws(() =>
    authenticate(req, rotated, env.PILOT_SESSION_SECRET, Date.parse(now)),
  );
  assert.throws(() =>
    authenticate(
      new Request("https://pillbox.test", {
        headers: { Cookie: cookie + "x" },
      }),
      registry,
      env.PILOT_SESSION_SECRET,
      Date.parse(now),
    ),
  );
});
test("cross-origin mutations and originless cookie mutations are rejected", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.request("plan", {
        method: "POST",
        headers: { Origin: "https://attacker.test" },
        body: { deviceId: "box-a", slots: [slot], expectedVersion: 0 },
      })
    ).status,
    403,
  );
  const cookie = `pillbox_session=${createSession(registry.members[0], env.PILOT_SESSION_SECRET, Date.parse(now))}`;
  assert.equal(
    (
      await f.request("session", {
        method: "DELETE",
        identity: null,
        headers: { Cookie: cookie },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("session", {
        method: "DELETE",
        identity: null,
        headers: { Cookie: cookie, Origin: "https://pillbox.test" },
      })
    ).status,
    200,
  );
});
test("login attempts are durably rate limited", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await f.request("session", {
          method: "POST",
          identity: null,
          body: { accessCode: "z".repeat(48) },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await f.request("session", {
        method: "POST",
        identity: null,
        body: { accessCode: tokens.alice },
      })
    ).status,
    429,
  );
});
test("body size, JSON and media type are validated", async () => {
  const f = fixture();
  assert.equal(
    (await f.request("plan", { method: "POST", body: "{broken" })).status,
    400,
  );
  assert.equal(
    (await f.request("plan", { method: "POST", body: "x".repeat(33000) }))
      .status,
    413,
  );
  assert.equal(
    (
      await f.request("plan", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      })
    ).status,
    415,
  );
});
test("plans are versioned and concurrent edits cannot overwrite each other", async () => {
  const f = fixture();
  const first = await plan(f);
  assert.equal(first.status, 200);
  const body = {
    deviceId: "box-a",
    slots: [{ ...slot, medication: "Updated" }],
    expectedVersion: first.body.version,
  };
  const outcomes = await Promise.all([
    f.request("plan", { method: "POST", body }),
    f.request("plan", { method: "POST", body }),
  ]);
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM pilot_plans").get().n,
    2,
  );
  assert.equal(
    f.db.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM pilot_audit WHERE action='plan_updated'",
      )
      .get().n,
    2,
  );
});
test("late retry deduplicates by ID; conflicting reuse returns 409", async () => {
  const f = fixture();
  await plan(f);
  assert.equal(
    (
      await f.request("events", {
        method: "POST",
        identity: "device",
        body: event(),
      })
    ).body.duplicate,
    false,
  );
  assert.equal(
    (
      await f.request("events", {
        method: "POST",
        identity: "device",
        body: event(),
        at: "2026-11-08T06:00:00.000Z",
      })
    ).body.duplicate,
    true,
  );
  assert.equal(
    (
      await f.request("events", {
        method: "POST",
        identity: "device",
        body: event("event-000001", { slotId: 2 }),
      })
    ).status,
    409,
  );
  assert.equal(
    f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM pilot_events").get().n,
    1,
  );
});
test("concurrent copies of one event create one durable record", async () => {
  const f = fixture();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      f.request("events", {
        method: "POST",
        identity: "device",
        body: event(),
      }),
    ),
  );
  assert.equal(results.filter((r) => r.body.duplicate === false).length, 1);
  assert.equal(
    f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM pilot_events").get().n,
    1,
  );
});
test("history retains more than 100 events and pagination has no gaps", async () => {
  const f = fixture();
  for (let i = 0; i < 125; i++)
    await f.request("events", {
      method: "POST",
      identity: "device",
      body: event(`event-${String(i).padStart(8, "0")}`),
    });
  const a = await f.request("events", { query: "deviceId=box-a&limit=100" });
  const b = await f.request("events", {
    query: `deviceId=box-a&limit=100&before=${a.body.nextCursor}`,
  });
  assert.equal(a.body.records.length, 100);
  assert.equal(b.body.records.length, 25);
  assert.equal(b.body.nextCursor, null);
  assert.equal(
    new Set([...a.body.records, ...b.body.records].map((r) => r.eventId)).size,
    125,
  );
  assert.equal((await f.request("events", { method: "DELETE" })).status, 405);
});
test("old observations retain the plan valid at observation time", async () => {
  const f = fixture();
  const first = await plan(f);
  await f.request("plan", {
    method: "POST",
    body: {
      deviceId: "box-a",
      slots: [{ ...slot, medication: "New plan" }],
      expectedVersion: first.body.version,
    },
    at: "2026-11-08T01:00:00.000Z",
  });
  await f.request("events", {
    method: "POST",
    identity: "device",
    body: event(),
    at: "2026-11-08T02:00:00.000Z",
  });
  const record = (await f.request("events")).body.records[0];
  assert.equal(record.planVersion, first.body.version);
  assert.equal(record.opening.medication, "Existing prescription");
});
test("invalid and future timestamps fail; absent observation time remains explicitly unknown", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.request("events", {
        method: "POST",
        identity: "device",
        body: event("event-bad001", { deviceTimestamp: "2026-11-08 08:00" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("events", {
        method: "POST",
        identity: "device",
        body: event("event-bad002", {
          deviceTimestamp: "2099-01-01T00:00:00Z",
        }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("events", {
        method: "POST",
        identity: "device",
        body: event("event-unknown", { deviceTimestamp: undefined }),
      })
    ).status,
    200,
  );
  assert.equal((await f.request("events")).body.records[0].observedAt, null);
});
test("task ownership, stale versions, resolution and audit are enforced", async () => {
  const f = fixture();
  const created = await f.request("tasks", {
    method: "POST",
    body: { deviceId: "box-a", id: "task-00000001", title: "Check in" },
  });
  assert.equal(created.status, 201);
  const update = {
    deviceId: "box-a",
    id: "task-00000001",
    version: 1,
    status: "claimed",
  };
  const competing = await Promise.all([
    f.request("tasks", { method: "PATCH", body: update }),
    f.request("tasks", { method: "PATCH", identity: "bob", body: update }),
  ]);
  assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
  const task = (await f.request("tasks")).body.tasks[0];
  const wrong = task.owner_id === "alice" ? "bob" : "alice";
  const resolve = {
    ...update,
    version: 2,
    status: "resolved",
    resolution: "Family confirmed a changed routine.",
  };
  assert.equal(
    (
      await f.request("tasks", {
        method: "PATCH",
        identity: wrong,
        body: resolve,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request("tasks", {
        method: "PATCH",
        identity: task.owner_id,
        body: { ...resolve, resolution: "" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("tasks", {
        method: "PATCH",
        identity: task.owner_id,
        body: resolve,
      })
    ).status,
    200,
  );
  assert.equal(
    f.db.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM pilot_audit WHERE target_id='task-00000001'",
      )
      .get().n,
    3,
  );
});
test("scheduler catches up within buffer and duplicate ticks queue once", async () => {
  const f = fixture();
  await plan(f);
  const d = registry.devices[0];
  const results = await Promise.all([
    tickDevice(f.store, d, "2026-11-08T00:05:00.000Z"),
    tickDevice(f.store, d, "2026-11-08T00:05:00.000Z"),
  ]);
  assert.equal(
    results.reduce((s, r) => s + r.reminders, 0),
    1,
  );
  assert.equal((await f.store.state(d, now)).activeSlot, 1);
});
test("overdue offline observation creates one followup and clears expired command", async () => {
  const f = fixture();
  await plan(f);
  const d = registry.devices[0];
  await tickDevice(f.store, d, now);
  const late = "2026-11-08T00:31:00.000Z";
  await tickDevice(f.store, d, late);
  await tickDevice(f.store, d, late);
  assert.equal((await f.store.tasks(d)).length, 1);
  assert.equal((await f.store.state(d, late)).status, "idle");
});
test("observed opening prevents an unnecessary scheduler reminder", async () => {
  const f = fixture();
  await plan(f);
  await f.request("events", {
    method: "POST",
    identity: "device",
    body: event(),
  });
  assert.equal(
    (await tickDevice(f.store, registry.devices[0], "2026-11-08T00:05:00.000Z"))
      .reminders,
    0,
  );
});
test("old upload and duplicate retry cannot clear a newer reminder", async () => {
  const f = fixture();
  await plan(f);
  const d = registry.devices[0];
  const p = { kind: "member", id: "alice", familyId: d.familyId };
  await f.request("events", {
    method: "POST",
    identity: "device",
    body: event(),
  });
  await f.store.setState(p, d, "reminding", 1, "2026-11-08T01:00:00.000Z");
  await f.request("events", {
    method: "POST",
    identity: "device",
    body: event(),
    at: "2026-11-08T01:01:00.000Z",
  });
  await f.request("events", {
    method: "POST",
    identity: "device",
    body: event("event-late0001"),
    at: "2026-11-08T01:02:00.000Z",
  });
  assert.equal(
    (await f.store.state(d, "2026-11-08T01:02:00.000Z")).status,
    "reminding",
  );
});
test("fresh correct-slot observation clears its command; wrong-slot does not", async () => {
  const f = fixture();
  await plan(f);
  const d = registry.devices[0];
  await tickDevice(f.store, d, now);
  await f.request("events", {
    method: "POST",
    identity: "device",
    body: event("wrong-slot01", { slotId: 2, eventType: "wrong_slot_open" }),
  });
  assert.equal((await f.store.state(d, now)).status, "reminding");
  await f.request("events", {
    method: "POST",
    identity: "device",
    body: event(),
  });
  assert.equal((await f.store.state(d, now)).status, "idle");
});
test("timezone conversion handles midnight, offsets and nonexistent DST times", () => {
  assert.equal(
    scheduledInstant("2026-11-08", "00:10", "Asia/Hong_Kong"),
    "2026-11-07T16:10:00.000Z",
  );
  assert.equal(
    scheduledInstant("2026-11-08", "08:00", "America/New_York"),
    "2026-11-08T13:00:00.000Z",
  );
  assert.equal(
    scheduledInstant("2026-03-08", "02:30", "America/New_York"),
    null,
  );
});
test("scheduler token is separate from caregiver and device credentials", async () => {
  const f = fixture();
  assert.equal(
    (await f.request("tick", { method: "POST", body: {} })).status,
    401,
  );
  assert.equal(
    (
      await f.request("tick", {
        method: "POST",
        identity: null,
        headers: { Authorization: `Bearer ${env.PILOT_SCHEDULER_SECRET}` },
        body: {},
      })
    ).status,
    200,
  );
});
test("missing database returns controlled error without credentials or payload", async () => {
  const req = new Request(
    "https://pillbox.test/api/pilot/events?deviceId=box-a",
    { headers: { Authorization: `Bearer ${tokens.alice}` } },
  );
  const response = await handlePilot(
    req,
    "events",
    env,
    () => {
      throw new Error("secret-database-password");
    },
    now,
  );
  assert.equal(response.status, 503);
  assert.doesNotMatch(
    await response.text(),
    /secret-database-password|aaaaaaaa/,
  );
});
test("demo API is explicitly disabled in pilot and unknown modes", () => {
  const previous = process.env.PILLBOX_MODE;
  try {
    process.env.PILLBOX_MODE = "pilot";
    assert.equal(legacyUnavailable().status, 404);
    process.env.PILLBOX_MODE = "typo";
    assert.equal(legacyUnavailable().status, 404);
    process.env.PILLBOX_MODE = "demo";
    assert.equal(legacyUnavailable(), null);
  } finally {
    if (previous === undefined) delete process.env.PILLBOX_MODE;
    else process.env.PILLBOX_MODE = previous;
  }
});

test("invalid calendar dates are not silently normalized", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.request("events", {
        method: "POST",
        identity: "device",
        body: event("invalid-date1", {
          deviceTimestamp: "2026-02-30T00:00:00Z",
        }),
      })
    ).status,
    400,
  );
});
test("browser Host normalization works without trusting forwarded hosts", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.request("session", {
        method: "POST",
        identity: null,
        headers: {
          Host: "127.0.0.1:3218",
          Origin: "http://127.0.0.1:3218",
          "X-Forwarded-Host": "attacker.test",
        },
        body: { accessCode: tokens.alice },
      })
    ).status,
    403,
  );
  const req = new Request("http://localhost:3218/api/pilot/session", {
    method: "POST",
    headers: {
      Host: "127.0.0.1:3218",
      Origin: "http://127.0.0.1:3218",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accessCode: tokens.alice }),
  });
  assert.equal(
    (await handlePilot(req, "session", env, () => f.db, now)).status,
    200,
  );
});
test("new plans do not generate retroactive reminders for earlier doses", async () => {
  const f = fixture();
  await f.request("plan", {
    method: "POST",
    body: { deviceId: "box-a", expectedVersion: 0, slots: [slot] },
    at: "2026-11-08T00:10:00.000Z",
  });
  const result = await tickDevice(
    f.store,
    registry.devices[0],
    "2026-11-08T00:35:00.000Z",
  );
  assert.deepEqual(result, { reminders: 0, followups: 0 });
});

test("an active reminder prevents a plan edit from orphaning its command", async () => {
  const f = fixture();
  const saved = await plan(f);
  await tickDevice(f.store, registry.devices[0], now);
  const result = await f.request("plan", {
    method: "POST",
    body: { deviceId: "box-a", expectedVersion: saved.body.version, slots: [] },
  });
  assert.equal(result.status, 409);
  assert.equal(
    (await f.store.plan(registry.devices[0])).version,
    saved.body.version,
  );
});
