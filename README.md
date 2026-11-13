# agent-request-logger

See what your coding agent sends to its model provider: system instructions,
tool definitions, messages, responses, and token usage. This CLI runs a local
HTTP proxy, forwards traffic to the provider, and saves readable captures on
your machine while streaming responses back to the agent.

Supports **Claude Code, Codex, GitHub Copilot CLI, OpenCode, and Pi**.
See [agent setup](docs/agents.md) for available providers and limitations.

## Install

Requires **Node.js 22.15 or newer**, npm, and an installed coding agent.
Launch commands printed by the logger use bash/zsh syntax.

Run without a global install:

```sh
npx agent-request-logger
```

Or install globally:

```sh
npm i -g agent-request-logger
agent-request-logger
```

Or install in a project:

```sh
npm i -D agent-request-logger
```

Add a script to that project's `package.json`:

```json
{
  "scripts": {
    "log:agent": "agent-request-logger"
  }
}
```

Then run:

```sh
npm run log:agent
```

The published CLI runs built JavaScript; consumers do not need pnpm or
TypeScript. This repository uses pnpm for development.

## Use

1. Open a terminal in the project where you want to save captures and start
   the logger using one of the commands above.
2. Choose your agent and provider. You can remember the setup for future runs.
3. Leave the logger running. It listens on `127.0.0.1:8787` by default.
4. In a second terminal, launch your agent with the exact command printed by
   the logger. Merge any printed configuration settings into your existing
   agent configuration first.
5. Send a message to the agent and open the newest Markdown file under
   `./request-logger-logs/` in the logger's working directory.
6. Press Ctrl+C in the logger terminal when finished.

Authenticate your agent normally before using the logger. Existing credentials
are forwarded to the configured upstream; the logger does not sign you in.

A single agent turn can make several model requests. Each captured request has
three files sharing a timestamp and request ID:

| File            | What it contains                                                          |
| --------------- | ------------------------------------------------------------------------- |
| `.md`           | Readable headers, instructions, tools, messages, response text, and usage |
| `.request.txt`  | Original request body bytes, including compression                        |
| `.response.txt` | Original upstream response body bytes                                     |

Captures default to `./request-logger-logs/` **where you launch the logger**,
including through npx, a global executable, or an npm script. Remembered setup
lives separately in `~/.agent-request-logger/.agent-choice.json`.

Sensitive HTTP headers are redacted in readable captures. Request and response
bodies can still contain private code or secrets. Add your capture directory
to the project's `.gitignore`.

## Options

```sh
npx agent-request-logger --force
npx agent-request-logger --port 9000
npx agent-request-logger --log-dir ./captures
npx agent-request-logger --config-dir ./preferences
npx agent-request-logger --debug
npx agent-request-logger --help
npx agent-request-logger --version
```

| Option            | Purpose                                          |
| ----------------- | ------------------------------------------------ |
| `--force`         | Forget the saved setup and choose again          |
| `--port`          | Change the listening port; default `8787`        |
| `--log-dir`       | Choose where captures are written                |
| `--config-dir`    | Choose where preferences are stored              |
| `--debug`         | Include stack traces in contextual error reports |
| `--help`, `-h`    | Show command help                                |
| `--version`, `-v` | Print the installed version                      |

With an npm script, pass options after `--`, for example
`npm run log:agent -- --port 9000`.

Environment alternatives are `PORT`, `REQUEST_LOGGER_LOG_DIR`, and
`REQUEST_LOGGER_CONFIG_DIR`. CLI options take precedence. Relative paths are
resolved from the logger's working directory.

## More

- [Agent setup and troubleshooting](docs/agents.md)
- [Contributing and local development](CONTRIBUTING.md)
- [Testing conventions](docs/testing.md)
- [Release process](docs/releases.md)

Licensed under [MIT](LICENSE).
