# Relay MVP Build Plan

This plan breaks the MVP into small, trackable build slices.

The goal is to build Relay as a real shared-context runtime for 0G models: model A works on a task, Relay compiles a verified Context Capsule, model B continues from that capsule, and the capsule can be published to 0G Storage.

No mock result counts as complete. Each milestone should end with something we can run, inspect, and prove.

## MVP definition

The MVP is complete when a developer can:

1. Initialize Relay locally.
2. Read the live 0G model catalog.
3. Run a real 0G Router chat completion.
4. Capture the model step as a Relay event.
5. Compile a Context Capsule.
6. Validate the capsule and keep facts separate from claims.
7. Build `compact`, `standard`, and `deep` context views.
8. Switch from one 0G model to another using a capsule view.
9. Show token/cost savings versus replaying the full conversation.
10. Publish an encrypted capsule to 0G Storage.
11. Fetch and verify the stored capsule.

## Non-negotiables

- [ ] Use 0G Router first, not Direct provider sub-accounts.
- [ ] Use live 0G model catalog data; do not hardcode the model list as truth.
- [ ] Record real `x_0g_trace` metadata from Router responses.
- [ ] Respect model capability flags before using JSON mode, tools, or vision.
- [x] Keep API keys out of committed files.
- [x] Store local Relay runtime data under `.relay/`, which is ignored by git.
- [ ] Never mark a model claim as verified unless Relay has evidence.
- [ ] Show estimated token use before model switching.
- [ ] Show actual Router billing after model calls when available.
- [ ] Publish encrypted capsules to 0G Storage by default.
- [ ] Avoid chain, DA, Agentic ID, and team sharing in the MVP.

## Phase 1: Project foundation

Create the local project skeleton and developer workflow.

- [x] Choose the package/runtime setup.
  - Selected: dependency-light Node.js CLI with TypeScript-ready package boundaries.
  - Keep package boundaries simple for MVP.
- [x] Create CLI entrypoint.
- [ ] Add formatting and linting. Linting is in place; formatter is still pending.
- [x] Add test runner.
- [x] Add `README.md` usage examples for MVP commands.
- [x] Add `.env.example` with required variable names only.
- [x] Add local config loader.
- [x] Add safe error handling for missing credentials.
- [x] Add first smoke test for CLI startup.

Done when:

- [x] `relay --help` runs locally.
- [x] Tests run locally.
- [x] No secret is required to run basic local tests.

## Phase 2: Protocol and schemas

Define the stable MVP data contracts before wiring more integrations.

- [ ] Create `relay.event.v1` schema.
- [ ] Create `relay.context.v1` schema.
- [ ] Create `relay.view.v1` schema.
- [ ] Define truth states:
  - [ ] `observed`
  - [ ] `verified`
  - [ ] `claimed`
  - [ ] `planned`
  - [ ] `failed`
  - [ ] `blocked`
  - [ ] `stale`
- [ ] Define model trace shape:
  - [ ] model ID
  - [ ] provider address
  - [ ] request ID
  - [ ] token usage
  - [ ] billing
  - [ ] `tee_verified`
- [ ] Add schema validation utilities.
- [ ] Add example fixtures for valid and invalid events/capsules.

Done when:

- [ ] Valid fixtures pass validation.
- [ ] Invalid fixtures fail with human-readable errors.
- [ ] Capsule validation rejects missing evidence for `verified` facts.

## Phase 3: Local capsule store

Build the local-first memory layer.

- [x] Create `.relay/` local data directory.
- [ ] Store events locally.
- [ ] Store capsules locally.
- [ ] Store context views locally.
- [ ] Store model traces locally.
- [ ] Add content hashing for stored payloads.
- [ ] Add basic capsule listing.
- [ ] Add capsule inspection command.

MVP storage can be simple JSON/JSONL files. SQLite can come later if the file format starts getting painful.

Done when:

- [ ] `relay capsule inspect` shows the latest capsule.
- [ ] Event and capsule files are deterministic enough for tests.
- [ ] Local `.relay/` data never appears in git status.

