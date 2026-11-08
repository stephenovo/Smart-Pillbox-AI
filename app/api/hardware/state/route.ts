import { appMode } from "../../../../src/lib/pilot/api";
import { pilotRoute } from "../../../../src/lib/pilot/runtime";
import { NextResponse } from "next/server";

import {
  getHardwareOpeningEvents,
  getHardwarePlan,
  getHardwarePlanEffectiveAt,
} from "../../../../src/lib/hardwareEventStore";
import {
  getCloudHardwareState,
  setCloudHardwareState,
} from "../../../../src/lib/hardwareCloudStore";
import { queueAdherenceLifecycleTick } from "../../../../src/lib/adherenceLifecycle";
import {
  DEMO_DEVICE_ID,
  validateHardwareStateMutation,
} from "../../../../src/lib/hardwareProtocol";
import { isHardwareDemoSlot } from "../../../../src/lib/hardwareDemoConfig";

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
  if (appMode() !== "demo") return pilotRoute(request, "state");
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("deviceId")?.trim() || DEMO_DEVICE_ID;
  const isDeviceHeartbeat = searchParams.get("heartbeat") === "1";
  const state = await getCloudHardwareState(deviceId, {
    markSeen: isDeviceHeartbeat,
    evaluateSchedule: isDeviceHeartbeat,
  });
  if (process.env.NODE_ENV === "development" && isDeviceHeartbeat) {
    void queueAdherenceLifecycleTick({
      deviceId,
      plan: getHardwarePlan(deviceId),
      events: getHardwareOpeningEvents(deviceId),
      observationStartedAt: getHardwarePlanEffectiveAt(deviceId),
    }).catch(() => {
      // Heartbeats and the hard reminder path never depend on shadow inference.
    });
  }

  return jsonResponse(state);
}

export async function POST(request: Request) {
  if (appMode() !== "demo") return pilotRoute(request, "state");
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const result = validateHardwareStateMutation(body);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, { status: 400 });
  }

  if (
    result.payload.status === "reminding" &&
    !isHardwareDemoSlot(result.payload.activeSlot)
  ) {
    return jsonResponse(
      { error: "This hardware demo only supports Slot 1 and Slot 2." },
      { status: 400 },
    );
  }

  const state = await setCloudHardwareState(
    result.payload.deviceId,
    result.payload.status,
    result.payload.activeSlot ?? null,
    {
      reminderStage: result.payload.reminderStage ?? undefined,
    },
  );
  return jsonResponse(state);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
