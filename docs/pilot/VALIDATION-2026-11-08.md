# Verification record — 2026-11-08

Implemented and checked in a separate `codex/pilot-foundation-20261108` worktree based on main commit `b5f7f2d`. Existing uncommitted work in the original project directory was not incorporated or overwritten.

- `npm run check`: ESLint, 28 regression tests and Next/TypeScript checking passed.
- `npm run build -- --webpack`: production build passed. Figtree is now shipped locally with its OFL license, removing build-time Google Fonts downloads.
- Local Cloudflare D1 migration applied successfully. `node scripts/pilot-smoke.mjs` passed against the running Next application and actual Wrangler D1 binding.
- Chrome browser workflow passed at desktop and 390px mobile widths: login, task creation, claim, resolution and logout; no page JavaScript errors and no document-level horizontal overflow. An unsaved plan draft survived task operations and could be explicitly discarded/reloaded.
- ESP32-S3 firmware compiled successfully using `esp32:esp32:esp32s3`, ESP32 core 3.3.11 and placeholder configuration. Build used 1,082,704 bytes flash and 48,816 bytes global RAM. No firmware was flashed.
- Secrets, local D1 state, generated credentials, build output and local browser screenshots are excluded from git.

This validates implementation and local operation. It does not establish real-user benefit, production Cloudflare operation, notification delivery, physical-device operation, clinical suitability or model accuracy. See ACCEPTANCE.md for the staging/field checklist and OPERATIONS.md for rollout and recovery.
