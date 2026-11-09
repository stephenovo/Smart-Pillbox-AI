"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BellRing,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Gauge,
  HardDrive,
  History,
  House,
  LoaderCircle,
  MemoryStick,
  Pill,
  Radio,
  RefreshCw,
  Router,
  RotateCcw,
  ShieldCheck,
  Signal,
  Square,
  Wifi,
  WifiOff,
  Wrench,
  Zap,
} from "lucide-react";

import {
  LIVE_HARDWARE_CONNECT_CODE,
  LIVE_HARDWARE_DEVICE_ID,
} from "../../src/lib/liveHardwareAccount";
import type {
  HardwareDeviceState,
  HardwareEventsApiResponse,
  HardwarePlanApiResponse,
  HardwarePlanSlot,
  HardwareReminderStage,
} from "../../src/types/hardware";
import type {
  HardwareTelemetry,
  HardwareTelemetryApiResponse,
} from "../../src/types/hardwareTelemetry";
import type { OpeningEvent } from "../../src/types/pillbox";

type LoadState = "loading" | "ready" | "error";
type ShowcasePhase = "ready" | "first" | "quiet" | "second" | "completed";

const FIRST_ALERT_DURATION_MS = 6_000;
const QUIET_WINDOW_MS = 8_000;

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-HK", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return "Waiting for telemetry";
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "Waiting for telemetry";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function signalLabel(rssi: number | undefined): string {
  if (rssi === undefined) return "Unknown";
  if (rssi >= -55) return "Excellent";
  if (rssi >= -67) return "Good";
  if (rssi >= -75) return "Fair";
  return "Weak";
}

function eventIsSimulation(event: OpeningEvent): boolean {
  return event.firmwareVersion?.startsWith("web-hardware-simulator") ?? false;
}

function eventIsStudioTest(event: OpeningEvent): boolean {
  return event.firmwareVersion?.startsWith("studio-link-test") ?? false;
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "warning";
}) {
  const tones = {
    neutral: "bg-cream-deep text-ink-soft",
    good: "bg-mint-soft text-mint-ink",
    warning: "bg-honey-soft text-honey-ink",
  };

  return (
    <article className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon aria-hidden="true" size={19} />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </p>
      <p className="mt-2 truncate text-xl font-bold text-ink">{value}</p>
      <p className="mt-1 truncate text-xs text-ink-soft">{detail}</p>
    </article>
  );
}

