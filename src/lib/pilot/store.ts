import { hashToken, PilotError, type Device, type Principal } from "./auth";
import type { Database, Statement } from "./database";
import { hardwarePayloadToOpeningEvent } from "../hardwareProtocol";
import type {
  HardwareEventPayload,
  HardwarePlanSlot,
} from "../../types/hardware";

type StateRow = {
  status: "idle" | "reminding";
  active_slot: number | null;
  scheduled_at: string | null;
  stage: string | null;
  trigger_kind: string | null;
  command_id: string | null;
  updated_at: string;
  last_seen_at: string | null;
  last_event_at: string | null;
  telemetry_json: string | null;
};
export type Plan = {
  version: number;
  slots: HardwarePlanSlot[];
  createdAt: string | null;
};
export type Task = {
  id: string;
  title: string;
  status: "open" | "claimed" | "resolved";
  owner_id: string | null;
  resolution: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
export class PilotStore {
  constructor(public db: Database) {}
  audit(
    p: Principal,
    action: string,
    target: string,
    detail: unknown,
    now: string,
  ): Statement {
    return this.db
      .prepare(
        "INSERT INTO pilot_audit(family_id,actor_id,action,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(p.familyId, p.id, action, target, JSON.stringify(detail), now);
  }
  async ensure(device: Device, now: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO pilot_state(device_id,family_id,updated_at) VALUES(?,?,?) ON CONFLICT(device_id) DO NOTHING",
      )
      .bind(device.id, device.familyId, now)
      .run();
    const row = await this.db
      .prepare("SELECT family_id FROM pilot_state WHERE device_id=?")
      .bind(device.id)
      .first<{ family_id: string }>();
    if (row?.family_id !== device.familyId)
      throw new PilotError(
        409,
        "Device reassignment requires an explicit data migration.",
      );
  }
  async plan(d: Device): Promise<Plan> {
    const row = await this.db
      .prepare(
        "SELECT version,slots_json,created_at FROM pilot_plans WHERE family_id=? AND device_id=? ORDER BY version DESC LIMIT 1",
      )
      .bind(d.familyId, d.id)
      .first<{ version: number; slots_json: string; created_at: string }>();
    return row
      ? {
          version: row.version,
          slots: JSON.parse(row.slots_json),
          createdAt: row.created_at,
        }
      : { version: 0, slots: [], createdAt: null };
  }
  async savePlan(
    p: Principal,
    d: Device,
    slots: HardwarePlanSlot[],
    expectedVersion: number,
    now: string,
  ): Promise<Plan> {
    // Optimistic version check and insert are one SQL statement, preventing lost edits.
    const result = await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO pilot_plans(family_id,device_id,slots_json,actor_id,created_at) SELECT ?,?,?,?,? WHERE COALESCE((SELECT MAX(version) FROM pilot_plans WHERE family_id=? AND device_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM pilot_state WHERE family_id=? AND device_id=? AND status='reminding')",
        )
        .bind(
          d.familyId,
          d.id,
          JSON.stringify(slots),
          p.id,
          now,
          d.familyId,
          d.id,
          expectedVersion,
          d.familyId,
          d.id,
        ),
      this.db
        .prepare(
          "INSERT INTO pilot_audit(family_id,actor_id,action,target_id,detail_json,created_at) SELECT ?,?,'plan_updated',?,?,? WHERE changes()=1",
        )
        .bind(d.familyId, p.id, d.id, JSON.stringify({ expectedVersion }), now),
    ]);
    if (!result[0].meta.changes)
      throw new PilotError(
        409,
        "The plan changed or a reminder is active. Reload the plan and resolve the current reminder before saving.",
      );
    return this.plan(d);
  }
  async events(d: Device, before: number, limit: number) {
    const rows = await this.db
      .prepare(
        "SELECT sequence,event_id,opening_json,payload_json,observed_at,received_at,plan_version FROM pilot_events WHERE family_id=? AND device_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?",
      )
      .bind(d.familyId, d.id, before, limit)
      .all<{
        sequence: number;
        event_id: string;
        opening_json: string | null;
        payload_json: string;
        observed_at: string | null;
        received_at: string;
        plan_version: number | null;
      }>();
    return {
      records: rows.results.map((r) => ({
        sequence: r.sequence,
        eventId: r.event_id,
        opening: r.opening_json ? JSON.parse(r.opening_json) : null,
        payload: JSON.parse(r.payload_json),
        observedAt: r.observed_at,
        receivedAt: r.received_at,
        planVersion: r.plan_version,
      })),
      nextCursor:
        rows.results.length === limit ? rows.results.at(-1)!.sequence : null,
    };
  }
  async ingest(
    d: Device,
    payload: HardwareEventPayload & { eventId: string },
    now: string,
  ) {
    await this.ensure(d, now);
    const historical = payload.deviceTimestamp
      ? await this.db
          .prepare(
            "SELECT version,slots_json,created_at FROM pilot_plans WHERE family_id=? AND device_id=? AND created_at<=? ORDER BY version DESC LIMIT 1",
          )
          .bind(d.familyId, d.id, payload.deviceTimestamp)
          .first<{ version: number; slots_json: string; created_at: string }>()
      : null;
    const plan = payload.deviceTimestamp
      ? historical
        ? {
            version: historical.version,
            slots: JSON.parse(historical.slots_json) as HardwarePlanSlot[],
          }
        : { version: 0, slots: [] }
      : await this.plan(d);
    const state = await this.db
      .prepare("SELECT * FROM pilot_state WHERE device_id=? AND family_id=?")
      .bind(d.id, d.familyId)
      .first<StateRow>();
    const observedAt = payload.deviceTimestamp || null;
    const fingerprint = hashToken(
      JSON.stringify([
        payload.slotId,
        payload.eventType,
        payload.deviceTimestamp ?? null,
        payload.eventTime ?? null,
        payload.firmwareVersion ?? null,
      ]),
    );
    // Late uploads retain the original observation time. Never use current active slot to reinterpret past events.
    const opening = hardwarePayloadToOpeningEvent(payload, plan.slots, {
      receivedAt: now,
    });
    if (opening) opening.id = `pilot-${d.id}-${payload.eventId}`;
    const results = await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO pilot_events(family_id,device_id,event_id,payload_hash,payload_json,opening_json,slot_id,event_type,observed_at,received_at,plan_version) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(device_id,event_id) DO NOTHING",
        )
        .bind(
          d.familyId,
          d.id,
          payload.eventId,
          fingerprint,
          JSON.stringify(payload),
          opening ? JSON.stringify(opening) : null,
          payload.slotId,
          payload.eventType,
          observedAt,
          now,
          plan.version || null,
        ),
      this.db
        .prepare(
          "UPDATE pilot_state SET last_seen_at=?, last_event_at=CASE WHEN ?=1 THEN ? ELSE last_event_at END WHERE device_id=? AND family_id=? AND changes()=1",
        )
        .bind(now, opening ? 1 : 0, now, d.id, d.familyId),
    ]);
    const saved = await this.db
      .prepare(
        "SELECT payload_hash,opening_json FROM pilot_events WHERE device_id=? AND family_id=? AND event_id=?",
      )
      .bind(d.id, d.familyId, payload.eventId)
      .first<{ payload_hash: string; opening_json: string | null }>();
    if (saved?.payload_hash !== fingerprint)
      throw new PilotError(
        409,
        "eventId was already used for different event content.",
      );
    const duplicate = results[0].meta.changes === 0;
    // Only a fresh, timed opening can clear the matching command; an old retry cannot clear a newer reminder.
    if (
      !duplicate &&
      payload.eventType === "lid_open" &&
      observedAt &&
      state?.scheduled_at &&
      observedAt >= state.scheduled_at &&
      state.active_slot === payload.slotId
    ) {
      await this.db
        .prepare(
          "UPDATE pilot_state SET status='idle',active_slot=NULL,scheduled_at=NULL,stage=NULL,trigger_kind=NULL,command_id=NULL,updated_at=? WHERE device_id=? AND family_id=? AND command_id=?",
        )
        .bind(now, d.id, d.familyId, state.command_id)
        .run();
    }
    return {
      accepted: true,
      recorded: !!saved?.opening_json,
      duplicate,
      event: saved?.opening_json ? JSON.parse(saved.opening_json) : null,
    };
  }
  async state(d: Device, now: string, heartbeat = false) {
    await this.ensure(d, now);
    if (heartbeat)
      await this.db
        .prepare(
          "UPDATE pilot_state SET last_seen_at=? WHERE device_id=? AND family_id=?",
        )
        .bind(now, d.id, d.familyId)
        .run();
    const s = (await this.db
      .prepare("SELECT * FROM pilot_state WHERE device_id=? AND family_id=?")
      .bind(d.id, d.familyId)
      .first<StateRow>())!;
    return {
      deviceId: d.id,
      status: s.status,
      activeSlot: s.active_slot,
      scheduledAt: s.scheduled_at,
      reminderStage: s.stage,
      trigger: s.trigger_kind,
      commandId: s.command_id,
      message: s.active_slot
        ? `Open Slot ${s.active_slot}`
        : "No active reminder",
      updatedAt: s.updated_at,
      lastSeenAt: s.last_seen_at,
      lastEventAt: s.last_event_at,
      connectionStatus: !s.last_seen_at
        ? "never_connected"
        : Date.parse(now) - Date.parse(s.last_seen_at) <= 60000
          ? "connected"
          : "offline",
      serverTime: now,
      telemetry: s.telemetry_json ? JSON.parse(s.telemetry_json) : null,
    };
  }
  async setState(
    p: Principal,
    d: Device,
    status: "idle" | "reminding",
    slot: number | null,
    now: string,
    stage: "first" | "second" = "first",
  ) {
    await this.ensure(d, now);
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE pilot_state SET status=?,active_slot=?,scheduled_at=?,stage=?,trigger_kind=?,command_id=?,updated_at=? WHERE device_id=? AND family_id=?",
        )
        .bind(
          status,
          slot,
          status === "reminding" ? now : null,
          status === "reminding" ? stage : null,
          status === "reminding" ? "manual" : null,
          status === "reminding" ? crypto.randomUUID() : null,
          now,
          d.id,
          d.familyId,
        ),
      this.audit(p, "reminder_changed", d.id, { status, slot, stage }, now),
    ]);
    return this.state(d, now);
  }
  async telemetry(d: Device, payload: unknown, now: string) {
    await this.ensure(d, now);
    await this.db
      .prepare(
        "UPDATE pilot_state SET telemetry_json=?,last_seen_at=? WHERE device_id=? AND family_id=?",
      )
      .bind(JSON.stringify(payload), now, d.id, d.familyId)
      .run();
  }
  async tasks(d: Device) {
    return (
      await this.db
        .prepare(
          "SELECT * FROM pilot_tasks WHERE family_id=? AND device_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(d.familyId, d.id)
        .all<Task>()
    ).results;
  }
  async createTask(
    p: Principal,
    d: Device,
    title: string,
    id: string,
    now: string,
  ) {
    const r = await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO pilot_tasks(id,family_id,device_id,title,status,created_at,updated_at) VALUES(?,?,?,?,'open',?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(id, d.familyId, d.id, title, now, now),
      this.db
        .prepare(
          "INSERT INTO pilot_audit(family_id,actor_id,action,target_id,detail_json,created_at) SELECT ?,?,'task_created',?,'{}',? WHERE changes()=1",
        )
        .bind(d.familyId, p.id, id, now),
    ]);
    if (!r[0].meta.changes) {
      const previous = await this.db
        .prepare(
          "SELECT title FROM pilot_tasks WHERE id=? AND family_id=? AND device_id=?",
        )
        .bind(id, d.familyId, d.id)
        .first<{ title: string }>();
      if (previous?.title !== title)
        throw new PilotError(409, "Task identifier already exists.");
    }
    return this.tasks(d);
  }
  async updateTask(
    p: Principal,
    d: Device,
    id: string,
    version: number,
    status: "claimed" | "resolved",
    resolution: string,
    now: string,
  ) {
    const r = await this.db.batch([
      this.db
        .prepare(
          "UPDATE pilot_tasks SET status=?,owner_id=?,resolution=?,version=version+1,updated_at=? WHERE id=? AND family_id=? AND device_id=? AND version=? AND ((?='claimed' AND status='open') OR (?='resolved' AND status='claimed' AND owner_id=?))",
        )
        .bind(
          status,
          p.id,
          resolution || null,
          now,
          id,
          d.familyId,
          d.id,
          version,
          status,
          status,
          p.id,
        ),
      this.db
        .prepare(
          "INSERT INTO pilot_audit(family_id,actor_id,action,target_id,detail_json,created_at) SELECT ?,?,?,?, ?,? WHERE changes()=1",
        )
        .bind(
          d.familyId,
          p.id,
          `task_${status}`,
          id,
          JSON.stringify({ version }),
          now,
        ),
    ]);
    if (!r[0].meta.changes)
      throw new PilotError(
        409,
        "Task changed or belongs to another caregiver. Refresh and try again.",
      );
    return this.tasks(d);
  }
}
