<div align="center">
  <img src="ios/Careloop/Careloop/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png" width="150" alt="Smart Pillbox AI app icon" />
  <h1>Smart Pillbox AI</h1>
  <p><strong>Medication care that feels calm, clear, and connected</strong></p>
  <p>See today's doses · Support someone you love · Manage your own routine · Learn from real pillbox events</p>
  <p>
    <a href="README.md"><strong>English</strong></a>
    ·
    <a href="README.zh-Hant.md">繁體中文</a>
  </p>
  <p>
    <a href="https://github.com/stephenovo/smart-pillbox-ai"><strong>GitHub</strong></a>
    ·
    <a href="ios/Careloop/README.md">Native iOS guide</a>
    ·
    <a href="docs/HARDWARE_MVP_SETUP.md">Hardware setup</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Next.js-16.2-111111?logo=nextdotjs&logoColor=white" alt="Next.js 16.2" />
    <img src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5" />
    <img src="https://img.shields.io/badge/iOS-17%2B-111111?logo=apple" alt="iOS 17+" />
    <img src="https://img.shields.io/badge/TestFlight-1.0%20Build%2014-0D96F6?logo=testflight&logoColor=white" alt="TestFlight 1.0 Build 14" />
  </p>
</div>

<p align="center">
  <img src="public/landing/smart-pillbox-ai-family.jpg" width="920" alt="A family supporting an older adult at home" />
</p>

## Overview

Smart Pillbox AI is an end-to-end medication adherence system for people who
take daily medicines and the family members who support them. A Next.js care
dashboard, a phone-first web view, a native SwiftUI iPhone app, and an ESP32
hardware path all share the same medication and pillbox event API.

The product is intentionally built around two warm, practical experiences:

| Experience | Designed for | What it keeps in focus |
| --- | --- | --- |
| **Circle Care** | Family members and caregivers | Multiple people, medication activity, AI observations, care journal, and clinic handoff context |
| **My Care** | Someone managing their own medicines | Larger type, fewer controls, today's progress, the next dose, and one simple AI check-in |

> **The loop in one sentence:** configure a routine, receive a reminder, record
> a real pillbox opening, turn the event into a clear status, and surface only
> the next useful action.

## Product loop

```mermaid
flowchart LR
    A["Medication plan"] --> B["Local reminder"]
    B --> C["Pillbox lid opens"]
    C --> D["Hardware event API"]
    D --> E["Dose status + history"]
    E --> F["Circle Care or My Care"]
    F --> G["Simple AI insight"]
    G --> A
```

## What is implemented

| Area | Capabilities |
| --- | --- |
| **Two care experiences** | Persistent `Circle Care` and `My Care` mode switching in the web app and native iOS app |
| **Circle Care** | Care circle selection, medication setup, adherence overview, device feed, care messages, profile sync, and detailed insights |
| **My Care** | Larger self-management layout, My Day, My Medicines, AI Check-in, simplified Settings, and no caregiver-only actions |
| **Medication safety** | On-time, late, early, missed, duplicate-opening, wrong-compartment, due-soon, and waiting-for-device states |
| **AI insight** | Rule-based activity analysis plus server-side DeepSeek V4 Flash observations with explicit non-medical-advice boundaries |
| **Hardware bridge** | ESP32-S3 starter firmware, reminder state, lid-event upload, device heartbeat, browser simulator, and the live `20260808` hardware account |
| **Profile and persistence** | `/api/profile`, local profile recovery, medication plan storage, hardware event storage, and native UserDefaults persistence |
| **Native iOS** | SwiftUI app for iOS 17+, TestFlight distribution, live DeepSeek AI Insights separated from human-written Notes, new-pillbox guidebooks, pillbox removal, deliberate mode switching, 12 original family portraits, local photo avatars, live hardware pairing, and an instant `IFF 2026` showcase dataset in Build 14 |
| **Safety boundary** | The system records compartment or lid openings; it does not claim that a person swallowed a medicine or replace clinical advice |

## Screens and experiences

### Native iOS: Circle Care and My Care

The native app keeps one four-tab structure and changes the language and
complexity with the selected experience:

```text
Circle Care                  My Care
Today                        My Day
Meds                         My Medicines
Caregiver AI                 AI Check-in
Settings                     Settings
```

`My Care` is not a reduced medical judgment system. It is a calmer way to see
the same medication plan and real device events without caregiver workflow
overhead.

### Caregiver web dashboard

The desktop web app is optimized for scanning and follow-up:

- medication initialization and buffer-time setup
- dashboard adherence matrix and event log
- device activity and reminder controls
- care messages and profile settings
- full medication risk and clinic-visit insight reports

