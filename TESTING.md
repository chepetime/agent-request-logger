# Testing pattern

Tests protect user-visible guarantees. Add a test at the lowest layer that can
prove the behavior, and give that behavior one primary owner. A higher-level
journey may cross the same code, but should assert the journey's outcome rather
than repeat every lower-level assertion.

## Layers and ownership

| Layer | Location | Owns | Does not own |
| --- | --- | --- | --- |
| Unit | `tests/unit/<subject>.test.ts` | Setup decisions, protocol decoding, path rules, diagnostic formatting | Files, sockets, subprocesses, library internals |
| Integration | `tests/integration/<boundary>.test.ts` | HTTP streaming and original bytes, credential forwarding, filesystem persistence, shell quoting | Agent installation, package layout, full console transcripts |
| CLI E2E | `tests/e2e/cli.test.ts` | Exit codes, argument validation, environment precedence, actionable startup failures | Rechecking each parser or provider option |
| Package E2E | `scripts/package-smoke.mjs` | Clean tarball installation and one complete installed-CLI logging journey in a different directory | Every protocol and agent combination |
| Compatibility | `tests/compatibility/run.ts` | Whether pinned real agents honor our printed commands and file settings | Live provider acceptance, paid accounts, subscription sign-in |

`npm test` runs unit and integration suites. `npm run test:e2e` builds and runs
CLI and package E2E. `npm run test:compat -- codex` runs an optional real-agent
check; omit the filter for all six keyless API-key routes. Compatibility is a
manual workflow because it downloads third-party CLIs and can fail independently
of our code. Run it when agent setup changes or before a proposed release.

## Current responsibilities

- `unit/targets`: provider selection, subscription URL differences, required
  custom model selection, and invalid URL rejection. Table-driven cases belong
  together when they exercise the same decision.
- `unit/capture`: one representative conversation per supported protocol shape,
  including reasoning, fragmented tools, usage, invalid bodies and embedded
  Markdown fences. Check extracted meaning, not a snapshot of the document.
- `unit/paths`: default and relative path policy without touching disk.
- `unit/errors`: stable error codes, causes and optional stacks. Never assert
  exact stack line numbers, generated IDs or platform-specific errno messages.
- `integration/gateway`: one broad streaming journey owns custom path prefixes, compressed request
  bytes, credential forwarding, response delivery before completion, redaction,
  and capture files. Separate failures cover unreachable upstreams and upgrades.
- `integration/preferences`: write/read behavior and unusable saved settings.
- `integration/commands`: a real shell proves model names remain literal.
- `e2e/cli`: argument and process behavior that imported functions cannot prove.
- Package E2E owns the default log-directory requirement for the installed CLI;
  there is no duplicate happy-path CLI E2E that repeats that journey.

The goal is coverage of important decisions and failure boundaries, not a test
count or blanket percentage. New features require examples at their owning
layer. Add an E2E only when the failure requires packaging, process startup, or
interaction across those boundaries to reproduce.

## Error and resource conventions

Pure modules return values or reject invalid inputs. I/O boundaries attach an
operation code and retain the original failure using `Error.cause`. Request
failures include a request ID, so console diagnostics correlate with captures.
Expected recoverable failures are handled at the boundary that can decide what
to do: for example, a preference-save failure warns without stopping the proxy.
Unexpected failures reach the CLI boundary and result in a nonzero exit code.

Tests assert the error classification, relevant context and external outcome.
They do not spy on every internal call. Debug-mode stack rendering is checked
once at unit level and once through an actual failed CLI startup.

No Effect dependency is needed for these conventions. Dependency injection is
limited to real boundaries, such as a local upstream URL and capture callbacks;
we do not introduce service layers merely to mock them.

## Isolation

Use loopback servers and temporary directories. Close sockets, terminate child
processes, and delete artifacts in teardown even when assertions fail. Wait for
readiness or completion events; bounded polling is reserved for process output
and filesystem observation. Do not use arbitrary long sleeps.

Compatibility processes receive a minimal environment, dummy keys, fresh HOME,
explicit CODEX_HOME and PI_CODING_AGENT_DIR, and private XDG directories. Pi's
extension, skill, prompt-template and theme discovery are disabled. Never run
an agent against the user's home, including a diagnostic `--help` invocation.
Production credentials and external model endpoints are not test fixtures.

Compatibility tests keep artifacts on failure for diagnosis. Their failures
must say which route failed. They do not skip silently. Real login routes remain
manual checks; a fake upstream cannot establish that authentication works with
a live provider.

## When changing a test

1. Name the behavior and its owner in the table above.
2. Extend an existing scenario if it can catch the regression clearly.
3. Add a separate scenario when it needs a different setup or failure trigger.
4. Avoid helper-only tests, enormous snapshots, and assertions derived from the
   same implementation data as the expected result.
5. Run affected layers, then the normal checks. Broaden to compatibility when
   changing provider commands, setup files or protocol behavior.

A native binary experiment such as scriptc should run the same external CLI
and package-contract scenarios against a second executable. It should not get
an independent duplicate suite with different expectations.
