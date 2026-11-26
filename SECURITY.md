# Security policy

## Supported versions

Only the latest published version receives fixes.

## Report a vulnerability

Do not open a public issue for a security problem. Use
[GitHub private vulnerability reporting](https://github.com/chepetime/agent-request-logger/security/advisories/new)
instead. Include the version, your agent and provider, and the steps to
reproduce. You will get a reply within seven days.

## Threat model

`agent-request-logger` is a local development tool.

- It listens on `127.0.0.1` only. Do not expose its port to a network.
- It forwards credentials to the upstream you choose. It does not store them.
- Markdown captures redact credential headers. Request and response bodies
  are saved as sent and can contain source code and secrets. Treat the
  capture directory as sensitive and keep it out of version control.
- Captures are created with owner-only file permissions.

Issues in scope include credential leaks into captures, a request changing
the configured upstream host, and files written outside the chosen capture
or preference directories.
