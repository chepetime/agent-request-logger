# Agent setup

Choose your agent and provider in the logger, then follow the command and
configuration instructions it prints. Install and authenticate the agent
separately. Use bash or zsh for the generated commands.

| Agent              | Provider choices                           | Configuration                                                    |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------- |
| Claude Code        | Anthropic API or Claude subscription       | An environment override; tool search remains enabled             |
| Codex              | OpenAI API key or ChatGPT subscription     | A configuration override for the current invocation              |
| GitHub Copilot CLI | GitHub subscription                        | An API URL environment override                                  |
| OpenCode           | Anthropic or OpenAI API key                | An environment override, with provider configuration when needed |
| Pi                 | Anthropic, OpenAI, or ChatGPT subscription | Provider overrides in `~/.pi/agent/models.json`                  |

Merge printed file settings into your existing configuration. Pi's ChatGPT
route also prints SSE transport settings for `~/.pi/agent/settings.json`.
OpenCode's OpenAI route expects an API key; its ChatGPT subscription route
is not covered.

## Custom providers

Every agent offers **Custom base URL**. Enter an HTTP or HTTPS address,
including a port or path prefix if needed, and select OpenAI, Anthropic,
or raw capture rendering. Configure authentication in the agent; URLs with
credentials, query parameters, or fragments are rejected.

The rendering choice controls how the logger displays captures. It does not
translate requests between protocols. The endpoint must accept the format
the agent actually sends.

Pi custom setups and OpenCode's OpenAI-compatible custom setup require a model
ID. The wizard tries an unauthenticated `/v1/models` listing; you can choose a
listed model or enter one manually. Manual entry also works when discovery is
unavailable or requires authentication.

OpenCode uses temporary provider configuration for its custom OpenAI route.
Pi prints a provider model override containing your selected model; that
replaces the provider's built-in model list.

## Troubleshooting

**No captures:** Start the agent after applying the printed command. Check the
selected provider and log directory. Connectivity checks and token-counting
requests pass through without capture. Some agents use WebSockets; those
requests receive HTTP 426 because this proxy captures HTTP only.

**Upstream connection fails:** Check the scheme, host, port, path prefix,
credentials, and model ID. Connection failures return HTTP 502 with a request
ID; console diagnostics identify the operation and underlying cause. Use
`--debug` to include stacks.

**Many identical requests:** An agent may be retrying an upstream failure.
The logger forwards the responses but limits identical model captures to
20 per two-second window. It does not retry requests itself.

**Unexpected output:** The complete request and response stream remain in
the Markdown capture, and separate files preserve the original body bytes.
A provider-specific field may be visible there even if it has no dedicated
summary section.

## Limits and verification

This is a local inspection tool. Request and response bodies are buffered
until a response finishes, so avoid using it as a production telemetry proxy
or for arbitrarily large streams.

Pinned real-agent checks exercise six API-key routes against a local provider
with dummy credentials. They verify routing and captures, not live provider
acceptance. Copilot and subscription logins require manual checks with real
accounts. See [testing](testing.md) for the distinction.

Return to [installation and usage](../README.md).
