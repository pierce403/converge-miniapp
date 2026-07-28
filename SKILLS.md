---
skills:
  curator: Maintain compact, current, privacy-safe repository knowledge.
  search-project-context: Recover authoritative decisions, history, and current evidence.
  publish-main-checkpoint: Verify, commit, push, and prove one coherent main checkpoint.
  diagnose-message-delivery: Trace XMTP receive and Farcaster alert failures end to end.
  recurse-advice-sync: Adapt current recurse.bot guidance to this repository.
source: https://recurse.bot/
catalog_reviewed: 2026-07-28
---

# Repository skills

Skills live at `skills/<name>/SKILL.md`; load only the workflow that matches the
task. Keep them concise, executable, and class-level. Prefer updating or
consolidating an umbrella skill over adding one for a single incident.

When creating or editing a skill, use the skill-creator workflow, keep
`agents/openai.yaml` aligned, run:

```sh
npm run skills:check
```

and forward-test complex workflow changes with a realistic request before
landing them.

`catalog_reviewed` covers catalog alignment only. External-guide freshness comes
from the newest dated Recurse review log indexed by `MEMORY.md`.