## Phase 4: 0G Router integration

Connect to real 0G Compute Router.

- [ ] Add Router client configuration.
- [ ] Support Router base URL.
- [ ] Support inference API key from environment/config.
- [ ] Implement `relay models`.
- [ ] Parse live model catalog:
  - [ ] model ID
  - [ ] context length
  - [ ] pricing
  - [ ] provider count
  - [ ] capabilities
- [ ] Implement one real chat completion call.
- [ ] Capture `x_0g_trace` from the response.
- [ ] Store token usage and billing data when returned.
- [ ] Add clear errors for invalid API key, missing balance, unavailable model, and unsupported capability.

Done when:

- [ ] `relay models` returns live 0G model data.
- [ ] `relay ask --model <model-id> "hello"` gets a real response.
- [ ] The response event includes model trace metadata.
- [ ] The local event record can be inspected after the call.

## Phase 5: Routing policy

Make model selection explainable and safe.

- [ ] Implement hard filters:
  - [ ] context window fits requested view
  - [ ] required JSON mode support
  - [ ] required tool support
  - [ ] required vision support
  - [ ] trust mode requirement
  - [ ] user budget limit
- [ ] Implement basic task modes:
  - [ ] diagnosis
  - [ ] capsule compilation
  - [ ] implementation
  - [ ] review
- [ ] Implement cheapest-capable selection.
- [ ] Add model selection explanation.
- [ ] Add failure escalation rule:
  - [ ] if schema generation fails twice, suggest or select a stronger eligible model.
- [ ] Add `relay route` preview command.

Done when:

- [ ] Relay can explain why it selected a model.
- [ ] Relay refuses a model that cannot fit the context.
- [ ] Relay refuses a model that lacks a required capability.
- [ ] Relay never silently picks an expensive model without showing estimated cost.

## Phase 6: Event capture and Context Capsule compiler

Turn model interactions into structured task memory.

- [ ] Record every model request and response as a Relay event.
- [ ] Add event hashing.
- [ ] Add event-to-capsule compiler.
- [ ] Use a structured-output prompt for capsule compilation.
- [ ] Validate compiler output against schema.
- [ ] Add repair or retry path for invalid JSON.
- [ ] Keep unsupported model statements as `claimed`, not `verified`.
- [ ] Add capsule update flow after each model step.

Done when:

- [ ] A real 0G model response becomes a valid capsule.
- [ ] Bad compiler output is rejected or repaired safely.
- [ ] The capsule shows facts, claims, next action, and model trace.
- [ ] The capsule does not pretend unverified claims are facts.

## Phase 7: Context modes

Build the token-efficient memory views.

- [ ] Implement `compact` view.
- [ ] Implement `standard` view.
- [ ] Implement `deep` view.
- [ ] Add token estimation for:
  - [ ] full event history
  - [ ] compact view
  - [ ] standard view
  - [ ] deep view
- [ ] Add context reduction percentage.
- [ ] Add mode-specific section selection.
- [ ] Add command preview before switch.

Done when:

- [ ] `relay capsule view --mode compact` produces a small handoff.
- [ ] `relay capsule view --mode standard` includes enough working state for normal continuation.
- [ ] `relay capsule view --mode deep` includes richer evidence.
- [ ] Relay displays estimated token savings compared with full-history replay.

## Phase 8: Model switching

Prove the core product loop.

- [ ] Implement `relay run "<task>" --auto --mode standard`.
- [ ] Implement `relay switch --to <model-id> --mode <mode>`.
- [ ] Build continuation prompt contract.
- [ ] Send capsule view to target model.
- [ ] Capture target model response as a new event.
- [ ] Update the capsule after the second model responds.
- [ ] Add transcript-independent continuation test using a real 0G call.

Done when:

- [ ] Model A performs a first task step.
- [ ] Relay creates and validates a capsule.
- [ ] Model B continues from a capsule view.
- [ ] Model B is not given the full prior transcript.
- [ ] Relay records token/cost difference between full history and capsule handoff.

