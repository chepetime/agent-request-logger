import { expect, it } from "vitest";
import { locations } from "../../src/preferences.js";

it("keeps captures under the launch directory and preferences under home", () => {
  expect(locations({}, "/work/project", "/home/person")).toEqual({
    logDir: "/work/project/request-logger-logs",
    preferenceFile: "/home/person/.agent-request-logger/.agent-choice.json",
  });
  expect(
    locations(
      { REQUEST_LOGGER_LOG_DIR: "captures", REQUEST_LOGGER_CONFIG_DIR: "prefs" },
      "/work/project",
    ),
  ).toEqual({
    logDir: "/work/project/captures",
    preferenceFile: "/work/project/prefs/.agent-choice.json",
  });
});

it("cannot change the configured host through an incoming double-slash path", async () => {
  const { requestPath } = await import("../../src/gateway.js");
  expect(requestPath(new URL("https://example.com/"), "//other.host/v1/responses")).toBe(
    "//other.host/v1/responses",
  );
});
