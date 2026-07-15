# Converge Mini

A deliberately small XMTP inbox built as a Farcaster Mini App and hosted on Cloudflare Workers. The canonical production origin is `https://miniapp.converge.cv`.

The product and delivery contract lives in [`features.md`](./features.md).
Deployment, ownership, rollback, and the production Gateway blocker are in [`docs/operations.md`](./docs/operations.md). The concrete data inventory is in [`docs/privacy.md`](./docs/privacy.md).

## Local development

Requirements: Node.js 22.13 or a supported newer even-numbered release, plus npm.

```sh
npm install
cp .env.example .env.development.local
npm run cf-typegen
npm run assets
npm run dev
```

The Cloudflare Vite plugin runs both the React app and Worker API. Service health is available at `/api/health`.

Local development uses XMTP `dev`. Production/mainnet messaging deliberately fails closed unless `VITE_XMTP_GATEWAY_HOST` is provided at build time. That browser-visible value must be only a hostname, never a credential; the authenticated payer-Gateway path remains a documented release blocker in [`features.md`](./features.md).

The implemented messaging path uses only the Farcaster host wallet—EOA or supported smart contract wallet—as its XMTP signer. It does not generate a fallback key. The browser keeps the XMTP database in OPFS behind one origin-wide Web Lock, shows only allowed DMs, checks address reachability, streams new text, and persists optimistic drafts for same-ID retry where Browser SDK 7 permits it. A true XMTP `Failed` record is terminal in this SDK and is labeled honestly rather than being fake-retried.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Run the deterministic type/lint/unit/build gates with `npm run check`. The browser smoke test uses the installed Chrome release and runs separately with `npm run test:e2e`.

## Deployment

The production Worker and `miniapp.converge.cv` Custom Domain are live. Pushes to `main` are the ordinary production delivery path: a main-only Cloudflare Workers Builds trigger pulls through the Cloudflare GitHub App, runs `npm run check`, and then runs `npx wrangler deploy`. GitHub Actions remains read-only CI; do not store Cloudflare API tokens or account credentials in GitHub secrets. The `npm run deploy` and `npm run deploy:preview` scripts are reserved for explicit operator-owned manual work.

The production payer Gateway and final Farcaster account-association values remain unconfigured. Until account association is configured, `/.well-known/farcaster.json` fails closed with a `503` instead of publishing placeholders; until the Gateway is configured, production XMTP messaging fails closed.
