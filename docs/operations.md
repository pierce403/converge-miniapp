# Operations and publishing

This runbook covers the Cloudflare-hosted SPA and Worker API at `https://miniapp.converge.cv`. It does not claim that production XMTP sending is ready: an authenticated, quota-enforced payer Gateway and a funded production send remain release blockers.

## Runtime inventory

| Surface | Configuration | Purpose |
| --- | --- | --- |
| Worker + Static Assets | `wrangler.jsonc` | React bundle, publishing assets, Worker API, and SPA fallback. |
| Custom domain | `miniapp.converge.cv` | Durable Farcaster identity and browser-storage origin. |
| Version metadata | `CF_VERSION_METADATA` binding | Exposes deployment ID/tag/timestamp through `/api/health`. |
| Account association | Three Worker secrets listed below | Public Farcaster ownership proof, kept out of source control. |
| XMTP environment | `VITE_XMTP_ENV` at build time | `dev` for preview/local; production is the release target. |
| XMTP Gateway | `VITE_XMTP_GATEWAY_HOST` at build time | Public hostname only. Never put a credential in a `VITE_` variable. |

There is currently no D1, KV, R2, Queue, Durable Object, notification token store, or application authentication service.

## Current deployment state (2026-07-15)

The Cloudflare Worker and its `miniapp.converge.cv` Custom Domain are live. Cloudflare Workers Builds pulls and deploys verified `main` commits through the Cloudflare GitHub App; use `/api/health` and `wrangler deployments list` for the current immutable deployment ID instead of recording a value here that changes on every release.

Production delivery has one owner:

- GitHub Actions runs read-only CI and has no deployment credentials.
- A main-only Cloudflare Workers Builds trigger pulls the repository through the Cloudflare GitHub App.
- The Cloudflare build command is `npm run check`.
- The Cloudflare deploy command is `npx wrangler deploy`.
- Never put a Cloudflare API token, account ID, or other Cloudflare account credential in GitHub Actions secrets.

The hosted shell, first-party health endpoint, and signed ownership manifest are live, but the public Mini App release remains intentionally blocked:

- The three exact-domain Farcaster account-association values are configured as Worker runtime secrets. On 2026-07-15 Farcaster's public debugger reported `valid`, `schemaValid`, `verified`, `domainMatches`, and `signatureValid` as true for FID `8531` (`deanpierce.eth`). The manifest remains `noindex: true` until launch is deliberately approved.
- The authenticated, quota-enforced XMTP payer Gateway and its CSP origins remain unconfigured. Production messaging therefore continues to fail closed.
- Real Farcaster desktop, iOS, and Android wallet/WebView validation remains required before launch.

Run release commands locally only for an explicit operator task, using Node `22.13+` in the Node 22 line or Node `24+`. Node 23 is outside this repository's supported engine range even if a local build happens to pass. An XMTP-development preview on `workers.dev` still requires interactive Wrangler authentication, and preview storage, manifest ownership, and Quick Auth behavior are not evidence for the canonical production origin.

## Cloudflare delivery

Ordinary production delivery is a push to `main`; do not run a second manual deployment for the same commit. Cloudflare Workers Builds checks out the exact commit, runs the repository gate, and deploys only after that gate succeeds. Confirm the deployed commit in the Cloudflare build record and verify the root plus `/api/health` after each production change.

For an operator-owned preview, authenticate Wrangler interactively and run `npm run deploy:preview`. This builds with `CLOUDFLARE_ENV=preview` and XMTP `dev`. Preview `workers.dev` responses are marked `noindex`, and the preview manifest route always fails closed even if association values are accidentally configured there.

When the payer Gateway is ready, set `VITE_XMTP_GATEWAY_HOST` as a Cloudflare production build variable and add its exact HTTPS/WSS origins to `public/_headers` in the same reviewed commit. The value is browser-visible configuration, never a credential. Until then, the client deliberately refuses production/mainnet XMTP initialization.

## Farcaster account association

