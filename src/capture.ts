import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";
import * as zlib from "node:zlib";
import { decodeResponse, parseJson } from "./response-decoder.js";
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
const hidden = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "cookie",
  "set-cookie",
]);
export function safeHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      hidden.has(name.toLowerCase()) ? "[REDACTED]" : value,
    ]),
  );
}
export function requestText(bytes: Buffer, encoding = ""): string {
  try {
    switch (encoding.toLowerCase()) {
      case "gzip":
        return zlib.gunzipSync(bytes).toString();
      case "br":
        return zlib.brotliDecompressSync(bytes).toString();
      case "deflate":
        return zlib.inflateSync(bytes).toString();
      case "zstd": {
        const decode = (zlib as unknown as { zstdDecompressSync?: (value: Buffer) => Buffer })
          .zstdDecompressSync;
        if (!decode) throw new Error("zstd requires Node 22.15+ or 23.8+");
        return decode(bytes).toString();
      }
      case "":
      case "identity":
        return bytes.toString();
      default:
        throw new Error(`unsupported content encoding: ${encoding}`);
    }
  } catch (error) {
    return `[Body could not be decoded: ${(error as Error).message}. Original bytes are in .request.txt]`;
  }
}
function code(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "null");
  // Captured prompts may contain Markdown fences of their own. The enclosing
  // fence must be longer or the rest of the capture would render incorrectly.
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = "`".repeat(longest + 1);
  return `${delimiter}\n${text}\n${delimiter}`;
}
export function responseSummary(text: string, protocol: Protocol): string {
  const decoded = decodeResponse(text, protocol);
  const sections: string[] = [];
  if (decoded.text) sections.push(`### Assistant text\n\n${code(decoded.text)}`);
  if (decoded.reasoning) sections.push(`### Reasoning\n\n${code(decoded.reasoning)}`);
  if (decoded.tools.length) sections.push(`### Tool calls\n\n${code(decoded.tools)}`);
  if (decoded.usage.length) sections.push(`### Token usage\n\n${code(decoded.usage)}`);
  return sections.join("\n\n") || code(decoded.payloads.length ? decoded.payloads : text);
}

export function markdown(exchange: Exchange): string {
  const encoding = exchange.headers["content-encoding"];
  const text = requestText(exchange.request, Array.isArray(encoding) ? encoding[0] : encoding);
  const request = parseJson(text);
  const responseText = requestText(exchange.response, exchange.responseEncoding);
  const sections = [
    "# Agent HTTP capture",
    `${exchange.agent}\n\nRequest: ${exchange.requestId ?? "unassigned"}\n\n${exchange.method} ${exchange.url} → ${exchange.status} (${exchange.elapsedMs} ms)`,
    `## Request headers\n\n${code(safeHeaders(exchange.headers))}`,
  ];
  if (request && exchange.protocol !== "raw") {
    const system = request.system ?? request.instructions;
    if (system != null) sections.push(`## System instructions\n\n${code(system)}`);
    if (request.tools) sections.push(`## Tools\n\n${code(request.tools)}`);
    const messages = request.messages ?? request.input;
    if (messages) sections.push(`## Messages\n\n${code(messages)}`);
  }
  sections.push(`## Complete request\n\n${code(request ?? text)}`);
  sections.push(`## Response\n\n${responseSummary(responseText, exchange.protocol)}`);
  // Keep unrecognized events and provider-specific fields visible as well.
  sections.push(`## Complete response stream\n\n${code(responseText)}`);
  return `${sections.join("\n\n")}\n`;
}
export async function saveExchange(directory: string, exchange: Exchange): Promise<string> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const prefix = `${new Date().toISOString().replaceAll(":", "-")}_${exchange.requestId ?? randomUUID()}`;
  const base = path.join(directory, prefix);
  await Promise.all([
    fs.writeFile(`${base}.request.txt`, exchange.request, { mode: 0o600 }),
    fs.writeFile(`${base}.response.txt`, exchange.response, { mode: 0o600 }),
  ]);
  // Write Markdown last so a visible .md file means both raw files are ready.
  await fs.writeFile(`${base}.md`, markdown(exchange), { mode: 0o600 });
  return `${base}.md`;
}
