import {
  authenticate,
  authorizeDevice,
  checkOrigin,
  createSession,
  equalSecret,
  hashToken,
  loginMember,
  parseRegistry,
  PilotError,
  requireMember,
  SESSION_COOKIE,
  SESSION_SECONDS,
  type Registry,
} from "./auth";
import type { Database } from "./database";
import { PilotStore } from "./store";
import { tickDevice } from "./scheduler";
import {
  validateHardwareEventPayload,
  validateHardwarePlanPayload,
  validateHardwareStateMutation,
} from "../hardwareProtocol";

export type PilotEnvironment = {
  PILOT_ACCESS_REGISTRY?: string;
  PILOT_SESSION_SECRET?: string;
  PILOT_SCHEDULER_SECRET?: string;
};
export function appMode(): "demo" | "pilot" | "invalid" {
  const value =
    process.env.PILLBOX_MODE ??
    (process.env.NODE_ENV === "production" ? "pilot" : "demo");
  return value === "demo" || value === "pilot" ? value : "invalid";
}
export function legacyUnavailable(): Response | null {
  return appMode() === "demo"
    ? null
    : Response.json(
        {
          error:
            "This demo endpoint is disabled. Use /pilot for protected care data.",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
}
async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new PilotError(415, "Send application/json.");
  if (Number(request.headers.get("content-length")) > 32768)
    throw new PilotError(413, "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new PilotError(400, "JSON body is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 32768) {
      await reader.cancel();
      throw new PilotError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new PilotError(400, "Body must be a JSON object.");
  }
}
function iso(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new PilotError(
      400,
      "Timestamp must include a valid ISO date and timezone.",
    );
  const [datePart, clockPart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = clockPart.slice(0, 8).split(":").map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new PilotError(
      400,
      "Timestamp contains an invalid calendar date or time.",
    );
  }
  return new Date(value).toISOString();
}
async function rateLimit(
  db: Database,
  key: string,
  limit: number,
  now: number,
  seconds = 60,
) {
  const window = Math.floor(now / (seconds * 1000));
  const bucket = `${key}:${window}`;
  const row = await db
    .prepare(
      "INSERT INTO pilot_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count",
    )
    .bind(bucket, Math.floor(now / 1000) + seconds * 2)
    .first<{ count: number }>();
  if (!row || row.count > limit)
    throw new PilotError(429, "Too many requests. Please try again later.");
}
function sessionCookie(value: string, request: Request, clear = false) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function handlePilot(
  request: Request,
  resource: string,
  env: PilotEnvironment,
  getDatabase: () => Database | Promise<Database>,
  now = new Date().toISOString(),
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const reply = (
    data: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) =>
    Response.json(data, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
        ...headers,
      },
    });
  try {
    checkOrigin(request);
    const registry: Registry = parseRegistry(env.PILOT_ACCESS_REGISTRY);
    if (resource === "session" && request.method === "DELETE")
      return reply({ signedOut: true }, 200, {
        "Set-Cookie": sessionCookie("", request, true),
      });
    if (resource === "session" && request.method === "POST") {
      const db = await getDatabase();
      const ip = request.headers.get("cf-connecting-ip") || "local";
      await rateLimit(db, `login:${hashToken(ip)}`, 10, Date.parse(now), 900);
      const member = loginMember(
        (await jsonBody(request)).accessCode,
        registry,
      );
      return reply({ signedIn: true }, 200, {
        "Set-Cookie": sessionCookie(
          createSession(member, env.PILOT_SESSION_SECRET, Date.parse(now)),
          request,
        ),
      });
    }
    if (resource === "tick" && request.method === "POST") {
      const secret = env.PILOT_SCHEDULER_SECRET;
      const token =
        request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
      if (!secret || secret.length < 32 || !equalSecret(token, secret))
        throw new PilotError(401, "Scheduler credential is required.");
      const db = await getDatabase();
      const store = new PilotStore(db);
      await rateLimit(db, "scheduler", 6, Date.parse(now));
      const results = [];
      for (const device of registry.devices)
        results.push({
          deviceId: device.id,
          ...(await tickDevice(store, device, now)),
        });
      await db
        .prepare("DELETE FROM pilot_rate_limits WHERE expires_at<?")
        .bind(Math.floor(Date.parse(now) / 1000))
        .run();
      return reply({ results, serverTime: now });
    }
    const principal = authenticate(
      request,
      registry,
      env.PILOT_SESSION_SECRET,
      Date.parse(now),
    );
    if (resource === "session" && request.method === "GET") {
      requireMember(principal);
      return reply({
        member: {
          id: principal.id,
          name: registry.members.find((m) => m.id === principal.id)!.name,
        },
        devices: registry.devices
          .filter((d) => d.familyId === principal.familyId)
          .map((d) => ({ id: d.id, name: d.name, timeZone: d.timeZone })),
      });
    }
    const db = await getDatabase();
    const store = new PilotStore(db);
    await rateLimit(
      db,
      `${principal.kind}:${principal.id}`,
      180,
      Date.parse(now),
    );
    if (resource === "ready" && request.method === "GET") {
      requireMember(principal);
      await db.prepare("SELECT COUNT(*) AS count FROM pilot_events").first();
      return reply({ ready: true, storage: "d1", modelMode: "shadow_only" });
    }
    const url = new URL(request.url);
    const body = ["POST", "PUT", "PATCH"].includes(request.method)
      ? await jsonBody(request)
      : {};
    const deviceId = String(
      body.deviceId ?? url.searchParams.get("deviceId") ?? "",
    );
    const device = authorizeDevice(principal, registry, deviceId);
    if (resource === "plan") {
      if (request.method === "GET")
        return reply({
          deviceId,
          ...(await store.plan(device)),
          timeZone: device.timeZone,
          serverTime: now,
        });
      if (request.method === "POST") {
        requireMember(principal);
        const valid = validateHardwarePlanPayload(body);
        if (!valid.ok) throw new PilotError(400, valid.error);
        if (
          !Number.isSafeInteger(body.expectedVersion) ||
          Number(body.expectedVersion) < 0
        )
          throw new PilotError(400, "expectedVersion is required.");
        return reply({
          deviceId,
          ...(await store.savePlan(
            principal,
            device,
            valid.payload.slots,
            Number(body.expectedVersion),
            now,
          )),
          serverTime: now,
        });
      }
    }
    if (resource === "events") {
      if (request.method === "GET") {
        requireMember(principal);
        const before = Number(
          url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER,
        );
        const limit = Number(url.searchParams.get("limit") ?? 50);
        if (
          !Number.isSafeInteger(before) ||
          before < 1 ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 200
        )
          throw new PilotError(400, "Invalid pagination. limit must be 1–200.");
        const page = await store.events(device, before, limit);
        return reply({
          deviceId,
          ...page,
          events: page.records.flatMap((r) => (r.opening ? [r.opening] : [])),
          serverTime: now,
        });
      }
      if (request.method === "POST") {
        if (principal.kind !== "device")
          throw new PilotError(
            403,
            "Only a device can upload observed events.",
          );
        const valid = validateHardwareEventPayload(body);
        if (!valid.ok) throw new PilotError(400, valid.error);
        if (
          typeof body.eventId !== "string" ||
          !/^[A-Za-z0-9_-]{8,100}$/.test(body.eventId)
        )
          throw new PilotError(
            400,
            "A stable eventId is required for retry-safe uploads.",
          );
        const timestamp = iso(body.deviceTimestamp ?? body.eventTime);
        if (timestamp && Date.parse(timestamp) > Date.parse(now) + 300000)
          throw new PilotError(400, "Device clock is too far in the future.");
        if (
          valid.payload.firmwareVersion &&
          valid.payload.firmwareVersion.length > 80
        )
          throw new PilotError(400, "firmwareVersion is too long.");
        return reply(
          await store.ingest(
            device,
            {
              ...valid.payload,
              eventId: body.eventId,
              deviceTimestamp: timestamp,
              eventTime: undefined,
            },
            now,
          ),
        );
      }
      if (request.method === "DELETE")
        throw new PilotError(
          405,
          "Pilot history cannot be cleared through the application.",
        );
    }
    if (resource === "state") {
      if (request.method === "GET") {
        const heartbeat = url.searchParams.get("heartbeat") === "1";
        if (heartbeat && principal.kind !== "device")
          throw new PilotError(403, "Only devices can report heartbeats.");
        if (heartbeat) await tickDevice(store, device, now);
        return reply(await store.state(device, now, heartbeat));
      }
      if (request.method === "POST") {
        requireMember(principal);
        const valid = validateHardwareStateMutation(body);
        if (!valid.ok) throw new PilotError(400, valid.error);
        if (
          valid.payload.status === "reminding" &&
          !(await store.plan(device)).slots.some(
            (s) => s.slotId === valid.payload.activeSlot && s.medication.trim(),
          )
        )
          throw new PilotError(
            400,
            "Save a plan for this slot before reminding.",
          );
        return reply(
          await store.setState(
            principal,
            device,
            valid.payload.status,
            valid.payload.activeSlot ?? null,
            now,
          ),
        );
      }
    }
    if (resource === "telemetry") {
      if (request.method === "GET") {
        requireMember(principal);
        return reply({
          deviceId,
          telemetry: (await store.state(device, now)).telemetry,
          serverTime: now,
        });
      }
      if (request.method === "POST") {
        if (principal.kind !== "device")
          throw new PilotError(403, "Only devices can report telemetry.");
        for (const [key, min, max] of [
          ["wifiRssi", -120, 0],
          ["uptimeMs", 0, Number.MAX_SAFE_INTEGER],
          ["freeHeapBytes", 0, Number.MAX_SAFE_INTEGER],
          ["uploadQueueDepth", 0, 1000],
        ] as const)
          if (
            typeof body[key] !== "number" ||
            !Number.isFinite(body[key]) ||
            Number(body[key]) < min ||
            Number(body[key]) > max
          )
            throw new PilotError(400, `Invalid ${key}.`);
        if (
          typeof body.reminderActive !== "boolean" ||
          !(
            body.activeSlot === null ||
            (Number.isInteger(body.activeSlot) &&
              Number(body.activeSlot) >= 1 &&
              Number(body.activeSlot) <= 8)
          )
        )
          throw new PilotError(400, "Invalid reminder state.");
        const telemetry = {
          firmwareVersion:
            typeof body.firmwareVersion === "string"
              ? body.firmwareVersion.slice(0, 80)
              : "unknown",
          wifiRssi: body.wifiRssi,
          uptimeMs: body.uptimeMs,
          freeHeapBytes: body.freeHeapBytes,
          uploadQueueDepth: body.uploadQueueDepth,
          reminderActive: body.reminderActive,
          activeSlot: body.activeSlot,
          reportedAt: iso(body.reportedAt) ?? now,
          receivedAt: now,
        };
        await store.telemetry(device, telemetry, now);
        return reply({ accepted: true, telemetry });
      }
    }
    if (resource === "tasks") {
      requireMember(principal);
      if (request.method === "GET")
        return reply({ tasks: await store.tasks(device) });
      if (request.method === "POST") {
        if (
          typeof body.title !== "string" ||
          !body.title.trim() ||
          body.title.length > 200 ||
          typeof body.id !== "string" ||
          !/^[a-zA-Z0-9_-]{8,100}$/.test(body.id)
        )
          throw new PilotError(
            400,
            "A task ID and a title of 1–200 characters are required.",
          );
        return reply(
          {
            tasks: await store.createTask(
              principal,
              device,
              body.title.trim(),
              body.id,
              now,
            ),
          },
          201,
        );
      }
      if (request.method === "PATCH") {
        if (
          typeof body.id !== "string" ||
          body.id.length > 200 ||
          !Number.isInteger(body.version) ||
          !(body.status === "claimed" || body.status === "resolved")
        )
          throw new PilotError(400, "Invalid task update.");
        if (
          body.status === "resolved" &&
          (typeof body.resolution !== "string" ||
            !body.resolution.trim() ||
            body.resolution.length > 1000)
        )
          throw new PilotError(
            400,
            "Explain the outcome in 1–1000 characters.",
          );
        return reply({
          tasks: await store.updateTask(
            principal,
            device,
            body.id,
            Number(body.version),
            body.status,
            typeof body.resolution === "string" ? body.resolution.trim() : "",
            now,
          ),
        });
      }
    }
    throw new PilotError(405, "Unsupported operation.");
  } catch (error) {
    if (error instanceof PilotError)
      return reply(
        { error: error.message, requestId },
        error.status,
        error.status === 429 ? { "Retry-After": "60" } : {},
      );
    console.error(
      JSON.stringify({ event: "pilot_request_failed", requestId, resource }),
    );
    return reply(
      {
        error:
          "The service could not complete this request. Please retry or share the request ID with support.",
        requestId,
      },
      503,
    );
  }
}
