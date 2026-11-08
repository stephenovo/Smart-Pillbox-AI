import { appMode } from "../../../../src/lib/pilot/api";
import { pilotRoute } from "../../../../src/lib/pilot/runtime";
import { NextResponse } from "next/server";

import {
  getHardwarePlan,
  getHardwarePlanEffectiveAt,
} from "../../../../src/lib/hardwareEventStore";
import {
  addCloudHardwareEvent,
  clearCloudHardwareEvents,
  getCloudHardwareEvents,
} from "../../../../src/lib/hardwareCloudStore";
import { queueAdherenceLifecycleTick } from "../../../../src/lib/adherenceLifecycle";
import {
  DEMO_DEVICE_ID,
  validateHardwareEventPayload,
} from "../../../../src/lib/hardwareProtocol";
import { isHardwareDemoSlot } from "../../../../src/lib/hardwareDemoConfig";
import type { HardwareEventsApiResponse } from "../../../../src/types/hardware";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
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
  if (appMode() !== "demo") return pilotRoute(request, "events");
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("deviceId")?.trim() || DEMO_DEVICE_ID;
  const requestedLimit = Number(searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
    : 50;
  const events = (await getCloudHardwareEvents(deviceId)).slice(0, limit);
  const response: HardwareEventsApiResponse = {
    deviceId,
    events,
    count: events.length,
    serverTime: new Date().toISOString(),
  };

  return jsonResponse(response);
}

export async function POST(request: Request) {
  if (appMode() !== "demo") return pilotRoute(request, "events");
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const result = validateHardwareEventPayload(body);

  if (!result.ok) {
    return jsonResponse({ error: result.error }, { status: 400 });
  }

  if (!isHardwareDemoSlot(result.payload.slotId)) {
    return jsonResponse(
      {
        error: "This hardware demo only accepts events from Slot 1 and Slot 2.",
      },
      { status: 400 },
    );
  }

  const { event, duplicate } = await addCloudHardwareEvent(result.payload);
  let lifecycleTickQueued = false;
  if (process.env.NODE_ENV === "development" && event && !duplicate) {
    lifecycleTickQueued = true;
    void queueAdherenceLifecycleTick({
      deviceId: result.payload.deviceId,
      plan: getHardwarePlan(result.payload.deviceId),
      events: await getCloudHardwareEvents(result.payload.deviceId),
      observationStartedAt: getHardwarePlanEffectiveAt(result.payload.deviceId),
    }).catch(() => {
      // The accepted hardware event remains authoritative if shadow work fails.
    });
  }

  return jsonResponse({
    accepted: true,
    recorded: event !== null,
    duplicate,
    event,
    lifecycleTickQueued,
  });
}

export async function DELETE(request: Request) {
  if (appMode() !== "demo") return pilotRoute(request, "events");
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("deviceId")?.trim() || DEMO_DEVICE_ID;
  await clearCloudHardwareEvents(deviceId);
  return jsonResponse({ cleared: true });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
