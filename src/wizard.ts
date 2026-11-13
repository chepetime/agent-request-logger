import * as prompts from "@clack/prompts";
import { catalogue, needsModel, upstreamUrl, type AgentId, type Choice, type Protocol } from "./targets.js";
import { discoverModels } from "./preferences.js";

class Cancelled extends Error {}
function answer<T>(result: T): Exclude<T, symbol> {
  if (prompts.isCancel(result)) throw new Cancelled();
  return result as Exclude<T, symbol>;
}
export async function choose(rememberByDefault = false): Promise<{ choice: Choice; remember: boolean } | undefined> {
  try {
    prompts.intro("Agent request logger");
    const agent = answer(await prompts.select<AgentId>({ message: "Agent to inspect", options:
      Object.entries(catalogue).map(([value, entry]) => ({ value: value as AgentId, label: entry.label })),
    }));
    const provider = answer(await prompts.select<string>({ message: "Provider", options: [
      ...Object.entries(catalogue[agent].routes).map(([value, entry]) => ({ value, label: entry.label })),
      { value: "custom", label: "Custom base URL" },
    ] }));
    const choice: Choice = { agent, provider };
    if (provider === "custom") {
      choice.customBaseUrl = answer(await prompts.text({ message: "Upstream base URL", placeholder: "http://localhost:11434", validate(value) {
        try { upstreamUrl(value ?? ""); } catch { return "Enter an HTTP(S) URL without credentials, query, or fragment."; }
      } })).trim();
      choice.customRenderer = answer(await prompts.select<Protocol>({ message: "Capture format", options: [
        { value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" }, { value: "raw", label: "Raw JSON" },
      ] }));
      if (needsModel(choice)) {
        const models = await discoverModels(choice.customBaseUrl);
        if (models.length) {
          // Tagged values avoid collisions with a real model named "manual".
          const selection = answer(await prompts.select<{ id: string } | null>({ message: "Model", options: [
            ...models.map(id => ({ value: { id }, label: id })), { value: null, label: "Enter a model ID" },
          ] }));
          if (selection) choice.customModel = selection.id;
        }
        if (!choice.customModel) choice.customModel = answer(await prompts.text({ message: "Model ID", validate: value => value?.trim() ? undefined : "Enter a model ID." })).trim();
      }
    }
    const remember = rememberByDefault || answer(await prompts.confirm({ message: "Remember this setup?", initialValue: true }));
    return { choice, remember };
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    prompts.cancel("Setup cancelled.");
    return;
  }
}
