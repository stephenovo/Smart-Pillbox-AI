import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  addHardwareOpeningEvent,
  clearHardwareOpeningEvents,
  getHardwareDeviceState,
  getHardwareOpeningEvents,
  getHardwarePlan,
  setHardwareDeviceState,
  setHardwarePlan,
} from "./hardwareEventStore";
import { isHardwareDemoSlot } from "./hardwareDemoConfig";
import { hardwarePayloadToOpeningEvent } from "./hardwareProtocol";
import { isLiveHardwareDevice } from "./liveHardwareAccount";
import {
  getHardwareTelemetry,
  setHardwareTelemetry,
} from "./hardwareTelemetryStore";
import type {
  HardwareDeviceState,
  HardwareEventPayload,
  HardwarePlanSlot,
  HardwareReminderStage,
  HardwareReminderTrigger,
} from "../types/hardware";
import type {
  HardwareTelemetry,
  HardwareTelemetryPayload,
} from "../types/hardwareTelemetry";
import type { OpeningEvent } from "../types/pillbox";

const maxStoredEvents = 100;
const duplicateWindowMs = 1500;
const connectedWindowMs = 20_000;
const hardwareTimeZone = "Asia/Hong_Kong";

type HardwareKV = {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

type HardwareCloudEnv = CloudflareEnv & {
  HARDWARE_DATA?: HardwareKV;
};

type StoredDeviceState = {
  status: "idle" | "reminding";
  activeSlot: number | null;
  scheduledAt: string | null;
  message: string;
  trigger: HardwareReminderTrigger;
  reminderStage: HardwareReminderStage;
  updatedAt: string;
  lastSeenAt: string | null;
  lastEventAt: string | null;
  triggeredScheduleKey?: string | null;
};

function cloudKV(): HardwareKV | null {
  try {
    const context = getCloudflareContext();
    return (context.env as HardwareCloudEnv).HARDWARE_DATA ?? null;
  } catch {
    return null;
  }
}

function storageKey(kind: "events" | "plan" | "state" | "telemetry", deviceId: string) {
  return `hardware:v1:${kind}:${deviceId}`;
}

function createInitialState(now = new Date()): StoredDeviceState {
  return {
    status: "idle",
    activeSlot: null,
    scheduledAt: null,
    message: "No active reminder",
    trigger: null,
    reminderStage: null,
    updatedAt: now.toISOString(),
    lastSeenAt: null,
    lastEventAt: null,
    triggeredScheduleKey: null,
  };
}

function toPublicState(
  deviceId: string,
  state: StoredDeviceState,
  now = new Date()
): HardwareDeviceState {
  const lastSeenMs = state.lastSeenAt
    ? new Date(state.lastSeenAt).getTime()
    : Number.NaN;
  const connectionStatus = !state.lastSeenAt
    ? "never_connected"
    : now.getTime() - lastSeenMs <= connectedWindowMs
      ? "connected"
      : "offline";

  return {
    deviceId,
    status: state.status,
    activeSlot: state.activeSlot,
    scheduledAt: state.scheduledAt,
    message: state.message,
    trigger: state.trigger,
    reminderStage: state.reminderStage,
    updatedAt: state.updatedAt,
    lastSeenAt: state.lastSeenAt,
    lastEventAt: state.lastEventAt,
    connectionStatus,
    serverTime: now.toISOString(),
  };
}

function hongKongDateAndTime(now: Date): { dateKey: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: hardwareTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

async function readState(kv: HardwareKV, deviceId: string): Promise<StoredDeviceState> {
  return (
    (await kv.get<StoredDeviceState>(storageKey("state", deviceId), "json")) ??
    createInitialState()
  );
}

async function writeState(
  kv: HardwareKV,
  deviceId: string,
  state: StoredDeviceState
): Promise<void> {
  await kv.put(storageKey("state", deviceId), JSON.stringify(state));
}

export async function ensureHardwareCloudAccount(deviceId: string): Promise<void> {
  if (!isLiveHardwareDevice(deviceId)) return;
  const kv = cloudKV();
  if (!kv) return;

  const [state, plan] = await Promise.all([
    kv.get<StoredDeviceState>(storageKey("state", deviceId), "json"),
    kv.get<HardwarePlanSlot[]>(storageKey("plan", deviceId), "json"),
  ]);
  const writes: Promise<void>[] = [];
  if (!state) {
    writes.push(writeState(kv, deviceId, createInitialState()));
  }
  if (!plan) {
    writes.push(
      kv.put(storageKey("plan", deviceId), JSON.stringify(getHardwarePlan(deviceId)))
    );
  }
  await Promise.all(writes);
}

export async function getCloudHardwarePlan(
  deviceId: string
): Promise<HardwarePlanSlot[]> {
  if (!isLiveHardwareDevice(deviceId)) return getHardwarePlan(deviceId);
  const kv = cloudKV();
  if (!kv) return getHardwarePlan(deviceId);

  const current = await kv.get<HardwarePlanSlot[]>(
    storageKey("plan", deviceId),
    "json"
  );
  if (current) return current.filter((slot) => isHardwareDemoSlot(slot.slotId));

  const initial = getHardwarePlan(deviceId);
  await kv.put(storageKey("plan", deviceId), JSON.stringify(initial));
  return initial;
}

export async function setCloudHardwarePlan(
  deviceId: string,
  slots: HardwarePlanSlot[]
): Promise<HardwarePlanSlot[]> {
  if (!isLiveHardwareDevice(deviceId)) return setHardwarePlan(deviceId, slots);
  const plan = slots
    .filter((slot) => isHardwareDemoSlot(slot.slotId))
    .map((slot) => ({ ...slot }));
  const kv = cloudKV();
  if (!kv) return setHardwarePlan(deviceId, plan);
  await kv.put(storageKey("plan", deviceId), JSON.stringify(plan));
  return plan;
}

export async function getCloudHardwareEvents(
  deviceId: string
): Promise<OpeningEvent[]> {
  if (!isLiveHardwareDevice(deviceId)) return getHardwareOpeningEvents(deviceId);
  const kv = cloudKV();
  if (!kv) return getHardwareOpeningEvents(deviceId);
  return (
    (await kv.get<OpeningEvent[]>(storageKey("events", deviceId), "json")) ?? []
  );
}

export async function addCloudHardwareEvent(
  payload: HardwareEventPayload,
  options: { receivedAt?: string } = {}
): Promise<{ event: OpeningEvent | null; duplicate: boolean }> {
  if (!isLiveHardwareDevice(payload.deviceId)) {
    return addHardwareOpeningEvent(payload, options);
  }
  const kv = cloudKV();
  if (!kv) return addHardwareOpeningEvent(payload, options);

  const now = new Date();
  const nowIso = now.toISOString();
  const receivedAt = options.receivedAt ?? nowIso;
  const [state, events, plan] = await Promise.all([
    readState(kv, payload.deviceId),
    getCloudHardwareEvents(payload.deviceId),
    getCloudHardwarePlan(payload.deviceId),
  ]);
  const isOpening =
    payload.eventType === "lid_open" || payload.eventType === "wrong_slot_open";
  let nextState: StoredDeviceState = {
    ...state,
    lastSeenAt: nowIso,
    lastEventAt: isOpening ? receivedAt : state.lastEventAt,
  };

  if (!isOpening) {
    await writeState(kv, payload.deviceId, nextState);
    return { event: null, duplicate: false };
  }

  const eventType =
    nextState.status === "reminding" && nextState.activeSlot !== payload.slotId
      ? "wrong_slot_open"
      : payload.eventType === "wrong_slot_open"
        ? "wrong_slot_open"
        : "lid_open";
  const duplicate = events.find((event) => {
    const delta = Math.abs(
      new Date(receivedAt).getTime() - new Date(event.receivedAt).getTime()
    );
    return (
      event.compartment === payload.slotId &&
      event.eventType === eventType &&
      delta < duplicateWindowMs
    );
  });
  if (duplicate) {
    await writeState(kv, payload.deviceId, nextState);
    return { event: duplicate, duplicate: true };
  }

  const event = hardwarePayloadToOpeningEvent(payload, plan, {
    eventType,
    activeSlotAtEvent: nextState.activeSlot,
    receivedAt,
  });
  if (!event) {
    await writeState(kv, payload.deviceId, nextState);
    return { event: null, duplicate: false };
  }

  if (
    eventType === "lid_open" &&
    nextState.status === "reminding" &&
    nextState.activeSlot === payload.slotId
  ) {
    nextState = {
      ...nextState,
      status: "idle",
      activeSlot: null,
      scheduledAt: null,
      message: "No active reminder",
      trigger: null,
      reminderStage: null,
      updatedAt: nowIso,
    };
  }

  await Promise.all([
    kv.put(
      storageKey("events", payload.deviceId),
      JSON.stringify([event, ...events].slice(0, maxStoredEvents))
    ),
    writeState(kv, payload.deviceId, nextState),
  ]);
  return { event, duplicate: false };
}

export async function clearCloudHardwareEvents(deviceId: string): Promise<void> {
  if (!isLiveHardwareDevice(deviceId)) {
    clearHardwareOpeningEvents(deviceId);
    return;
  }
  const kv = cloudKV();
  if (!kv) {
    clearHardwareOpeningEvents(deviceId);
    return;
  }
  await kv.delete(storageKey("events", deviceId));
}

export async function getCloudHardwareState(
  deviceId: string,
  options: { markSeen?: boolean; evaluateSchedule?: boolean } = {}
): Promise<HardwareDeviceState> {
  if (!isLiveHardwareDevice(deviceId)) {
    return getHardwareDeviceState(deviceId, options);
  }
  const kv = cloudKV();
  if (!kv) return getHardwareDeviceState(deviceId, options);

  const now = new Date();
  let state = await readState(kv, deviceId);
  let changed = false;

  if (options.markSeen) {
    state = { ...state, lastSeenAt: now.toISOString() };
    changed = true;
  }

  if (options.evaluateSchedule && state.status !== "reminding") {
    const plan = await getCloudHardwarePlan(deviceId);
    const local = hongKongDateAndTime(now);
    const dueSlot = plan.find(
      (slot) => slot.medication.trim() && slot.scheduledTime === local.time
    );
    if (dueSlot) {
      const scheduleKey = `${local.dateKey}:${dueSlot.slotId}:${dueSlot.scheduledTime}`;
      if (state.triggeredScheduleKey !== scheduleKey) {
        state = {
          ...state,
          status: "reminding",
          activeSlot: dueSlot.slotId,
          scheduledAt: now.toISOString(),
          message: `Open Slot ${dueSlot.slotId}`,
          trigger: "schedule",
          reminderStage: "first",
          updatedAt: now.toISOString(),
          triggeredScheduleKey: scheduleKey,
        };
        changed = true;
      }
    }
  }

  if (changed) await writeState(kv, deviceId, state);
  return toPublicState(deviceId, state, now);
}

export async function setCloudHardwareState(
  deviceId: string,
  status: "idle" | "reminding",
  activeSlot: number | null,
  options: {
    reminderStage?: Exclude<HardwareReminderStage, null>;
  } = {}
): Promise<HardwareDeviceState> {
  if (!isLiveHardwareDevice(deviceId)) {
    return setHardwareDeviceState(deviceId, status, activeSlot, options);
  }
  const kv = cloudKV();
  if (!kv) return setHardwareDeviceState(deviceId, status, activeSlot, options);

  const now = new Date();
  const current = await readState(kv, deviceId);
  const next: StoredDeviceState = {
    ...current,
    status,
    activeSlot: status === "reminding" ? activeSlot : null,
    scheduledAt: status === "reminding" ? now.toISOString() : null,
    message: status === "reminding" ? `Open Slot ${activeSlot}` : "No active reminder",
    trigger: status === "reminding" ? "manual" : null,
    reminderStage:
      status === "reminding" ? options.reminderStage ?? "first" : null,
    updatedAt: now.toISOString(),
  };
  await writeState(kv, deviceId, next);
  return toPublicState(deviceId, next, now);
}

export async function getCloudHardwareTelemetry(
  deviceId: string
): Promise<HardwareTelemetry | null> {
  if (!isLiveHardwareDevice(deviceId)) return getHardwareTelemetry(deviceId);
  const kv = cloudKV();
  if (!kv) return getHardwareTelemetry(deviceId);
  return kv.get<HardwareTelemetry>(storageKey("telemetry", deviceId), "json");
}

export async function setCloudHardwareTelemetry(
  payload: HardwareTelemetryPayload
): Promise<HardwareTelemetry> {
  if (!isLiveHardwareDevice(payload.deviceId)) {
    return setHardwareTelemetry(payload);
  }
  const kv = cloudKV();
  if (!kv) return setHardwareTelemetry(payload);
  const now = new Date().toISOString();
  const telemetry: HardwareTelemetry = {
    ...payload,
    reportedAt: payload.reportedAt ?? now,
    receivedAt: now,
  };
  await kv.put(storageKey("telemetry", payload.deviceId), JSON.stringify(telemetry));
  return telemetry;
}
