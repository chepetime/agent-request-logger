import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Choice, isAgent, isProtocol } from "./targets.js";

export interface Locations {
  logDir: string;
  preferenceFile: string;
}
// Resolve relative options against the launch directory, never the installed
// package location. Preferences alone use the home directory by default.
export function locations(
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
  home = os.homedir(),
): Locations {
  return {
    logDir: path.resolve(cwd, env.REQUEST_LOGGER_LOG_DIR || "request-logger-logs"),
    preferenceFile: path.join(
      path.resolve(cwd, env.REQUEST_LOGGER_CONFIG_DIR || path.join(home, ".agent-request-logger")),
      ".agent-choice.json",
    ),
  };
}
export async function readPreference(file: string): Promise<Choice | undefined> {
  try {
    // Pick known fields explicitly so obsolete catalogue data never becomes
    // runtime configuration merely because it was present in the saved file.
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (!isAgent(value?.agent) || typeof value.provider !== "string") return;

    const choice: Choice = { agent: value.agent, provider: value.provider };
    if (choice.provider !== "custom") return choice;
    if (typeof value.customBaseUrl !== "string" || !isProtocol(value.customRenderer)) return;

    return {
      ...choice,
      customBaseUrl: value.customBaseUrl,
      customRenderer: value.customRenderer,
      customModel: typeof value.customModel === "string" ? value.customModel : undefined,
    };
  } catch {
    // Missing, unreadable, or damaged preferences all fall back to the wizard.
    return;
  }
}

export async function writePreference(file: string, choice: Choice): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(choice, null, 2)}\n`, { mode: 0o600 });
}
