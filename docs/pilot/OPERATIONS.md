# Protected family pilot: operations and boundaries

This branch adds an isolated `/pilot` workflow. Existing showcase pages remain demo-only; they are not silently upgraded into multi-user applications. The pilot uses Cloudflare D1 rather than the demo KV event list. There is no automatic migration of demo data, no automatic model promotion and no automatic phone/SMS sending.

## Run locally

Use Node 24 (the tests use Node's SQLite API), npm and the existing locked dependencies.

```sh
npm ci
npm run check
npm run pilot:credentials
npm run pilot:migrate:local
npm run pilot:dev -- --hostname 127.0.0.1 --port 3218
```

Open `http://127.0.0.1:3218/pilot`. Read your local personal access code from `.pilot-secrets/credentials.json`. This file and `environment.json` are private, mode 0600 and gitignored. The provisioning command refuses to overwrite them. Two independent families and two caregivers in the first family are provisioned for **local testing only**. These are high-entropy access codes, not human-chosen passwords; do not weaken them.

In another terminal:

```sh
node scripts/pilot-smoke.mjs
```

The smoke script accepts localhost only and creates clearly labelled local test records. It verifies real local D1, API login, cross-family isolation, versioned plans, event deduplication and the task lifecycle.

To use the old synthetic demo locally, run `PILLBOX_MODE=demo npm run dev`. Production defaults to protected pilot mode. An unknown mode fails closed. A public synthetic demonstration must explicitly set `PILLBOX_MODE=demo` and must not contain real patient data. Do not deploy this branch over an existing demo until its mode is configured.

## Runtime contract

- `PILLBOX_MODE=pilot`
- `PILOT_DB`: D1 binding with `migrations/0001_pilot.sql` applied.
- `PILOT_ACCESS_REGISTRY`: JSON containing `members` and `devices`; see the credential script for its schema. Members have id, familyId, name and SHA-256 tokenHash. Devices also have their own tokenHash and an IANA timeZone. All caregivers in a family have equal edit access in this pilot.
- `PILOT_SESSION_SECRET`: at least 32 characters, generated randomly.
- `PILOT_SCHEDULER_SECRET`: a separate random secret of at least 32 characters.

Never use `NEXT_PUBLIC_` for credentials. Never place tokens in URLs, issue bodies, screenshots, analytics or logs. Send each caregiver their own code via your approved private onboarding channel. Set HTTPS and appropriate access/rate controls at the hosting edge.

The browser exchanges its code for an eight-hour signed HttpOnly, SameSite=Strict cookie (Secure on HTTPS). Cross-origin mutations are refused. Native/API clients may use a caregiver bearer code. Devices use `X-Device-Key`; device credentials cannot read history, change plans or manage tasks. Removing a member or rotating their hash invalidates their existing sessions immediately. Logging out removes the browser cookie; global revocation requires rotating the credential or signing key.

This is an operator-provisioned pilot login, not a complete self-service identity product. Email verification, invitation delivery, password recovery, MFA, read-only caregiver roles and native iOS login UX remain future work. Device reassignment to another family is refused once it owns stored state; moving devices requires an explicit data migration.

## Data and API

`/api/pilot/session` handles login (POST), account/device listing (GET) and logout (DELETE). After authentication:

| Resource | Methods | Meaning |
| --- | --- | --- |
| `plan?deviceId=...` | GET, POST | Immutable plan versions; POST requires expectedVersion |
| `events?deviceId=...` | GET, POST | Append-only events; GET uses limit 1–200 and exclusive before cursor; POST requires device credential and stable eventId |
| `state?deviceId=...` | GET, POST | Current reminder command; only device GET with heartbeat=1 marks a device seen |
| `telemetry?deviceId=...` | GET, POST | Caregivers read; devices report validated telemetry |
| `tasks?deviceId=...` | GET, POST, PATCH | Create, claim, resolve with version check and resolution note |
| `ready` | GET | Authenticated storage readiness check |
| `tick` | POST | Scheduler-secret-only deterministic schedule scan |

Existing `/api/hardware/{events,plan,state,telemetry}` delegate to the same protected implementation in pilot mode. Other legacy APIs are disabled in pilot mode to avoid exposing shared profiles or synthetic AI reports as real care data.

All queries are scoped to an authorized family/device. Event deduplication uses `(device_id,event_id)` and rejects a reused ID with changed content. There is no 100-event retention cap. The portal paginates history and exports all currently accessible event pages as JSON; an export during ongoing ingestion is not a transactionally consistent database backup. Archive/retention deletion is an operator procedure, not a public DELETE endpoint.

The event's `observedAt` is device-reported, timezone-qualified UTC; `receivedAt` is the server timestamp. Unknown observation time remains null. Plan versions are selected at observation time when known; otherwise the receiving plan is attached. Do not relabel unobserved ingestion as a completed dose. The legacy `opening.eventTime` display field is retained for compatibility; pilot analysis must use the explicit timestamps.

Plan edits are refused while a reminder is active; resolve or explicitly stop that reminder before changing the plan. Plan/task changes and queued reminders are audited. The audit table currently covers these state transitions, not every read or failed login. Follow-up lists show the newest 100 tasks; complete task/audit export currently uses the database export procedure. Follow-ups are persistent and are not automatically marked resolved by a late device event.

## Reminders and scheduler

Device heartbeats evaluate due schedules. For independent operation while devices are offline, configure the separate Worker in `workers/pilot-scheduler.ts` to POST to `/api/pilot/tick` every minute. Its example config uses a placeholder HTTPS origin and has no deployment credentials. Configure the same scheduler secret on both applications using Wrangler's secret mechanism.

The scheduler catches up inside each slot's configured buffer, uses the device's IANA timezone, records each local date/slot/time once, and creates a persistent follow-up when no timed opening is observed by the deadline. A scheduled command expires at the buffer deadline. Multiple due slots are queued serially as the current command clears; the hardware contract has one active slot. Changes apply only to doses scheduled after the plan was saved; plan edits do not reconstruct historical missed-dose judgments. DST nonexistent times are skipped; the repeated local time is processed once. Confirm that these policies match a pilot's intended routines before enrollment.

A queued command is not proof of delivery, sound playback or ingestion. Unknown-time uploads cannot safely clear a scheduled command; investigate the device clock. An old upload/retry cannot clear a newer command. An outage spanning more than the current and previous local calendar day is not automatically backfilled by the scheduler; investigate using the retained event history.

The pilot schedules deterministic reminders and creates caregiver tasks. It does **not** run clinical triage, send emergency calls, activate the synthetic ML model, or claim to replace the earlier demo's high-risk safety policy. If those are required for an enrolled population, implement and validate that integration first. The `highRisk` plan flag is retained, but this pilot workflow does not use it to automate a separate escalation channel.

## Firmware compatibility

The updated ESP32 source adds an event ID at enqueue time, retains it across HTTP retries and attempts NTP synchronization. Observed time is captured when the event is queued, only if a plausible UTC clock exists. Configure the pilot device ID and key in the ignored `config.h`, and use the pilot HTTPS host.

Old firmware without eventId receives HTTP 400 in pilot mode. Do not migrate devices until firmware and credentials are configured. The local event queue still lives in RAM and can be lost on reboot or overflow. Flash-persistent queues and device command acknowledgements are follow-up work. An automatic successful build does not replace physical-device testing.

## Staging, deployment and rollback

1. Use a new staging host/database. Copy `wrangler.pilot.example.jsonc` to a local config, create D1, and replace its placeholder database ID. Keep demo and pilot databases separate.
2. Apply migrations to staging with Wrangler and provision staging-only credentials. Configure secrets privately, never in committed config.
3. Build OpenNext, deploy the staging Worker with that explicit config, then configure the separate scheduler. These actions require your Cloudflare account; this change does not auto-provision or deploy paid resources.
4. Exercise two families, key rotation, offline/reconnect, duplicate upload, wrong-slot opening, conflicting edits, task ownership, midnight and a missed schedule. Run a physical-device rehearsal.
5. Back up production before any migration. Record the application commit, deployed Worker version, database migration and firmware version together.
6. Roll back application code to a compatible Worker version while preserving the database. Do not drop new tables or restore an old backup over fresh production events. If a schema rollback is needed, stop writes and design a forward-compatible repair first.

Suggested export command after configuring your private Wrangler file:

```sh
npx wrangler d1 export PILOT_DB --remote --config YOUR_PRIVATE_CONFIG --output PRIVATE_BACKUP.sql
```

Keep exports outside version control and in approved encrypted storage. Restore into a separate test database with Wrangler execute before trusting a backup procedure. Define consent, access revocation, data retention and deletion handling with the pilot partners before collecting real data.

## Diagnosing failures

- 401: missing, expired or revoked credential. Sign in again; confirm device key privately.
- 403: wrong family/device, wrong principal type or cross-origin mutation. Do not disable authorization to work around it.
- 409: concurrent plan/task change or event ID reused with different contents. Refresh, or fix the device event ID generator.
- 429: rate limit; wait and reduce polling/retries. Login limit is 10 per IP per 15-minute window; authenticated APIs 180 per principal per minute. The login response's Retry-After is advisory; the full login window may still apply.
- 503: configuration, database or runtime failure. The UI includes X-Request-Id in errors; correlate it with logs. Logs intentionally omit credentials and patient payloads.
- No reminders: verify plan timezone/effective date, device heartbeat and scheduler runs. A browser page being open is not a scheduler.

A basic uptime/notification service and real-user operational ownership still need to be configured. The repository has checks and logs; it is not a staffed monitoring service.
