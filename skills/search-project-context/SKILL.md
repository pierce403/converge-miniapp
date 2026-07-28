---
name: search-project-context
description: Recover authoritative Converge Mini decisions, implementation history, known pitfalls, and current production evidence without trusting stale summaries. Use for "latest", status, handoff, prior-decision, unfamiliar-area, ambiguous bug, or cross-repository questions before planning or changing code.
---

# Search Project Context

Find the smallest authoritative context set, separate historical memory from
current fact, and report what still needs live verification.

## Workflow

1. Read `AGENTS.md`, inspect `git status --short --branch`, and identify the
   task's likely canonical owner.
2. Read the introduction and current delivery checkpoint in `features.md`, then
   only the task-relevant task/decision/risk sections.
3. Read `MEMORY.md` and use targeted `rg` across current code, tests, Git
   history, canonical docs, indexed notes, and skills:

   ```sh
   rg -n -i 'term|related term' AGENTS.md MEMORY.md SKILLS.md features.md docs agent-memory skills src worker scripts
   ```

4. Keep three states explicitly separate:
   - **worktree candidate:** staged, unstaged, and untracked local changes;
   - **committed source:** local `HEAD`, `origin/main`, tests, and the
     repository's intended contract;
   - **deployed production:** the Cloudflare build's exact Git SHA, immutable
     Worker version, canonical responses, and task-specific live behavior.
   Never infer that an uncommitted or pushed change is deployed.
5. Use the source authoritative for the claim:
   - current code/tests and canonical docs for intended behavior;
   - live production plus SHA-to-build-to-Worker correlation for deployment
     claims;
   - current official XMTP, Farcaster, and Cloudflare documentation for
     external contracts;
   - dated repository memory for historical navigation;
   - sibling repositories only when the boundary actually crosses into
     `../converge.cv` or `../vapid.party`.
6. Verify cheap, drift-prone claims live. If live verification is expensive or
   blocked, label the answer as historical and state the exact missing proof.
7. Return the outcome first with the three applicable states labeled, then the
   strongest file/commit/live evidence, contradictions or stale notes, and the
   next concrete check.

## Boundaries

- This workflow is read-only unless the user also asks for a change.
- Use external authenticated browser state when login-dependent evidence is
  required; do not assume the embedded Codex browser has the user's credentials.
- Use `rg` as the verified search path. Do not require `qmd` until its native
  runtime is repaired and tested.
- Do not print secrets, messages, private identifiers, raw production payloads,
  or authenticated browser state while gathering context.
