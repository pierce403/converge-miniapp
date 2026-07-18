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
| XMTP-to-Farcaster alerts | `PREFERENCES`, `IDENTITY_RATE_LIMITER`, Farcaster secrets, and vapid.party app credentials | Stores encrypted native tokens plus one random opaque callback handle per verified FID. vapid.party observes registered XMTP topics and sends signed message-available callbacks; Mini owns native token custody and fixed alert copy. |
| ENS discovery | `ENS_MAINNET_RPC_URLS` Worker variable | Ordered comma-separated public HTTPS Ethereum RPC fallbacks for reverse and forward ENS verification. |
| ENS identity binding | Browser `localStorage`, namespaced by host-context FID | Remembers only a confirmed public ENS name, checksummed target/source addresses, expected target inbox ID, and Farcaster signer kind/chain. The FID is a non-authoritative namespace hint; every launch independently opens the exact source with Farcaster, requires the saved signer kind (and chain for a smart-contract wallet), and requires the expected inbox ID. WalletConnect is used and disconnected inside the one-time binding action; pairing URIs, topics, signatures, and keys are never stored in the binding record. No Worker binding or server row is involved. |
| Peer Farcaster hints | Optional `FARCASTER_BASE_RPC_URL` Worker secret | Production Base RPC used for a bounded read of the experimental address-to-FID Verifications contract. Without it, ENS/Basename still work and registered-fname hints stay off. |
| Identity abuse control | `IDENTITY_RATE_LIMITER` binding | Separately limits participant-identity batches, ENS recipient resolutions, and alert enrollment mutations per verified FID in each Cloudflare location. |
| Farcaster identity | Quick Auth JWKS + official primary-address API | Verifies the exact-domain FID and resolves its public primary Ethereum address. |
| XMTP environment | `VITE_XMTP_ENV` at build time | `dev` for preview/local; legacy `production` for the current canonical build; decentralized `mainnet` remains gated. |
| XMTP Gateway | `VITE_XMTP_GATEWAY_HOST` at build time | Required for `mainnet` and decentralized testnets. Public hostname only; never put a credential in a `VITE_` variable. |
| External ENS wallet | `VITE_WALLETCONNECT_PROJECT_ID` at build time | Public Reown/WalletConnect project ID for the optional one-time ENS binding action. Configure it as a Cloudflare Workers Builds variable and allowlist the exact production/preview origins in Reown; it is not a Worker runtime secret and is not used for routine inbox authentication. |
| Offline shell | Browser service worker + Cache Storage | Caches only the public shell and static same-origin assets. XMTP remains the sole local message store in OPFS; no binding or server resource is involved. |

The production `PREFERENCES` database is `converge-miniapp-preferences`; preview uses the separate `converge-miniapp-preview-preferences` database. Mini has no KV, R2, Queue, Durable Object, identity-link table, plaintext notification token store, or persistent application session store. Retryable XMTP observation and callback delivery run in vapid.party's separate queue-backed service.

## Current deployment state (2026-07-18)

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
- Alert promotion remains fail-closed until the current-Hub credential and the three vapid.party app values are configured. `GET /api/notifications/status` then remains `{"available":false}`, the manifest omits `webhookUrl`, and the UI must not prompt. Once configured, the signed lifecycle webhook, installation-proof enrollment proxy, signed opaque callback, fixed native delivery, invalid-token cleanup, and logical-route revocation form one complete path; canonical-host proof is still required.
- Real Farcaster desktop, iOS, and Android wallet/WebView validation remains required before launch.
- A dedicated public Reown project ID is configured as `VITE_WALLETCONNECT_PROJECT_ID` on the main-only production Workers Builds trigger. On 2026-07-17 an exact-origin browser relay probe from `https://miniapp.converge.cv` emitted a WalletConnect pairing URI and was stopped before wallet approval. Before release, confirm that the Reown dashboard allowlist contains the exact production origin and only separately tested preview origins, then complete the real-wallet tests below. Builds that omit the variable still fail closed with an explicit configuration state.

The ENS identity release adds protected API routes and D1 state, while the confirmed binding label is browser-local only; neither removes the payer-Gateway blocker. Treat the binding as deployed only after the verified `main` build is live and canonical-host discovery still works. Treat it as release-proven only after the exact Reown origin allowlist is confirmed and a production-like dev-network test proves exact-owner QR/same-phone authorization, Farcaster identity reassignment, fresh address-log/inbox-state verification, WalletConnect disconnection, and Farcaster-only re-entry. Sampled logs must contain no pairing URI or identity values.

Run release commands locally only for an explicit operator task, using Node `22.13+` in the Node 22 line or Node `24+`. Node 23 is outside this repository's supported engine range even if a local build happens to pass. An XMTP-development preview on `workers.dev` still requires interactive Wrangler authentication, and preview storage, manifest ownership, and Quick Auth behavior are not evidence for the canonical production origin.

## Cloudflare delivery

Ordinary production delivery is a push to `main`; do not run a second manual deployment for the same commit. Cloudflare Workers Builds checks out the exact commit, runs the repository gate, and deploys only after that gate succeeds. D1 migrations are operator-owned and are not run by Workers Builds: apply every backward-compatible production migration before pushing the Worker commit that depends on it. Confirm the deployed commit in the Cloudflare build record and verify the root plus `/api/health` after each production change.

For an operator-owned preview, authenticate Wrangler interactively and run `npm run deploy:preview`. This builds with `CLOUDFLARE_ENV=preview` and XMTP `dev`. Preview `workers.dev` responses are marked `noindex`, and the preview manifest route always fails closed even if association values are accidentally configured there.

