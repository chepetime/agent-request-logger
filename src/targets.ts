export type Protocol = "anthropic" | "openai" | "raw";
export type AgentId = "claude-code" | "codex" | "copilot" | "opencode" | "pi";
export interface Choice {
  agent: AgentId;
  provider: string;
  customBaseUrl?: string;
  customRenderer?: Protocol;
  customModel?: string;
}
export interface SetupFile { path: string; content: string }
export interface Target {
  name: string;
  upstream: URL;
  protocol: Protocol;
  command: string;
  files: SetupFile[];
  hints: string[];
}
interface Route { label: string; url: string; protocol: Protocol }
interface Agent { label: string; routes: Record<string, Route> }
const route = (label: string, url: string, protocol: Protocol): Route => ({ label, url, protocol });
export const catalogue: Record<AgentId, Agent> = {
  "claude-code": { label: "Claude Code", routes: {
    anthropic: route("Anthropic / Claude subscription", "https://api.anthropic.com", "anthropic"),
  } },
  codex: { label: "Codex", routes: {
    chatgpt: route("ChatGPT subscription", "https://chatgpt.com", "openai"),
    openai: route("OpenAI API key", "https://api.openai.com", "openai"),
  } },
  copilot: { label: "GitHub Copilot CLI", routes: {
    github: route("GitHub subscription", "https://api.githubcopilot.com", "openai"),
  } },
  opencode: { label: "OpenCode", routes: {
    anthropic: route("Anthropic API key", "https://api.anthropic.com", "anthropic"),
    openai: route("OpenAI API key", "https://api.openai.com", "openai"),
  } },
  pi: { label: "Pi", routes: {
    anthropic: route("Anthropic API key", "https://api.anthropic.com", "anthropic"),
    openai: route("OpenAI API key", "https://api.openai.com", "openai"),
    codex: route("ChatGPT subscription", "https://chatgpt.com", "openai"),
  } },
};
export function isAgent(value: unknown): value is AgentId {
  return typeof value === "string" && Object.hasOwn(catalogue, value);
}
export function isProtocol(value: unknown): value is Protocol {
  return value === "anthropic" || value === "openai" || value === "raw";
}
export function shellArgument(text: string): string {
  return "'" + text.replaceAll("'", "'\"'\"'") + "'";
}
export function upstreamUrl(text: string): URL {
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) base URL without credentials, query parameters, or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}
export function needsModel(choice: Pick<Choice, "agent" | "provider" | "customRenderer">): boolean {
  return choice.provider === "custom" && (choice.agent === "pi" ||
    (choice.agent === "opencode" && choice.customRenderer === "openai"));
}
export function resolveTarget(choice: Choice, port: number): Target {
  if (!isAgent(choice.agent)) throw new Error("This saved agent is unavailable. Choose again with --force.");
  const agent = catalogue[choice.agent];
  const custom = choice.provider === "custom";
  const selected = Object.hasOwn(agent.routes, choice.provider) ? agent.routes[choice.provider] : undefined;
  if (!custom && !selected) throw new Error("This saved provider is unavailable. Choose again with --force.");
  if (custom && !choice.customBaseUrl) throw new Error("A custom upstream URL is required.");
  if (custom && !isProtocol(choice.customRenderer)) throw new Error("Choose a supported wire format with --force.");
  const protocol = custom ? choice.customRenderer! : selected!.protocol;
  const upstream = upstreamUrl(custom ? choice.customBaseUrl! : selected!.url);
  const local = `http://localhost:${port}`;
  const target: Target = {
    name: `${agent.label} · ${custom ? "Custom upstream" : selected!.label}`,
    upstream, protocol, command: "", files: [], hints: [],
  };
  const model = choice.customModel?.trim();
  if (needsModel(choice) && !model) throw new Error("This custom setup needs a model ID. Choose again with --force.");
  switch (choice.agent) {
    case "claude-code":
      target.command = `ANTHROPIC_BASE_URL=${shellArgument(local)} ENABLE_TOOL_SEARCH=true claude`;
      target.hints.push("Tool search stays enabled so the proxy does not cause Claude to send all deferred tools.");
      break;
    case "codex": {
      const suffix = !custom && choice.provider === "chatgpt" ? "/backend-api/codex" : "/v1";
      target.command = `codex -c ${shellArgument(`openai_base_url="${local}${suffix}"`)}`;
      target.hints.push("This flag overrides the API URL for this invocation only.");
      break;
    }
    case "copilot":
      target.command = `COPILOT_API_URL=${shellArgument(local)} copilot`;
      target.hints.push("HTTP requests are captured; WebSocket model traffic is unsupported.");
      break;
    case "opencode": {
      const anthropic = custom ? protocol === "anthropic" : choice.provider === "anthropic";
      if (custom && protocol === "openai") {
        const provider = "logger";
        const config = { model: `${provider}/${model}`, small_model: `${provider}/${model}`, provider: {
          [provider]: { npm: "@ai-sdk/openai-compatible", options: { baseURL: `${local}/v1` }, models: { [model!]: { name: model } } },
        } };
        target.command = `OPENCODE_CONFIG_CONTENT=${shellArgument(JSON.stringify(config))} opencode`;
      } else {
        const name = anthropic ? "ANTHROPIC_BASE_URL" : "OPENAI_BASE_URL";
        target.command = `${name}=${shellArgument(`${local}/v1`)} opencode`;
        const provider = anthropic ? "anthropic" : "openai";
        target.files.push({ path: "~/.config/opencode/opencode.json", content: JSON.stringify({
          provider: { [provider]: { options: { baseURL: `${local}/v1` } } },
        }, null, 2) });
        target.hints.push("Merge the printed provider options into your OpenCode config if it overrides the environment variable.");
      }
      break;
    }
    case "pi": {
      const provider = custom ? (protocol === "anthropic" ? "anthropic" : "openai")
        : choice.provider === "codex" ? "openai-codex" : choice.provider;
      const suffix = provider === "openai-codex" ? "/backend-api" : provider === "openai" ? "/v1" : "";
      const settings: Record<string, unknown> = { baseUrl: local + suffix };
      if (custom) settings.models = [{ id: model }];
      target.command = "pi";
      target.files.push({ path: "~/.pi/agent/models.json", content: JSON.stringify({ providers: { [provider]: settings } }, null, 2) });
      if (provider === "openai-codex") target.files.push({ path: "~/.pi/agent/settings.json", content: JSON.stringify({ transport: "sse" }, null, 2) });
      target.hints.push("Merge these settings with your existing files. A custom model list replaces that provider's catalogue.");
      break;
    }
  }
  if (custom) target.hints.push("The wire format controls display only; the endpoint must accept the agent's own protocol.");
  return target;
}