### Phone-first web view

The `/mobile` route provides a compact caregiver experience with today's
overview, slot control, event polling, an event timeline, and AI insight.

<details>
  <summary><strong>View product imagery</strong></summary>
  <br />
  <p align="center">
    <img src="public/landing/smart-pillbox-ai-hands.jpg" width="48%" alt="Hands resting together in a care setting" />
    <img src="ios/Careloop/Careloop/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png" width="28%" alt="Smart Pillbox AI icon" />
  </p>
</details>

## Architecture

```mermaid
flowchart TB
    subgraph CLIENTS["Care experiences"]
        WEB["Next.js desktop\n/ "]
        MOBILE["Next.js mobile\n/mobile"]
        IOS["SwiftUI native iOS\nCircle Care / My Care"]
    end

    subgraph CORE["Next.js application"]
        UI["React UI + Tailwind CSS"]
        API["Hardware, profile, and insight API routes"]
        RULES["Medication safety + adherence rules"]
        STORE["Cloud KV for live hardware\nLocal stores for demo data"]
    end

    subgraph DEVICE["Physical-device path"]
        SIM["Browser hardware simulator"]
        ESP["ESP32-S3 firmware"]
        BOX["Smart Pillbox lid / reminder hardware"]
    end

    WEB --> API
    MOBILE --> API
    IOS --> API
    SIM --> API
    BOX --> ESP --> API
    API --> RULES --> STORE
    RULES -. optional model summary .-> AI["DeepSeek caregiver insight"]
```

### Design principles

1. **Real events over reassuring fiction.** The dashboard does not invent a
   successful opening event when the device is offline.
2. **Rules before language models.** Dose classification, safety states, and
   caregiver-defined buffers stay deterministic and inspectable.
3. **One source of truth.** Web, mobile, native iOS, and hardware demos use the
   same `/api/hardware/*` contracts.
4. **Different people need different density.** Circle Care supports follow-up;
   My Care keeps the next meaningful piece of information obvious.
5. **No clinical overreach.** AI summaries are plain-language support, not a
   dosage change, diagnosis, or replacement for a clinician.

## Repository layout

```text
smart-pillbox-ai-web/
├── app/                         # Next.js App Router pages and API routes
│   ├── page.tsx                 # Desktop Circle Care / My Care experience
│   ├── mobile/                  # Phone-first caregiver view
│   ├── hardware-simulator/     # Browser-based device event simulator
│   └── api/                     # Hardware, profile, and insight endpoints
├── src/
│   ├── components/              # Product panels and shared UI
│   ├── lib/                     # Safety rules, AI engine, sample data, stores
│   └── types/                   # Hardware, medication, and profile contracts
├── ios/Careloop/                # Native SwiftUI iOS 17+ app
├── hardware/esp32-s3/           # ESP32-S3 starter firmware and wiring notes
├── docs/                        # Hardware MVP setup and checklists
├── public/landing/              # Product imagery used by the landing page
├── package.json                 # Web scripts and dependencies
└── README.md                    # This guide
```

## Quick start

### 1. Web app

Requirements: Node.js 20+, npm, and a modern browser.

```bash
git clone https://github.com/stephenovo/smart-pillbox-ai.git
cd smart-pillbox-ai
npm install
npm run dev
```

