import { expect, it } from "vitest";
import { type Environment, parseCommand } from "../../src/cli.js";

const base: Environment = { argv: [], env: {}, cwd: "/work", home: "/home/person" };
const start = (overrides: Partial<Environment>) => {
  const command = parseCommand({ ...base, ...overrides });
  if (command.kind !== "start") throw new Error(`Expected start, got ${command.kind}`);
  return command.options;
};

it("uses launch-relative defaults when nothing is configured", () => {
  expect(start({})).toEqual({
    port: 8787,
    logDir: "/work/request-logger-logs",
    preferenceFile: "/home/person/.agent-request-logger/.agent-choice.json",
    force: false,
    debug: false,
    review: true,
    testUpstream: undefined,
  });
});

it("gives flags precedence over environment variables, and ignores empty values", () => {
  const options = start({
    argv: ["--port", "9000", "--log-dir", "chosen", "--force", "--debug"],
    env: { PORT: "1", REQUEST_LOGGER_LOG_DIR: "ignored", REQUEST_LOGGER_CONFIG_DIR: "prefs" },
  });
  expect(options).toMatchObject({
    port: 9000,
    logDir: "/work/chosen",
    preferenceFile: "/work/prefs/.agent-choice.json",
    force: true,
    debug: true,
  });
  expect(start({ env: { PORT: "" } }).port).toBe(8787);
  expect(start({ env: { REQUEST_LOGGER_DEBUG: "1" } }).debug).toBe(true);
});

it("turns the review file off with --no-review", () => {
  expect(start({ argv: ["--no-review"] }).review).toBe(false);
});

it.each(["0", "65536", "80.5", "1e3", "http"])("rejects port %s", (port) => {
  expect(() => parseCommand({ ...base, argv: ["--port", port] })).toThrow("Port must");
});

it("rejects unknown options and positional arguments instead of ignoring them", () => {
  expect(() => parseCommand({ ...base, argv: ["--prot", "9000"] })).toThrow();
  expect(() => parseCommand({ ...base, argv: ["codex"] })).toThrow();
});

it("recognises help and version before validating other input", () => {
  expect(parseCommand({ ...base, argv: ["-h"], env: { PORT: "bad" } }).kind).toBe("help");
  expect(parseCommand({ ...base, argv: ["--version"] }).kind).toBe("version");
});

it("accepts only an origin as the test upstream", () => {
  expect(
    start({ env: { REQUEST_LOGGER_TEST_UPSTREAM: "http://127.0.0.1:1" } }).testUpstream?.href,
  ).toBe("http://127.0.0.1:1/");
  expect(() =>
    parseCommand({ ...base, env: { REQUEST_LOGGER_TEST_UPSTREAM: "http://127.0.0.1:1/v1" } }),
  ).toThrow("origin");
});
