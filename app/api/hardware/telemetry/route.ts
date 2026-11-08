import { appMode } from "../../../../src/lib/pilot/api";
import { pilotRoute } from "../../../../src/lib/pilot/runtime";
import { NextResponse } from "next/server";

import {
  getCloudHardwareTelemetry,
  setCloudHardwareTelemetry,
} from "../../../../src/lib/hardwareCloudStore";
import { DEMO_DEVICE_ID } from "../../../../src/lib/hardwareProtocol";
import type { HardwareTelemetryPayload } from "../../../../src/types/hardwareTelemetry";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Device-Key",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...corsHeaders, ...init?.headers },
  });
}

function finiteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(maximum, Math.max(minimum, value));
}

function validateTelemetry(
  body: unknown,
):
  | { ok: true; payload: HardwareTelemetryPayload }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Telemetry payload is required." };
  }

  const candidate = body as Record<string, unknown>;
  const deviceId =
    typeof candidate.deviceId === "string" ? candidate.deviceId.trim() : "";
  const firmwareVersion =
    typeof candidate.firmwareVersion === "string"
      ? candidate.firmwareVersion.trim()
      : "";
  const ipAddress =
    typeof candidate.ipAddress === "string" ? candidate.ipAddress.trim() : "";
  const wifiRssi = finiteNumber(candidate.wifiRssi, -120, 0);
  const uptimeMs = finiteNumber(candidate.uptimeMs, 0, Number.MAX_SAFE_INTEGER);
  const freeHeapBytes = finiteNumber(
    candidate.freeHeapBytes,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const uploadQueueDepth = finiteNumber(candidate.uploadQueueDepth, 0, 1000);
  const reminderActive = candidate.reminderActive;
  const activeSlot = candidate.activeSlot;

  if (!deviceId || deviceId.length > 64) {
    return { ok: false, error: "A valid deviceId is required." };
  }
  if (!firmwareVersion || firmwareVersion.length > 80) {
    return { ok: false, error: "A valid firmwareVersion is required." };
  }
  if (!ipAddress || ipAddress.length > 64) {
    return { ok: false, error: "A valid ipAddress is required." };
  }
  if (
    wifiRssi === null ||
    uptimeMs === null ||
    freeHeapBytes === null ||
    uploadQueueDepth === null ||
    typeof reminderActive !== "boolean"
  ) {
    return { ok: false, error: "Telemetry numeric fields are invalid." };
  }
  if (
    activeSlot !== null &&
    (typeof activeSlot !== "number" ||
      !Number.isInteger(activeSlot) ||
      activeSlot < 1 ||
      activeSlot > 8)
  ) {
    return {
      ok: false,
      error: "activeSlot must be null or a slot from 1 to 8.",
    };
  }

  return {
    ok: true,
    payload: {
      deviceId,
      firmwareVersion,
      ipAddress,
      wifiRssi,
      uptimeMs,
      freeHeapBytes,
      uploadQueueDepth,
      reminderActive,
      activeSlot: activeSlot as number | null,
      reportedAt:
        typeof candidate.reportedAt === "string"
          ? candidate.reportedAt
          : undefined,
    },
  };
}

export async function GET(request: Request) {
  if (appMode() !== "demo") return pilotRoute(request, "telemetry");
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("deviceId")?.trim() || DEMO_DEVICE_ID;

  return jsonResponse({
    deviceId,
    telemetry: await getCloudHardwareTelemetry(deviceId),
    serverTime: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  if (appMode() !== "demo") return pilotRoute(request, "telemetry");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const result = validateTelemetry(body);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, { status: 400 });
  }

  return jsonResponse({
    accepted: true,
    telemetry: await setCloudHardwareTelemetry(result.payload),
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
