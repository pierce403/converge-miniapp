# Converge Mini

A deliberately small XMTP inbox built as a Farcaster Mini App and hosted on Cloudflare Workers. The canonical production origin is `https://miniapp.converge.cv`.

The product and delivery contract lives in [`features.md`](./features.md).

## Local development

Requirements: Node.js 22.13 or a supported newer even-numbered release, plus npm.

```sh
npm install
npm run cf-typegen
npm run assets
npm run dev
```

The Cloudflare Vite plugin runs both the React app and Worker API. Service health is available at `/api/health`.

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

```sh
npm run deploy:preview
npm run deploy
```

The production command is configured for `miniapp.converge.cv`. Cloudflare account access, DNS ownership, and the final Farcaster account-association signature are external setup requirements; no credentials belong in this repository.
