"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { HardwarePlanSlot } from "../../src/types/hardware";
import type { Task } from "../../src/lib/pilot/store";
import styles from "./pilot.module.css";

type Session = {
  member: { id: string; name: string };
  devices: { id: string; name: string; timeZone: string }[];
};
type EventRecord = {
  sequence: number;
  eventId: string;
  observedAt: string | null;
  receivedAt: string;
  payload: { slotId: number; eventType: string };
  planVersion: number | null;
};
type Snapshot = {
  deviceId: string;
  plan: { version: number; slots: HardwarePlanSlot[] };
  events: { records: EventRecord[]; nextCursor: number | null };
  state: {
    status: string;
    activeSlot: number | null;
    connectionStatus: string;
    lastSeenAt: string | null;
    serverTime: string;
  };
  tasks: Task[];
};
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/pilot/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  }).catch(() => {
    throw new Error(
      "网络连接失败。若刚刚提交过修改，请先刷新核对结果，再决定是否重试。",
    );
  });
  const result = await response.json().catch(() => {
    throw new Error(
      "服务暂时无法返回有效结果。请稍后刷新核对；若持续失败，请联系团队。",
    );
  });
  if (!response.ok)
    throw new ApiError(
      `${
        (
          {
            401: "访问码无效或登录已过期，请重新登录。",
            403: "当前账号没有执行此操作的权限，请联系团队核对设备分配。",
            409: "操作与当前状态冲突。请刷新记录核对；计划编辑可先保留草稿，再重新载入最新计划。",
            429: "操作较频繁，请稍等后重试。",
            503: "服务暂时不可用，请稍后重试；若持续失败，请联系团队。",
          } as Record<number, string>
        )[response.status] ??
        result.error ??
        "操作失败，请重试。"
      }${result.requestId ? `（请求编号 ${result.requestId}）` : ""}`,
      response.status,
    );
  return result;
}
const emptySlot = (slotId: number): HardwarePlanSlot => ({
  slotId,
  medication: "",
  scheduledTime: "",
  highRisk: false,
  bufferTimeMinutes: 30,
});
const editableSlots = (plan: Snapshot["plan"]) =>
  Array.from(
    { length: 8 },
    (_, i) => plan.slots.find((s) => s.slotId === i + 1) ?? emptySlot(i + 1),
  );
function time(value: string | null, zone: string) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: zone,
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "暂无记录";
}

