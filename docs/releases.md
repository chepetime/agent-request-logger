# Releases

The package is prepared for npm as `agent-request-logger`. The GitHub repository
is currently private and empty; no source has been pushed and no npm version
has been published.

Do not push, change repository visibility, or publish without the owner's
explicit permission. Workflow files describe how an approved release will
work; they do not authorize one.

## Local preparation

Use `.nvmrc` and the pnpm version in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:compat
pnpm pack --dry-run
```

Review package metadata, README commands, LICENSE, and packed file contents.
Keep build output and dependencies out of Git. The package must include built
JavaScript, its executable, the MIT license, and `docs/agents.md`.

## First publication

After explicit approval:

1. Confirm the GitHub visibility and npm account/package name. An available
   name is not reserved until npm accepts a publication.
2. Push the reviewed source and approve any intended visibility change.
3. Sign in interactively with `pnpm login`; check the account with `pnpm whoami`.
4. Publish the verified version using `pnpm publish --access public`. Complete
   any browser or two-factor authentication prompt yourself.
5. Register the npm trusted publisher for owner `chepetime`, repository
   `agent-request-logger`, workflow `publish.yml`, and environment `npm-release`.
6. Configure required reviewers on the GitHub `npm-release` environment. Merely
   naming the environment in YAML does not configure its approval rules.

Follow [npm's trusted publisher setup](https://docs.npmjs.com/trusted-publishers/).
The publication job uses short-lived OIDC credentials rather than a stored
npm token. Public provenance requires a public source repository.

## Later releases

Update the package version, validate the source, and create its matching `v*`
tag. Push only after permission. Pushing a tag does not publish anything.

Run **Publish to npm** manually from `main`, supplying the tag. Leave the
publication checkbox off to run verification only. An approved publication
requires explicitly enabling that checkbox and passing the `npm-release`
environment's configured approval rules.

The workflow resolves the tag to one commit, checks release metadata, reuses
the CI checks, and runs all real-agent compatibility routes. The publication
job checks out that same commit, installs the frozen lockfile, rebuilds, and
publishes. Its publish command skips lifecycle hooks because the selected
commit has already passed verification and is rebuilt explicitly.

npm package versions cannot be reused. If a release fails after upload, check
registry state before attempting another publication.

## Verify the published CLI

From an unrelated temporary directory, run `npx agent-request-logger@VERSION`,
choose a setup, and send a real agent request. Confirm its captures appear in
that directory's `request-logger-logs/` folder and preferences remain separate.

Check global and project-local usage when changing executable packaging. The
installation modes are documented in the [README](../README.md#install).
