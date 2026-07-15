# Converge Mini

A deliberately small XMTP inbox built as a Farcaster Mini App and hosted on Cloudflare Workers. The canonical production origin is `https://miniapp.converge.cv`.

The product and delivery contract lives in [`features.md`](./features.md).

## Local development

Requirements: Node.js 22.11 or newer and npm.

```sh
npm install
npm run cf-typegen
npm run dev
```

The Cloudflare Vite plugin runs both the React app and Worker API. Service health is available at `/api/health`.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Run all gates with `npm run check`.

## Deployment

```sh
npm run deploy:preview
npm run deploy
```

The production command is configured for `miniapp.converge.cv`. Cloudflare account access, DNS ownership, and the final Farcaster account-association signature are external setup requirements; no credentials belong in this repository.
