# Operations and publishing

This runbook covers the Cloudflare-hosted SPA and Worker API at `https://miniapp.converge.cv`. The canonical build currently uses the pinned SDK's legacy XMTP `production` environment so real inbox and signature testing can proceed. A move to decentralized `mainnet` still requires an authenticated, quota-enforced payer Gateway and a funded send before public launch.

## Runtime inventory

| Surface | Configuration | Purpose |
| --- | --- | --- |
| Worker + Static Assets | `wrangler.jsonc` | React bundle, publishing assets, Worker API, and SPA fallback. |
| Custom domain | `miniapp.converge.cv` | Durable Farcaster identity and browser-storage origin. |
| Version metadata | `CF_VERSION_METADATA` binding | Exposes deployment ID/tag/timestamp through `/api/health`. |
| Account association | Three Worker secrets listed below | Public Farcaster ownership proof, kept out of source control. |
| ENS preferences | `PREFERENCES` D1 binding | Stores only Quick Auth-verified FID, `accepted`/`dismissed`, and update time. Production and preview databases are isolated. |
| Farcaster notification lifecycle | `PREFERENCES` D1 binding plus two Worker secrets | Stores only verified `(fid, app_fid)` lifecycle rows with the delivery URL and token encrypted together. The Hub credential verifies current app-key state; the AES key protects stored details. The manifest and UI remain off until both are configured and proven. |
| ENS discovery | `ENS_MAINNET_RPC_URLS` Worker variable | Ordered comma-separated public HTTPS Ethereum RPC fallbacks for reverse and forward ENS verification. |
| ENS inbox selection | Browser `localStorage`, namespaced by host-context FID | Remembers only a freshly verified public ENS name, checksummed target address, expected existing inbox ID, and checksummed source address. The FID is a non-authoritative namespace hint; every launch must match the provider's preferred account to the saved source and select the exact target from the same fresh provider/account snapshot, then require the expected inbox ID. No Worker binding or server row is involved. |
| Peer Farcaster hints | Optional `FARCASTER_BASE_RPC_URL` Worker secret | Production Base RPC used for a bounded read of the experimental address-to-FID Verifications contract. Without it, ENS/Basename still work and registered-fname hints stay off. |
| Identity abuse control | `IDENTITY_RATE_LIMITER` binding | Separately limits participant-identity batches and ENS recipient resolutions per verified FID in each Cloudflare location. |
| Farcaster identity | Quick Auth JWKS + official primary-address API | Verifies the exact-domain FID and resolves its public primary Ethereum address. |
| XMTP environment | `VITE_XMTP_ENV` at build time | `dev` for preview/local; legacy `production` for the current canonical build; decentralized `mainnet` remains gated. |
| XMTP Gateway | `VITE_XMTP_GATEWAY_HOST` at build time | Required for `mainnet` and decentralized testnets. Public hostname only; never put a credential in a `VITE_` variable. |
| Offline shell | Browser service worker + Cache Storage | Caches only the public shell and static same-origin assets. XMTP remains the sole local message store in OPFS; no binding or server resource is involved. |

The production `PREFERENCES` database is `converge-miniapp-preferences`; preview uses the separate `converge-miniapp-preview-preferences` database. There is no KV, R2, Queue, Durable Object, identity-link table, plaintext notification token store, or persistent application session store.

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
- The authenticated, quota-enforced XMTP payer Gateway and its CSP origins remain unconfigured. That blocks a switch to decentralized `mainnet`, but does not block the pinned SDK's legacy `production` endpoint.
- Farcaster notification enrollment remains unadvertised. The deployed Worker has no current-Hub API credential, so `/api/farcaster/webhook` must fail closed, the manifest must omit `webhookUrl`, and the UI must not ask users to enable alerts. The encrypted lifecycle foundation does not by itself observe incoming XMTP messages while the browser is closed.
- Real Farcaster desktop, iOS, and Android wallet/WebView validation remains required before launch.

