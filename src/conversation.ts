import { createHash } from "node:crypto";

/**
 * Message history helpers for the review file. Agents resend the whole
 * conversation on every request; these functions find what is new.
 * Provider payloads are untrusted: every field is checked before use.
 */

/** Longest text kept for one message line in the review file. */
export const MESSAGE_LINE_LIMIT = 400;
/** Longest text kept for one content part, so a long part cannot hide the next. */
export const PART_LIMIT = 160;

// Prompt-caching markers move to the newest blocks on every request, so they
// would make an unchanged message look different. They are not content.
const VOLATILE_KEYS = new Set(["cache_control"]);

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE_KEYS.has(key))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

/** Content hash that ignores prompt-caching markers. */
export function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)) ?? "")
    .digest("hex")
    .slice(0, 12);
}

/** Messages (Anthropic, Chat Completions) or input items (Responses). */
export function messageList(request: unknown): unknown[] | undefined {
  const body = request as { messages?: unknown; input?: unknown } | null | undefined;
  const list = body?.messages ?? body?.input;
  if (typeof list === "string") return [{ role: "user", content: list }];
  return Array.isArray(list) ? list : undefined;
}

const record = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);

const squash = (value: string) => value.replaceAll(/\s+/g, " ").trim();

// Agents inject context as text wrapped in one tag (<system-reminder>…).
// Name the tag and its size; the full text stays in the capture.
const WRAPPED = /^\s*<([A-Za-z][\w-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>\s*$/;

function describeText(value: string): string {
  const wrapped = WRAPPED.exec(value);
  if (wrapped) return `[<${wrapped[1]}> ${value.length} chars]`;
  const line = squash(value);
  return line.length > PART_LIMIT
    ? `${line.slice(0, PART_LIMIT - 1)}… (${value.length} chars)`
    : line;
}

function describePart(part: unknown): string {
  if (typeof part === "string") return describeText(part);
  const item = record(part);
  switch (item.type) {
    case "text":
    case "input_text":
    case "output_text":
      return describeText(text(item.text));
    case "tool_use":
      return `[tool_use ${text(item.name)} ${describeText(text(item.input))}]`;
    case "tool_result":
      return `[tool_result ${describeContent(item.content)}]`;
    case "thinking":
    case "redacted_thinking":
    case "reasoning":
      return "[thinking]";
    case "image":
    case "input_image":
      return "[image]";
    default:
      return `[${text(item.type) || "part"}]`;
  }
}

function describeContent(content: unknown): string {
  if (Array.isArray(content)) return content.map(describePart).join(" ");
  return describeText(text(content));
}

/** One short line per message: "role: content", with tool activity in brackets. */
export function describeMessage(message: unknown): string {
  const item = record(message);
  let role = text(item.role ?? item.type) || "item";
  let body: string;
  if (item.type === "function_call") {
    role = "assistant";
    body = `[call ${text(item.name)} ${describeText(text(item.arguments))}]`;
  } else if (item.type === "function_call_output") {
    role = "tool";
    body = `[output ${describeContent(item.output)}]`;
  } else if (item.type === "reasoning") {
    role = "assistant";
    body = "[thinking]";
  } else {
    const calls = Array.isArray(item.tool_calls)
      ? item.tool_calls.map((call) => {
          const fn = record(record(call).function);
          return `[call ${text(fn.name)} ${describeText(text(fn.arguments))}]`;
        })
      : [];
    body = [describeContent(item.content), ...calls].filter(Boolean).join(" ");
  }
  const line = `${role}: ${squash(body)}`;
  return line.length > MESSAGE_LINE_LIMIT ? `${line.slice(0, MESSAGE_LINE_LIMIT - 1)}…` : line;
}

/**
 * Find the latest earlier history that is a prefix of `current`. Requests from
 * other conversations (titles, sub-agents) are skipped because they do not match.
 * Returns the index into `earlier` and the shared length, or undefined.
 */
export function previousTurn(
  earlier: Array<string[] | undefined>,
  current: string[],
): { index: number; shared: number } | undefined {
  for (let index = earlier.length - 1; index >= 0; index--) {
    const candidate = earlier[index];
    if (!candidate?.length || candidate.length > current.length) continue;
    if (candidate.every((hash, position) => hash === current[position])) {
      return { index, shared: candidate.length };
    }
  }
  return undefined;
}
