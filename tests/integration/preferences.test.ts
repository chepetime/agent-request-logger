import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readPreference, writePreference } from "../../src/preferences.js";
import type { Choice } from "../../src/targets.js";

let scratch: string | undefined;
afterEach(async () => {
  if (scratch) await fs.rm(scratch, { recursive: true, force: true });
});
const choice: Choice = { agent: "codex", provider: "openai" };
it("round-trips remembered custom settings through a newly created directory", async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-preferences-"));
  const file = path.join(scratch, "nested", "choice.json");
  const custom: Choice = {
    ...choice,
    provider: "custom",
    customBaseUrl: "http://localhost:1234",
    customRenderer: "openai",
    customModel: "example",
  };
  await writePreference(file, custom);
  expect(await readPreference(file)).toEqual(custom);
  await fs.writeFile(file, '{"agent":"unknown","provider":"openai"}');
  expect(await readPreference(file)).toBeUndefined();
  await fs.writeFile(file, "broken");
  expect(await readPreference(file)).toBeUndefined();
});
