# Extending agent support

Add a route to `src/targets.ts` only after confirming that the agent can send
model traffic to a configurable local HTTP endpoint. Record the upstream URL,
protocol, launch override and any configuration files the agent needs.

Keep provider-specific setup in target resolution. The gateway should not know
which agent is using it. Custom targets must preserve upstream path prefixes
and use shell-safe arguments. Prefer temporary invocation settings where the
agent supports them.

Use the testing ownership rules in [TESTING.md](TESTING.md): setup decisions
belong in unit tests, actual shell interpretation belongs in integration tests,
and a real-agent compatibility case verifies third-party behavior. Add a
compatibility route only when it can run against a local provider with dummy
credentials and an isolated home. Document routes that require manual login.

Update `AGENT_GUIDE.md` when supported routes or setup instructions change.
