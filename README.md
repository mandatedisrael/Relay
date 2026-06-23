# Relay

Relay is shared working memory for 0G models.

0G gives developers access to many models with different strengths: cheaper models, long-context models, coding models, private models, vision models, and verifiable providers. Relay helps those models work on the same task without forcing the developer to paste a giant transcript every time they switch.

Instead of copying chat history, Relay keeps a structured task memory called a **Context Capsule**.

That capsule records:

- what the task is,
- what has actually been verified,
- what is only a model claim,
- what decisions were made,
- which model/provider produced each step,
- how many tokens and credits were used,
- and what the next model should do next.

The short version:

> 0G has many models. Relay gives them shared context.

## Why this matters

Switching models is useful, but today it is messy.

A developer might want to:

- start with a cheap model for first-pass diagnosis,
- move to a stronger model for implementation,
- use a long-context model for review,
- use a private or verifiable provider for sensitive work,
- and then save the task state so another model can continue later.

Without Relay, this usually means copying a huge transcript and hoping the next model understands what is true, what is guessed, and what is already done.

Relay makes the handoff cleaner.

It turns:

```txt
Here is everything that happened.
```

into:

```txt
Here is the current task state.
Here is what is verified.
Here is what is uncertain.
Here is the next best action.
```

## How Relay fits 0G

Relay is designed around documented 0G infrastructure:

- **0G Compute Router** runs the models through one OpenAI-compatible interface.
- **0G Router model catalog** tells Relay which models support the needed capabilities.
- **0G trace metadata** helps Relay record provider, billing, request, and verification details.
- **0G Storage** stores encrypted portable context capsules.

Relay is Router-first, because Router gives developers one API key and one unified balance across models. Direct provider funding can come later for advanced workflows.

## Core idea: Context Capsules

A Context Capsule is the shared memory object.

It is not a normal summary. It is structured task state.

Example:

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

Relay keeps the distinction between facts and claims on purpose. A previous model saying “tests pass” is not the same as Relay having evidence that tests passed.

## Context modes

Relay will support three handoff modes from the MVP:

| Mode | Best for | Typical size |
|---|---|---:|
| `compact` | quick low-cost switching | 1k-3k tokens |
| `standard` | normal developer workflow | 3k-8k tokens |
| `deep` | hard debugging or architecture work | 10k-30k tokens |

The goal is to avoid burning tokens on the full conversation when the next model only needs the current working state.

The production design is documented in [architecture.md](./architecture.md).

## Product principle

Relay is not trying to make models magically share one brain.

Relay gives them a shared external memory layer that is:

- compact,
- structured,
- verifiable,
- portable,
- and honest about uncertainty.

That honesty is the product.
