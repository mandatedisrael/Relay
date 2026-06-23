# Relay

Relay is shared working memory for 0G models.

0G gives developers access to many models through one Router API key. Relay sits on top and keeps structured task memory so you can switch models, resume later, or hand off to another tool without pasting a giant transcript every time.

The short version:

> 0G has many models. Relay gives them shared context.

Relay passes **task state**, not chat history. That memory is a **Context Capsule**: goal, verified facts, unverified claims, next action, model traces, and billing metadata.

## Choose how you want to use Relay

| If you want to… | Use this |
|---|---|
| Chat in the terminal with shared memory | `relay` (interactive session) |
| Keep using Claude Code, Codex, OpenCode, Aider, etc. | `relay proxy` + point the CLI's API base URL at Relay |
| Leave Relay and continue in another agent | `relay to claude-code` or `relay to codex` |
| Script or automate a workflow | `relay task …` or `relay -p "…"` |

All paths use the same `.relay/` task memory on disk.

## Prerequisites

- **Node.js 22+**
- **0G Router inference API key** (`OG_INFERENCE_API_KEY`) — for model calls
- **0G Storage private key** (`OG_STORAGE_PRIVATE_KEY`) — only for publish/fetch and `relay to`

## Install

From a clone:

```sh
git clone https://github.com/mandatedisrael/Relay.git
cd Relay
npm install
cp .env.example .env
```

Or link the CLI globally from the repo:

```sh
npm link
relay --help
```

## Configure

Edit `.env`:

```sh
OG_INFERENCE_API_KEY=sk-...          # required for model calls
OG_STORAGE_PRIVATE_KEY=0x...         # required for publish/fetch and relay to
```

Optional Router override (default is mainnet):

```sh
OG_ROUTER_BASE_URL=https://router-api.0g.ai/v1
```

## Verify setup

```sh
relay init
relay status
relay models --allowed
```

`relay status` checks local config and live Router connectivity.  
`relay models --allowed` shows which 0G models your API key can actually call — use those IDs with `--model`, `/model`, or `/to`.

## Usage examples

### Example 1: Interactive session (most direct)

```sh
relay init
relay --model glm-5.1
```

```txt
relay> diagnose why checkout fails in session.ts

[glm-5.1]
...

relay> /models
relay> /to 0gm-1.0-35b-a3b review the fix with a stronger model

Handing off to 0gm-1.0-35b-a3b (standard capsule view)...

[0gm-1.0-35b-a3b]
...

relay> /memory
relay> /publish
relay> /quit
```

**Slash commands**

| Command | Purpose |
|---|---|
| `/to <model-id> [message]` | Hand off task memory to another 0G model |
| `/model <model-id>` | Set the next model (handoff on your next message) |
| `/mode compact\|standard\|deep` | Capsule size for handoffs |
| `/memory` | Show current task memory |
| `/models` | List models your API key can use |
| `/publish` | Publish capsule to 0G Storage |
| `/help` | Full command list |
| `/quit` | Exit |

**Other launch modes**

```sh
relay "fix the checkout bug"     # interactive with first message
relay -c                         # resume active task
relay --model glm-5.1            # interactive with model set
relay -p "one-shot query"        # print mode, then exit
```

### Example 2: Proxy behind a coding CLI

Terminal 1 — start Relay:

```sh
relay init
relay proxy
# listening on http://127.0.0.1:8791/v1
```

Terminal 2 — use your normal CLI, pointed at Relay:

```sh
# Aider (example)
aider --openai-api-base http://127.0.0.1:8791/v1 --model glm-5.1

# Any other OpenAI-compatible CLI: set base URL to http://127.0.0.1:8791/v1
# and pick a 0G model ID your key supports
```

Relay is **client-agnostic**. Popular CLIs that accept a custom OpenAI-compatible base URL:

| CLI / client | Typical setup |
|---|---|
| **Claude Code** | Custom OpenAI-compatible base URL → `http://127.0.0.1:8791/v1` |
| **Codex** | Same |
| **OpenCode** | Same |
| **Cline** | VS Code extension → OpenAI base URL override |
| **Aider** | `--openai-api-base http://127.0.0.1:8791/v1` |
| **Continue** | Custom OpenAI provider base URL |
| **Cursor / Grok Build CLI** | If the client supports a custom OpenAI-compatible endpoint |

