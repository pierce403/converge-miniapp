# Privacy and local data

Converge Mini is designed so its first-party Worker does not receive or store private message content.

## Data handled in the browser

- Farcaster host context such as display name, username, avatar URL, and FID is used only as an unverified display hint in the current release.
- The host-provided Ethereum account signs XMTP setup requests. The app does not generate, receive, export, or store the wallet private key.
- The active wallet address, XMTP inbox/installation identifiers, conversations, messages, drafts, and consent state are processed in the browser.
- XMTP's Browser SDK persists its database in origin-private file-system storage under `miniapp.converge.cv`. The database is local but is not encrypted at rest by this app. Anyone who can access the unlocked browser profile or exploit same-origin script execution may be able to read decrypted data.
- A Web Lock prevents two same-origin tabs/windows from opening the XMTP database concurrently.

Clearing site data for `miniapp.converge.cv` deletes the local database and app storage, but it does not delete messages from XMTP or revoke an XMTP installation. Clearing storage can create another installation on the next setup, so the app never revokes other installations automatically.

## Data sent to other services

- The Farcaster host supplies display context and the EIP-1193 wallet provider.
- XMTP network and payer-Gateway services process protocol traffic and messaging metadata needed to deliver end-to-end encrypted messages.
- XMTP device history sync can re-encrypt and upload conversation history so another authorized installation can recover it. This is distinct from same-origin OPFS persistence.
- Avatar/image URLs supplied by the Farcaster host can cause the browser to request an external image host.
- Cloudflare necessarily handles ordinary HTTP request metadata for serving the app and sampled Worker observability. Application code adds no message, wallet, FID, inbox, conversation, signature, draft, or token fields to logs.

XMTP protects message content end to end; it does not make wallet identity, participants, timing, IP/network access, or all delivery metadata anonymous.

## First-party backend inventory

The current Worker stores no user records. There is no application database, analytics SDK, advertising tracker, Quick Auth session, contacts database, notification token store, or plaintext-message API. The only configured ownership values are Farcaster's public account-association strings.

If a future feature introduces server-side identity links, directory caching, authentication, or notifications, this inventory and a user-facing deletion path must be updated before that feature ships.
