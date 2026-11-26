# Contributing

Development uses the Node version in `.nvmrc` and the pnpm version pinned in
`package.json`. Users of the published CLI can use npm and npx normally.

## Run from source

```sh
nvm install
nvm use
npm i -g pnpm@11.28.9
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Installing pnpm is a one-time setup. If it is already available, confirm
`pnpm --version` matches `packageManager` in `package.json`. Do not generate
an npm lockfile; dependency changes belong in `pnpm-lock.yaml`.

`pnpm dev` builds and starts the logger. Pass CLI options with
`pnpm start --port 9000`.

## Check a change

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

`pnpm check` runs those checks together. `pnpm lint:fix` applies safe lint and
import fixes; `pnpm format` formats supported files. `pnpm format:check` checks
formatting without writing changes. Biome respects the repository ignore rules.

Run `pnpm test:compat -- codex` when changing Codex's setup, or choose another
agent prefix. Omit the filter to check all real-agent routes. These checks
install pinned tools under `.cache/agents/` and use dummy credentials.

[Testing conventions](docs/testing.md) explain where to test each behavior
and how to avoid duplicate assertions.

## Source layout

[Architecture](docs/architecture.md) describes each module, the request
lifecycle, and the invariants that tests protect. In short: `cli.ts` is the
only reader of flags and environment variables, `gateway.ts` owns forwarding
and stream lifecycle, and `capture.ts` owns everything written to disk.

Keep protocol and agent quirks in their respective modules. Comments should
explain a constraint or a non-obvious choice. Prefer a small helper with a
clear job over another layer that merely forwards arguments.

## Pull requests

- Run `pnpm check` before you push. CI runs it on Node 22.15, 24, and 26 on
  Ubuntu, and on macOS.
- Add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for
  any change a user can notice.
- Run `pnpm test:compat` when you change generated commands or agent setup.

## Add an agent or provider

Confirm that the agent can send model requests to a configurable local HTTP
endpoint. Add routing data in `targets.ts` and launch instructions in
`agent-setup.ts`. Preserve custom path prefixes, quote shell values, and prefer
invocation-specific settings over persistent edits where possible.

Exercise setup decisions through target resolution. Bump the pinned version in
`tests/compatibility/run.ts` when a newer agent release needs different setup. Use an integration check
when shell interpretation matters. Add a real-agent compatibility case only
when it can use a local provider, dummy keys, and isolated configuration;
document login routes that need manual verification.

Update [agent setup](docs/agents.md) when supported choices or instructions
change. Use [the release guide](docs/releases.md) for packaging and publishing.