The ENS identity release adds protected API routes and D1 state, while the explicit existing-inbox session selector is browser-local only; neither removes the payer-Gateway blocker. Treat the switch as deployed only after the verified `main` build is live, canonical-host discovery still works, an exact-address provider test proves both the success and signer-missing paths, and sampled logs contain no identity values.

Run release commands locally only for an explicit operator task, using Node `22.13+` in the Node 22 line or Node `24+`. Node 23 is outside this repository's supported engine range even if a local build happens to pass. An XMTP-development preview on `workers.dev` still requires interactive Wrangler authentication, and preview storage, manifest ownership, and Quick Auth behavior are not evidence for the canonical production origin.

## Cloudflare delivery

Ordinary production delivery is a push to `main`; do not run a second manual deployment for the same commit. Cloudflare Workers Builds checks out the exact commit, runs the repository gate, and deploys only after that gate succeeds. D1 migrations are operator-owned and are not run by Workers Builds: apply every backward-compatible production migration before pushing the Worker commit that depends on it. Confirm the deployed commit in the Cloudflare build record and verify the root plus `/api/health` after each production change.

For an operator-owned preview, authenticate Wrangler interactively and run `npm run deploy:preview`. This builds with `CLOUDFLARE_ENV=preview` and XMTP `dev`. Preview `workers.dev` responses are marked `noindex`, and the preview manifest route always fails closed even if association values are accidentally configured there.

When the payer Gateway is ready, set `VITE_XMTP_GATEWAY_HOST` as a Cloudflare production build variable, switch `VITE_XMTP_ENV` to `mainnet`, and add the Gateway's exact HTTPS/WSS origins to `public/_headers` in the same reviewed commit. The hostname is browser-visible configuration, never a credential. Until then, the canonical build stays on legacy XMTP `production`; any `mainnet` or decentralized-testnet build without a Gateway stops with a non-retryable configuration state before XMTP requests a signature.

### Static offline shell

`public/service-worker.js` installs after the initial page load and precaches `/` plus the same-origin static assets referenced by that shell. Navigations are network-first with `/` as the offline fallback; fingerprinted assets are cache-first. The worker ignores non-GET and cross-origin requests and never intercepts `/api/*` or `/.well-known/*`. Do not broaden that allowlist to XMTP, Quick Auth, notification, or personalized application responses.

This cache only makes the public interface loadable after one online visit. The pinned Browser SDK still performs an inbox/network lookup while constructing an XMTP client, so a cold offline browser launch is not a supported message-recovery guarantee. Once an XMTP session is already open, the app can read its OPFS inbox and messages without waiting for sync while `navigator.onLine` is false.

Each complete shell generation is named from its validated Vite entry asset. A metadata cache points to only the current and previous complete generations; a new root is promoted only after every referenced fingerprinted asset has the expected MIME type and has reached Cache Storage. A deploy or rollback therefore retains one known-good fallback while removing older generations so static assets cannot grow without bound in the same origin quota used by XMTP OPFS. Warm-up messages must include the validated entry path and can write only to one of those two retained generations. Change the worker's metadata version only when this pointer schema changes.

Cloudflare currently answers an unknown `/assets/*.js` URL with the SPA's `200 text/html` fallback while also applying the `/assets/*` one-year immutable cache header. The worker deliberately forces `cache: reload` for an asset cache miss and MIME-validates the response before writing it. Removing either safeguard can pin an HTML fallback in the browser HTTP cache and break a later rollback or an old tab's lazy chunk.

A normal online deployment or rollback serves a fresh network-first shell and its matching fingerprinted assets. After either action, verify one online load, wait for `navigator.serviceWorker.ready`, confirm Cache Storage retains no more than two `converge-miniapp-static-shell-*` generations, switch the browser offline, reload `/`, and confirm only the public shell appears. Clearing site data removes both these static caches and the separate XMTP OPFS database.

## D1 data and protected APIs

The repository migration `migrations/0001_ens_identity_preferences.sql` creates one table:

