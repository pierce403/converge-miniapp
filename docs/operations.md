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

## Initial Cloudflare setup

1. Authenticate Wrangler against the intended Cloudflare account and confirm that account owns the `converge.cv` zone.
2. Run `npm ci`, `npm run cf-typegen`, and `npm run check`.
3. Deploy the preview Worker with `npm run deploy:preview`. This builds with `CLOUDFLARE_ENV=preview` and XMTP `dev`.
4. Verify the preview root and `/api/health`. Preview `workers.dev` responses are marked `noindex`, and the preview manifest route always fails closed even if association values are accidentally configured there.
5. Do not promote messaging as production-ready until the Gateway section below is resolved.

The production deploy is:

```sh
VITE_XMTP_GATEWAY_HOST=gateway.example.com npm run deploy
```

The Gateway hostname is browser-visible configuration. The current client deliberately refuses production/mainnet XMTP initialization if it is absent.

## Farcaster account association

Generate the ownership object in Farcaster's Mini App Manifest Tool for the exact domain `miniapp.converge.cv`. Apex, `www`, and any preview hostname are different app identities.

Configure the returned `header`, `payload`, and `signature` without committing them:

```sh
npx wrangler secret put FARCASTER_ACCOUNT_ASSOCIATION_HEADER --config wrangler.jsonc
npx wrangler secret put FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD --config wrangler.jsonc
npx wrangler secret put FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE --config wrangler.jsonc
```

These values are a public signed ownership proof, not a signing key. The endpoint intentionally returns `503 manifest_not_configured` until all three values are present and syntactically valid. It never serves an apparently valid manifest with placeholder ownership.

After configuring them, verify:

```sh
curl -fsS https://miniapp.converge.cv/.well-known/farcaster.json
curl -fsS https://miniapp.converge.cv/api/health
curl -fsSI https://miniapp.converge.cv/
```

Then run the official Farcaster Manifest and Embed tools against the canonical root URL. Confirm the icon, splash, feed card, exact-domain ownership, required wallet capability, and launch behavior.

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
