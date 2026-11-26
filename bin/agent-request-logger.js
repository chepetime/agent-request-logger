#!/usr/bin/env node
// Thin launcher: all parsing and behavior live in the compiled, tested CLI module.
const { run } = await import("../dist/cli.js");
process.exitCode = await run();
