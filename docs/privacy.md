# Privacy and local data

Converge Mini is designed so its first-party Worker does not receive or store private message content.

## Data handled in the browser

- Farcaster host context such as display name, username, avatar URL, and FID is used only as an unverified display hint. A backend identity request instead uses the FID from a verified Farcaster Quick Auth token.
- The host-provided Ethereum account signs XMTP setup requests. The app does not generate, receive, export, or store the wallet private key.
- The active wallet address, XMTP inbox/installation identifiers, conversations, messages, drafts, and consent state are processed in the browser.
- After XMTP is ready, the app may request a short-lived Quick Auth token for the optional ENS identity call. The app sends it only in the authorization header for the protected first-party API and does not persist it in D1 or browser application storage.
- After a successful **No thanks**, the browser stores one non-authoritative dismissal bit keyed by the host-context FID. It contains no name, address, or XMTP identifier and only prevents a repeat background Quick Auth request on that browser; D1 remains the trusted account-wide preference.
- A returned ENS name/address candidate is compared read-only with the active XMTP signer and inbox. The app can determine that the address is active, in the same inbox, in a different inbox, or has no inbox; this check does not add, remove, merge, or migrate an XMTP identity.
- XMTP's Browser SDK persists its database in origin-private file-system storage under `miniapp.converge.cv`. The database is local but is not encrypted at rest by this app. Anyone who can access the unlocked browser profile or exploit same-origin script execution may be able to read decrypted data.
- A Web Lock prevents two same-origin tabs/windows from opening the XMTP database concurrently.
- The app asks the browser for persistent storage after a user opens the inbox. If the browser grants only best-effort storage, the inbox remains usable but shows a standing warning that local history can be evicted under storage pressure.

Clearing site data for `miniapp.converge.cv` deletes the local database and app storage, but it does not delete messages from XMTP or revoke an XMTP installation. Clearing storage can create another installation on the next setup, so the app never revokes other installations automatically.

## Data sent to other services

- The Farcaster host supplies display context and the EIP-1193 wallet provider.
- Farcaster Quick Auth issues the token used for the optional protected ENS call. If no in-memory token exists, the host may request a Farcaster sign-in approval after XMTP is already usable. The Worker verifies the token's signature, issuer, expiry, exact domain/audience, and positive FID subject against Farcaster's published keys.
- For an authenticated ENS lookup, the Worker sends the verified FID to Farcaster's official primary-address endpoint and asks configured public Ethereum RPC providers to resolve the returned public address's ENS primary name and then resolve that name back to the same address. Those services necessarily receive ordinary network metadata and the public identifier being queried.
- XMTP network and payer-Gateway services process protocol traffic and messaging metadata needed to deliver end-to-end encrypted messages.
- On a newly registered Mini App installation, Converge Mini sends XMTP's best-effort history-sync request. A compatible existing installation must be online to re-encrypt and upload an archive for recovery; the archive service is distinct from same-origin OPFS persistence. Sending the request does not prove that an archive has finished importing, so later manual or foreground refreshes can continue to surface recovered history.
- Avatar/image URLs supplied by the Farcaster host can cause the browser to request an external image host.
- Cloudflare necessarily handles ordinary HTTP request metadata for serving the app and sampled Worker observability. Application code adds no message, wallet, FID, inbox, conversation, signature, draft, or token fields to logs.

XMTP protects message content end to end; it does not make wallet identity, participants, timing, IP/network access, or all delivery metadata anonymous.

## First-party backend inventory

The Worker has one D1 table, `ens_identity_preferences`. Each row contains only:

- the Quick Auth-verified Farcaster FID as the primary key;
- `choice`, constrained to `accepted` or `dismissed`; and
- an `updated_at` Unix timestamp.

The Worker does not store the ENS name, wallet address, XMTP inbox or installation ID, Quick Auth token, Farcaster profile, key, signature, conversation, message, or draft. `GET /api/me/ens` resolves the public candidate again on each request. `PUT /api/me/ens-preference` replaces the choice for that FID, and authenticated `DELETE /api/me` deletes the row. The choice remains until it is replaced or deleted. **Delete saved ENS choice** in the identity/privacy menu invokes that protected deletion route; deleting restores the unset state, so the safe optional offer can appear again.

Production and preview use separate D1 databases through the `PREFERENCES` binding. There is no analytics SDK, advertising tracker, contacts database, identity-link table, notification token store, or plaintext-message API. The configured ownership values are Farcaster's public account-association strings.

Application code does not log the Quick Auth token, FID, resolved address/name, saved preference, or XMTP identifiers. If a future feature introduces server-side identity links, directory caching, or notifications, this inventory, retention policy, and user-facing deletion path must be updated before that feature ships.
