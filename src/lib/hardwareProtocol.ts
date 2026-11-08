import type {
  HardwareDeviceStateMutation,
  HardwareEventPayload,
  HardwarePlanSlot,
  HardwarePlanUpdatePayload,
} from "../types/hardware";
import type { MedicationSchedule, OpeningEvent } from "../types/pillbox";

export const DEMO_DEVICE_ID = "PILLBOX-DEMO-001";

const openingEventTypes = new Set<HardwareEventPayload["eventType"]>([
  "lid_open",
  "wrong_slot_open",
]);

export function formatHardwareEventTime(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

function resolveOpeningTime(
  deviceTimestamp: string | undefined,
  receivedAt: string
): Date {
  if (/^\d{4}-\d{2}-\d{2}T/.test(deviceTimestamp ?? "")) {
    const parsed = new Date(deviceTimestamp as string);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(receivedAt);
}

export function isOpeningHardwareEvent(
  eventType: HardwareEventPayload["eventType"]
): eventType is "lid_open" | "wrong_slot_open" {
  return openingEventTypes.has(eventType);
}

export function validateHardwareEventPayload(
  value: unknown
): { ok: true; payload: HardwareEventPayload } | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Payload must be a JSON object." };
  }

  const payload = value as Partial<HardwareEventPayload>;

  if (
    !payload.deviceId ||
    typeof payload.deviceId !== "string" ||
    payload.deviceId.trim().length === 0 ||
    payload.deviceId.trim().length > 64
  ) {
    return { ok: false, error: "Missing deviceId." };
  }

  const slotId = payload.slotId;

  if (
    typeof slotId !== "number" ||
    !Number.isInteger(slotId) ||
    slotId < 1 ||
    slotId > 8
  ) {
    return { ok: false, error: "slotId must be an integer from 1 to 8." };
  }

  if (
    payload.eventType !== "lid_open" &&
    payload.eventType !== "wrong_slot_open" &&
    payload.eventType !== "reminder_started" &&
    payload.eventType !== "reminder_stopped"
  ) {
    return { ok: false, error: "Unsupported eventType." };
  }

  if (payload.eventTime !== undefined && typeof payload.eventTime !== "string") {
    return { ok: false, error: "eventTime must be a string when provided." };
  }

  if (
    payload.deviceTimestamp !== undefined &&
    typeof payload.deviceTimestamp !== "string"
  ) {
    return {
      ok: false,
      error: "deviceTimestamp must be a string when provided.",
    };
  }

  if (
    payload.firmwareVersion !== undefined &&
    typeof payload.firmwareVersion !== "string"
  ) {
    return {
      ok: false,
      error: "firmwareVersion must be a string when provided.",
    };
  }

  return {
    ok: true,
    payload: {
      deviceId: payload.deviceId.trim(),
      slotId,
      eventType: payload.eventType,
      deviceTimestamp: payload.deviceTimestamp,
      eventTime: payload.eventTime,
      firmwareVersion: payload.firmwareVersion,
    },
  };
}

function isValidTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidPlanSlot(value: unknown): value is HardwarePlanSlot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const slot = value as Partial<HardwarePlanSlot>;
  return (
    Number.isInteger(slot.slotId) &&
    Number(slot.slotId) >= 1 &&
    Number(slot.slotId) <= 8 &&
    typeof slot.medication === "string" &&
    slot.medication.length <= 120 &&
    typeof slot.scheduledTime === "string" &&
    (slot.scheduledTime === "" || isValidTime(slot.scheduledTime)) &&
    typeof slot.highRisk === "boolean" &&
    Number.isInteger(slot.bufferTimeMinutes) &&
    Number(slot.bufferTimeMinutes) >= 1 &&
    Number(slot.bufferTimeMinutes) <= 1440
  );
}

