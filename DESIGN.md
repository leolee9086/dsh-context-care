# Context care design and evidence

## Decision

Use S-forge's two independent context-load curves and agent-initiated maintenance, with DSH's existing transactional summarizer. Deliver measured grades in append-only user messages and show the exact recorded observation in Web. The implementation is an external Cordis package; agent-loop, compaction-basic and source repositories remain unchanged.

## Source observations

S-forge checkout `6d612b0b201ee4179ef1f42269167d711ae510d0`: `kernel/nerv/magi/sages/token_counter.go:441` applies the convex fatigue curve against the configured token/round/message budget; `:494` applies square-root wakefulness against one third of model capacity (token strategy). `sages/sage.go:356-391` appends a standalone user-role status at the true tail. `prompts/core.go:19` links these grades to deep rest. `coordinator/heartbeat_downtime.go` clears the context for a deep-rest request. These are source inspection findings, not validation of the psychological interpretation in its comments.

Codex reference checkout `dbe2f6d52812a99ad929f6f342fa95d9da15b6ed`: `codex-rs/core/src/session/token_budget.rs` records contextual budget reminders; `compact_token_budget.rs` models new-context operations through the normal compaction lifecycle, without a summary in token-budget mode. The reference was read only. DSH keeps summarization and the recent tail rather than copying that clearing behavior.

## Ownership and persistence

The root entry installs the whole capability once, for every session: tools register in the root scope (the tools service treats a root-scope registration as the global layer, and every agent's view inherits it), pre-step sampling runs on the `agent/pre-step` boundary whose payload carries the agent, and the shared replay projection used by the browser (including reads of idle sessions) is registered here too. The only per-agent input is the compaction provider, resolved at that boundary through `agentPresets.serviceFor(agent, 'compaction')`. The `/agent` entry remains an equivalent per-scope installation; when an agent's own scope already provides `context_rest`, the root instance stands down so one session is never sampled or compacted twice. The browser uses the session-scoped `useProjection('contextCareNumeric')` hook; no new HTTP endpoint or alternate token estimator exists in the client.

Requests use DSH's durable inbox, so compaction never rewrites history during a live parallel tool batch. The returned tool text says scheduled, not completed. The callback delegates to the existing waterfall first, preserves its complete admission result, performs at most one explicit compaction, and reports its observed outcome. Cancellation propagates. A failed operation does not report success. New history is priced with the current token meter, and range selection rejects a mismatched surface, retains a recent tail, balances tool calls/results, and excludes old checkpoint/status-only material from the fresh-content minimum.

## Cache and model behavior

Status strings are discrete and bounded. Numeric values are retained in message provenance for the UI, while model text retains grades. A notification is appended when either integer percentage changes (floor buckets), a grade changes, or a requested compaction produces an outcome; sub-percent changes do not repeat the same notification. Ordinary updates append at the tail using user role; old messages and system text are unchanged. UI projection derives only from committed attributed messages. Changed tool declarations on initial activation and a real compaction necessarily change request content; neither is advertised as a cache hit. The integration test compares full consecutive message prefixes and system text, then checks the real summary transaction and continuation.

The status prose rejects unsupported memory-quality inferences and artificial deadlines. This choice intentionally does not port S-forge's claim that higher fatigue means unreliable memories. The feature supplies an actionable context operation instead of suggesting stopping work. No real-model A/B measurement of anxiety-related outputs has been performed.

## Detection self-reference

Both anxiety detectors match phrases in the reasoning stream, and the plugin is authored in that same stream. Measured while adding `context-anxiety`: 8 of 8 hits in the authoring session came from writing trigger comments, README prose, notice text or the phrase list itself — not from the model being anxious about its budget. The earlier session that built `time-anxiety` has the same shape: 9 hits, all inside the range where that detector was being written.

This is a use/mention limit rather than a defect. A substring matcher cannot separate using a phrase from talking about it, so the false positives are structural: they return whenever the plugin is developed or discussed, and no edit to the word list removes them. Two remedies were considered and neither is implemented — suppress a hit whose window carries several distinct phrases or a quoting marker (a quote, a backtick, "phrases", or "|"), or detect the behaviour instead of the thought (skipped verification), which is far more expensive and crosses turns.

The copy is written to survive a false positive. Every notice opens with a conditional ("如果你正在盘算…"), so when the premise does not hold, the remaining lines only restate the working standard. Signing them as Seraph raises the cost of being wrong: a therapist that keeps misdiagnosing loses exactly the standing that makes its diagnosis worth anything.

## Dependencies and Host injection

All Host capabilities are obtained through Cordis injection and event/slot arguments. Runtime sources do not import Harness modules, and the package has no DSH dependency, peer dependency or checkout link. The injected tools registry accepts ordinary JSON Schema plus execution/render callbacks. Plugin messages are owned data with a Node-generated UUID; queueing and persistence belong to the injected Agent. Prefix selection is plugin policy over the supplied history view; actual summarization remains on the injected compaction service. Zod supplies Standard Schema configuration and projection validation, and React renders the client. The standalone Cordis npm package is a development-only test dependency.

The real Host composition test is a separate, explicitly invoked external test using `DSH_TEST_CHECKOUT`. It is excluded from release artifacts. Default installation, tests and build require no Harness checkout.

## Validation

The external package owns Node tests using real Cordis Loader YAML and actual built DSH core services, with only the LLM adapter mocked. Recorded status snapshots verify model-facing text; session event assertions verify tool-result ordering, committed compaction, preserved continuation note and resumed work. Replaying those events produces the same UI state. Additional tests cover grades, range balancing, failure, cancellation, repeated summaries, unload and localized rendering. The browser bundle is built independently and mounted into the existing Web application's composer dock.
