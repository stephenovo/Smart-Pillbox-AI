import { legacyUnavailable } from "../../../../src/lib/pilot/api";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { NextResponse } from "next/server";

import {
  addHardwareOpeningEvent,
  clearHardwareOpeningEvents,
  setHardwarePlan,
} from "../../../../src/lib/hardwareEventStore";
import {
  DEMO_DEVICE_ID,
  hardwarePayloadToOpeningEvent,
  validateHardwareEventPayload,
} from "../../../../src/lib/hardwareProtocol";
import { scoreShadowDose } from "../../../../src/lib/adherenceShadow";
import { clearShadowDecisions } from "../../../../src/lib/adherenceShadowStore";
import type {
  HardwareReplayApiResponse,
  HardwareReplaySession,
  HardwarePlanSlot,
} from "../../../../src/types/hardware";
import type { OpeningEvent } from "../../../../src/types/pillbox";

export const dynamic = "force-dynamic";

type ReplayEvent = {
  eventId: string;
  deviceId: string;
  slotId: number;
  eventType: "lid_open" | "wrong_slot_open";
  deviceTimestamp: string;
  receivedAt: string;
  firmwareVersion: string;
};

type ReplayDecision = {
  dose_id: string;
  patient_id: string;
  dose_date: string;
  compartment_id: number;
  scheduled_at: string;
  risk_probability: number;
  behaviour_change_probability: number;
  adaptive_candidate: boolean;
  adaptive_allowed_after_budget: boolean;
  safety_control_evaluation: boolean;
  synthetic_status: string;
  synthetic_needs_support: number;
  synthetic_behaviour_change_signal: number;
  history_features: Record<string, number>;
};

type ReplayBundle = {
  source_patient_id: string;
  latent_persona: string;
  date_range: [string, string];
  observation_started_at: string;
  plan: HardwarePlanSlot[];
  history_events: ReplayEvent[];
  events: ReplayEvent[];
  shadow_decisions: ReplayDecision[];
};

const bundlePath = join(
  process.cwd(),
  ".data",
  "ml",
  "replay",
  "demo_bundle.json",
);
const sessionPath = join(
  process.cwd(),
  ".data",
  "hardware-replay-session.json",
);

function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

function readBundle(): ReplayBundle | null {
  try {
    const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as ReplayBundle;
    if (
      !bundle.source_patient_id ||
      !Array.isArray(bundle.date_range) ||
      bundle.date_range.length !== 2 ||
      !bundle.observation_started_at ||
      !Array.isArray(bundle.plan) ||
      !Array.isArray(bundle.history_events) ||
      !Array.isArray(bundle.events) ||
      !Array.isArray(bundle.shadow_decisions)
    ) {
      return null;
    }
    return bundle;
  } catch {
    return null;
  }
}

function readSession(): HardwareReplaySession | null {
  try {
    return JSON.parse(
      readFileSync(sessionPath, "utf8"),
    ) as HardwareReplaySession;
  } catch {
    return null;
  }
}

function writeSession(session: HardwareReplaySession): void {
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify(session), "utf8");
}

function doseIdFromReplayEvent(event: ReplayEvent): string {
  return event.eventId.replace(/^replay-/, "").replace(/-\d+$/, "");
}

function toOpeningEvent(
  event: ReplayEvent,
  plan: HardwarePlanSlot[],
): OpeningEvent | null {
  const validated = validateHardwareEventPayload({
    deviceId: DEMO_DEVICE_ID,
    slotId: event.slotId,
    eventType: event.eventType,
    deviceTimestamp: event.deviceTimestamp,
    firmwareVersion: event.firmwareVersion,
  });
  if (!validated.ok) return null;
  return hardwarePayloadToOpeningEvent(validated.payload, plan, {
    eventType: event.eventType,
    receivedAt: event.receivedAt,
  });
}

function unavailableResponse(): NextResponse<HardwareReplayApiResponse> {
  return NextResponse.json(
    {
      available: false,
      bundleReady: false,
      session: null,
      error: "Hardware replay is only available in local development.",
    },
    { status: 404 },
  );
}

export async function GET() {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  if (!isDevelopment()) return unavailableResponse();

  return NextResponse.json<HardwareReplayApiResponse>({
    available: true,
    bundleReady: existsSync(bundlePath),
    session: readSession(),
  });
}

export async function POST() {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  if (!isDevelopment()) return unavailableResponse();

  const bundle = readBundle();
  if (!bundle) {
    return NextResponse.json<HardwareReplayApiResponse>(
      {
        available: true,
        bundleReady: false,
        session: null,
        error:
          "Replay bundle is missing or invalid. Run ml/replay_hardware_events.py first.",
      },
      { status: 409 },
    );
  }

  setHardwarePlan(DEMO_DEVICE_ID, bundle.plan);
  clearHardwareOpeningEvents(DEMO_DEVICE_ID);
  clearShadowDecisions(bundle.source_patient_id);
  let recordedEventCount = 0;
  let duplicateEventCount = 0;
  const featureEvents = bundle.history_events
    .map((event) => toOpeningEvent(event, bundle.plan))
    .filter((event): event is OpeningEvent => event !== null);
  const eventsByDose = new Map<string, ReplayEvent[]>();
  for (const event of bundle.events) {
    const doseId = doseIdFromReplayEvent(event);
    eventsByDose.set(doseId, [...(eventsByDose.get(doseId) ?? []), event]);
  }

  const decisions = [];
  try {
    for (const source of [...bundle.shadow_decisions].sort((left, right) =>
      left.scheduled_at.localeCompare(right.scheduled_at),
    )) {
      const slot = bundle.plan.find(
        (item) => item.slotId === source.compartment_id,
      );
      if (!slot) continue;
      const doseEvents = (eventsByDose.get(source.dose_id) ?? []).sort(
        (left, right) => left.receivedAt.localeCompare(right.receivedAt),
      );
      const bufferDeadline =
        new Date(source.scheduled_at).getTime() +
        slot.bufferTimeMinutes * 60_000;
      const observedByBuffer = doseEvents.some(
        (event) => new Date(event.receivedAt).getTime() <= bufferDeadline,
      );
      const decision = await scoreShadowDose({
        patientId: bundle.source_patient_id,
        doseId: source.dose_id,
        doseDate: source.dose_date,
        slot,
        scheduledAt: source.scheduled_at,
        events: featureEvents,
        observationStartedAt: bundle.observation_started_at,
        safetyControlEvaluation: slot.highRisk && !observedByBuffer,
        syntheticStatus: source.synthetic_status,
        syntheticNeedsSupport: source.synthetic_needs_support,
        syntheticBehaviourChangeSignal:
          source.synthetic_behaviour_change_signal,
      });
      decisions.push(decision);

      for (const event of doseEvents) {
        const validated = validateHardwareEventPayload({
          deviceId: DEMO_DEVICE_ID,
          slotId: event.slotId,
          eventType: event.eventType,
          deviceTimestamp: event.deviceTimestamp,
          firmwareVersion: event.firmwareVersion,
        });
        if (!validated.ok) continue;
        const result = addHardwareOpeningEvent(validated.payload, {
          receivedAt: event.receivedAt,
        });
        if (result.duplicate) duplicateEventCount += 1;
        if (result.event && !result.duplicate) {
          recordedEventCount += 1;
          featureEvents.push(result.event);
        }
      }
    }
  } catch (error) {
    return NextResponse.json<HardwareReplayApiResponse>(
      {
        available: true,
        bundleReady: true,
        session: null,
        error:
          error instanceof Error
            ? `Live shadow model unavailable: ${error.message}`
            : "Live shadow model unavailable.",
      },
      { status: 503 },
    );
  }
  const riskValues = decisions.map((decision) => decision.riskProbability);
  const session: HardwareReplaySession = {
    sourcePatientId: bundle.source_patient_id,
    latentPersona: bundle.latent_persona,
    dateRange: bundle.date_range,
    replayedAt: new Date().toISOString(),
    recordedEventCount,
    duplicateEventCount,
    decisions,
    metrics: {
      doseCount: decisions.length,
      adaptiveCandidateCount: decisions.filter(
        (decision) => decision.adaptiveCandidate,
      ).length,
      adaptiveAllowedCount: decisions.filter(
        (decision) => decision.adaptiveAllowedAfterBudget,
      ).length,
      safetyControlCount: decisions.filter(
        (decision) => decision.safetyControlEvaluation,
      ).length,
      averageRiskProbability:
        riskValues.reduce((total, value) => total + value, 0) /
        Math.max(1, riskValues.length),
      maxRiskProbability: Math.max(0, ...riskValues),
    },
  };
  writeSession(session);

  return NextResponse.json<HardwareReplayApiResponse>({
    available: true,
    bundleReady: true,
    session,
  });
}
