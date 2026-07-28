---
name: publish-main-checkpoint
description: Take one authorized, coherent Converge Mini change through scoped review, local verification, intentional commit, push to main, Cloudflare Workers Builds delivery, and live production proof. Use when implementation or documentation is ready to ship; do not use for read-only reviews or when the user has prohibited publication.
---

# Publish Main Checkpoint

Prove a change locally and on the delivery path without mixing unrelated work or
duplicating Cloudflare's production deployment.

## Preflight

1. Read `AGENTS.md`, the relevant `features.md` acceptance criteria, and Git
   status/diffs. Preserve unrelated user-authored changes.
2. Confirm the task is one coherent checkpoint and that product implementation
   and publication are authorized.
3. Inspect task-specific requirements:
   - after `wrangler.jsonc` changes, run `npm run cf-typegen`;
   - for backward-compatible D1 migrations, validate locally and preview, apply
     production before the dependent push, and prove no pending migrations.
     Remote migration writes require explicit operator authorization plus
     confirmed backup and rollback compatibility;
   - for skill or memory-system changes, run `npm run skills:check`, realistic
     forward-use review, applicable `npm run advice:check`, and a manual
     public-memory privacy review;
   - never expose a secret value while inspecting bindings or logs.

## Verify and review

1. Run focused and task-specific gates while iterating.
2. Run the repository wrapper:

   ```sh
   npm run verify
   ```

   It checks the HEAD-wide diff, the knowledge/type/lint/unit/build gate, and
   Playwright. Playwright starts `npm run preview` and exercises the
   production-shaped root plus `/api/health`. A restricted desktop sandbox may
   block Cloudflare's loopback-interface probe; rerun the same wrapper with the
   required local host permission rather than weakening the gate.
   Skip a task-specific gate only when it is genuinely inapplicable or blocked,
   and state the exact reason and remaining evidence boundary.
3. Review every diff. Stage only intended files, run
   `git diff --cached --check`, and inspect the complete staged diff.
4. Commit with a specific message and push `main` through the HTTPS GitHub
   remote. Finish with the local branch synchronized to `origin/main`.

## Prove delivery

1. Let Cloudflare Workers Builds pull `main`, run its gate, and deploy. Do not
   issue a duplicate manual production deploy merely to make it faster.
2. Bind every result to the pushed Git SHA: require GitHub's read-only CI to
   pass for that SHA, require the Cloudflare build record to name that SHA and
   succeed, and identify the resulting immutable Worker version.
3. Require the canonical root to return the expected app shell and
   `/api/health` to return HTTP 200 with `ok: true`,
   `service: "converge-miniapp"`, `environment: "production"`, the expected app
   version, and the immutable Worker ID. Correlate that ID with Cloudflare's
   deployment record, then exercise the task-specific production behavior.
4. Record the code-bearing commit, immutable deployment evidence, and remaining
   named acceptance gates in `features.md`. If this requires a second
   documentation-only evidence commit, verify/push it and prove its own
   GitHub/Cloudflare/root/health delivery in the final handoff, but do not create
   a third commit merely to record the evidence commit's new Worker ID.

## Stop conditions

Stop before commit/push when the full gate fails, the staged scope is mixed, a
required migration has not safely landed, credentials would be exposed, or the
change needs user authority beyond the requested task.
