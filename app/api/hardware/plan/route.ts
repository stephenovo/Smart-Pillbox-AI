import { appMode } from "../../../../src/lib/pilot/api";
import { pilotRoute } from "../../../../src/lib/pilot/runtime";
import { NextResponse } from "next/server";

import {
  getCloudHardwarePlan,
  setCloudHardwarePlan,
} from "../../../../src/lib/hardwareCloudStore";
import {
  DEMO_DEVICE_ID,
  validateHardwarePlanPayload,
} from "../../../../src/lib/hardwareProtocol";
import type { HardwarePlanApiResponse } from "../../../../src/types/hardware";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Device-Key",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders,
      ...init?.headers,
    },
  });
}

export async function GET(request: Request) {
  if (appMode() !== "demo") return pilotRoute(request, "plan");
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("deviceId")?.trim() || DEMO_DEVICE_ID;
  const response: HardwarePlanApiResponse = {
    deviceId,
    serverTime: new Date().toISOString(),
    slots: await getCloudHardwarePlan(deviceId),
  };

  return jsonResponse(response);
}

export async function POST(request: Request) {
  if (appMode() !== "demo") return pilotRoute(request, "plan");
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const result = validateHardwarePlanPayload(body);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, { status: 400 });
  }

  const slots = await setCloudHardwarePlan(
    result.payload.deviceId,
    result.payload.slots,
  );
  return jsonResponse({
    deviceId: result.payload.deviceId,
    slots,
    serverTime: new Date().toISOString(),
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