export default function StudioConsole() {
  const [deviceState, setDeviceState] = useState<HardwareDeviceState | null>(null);
  const [telemetry, setTelemetry] = useState<HardwareTelemetry | null>(null);
  const [events, setEvents] = useState<OpeningEvent[]>([]);
  const [plan, setPlan] = useState<HardwarePlanSlot[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [commandPending, setCommandPending] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [showcaseSlot, setShowcaseSlot] = useState(1);
  const [showcasePhase, setShowcasePhase] = useState<ShowcasePhase>("ready");
  const [showcaseStartedAt, setShowcaseStartedAt] = useState<string | null>(null);
  const showcaseRunToken = useRef(0);
  const resetInProgress = useRef(false);
  const studioRequestId = useRef(0);

  const loadStudio = useCallback(async (quiet = false) => {
    if (resetInProgress.current) return;
    const requestId = ++studioRequestId.current;
    if (!quiet) setLoadState("loading");

    try {
      const deviceId = encodeURIComponent(LIVE_HARDWARE_DEVICE_ID);
      const [stateResponse, telemetryResponse, eventsResponse, planResponse] =
        await Promise.all([
          fetch(`/api/hardware/state?deviceId=${deviceId}`, { cache: "no-store" }),
          fetch(`/api/hardware/telemetry?deviceId=${deviceId}`, {
            cache: "no-store",
          }),
          fetch(`/api/hardware/events?deviceId=${deviceId}&limit=40`, {
            cache: "no-store",
          }),
          fetch(`/api/hardware/plan?deviceId=${deviceId}`, { cache: "no-store" }),
        ]);

      if (
        !stateResponse.ok ||
        !telemetryResponse.ok ||
        !eventsResponse.ok ||
        !planResponse.ok
      ) {
        throw new Error("Studio could not reach the hardware service.");
      }

      const [nextState, telemetryData, eventsData, planData] = await Promise.all([
        stateResponse.json() as Promise<HardwareDeviceState>,
        telemetryResponse.json() as Promise<HardwareTelemetryApiResponse>,
        eventsResponse.json() as Promise<HardwareEventsApiResponse>,
        planResponse.json() as Promise<HardwarePlanApiResponse>,
      ]);

      if (requestId !== studioRequestId.current) return;
      setDeviceState(nextState);
      setTelemetry(telemetryData.telemetry);
      setEvents(eventsData.events);
      setPlan(planData.slots);
      setLastRefreshAt(new Date().toISOString());
      setLoadState("ready");
    } catch (error) {
      if (requestId !== studioRequestId.current) return;
      setLoadState("error");
      setNotice(error instanceof Error ? error.message : "Studio refresh failed.");
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadStudio();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadStudio]);

  useEffect(() => {
    if (!autoRefresh) return;
    const intervalId = window.setInterval(() => {
      void loadStudio(true);
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadStudio]);

  useEffect(() => {
    if (!showcaseStartedAt || showcasePhase === "ready" || showcasePhase === "completed") {
      return;
    }

    const completedByPhysicalOpening = events.some(
      (event) =>
        !eventIsSimulation(event) &&
        !eventIsStudioTest(event) &&
        event.compartment === showcaseSlot &&
        new Date(event.receivedAt).getTime() >=
          new Date(showcaseStartedAt).getTime()
    );
    if (!completedByPhysicalOpening) return;

    const timeoutId = window.setTimeout(() => {
      showcaseRunToken.current += 1;
      setShowcasePhase("completed");
      setNotice(
        `Dose Completed: physical Slot ${showcaseSlot} opening detected. All later reminders were cancelled.`
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [events, showcasePhase, showcaseSlot, showcaseStartedAt]);

  const isConnected = deviceState?.connectionStatus === "connected";
  const simulatedEventCount = useMemo(
    () => events.filter(eventIsSimulation).length,
    [events]
  );
  const studioTestEventCount = useMemo(
    () => events.filter(eventIsStudioTest).length,
    [events]
  );
  const realEventCount = events.length - simulatedEventCount - studioTestEventCount;
  const activePlan = plan.find((slot) => slot.slotId === showcaseSlot);

  async function sendReminderCommand(
    status: "idle" | "reminding",
    reminderStage: Exclude<HardwareReminderStage, null>,
    slotId: number
  ): Promise<void> {
    const response = await fetch("/api/hardware/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: LIVE_HARDWARE_DEVICE_ID,
        status,
        activeSlot: status === "reminding" ? slotId : null,
        reminderStage: status === "reminding" ? reminderStage : null,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? "Command was not accepted.");
    }
    await loadStudio(true);
  }

  async function physicalOpeningOccurredSince(
    startedAt: string,
    slotId: number
  ): Promise<boolean> {
    const deviceId = encodeURIComponent(LIVE_HARDWARE_DEVICE_ID);
    const response = await fetch(
      `/api/hardware/events?deviceId=${deviceId}&limit=40`,
      { cache: "no-store" }
    );
    if (!response.ok) return false;
    const data = (await response.json()) as HardwareEventsApiResponse;
    const startedAtMs = new Date(startedAt).getTime();
    return data.events.some(
      (event) =>
        !eventIsSimulation(event) &&
        !eventIsStudioTest(event) &&
        event.compartment === slotId &&
        new Date(event.receivedAt).getTime() >= startedAtMs
    );
  }

  async function startAutomaticShowcase() {
    const slotId = showcaseSlot;
    const startedAt = new Date().toISOString();
    const token = showcaseRunToken.current + 1;
    showcaseRunToken.current = token;
    setShowcaseStartedAt(startedAt);
    setShowcasePhase("first");
    setCommandPending(true);
    setNotice(`Automatic showcase started for Slot ${slotId}: First Alert.`);

    try {
      await sendReminderCommand("reminding", "first", slotId);
      setCommandPending(false);
      await new Promise((resolve) =>
        window.setTimeout(resolve, FIRST_ALERT_DURATION_MS)
      );
      if (showcaseRunToken.current !== token) return;

      await sendReminderCommand("idle", "first", slotId);
      if (showcaseRunToken.current !== token) return;
      setShowcasePhase("quiet");
      setNotice(
        `First Alert finished. Waiting ${QUIET_WINDOW_MS / 1000} seconds for a lid opening.`
      );

      await new Promise((resolve) => window.setTimeout(resolve, QUIET_WINDOW_MS));
      if (showcaseRunToken.current !== token) return;
      const openingOccurred = await physicalOpeningOccurredSince(startedAt, slotId);
      if (showcaseRunToken.current !== token) return;
      if (openingOccurred) {
        showcaseRunToken.current += 1;
        setShowcasePhase("completed");
        setNotice(
          `Dose Completed: physical Slot ${slotId} opening detected. Second Alert was cancelled.`
        );
        await loadStudio(true);
        return;
      }

      setShowcasePhase("second");
      setNotice(
        `No lid opening detected. Second Alert started automatically for Slot ${slotId}.`
      );
      await sendReminderCommand("reminding", "second", slotId);
    } catch (error) {
      if (showcaseRunToken.current !== token) return;
      showcaseRunToken.current += 1;
      setShowcasePhase("ready");
      setNotice(error instanceof Error ? error.message : "Showcase failed.");
    } finally {
      if (!resetInProgress.current) setCommandPending(false);
    }
  }

  async function stopAutomaticShowcase() {
    showcaseRunToken.current += 1;
    setCommandPending(true);
    try {
      await sendReminderCommand("idle", "first", showcaseSlot);
      setShowcasePhase("ready");
      setShowcaseStartedAt(null);
      setNotice("Showcase stopped and reset. The device is ready for another run.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Stop command failed.");
    } finally {
      setCommandPending(false);
    }
  }

  async function recordStudioOpening(slotId: number) {
    setCommandPending(true);
    setNotice("");
    try {
      const response = await fetch("/api/hardware/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: LIVE_HARDWARE_DEVICE_ID,
          slotId,
          eventType: "lid_open",
          firmwareVersion: "studio-link-test-1.0.0",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "The test opening was not recorded.");
      }
      setNotice(
        `Studio recorded a Slot ${slotId} test opening. Connected demo clients will receive it on their next refresh.`
      );
      await loadStudio(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Test opening failed.");
    } finally {
      setCommandPending(false);
    }
  }

  async function resetDemo() {
    if (commandPending || resetInProgress.current) return;
    resetInProgress.current = true;
    studioRequestId.current += 1;
    showcaseRunToken.current += 1;
    setCommandPending(true);
    setShowcasePhase("ready");
    setShowcaseStartedAt(null);
    setNotice("");

    try {
      await sendReminderCommand("idle", "first", showcaseSlot);
      const response = await fetch(
        `/api/hardware/events?deviceId=${encodeURIComponent(LIVE_HARDWARE_DEVICE_ID)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        throw new Error("The reminder was stopped, but the event history could not be cleared. Try resetting again.");
      }
      setEvents([]);
      setResetConfirmationOpen(false);
      setNotice("Demo reset. Opening history cleared and the reminder stop command sent. Your medication plan and device connection are unchanged.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Demo reset failed. Please try again.");
    } finally {
      resetInProgress.current = false;
      setCommandPending(false);
      await loadStudio(true);
    }
  }

  return (
    <main className="min-h-screen bg-cream text-ink">
      <header className="border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-7 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
              <Wrench aria-hidden="true" size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-bold">Smart Pillbox Studio</p>
                <span className="rounded-full bg-sky-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-ink">
                  Device ops
                </span>
              </div>
              <p className="truncate text-xs text-ink-soft">
                Connect {LIVE_HARDWARE_CONNECT_CODE} · {LIVE_HARDWARE_DEVICE_ID}
              </p>
            </div>
          </div>

          <nav aria-label="Studio navigation" className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-deep hover:text-ink sm:flex"
            >
              <House aria-hidden="true" size={16} /> Dashboard
            </Link>
            <Link
              href="/hardware-simulator"
              className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition hover:bg-cream-deep"
            >
              Simulator <ExternalLink aria-hidden="true" size={14} />
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-7 lg:px-10 lg:py-8">
        <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                  isConnected
                    ? "bg-mint-soft text-mint-ink"
                    : "bg-honey-soft text-honey-ink"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isConnected ? "animate-pulse bg-mint" : "bg-honey"
                  }`}
                />
                {isConnected ? "Physical device online" : "Physical device offline"}
              </span>
              {telemetry ? (
                <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft">
                  Telemetry active
                </span>
              ) : (
                <span className="rounded-full border border-honey-line bg-honey-soft px-3 py-1.5 text-xs font-semibold text-honey-ink">
                  Waiting for firmware telemetry
                </span>
              )}
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-[-0.03em] text-ink sm:text-4xl">
              Device operations
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft sm:text-base">
              Live health, commands, medication plan, and event provenance for the
              physical pillbox. Opening this page never marks the device online.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh((current) => !current)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                autoRefresh
                  ? "border-mint-line bg-mint-soft text-mint-ink"
                  : "border-line bg-surface text-ink-soft"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Radio aria-hidden="true" size={15} />
                {autoRefresh ? "Live refresh on" : "Live refresh off"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void loadStudio()}
              disabled={loadState === "loading" || commandPending}
              className="inline-flex items-center gap-2 rounded-lg bg-action px-3 py-2 text-sm font-semibold text-on-action transition hover:bg-action-hover disabled:opacity-60"
            >
              {loadState === "loading" ? (
                <LoaderCircle aria-hidden="true" size={15} className="animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={15} />
              )}
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setResetConfirmationOpen(true)}
              disabled={commandPending}
              aria-expanded={resetConfirmationOpen}
              aria-controls="reset-demo-confirmation"
              className="inline-flex items-center gap-2 rounded-lg border border-coral-line bg-coral-soft px-3 py-2 text-sm font-semibold text-coral-ink transition hover:brightness-95 disabled:opacity-50"
            >
              <RotateCcw aria-hidden="true" size={15} /> Reset demo
            </button>
          </div>
        </section>

        {resetConfirmationOpen ? (
          <section
            id="reset-demo-confirmation"
            aria-labelledby="reset-demo-heading"
            className="mt-5 rounded-xl border border-coral-line bg-coral-soft p-5"
          >
            <h2 id="reset-demo-heading" className="font-bold text-coral-ink">Reset this demo?</h2>
            <p className="mt-2 text-sm leading-6 text-ink">
              Stop this Studio showcase and delete all opening records for {LIVE_HARDWARE_DEVICE_ID},
              including physical openings and test events. This cannot be undone.
              The medication plan, pairing, and connection settings will be kept.
              Dashboard and apps using this same server will see the cleared history on their next refresh.
            </p>
            <p className="mt-2 text-xs leading-5 text-ink-soft">
              Keep the lids closed while resetting. New or queued device events can still arrive.
              An offline device will receive the stop command when it reconnects.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setResetConfirmationOpen(false)}
                disabled={commandPending}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void resetDemo()}
                disabled={commandPending}
                className="inline-flex items-center gap-2 rounded-lg bg-action px-4 py-2 text-sm font-semibold text-on-action disabled:opacity-50"
              >
                {commandPending ? <LoaderCircle aria-hidden="true" size={15} className="animate-spin" /> : null}
                {commandPending ? "Resetting…" : "Stop reminder and clear history"}
              </button>
            </div>
          </section>
        ) : null}

        {notice ? (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink shadow-card">
            <CircleAlert aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-honey-ink" />
            <p className="leading-5">{notice}</p>
          </div>
        ) : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={isConnected ? Wifi : WifiOff}
            label="Connection"
            value={isConnected ? "Online" : deviceState?.connectionStatus === "never_connected" ? "Never connected" : "Offline"}
            detail={`Last heartbeat ${formatDateTime(deviceState?.lastSeenAt)}`}
            tone={isConnected ? "good" : "warning"}
          />
          <StatCard
            icon={Signal}
            label="Wi-Fi signal"
            value={telemetry ? `${telemetry.wifiRssi} dBm` : "Not reported"}
            detail={signalLabel(telemetry?.wifiRssi)}
            tone={telemetry && telemetry.wifiRssi >= -75 ? "good" : "warning"}
          />
          <StatCard
            icon={Gauge}
            label="Uptime"
            value={formatDuration(telemetry?.uptimeMs)}
            detail={telemetry ? "Since the last device boot" : "Requires updated firmware"}
          />
          <StatCard
            icon={History}
            label="Event channel"
            value={`${realEventCount} physical`}
            detail={`${studioTestEventCount} Studio tests · ${simulatedEventCount} simulator`}
            tone={realEventCount > 0 ? "good" : "neutral"}
          />
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
          <div className="space-y-6">
            <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4 sm:px-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    Live hardware
                  </p>
                  <h2 className="mt-1 text-lg font-bold">System health</h2>
                </div>
                <span className="text-xs text-ink-soft">
                  Refreshed {formatDateTime(lastRefreshAt)}
                </span>
              </header>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                {[
                  {
                    icon: HardDrive,
                    label: "Firmware",
                    value: telemetry?.firmwareVersion ?? events.find((event) => !eventIsSimulation(event))?.firmwareVersion ?? "Not reported",
                    detail: "Physical device build",
                  },
                  {
                    icon: Router,
                    label: "Local address",
                    value: telemetry?.ipAddress ?? "Not reported",
                    detail: "Private Wi-Fi address",
                  },
                  {
                    icon: MemoryStick,
                    label: "Free heap",
                    value: formatBytes(telemetry?.freeHeapBytes),
                    detail: "Available device memory",
                  },
                  {
                    icon: Activity,
                    label: "Upload queue",
                    value: telemetry ? `${telemetry.uploadQueueDepth} pending` : "Not reported",
                    detail: telemetry?.uploadQueueDepth ? "Waiting to retry" : "No queued events reported",
                  },
                  {
                    icon: BellRing,
                    label: "Reminder output",
                    value: deviceState?.status === "reminding" ? `Slot ${deviceState.activeSlot}` : "Idle",
                    detail: deviceState?.trigger ? `${deviceState.trigger} trigger` : "No active trigger",
                  },
                  {
                    icon: ShieldCheck,
                    label: "Telemetry age",
                    value: telemetry ? formatDateTime(telemetry.receivedAt) : "Not received",
                    detail: "Server receipt time",
                  },
                ].map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className={`p-5 sm:p-6 ${
                        index < 3 ? "border-b border-line-soft" : ""
                      } ${index % 3 !== 2 ? "lg:border-r lg:border-line-soft" : ""} ${
                        index % 2 === 0 ? "sm:border-r sm:border-line-soft lg:border-r" : ""
                      }`}
                    >
                      <Icon aria-hidden="true" size={18} className="text-ink-faint" />
                      <p className="mt-4 text-xs font-semibold text-ink-soft">{item.label}</p>
                      <p className="mt-1 truncate font-bold text-ink">{item.value}</p>
                      <p className="mt-1 truncate text-xs text-ink-faint">{item.detail}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              <header className="flex items-center justify-between gap-4 border-b border-line-soft px-5 py-4 sm:px-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    Provenance-aware
                  </p>
                  <h2 className="mt-1 text-lg font-bold">Recent device events</h2>
                </div>
                <span className="rounded-full bg-cream-deep px-3 py-1 text-xs font-semibold text-ink-soft">
                  {events.length} events
                </span>
              </header>

              {events.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <Box aria-hidden="true" size={28} className="mx-auto text-ink-faint" />
                  <p className="mt-4 font-semibold">No device events yet</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Physical lid openings will appear here after the device uploads them.
                  </p>
                </div>
              ) : (
                <div className="max-h-[430px] divide-y divide-line-soft overflow-y-auto feed-scroll">
                  {events.map((event) => {
                    const simulated = eventIsSimulation(event);
                    const studioTest = eventIsStudioTest(event);
                    const wrongSlot = event.eventType === "wrong_slot_open";
                    return (
                      <article
                        key={event.id}
                        className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-4 sm:px-6"
                      >
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                            wrongSlot
                              ? "bg-coral-soft text-coral-ink"
                              : simulated
                                ? "bg-sky-soft text-sky-ink"
                                : studioTest
                                  ? "bg-honey-soft text-honey-ink"
                                : "bg-mint-soft text-mint-ink"
                          }`}
                        >
                          {simulated ? <Zap aria-hidden="true" size={17} /> : <Pill aria-hidden="true" size={17} />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-bold">
                              Slot {event.compartment} {wrongSlot ? "opened unexpectedly" : "opened"}
                            </p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                simulated
                                  ? "bg-sky-soft text-sky-ink"
                                  : studioTest
                                    ? "bg-honey-soft text-honey-ink"
                                    : "bg-mint-soft text-mint-ink"
                              }`}
                            >
                              {simulated ? "Simulator" : studioTest ? "Studio test" : "Physical"}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-ink-soft">
                            {event.medication} · {event.firmwareVersion ?? "firmware unknown"}
                          </p>
                        </div>
                        <time className="text-right text-xs font-semibold text-ink-soft">
                          {event.eventTime.slice(0, 10)}
                          <span className="mt-1 block text-ink">{event.eventTime.slice(-5)}</span>
                        </time>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    Live hardware showcase
                  </p>
                  <h2 className="mt-1 text-lg font-bold">Two-stage reminder demo</h2>
                </div>
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  deviceState?.status === "reminding"
                    ? "bg-coral-soft text-coral-ink"
                    : "bg-cream-deep text-ink-soft"
                }`}>
                  <BellRing aria-hidden="true" size={19} />
                </div>
              </div>

              <p className="mt-4 text-sm leading-6 text-ink-soft">
                Choose a real compartment and start the automated alert sequence,
                then open that lid. A valid physical opening marks the dose completed
                and cancels every later alert automatically.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2" aria-label="Showcase slot">
                {[1, 2].map((slotId) => (
                  <button
                    key={slotId}
                    type="button"
                    onClick={() => setShowcaseSlot(slotId)}
                    disabled={
                      commandPending ||
                      (showcasePhase !== "ready" && showcasePhase !== "completed")
                    }
                    className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition disabled:opacity-50 ${
                      showcaseSlot === slotId
                        ? "border-sky-line bg-sky-soft text-sky-ink"
                        : "border-line bg-surface text-ink-soft hover:bg-cream-deep"
                    }`}
                  >
                    Slot {slotId}
                  </button>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-line-soft bg-cream p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-ink-soft">Target</p>
                    <p className="mt-1 font-bold">Slot {showcaseSlot}</p>
                  </div>
                  <ChevronRight aria-hidden="true" size={17} className="text-ink-faint" />
                  <div className="min-w-0 text-right">
                    <p className="text-xs font-semibold text-ink-soft">Medication</p>
                    <p className="mt-1 truncate font-bold">{activePlan?.medication || "Not configured"}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-3 text-xs">
                  <span className="font-semibold text-ink-soft">Current stage</span>
                  <span className="rounded-full bg-surface px-2.5 py-1 font-bold text-ink">
                    {showcasePhase === "first"
                      ? "FIRST ALERT"
                      : showcasePhase === "quiet"
                        ? "WAITING FOR OPENING"
                        : showcasePhase === "second"
                          ? "SECOND ALERT"
                          : showcasePhase === "completed"
                            ? "DOSE COMPLETED"
                            : "READY"}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void startAutomaticShowcase()}
                  disabled={
                    commandPending ||
                    (showcasePhase !== "ready" && showcasePhase !== "completed")
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-action px-3 py-3 text-sm font-semibold text-on-action transition hover:bg-action-hover disabled:opacity-50"
                >
                  <BellRing aria-hidden="true" size={16} /> Start Showcase
                </button>
                <button
                  type="button"
                  onClick={() => void stopAutomaticShowcase()}
                  disabled={commandPending}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-line px-3 py-3 text-sm font-semibold text-ink transition hover:bg-cream-deep disabled:opacity-50"
                >
                  <Square aria-hidden="true" size={15} /> Stop
                </button>
              </div>
              <ol className="mt-4 space-y-2 rounded-xl border border-mint-line bg-mint-soft p-4 text-xs leading-5 text-ink-soft">
                <li><strong className="text-ink">1.</strong> First Alert runs for 6 seconds: slot LED + one-chime pattern.</li>
                <li><strong className="text-ink">2.</strong> The device becomes quiet and waits 8 seconds for a real opening.</li>
                <li><strong className="text-ink">3.</strong> If still unopened, Second Alert starts automatically with OLED + two-chime pattern.</li>
                <li><strong className="text-ink">4.</strong> Open the selected lid at any point: Dose Completed, all later alerts stop.</li>
              </ol>
              <div className="mt-5 border-t border-line-soft pt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  App link test
                </p>
                <p className="mt-2 text-xs leading-5 text-ink-soft">
                  Record a clearly labelled Studio test opening, then confirm it appears in a connected demo client.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[1, 2].map((slotId) => (
                    <button
                      key={slotId}
                      type="button"
                      onClick={() => void recordStudioOpening(slotId)}
                      disabled={commandPending}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-honey-line bg-honey-soft px-3 py-3 text-sm font-semibold text-honey-ink transition hover:brightness-95 disabled:opacity-50"
                    >
                      <Box aria-hidden="true" size={15} /> Open Slot {slotId}
                    </button>
                  ))}
                </div>
              </div>
              {!isConnected ? (
                <p className="mt-3 text-xs leading-5 text-honey-ink">
                  The device is offline. Commands remain on the server until it reconnects and polls.
                </p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
              <div className="flex items-center gap-3">
                <Clock3 aria-hidden="true" size={18} className="text-honey-ink" />
                <h2 className="font-bold">Medication plan</h2>
              </div>
              <div className="mt-4 space-y-2">
                {plan.length === 0 ? (
                  <p className="rounded-xl bg-cream p-4 text-sm text-ink-soft">No plan configured.</p>
                ) : (
                  plan.map((slot) => (
                    <div
                      key={slot.slotId}
                      className="flex items-center justify-between gap-4 rounded-xl border border-line-soft px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">Slot {slot.slotId} · {slot.medication || "Empty"}</p>
                        <p className="mt-1 text-xs text-ink-soft">
                          {slot.highRisk ? "High-risk medication" : "Standard monitoring"}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-cream-deep px-2.5 py-1.5 text-xs font-bold">
                        {slot.scheduledTime || "--:--"}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <Link
                href="/dashboard"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-ink-soft transition hover:text-ink"
              >
                Edit in medication plan <ChevronRight aria-hidden="true" size={15} />
              </Link>
            </section>

            <section className="rounded-2xl border border-mint-line bg-mint-soft p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 aria-hidden="true" size={19} className="mt-0.5 shrink-0 text-mint-ink" />
                <div>
                  <h2 className="font-bold text-ink">Studio integrity</h2>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">
                    Page refreshes are read-only. Only firmware heartbeats can mark the physical device online, and simulator events are visibly labelled.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
