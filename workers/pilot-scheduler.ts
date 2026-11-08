// Deploy separately with workers/wrangler.example.jsonc after configuring secrets.
type SchedulerEnvironment = {
  PILOT_ORIGIN: string;
  PILOT_SCHEDULER_SECRET: string;
};
const scheduler = {
  async scheduled(_event: unknown, env: SchedulerEnvironment): Promise<void> {
    const origin = new URL(env.PILOT_ORIGIN);
    if (origin.protocol !== "https:")
      throw new Error("Scheduler requires an HTTPS origin.");
    const response = await fetch(new URL("/api/pilot/tick", origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PILOT_SCHEDULER_SECRET}` },
      signal: AbortSignal.timeout(25000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Pilot scheduler failed with status ${response.status}`);
    console.log(
      JSON.stringify({
        event: "pilot_scheduler_completed",
        status: response.status,
      }),
    );
  },
};

export default scheduler;
