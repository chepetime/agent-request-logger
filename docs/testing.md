# Testing

Test each behavior at the lowest layer that can prove it. Use broader tests
when a result depends on process startup, packaging, or third-party agents.
Those tests do not need to repeat every lower-level assertion.

## Test commands

| Command                     | Scope                                           | Verifies                                                               |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm test:unit`            | `tests/unit/`                                   | CLI parsing, setup decisions, decoding, redaction, paths, diagnostics  |
| `pnpm test:integration`     | `tests/integration/`                            | Real local HTTP, files, and shell interpretation                       |
| `pnpm test`                 | Unit and integration together                   | The normal development test loop                                       |
| `pnpm test:e2e`             | CLI processes and installed-package smoke check | Flags, startup failures, shutdown, clean install, and the full journey |
| `pnpm test:compat -- codex` | A pinned real CLI against a local provider      | Compatibility of our generated agent setup                             |

`pnpm check` adds lint and type checking to the normal tests and E2E suite.
The package smoke check packs with pnpm and installs the tarball with npm,
so development tooling does not become a consumer requirement.

## Existing coverage

- **Targets:** provider selection, subscription URL differences, custom model
  requirements, and unsuitable upstream URLs.
- **Captures:** representative Anthropic and OpenAI responses, fragmented tool
  arguments, reasoning, usage, compression, redaction, and unfamiliar payloads.
- **CLI parsing:** defaults, flag and environment precedence, port
  validation, rejection of unknown flags, and the test upstream rule.
- **Review file:** summaries for Anthropic and OpenAI responses, prompt
  deduplication, tool changes, escaped table cells, data framing, the empty
  session, and new-message detection across interleaved conversations.
- **Conversation:** compact lines for every supported message shape, part
  limits (including the real Claude Code reminder shape), caching-marker
  hashing, and turn matching for retries and compacted history.
- **Redaction:** a table of header names that must and must not be hidden.
- **Paths and errors:** working-directory policy, fixed diagnostic fields,
  cause chains, and optional debug stacks.
- **Gateway integration:** one streaming test covers path prefixes,
  compressed bytes, credential forwarding, incremental delivery, redaction,
  and capture files. Separate cases cover upstream failures, upgrades, the
  capture size limit, and draining open streams on close.
- **Preferences and commands:** saved data round-trips through the filesystem;
  model names remain literal when a shell interprets a generated command.
- **CLI E2E:** options, environment precedence, exit codes, startup errors,
  a clean SIGINT shutdown that saves an open stream and its review row, and
  `--no-review`.
- **Package E2E:** a packed tarball installs and logs traffic from an unrelated
  working directory, verifying that captures default to that directory.
- **Compatibility:** six pinned API-key routes prove that external agents
  honor their generated configuration, and that the review file reads their
  real payloads. Live providers, subscriptions, and
  Copilot login remain manual checks.

## Adding a test

Extend an existing scenario when it can demonstrate the regression clearly.
Create a new scenario when it needs a different setup or failure trigger.
Use tables for cases of the same decision; avoid a separate test for every
trivial helper. Test counts and blanket coverage percentages are not targets.

Assert meaningful output and externally visible results. Avoid full-document
snapshots, implementation call counts, exact generated IDs, stack line numbers,
or expected values derived from the same data being tested.

Errors should identify the operation, retain `Error.cause`, and include a
request ID for failed traffic. Tests check the classification and outcome.
They do not repeat every internal error-handling step at each layer.

## Isolation

Use loopback servers and temporary directories. Close sockets, terminate child
processes, and clean up after failures. Prefer readiness and completion events;
use bounded polling only for process output or filesystem observation.

Real-agent processes get dummy keys, a fresh HOME, explicit CODEX_HOME and
PI_CODING_AGENT_DIR, and private XDG directories. Pi discovery of extensions,
skills, prompt templates, and themes is disabled. Never run a real agent with
the user's configuration, even for a diagnostic `--help` command.

Compatibility failures keep their temporary artifacts for diagnosis and fail
the run rather than silently skipping a route. They are optional during normal
development and available through a manual GitHub workflow.

`AGENT_VERSIONS=latest pnpm test:compat` installs the newest agent releases
instead of the pins. The compatibility workflow does this every Monday, so a
breaking agent release shows up as a failed run before users report it.

## Automation

The CI workflow runs `pnpm check` (lint, types, unit, integration, CLI E2E,
and the packed-install smoke test) on a matrix:

| OS     | Node                                  |
| ------ | ------------------------------------- |
| Ubuntu | 22.15.0 (the `engines` floor), 24, 26 |
| macOS  | The version in `.nvmrc`               |

The repository explicitly allows esbuild's required install hook in
`pnpm-workspace.yaml`. Dependabot proposes weekly updates for GitHub Actions
and npm development dependencies; `@types/node` stays on the engines floor.

Release verification reuses CI and the compatibility workflow with pinned
agents.
See [releases](releases.md).