Relay forwards to 0G Router, captures each step into `.relay/`, and injects capsule handoffs on later calls. Your inference key stays in Relay's `.env`, not in the client.

If a CLI only speaks a native vendor API and cannot set a custom OpenAI base URL, use `relay` interactive or `relay to <target>` instead.

### Example 3: Hand off to another coding agent

After working in `relay` or `relay proxy`:

```sh
relay to claude-code --handoff-only
# or
relay to codex --message "Continue implementation from Relay memory"
```

This publishes encrypted memory to 0G Storage and writes a handoff file under `.relay/handoffs/`. Open that file in Claude Code, Codex, OpenCode, or another agent.

Fetch the same capsule elsewhere:

```sh
relay capsule fetch relay://0g-storage/mainnet/<root-hash> --key <hex-key>
```

### Example 4: Scripted workflow

```sh
relay task start --model glm-5.1 --goal "Fix checkout" --message "What is failing?"
relay task step --message "Propose a patch for session.ts"
relay task continue --to 0gm-1.0-35b-a3b --mode compact --message "Review the patch"
relay capsule publish
relay demo --mode compact          # full end-to-end proof (live 0G)
```

## What Relay can do

- **Interactive terminal session** — `relay>` prompt with streaming and slash commands
- **Model handoffs** — switch models via capsule views, not full transcript replay
- **Proxy mode** — OpenAI-compatible local proxy for Claude Code, Codex, OpenCode, Cline, Aider, Continue, Cursor, Grok Build CLI, and other compatible clients
- **Portable memory** — encrypted publish/fetch on 0G Storage
- **External agent bridges** — `relay to <target>` for handoff files + storage
- **Live 0G integration** — Router catalog, `x_0g_trace` billing, mainnet storage

Relay is Router-first. You still use your `OG_INFERENCE_API_KEY` and Router balance; Relay adds the memory layer Router does not provide.

## Context modes

Handoffs use one of three views of the same capsule:

| Mode | Best for | Typical size |
|---|---|---:|
| `compact` | quick low-cost switching | 1k-3k tokens |
| `standard` | normal developer workflow | 3k-8k tokens |
| `deep` | hard debugging or architecture work | 10k-30k tokens |

Set with `/mode` in interactive sessions or `--mode` on CLI commands. Relay reports estimated token savings vs replaying full event history.

## Command reference

```sh
relay                              # interactive session (default)
relay -p "query"                   # one-shot print mode
relay proxy [--port 8791]            # OpenAI-compatible proxy
relay status [--local]               # setup + connectivity check
relay models [--allowed]             # catalog; --allowed probes your key
relay to <target>                    # hand off to claude-code, codex, …
relay task start|step|continue|status
relay capsule handoff|publish|fetch|inspect|list
relay demo [--skip-storage]        # live end-to-end proof
relay --help
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

## Troubleshooting

| Problem | Fix |
|---|---|
| `OG_INFERENCE_API_KEY is required` | Set key in `.env`, run from project root |
| Model call fails / model not allowed | Run `relay models --allowed` and use a listed model ID |
| Publish fails | Set `OG_STORAGE_PRIVATE_KEY` and ensure storage wallet has 0G balance |
| `relay` prints help instead of a session | Run in a real terminal (TTY); non-TTY falls back to help |
| Proxy client gets errors | Confirm base URL is `http://127.0.0.1:8791/v1` and `relay proxy` is running |

## What Relay is not

- **Not a Router replacement** — all inference still goes through 0G Router
- **Not a hosted service** — local CLI/proxy; keys and task state stay on your machine
- **Not a full coding agent** — no built-in file editing, tools, or repo awareness
- **Not auto-routing yet** — you pick models (`/to`, `--model`); explainable routing is on the roadmap

## Development

```sh
npm run lint
npm test
```

Help, `relay status --local`, lint, and tests do not require secrets.

Design docs: [architecture.md](./architecture.md), [build_plan.md](./build_plan.md).

## Product principle

Relay is not trying to make models share one brain.

Relay gives them a shared external memory layer that is compact, structured, verifiable, portable, and honest about uncertainty. That honesty is the product.