# Agent connections

The logger prints a command for your selected setup. Authenticate the agent
normally before using it; the logger does not provide credentials or sign in.

| Agent | Routes | How traffic is redirected |
| --- | --- | --- |
| Claude Code | Anthropic API or Claude subscription | `ANTHROPIC_BASE_URL`, with tool search explicitly enabled |
| Codex | OpenAI API key or ChatGPT subscription | An invocation-specific `openai_base_url` configuration flag |
| GitHub Copilot CLI | GitHub subscription | `COPILOT_API_URL` |
| OpenCode | Anthropic or OpenAI API key | Environment override; provider options can be merged into its configuration |
| Pi | Anthropic, OpenAI or ChatGPT subscription | Provider settings in `~/.pi/agent/models.json` |

Pi's ChatGPT route also needs SSE transport in `~/.pi/agent/settings.json`.
Existing setup files must be merged rather than blindly overwritten.
OpenCode's OpenAI route uses an API key, not its ChatGPT subscription login.
Some Copilot models use WebSockets, which this HTTP proxy cannot inspect.

## Custom endpoints

Select Custom base URL to use a local server or hosted gateway. The wizard
accepts HTTP or HTTPS, including ports and path prefixes. Credentials in the
URL, query strings, and fragments are rejected; authentication should be
configured in your agent.

Choose OpenAI, Anthropic, or raw rendering. This choice affects capture display;
it does not translate requests between protocols. The upstream must accept the
API the agent sends.

Pi custom endpoints require a model ID. OpenCode's custom OpenAI setup does too.
The wizard tries an unauthenticated `/v1/models` listing, with manual model
entry available. Discovery failing does not mean the provider is unavailable.

OpenCode's custom OpenAI setup uses a temporary `OPENCODE_CONFIG_CONTENT`
provider, leaving its normal configuration alone. Pi prints a provider override
with the selected model; this replaces that provider's model list.

## Capturing and diagnosing

Start the agent after setting the printed override. Token-counting and other
non-model traffic passes through without capture. Bursts of identical model
requests are limited to 20 captures per two-second window; upstream traffic
still passes through. The proxy does not retry requests itself.

A failed upstream connection produces HTTP 502 and a request ID. Console errors
include the operation and underlying cause. Use `--debug` for stack traces.
Malformed or unfamiliar response bodies remain visible in complete captures.

Captures are buffered in memory until the response ends. This tool is intended
for local inspection of individual sessions, not as a production telemetry
service. WebSocket requests receive HTTP 426.

The API-key routes for Claude Code, Codex, OpenCode and Pi have keyless
compatibility checks against a local provider. Subscription routes and Copilot
need manual validation with real accounts. Fake responses establish local
routing and capture behavior, not live provider acceptance.
