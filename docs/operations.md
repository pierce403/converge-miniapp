# Operations and publishing

This runbook covers the Cloudflare-hosted SPA and Worker API at `https://miniapp.converge.cv`. It does not claim that production XMTP sending is ready: an authenticated, quota-enforced payer Gateway and a funded production send remain release blockers.

## Runtime inventory

| Surface | Configuration | Purpose |
| --- | --- | --- |
| Worker + Static Assets | `wrangler.jsonc` | React bundle, publishing assets, Worker API, and SPA fallback. |
| Custom domain | `miniapp.converge.cv` | Durable Farcaster identity and browser-storage origin. |
| Version metadata | `CF_VERSION_METADATA` binding | Exposes deployment ID/tag/timestamp through `/api/health`. |
| Account association | Three Worker secrets listed below | Public Farcaster ownership proof, kept out of source control. |
| ENS preferences | `PREFERENCES` D1 binding | Stores only Quick Auth-verified FID, `accepted`/`dismissed`, and update time. Production and preview databases are isolated. |
| ENS discovery | `ENS_MAINNET_RPC_URLS` Worker variable | Ordered comma-separated public HTTPS Ethereum RPC fallbacks for reverse and forward ENS verification. |
| Farcaster identity | Quick Auth JWKS + official primary-address API | Verifies the exact-domain FID and resolves its public primary Ethereum address. |
| XMTP environment | `VITE_XMTP_ENV` at build time | `dev` for preview/local; production is the release target. |
| XMTP Gateway | `VITE_XMTP_GATEWAY_HOST` at build time | Public hostname only. Never put a credential in a `VITE_` variable. |

The production `PREFERENCES` database is `converge-miniapp-preferences`; preview uses the separate `converge-miniapp-preview-preferences` database. There is no KV, R2, Queue, Durable Object, identity-link table, notification token store, or persistent application session store.

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

The ENS identity release adds protected API routes and D1 state, but does not remove the payer-Gateway blocker. Treat it as deployed only after the repository migration is applied, the verified `main` build is live, an authenticated canonical-host lookup succeeds, and accepted/dismissed/delete behavior is confirmed without logging identity data.

Run release commands locally only for an explicit operator task, using Node `22.13+` in the Node 22 line or Node `24+`. Node 23 is outside this repository's supported engine range even if a local build happens to pass. An XMTP-development preview on `workers.dev` still requires interactive Wrangler authentication, and preview storage, manifest ownership, and Quick Auth behavior are not evidence for the canonical production origin.

## Cloudflare delivery

Ordinary production delivery is a push to `main`; do not run a second manual deployment for the same commit. Cloudflare Workers Builds checks out the exact commit, runs the repository gate, and deploys only after that gate succeeds. D1 migrations are operator-owned and are not run by Workers Builds: apply every backward-compatible production migration before pushing the Worker commit that depends on it. Confirm the deployed commit in the Cloudflare build record and verify the root plus `/api/health` after each production change.

For an operator-owned preview, authenticate Wrangler interactively and run `npm run deploy:preview`. This builds with `CLOUDFLARE_ENV=preview` and XMTP `dev`. Preview `workers.dev` responses are marked `noindex`, and the preview manifest route always fails closed even if association values are accidentally configured there.

When the payer Gateway is ready, set `VITE_XMTP_GATEWAY_HOST` as a Cloudflare production build variable and add its exact HTTPS/WSS origins to `public/_headers` in the same reviewed commit. The value is browser-visible configuration, never a credential. Until then, the client deliberately refuses production/mainnet XMTP initialization.

## ENS preference database and protected API

The repository migration `migrations/0001_ens_identity_preferences.sql` creates one table:

```sql
CREATE TABLE ens_identity_preferences (
  fid INTEGER PRIMARY KEY CHECK (fid > 0),
  choice TEXT NOT NULL CHECK (choice IN ('accepted', 'dismissed')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

No name, address, XMTP identifier, token, or message data belongs in this database. The binding and database names are committed configuration; there are no D1 credentials to copy into GitHub Actions.

After changing `wrangler.jsonc`, regenerate and review Worker bindings:

```sh
npm run cf-typegen
```

Exercise the migration against local state, run the complete repository gate, then apply remote preview and production migrations separately:

```sh
npx wrangler d1 migrations apply PREFERENCES --local
npm run check
npx wrangler d1 migrations apply PREFERENCES --env preview --remote
npx wrangler d1 migrations apply PREFERENCES --remote
```

Wrangler displays the migration plan and captures a backup before a remote apply. Stop if preview apply, production apply, or `npm run check` fails. Apply production before pushing `main` because the automatic Worker deploy can begin immediately after the push.

Confirm that each remote database has no unapplied migrations:

```sh
npx wrangler d1 migrations list PREFERENCES --env preview --remote
npx wrangler d1 migrations list PREFERENCES --remote
```

The protected routes are exact-host and no-store:

| Route | Success | Failure boundary |
| --- | --- | --- |
| `GET /api/me/ens` | `200` with `ens`, `preference`, and explicit `available`, `none`, or `unavailable` status | `401` invalid/missing token; `404` wrong host; `503` missing binding or unexpected backend failure. |
| `PUT /api/me/ens-preference` | `204` for JSON `{"choice":"accepted"}` or `{"choice":"dismissed"}` | `400` malformed/unsupported body; auth/binding failures as above. |
| `DELETE /api/me` | `204` after deleting the verified FID's preference | Auth/binding failures as above. |

Quick Auth verification checks Farcaster's issuer, signature, expiry, exact audience, and a positive integer FID subject. Production accepts only the canonical domain; non-production verifies the actual rendered host so localhost and a separately deployed preview can be exercised without weakening production. The Worker ignores any client-supplied FID. It then fetches the official Farcaster primary Ethereum address and requires mainnet ENS reverse and forward resolution to agree. `ENS_MAINNET_RPC_URLS` is public replaceable configuration, not a secret; keep multiple reviewed HTTPS providers so one RPC failure can fail over, and treat total lookup failure as a nonblocking identity-feature outage.

Preview has its own D1 binding and verifies Quick Auth against the exact host serving the request. A successful `workers.dev` check proves preview wiring only; it is not evidence for the canonical production audience, storage origin, or Farcaster ownership.

For production acceptance, first verify an unauthenticated request is rejected:

```sh
curl -i https://miniapp.converge.cv/api/me/ens
```

Then, inside the canonical Farcaster Mini App, verify a valid account reaches one of the explicit `available`, `none`, or `unavailable` discovery states; save both choices idempotently; confirm a dismissal does not auto-prompt on re-entry; confirm the menu can opt in later; and verify **Delete saved ENS choice** removes the row and restores the unset offer state. Review sampled logs and confirm no JWT, FID, address, ENS name, preference, or XMTP identifier is emitted.

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

Static responses receive a CSP, one-year HSTS, `nosniff`, no-referrer, and a restrictive Permissions Policy from `public/_headers`. The CSP permits only same-origin scripts/workers, the exact Farcaster Quick Auth origin, and the XMTP and Ephemera network families. When a production Gateway hostname is selected, add its exact HTTPS/WSS source before deployment rather than widening the policy generically.

Worker JSON responses add the applicable transport/browser headers directly because `_headers` does not apply to Worker-generated responses. Identity responses are `Cache-Control: no-store`; protected routes accept only their documented methods and fail closed on the wrong host, missing/invalid Quick Auth, and absent bindings. Resolver/directory failure returns no candidate with an explicit unavailable state. Hashed Vite assets are immutable for one year; HTML uses Cloudflare's revalidation defaults.

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

Worker rollback does not reverse D1 migrations or restore deleted preference rows. The first migration is additive and safe to leave in place if the Worker is rolled back; do not drop the table as part of an application rollback. For future schema changes, prove backward compatibility with both the outgoing and rollback Worker before applying production migrations.

After rollback, recheck `/`, `/.well-known/farcaster.json`, `/api/health`, protected-route fail-closed behavior, CSP headers, and the Farcaster launch. A hostname migration is not an ordinary rollback: changing the canonical domain also changes Farcaster ownership, Quick Auth audience, discovery, browser OPFS, and future notification identity.