Open the main experience at [http://localhost:3000](http://localhost:3000).

| Route | Purpose |
| --- | --- |
| `/` | Desktop care dashboard with Circle Care and My Care |
| `/mobile` | Phone-first caregiver view |
| `/hardware-simulator` | Simulated pillbox reminders and lid openings |
| `/studio` | Physical-device operations, telemetry, commands, and event provenance |
| `/landing` | Product and brand presentation |

### 2. Native iOS app

Requirements: macOS, Xcode 16+, and iOS 17+.

```bash
open ios/Careloop/Careloop.xcodeproj
```

Select the `Careloop` scheme and an iPhone simulator. For live hardware data,
run the web server on port `3100`:

```bash
env -u NODE_OPTIONS npm run dev -- --hostname 127.0.0.1 --port 3100
```

The native app defaults to the production API at `https://smartpb.me` and
device ID `PILLBOX-DEMO-001`. Build 13 automatically migrates the legacy
`127.0.0.1:3100` default to the production endpoint. Both values remain
editable in native Settings for local hardware development.

To pair the production hardware account, add a Pillbox in the iPhone app and
enter connect code `20260808`. The app resolves it to device
`PILLBOX-20260808`; the same account is shown at
[smartpb.me/studio](https://smartpb.me/studio).

For a self-contained App demonstration, enter `IFF 2026`. The app immediately
loads Margaret's four-slot routine, a connected reminder state, seven days of
opening activity, clearly labelled demo Notes, and a report that can generate
a bounded DeepSeek AI Insight. This dataset stays separate from the live
`20260808` hardware account.

Build from the command line:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild \
  -project ios/Careloop/Careloop.xcodeproj \
  -scheme Careloop \
  -sdk iphonesimulator \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
```

### 3. ESP32-S3 hardware path

The current physical MVP runs a verified two-slot loop before expansion to the
full eight-slot prototype:

```text
docs/HARDWARE_MVP_SETUP.md
hardware/esp32-s3/smart_pillbox_demo/smart_pillbox_demo.ino
```

The firmware sends real lid events to:

```text
GET    /api/hardware/plan
POST   /api/hardware/events
GET    /api/hardware/events
GET    /api/hardware/state?deviceId=PILLBOX-20260808
POST   /api/hardware/state
POST   /api/hardware/telemetry
```

The `PILLBOX-20260808` account persists its plan, events, device state, and
telemetry in the deployed Cloudflare KV store. Other demo device IDs continue
to use local demo storage.

## Configuration and safety

- Copy environment examples locally when they are present; never commit live
  API keys, passwords, device credentials, or provisioning secrets.
- `DEEPSEEK_API_KEY` is a server-only secret and must never be exposed through
  `NEXT_PUBLIC_*` or embedded in the iOS app. The deployed route currently uses
  `DEEPSEEK_MODEL=deepseek-v4-flash`.
- The core activity report remains deterministic. DeepSeek only turns that
  structured report into a short observation and never chooses medication,
  dosage, schedules, or medical advice.
- The hardware MVP detects lid or compartment openings, not ingestion.
- Medication names, schedules, dosage decisions, and high-risk classifications
  should be confirmed with a healthcare professional.
- Native profile edits save on the iPhone first and retry server sync after an
  offline edit.

## Verification

```bash
# Web lint and production build
npm run lint
npm run build

# Native simulator build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project ios/Careloop/Careloop.xcodeproj \
  -scheme Careloop -sdk iphonesimulator -configuration Debug \
  CODE_SIGNING_ALLOWED=NO build
```

The current native release line is `1.0 (14)`, distributed through TestFlight
to the internal testing group.

## Documentation

- [Native iOS development and TestFlight](ios/Careloop/README.md)
- [Hardware MVP setup from zero](docs/HARDWARE_MVP_SETUP.md)
- [Hardware API and parts guide](docs/hardware/README.md)
- [Hardware MVP checklist](docs/hardware/MVP_CHECKLIST.md)
- [ESP32-S3 firmware README](hardware/esp32-s3/smart_pillbox_demo/README.md)

## Roadmap

- [x] Circle Care and My Care experiences across web and native iOS
- [x] Hardware event API and browser simulator
- [x] ESP32-S3 firmware and verified two-slot hardware MVP path
- [x] Deterministic medication safety states and caregiver insight reports
- [x] Profile sync with local offline recovery
- [x] Native iOS TestFlight Build 14 with instant `IFF 2026` showcase data, live hardware pairing, and distinct AI Insights and Notes
- [x] Cloud-backed `20260808` account shared by the physical device, Studio, and iPhone app
- [ ] Expand hardware from the MVP loop to a production-ready enclosure
- [ ] Collect real-device adherence history for model calibration
- [ ] Replace the demo connect code with per-device production authentication and observability
- [ ] Complete App Store release workflow and accessibility audit

---

<div align="center">
  <strong>Keep the important medicine moments visible, without making care feel complicated.</strong>
</div>

## Protected family pilot / 家庭照护试点

A separate `/pilot` workflow now provides caregiver sessions, family/device authorization, D1 event and plan history, retry-safe ingestion, deterministic scheduling and shared follow-up tasks. Existing deployments continue in demo mode by default. Set `PILLBOX_MODE=pilot` only after provisioning the protected D1 pilot and its private credentials. Configure and rehearse the pilot before collecting real data.

- [Local setup, deployment and recovery](docs/pilot/OPERATIONS.md)
- [Acceptance checks and remaining work](docs/pilot/ACCEPTANCE.md)
- [技术负责人学习清单（中文）](docs/TECH_LEAD_LEARNING.zh-CN.md)

```sh
npm run check
npm run pilot:credentials
npm run pilot:migrate:local
npm run pilot:dev -- --hostname 127.0.0.1 --port 3218
```
