import type { Protocol } from "./targets.js";

interface ToolCall {
  name: string;
  arguments: string;
}
interface Conversation {
  text: string;
  reasoning: string;
  tools: Map<string, ToolCall>;
  usage: unknown[];
}
export interface DecodedResponse {
  text: string;
  reasoning: string;
  tools: ToolCall[];
  usage: unknown[];
  /** Parsed payloads are retained when no known text or tool shape was found. */
  payloads: unknown[];
}

// Provider payloads are untrusted and change independently of this package.
// Check containers as they are read; the full payload is not schema-validated.
// The complete stream is also kept in the Markdown capture.
function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function streamEvents(text: string): any[] {
  return text.split(/\r?\n\r?\n/).flatMap((event) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return [];
    const payload = parseJson(data);
    return payload ? [payload] : [];
  });
}

/** Decode either SSE events or one completed JSON response into display data. */
export function decodeResponse(text: string, protocol: Protocol): DecodedResponse {
  const events = streamEvents(text);
  const payloads = events.length ? events : [parseJson(text)].filter(Boolean);
  const conversation: Conversation = {
    text: "",
    reasoning: "",
    tools: new Map(),
    usage: [],
  };

  if (protocol !== "raw") {
    for (const event of payloads) {
      appendUsage(conversation, event);
      if (protocol === "anthropic") appendAnthropic(conversation, event);
      else appendOpenAI(conversation, event, events.length > 0);
    }
  }

  return {
    text: conversation.text,
    reasoning: conversation.reasoning,
    tools: [...conversation.tools.values()],
    usage: conversation.usage,
    payloads,
  };
}

function appendUsage(result: Conversation, event: any): void {
  for (const usage of [event.usage, event.message?.usage, event.response?.usage]) {
    if (usage) result.usage.push(usage);
  }
}

function appendAnthropic(result: Conversation, event: any): void {
  if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
    result.tools.set(String(event.index), { name: event.content_block.name, arguments: "" });
  }
  if (event.delta?.text) result.text += event.delta.text;
  if (event.delta?.thinking) result.reasoning += event.delta.thinking;
  if (event.delta?.partial_json) {
    const tool = result.tools.get(String(event.index));
    if (tool) tool.arguments += event.delta.partial_json;
  }

  // A non-streaming Messages response carries complete blocks instead of deltas.
  for (const block of array(event.content)) {
    if (block?.type === "text") result.text += block.text ?? "";
    if (block?.type === "thinking") result.reasoning += block.thinking ?? "";
    if (block?.type === "tool_use") {
      result.tools.set(block.id, { name: block.name, arguments: JSON.stringify(block.input) });
    }
  }
}

function appendOpenAI(result: Conversation, event: any, streaming: boolean): void {
  if (event.type === "response.output_text.delta") result.text += event.delta ?? "";
  if (event.type === "response.reasoning_summary_text.delta") result.reasoning += event.delta ?? "";
  if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
    result.tools.set(event.item.id, {
      name: event.item.name,
      arguments: event.item.arguments ?? "",
    });
  }
  if (event.type === "response.function_call_arguments.delta") {
    const tool = result.tools.get(event.item_id);
    if (tool) tool.arguments += event.delta ?? "";
  }

  for (const choice of array(event.choices)) {
    appendChatMessage(result, choice?.delta ?? choice?.message);
  }

  // A completed stream repeats output items in its final response event.
  // Read those only for JSON responses, or the text would be counted twice.
  if (!streaming) appendCompletedOutput(result, event.output);
}

function appendChatMessage(result: Conversation, message: any): void {
  if (typeof message?.content === "string") result.text += message.content;
  if (message?.reasoning_content) result.reasoning += message.reasoning_content;
  for (const call of array(message?.tool_calls)) {
    if (!call || typeof call !== "object") continue;
    // Stream fragments identify a call by index; complete messages use an ID.
    const key = String(call.index ?? call.id);
    const tool = result.tools.get(key) ?? { name: "", arguments: "" };
    tool.name += call.function?.name ?? "";
    tool.arguments += call.function?.arguments ?? "";
    result.tools.set(key, tool);
  }
}

function appendCompletedOutput(result: Conversation, output: unknown): void {
  for (const item of array(output)) {
    for (const content of array(item?.content)) {
      if (content?.type === "output_text") result.text += content.text ?? "";
    }
    if (item?.type === "function_call") {
      result.tools.set(item.id, { name: item.name, arguments: item.arguments });
    }
  }
}
