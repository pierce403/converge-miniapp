# Repository documentation map

Use the narrowest canonical owner so guidance stays searchable without drifting.

| Knowledge | Canonical owner |
| --- | --- |
| Mandatory agent behavior and responsibilities | `AGENTS.md` |
| Product scope, decisions, risks, gates, and verified release evidence | `features.md` |
| Infrastructure, secrets by name, deploy, verification, and rollback procedures | `docs/operations.md` |
| Browser/backend/service data handling and logging boundaries | `docs/privacy.md` |
| User-facing setup and contributor entry points | `README.md` |
| Durable cross-task navigation and lessons | `MEMORY.md` and `agent-memory/notes/` |
| Reusable, executable workflows | `SKILLS.md` and `skills/` |
| Compact dated guidance reviews | `agent-memory/logs/` |

Before adding a note, search the canonical source. Link instead of copying
mutable facts such as the current Worker version, test count, secret inventory,
or open release gate.

When the current code or live system disagrees with an older note, verify the
new state, update the canonical source, and correct or remove the stale note.
