# Releases

The public npm package is `agent-request-logger`. Its source is maintained at
[chepetime/agent-request-logger](https://github.com/chepetime/agent-request-logger).

## Publish a version

Use the Node version in `.nvmrc` and the pnpm version in `package.json`.

1. Update `package.json` to the intended version.
2. In [CHANGELOG.md](../CHANGELOG.md), move the `[Unreleased]` entries into a
   new `## [x.y.z] - YYYY-MM-DD` section and update the compare links.
3. Run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:compat
pnpm release:check vX.Y.Z
pnpm pack --dry-run
```

Review the packed contents: built JavaScript, the executable, README, MIT
license, and agent guide. Commit and push the version change to `main`.
Once CI passes, create and push the matching tag, for example:

```sh
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

**Pushing a `v*` tag starts publication automatically.** Only push a release
tag when publication is intended. The tag must match `package.json`, and its
commit must belong to `main`.

The workflow:

1. Validates the tag, version, license, repository, and changelog section
   with `scripts/release-check.mjs`, and confirms the commit is on `main`.
2. Checks npm. If the version already exists, publication is skipped, so a
   rerun is safe.
3. Runs the full CI matrix and all pinned real-agent compatibility routes on
   the exact tagged commit.
4. Builds and publishes that commit. npm authenticates GitHub Actions through
   OIDC and records public provenance. No npm token is stored in GitHub.
5. Creates the GitHub release with the changelog section as its notes.

The workflow can also be run manually from `main` with an existing tag.
Leave the publication checkbox off for verification only; enable it to publish.
An already published npm version cannot be reused. Check registry state before
retrying a failed release.

## Trusted publisher

The npm trusted publisher must match these values:

| Setting      | Value                  |
| ------------ | ---------------------- |
| GitHub owner | `chepetime`            |
| Repository   | `agent-request-logger` |
| Workflow     | `publish.yml`          |
| Environment  | `npm-release`          |
| Permission   | Publish                |

The GitHub `npm-release` environment may add required reviewers if desired.
When configured, its approval gate also applies to tag-triggered publication.
See [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).

The first publication requires an npm owner to sign in and bootstrap the
package before its trusted publisher can be registered.

### `ENEEDAUTH` during publication

npm reports `ENEEDAUTH` when the OIDC token does not match a trusted
publisher. The `v0.1.1` tag run failed this way, and a manual run of the same
commit 30 minutes later succeeded. The publish job now checks the
prerequisites first (an OIDC token and npm 11.5.1 or newer) and names the
values to compare. If it still fails, open the package's npm settings and
confirm that every value in the table above matches exactly, including the
workflow file name and environment. Then rerun the workflow; an existing
version is skipped.

## Verify the published CLI

From an unrelated directory, run:

```sh
npx agent-request-logger@VERSION --version
npx agent-request-logger@VERSION
```

Choose an agent setup and send a request. Confirm captures appear under that
launch directory's `request-logger-logs/` folder and preferences remain separate.
Consumer installation modes are documented in the [README](../README.md#install).