export function validateHardwarePlanPayload(
  value: unknown
):
  | { ok: true; payload: HardwarePlanUpdatePayload }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Payload must be a JSON object." };
  }

  const payload = value as Partial<HardwarePlanUpdatePayload>;
  if (
    !payload.deviceId ||
    typeof payload.deviceId !== "string" ||
    payload.deviceId.trim().length === 0 ||
    payload.deviceId.trim().length > 64
  ) {
    return { ok: false, error: "Missing deviceId." };
  }

  if (!Array.isArray(payload.slots) || !payload.slots.every(isValidPlanSlot)) {
    return { ok: false, error: "slots must contain valid Slot 1-8 plan items." };
  }

  const slotIds = payload.slots.map((slot) => slot.slotId);
  if (new Set(slotIds).size !== slotIds.length) {
    return { ok: false, error: "Each slotId may appear only once." };
  }

  return {
    ok: true,
    payload: {
      deviceId: payload.deviceId.trim(),
      slots: payload.slots,
    },
  };
}

export function validateHardwareStateMutation(
  value: unknown
):
  | { ok: true; payload: HardwareDeviceStateMutation }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Payload must be a JSON object." };
  }

  const payload = value as Partial<HardwareDeviceStateMutation>;
  if (
    !payload.deviceId ||
    typeof payload.deviceId !== "string" ||
    payload.deviceId.trim().length === 0 ||
    payload.deviceId.trim().length > 64
  ) {
    return { ok: false, error: "Missing deviceId." };
  }

  if (payload.status !== "idle" && payload.status !== "reminding") {
    return { ok: false, error: "status must be idle or reminding." };
  }

  if (
    payload.status === "reminding" &&
    (typeof payload.activeSlot !== "number" ||
      !Number.isInteger(payload.activeSlot) ||
      payload.activeSlot < 1 ||
      payload.activeSlot > 8)
  ) {
    return {
      ok: false,
      error: "activeSlot must be an integer from 1 to 8 while reminding.",
    };
  }

  if (
    payload.status === "reminding" &&
    payload.reminderStage !== undefined &&
    payload.reminderStage !== "first" &&
    payload.reminderStage !== "second"
  ) {
    return {
      ok: false,
      error: "reminderStage must be first or second while reminding.",
    };
  }

  return {
    ok: true,
    payload: {
      deviceId: payload.deviceId.trim(),
      status: payload.status,
      activeSlot: payload.status === "reminding" ? payload.activeSlot : null,
      reminderStage:
        payload.status === "reminding"
          ? payload.reminderStage ?? "first"
          : null,
    },
  };
}

export function hardwarePayloadToOpeningEvent(
  payload: HardwareEventPayload,
  schedule: MedicationSchedule[] | HardwarePlanSlot[],
  options: {
    eventType?: "lid_open" | "wrong_slot_open";
    activeSlotAtEvent?: number | null;
    receivedAt?: string;
  } = {}
): OpeningEvent | null {
  if (!isOpeningHardwareEvent(payload.eventType)) {
    return null;
  }

  const scheduleItem = schedule.find((item) =>
    "compartment" in item
      ? item.compartment === payload.slotId
      : item.slotId === payload.slotId
  );
  const receivedAt = options.receivedAt ?? new Date().toISOString();
  const deviceTimestamp = payload.deviceTimestamp ?? payload.eventTime;
  const medication = scheduleItem?.medication || `Slot ${payload.slotId}`;

  return {
    id: `hardware-${globalThis.crypto.randomUUID()}`,
    eventTime: formatHardwareEventTime(
      resolveOpeningTime(deviceTimestamp, receivedAt)
    ),
    receivedAt,
    compartment: payload.slotId,
    medication,
    eventType: options.eventType ?? payload.eventType,
    source: "hardware",
    deviceId: payload.deviceId,
    activeSlotAtEvent: options.activeSlotAtEvent,
    deviceTimestamp,
    firmwareVersion: payload.firmwareVersion,
  };
}
