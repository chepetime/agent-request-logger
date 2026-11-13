# agent-request-logger

Inspect the HTTP traffic between your coding agent and its model provider.
A local proxy streams responses back to the agent and saves the request body,
response bytes, and a readable Markdown capture.

This standalone implementation is being prepared locally. It has not been
pushed or published. See [NOTICE.md](NOTICE.md) for project provenance.

## Run locally

Requires Node.js 22.15 or newer, npm, and a separately installed coding agent.
Commands printed for agents use bash/zsh syntax.

```sh
npm ci
npm run build
npm start
```

Choose an agent and provider, optionally remember the setup, and leave the
logger running. In another terminal, run the command it prints. If it prints
configuration files, merge those settings into your agent's configuration.

Each captured model call produces three files in `./request-logger-logs/`,
relative to the directory where you launched the command:

| File | Content |
| --- | --- |
| `.md` | Headers, request details, decoded response, and complete response stream |
| `.request.txt` | Request body bytes exactly as received, including compression |
| `.response.txt` | Upstream response body bytes |

Open the Markdown file first. Prompts, tool definitions, messages, reasoning,
and token usage appear when the provider includes them. Original bodies remain
available when the renderer does not recognize a field or event.

Authentication passes through to the configured provider. Sensitive HTTP
headers are redacted in readable captures. Body content can contain secrets or
private code; keep capture directories out of source control.

## Options

```sh
npm start -- --force
npm start -- --port 9000
npm start -- --log-dir ./captures
npm start -- --config-dir ./preferences
npm start -- --debug
npm start -- --help
npm start -- --version
```

Preferences default to `~/.agent-request-logger/.agent-choice.json`. Remembering
an agent never changes the default capture directory. `--force` clears the
remembered setup and asks again. CLI path and port options override `PORT`,
`REQUEST_LOGGER_LOG_DIR`, and `REQUEST_LOGGER_CONFIG_DIR`. Relative paths use
the launch directory. `--debug` adds stacks to contextual error reports.

Claude Code, Codex, GitHub Copilot CLI, OpenCode, and Pi are available.
[AGENT_GUIDE.md](AGENT_GUIDE.md) describes their configuration and limitations.

## Development

```sh
npm run typecheck
npm test
npm run test:e2e
npm run test:compat -- codex
```

[TESTING.md](TESTING.md) defines what each layer owns and when to add tests.
Real-agent compatibility checks are optional and download pinned tools under
`.cache/agents/`. Standard tests use temporary directories and local upstreams.
No real API credentials are required.

To exercise installation before publication, create a tarball with `npm pack`,
then launch it from a different directory:

```sh
npm exec --package=/absolute/path/to/agent-request-logger-0.1.0.tgz -- agent-request-logger
```

[RELEASING.md](RELEASING.md) records the publication procedure. Remote pushes
and publication require the owner's explicit permission.
