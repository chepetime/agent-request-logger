# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-26

### Added

- Graceful shutdown: Ctrl+C or SIGTERM saves open streams as incomplete
  captures before the logger exits. A second signal exits at once.
- Capture size limit: each request or response copy is limited to 64 MiB.
  Traffic is still forwarded in full, and the capture says it is truncated.
- Broader header redaction: any header named like a token, secret, key,
  password, cookie, signature, or credential is redacted.
- CI on Node 22.15 (the minimum), Node 24, and Node 26, plus macOS.
- A weekly compatibility run against the newest agent releases.
- GitHub releases are created from this changelog after npm publication.
- Logo, architecture guide, security policy, and Dependabot updates.

### Changed

- Generated commands use `http://127.0.0.1:<port>` instead of `localhost`,
  which matches the loopback address the logger listens on.
- `--force` keeps the saved setup until a new one is saved, so cancelling the
  wizard no longer loses it.
- Unknown flags and positional arguments are rejected instead of ignored.
- An empty `PORT` variable now falls back to the default port.
- Preferences are written atomically.
- Development tooling: TypeScript 7, Vitest 5, Biome 2.6.9. Pinned
  compatibility agents: Claude Code 2.1.332, Codex 0.172.0, OpenCode 1.19.6.

### Fixed

- The release workflow reports a clear cause when npm trusted publishing
  cannot authenticate, and skips publication when the version already exists.

## [0.1.1] - 2026-11-20

### Fixed

- Captures are saved when Codex closes a response stream before it ends.

## [0.1.0] - 2026-11-13

### Added

- First release: local logging proxy for Claude Code, Codex, GitHub Copilot
  CLI, OpenCode, and Pi, with Markdown captures and raw body files.

[Unreleased]: https://github.com/chepetime/agent-request-logger/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/chepetime/agent-request-logger/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/chepetime/agent-request-logger/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/chepetime/agent-request-logger/releases/tag/v0.1.0
