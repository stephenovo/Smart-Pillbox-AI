import { legacyUnavailable } from "../../../../src/lib/pilot/api";
import { NextResponse } from "next/server";

import { runAdherenceLifecycleTick } from "../../../../src/lib/adherenceLifecycle";
import {
  clearDoseLifecycles,
  getDoseLifecycles,
} from "../../../../src/lib/adherenceLifecycleStore";
import { clearInterventionDecisions } from "../../../../src/lib/interventionStore";
import {
  getHardwareOpeningEvents,
  getHardwarePlan,
  getHardwarePlanEffectiveAt,
} from "../../../../src/lib/hardwareEventStore";
import { DEMO_DEVICE_ID } from "../../../../src/lib/hardwareProtocol";

export const dynamic = "force-dynamic";

type TickRequest = {
  deviceId?: string;
  patientId?: string;
  now?: string;
  scoringHorizonMinutes?: number;
  outcomeMaturityHours?: number;
  backfillDays?: number;
};

function unavailable() {
  return NextResponse.json(
    {
      error:
        "Adherence lifecycle tools are only available in local development.",
    },
    { status: 404 },
  );
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized >= minimum && normalized <= maximum ? normalized : null;
}

export async function GET(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  if (process.env.NODE_ENV !== "development") return unavailable();
  const searchParams = new URL(request.url).searchParams;
  const patientId = searchParams.get("patientId")?.trim();
  const requestedLimit = Number(searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(500, Math.max(1, Math.trunc(requestedLimit)))
    : 100;
  const allRecords = getDoseLifecycles(patientId || undefined);
  const records = allRecords.slice(0, limit);
  return NextResponse.json({
    patientId: patientId || null,
    records,
    count: records.length,
    totalCount: allRecords.length,
    warning:
      "Opening-event labels are behavioural proxies, not proof of ingestion.",
  });
}

export async function POST(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  if (process.env.NODE_ENV !== "development") return unavailable();
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }
  const body = rawBody as TickRequest;
  const deviceId = body.deviceId?.trim() || DEMO_DEVICE_ID;
  const patientId = body.patientId?.trim() || deviceId;
  if (deviceId.length > 64 || patientId.length > 128) {
    return NextResponse.json(
      { error: "deviceId or patientId is too long." },
      { status: 400 },
    );
  }
  const now = body.now ? new Date(body.now) : new Date();
  const scoringHorizonMinutes = boundedNumber(
    body.scoringHorizonMinutes,
    30,
    1,
    1_440,
  );
  const outcomeMaturityHours = boundedNumber(
    body.outcomeMaturityHours,
    24,
    1,
    72,
  );
  const backfillDays = boundedNumber(body.backfillDays, 7, 0, 30);
  if (
    Number.isNaN(now.getTime()) ||
    scoringHorizonMinutes === null ||
    outcomeMaturityHours === null ||
    backfillDays === null
  ) {
    return NextResponse.json(
      { error: "Invalid tick time or lifecycle limits." },
      { status: 400 },
    );
  }
  const summary = await runAdherenceLifecycleTick({
    patientId,
    deviceId,
    plan: getHardwarePlan(deviceId),
    events: getHardwareOpeningEvents(deviceId),
    now,
    scoringHorizonMinutes,
    outcomeMaturityHours,
    backfillDays,
    observationStartedAt: getHardwarePlanEffectiveAt(deviceId),
  });
  return NextResponse.json({
    summary,
    records: getDoseLifecycles(patientId).slice(0, 100),
  });
}

export async function DELETE(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  if (process.env.NODE_ENV !== "development") return unavailable();
  const patientId = new URL(request.url).searchParams.get("patientId")?.trim();
  clearDoseLifecycles(patientId || undefined);
  clearInterventionDecisions(patientId || undefined);
  return NextResponse.json({ cleared: true, patientId: patientId || null });
}
