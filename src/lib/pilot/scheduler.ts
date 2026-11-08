import type { Device, Principal } from "./auth";
import { PilotStore } from "./store";

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const v = (key: string) => parts.find((p) => p.type === key)!.value;
  return {
    date: `${v("year")}-${v("month")}-${v("day")}`,
    time: `${v("hour")}:${v("minute")}`,
  };
}
// Convert a local wall-clock schedule to UTC. Nonexistent DST times are skipped.
export function scheduledInstant(
  date: string,
  time: string,
  timeZone: string,
): string | null {
  const wall = Date.parse(`${date}T${time}:00Z`);
  let candidate = wall;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(candidate), timeZone);
    const shift = wall - Date.parse(`${p.date}T${p.time}:00Z`);
    if (!shift) return new Date(candidate).toISOString();
    candidate += shift;
  }
  return null;
}
export async function tickDevice(store: PilotStore, d: Device, now: string) {
  await store.ensure(d, now);
  const plan = await store.plan(d);
  const today = localParts(new Date(now), d.timeZone).date;
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
  const principal: Principal = {
    kind: "member",
    id: "scheduler",
    familyId: d.familyId,
  };
  let reminders = 0;
  let followups = 0;
  for (const date of [yesterday, today])
    for (const slot of plan.slots) {
      if (!slot.medication.trim() || !slot.scheduledTime) continue;
      const scheduledAt = scheduledInstant(
        date,
        slot.scheduledTime,
        d.timeZone,
      );
      if (
        !scheduledAt ||
        !plan.createdAt ||
        scheduledAt < plan.createdAt ||
        scheduledAt > now
      )
        continue;
      const deadline = new Date(
        Date.parse(scheduledAt) + slot.bufferTimeMinutes * 60000,
      ).toISOString();
      const from = new Date(Date.parse(scheduledAt) - 60 * 60000).toISOString();
      const opening = await store.db
        .prepare(
          "SELECT sequence FROM pilot_events WHERE family_id=? AND device_id=? AND slot_id=? AND event_type='lid_open' AND observed_at>=? AND observed_at<=? LIMIT 1",
        )
        .bind(d.familyId, d.id, slot.slotId, from, deadline)
        .first();
      if (opening) continue;
      const key = `${date}:${slot.slotId}:${slot.scheduledTime}`;
      if (now >= deadline) {
        const id = `schedule:${d.id}:${key}`;
        const r = await store.db.batch([
          store.db
            .prepare(
              "INSERT INTO pilot_tasks(id,family_id,device_id,title,status,created_at,updated_at) VALUES(?,?,?,?,'open',?,?) ON CONFLICT(id) DO NOTHING",
            )
            .bind(
              id,
              d.familyId,
              d.id,
              `${date} ${slot.scheduledTime} · 药格 ${slot.slotId} 未观察到按时开盒，请核对设备与用药安排`,
              now,
              now,
            ),
          store.db
            .prepare(
              "INSERT INTO pilot_audit(family_id,actor_id,action,target_id,detail_json,created_at) SELECT ?,'scheduler','followup_created',?,'{}',? WHERE changes()=1",
            )
            .bind(d.familyId, id, now),
        ]);
        followups += r[0].meta.changes;
        await store.db
          .prepare(
            "UPDATE pilot_state SET status='idle',active_slot=NULL,scheduled_at=NULL,stage=NULL,trigger_kind=NULL,command_id=NULL,updated_at=? WHERE device_id=? AND family_id=? AND command_id=?",
          )
          .bind(now, d.id, d.familyId, `schedule:${d.id}:${key}`)
          .run();
        continue;
      }
      const command = `schedule:${d.id}:${key}`;
      const r = await store.db.batch([
        store.db
          .prepare(
            "UPDATE pilot_state SET status='reminding',active_slot=?,scheduled_at=?,stage='first',trigger_kind='schedule',command_id=?,updated_at=? WHERE device_id=? AND family_id=? AND status='idle' AND NOT EXISTS(SELECT 1 FROM pilot_schedule_runs WHERE device_id=? AND schedule_key=?) AND (SELECT MAX(version) FROM pilot_plans WHERE family_id=? AND device_id=?)=? AND NOT EXISTS(SELECT 1 FROM pilot_events WHERE family_id=? AND device_id=? AND slot_id=? AND event_type='lid_open' AND observed_at>=? AND observed_at<=?)",
          )
          .bind(
            slot.slotId,
            scheduledAt,
            command,
            now,
            d.id,
            d.familyId,
            d.id,
            key,
            d.familyId,
            d.id,
            plan.version,
            d.familyId,
            d.id,
            slot.slotId,
            from,
            deadline,
          ),
        store.db
          .prepare(
            "INSERT INTO pilot_schedule_runs(device_id,schedule_key,created_at) SELECT ?,?,? WHERE changes()=1 ON CONFLICT(device_id,schedule_key) DO NOTHING",
          )
          .bind(d.id, key, now),
        store.db
          .prepare(
            "INSERT INTO pilot_audit(family_id,actor_id,action,target_id,detail_json,created_at) SELECT ?,?,'reminder_queued',?,'{}',? WHERE changes()=1",
          )
          .bind(d.familyId, principal.id, command, now),
      ]);
      reminders += r[0].meta.changes;
    }
  return { reminders, followups };
}
