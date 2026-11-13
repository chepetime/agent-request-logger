import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as zlib from "node:zlib";
import type { IncomingHttpHeaders } from "node:http";
import type { Protocol } from "./targets.js";

export interface Exchange {
  requestId?: string;
  responseEncoding?: string;
  agent: string;
  protocol: Protocol;
  method: string;
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  request: Buffer;
  response: Buffer;
  elapsedMs: number;
}
const hidden = new Set(["authorization", "proxy-authorization", "x-api-key", "api-key", "x-goog-api-key", "cookie", "set-cookie"]);
export function safeHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, hidden.has(name.toLowerCase()) ? "[REDACTED]" : value]));
}
export function requestText(bytes: Buffer, encoding = ""): string {
  try {
    switch (encoding.toLowerCase()) {
      case "gzip": return zlib.gunzipSync(bytes).toString();
      case "br": return zlib.brotliDecompressSync(bytes).toString();
      case "deflate": return zlib.inflateSync(bytes).toString();
      case "zstd": {
        const decode = (zlib as unknown as { zstdDecompressSync?: (value: Buffer) => Buffer }).zstdDecompressSync;
        if (!decode) throw new Error("zstd requires Node 22.15+ or 23.8+");
        return decode(bytes).toString();
      }
      case "": case "identity": return bytes.toString();
      default: throw new Error(`unsupported content encoding: ${encoding}`);
    }
  } catch (error) { return `[Body could not be decoded: ${(error as Error).message}. Original bytes are in .request.txt]`; }
}
function code(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const delimiter = "`".repeat(longest + 1);
  return `${delimiter}\n${text}\n${delimiter}`;
}
function list(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function parse(text: string): any { try { return JSON.parse(text); } catch { return undefined; } }
export function responseSummary(text: string, protocol: Protocol): string {
  const chunks = text.split(/\r?\n\r?\n/).flatMap(event => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return [];
    const value = parse(data);
    return value ? [value] : [];
  });
  const values = chunks.length ? chunks : [parse(text)].filter(Boolean);
  if (protocol === "raw" || !values.length) return code(values.length ? values : text);
  let answer = "";
  let reasoning = "";
  const tools = new Map<string, { name: string; arguments: string }>();
  const usage: unknown[] = [];
  for (const event of values) {
    if (event.usage) usage.push(event.usage);
    if (event.message?.usage) usage.push(event.message.usage);
    if (event.response?.usage) usage.push(event.response.usage);
    if (protocol === "anthropic") {
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        tools.set(String(event.index), { name: event.content_block.name, arguments: "" });
      }
      if (event.delta?.text) answer += event.delta.text;
      if (event.delta?.thinking) reasoning += event.delta.thinking;
      if (event.delta?.partial_json) {
        const tool = tools.get(String(event.index));
        if (tool) tool.arguments += event.delta.partial_json;
      }
      for (const block of list(event.content)) {
        if (block?.type === "text") answer += block.text ?? "";
        if (block?.type === "thinking") reasoning += block.thinking ?? "";
        if (block?.type === "tool_use") tools.set(block.id, { name: block.name, arguments: JSON.stringify(block.input) });
      }
    } else {
      if (event.type === "response.output_text.delta") answer += event.delta ?? "";
      if (event.type === "response.reasoning_summary_text.delta") reasoning += event.delta ?? "";
      if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
        tools.set(event.item.id, { name: event.item.name, arguments: event.item.arguments ?? "" });
      }
      if (event.type === "response.function_call_arguments.delta") {
        const tool = tools.get(event.item_id);
        if (tool) tool.arguments += event.delta ?? "";
      }
      for (const choice of list(event.choices)) {
        const message = choice?.delta ?? choice?.message;
        if (typeof message?.content === "string") answer += message.content;
        if (message?.reasoning_content) reasoning += message.reasoning_content;
        for (const call of list(message?.tool_calls)) {
          if (!call || typeof call !== "object") continue;
          const key = String(call.index ?? call.id);
          const tool = tools.get(key) ?? { name: "", arguments: "" };
          tool.name += call.function?.name ?? "";
          tool.arguments += call.function?.arguments ?? "";
          tools.set(key, tool);
        }
      }
      // Non-streaming Responses API payloads contain completed output items.
      if (!chunks.length) for (const item of list(event.output)) {
        for (const content of list(item?.content)) if (content?.type === "output_text") answer += content.text ?? "";
        if (item?.type === "function_call") tools.set(item.id, { name: item.name, arguments: item.arguments });
      }
    }
  }
  const sections: string[] = [];
  if (answer) sections.push("### Assistant text\n\n" + code(answer));
  if (reasoning) sections.push("### Reasoning\n\n" + code(reasoning));
  if (tools.size) sections.push("### Tool calls\n\n" + code([...tools.values()]));
  if (usage.length) sections.push("### Token usage\n\n" + code(usage));
  return sections.join("\n\n") || code(values);
}
export function markdown(exchange: Exchange): string {
  const encoding = exchange.headers["content-encoding"];
  const text = requestText(exchange.request, Array.isArray(encoding) ? encoding[0] : encoding);
  const request = parse(text);
  const sections = [
    "# Agent HTTP capture",
    `${exchange.agent}\n\nRequest: ${exchange.requestId ?? "unassigned"}\n\n${exchange.method} ${exchange.url} → ${exchange.status} (${exchange.elapsedMs} ms)`,
    "## Request headers\n\n" + code(safeHeaders(exchange.headers)),
  ];
  if (request && exchange.protocol !== "raw") {
    const system = request.system ?? request.instructions;
    if (system != null) sections.push("## System instructions\n\n" + code(system));
    if (request.tools) sections.push("## Tools\n\n" + code(request.tools));
    const messages = request.messages ?? request.input;
    if (messages) sections.push("## Messages\n\n" + code(messages));
  }
  sections.push("## Complete request\n\n" + code(request ?? text));
  sections.push("## Response\n\n" + responseSummary(requestText(exchange.response, exchange.responseEncoding), exchange.protocol));
  // Keep unrecognized events and provider-specific fields visible as well.
  sections.push("## Complete response stream\n\n" + code(requestText(exchange.response, exchange.responseEncoding)));
  return sections.join("\n\n") + "\n";
}
export async function saveExchange(directory: string, exchange: Exchange): Promise<string> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const prefix = new Date().toISOString().replaceAll(":", "-") + "_" + (exchange.requestId ?? randomUUID());
  const base = path.join(directory, prefix);
  await Promise.all([
    fs.writeFile(base + ".request.txt", exchange.request, { mode: 0o600 }),
    fs.writeFile(base + ".response.txt", exchange.response, { mode: 0o600 }),
  ]);
  await fs.writeFile(base + ".md", markdown(exchange), { mode: 0o600 });
  return base + ".md";
}
