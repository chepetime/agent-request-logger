import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isAgent, isProtocol, type Choice } from "./targets.js";

export interface Locations { logDir: string; preferenceFile: string }
export function locations(env: NodeJS.ProcessEnv, cwd = process.cwd(), home = os.homedir()): Locations {
  return {
    logDir: path.resolve(cwd, env.REQUEST_LOGGER_LOG_DIR || "request-logger-logs"),
    preferenceFile: path.join(path.resolve(cwd, env.REQUEST_LOGGER_CONFIG_DIR || path.join(home, ".agent-request-logger")), ".agent-choice.json"),
  };
}
export async function readPreference(file: string): Promise<Choice | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (!isAgent(value?.agent) || typeof value.provider !== "string") return;
    if (value.provider === "custom" && (typeof value.customBaseUrl !== "string" || !isProtocol(value.customRenderer))) return;
    return {
      agent: value.agent, provider: value.provider,
      ...(value.provider === "custom" ? {
        customBaseUrl: value.customBaseUrl, customRenderer: value.customRenderer,
        customModel: typeof value.customModel === "string" ? value.customModel : undefined,
      } : {}),
    };
  } catch { return; }
}
export async function writePreference(file: string, choice: Choice): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(choice, null, 2) + "\n", { mode: 0o600 });
}
export async function discoverModels(base: string): Promise<string[]> {
  try {
    const url = new URL(base);
    url.pathname = url.pathname.replace(/\/+$/, "") + (url.pathname.replace(/\/+$/, "").endsWith("/v1") ? "/models" : "/v1/models");
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const result = await response.json() as { data?: Array<{ id?: unknown }> };
    return [...new Set((result.data ?? []).flatMap(item => typeof item?.id === "string" && item.id.trim() ? [item.id] : []))];
  } catch { return []; }
}
