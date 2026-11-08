import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type Member = {
  id: string;
  familyId: string;
  name: string;
  tokenHash: string;
};
export type Device = {
  id: string;
  familyId: string;
  name: string;
  tokenHash: string;
  timeZone: string;
};
export type Registry = { members: Member[]; devices: Device[] };
export type Principal = {
  kind: "member" | "device";
  id: string;
  familyId: string;
};
export class PilotError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const SESSION_COOKIE = "pillbox_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function equalSecret(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function parseRegistry(raw: string | undefined): Registry {
  try {
    const data = JSON.parse(raw || "") as Registry;
    if (
      !Array.isArray(data.members) ||
      !data.members.length ||
      !Array.isArray(data.devices) ||
      !data.devices.length
    )
      throw new Error();
    const ids = new Set<string>();
    const hashes = new Set<string>();
    for (const [kind, rows] of [
      ["member", data.members],
      ["device", data.devices],
    ] as const) {
      for (const row of rows) {
        if (
          typeof row.id !== "string" ||
          typeof row.familyId !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(row.id) ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(row.familyId) ||
          typeof row.name !== "string" ||
          !row.name.trim() ||
          row.name.length > 100 ||
          !/^[a-f0-9]{64}$/.test(row.tokenHash)
        )
          throw new Error();
        if (ids.has(`${kind}:${row.id}`) || hashes.has(row.tokenHash))
          throw new Error();
        ids.add(`${kind}:${row.id}`);
        hashes.add(row.tokenHash);
      }
    }
    for (const device of data.devices) {
      if (!data.members.some((m) => m.familyId === device.familyId))
        throw new Error();
      if (typeof device.timeZone !== "string") throw new Error();
      new Intl.DateTimeFormat("en", { timeZone: device.timeZone }).format();
    }
    return data;
  } catch {
    throw new PilotError(503, "Pilot access configuration is unavailable.");
  }
}
function sessionKey(secret: string | undefined): string {
  if (!secret || secret.length < 32)
    throw new PilotError(503, "Pilot session configuration is unavailable.");
  return secret;
}
export function createSession(
  member: Member,
  secret: string | undefined,
  now = Date.now(),
): string {
  const data = Buffer.from(
    JSON.stringify({
      id: member.id,
      familyId: member.familyId,
      credential: member.tokenHash,
      exp: Math.floor(now / 1000) + SESSION_SECONDS,
    }),
  ).toString("base64url");
  return `${data}.${createHmac("sha256", sessionKey(secret)).update(data).digest("base64url")}`;
}
export function loginMember(token: unknown, registry: Registry): Member {
  if (typeof token !== "string" || token.length < 32 || token.length > 256)
    throw new PilotError(401, "Access code not recognised.");
  const hash = hashToken(token);
  const member = registry.members.find((m) => equalSecret(hash, m.tokenHash));
  if (!member) throw new PilotError(401, "Access code not recognised.");
  return member;
}
export function authenticate(
  request: Request,
  registry: Registry,
  secret: string | undefined,
  now = Date.now(),
): Principal {
  const deviceKey = request.headers.get("x-device-key");
  if (deviceKey) {
    if (deviceKey.length > 256)
      throw new PilotError(401, "Invalid device credential.");
    const device = registry.devices.find((d) =>
      equalSecret(hashToken(deviceKey), d.tokenHash),
    );
    if (!device) throw new PilotError(401, "Invalid device credential.");
    return { kind: "device", id: device.id, familyId: device.familyId };
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (token) {
    const member = loginMember(token, registry);
    return { kind: "member", id: member.id, familyId: member.familyId };
  }
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!cookie || cookie.length > 2048)
    throw new PilotError(401, "Please sign in.");
  const [payload, signature, extra] = cookie.split(".");
  const expected = createHmac("sha256", sessionKey(secret))
    .update(payload || "")
    .digest("base64url");
  if (extra || !signature || !equalSecret(expected, signature))
    throw new PilotError(401, "Please sign in again.");
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    const member = registry.members.find(
      (m) =>
        m.id === value.id &&
        m.familyId === value.familyId &&
        equalSecret(m.tokenHash, value.credential || ""),
    );
    if (
      !member ||
      !Number.isFinite(value.exp) ||
      value.exp <= Math.floor(now / 1000) ||
      value.exp > Math.floor(now / 1000) + SESSION_SECONDS
    )
      throw new Error();
    return { kind: "member", id: member.id, familyId: member.familyId };
  } catch {
    throw new PilotError(401, "Please sign in again.");
  }
}
export function requireMember(principal: Principal): void {
  if (principal.kind !== "member")
    throw new PilotError(403, "Caregiver access is required.");
}
export function authorizeDevice(
  principal: Principal,
  registry: Registry,
  id: string,
): Device {
  const device = registry.devices.find(
    (d) => d.id === id && d.familyId === principal.familyId,
  );
  if (!device || (principal.kind === "device" && principal.id !== id))
    throw new PilotError(403, "Device access is not permitted.");
  return device;
}
export function checkOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const hasCookie = request.headers
    .get("cookie")
    ?.includes(`${SESSION_COOKIE}=`);
  const url = new URL(request.url);
  // Next's local adapter can normalize request.url to localhost. Host is the
  // browser-selected request authority, unlike untrusted X-Forwarded-Host.
  const requestOrigin = request.headers.get("host")
    ? `${url.protocol}//${request.headers.get("host")}`
    : url.origin;
  if (
    (origin && origin !== requestOrigin) ||
    (hasCookie &&
      !origin &&
      !request.headers.has("authorization") &&
      !request.headers.has("x-device-key"))
  ) {
    throw new PilotError(
      403,
      "Use the same-origin application for this action.",
    );
  }
}
