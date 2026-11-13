import { expect, it } from "vitest";
import { type Choice, catalogue, resolveTarget, upstreamUrl } from "../../src/targets.js";

it("routes every retained provider through the selected local port", () => {
  for (const [agent, entry] of Object.entries(catalogue))
    for (const provider of Object.keys(entry.routes)) {
      const target = resolveTarget({ agent: agent as Choice["agent"], provider }, 9876);
      expect(target.upstream.protocol).toBe("https:");
      expect([target.command, ...target.files.map((file) => file.content)].join(" ")).toContain(
        "9876",
      );
    }
});

it("keeps the ChatGPT-specific paths distinct between agents", () => {
  expect(resolveTarget({ agent: "codex", provider: "chatgpt" }, 1234).command).toContain(
    "/backend-api/codex",
  );
  const pi = resolveTarget({ agent: "pi", provider: "codex" }, 1234);
  expect(pi.files[0].content).toContain("/backend-api");
  expect(JSON.parse(pi.files[1].content)).toEqual({ transport: "sse" });
});

it("rejects removed or unknown saved routes rather than changing providers", () => {
  expect(() => resolveTarget({ agent: "claude-code", provider: "unavailable" }, 8787)).toThrow(
    "--force",
  );
  expect(() =>
    resolveTarget({ agent: "unknown", provider: "openai" } as unknown as Choice, 8787),
  ).toThrow("--force");
});

it("requires a real model choice for Pi custom endpoints", () => {
  expect(() =>
    resolveTarget(
      {
        agent: "pi",
        provider: "custom",
        customBaseUrl: "http://localhost:8001",
        customRenderer: "anthropic",
      },
      8787,
    ),
  ).toThrow("model ID");
  const target = resolveTarget(
    {
      agent: "pi",
      provider: "custom",
      customBaseUrl: "http://localhost:8001",
      customRenderer: "anthropic",
      customModel: "local-model",
    },
    8787,
  );
  expect(JSON.parse(target.files[0].content).providers.anthropic.models).toEqual([
    { id: "local-model" },
  ]);
});

it.each([
  "ftp://host",
  "https://user:pass@host",
  "https://host?key=secret",
  "https://host#fragment",
])("rejects an unsuitable upstream %s", (url) => {
  expect(() => upstreamUrl(url)).toThrow();
});
