import { expect, it } from "vitest";
import { formatError, LoggerError } from "../../src/errors.js";
it("shows operation context, request identity, and the system cause once", () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8000"), { code: "ECONNREFUSED" });
  const error = new LoggerError("UPSTREAM_FAILED", "POST /v1/responses", cause, "request-123");
  expect(formatError(error)).toBe("request=request-123 [UPSTREAM_FAILED] POST /v1/responses\n  caused by: [ECONNREFUSED] connect ECONNREFUSED 127.0.0.1:8000");
  expect(formatError(error)).not.toContain("errors.test.ts");
  expect(formatError(error, true)).toContain("errors.test.ts");
});
it("handles non-Error throws and cyclic cause chains", () => {
  expect(formatError("unexpected")).toBe("unexpected");
  const cyclic = new Error("loop"); cyclic.cause = cyclic;
  expect(formatError(cyclic)).toBe("loop");
});