## Phase 9: 0G Storage publishing

Make capsules portable.

- [ ] Add capsule bundle format:
  - [ ] `manifest.json`
  - [ ] `capsule.json`
  - [ ] `events.jsonl`
  - [ ] `traces/`
  - [ ] `handoff.md`
- [ ] Add client-side encryption before upload.
- [ ] Add 0G Storage upload.
- [ ] Store returned root/hash metadata.
- [ ] Add fetch/download by root.
- [ ] Enable proof verification on download where supported.
- [ ] Decrypt fetched capsule locally.
- [ ] Validate fetched capsule.

Done when:

- [ ] `relay capsule publish` uploads a real encrypted capsule to 0G Storage.
- [ ] `relay capsule fetch <root>` downloads it.
- [ ] Fetched capsule passes proof/decryption/validation.
- [ ] The fetched capsule can be used for a model continuation.

## Phase 10: Trust and privacy modes

Add the minimum production safety controls.

- [ ] Add `--trust normal`.
- [ ] Add `--trust verified`.
- [ ] Add `--trust private`.
- [ ] Map trust mode to 0G provider routing headers.
- [ ] Add `verify_tee: true` when verified mode requires it.
- [ ] Record whether `tee_verified` was true, false, or unavailable.
- [ ] Do not upload raw transcripts by default.
- [ ] Add redaction pass for obvious secrets before capsule publishing.
- [ ] Add clear warnings when verification is unavailable.

Done when:

- [ ] Verified mode requests TEE verification.
- [ ] Private mode uses private-provider routing where available.
- [ ] Relay honestly marks verification as unavailable when 0G does not return it.
- [ ] Published capsules do not contain obvious secrets in plaintext.

## Phase 11: Developer polish

Make the CLI feel good enough for real developers.

- [ ] Friendly command output.
- [ ] Clear progress messages.
- [ ] Human-readable errors.
- [ ] `relay doctor` command.
- [ ] `relay balance` or account guidance, if supported by configured credentials.
- [ ] `relay capsule list`.
- [ ] `relay capsule inspect`.
- [ ] `relay cost report`.
- [ ] README quickstart.
- [ ] Architecture links from README.

Done when:

- [ ] A new developer can understand the flow from README alone.
- [ ] Missing setup does not crash with ugly stack traces.
- [ ] Every external call explains what went wrong when it fails.

## Phase 12: Real MVP proof run

Run the end-to-end proof without mocks.

- [ ] Use live 0G Router model catalog.
- [ ] Use real model A call.
- [ ] Compile real capsule.
- [ ] Use real model B call with capsule view.
- [ ] Measure full-history tokens vs capsule-view tokens.
- [ ] Publish real encrypted capsule to 0G Storage.
- [ ] Fetch real capsule from 0G Storage.
- [ ] Validate fetched capsule.
- [ ] Continue from fetched capsule.
- [ ] Document exact commands and outputs in a proof note.

Done when:

- [ ] The proof note shows the whole loop.
- [ ] The repo can honestly say Relay works end-to-end.
- [ ] No demo step depends on mocked 0G behavior.

## Suggested first build slice

Start here:

- [ ] Project foundation
- [ ] Protocol schemas
- [ ] Local capsule store
- [ ] Live `relay models`

That gives us the first useful vertical base:

```txt
Relay can run locally, understand its own memory format, and see real 0G models.
```

After that, build the first real 0G model call and event capture.

## Progress log

Use this section to record completed milestones as the build advances.

- [ ] Phase 1 complete:
- [ ] Phase 2 complete:
- [ ] Phase 3 complete:
- [ ] Phase 4 complete:
- [ ] Phase 5 complete:
- [ ] Phase 6 complete:
- [ ] Phase 7 complete:
- [ ] Phase 8 complete:
- [ ] Phase 9 complete:
- [ ] Phase 10 complete:
- [ ] Phase 11 complete:
- [ ] Phase 12 complete:
