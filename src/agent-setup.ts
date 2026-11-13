import type { Choice, Protocol, SetupFile, Target } from "./targets.js";

type AgentSetup = Pick<Target, "command" | "files" | "hints">;
interface SetupContext {
  choice: Choice;
  protocol: Protocol;
  localUrl: string;
  model?: string;
}

/** Quote one POSIX shell argument, including embedded quotes and metacharacters. */
export function shellArgument(text: string): string {
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

function jsonFile(path: string, value: unknown): SetupFile {
  return { path, content: JSON.stringify(value, null, 2) };
}

export function buildAgentSetup(context: SetupContext): AgentSetup {
  const { choice, localUrl } = context;
  switch (choice.agent) {
    case "claude-code":
      return {
        command: `ANTHROPIC_BASE_URL=${shellArgument(localUrl)} ENABLE_TOOL_SEARCH=true claude`,
        files: [],
        // Changing the API host otherwise changes Claude's deferred-tool behavior.
        hints: [
          "Tool search stays enabled so the proxy does not cause Claude to send all deferred tools.",
        ],
      };
    case "codex":
      return codexSetup(choice, localUrl);
    case "copilot":
      return {
        command: `COPILOT_API_URL=${shellArgument(localUrl)} copilot`,
        files: [],
        hints: ["HTTP requests are captured; WebSocket model traffic is unsupported."],
      };
    case "opencode":
      return openCodeSetup(context);
    case "pi":
      return piSetup(context);
  }
}

function codexSetup(choice: Choice, localUrl: string): AgentSetup {
  // Subscription traffic uses a different path from the public OpenAI API.
  const suffix = choice.provider === "chatgpt" ? "/backend-api/codex" : "/v1";
  return {
    command: `codex -c ${shellArgument(`openai_base_url="${localUrl}${suffix}"`)}`,
    files: [],
    hints: ["This flag overrides the API URL for this invocation only."],
  };
}

function openCodeSetup({ choice, protocol, localUrl, model }: SetupContext): AgentSetup {
  const baseURL = `${localUrl}/v1`;
  if (choice.provider === "custom" && protocol === "openai") {
    // A temporary provider lets OpenCode select a model absent from its catalogue
    // without editing the user's normal provider or small-model configuration.
    if (!model) throw new Error("A custom OpenCode setup requires a model ID.");
    const provider = "logger";
    const config = {
      model: `${provider}/${model}`,
      small_model: `${provider}/${model}`,
      provider: {
        [provider]: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL },
          models: { [model]: { name: model } },
        },
      },
    };
    return {
      command: `OPENCODE_CONFIG_CONTENT=${shellArgument(JSON.stringify(config))} opencode`,
      files: [],
      hints: [],
    };
  }

  const anthropic =
    choice.provider === "custom" ? protocol === "anthropic" : choice.provider === "anthropic";
  const environmentVariable = anthropic ? "ANTHROPIC_BASE_URL" : "OPENAI_BASE_URL";
  const provider = anthropic ? "anthropic" : "openai";
  return {
    command: `${environmentVariable}=${shellArgument(baseURL)} opencode`,
    files: [
      jsonFile("~/.config/opencode/opencode.json", {
        provider: { [provider]: { options: { baseURL } } },
      }),
    ],
    hints: [
      "Merge the printed provider options into your OpenCode config if it overrides the environment variable.",
    ],
  };
}

function piSetup({ choice, protocol, localUrl, model }: SetupContext): AgentSetup {
  const custom = choice.provider === "custom";
  const provider = custom
    ? protocol === "anthropic"
      ? "anthropic"
      : "openai"
    : choice.provider === "codex"
      ? "openai-codex"
      : choice.provider;
  // Pi's SDK supplies the remaining endpoint path, including /codex/responses.
  const suffix = provider === "openai-codex" ? "/backend-api" : provider === "openai" ? "/v1" : "";
  const settings = {
    baseUrl: localUrl + suffix,
    // Supplying models replaces Pi's built-in list; omit it for known providers.
    ...(custom ? { models: [{ id: model }] } : {}),
  };
  const files = [jsonFile("~/.pi/agent/models.json", { providers: { [provider]: settings } })];
  if (provider === "openai-codex") {
    files.push(jsonFile("~/.pi/agent/settings.json", { transport: "sse" }));
  }
  return {
    command: "pi",
    files,
    hints: [
      "Merge these settings with your existing files. A custom model list replaces that provider's catalogue.",
    ],
  };
}