Generate the ownership object in Farcaster's Mini App Manifest Tool for the exact domain `miniapp.converge.cv`. Apex, `www`, and any preview hostname are different app identities.

Before ownership exists, the production endpoint deliberately returns `200` with schema-valid `miniapp` metadata, no `accountAssociation`, `noindex: true`, and `Cache-Control: no-store`. This lets Farcaster's Manifest Tool fetch the domain to bootstrap ownership without publishing an unsigned ownership claim or caching it across the association reverify step. If any association value is present but the set is incomplete, malformed, or signed for another domain, the endpoint returns `503 manifest_not_configured` instead of silently falling back to bootstrap metadata.

Configure the returned `header`, `payload`, and `signature` as Worker runtime secrets without committing them. These are Cloudflare runtime values, not GitHub Actions secrets:

```sh
npx wrangler secret put FARCASTER_ACCOUNT_ASSOCIATION_HEADER --config wrangler.jsonc
npx wrangler secret put FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD --config wrangler.jsonc
npx wrangler secret put FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE --config wrangler.jsonc
```

These values are a public signed ownership proof, not a signing key. The endpoint includes `accountAssociation` only after all three values are present, syntactically valid, and the payload names the exact canonical domain. The manifest remains `noindex: true` through prelaunch; enabling discovery requires a separate reviewed release change.

After configuring them, verify:

```sh
curl -fsS https://miniapp.converge.cv/.well-known/farcaster.json
curl -fsS https://miniapp.converge.cv/api/health
curl -fsSI https://miniapp.converge.cv/
curl -fsS 'https://api.farcaster.xyz/v1/dev-tools/debug-domain-manifest?domain=miniapp.converge.cv'
```

Require the debugger's manifest validation, schema validation, account-association verification, domain match, and signature validation to all pass. Then run the official Farcaster Manifest and Embed tools against the canonical root URL. Confirm the response includes the exact account association, icon, splash, feed card, exact-domain ownership, required wallet capability, and launch behavior.

## Security and observability

Static responses receive a CSP, one-year HSTS, `nosniff`, no-referrer, and a restrictive Permissions Policy from `public/_headers`. The CSP permits only same-origin scripts/workers plus the XMTP and Ephemera network families. When a production Gateway hostname is selected, add its exact HTTPS/WSS source before deployment rather than widening the policy generically.

Worker JSON responses add the applicable transport/browser headers directly because `_headers` does not apply to Worker-generated responses. Hashed Vite assets are immutable for one year; HTML uses Cloudflare's revalidation defaults.

Cloudflare Worker observability samples 10 percent of requests. Application code does not log wallet addresses, FIDs, signatures, message text, drafts, inbox IDs, conversation IDs, or tokens. `/api/health` returns only service, environment, app version, and Cloudflare version metadata.

## XMTP payer Gateway blocker

The pinned Browser SDK accepts a Gateway hostname but does not provide a proven browser-to-Gateway authentication mechanism in this project. Before public production messaging:

1. Prove client selection of the intended Gateway with the pinned SDK.
2. Prove authentication that cannot be copied from a public browser bundle.
3. Enforce per-user and global quotas, a kill switch, and payer-balance alerts.
4. Record one funded production send and its failure behavior.
5. Decide whether the Gateway runs in Cloudflare Containers or a replaceable external container host based on measured lifecycle and cost.

Until then, a production build without `VITE_XMTP_GATEWAY_HOST` fails closed and preview/local work stays on XMTP `dev`.

## Rollback

List recent versions and copy the known-good version ID:

```sh
npx wrangler deployments list --name converge-miniapp
```

Roll back with an operator-visible reason:

```sh
npx wrangler rollback VERSION_ID --name converge-miniapp --message "rollback: describe reason"
```

After rollback, recheck `/`, `/.well-known/farcaster.json`, `/api/health`, CSP headers, and the Farcaster launch. A hostname migration is not an ordinary rollback: changing the canonical domain also changes Farcaster ownership, discovery, browser OPFS, and future notification identity.