When the payer Gateway is ready, set `VITE_XMTP_GATEWAY_HOST` as a Cloudflare production build variable, switch `VITE_XMTP_ENV` to `mainnet`, and add the Gateway's exact HTTPS/WSS origins to `public/_headers` in the same reviewed commit. The hostname is browser-visible configuration, never a credential. Until then, the canonical build stays on legacy XMTP `production`; any `mainnet` or decentralized-testnet build without a Gateway stops with a non-retryable configuration state before XMTP requests a signature.

For one-time external ENS authorization, create a Reown project for Converge Mini, allowlist `https://miniapp.converge.cv`, and add `VITE_WALLETCONNECT_PROJECT_ID` to the Cloudflare Workers Builds environment. This identifier is deliberately shipped in browser JavaScript and must not be stored as a Worker secret. Preview origins need their own allowlist entries. A missing ID blocks only a new binding action; normal startup of an already-bound inbox uses the Farcaster wallet and never restores WalletConnect.

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

The additive notification migrations create the encrypted native-token table, one random opaque callback handle per verified FID, and bounded callback replay/lease state. They store no XMTP inbox or installation ID, topic, HMAC key, name, address, plaintext token, or message data. The binding and database names are committed configuration; there are no D1 credentials to copy into GitHub Actions.

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
| `GET /api/notifications/status` | `200 {"available":true}` only when every native and vapid.party dependency is configured; otherwise `false` | Never returns token, FID, route, or app-secret state. |
| `POST /api/me/notifications/xmtp-ticket` | Returns the exact vapid.party ticket and a server-completed registration after a native token exists | Quick Auth and per-FID rate limit; `425` while the signed Farcaster webhook token is pending; `400/413` invalid bounded topic snapshot; `503` configuration/upstream failure. |
| `POST /api/me/notifications/xmtp-subscription` | Verifies the owned opaque handle, forwards the installation proof, and returns only `{"registered":true}` | Never exposes vapid.party's management receipt or app secret; auth/rate/config/upstream failures are fail-closed. |
| `DELETE /api/me/notifications/xmtp-subscription` | App-secret revokes every vapid.party logical callback route for the verified FID's opaque handle, then deletes that handle | Idempotent when no handle exists; local deletion occurs only after a valid upstream success envelope. |
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

## XMTP-to-Farcaster alert bridge

`POST /api/farcaster/webhook` accepts only bounded JSON on the exact canonical host. The pinned official Mini App server package verifies the Farcaster Signature and asks the configured Hub for the latest app-key state; Quick Auth and browser context are not substitutes. A verified add/enable event encrypts its URL and token with AES-256-GCM and fresh nonce, binding the ciphertext to the verified user FID, client app FID, canonical domain, and key version. A verified add without details, disable, or removal deletes the exact client row. After the last client row disappears, Mini first marks the FID's opaque XMTP callback handle `revoking`, revokes it through vapid.party's app-secret endpoint, and only then deletes the local handle. An upstream failure returns retryable `503` and retains the tombstone so a concurrent callback is terminal and Farcaster can retry cleanup safely.

After XMTP is ready, the browser sends its bounded topic/HMAC snapshot through two Quick Auth routes. Mini forces the exact callback URL, generic/minimal-payload preferences, and its own random FID-scoped `inboxHandle`; keeps the vapid.party app secret server-side; and forwards the installation-key proof. vapid.party atomically keeps one active installation for `(appId, inboxHandle)`. The Mini D1 never stores the XMTP inbox ID, installation ID, topics, HMAC keys, proof, ticket, or management receipt.

vapid.party callbacks contain only a signed delivery ID and opaque handle. Mini pins the app ID and P-256 public key, verifies the exact raw body plus timestamp and delivery ID, rejects stale/replayed events, decrypts current native tokens, groups at most 100 tokens per exact allowlisted URL, and sends fixed copy to the canonical root. It deletes invalid tokens, returns retryable status for rate limits/outages, and uses the stable delivery ID as Farcaster's notification ID. A missing handle or a handle with no native token returns terminal `410`; vapid.party then removes that logical route without affecting other apps or handles.

The committed public configuration is limited to the reviewed Hub base URL and exact notification delivery URL allowlist. The closed-app bridge is deliberately production-only because its callback, Quick Auth audience, notification target, and manifest identity are bound to `miniapp.converge.cv`. Configure these production credentials without committing them:

```sh
npx wrangler secret put FARCASTER_HUB_API_KEY
npx wrangler secret put FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1
npx wrangler secret put VAPID_PARTY_APP_ID
npx wrangler secret put VAPID_PARTY_APP_SECRET
npx wrangler secret put VAPID_PARTY_PUBLIC_KEY
```

`FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1` is exactly 32 random bytes encoded as unpadded base64url. `VAPID_PARTY_APP_ID` and its 65-byte uncompressed P-256 `VAPID_PARTY_PUBLIC_KEY` are public identifiers but remain dashboard-managed because they are created during app registration; `VAPID_PARTY_APP_SECRET` is secret. Enter all values only through Wrangler's prompt. Do not place secret values in shell history, source control, GitHub Actions, build variables, tickets, or logs. List only their names with `npx wrangler secret list`; never print their values. Preview can still exercise bounded webhook fixtures with separate Hub/encryption secrets, but `/api/notifications/status` intentionally remains unavailable there and preview is not closed-app delivery proof.

The manifest includes the exact `https://miniapp.converge.cv/api/farcaster/webhook` URL only when every dependency above is present. Before promotion, prove signed add, rotation, disable/removal, token-pending `425`, installation replacement, signed callback replay, invalid-token deletion, upstream throttling, and app-side route revocation. Review D1 only for ciphertext, opaque handles, and delivery IDs, and inspect sampled logs for token, URL, FID, signature, topic, HMAC, inbox, or installation leakage.

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
