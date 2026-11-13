import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolveTarget, shellArgument } from "../../src/targets.js";
it("quotes a custom model without executing shell content", () => {
    const model = "test' $(printf hacked); `printf hacked`";
    const target = resolveTarget({ agent: "opencode", provider: "custom", customBaseUrl: "http://localhost:8001", customRenderer: "openai", customModel: model }, 8787);
    const script = target.command.replace(/ opencode$/, ` node -e ${shellArgument('process.stdout.write(process.env.OPENCODE_CONFIG_CONTENT)')}`);
    const output = JSON.parse(execFileSync("bash", ["-c", script], { encoding: "utf8" }));
    expect(output.model).toBe(`logger/${model}`);
    expect(output.provider.logger.models[model]).toEqual({ name: model });
  });