export default function PilotPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [deviceId, setDeviceId] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [slots, setSlots] = useState<HardwarePlanSlot[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessCode, setAccessCode] = useState("");
  const [title, setTitle] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  const device = session?.devices.find((d) => d.id === deviceId);
  const zone = device?.timeZone ?? "Asia/Hong_Kong";
  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      sequence.current++;
      setSession(null);
      setSnapshot(null);
      setSlots([]);
      setAccessCode("");
    }
    setError(err instanceof Error ? err.message : "操作失败，请重试。");
  }, []);
  const loadSession = useCallback(async () => {
    try {
      const s = await api<Session>("session");
      setSession(s);
      setDeviceId(s.devices[0]?.id ?? "");
      setError("");
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) fail(err);
    } finally {
      setBooting(false);
    }
  }, [fail]);
  useEffect(() => {
    let active = true;
    api<Session>("session")
      .then((s) => {
        if (active) {
          setSession(s);
          setDeviceId(s.devices[0]?.id ?? "");
        }
      })
      .catch((err) => {
        if (active && !(err instanceof ApiError && err.status === 401))
          fail(err);
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, [fail]);
  const refresh = useCallback(
    async (id: string, replacePlan = true) => {
      const current = ++sequence.current;
      setLoading(true);
      setError("");
      try {
        const query = `?deviceId=${encodeURIComponent(id)}`;
        const [plan, events, state, tasks] = await Promise.all([
          api<Snapshot["plan"]>(`plan${query}`),
          api<Snapshot["events"]>(`events${query}`),
          api<Snapshot["state"]>(`state${query}`),
          api<{ tasks: Task[] }>(`tasks${query}`),
        ]);
        if (current !== sequence.current) return;
        setSnapshot((old) => ({
          deviceId: id,
          plan: !replacePlan && old?.deviceId === id ? old.plan : plan,
          events,
          state,
          tasks: tasks.tasks,
        }));
        if (replacePlan) setSlots(editableSlots(plan));
      } catch (err) {
        if (current === sequence.current) fail(err);
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [fail],
  );
  useEffect(() => {
    if (!deviceId || !session) return;
    let active = true;
    const current = ++sequence.current;
    const query = `?deviceId=${encodeURIComponent(deviceId)}`;
    Promise.all([
      api<Snapshot["plan"]>(`plan${query}`),
      api<Snapshot["events"]>(`events${query}`),
      api<Snapshot["state"]>(`state${query}`),
      api<{ tasks: Task[] }>(`tasks${query}`),
    ])
      .then(([plan, events, state, tasks]) => {
        if (active && current === sequence.current) {
          setSnapshot({ deviceId, plan, events, state, tasks: tasks.tasks });
          setSlots(
            Array.from(
              { length: 8 },
              (_, i) =>
                plan.slots.find((s) => s.slotId === i + 1) ?? emptySlot(i + 1),
            ),
          );
        }
      })
      .catch((err) => {
        if (active && current === sequence.current) fail(err);
      })
      .finally(() => {
        if (active && current === sequence.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deviceId, session, fail]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  function login(event: FormEvent) {
    event.preventDefault();
    void action(async () => {
      await api("session", {
        method: "POST",
        body: JSON.stringify({ accessCode }),
      });
      setAccessCode("");
      await loadSession();
    });
  }
  const visible = snapshot?.deviceId === deviceId ? snapshot : null;
  const dirty =
    !!visible &&
    JSON.stringify(slots) !== JSON.stringify(editableSlots(visible.plan));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function discardDraft() {
    return !dirty || window.confirm("用药安排有未保存的修改，确定放弃吗？");
  }
  function updateSlot(
    id: number,
    key: keyof HardwarePlanSlot,
    value: string | number | boolean,
  ) {
    setSlots((old) =>
      old.map((s) => (s.slotId === id ? { ...s, [key]: value } : s)),
    );
  }
  async function exportEvents() {
    const all: EventRecord[] = [];
    let before: number | null = null;
    do {
      const page: Snapshot["events"] = await api<Snapshot["events"]>(
        `events?deviceId=${encodeURIComponent(deviceId)}&limit=200${before ? `&before=${before}` : ""}`,
      );
      all.push(...page.records);
      before = page.nextCursor;
    } while (before !== null);
    const blob = new Blob(
      [
        JSON.stringify(
          {
            deviceId,
            timeZone: zone,
            exportedAt: new Date().toISOString(),
            records: all,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pillbox-${deviceId}-events.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      `已导出 ${all.length} 条事件。请妥善保存包含个人照护信息的文件。`,
    );
  }
  return (
    <main className={styles.page} lang="zh-CN">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CARELOOP · 家庭照护</p>
          <h1>让每一次跟进有着落。</h1>
          <p>查看真实开盒记录，和家人一起把照护安排好。</p>
        </div>
        {session && (
          <button
            className={styles.secondary}
            disabled={busy}
            onClick={() =>
              void action(async () => {
                if (!discardDraft()) return;
                await api("session", { method: "DELETE" });
                sequence.current++;
                setSession(null);
                setSnapshot(null);
                setSlots([]);
                setNotice("");
              })
            }
          >
            退出登录
          </button>
        )}
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className={styles.notice}>
          {notice}
        </div>
      )}
      {booting ? (
        <p role="status">正在确认登录状态…</p>
      ) : !session ? (
        <section className={styles.login}>
          <h2>进入你的照护家庭</h2>
          <p>请输入团队为你提供的个人访问码。每位照护者使用自己的访问码。</p>
          <form onSubmit={login}>
            <label htmlFor="accessCode">个人访问码</label>
            <input
              id="accessCode"
              type="password"
              autoComplete="current-password"
              required
              minLength={32}
              maxLength={256}
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
            />
            <button disabled={busy}>{busy ? "正在登录…" : "安全登录"}</button>
          </form>
          <p className={styles.muted}>
            登录会在八小时后到期。设备凭证不能用于照护者登录。
          </p>
        </section>
      ) : (
        <>
          {!session.devices.length ? (
            <section className={styles.panel}>
              <h2>账号已登录，等待分配药盒</h2>
              <p>
                请联系团队为你的家庭分配设备。完成后点击下方按钮，继续设置用药安排。
              </p>
              <button disabled={busy} onClick={() => void action(loadSession)}>
                重新检查设备分配
              </button>
            </section>
          ) : (
            <section className={styles.toolbar}>
              <label>
                照护设备
                <select
                  value={deviceId}
                  disabled={busy || loading}
                  onChange={(e) => {
                    if (!discardDraft()) return;
                    setNotice("");
                    setTitle("");
                    setResolutions({});
                    setLoading(true);
                    setDeviceId(e.target.value);
                  }}
                >
                  {session.devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span>
                  {session.member.name} · {zone}
                </span>
                <button
                  disabled={busy || loading}
                  onClick={() => void refresh(deviceId, false)}
                >
                  {loading ? "正在读取…" : "刷新记录"}
                </button>
              </div>
            </section>
          )}
          {visible && (
            <>
              <section className={styles.panel} aria-label="使用指引">
                <h2>
                  {visible.plan.slots.length
                    ? "日常使用检查"
                    : "开始设置你的药盒"}
                </h2>
                <ol>
                  <li>
                    <a href="#medication-plan">填写并保存用药时间安排</a>
                    ，确认药格和时区。
                  </li>
                  <li>
                    确认药盒已通电并连接网络，再刷新记录查看最近连接时间。
                  </li>
                  <li>
                    查看设备事件；需要家人处理的情况，可添加跟进事项并记录结果。
                  </li>
                </ol>
                <p>
                  保存到服务器的计划，不代表药盒已收到。当前尚不能确认设备接收的计划版本，首次使用请与团队一起核对实际提醒。
                </p>
              </section>
              <section className={styles.cards} aria-label="设备概况">
                <article>
                  <span>设备连接</span>
                  <strong>
                    {
                      (
                        {
                          connected: "已连接",
                          offline: "暂时离线",
                          never_connected: "尚未连接",
                        } as Record<string, string>
                      )[visible.state.connectionStatus]
                    }
                  </strong>
                  <small>
                    最近心跳：{time(visible.state.lastSeenAt, zone)}
                  </small>
                  {visible.state.connectionStatus !== "connected" && (
                    <small>
                      请检查药盒电源和网络，然后刷新记录。若仍未连接，请联系团队。
                    </small>
                  )}
                </article>
                <article>
                  <span>当前提醒</span>
                  <strong>
                    {visible.state.status === "reminding"
                      ? `药格 ${visible.state.activeSlot} 等待开盒`
                      : "暂无进行中的提醒"}
                  </strong>
                  <small>指令状态不代表设备已发声或已服药</small>
                </article>
                <article>
                  <span>待完成跟进</span>
                  <strong>
                    {
                      visible.tasks.filter((t) => t.status !== "resolved")
                        .length
                    }{" "}
                    项
                  </strong>
                  <small>
                    数据更新于 {time(visible.state.serverTime, zone)}
                  </small>
                </article>
              </section>
              <div className={styles.columns}>
                <section className={styles.panel}>
                  <div className={styles.sectionHead}>
                    <div>
                      <h2>家人的跟进事项</h2>
                      <p>接手后记录处理结果，让其他家人看见进展。</p>
                    </div>
                  </div>
                  <form
                    className={styles.taskForm}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(async () => {
                        await api("tasks", {
                          method: "POST",
                          body: JSON.stringify({
                            deviceId,
                            id: crypto.randomUUID(),
                            title,
                          }),
                        });
                        setTitle("");
                        await refresh(deviceId, false);
                        setNotice("已添加跟进事项。");
                      });
                    }}
                  >
                    <label className={styles.srOnly} htmlFor="taskTitle">
                      跟进事项
                    </label>
                    <input
                      id="taskTitle"
                      placeholder="例如：确认今晚外出时的用药安排"
                      required
                      maxLength={200}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                    <button disabled={busy || loading}>添加</button>
                  </form>
                  {!visible.tasks.length && (
                    <p className={styles.empty}>目前没有待跟进事项。</p>
                  )}
                  <ul className={styles.tasks}>
                    {visible.tasks.map((task) => (
                      <li key={task.id}>
                        <div className={styles.sectionHead}>
                          <strong>{task.title}</strong>
                          <span className={styles.badge}>
                            {task.status === "open"
                              ? "待接手"
                              : task.status === "claimed"
                                ? "跟进中"
                                : "已完成"}
                          </span>
                        </div>
                        {task.owner_id && (
                          <p className={styles.muted}>
                            负责人：
                            {task.owner_id === session.member.id
                              ? "我"
                              : task.owner_id}
                          </p>
                        )}
                        {task.resolution && <p>{task.resolution}</p>}
                        {task.status === "open" && (
                          <button
                            disabled={busy || loading}
                            onClick={() =>
                              void action(async () => {
                                await api("tasks", {
                                  method: "PATCH",
                                  body: JSON.stringify({
                                    deviceId,
                                    id: task.id,
                                    version: task.version,
                                    status: "claimed",
                                  }),
                                });
                                await refresh(deviceId, false);
                              })
                            }
                          >
                            我来跟进
                          </button>
                        )}
                        {task.status === "claimed" &&
                          task.owner_id === session.member.id && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                void action(async () => {
                                  await api("tasks", {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      deviceId,
                                      id: task.id,
                                      version: task.version,
                                      status: "resolved",
                                      resolution: resolutions[task.id] ?? "",
                                    }),
                                  });
                                  await refresh(deviceId, false);
                                  setNotice("已保存处理结果。");
                                });
                              }}
                            >
                              <label htmlFor={`outcome-${task.id}`}>
                                处理结果
                              </label>
                              <textarea
                                id={`outcome-${task.id}`}
                                required
                                maxLength={1000}
                                value={resolutions[task.id] ?? ""}
                                onChange={(e) =>
                                  setResolutions((old) => ({
                                    ...old,
                                    [task.id]: e.target.value,
                                  }))
                                }
                              />
                              <button disabled={busy || loading}>
                                完成跟进
                              </button>
                            </form>
                          )}
                      </li>
                    ))}
                  </ul>
                </section>
                <section className={styles.panel}>
                  <div className={styles.sectionHead}>
                    <div>
                      <h2>开盒与设备事件</h2>
                      <p>开盒记录用于观察日常活动，不代表已吞服。</p>
                    </div>
                    <button
                      className={styles.secondary}
                      disabled={busy || loading}
                      onClick={() => void action(exportEvents)}
                    >
                      导出全部
                    </button>
                  </div>
                  {!visible.events.records.length ? (
                    <p className={styles.empty}>等待设备上传第一条事件。</p>
                  ) : (
                    <ul className={styles.events}>
                      {visible.events.records.map((r) => (
                        <li key={r.sequence}>
                          <strong>
                            药格 {r.payload.slotId} ·{" "}
                            {(
                              {
                                lid_open: "开盒",
                                wrong_slot_open: "非目标药格开盒",
                                reminder_started: "提醒开始",
                                reminder_stopped: "提醒停止",
                              } as Record<string, string>
                            )[r.payload.eventType] ?? r.payload.eventType}
                          </strong>
                          <span>
                            {r.observedAt
                              ? time(r.observedAt, zone)
                              : "设备未提供可靠的发生时间"}
                          </span>
                          <small>
                            接收于 {time(r.receivedAt, zone)} · 计划版本{" "}
                            {r.planVersion ?? "无"}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                  {visible.events.nextCursor && (
                    <button
                      className={styles.secondary}
                      disabled={busy || loading}
                      onClick={() =>
                        void action(async () => {
                          const page: Snapshot["events"] = await api<
                            Snapshot["events"]
                          >(
                            `events?deviceId=${encodeURIComponent(deviceId)}&before=${visible.events.nextCursor}`,
                          );
                          setSnapshot(
                            (old) =>
                              old && {
                                ...old,
                                events: {
                                  records: [
                                    ...old.events.records,
                                    ...page.records,
                                  ],
                                  nextCursor: page.nextCursor,
                                },
                              },
                          );
                        })
                      }
                    >
                      查看更早记录
                    </button>
                  )}
                </section>
              </div>
              <section className={styles.panel} id="medication-plan">
                <h2>用药时间安排</h2>
                <p>
                  按已确认的用药方案填写。时间使用 {zone}
                  ；留空的药格不会触发提醒。计划变更会保留历史版本。
                </p>
                <p role="status">
                  服务器计划版本：{visible.plan.version} ·{" "}
                  {dirty ? "有未保存的修改" : "当前没有未保存的修改"}
                </p>
                {visible.state.status === "reminding" && (
                  <p>
                    当前提醒进行中。请先在下方处理并停止提醒，再保存新的安排。
                  </p>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      const saved = await api<Snapshot["plan"]>("plan", {
                        method: "POST",
                        body: JSON.stringify({
                          deviceId,
                          expectedVersion: visible.plan.version,
                          slots: slots.filter(
                            (s) => s.medication.trim() && s.scheduledTime,
                          ),
                        }),
                      });
                      setSnapshot((old) =>
                        old && old.deviceId === deviceId
                          ? { ...old, plan: saved }
                          : old,
                      );
                      setSlots(editableSlots(saved));
                      setNotice(
                        "用药安排已保存到服务器；尚未确认设备接收。请核对药盒连接和实际提醒。",
                      );
                      await refresh(deviceId, false);
                    });
                  }}
                >
                  <fieldset
                    className={styles.planFields}
                    disabled={busy || loading}
                  >
                    <div className={styles.tableWrap}>
                      <table>
                        <thead>
                          <tr>
                            <th>药格</th>
                            <th>药物名称</th>
                            <th>提醒时间</th>
                            <th>跟进等待时间（分钟）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slots.map((s) => (
                            <tr key={s.slotId}>
                              <th scope="row">{s.slotId}</th>
                              <td data-label="药物名称">
                                <input
                                  aria-label={`药格 ${s.slotId} 药物名称`}
                                  maxLength={120}
                                  required={!!s.scheduledTime}
                                  pattern={
                                    s.scheduledTime ? ".*\\S.*" : undefined
                                  }
                                  value={s.medication}
                                  onChange={(e) =>
                                    updateSlot(
                                      s.slotId,
                                      "medication",
                                      e.target.value,
                                    )
                                  }
                                />
                              </td>
                              <td data-label="提醒时间">
                                <input
                                  aria-label={`药格 ${s.slotId} 提醒时间`}
                                  type="time"
                                  required={!!s.medication.trim()}
                                  value={s.scheduledTime}
                                  onChange={(e) =>
                                    updateSlot(
                                      s.slotId,
                                      "scheduledTime",
                                      e.target.value,
                                    )
                                  }
                                />
                              </td>
                              <td data-label="等待时间（分钟）">
                                <input
                                  aria-label={`药格 ${s.slotId} 等待时间`}
                                  type="number"
                                  required
                                  min={1}
                                  max={1440}
                                  value={s.bufferTimeMinutes}
                                  onChange={(e) =>
                                    updateSlot(
                                      s.slotId,
                                      "bufferTimeMinutes",
                                      Number(e.target.value),
                                    )
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className={styles.formActions}>
                      <button
                        disabled={
                          busy ||
                          loading ||
                          visible.state.status === "reminding"
                        }
                      >
                        保存安排
                      </button>
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy || loading}
                        onClick={() => {
                          if (discardDraft()) void refresh(deviceId);
                        }}
                      >
                        放弃编辑并重新载入计划
                      </button>
                    </div>
                  </fieldset>
                </form>
              </section>
              {visible.state.status === "reminding" && (
                <section className={styles.panel}>
                  <h2>处理当前提醒</h2>
                  <p>
                    确认设备和安排后，可以手动停止当前提醒。该操作会被记录，不会生成服药完成记录。
                  </p>
                  <button
                    className={styles.secondary}
                    disabled={busy || loading}
                    onClick={() =>
                      void action(async () => {
                        await api("state", {
                          method: "POST",
                          body: JSON.stringify({ deviceId, status: "idle" }),
                        });
                        await refresh(deviceId, false);
                        setNotice(
                          "停止提醒指令已保存，设备会在下次连接时读取。",
                        );
                      })
                    }
                  >
                    停止当前提醒
                  </button>
                </section>
              )}
            </>
          )}
          {!!deviceId && !visible && !loading && (
            <button onClick={() => void refresh(deviceId)}>重新读取设备</button>
          )}
        </>
      )}
      <footer className={styles.footer}>
        家庭照护试点 · 自动跟进需要启用后台调度 · AI 模型保持观察模式
      </footer>
    </main>
  );
}