```sql
CREATE TABLE ens_identity_preferences (
  fid INTEGER PRIMARY KEY CHECK (fid > 0),
  choice TEXT NOT NULL CHECK (choice IN ('accepted', 'dismissed')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

The additive notification migration creates a separate table keyed by the signed webhook's verified user and client FIDs. Its delivery URL and token are encrypted together; no name, address, XMTP identifier, plaintext token, or message data belongs in this database. The binding and database names are committed configuration; there are no D1 credentials to copy into GitHub Actions.

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
| `POST /api/resolve` | `200` with `status: resolved` plus the normalized name/checksummed address, or `status: none` with no candidate | `400` malformed, oversized, dotless, or invalid ENS input; `401` invalid/missing token; `404` wrong production host; `405` wrong method; `429` verified-FID rate limit; `503` resolver configuration, provider, binding, or deadline failure. |
| `POST /api/identities` | `200` with stateless registered-fname, ENS, and Basename display metadata plus a partial-result flag for up to 12 valid Ethereum addresses | `400` malformed/oversized JSON; `401` invalid/missing token; `404` wrong production host; `429` verified-FID rate limit; `503` total resolver outage/deadline or missing required configuration. |
| `PUT /api/me/ens-preference` | `204` for JSON `{"choice":"accepted"}` or `{"choice":"dismissed"}` | `400` malformed/unsupported body; auth/binding failures as above. |
| `DELETE /api/me` | `204` after deleting the verified FID's preference and every notification row for that FID | Auth/binding failures as above. |

Quick Auth verification checks Farcaster's issuer, signature, expiry, exact audience, and a positive integer FID subject. Production accepts only the canonical domain; non-production verifies the actual rendered host so localhost and a separately deployed preview can be exercised without weakening production. The Worker ignores any client-supplied FID. It then fetches the official Farcaster primary Ethereum address and requires mainnet ENS reverse and forward resolution to agree. `ENS_MAINNET_RPC_URLS` is public replaceable configuration, not a secret; keep multiple reviewed HTTPS providers so one RPC failure can fail over, and treat total lookup failure as a nonblocking identity-feature outage.

The participant route stream-limits its JSON body to 16 KiB, checksum-normalizes and deduplicates addresses, bounds each request at 12, and rate-limits the verified FID. Ethereum mainnet's Universal Resolver supplies default ENS and ENSIP-19 Basename primary names. When configured, `FARCASTER_BASE_RPC_URL` supplies a batched read of the experimental Verifications contract; positive FIDs become explicitly secondary registered-fname hints through the official FName Registry. The browser sends larger inboxes as separate bounded batches, keeps positive metadata for at most ten minutes and complete negative results for two minutes, and retries partial outages after one minute. Partial resolver success remains usable; a total outage or ten-second route deadline returns `503` so absence is not cached as fact. Neither the Worker nor D1 persists this metadata.

The recipient route accepts only a 2 KiB JSON `POST` body containing one `query` string, trims and ENSIP-15-normalizes a dot-separated name, and rejects names longer than 255 UTF-8 bytes. It forward-resolves the default Ethereum address on mainnet through up to three configured HTTPS RPC fallbacks and the ENS CCIP gateway, checksums a positive address, and has a ten-second endpoint deadline. A valid name with no address is a successful `none` result; provider and timeout failures are `503`, never negative evidence. The verified-FID rate-limit namespace is separate from participant-label batches. The raw query stays out of URLs, D1, application logs, and analytics.

Use a reviewed, quota-enforced production Base endpoint; do not commit its keyed URL or use Base's rate-limited public endpoint for production. Configure it independently for preview and production:

```sh
npx wrangler secret put FARCASTER_BASE_RPC_URL --env preview
npx wrangler secret put FARCASTER_BASE_RPC_URL
```

The `IDENTITY_RATE_LIMITER` binding is committed configuration. Its namespace is unique to this Worker in the Cloudflare account, and its counters are permissive, eventually consistent, and local to each Cloudflare location; it is an upstream-cost guard, not an accounting or authorization boundary.

Preview has its own D1 binding and verifies Quick Auth against the exact host serving the request. A successful `workers.dev` check proves preview wiring only; it is not evidence for the canonical production audience, storage origin, or Farcaster ownership.

For production acceptance, first verify an unauthenticated request is rejected:

```sh
curl -i https://miniapp.converge.cv/api/me/ens
```

Then, inside the canonical Farcaster Mini App, verify a valid account reaches one of the explicit `available`, `none`, or `unavailable` discovery states; save both choices idempotently; confirm a dismissal does not auto-prompt on re-entry; confirm the menu can opt in later; and verify **Delete saved ENS choice** removes the row and restores the unset offer state. Review sampled logs and confirm no JWT, FID, address, ENS name, preference, or XMTP identifier is emitted.

## Farcaster notification lifecycle foundation

`POST /api/farcaster/webhook` is deliberately an unadvertised server foundation until production verification is ready. It accepts only bounded JSON on the exact canonical host. The pinned official Mini App server package verifies the Farcaster Signature and asks the configured Hub for the latest app-key state; Quick Auth and browser context are not substitutes. A verified add/enable event encrypts its URL and token with AES-256-GCM and fresh nonce, binding the ciphertext to the verified user FID, client app FID, canonical domain, and key version. A verified add without details, disable, or removal deletes the exact client row.

The committed public configuration is limited to the reviewed Hub base URL and exact notification delivery URL allowlist. Configure credentials independently for preview and production without committing them:

```sh
npx wrangler secret put FARCASTER_HUB_API_KEY --env preview
npx wrangler secret put FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1 --env preview
npx wrangler secret put FARCASTER_HUB_API_KEY
npx wrangler secret put FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1
```

`FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1` is exactly 32 random bytes encoded as unpadded base64url. Generate it in a trusted operator environment and enter it only through Wrangler's secret prompt; do not place its value in shell history, source control, GitHub Actions, build variables, tickets, or logs. The Hub key is also a Worker runtime secret. List only their names with `npx wrangler secret list`; never print their values.

Before promotion, prove signed add, rotation, disable, removal, invalid app-key, verifier-outage, and URL-rejection fixtures in preview. Review D1 only for ciphertext metadata, and inspect sampled logs for token, URL, FID, or signature leakage. Then add the exact `https://miniapp.converge.cv/api/farcaster/webhook` URL to the manifest and ship the explicit user-action enrollment UI in one reviewed task. Until that promotion, a `503 notification_unavailable` response is intentional and must not be bypassed.

