# Agent Guidelines for converge-miniapp

## Scope

These instructions apply to the entire repository.

## Project direction

- Build a deliberately small XMTP messaging app that runs as a Farcaster Mini App.
- Borrow the visual language and interaction quality of the sibling `../converge.cv` project without copying its full feature set or architecture by default.
- Treat `features.md` as the living product scope, decision log, and delivery tracker.
- Deploy the SPA and first-party API to Cloudflare Workers at `miniapp.converge.cv`. Keep the XMTP payer Gateway behind a replaceable boundary so Cloudflare Containers and an external container host can be compared independently.
- Use the Farcaster host-provided EVM wallet as the first-release XMTP identity. Never silently substitute an app-owned private key.

## Working agreement

- Start by reading this file, `features.md`, the current Git status, and any task-specific docs.
- Work in small, coherent tasks. Verify each task, commit it, and push it to GitHub before starting the next task.
- Keep unrelated changes out of the same commit and preserve user-authored changes already in the worktree.
- Record decisions, successful approaches, failed experiments, and important collaborator preferences while they are fresh.
- Prefer repeatable CLI commands and repo-local configuration over undocumented dashboard steps.
- Use GitHub CLI and HTTPS-backed GitHub authentication for repository operations; do not spend time debugging SSH first.
- If requirements are uncertain, write the uncertainty into `features.md` as an open decision instead of silently turning an assumption into scope.

## Product guardrails

- Keep the first release narrow: launching, establishing the user's identity, viewing conversations, reading messages, and sending a message must feel excellent before adding breadth.
- Use current official Farcaster, XMTP, and hosting-provider documentation for integration details that can drift.
- Never describe transport encryption as anonymity. Be precise about what XMTP protects and what metadata may remain visible.
- Never send private keys, message plaintext, or decrypted attachments to the app backend, logs, analytics, or error reporting.
- Prefer on-device storage for XMTP client state and decrypted content. Any server-side data collection must be minimal, documented, and user-removable.
- Treat wallet signatures and permission prompts as costly interactions: explain them in plain language and request them only when needed.
- Design mobile-first for an embedded Mini App, including safe areas, constrained viewport heights, touch targets, keyboard behavior, loading states, and host-app dismissal/re-entry.
- Treat Farcaster `safeAreaInsets` as obscured regions by default, but preserve verified host-specific behavior. Current first-release mobile-client support uses only the CSS device top inset in ready messaging because live canonical-host verification shows native top chrome is already outside the webview; reverify this assumption before declaring another mobile client supported. Setup states and web clients continue to honor the reported host top inset. Do not infer which edge is clipped from total viewport height.
- Maintain usable browser behavior outside Farcaster for development and recovery, but do not let the standalone mode complicate the Mini App MVP.

## Design direction

- Inspect the current `../converge.cv` implementation before making visual claims; filenames and past screenshots are not a substitute for the live code.
- Reuse design tokens or small presentational patterns deliberately, not whole feature modules.
- Preserve the sibling app's warmth, clarity, and identity-forward feel while reducing navigation, settings, explanatory copy, and secondary actions.
- Accessibility is part of the design: preserve contrast, visible focus, reduced-motion support, readable type, and semantic controls.

## Documentation and delivery

- Keep completed, planned, deferred, and rejected work visibly distinct in `features.md`.
- Every feature needs testable acceptance criteria before implementation starts.
- Document any required Cloudflare resources, secrets, migrations, domains, and deployment commands in the repository as they are introduced.
- GitHub Actions is read-only CI. Production delivery is owned by Cloudflare Workers Builds, which pulls `main` through the Cloudflare GitHub App, runs `npm run check`, and then runs `npx wrangler deploy`.
- Never store Cloudflare API tokens, account IDs, or other Cloudflare account credentials in GitHub Actions secrets. Keep the GitHub workflow unable to deploy.
- Install reproducibly with `npm ci` (or `npm install` when intentionally updating the lockfile).
- Generate Worker bindings after changing `wrangler.jsonc` with `npm run cf-typegen`.
- Run the full local gate with `npm run check`; its typecheck, lint, test, and production-build stages must all pass.
- Run the production-shaped local app with `npm run preview`; verify both `/` and `/api/health` before deployment.
- Deploy the preview environment with `npm run deploy:preview` and production with `npm run deploy`. Never deploy around a failing `npm run check`.
- In addition to the full gate, verify changes with `git diff --check` and review all staged content before committing.

## Current boundaries

- Product implementation is authorized. Keep each coherent task independently verified, committed, and pushed.
- Keep the production Farcaster manifest fetchable before ownership bootstrap: with no association values configured, serve metadata without `accountAssociation`, force `noindex: true`, and use `Cache-Control: no-store` so ownership verification cannot race a cached unsigned response. Partial, malformed, or wrong-domain association configuration must still fail closed; include ownership only after all three exact-domain values validate.
- Production ownership for `miniapp.converge.cv` is configured as three Cloudflare Worker secrets and was verified by Farcaster's public debugger on 2026-07-15 for FID `8531` (`deanpierce.eth`). Keep those public proof values out of source control and preserve them across deployments.
- Treat Farcaster account-association signatures as opaque strings. Validate the base64url payload and exact canonical domain, but do not impose a signature alphabet beyond the current Farcaster schema.
- Do not assume push notifications require the same runtime as the web app; XMTP message observation and Farcaster notification delivery need a separate compatibility review.
- Do not commit secrets, generated credentials, local databases, dependency directories, build output, or temporary research artifacts.
