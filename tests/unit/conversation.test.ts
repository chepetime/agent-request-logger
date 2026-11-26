import { expect, it } from "vitest";
import {
  describeMessage,
  fingerprint,
  MESSAGE_LINE_LIMIT,
  messageList,
  PART_LIMIT,
  previousTurn,
} from "../../src/conversation.js";

it.each([
  [{ role: "user", content: "Fix the\n  test" }, "user: Fix the test"],
  [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Reading." },
        { type: "tool_use", name: "Read", input: { path: "a.ts" } },
      ],
    },
    'assistant: Reading. [tool_use Read {"path":"a.ts"}]',
  ],
  [
    { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: "ok" }] }] },
    "user: [tool_result ok]",
  ],
  [
    { role: "assistant", content: [{ type: "thinking", thinking: "secret plan" }] },
    "assistant: [thinking]",
  ],
  [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ function: { name: "ls", arguments: "{}" } }],
    },
    "assistant: [call ls {}]",
  ],
  [
    { type: "function_call", name: "shell", arguments: '{"cmd":"ls"}' },
    'assistant: [call shell {"cmd":"ls"}]',
  ],
  [{ type: "function_call_output", output: "file.txt" }, "tool: [output file.txt]"],
  [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }, "user: hi"],
  [null, "item: "],
])("describes %j", (message, line) => {
  expect(describeMessage(message)).toBe(line);
});

it("keeps message lines short, part by part", () => {
  const long = describeMessage({ role: "user", content: "x".repeat(1000) });
  expect(long).toContain("… (1000 chars)");
  expect(long.length).toBeLessThan(PART_LIMIT + 30);
  // A long first part does not hide the prompt that follows it (real Claude Code shape).
  const line = describeMessage({
    role: "user",
    content: [
      { type: "text", text: `<system-reminder>\n${"context ".repeat(80)}\n</system-reminder>` },
      { type: "text", text: "y".repeat(500) },
      { type: "text", text: "Reply with a greeting." },
    ],
  });
  expect(line).toMatch(
    /^user: \[<system-reminder> \d+ chars\] y+… \(500 chars\) Reply with a greeting\.$/,
  );
  const parts = Array.from({ length: 20 }, () => ({ type: "text", text: "z".repeat(150) }));
  expect(describeMessage({ role: "user", content: parts })).toHaveLength(MESSAGE_LINE_LIMIT);
});

it("reads messages, Responses input items, and string input", () => {
  expect(messageList({ messages: [1, 2] })).toEqual([1, 2]);
  expect(messageList({ input: [3] })).toEqual([3]);
  expect(messageList({ input: "hello" })).toEqual([{ role: "user", content: "hello" }]);
  expect(messageList({ input: 5 })).toBeUndefined();
  expect(messageList(undefined)).toBeUndefined();
});

it("ignores moving prompt-caching markers when comparing content", () => {
  const block = { type: "text", text: "same" };
  expect(fingerprint({ content: [{ ...block, cache_control: { type: "ephemeral" } }] })).toBe(
    fingerprint({ content: [block] }),
  );
  expect(fingerprint({ content: [block] })).not.toBe(
    fingerprint({ content: [{ ...block, text: "other" }] }),
  );
});

it("continues the latest matching history and skips unrelated requests", () => {
  const main1 = ["a"];
  const title = ["t"];
  const main2 = ["a", "b", "c"];
  expect(previousTurn([main1, title], main2)).toEqual({ index: 0, shared: 1 });
  expect(previousTurn([main1, title, main2], ["a", "b", "c", "d"])).toEqual({
    index: 2,
    shared: 3,
  });
  // A retry sends the same history again.
  expect(previousTurn([main2], main2)).toEqual({ index: 0, shared: 3 });
  // Compacted history matches nothing.
  expect(previousTurn([main2], ["summary", "d"])).toBeUndefined();
  expect(previousTurn([undefined, []], ["a"])).toBeUndefined();
});