This lifecycle endpoint does not send alerts and does not make the Worker an XMTP observer. Closed-app incoming-message alerts require a separate persistent listener that registers every allowed XMTP topic and HMAC epoch, filters own and `shouldPush: false` traffic, survives rotation/restart, and sends only a generic opaque wake event into a delivery queue. Do not claim that feature from token storage alone.

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

Cloudflare Worker observability samples 10 percent of requests. Application code does not log raw ENS recipient queries, wallet addresses, FIDs, signatures, message text, drafts, inbox IDs, conversation IDs, or tokens. `/api/health` returns only service, environment, app version, and Cloudflare version metadata.

## XMTP payer Gateway blocker

The pinned Browser SDK provides built-in endpoints for `local`, `dev`, and legacy `production`. Its `mainnet`, `testnet`, `testnet-dev`, and `testnet-staging` environments require a Gateway hostname. This distinction is regression-tested because incorrectly gating legacy `production` prevents `Client.create()` from running and therefore prevents every XMTP signing request.

The SDK accepts a Gateway hostname, but this project does not yet have a proven browser-to-Gateway authentication mechanism. Before moving the public app to decentralized `mainnet`:

1. Prove client selection of the intended Gateway with the pinned SDK.
2. Prove authentication that cannot be copied from a public browser bundle.
3. Enforce per-user and global quotas, a kill switch, and payer-balance alerts.
4. Record one funded production send and its failure behavior.
5. Decide whether the Gateway runs in Cloudflare Containers or a replaceable external container host based on measured lifecycle and cost.

Until then, the canonical build stays on legacy XMTP `production`, preview/local work stays on XMTP `dev`, and decentralized environments fail with an operator-actionable configuration state when no Gateway is present.

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
