import { buildAgentSetup } from "./agent-setup.js";

export type Protocol = "anthropic" | "openai" | "raw";
export type AgentId = "claude-code" | "codex" | "copilot" | "opencode" | "pi";
export interface Choice {
  agent: AgentId;
  provider: string;
  customBaseUrl?: string;
  customRenderer?: Protocol;
  customModel?: string;
}
export interface SetupFile {
  path: string;
  content: string;
}
export interface Target {
  name: string;
  upstream: URL;
  protocol: Protocol;
  command: string;
  files: SetupFile[];
  hints: string[];
}
interface Route {
  label: string;
  url: string;
  protocol: Protocol;
}
interface Agent {
  label: string;
  routes: Record<string, Route>;
}
const route = (label: string, url: string, protocol: Protocol): Route => ({ label, url, protocol });
export const catalogue: Record<AgentId, Agent> = {
  "claude-code": {
    label: "Claude Code",
    routes: {
      anthropic: route("Anthropic / Claude subscription", "https://api.anthropic.com", "anthropic"),
    },
  },
  codex: {
    label: "Codex",
    routes: {
      chatgpt: route("ChatGPT subscription", "https://chatgpt.com", "openai"),
      openai: route("OpenAI API key", "https://api.openai.com", "openai"),
    },
  },
  copilot: {
    label: "GitHub Copilot CLI",
    routes: {
      github: route("GitHub subscription", "https://api.githubcopilot.com", "openai"),
    },
  },
  opencode: {
    label: "OpenCode",
    routes: {
      anthropic: route("Anthropic API key", "https://api.anthropic.com", "anthropic"),
      openai: route("OpenAI API key", "https://api.openai.com", "openai"),
    },
  },
  pi: {
    label: "Pi",
    routes: {
      anthropic: route("Anthropic API key", "https://api.anthropic.com", "anthropic"),
      openai: route("OpenAI API key", "https://api.openai.com", "openai"),
      codex: route("ChatGPT subscription", "https://chatgpt.com", "openai"),
    },
  },
};
export function isAgent(value: unknown): value is AgentId {
  return typeof value === "string" && Object.hasOwn(catalogue, value);
}
export function isProtocol(value: unknown): value is Protocol {
  return value === "anthropic" || value === "openai" || value === "raw";
}
export function upstreamUrl(text: string): URL {
  const url = new URL(text);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use an HTTP(S) base URL without credentials, query parameters, or a fragment.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}
export function needsModel(choice: Pick<Choice, "agent" | "provider" | "customRenderer">): boolean {
  return (
    choice.provider === "custom" &&
    (choice.agent === "pi" || (choice.agent === "opencode" && choice.customRenderer === "openai"))
  );
}
/** Keep this free of network and filesystem work so saved and new choices
 * resolve the same way.
 */
export function resolveTarget(choice: Choice, port: number): Target {
  if (!isAgent(choice.agent)) {
    throw new Error("This saved agent is unavailable. Choose again with --force.");
  }

  const agent = catalogue[choice.agent];
  const selected = resolveProvider(choice);
  const upstream = upstreamUrl(selected.url);
  const model = choice.customModel?.trim();
  if (needsModel(choice) && !model) {
    throw new Error("This custom setup needs a model ID. Choose again with --force.");
  }

  const setup = buildAgentSetup({
    choice,
    protocol: selected.protocol,
    localUrl: `http://localhost:${port}`,
    model,
  });
  if (choice.provider === "custom") {
    setup.hints.push(
      "The wire format controls display only; the endpoint must accept the agent's own protocol.",
    );
  }

  return {
    name: `${agent.label} · ${selected.label}`,
    upstream,
    protocol: selected.protocol,
    ...setup,
  };
}

function resolveProvider(choice: Choice): Route {
  if (choice.provider === "custom") {
    if (!choice.customBaseUrl) throw new Error("A custom upstream URL is required.");
    if (!isProtocol(choice.customRenderer)) {
      throw new Error("Choose a supported wire format with --force.");
    }
    return { label: "Custom upstream", url: choice.customBaseUrl, protocol: choice.customRenderer };
  }

  const routes = catalogue[choice.agent].routes;
  if (!Object.hasOwn(routes, choice.provider)) {
    throw new Error("This saved provider is unavailable. Choose again with --force.");
  }
  return routes[choice.provider];
}
