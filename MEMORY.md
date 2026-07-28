---
summary: Compact index of durable, public-safe knowledge for Converge Mini work.
shelves:
  notes: agent-memory/notes
  people: agent-memory/people
  logs: agent-memory/logs
search: targeted rg; qmd pending verified runtime repair
index_reviewed: 2026-07-28
---

# Repository memory

This index helps an agent recover context without creating a second product
specification. Current code and live evidence outrank old notes. Canonical
ownership remains:

- [`features.md`](./features.md): product scope, decisions, acceptance gates,
  delivery status, and immutable deployment evidence.
- [`docs/operations.md`](./docs/operations.md): infrastructure and operator
  procedures.
- [`docs/privacy.md`](./docs/privacy.md): data and logging boundaries.
- [`AGENTS.md`](./AGENTS.md): mandatory operating agreement.
- [`SKILLS.md`](./SKILLS.md): reusable workflow catalog.

## Shelves

- [Repository documentation map](./agent-memory/notes/repository-map.md)
- [Known tooling pitfalls](./agent-memory/notes/known-tooling-pitfalls.md)
- [People-shelf privacy policy](./agent-memory/people/README.md)
- [2026-07-28 recurse.bot guidance review](./agent-memory/logs/2026-07-28-recurse-guidance-review.md)

`index_reviewed` covers this navigation structure only. The newest dated
`recurse-guidance-review` filename, not that frontmatter value, determines when
the external guide was last reviewed.

## Retrieval

Start from Git status and the task-relevant canonical document, then use a
targeted search:

```sh
rg -n -i 'term|related term' AGENTS.md MEMORY.md SKILLS.md features.md docs agent-memory skills src worker scripts
```

Verify drift-prone claims against current code, official documentation, or the
live system. `qmd` is optional and must not be treated as operational until its
local native-module ABI mismatch is repaired and the supported Node runtime is
verified.

## Curation

Add only knowledge likely to improve future work. Merge or prune stale material,
update this index when shelves change, and route reusable procedures into a
skill. Dated logs record compact review outcomes and evidence; they are not
session transcripts or a place for raw production data.
