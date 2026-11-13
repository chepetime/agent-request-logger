# Provenance and references

The initial local prototype was extracted from Matt Pocock / AI Hero's
[AI Coding Crash Course request logger](https://github.com/ai-hero-dev/ai-coding-crash-course/tree/main/request-logger).
Its implementation, tests and harness have been replaced for this standalone
project. The course remains credited as the inspiration for inspecting coding
agent requests. Its code is not distributed in the new repository history.

Other projects reviewed as references:

- [dreampulse/claude-code-logger](https://github.com/dreampulse/claude-code-logger),
  by Jonathan Häberle, is MIT-licensed and demonstrates a local inspection proxy.
- [Braintrust's Claude tracing article](https://www.braintrust.dev/articles/how-to-log-and-trace-claude-api-calls)
  describes instrumentation and trace data for Claude API applications.

No implementation from these references is vendored in this package. Their
licenses and terms do not apply to the original course code. This project's
standalone source is offered under the accompanying MIT license. Runtime and
development dependencies retain their respective licenses.
