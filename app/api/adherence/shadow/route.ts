import { legacyUnavailable } from "../../../../src/lib/pilot/api";
import { NextResponse } from "next/server";

import {
  clearShadowDecisions,
  getShadowDecisions,
} from "../../../../src/lib/adherenceShadowStore";

export const dynamic = "force-dynamic";

function unavailable() {
  return NextResponse.json(
    { error: "Shadow decisions are only available in local development." },
    { status: 404 },
  );
}

export async function GET(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  if (process.env.NODE_ENV !== "development") return unavailable();
  const patientId = new URL(request.url).searchParams.get("patientId")?.trim();
  const decisions = getShadowDecisions(patientId || undefined);
  return NextResponse.json({
    modelSource: "synthetic",
    patientId: patientId || null,
    decisions,
    count: decisions.length,
  });
}

export async function DELETE(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  if (process.env.NODE_ENV !== "development") return unavailable();
  const patientId = new URL(request.url).searchParams.get("patientId")?.trim();
  clearShadowDecisions(patientId || undefined);
  return NextResponse.json({ cleared: true, patientId: patientId || null });
}
