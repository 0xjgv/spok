---
"spok": patch
---

Add deterministic inner flow control for `spok-apply`: `spok flow status|next|complete` owns step order, resume, and completion proof. `status` is read-only; blocked outcomes are never persisted, exit nonzero, and self-heal on the next query; file steps are verified against the expected artifact (non-empty), so `--output` is optional. The `spok-flow` skill runs each step in an isolated subagent and treats `spok flow next` as the only source of step order. Also update the Vitest toolchain to resolve audit findings, and baseline existing complexity debt with refactor-stable `name@file` keys plus a `complexity --update-baseline` regen command.
