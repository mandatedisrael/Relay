# Relay

Relay is shared working memory for 0G models.

0G gives developers access to many models through one Router API key. Relay sits on top and keeps structured task memory so you can switch models, resume later, or hand off to another tool without pasting a giant transcript every time.

The short version:

> 0G has many models. Relay gives them shared context.

Relay passes **task state**, not chat history. That memory is a **Context Capsule**: goal, verified facts, unverified claims, next action, model traces, and billing metadata.

## What Relay can do

- **Interactive terminal session** — chat in a `relay>` prompt with streaming responses and slash commands
- **Model handoffs** — switch from a cheap model to a stronger one via capsule views (`compact`, `standard`, `deep`), not full transcript replay
- **Proxy mode** — put Relay in front of 0G Router so Cline, Codex, or any OpenAI-compatible client gets automatic memory capture and handoff injection
- **Portable memory** — publish encrypted capsules to 0G Storage, fetch them later, and continue from verified state
- **External agent bridges** — `relay to codex` or `relay to claude-code` publishes memory and writes a handoff file for another coding agent
- **Live 0G integration** — Router model catalog, real completions with `x_0g_trace`, and mainnet storage publish/fetch

Relay is Router-first. You still use your `OG_INFERENCE_API_KEY` and Router balance; Relay adds the memory layer Router does not provide.

## Quick start

### 1. Install and configure

```sh
npm install
cp .env.example .env
```

Set in `.env`:

```sh
OG_INFERENCE_API_KEY=sk-...          # required for model calls
OG_STORAGE_PRIVATE_KEY=0x...           # required for publish/fetch
```

### 2. Initialize

```sh
npm start -- init
```

This creates `.relay/` for local events, capsules, views, and traces.

### 3. Start an interactive session

```sh
npm start
# or: relay
```

You get a `relay>` prompt. Type messages directly. Relay updates task memory after each turn.

```txt
relay> diagnose the checkout failure in session.ts

[glm-5.1]
...

relay> /to 0gm-1.0-35b-a3b review the fix with a stronger model

Handing off to 0gm-1.0-35b-a3b (standard capsule view)...
```

Useful slash commands:

| Command | Purpose |
|---|---|
| `/to <model-id> [message]` | Hand off task memory to another 0G model |
| `/model <model-id>` | Set the next model (handoff on your next message) |
| `/mode compact\|standard\|deep` | Capsule size for handoffs |
| `/memory` | Show current task memory |
| `/models` | List models your API key can use |
| `/publish` | Publish capsule to 0G Storage |
| `/help` | Full command list |

Other launch modes:

```sh
relay "fix the checkout bug"     # interactive with first message
relay -c                         # resume active task
relay --model glm-5.1            # interactive with model set
relay -p "one-shot query"        # print mode, then exit
```

### 4. Use Relay behind Cline or Codex

```sh
relay proxy
```

Point the app's OpenAI base URL to `http://127.0.0.1:8791/v1`. Relay forwards to 0G Router, captures each step, and injects capsule handoffs on later calls. Your inference key stays in Relay's `.env`.

### 5. Hand off to another coding agent

```sh
relay to codex
relay to claude-code --handoff-only
```

This publishes encrypted memory to 0G Storage and writes a handoff file under `.relay/handoffs/`. Open that file in Codex or Claude Code to continue.

## Context modes

Handoffs use one of three views of the same capsule:

| Mode | Best for | Typical size |
|---|---|---:|
| `compact` | quick low-cost switching | 1k-3k tokens |
| `standard` | normal developer workflow | 3k-8k tokens |
| `deep` | hard debugging or architecture work | 10k-30k tokens |

Relay estimates token savings versus replaying the full event history before each handoff.

## Scripted commands

For scripts, CI, or explicit control:

```sh
relay status [--local]
relay models [--allowed]
relay task start --model <id> --goal "..." --message "..."
relay task step --message "..."
relay task continue --to <id> --mode compact --message "..."
relay capsule handoff --mode compact
relay capsule publish
relay capsule fetch <relay-url-or-root>
relay demo [--mode compact] [--skip-storage]
```

## Context Capsule example

A capsule is structured task state, not a chat summary:

```json
{
  "task": {
    "goal": "Fix checkout failure"
  },
  "state": {
    "next_action": "Patch checkout/session.ts and rerun checkout.test.ts"
  },
  "facts": [
    {
      "text": "checkout.test.ts fails before the fix",
      "truth_state": "observed"
    }
  ],
  "claims": [
    {
      "text": "The likely root cause is missing refresh-token handling",
      "truth_state": "claimed"
    }
  ]
}
```

Relay keeps the distinction between facts and claims on purpose. A model saying "tests pass" is not the same as Relay having evidence that tests passed.

## What Relay is not

- **Not a Router replacement** — all inference still goes through 0G Router
- **Not a hosted service** — local CLI/proxy; keys and task state stay on your machine
- **Not a full coding agent** — no built-in file editing, tools, or repo awareness
- **Not auto-routing yet** — you pick models (`/to`, `--model`); explainable routing is on the roadmap

## Development

Requirements: Node.js 22+.

```sh
npm run lint
npm test
```

Help and local checks do not require secrets. Live model calls need `OG_INFERENCE_API_KEY` in `.env` or the environment.

Design docs: [architecture.md](./architecture.md), [build_plan.md](./build_plan.md).

## Product principle

Relay is not trying to make models share one brain.

Relay gives them a shared external memory layer that is compact, structured, verifiable, portable, and honest about uncertainty. That honesty is the product.