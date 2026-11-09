import type { OpeningEvent } from "./pillbox";

export type HardwareEventType =
  | "lid_open"
  | "wrong_slot_open"
  | "reminder_started"
  | "reminder_stopped";

export type HardwareEventPayload = {
  deviceId: string;
  slotId: number;
  eventType: HardwareEventType;
  deviceTimestamp?: string;
  // Kept for compatibility with the first firmware draft.
  eventTime?: string;
  firmwareVersion?: string;
};

export type HardwareEventsApiResponse = {
  deviceId: string;
  events: OpeningEvent[];
  count: number;
  serverTime: string;
};

export type HardwarePlanSlot = {
  slotId: number;
  medication: string;
  scheduledTime: string;
  highRisk: boolean;
  bufferTimeMinutes: number;
};

export type HardwarePlanApiResponse = {
  deviceId: string;
  slots: HardwarePlanSlot[];
  serverTime: string;
};

export type HardwarePlanUpdatePayload = {
  deviceId: string;
  slots: HardwarePlanSlot[];
};

export type HardwareReminderStatus = "idle" | "reminding";
export type HardwareReminderTrigger = "manual" | "schedule" | "adaptive" | null;
export type HardwareReminderStage = "first" | "second" | null;
export type HardwareConnectionStatus =
  | "connected"
  | "offline"
  | "never_connected";

export type HardwareDeviceState = {
  deviceId: string;
  status: HardwareReminderStatus;
  activeSlot: number | null;
  scheduledAt: string | null;
  message: string;
  trigger: HardwareReminderTrigger;
  reminderStage: HardwareReminderStage;
  updatedAt: string;
  lastSeenAt: string | null;
  lastEventAt: string | null;
  connectionStatus: HardwareConnectionStatus;
  serverTime: string;
};

export type HardwareDeviceStateMutation = {
  deviceId: string;
  status: HardwareReminderStatus;
  activeSlot?: number | null;
  reminderStage?: HardwareReminderStage;
};

export type HardwareShadowDecision = {
  doseId: string;
  patientId: string;
  doseDate: string;
  compartmentId: number;
  scheduledAt: string;
  riskProbability: number;
  behaviourChangeProbability: number;
  adaptiveCandidate: boolean;
  adaptiveAllowedAfterBudget: boolean;
  safetyControlEvaluation: boolean;
  syntheticStatus: string;
  syntheticNeedsSupport: number;
  syntheticBehaviourChangeSignal: number;
  historyFeatures: Record<string, number>;
  modelVersion?: string;
  generatedAt?: string;
  riskThreshold?: number;
  budgetReason?: "allowed" | "below_threshold" | "daily_limit" | "cooldown";
};

export type HardwareReplaySession = {
  sourcePatientId: string;
  latentPersona: string;
  dateRange: [string, string];
  replayedAt: string;
  recordedEventCount: number;
  duplicateEventCount: number;
  decisions: HardwareShadowDecision[];
  metrics: {
    doseCount: number;
    adaptiveCandidateCount: number;
    adaptiveAllowedCount: number;
    safetyControlCount: number;
    averageRiskProbability: number;
    maxRiskProbability: number;
  };
};

export type HardwareReplayApiResponse = {
  available: boolean;
  bundleReady: boolean;
  session: HardwareReplaySession | null;
  error?: string;
};
