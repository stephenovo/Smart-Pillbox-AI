import { legacyUnavailable } from "../../../../src/lib/pilot/api";
import { NextResponse } from "next/server";

import { getInterventionExecutionMode } from "../../../../src/lib/interventionRuntime";
import {
  clearInterventionDecisions,
  getInterventionDecisions,
} from "../../../../src/lib/interventionStore";
import type { AdherenceInterventionsApiResponse } from "../../../../src/types/intervention";

export const dynamic = "force-dynamic";

function unavailable() {
  return NextResponse.json(
    {
      error:
        "Adherence intervention inspection is only available in local development.",
    },
    { status: 404 },
  );
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
  const allDecisions = getInterventionDecisions(patientId || undefined);
  const response: AdherenceInterventionsApiResponse = {
    patientId: patientId || null,
    executionMode: getInterventionExecutionMode(),
    decisions: allDecisions.slice(0, limit),
    count: allDecisions.length,
    warning:
      "A valid scheduled-compartment opening is treated as dose completion. Live caregiver calling remains locked unless explicitly configured and enabled.",
  };
  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  if (process.env.NODE_ENV !== "development") return unavailable();
  const patientId = new URL(request.url).searchParams.get("patientId")?.trim();
  clearInterventionDecisions(patientId || undefined);
  return NextResponse.json({ cleared: true, patientId: patientId || null });
}
