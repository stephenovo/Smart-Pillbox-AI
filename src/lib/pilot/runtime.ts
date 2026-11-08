import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Database } from "./database";
import { appMode, handlePilot, type PilotEnvironment } from "./api";

export async function pilotRoute(
  request: Request,
  resource: string,
): Promise<Response> {
  if (appMode() !== "pilot")
    return Response.json(
      { error: "Pilot mode is not enabled." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  let bindings: PilotEnvironment & { PILOT_DB?: Database } = {};
  try {
    bindings = (await getCloudflareContext({ async: true }))
      .env as unknown as typeof bindings;
  } catch {
    /* Handler returns a controlled 503 if storage is absent. */
  }
  const env: PilotEnvironment = {
    PILOT_ACCESS_REGISTRY:
      bindings.PILOT_ACCESS_REGISTRY ?? process.env.PILOT_ACCESS_REGISTRY,
    PILOT_SESSION_SECRET:
      bindings.PILOT_SESSION_SECRET ?? process.env.PILOT_SESSION_SECRET,
    PILOT_SCHEDULER_SECRET:
      bindings.PILOT_SCHEDULER_SECRET ?? process.env.PILOT_SCHEDULER_SECRET,
  };
  return handlePilot(request, resource, env, () => {
    if (!bindings.PILOT_DB) throw new Error("Missing PILOT_DB binding");
    return bindings.PILOT_DB;
  });
}
