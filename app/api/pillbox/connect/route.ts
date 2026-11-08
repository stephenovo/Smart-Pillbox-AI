import { legacyUnavailable } from "../../../../src/lib/pilot/api";
import { NextResponse } from "next/server";

import { ensureHardwareCloudAccount } from "../../../../src/lib/hardwareCloudStore";
import { resolveLiveHardwareAccount } from "../../../../src/lib/liveHardwareAccount";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const connectCode =
    body && typeof body === "object" && "connectCode" in body
      ? String((body as { connectCode?: unknown }).connectCode ?? "")
      : "";
  const account = resolveLiveHardwareAccount(connectCode);
  if (!account) {
    return NextResponse.json(
      { error: "That connection code was not recognised." },
      { status: 404 },
    );
  }

  await ensureHardwareCloudAccount(account.deviceId);
  return NextResponse.json({
    connected: true,
    account,
    serverTime: new Date().toISOString(),
  });
}
