-- Append-only event and plan history; no retention truncation.
CREATE TABLE IF NOT EXISTS pilot_plans (
  version INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL, device_id TEXT NOT NULL,
  slots_json TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_plans_device ON pilot_plans(family_id, device_id, version DESC);
CREATE TABLE IF NOT EXISTS pilot_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL, device_id TEXT NOT NULL, event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
  opening_json TEXT, slot_id INTEGER NOT NULL, event_type TEXT NOT NULL,
  observed_at TEXT, received_at TEXT NOT NULL, plan_version INTEGER REFERENCES pilot_plans(version),
  UNIQUE(device_id, event_id)
);
CREATE INDEX IF NOT EXISTS pilot_events_device ON pilot_events(family_id, device_id, sequence DESC);
CREATE TABLE IF NOT EXISTS pilot_state (
  device_id TEXT PRIMARY KEY, family_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle', active_slot INTEGER,
  scheduled_at TEXT, stage TEXT, trigger_kind TEXT, command_id TEXT,
  updated_at TEXT NOT NULL, last_seen_at TEXT, last_event_at TEXT,
  telemetry_json TEXT
);
CREATE TABLE IF NOT EXISTS pilot_tasks (
  id TEXT PRIMARY KEY, family_id TEXT NOT NULL, device_id TEXT NOT NULL,
  title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','claimed','resolved')),
  owner_id TEXT, resolution TEXT, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_tasks_family ON pilot_tasks(family_id, device_id, created_at DESC);
CREATE TABLE IF NOT EXISTS pilot_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, family_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  action TEXT NOT NULL, target_id TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_schedule_runs (
  device_id TEXT NOT NULL, schedule_key TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(device_id, schedule_key)
);
CREATE TABLE IF NOT EXISTS pilot_rate_limits (
  bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
