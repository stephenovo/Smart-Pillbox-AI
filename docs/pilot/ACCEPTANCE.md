# Pilot acceptance and evidence

## Automated checks

Run `npm run check`, `npm run build -- --webpack`, then the local D1 smoke test described in OPERATIONS.md. Tests use the actual migration SQL and an in-memory SQLite adapter for the D1 statement/batch interface; the separate smoke test checks local Wrangler D1. Neither substitutes for staging Cloudflare/physical-device testing.

Regression cases cover:

- Missing configuration, malformed registry, invalid timezone and duplicate credentials fail closed.
- Anonymous and cross-family reads/writes are rejected.
- Device credentials cannot manage plans/tasks or impersonate caregivers.
- Caregivers cannot forge device events or heartbeats.
- Cookie expiration/tampering/revocation, cross-origin requests and body limits.
- Durable login rate limits and controlled infrastructure errors.
- Immutable plans with optimistic concurrency; historical plan association.
- Concurrent event copies, delayed retries and payload-conflict detection.
- Retention beyond 100 records and pagination without gaps.
- Unknown/future/malformed observation timestamps.
- Concurrent task ownership, stale updates, required outcomes and audit history.
- Reminder catch-up, duplicate ticks, offline follow-ups, old uploads versus new commands.
- Timezone and daylight-saving boundaries; separated scheduler credentials.

## Manual release rehearsal

1. Start with two families and two caregivers in one family. Confirm isolation in UI and direct API calls.
2. Use desktop and a narrow mobile viewport; check labels, error announcements, keyboard focus, empty states and no horizontal page overflow.
3. Save a plan, upload an event twice, then upload an old event after creating a new reminder.
4. Have both caregivers claim one task. Only one should succeed. The other should see a refresh/conflict message.
5. Rotate a caregiver hash; an existing cookie must stop working. Rotate a device key; old requests must fail.
6. Stop the device and leave the scheduler running. Confirm a persistent follow-up rather than an invented successful opening.
7. Stop the scheduler too; confirm the external monitor notices it. This monitor is deployment work, not supplied by the unit tests.
8. Export and restore a database backup into a different test database.
9. Compile and test the firmware on the actual box, including NTP unavailable, power loss, wrong slot and queue overflow.

## Explicit next work

- Real-user consent/onboarding, identity provider and scoped caregiver roles.
- iOS authentication/device selection integration with the pilot API.
- Device acknowledgement, flash-persistent event queue and external delivery receipts.
- Approved high-risk escalation policy and notification providers where required.
- Full historical task/audit UI, reassignment and read-access auditing.
- Tested remote deployment, monitoring alerts, retention policy and recovery rehearsal.
- Real-data calibration and controlled intervention studies; synthetic models remain shadow-only.
