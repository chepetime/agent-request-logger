# Publication status and procedure

Local package: `agent-request-logger`, version `0.1.0`.
Planned repository: https://github.com/chepetime/agent-request-logger.
The remote repository was created private and empty. No code has been pushed,
and nothing has been published to npm. npm authentication is not configured
on this machine; a registry lookup returned 404 for the package name, which
does not reserve it or establish ownership.

Do not push, publish, or change remote visibility without explicit owner
permission. The workflow files are prepared locally; their presence does not
authorize a release.

## Local validation

Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run test:e2e`.
When agent setup changes, also run `npm run test:compat`. Those checks use dummy
keys and local provider responses. `TESTING.md` describes their boundaries.
`npm pack --dry-run` lists the artifact. The package E2E installs an actual
tarball and checks capture placement from an unrelated working directory.

The standalone implementation uses the MIT license. Keep LICENSE and NOTICE.md
in the package. Do not import code from the original course without an explicit
license covering that code.

## After authorization

1. Confirm the intended GitHub visibility and npm package name/account. Sign in
   to npm interactively, then check `npm whoami`. Never paste tokens into docs.
2. Push the fresh standalone history only. Review package contents and metadata
   before making the repository public.
3. For the first npm publication, run `npm publish --access public` from the
   verified source, with publication explicitly authorized. Complete any npm
   browser or two-factor authentication prompts yourself.
4. Configure the package's trusted publisher for GitHub owner `chepetime`,
   repository `agent-request-logger`, and workflow `publish.yml`.
5. For a later approved release, update the version, create its matching `v*`
   tag, and push that tag. The prepared workflow verifies the source before
   publishing with provenance. Do not reuse an existing npm version.
6. Verify the published executable with npx in a temporary project and confirm
   captures appear in that project's `request-logger-logs/` directory.

Trusted publisher setup is documented at
https://docs.npmjs.com/trusted-publishers/.
