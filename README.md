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

Local development uses XMTP `dev`, and the canonical build currently uses the pinned SDK's legacy `production` endpoint. Decentralized `mainnet` and testnet builds deliberately fail closed unless `VITE_XMTP_GATEWAY_HOST` is provided at build time. That browser-visible value must be only a hostname, never a credential; the authenticated payer-Gateway path remains a documented mainnet release blocker in [`features.md`](./features.md).

The messaging path always uses the Farcaster host wallet—EOA or supported smart contract wallet—as its routine XMTP signer. A user can explicitly bind that Farcaster identity to an existing, separately resolved ENS inbox: the exact ENS owner connects through WalletConnect once to authorize the target installation, then the Farcaster wallet signs an XMTP identity reassignment. The inboxes do not merge and the Farcaster identity loses normal access to its old inbox. After one intentional reload, future launches open the verified target inbox with only the Farcaster signer; the external wallet is not restored for normal authentication. `VITE_WALLETCONNECT_PROJECT_ID` is required only for that binding action and its Reown project must allowlist the rendered origin. The app never generates a fallback key. The browser keeps the XMTP database in OPFS behind one origin-wide Web Lock, shows only allowed DMs, checks address reachability, streams displayable messages, and persists optimistic drafts for same-ID retry where Browser SDK 7 permits it. Text and Markdown source (safely as plain text), replies, attachment metadata, and safe transaction/action labels render; reactions stay on their parent message; read receipts and silent control payloads do not become fake chat bubbles. A true XMTP `Failed` record is terminal in this SDK and is labeled honestly rather than being fake-retried.

Peer wallet labels upgrade asynchronously from a shortened address to ENS or Basename through a bounded, Quick Auth-protected first-party lookup. A registered fname can appear separately as a best-effort registry hint, never as the authoritative participant label, and the wallet address remains visible. The pinned XMTP Browser SDK has no finalized typing-notification API, so silent typing-style control messages are ignored instead of rendered as unsupported content.

Incoming alerts use Farcaster's native Mini App notification permission plus vapid.party's queue-backed XMTP observer. The browser proves its current XMTP installation and registers only push topics/HMAC filtering material; message plaintext and decryption keys never enter either backend. vapid.party signs an opaque message-available callback, and the Mini Worker maps it to encrypted Farcaster tokens and sends fixed generic copy to the exact canonical root. `GET /api/notifications/status` stays unavailable and the manifest omits its webhook until every production dependency is configured.

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

The Farcaster account association is configured as Cloudflare Worker runtime secrets and the public Farcaster debugger verifies exact-domain ownership for `miniapp.converge.cv`. The manifest remains `noindex: true` until a separate launch decision. The payer Gateway remains unconfigured, so moving the public app from legacy XMTP `production` to decentralized `mainnet` is still blocked.
