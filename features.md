# Converge Mini App: product and feature plan

> Working title: **Converge Mini**
> Status: implementation in progress
> Last reviewed: 2026-07-15
> Canonical scope: this file
> Canonical production origin: `https://miniapp.converge.cv`

## How to use this document

This is a living product specification, feature tracker, and decision log for a deliberately small XMTP messaging app that runs inside Farcaster clients. It is intentionally more detailed than a conventional backlog so future implementation work can stay focused without rediscovering protocol constraints.

Status vocabulary:

| Status | Meaning |
| --- | --- |
| Committed | Part of the intended first public release unless a feasibility spike disproves it. |
| Proposed | Strong default that still needs product confirmation. |
| Spike | Must be proven in current SDKs/hosts before implementation proceeds. |
| Blocked | Required outcome whose current integration path is not yet available or proven. |
| Implemented locally | Code and automated checks exist, but named host/device/network proof is still outstanding. |
| Later | Useful after the first release, but not required to prove the product. |
| Out | Explicitly excluded from this product direction for now. |

Priority vocabulary:

| Priority | Meaning |
| --- | --- |
| P0 | Required for a safe, coherent release. |
| P1 | The next layer after the core messaging loop is reliable. |
| P2 | Optional expansion; should not shape the MVP architecture prematurely. |

## Product statement

Converge Mini is a fast, focused way to open an XMTP inbox from Farcaster and exchange private text messages without leaving the Farcaster client. It should feel like a younger sibling of `converge.cv`: the same dark blue atmosphere, orange energy, warm identity presentation, and careful chat ergonomics, with nearly all of the larger app's account management and power-user surface removed.

The smallest successful version lets a person:

1. Launch from Farcaster without a confusing login screen.
2. Understand which Farcaster profile and wallet-backed XMTP identity they are using.
3. Complete any required XMTP signature with clear, non-transactional language.
4. See their allowed direct-message conversations.
5. Open a conversation, read text messages, and send or retry a text message.
6. Start a DM with a reachable Ethereum/XMTP identity.
7. Close and reopen the Mini App without silently creating a new XMTP installation.

## Authoritative first-release scope

When this document says **first release**, **MVP**, or **P0**, it means exactly this thin product slice unless a later decision explicitly promotes more scope:

- Farcaster Mini App shell, lifecycle, manifest, root embed, and standalone unsupported/recovery state.
- Host-provided EVM wallet connection and a proven XMTP EOA or supported smart-wallet signer; never silently substitute an app-owned key.
- Stable local XMTP installation resume with single-connection protection.
- Allowed direct-message conversation list with sync, cached/loading/empty/error states, and live updates.
- Address-first new DM flow gated by XMTP reachability.
- Text compose/send plus compatible history rendering for text, Markdown source as plain text, replies, attachment metadata, reaction summaries, deduplication, failure, and retry.
- Compact Converge-derived blue/orange visual system with mobile, keyboard, safe-area, and accessibility basics.
- Production deployment at `https://miniapp.converge.cv` using Cloudflare Workers Static Assets plus a small Worker API.
- A post-inbox, Quick Auth-protected ENS primary-name offer that remembers the Farcaster account's accepted/dismissed choice without changing XMTP keys or message history.
- A production XMTP Gateway/payer solution as required by the current official design; this remains blocked until the pinned Browser SDK path is proven.

Quick Auth also protects a stateless public-identity lookup that upgrades known XMTP peer addresses to display-only fname, ENS, and Basename labels. D1 remains exclusive to the named ENS preference flow. The following are **not required for the first release**: general Farcaster handle/name recipient search, persisted identity links, message-request management, Mini App notification permissions, incoming-message notifications, an expanded settings sheet, or a share action beyond the required root embed. Their detailed requirements remain in this plan so adding them later does not blur the security boundary.

## Decisions already captured

| Decision | Status | Notes |
| --- | --- | --- |
| Build an XMTP messaging app as a Farcaster Mini App | Committed | This is the core product, not a generic Farcaster client or wallet app. |
| Keep the app much smaller than `converge.cv` | Committed | Excellent launch, identity, inbox, DM, and composer states come before breadth. |
| Use `converge.cv` as the visual family reference | Committed | Reuse palette and small presentational patterns, not its full provider/store/feature architecture. |
| Use the Farcaster host EVM wallet as the first-release XMTP identity | Committed | Low-friction, interoperable default; an unsupported wallet gets an explicit explanation instead of a silently generated identity. |
| Host the frontend and first-party API on Cloudflare Workers | Committed | Workers Static Assets and the Vite plugin fit the SPA/API workload. The exact XMTP payer Gateway may still require a separate container host. |
| Revisit Cloudflare versus Vercel after real operating evidence | Later | Vercel remains a documented fallback/comparison, not a blocker for implementation. |
| Use `miniapp.converge.cv` as the stable Mini App identity | Committed | Farcaster binds manifest ownership, embeds, notifications, browser persistence, and discovery to this exact hostname. |
| Use “Converge Mini” as the working public name | Committed | The name can be revisited before broad discovery without changing the canonical hostname. |
| Keep P0 recipient entry address-first | Committed | ENS/Farcaster handle resolution remains P1 and must not block interoperable direct messaging. |
| Open XMTP immediately with Farcaster's preferred host account | Committed | No app-level wallet, key, or inbox chooser is shown before the host/XMTP approvals needed to open that account. |
| Treat a verified ENS name as a safe label, not a migration | Committed | Offer it automatically only when the Farcaster primary address is the active XMTP address or already belongs to the active inbox. Acceptance changes presentation only. |
| Never merge or silently relink separate XMTP inboxes | Committed | A different ENS-address inbox gets an explanation in the identity menu; no account, recovery identity, key, or history is moved. |
| Remember the ENS choice by trusted Farcaster FID | Committed | Quick Auth supplies the authoritative FID; D1 stores only `accepted` or `dismissed` plus an update timestamp. |
| Resolve known peer addresses as display hints | Committed | Prefer ENS, then Basename, and always retain the wallet address. Show a registered fname only as a separately labeled best-effort hint, never for authorization. |
| Use Git and GitHub from the beginning | Committed | Each coherent task is verified, committed, and pushed before the next task begins. |

### Important backend clarification

A Farcaster Mini App does **not** require a custom always-on application server merely to render or be published. A static HTTPS app can serve its signed manifest, embed metadata, and client code. This project still has good reasons for backend endpoints:

- verifying Farcaster Quick Auth tokens for trusted application sessions;
- resolving and caching identity mappings without trusting host context;
- receiving signed add/remove/notification preference webhooks;
- storing Farcaster notification tokens and user preferences;
- applying rate limits and abuse controls; and
- potentially authenticating an XMTP payer Gateway or feeding a future notification bridge.

The first architecture should keep the client usable even if optional backend features are unavailable. Message encryption/decryption and the user's XMTP installation remain client-side.

## Product goals

### Primary goals

- Make the path from Farcaster launch to a usable XMTP inbox short, legible, and trustworthy.
- Provide genuinely interoperable XMTP text DMs rather than a private app-specific chat database.
- Make Farcaster identity useful for presentation and recipient discovery without pretending a Farcaster FID is itself an XMTP identity.
- Preserve end-to-end message encryption and keep private keys and plaintext messages away from the app backend.
- Survive embedded mobile-web realities: safe areas, virtual keyboards, suspended webviews, constrained viewport height, storage eviction, and host re-entry.
- Preserve the recognizable feel of `converge.cv` in a compact single-column interface.
- Keep the architecture small enough for one person to understand, deploy, audit, and operate.
- Make failure states actionable, especially wallet-signature, XMTP network, storage, installation-limit, and unsupported-recipient failures.

### Secondary goals

- Support a useful standalone-browser fallback for development, debugging, and recovery.
- Add explicit message-request and notification controls after the core loop proves reliable.
- Make the root entry point shareable without leaking private routing or conversation context.
- Create a clean base for later groups and richer content without shipping those features prematurely.
- Keep hosting-provider-specific code at the API/storage boundary so a later Cloudflare/Vercel comparison is real rather than theoretical.

## Non-goals for the first release

- Rebuilding all of `converge.cv` inside a Mini App.
- Creating a general Farcaster client, social feed, cast composer, or wallet dashboard.
- Custodying users' wallet or XMTP private keys on the backend.
- Storing message plaintext, decrypted attachments, or searchable message history on the backend.
- Multi-inbox switching, keyfile import/export, device pairing, or elaborate account recovery.
- Group creation or administration.
- Composing attachments or other rich content, rendering attachment bytes inline, audio, forwarding, editing, disappearing messages, or live typing/read-receipt UI. Compatible received replies, reaction summaries, and attachment metadata may render safely.
- Token transfers, swaps, mints, or other onchain transaction features.
- A full contacts system, global message search, or desktop two-pane workspace.
- A separate PWA install experience, service-worker push stack, or native app wrapper.
- Claiming anonymity. XMTP protects message content end to end, but identities, timing, network access, notification metadata, and other metadata require precise treatment.

## Product principles

### One obvious path

The default screen should always answer “what can I do next?” Avoid tab bars, dashboards, setup wizards, and settings pages when a single contextual action will do.

### Identity honesty

Display the Farcaster profile and XMTP destination together when helpful, but label them distinctly. Never imply that a handle is messageable until its Ethereum identity resolves and XMTP confirms reachability.

### Signatures are expensive interactions

Minimize prompts. Explain why a signature is required, what it changes, and that it is not a transaction. Never trigger a wallet prompt on launch without a user-understandable setup state.

### Private by architecture

Decrypt in the client. Keep the server blind to message content. Collect the smallest identity/notification data set that makes the Mini App work, document it, and provide deletion controls.

### Fast shell, progressive messaging

Render the branded shell and call `sdk.actions.ready()` once that shell is stable. XMTP WASM initialization, wallet work, history sync, and directory resolution should have visible progressive states rather than holding the Farcaster splash screen indefinitely.

### Small surface, complete states

A short feature list still needs loading, empty, offline, permission-denied, retry, stale-data, storage, and recovery states. “Simplified” means fewer concepts, not missing correctness.

### Host-native but not host-dependent

Use Farcaster context, wallet access, haptics, navigation, adding, sharing, and notifications where supported. Detect the Mini App environment and provide a modest standalone fallback instead of crashing outside a host.

## People and jobs to be done

### Farcaster regular

“I found this in my feed or app drawer. Let me privately message someone without learning a new account system.”

Needs:

- automatic Farcaster session establishment;
- recognizable profiles;
- plain-language XMTP setup;
- minimal signatures;
- clear recipient reachability; and
- a familiar mobile chat experience.

### Existing XMTP user

“Use the same wallet-backed inbox I already use elsewhere, resume local Mini App history when it exists, and recover older history when another compatible installation can provide it.”

Needs:

- correct wallet/signer selection;
- reuse of the stable XMTP inbox ID;
- honest separation between same-origin local continuity and best-effort cross-installation history sync;
- consent-aware allowed and request lists; and
- no accidental identity fork.

### New XMTP user

“I have a Farcaster wallet but no XMTP inbox yet. Set one up without making it feel like a blockchain operation.”

Needs:

- explicit setup explanation;
- safe EOA or supported smart-wallet signing;
- progress and cancellation handling;
- a useful empty inbox; and
- a clear first-recipient path.

### Returning embedded-webview user

“I closed the host and came back. Resume where I was without asking me to sign again or losing history.”

Needs:

- persistent OPFS storage;
- installation reuse;
- foreground resync;
- deep-link restoration; and
- honest recovery if host storage was evicted.

## Core user journeys

### Journey A: returning user opens the inbox

1. Host loads the app at the registered production domain.
2. App renders a stable themed shell and releases the host splash screen.
3. App detects Mini App capabilities and gets untrusted display context.
4. App obtains Quick Auth only when a trusted backend call is needed.
5. App reconnects to the host-provided wallet and resumes the existing XMTP installation from OPFS.
6. App syncs conversation metadata/messages, renders cached content quickly, then starts live streams.
7. Inbox opens on the last sensible state: list or deep-linked conversation.

Success condition: no unnecessary signature and no new installation.

This journey assumes the same origin still has its existing local database. A first visit from a wallet that already has an XMTP inbox is a **new Mini App installation**: it can recover the stable inbox ID, but older conversations/messages are available only if a compatible existing installation is online and answers the explicit history-sync request.

### Journey B: first XMTP setup

1. After host capability detection, the app immediately begins opening XMTP with the single EVM account supplied by Farcaster; it shows no wallet, key, or inbox chooser.
2. App determines whether that account behaves as an EOA or a supported smart contract wallet and constructs the correct XMTP signer.
3. The host presents only the wallet approvals required by XMTP setup. The app identifies them as XMTP signatures and says they are not transactions.
4. App creates or resumes the inbox and installation, saves local state, performs the initial sync, offers best-effort cross-installation history recovery when applicable, and enters inbox/empty state.

Success condition: setup requires no product decision, never substitutes an app-owned key, and stops in an explicit retry state after rejection.

### Journey C: read and reply

1. User opens an allowed conversation.
2. App syncs, renders locally available messages, and maintains bottom position only if the user was already near the bottom.
3. User types a text message.
4. Composer shows sending state without duplicating submission.
5. Message becomes sent or presents a retry action with the draft preserved.
6. Incoming messages append live without stealing scroll position from someone reading older content.

### Journey D: start a direct message

1. User taps **New message**.
2. For P0, the user enters an Ethereum address; P1 can add Farcaster handle/name search.
3. The app normalizes the address and checks XMTP reachability with `canMessage()` before allowing creation.
4. The result clearly shows the shortened wallet identity and reachable/unreachable state.
5. User confirms a reachable identity and enters a new DM.

Success condition: no conversation is created against an unresolved or unreachable identity.

### Journey E: message request (P1)

1. An unknown sender's conversation appears in **Requests**, not the trusted inbox.
2. Preview reveals only what is safe and necessary.
3. User can accept or decline.
4. Accepting moves the conversation to allowed; declining updates XMTP consent and removes it from normal view.

### Journey F: re-entry from a notification (P1)

1. Farcaster opens an exact same-domain target URL.
2. App reads the host notification context but does not trust it for authorization.
3. App authenticates/syncs and opens the referenced conversation if the local user is a member.
4. If the target is unavailable, app falls back to the inbox with a useful explanation.

This journey is P1 until the incoming-XMTP-to-Farcaster notification bridge is proven.

### Journey G: optional ENS identity label

1. The XMTP inbox opens first with Farcaster's preferred host-provided EVM account; ENS discovery never blocks this path.
2. Once XMTP is ready, the app obtains Quick Auth for the protected identity call. A host with no current token may ask for a Farcaster sign-in approval at this point; that approval is not a wallet/key/inbox product decision and cannot block the already-usable XMTP inbox. The Worker verifies the exact-domain token and derives the trusted FID from its subject.
3. The Worker fetches that FID's official Farcaster primary Ethereum address, looks up its ENS primary name, and forward-resolves the name back to the same address.
4. The browser compares that address with the active signer and its current XMTP inbox without mutating either.
5. If the address is active or already belongs to the same inbox and no preference exists, the app asks once whether to use the ENS name as the inbox label. **Use ENS name** or **No thanks** is saved account-wide as `accepted` or `dismissed`.
6. A dismissal prevents future automatic prompts, but the identity/privacy menu keeps the ENS option available. D1 stores the account-wide choice, while a local dismissal bit also skips repeat background Quick Auth on that browser.
7. If the address belongs to a different XMTP inbox, has no inbox, or cannot be checked, the app does not interrupt the user. The menu explains the exact boundary and changes nothing.

Success condition: the optional flow never moves a key, recovery identity, inbox, installation, conversation, or message history, and failure never blocks messaging.

## First-release feature matrix

| Area | Feature | Priority | Status | Definition of done |
| --- | --- | --- | --- | --- |
| Shell | Farcaster Mini App detection and SDK lifecycle | P0 | Committed | Embedded and standalone modes render; `ready()` is called at the correct point; listeners are cleaned up. |
| Shell | Mobile safe areas, keyboard, and constrained viewport | P0 | Committed | Core flows work in host webviews without clipped header/composer or body-scroll traps. |
| Publishing | Signed `/.well-known/farcaster.json` | P0 | Verified production | Farcaster's public debugger verifies schema, signature, FID ownership, and the exact production domain. |
| Publishing | Root `fc:miniapp` share embed | P0 | Committed | Root URL renders a valid 3:2 feed card and launches the app. |
| Identity | Farcaster Quick Auth session | P1 | Implemented locally | Exact issuer, expiry, audience/domain, and positive-FID subject verification protects the ENS preference API; canonical-host proof remains. |
| Identity | Host EVM wallet connection | P0 | Implemented locally | The host's preferred account opens automatically with no wallet/key chooser; lifecycle teardown is implemented and real Farcaster desktop/iOS/Android proof remains. |
| Identity | EOA and supported SCW XMTP signer | P0 | Implemented locally | EOA/SCW construction is unit-tested; real host signature traces remain. |
| Identity | Stable XMTP inbox/installation reuse | P0 | Implemented locally | Persistent OPFS defaults and a single-owner Web Lock exist; host re-entry proof remains. |
| Identity | Forward-verified ENS primary-name offer | P1 | Implemented locally | Trusted-FID discovery, reverse/forward ENS proof, read-only XMTP relationship checks, remembered acceptance/dismissal, safe label-only use, and truthful separate-inbox states are tested; canonical-host proof remains. |
| Identity | Peer fname, ENS, and Basename labels | P1 | Implemented locally | Bounded, rate-limited protected batches resolve public wallet metadata without persistence; ambiguous/broken sources fall back to the visible address. A registered fname is secondary registry metadata, not a canonical profile or authorization. |
| Identity | Compact identity/privacy menu | P0 | Implemented locally | Active wallet, network, local-storage disclosure, ENS recheck, label selection/deletion, and non-migration explanations remain available after onboarding. |
| Inbox | Allowed DM conversation list | P0 | Implemented locally | Allowed-only cached-first sync/list/stream UI exists; dev-network and offline host acceptance remain. |
| Inbox | Separate message requests | P1 | Later | Unknown contacts stay excluded from the P0 allowed list; later accept/decline updates consent. |
| Compose | Address-first recipient reachability | P0 | Implemented locally | Normalized Ethereum address is checked with `canMessage()` before DM creation. |
| Compose | Farcaster handle/name recipient search | P1 | Later | Trusted directory lookup maps profile to verified candidate identity before `canMessage()`. |
| Chat | Compatible message history | P0 | Implemented locally | Cached-first text and plain-text Markdown source, replies, attachment metadata, reaction summaries, a growing contiguous newest-message window, exact-nanosecond ordering, ownership, fallback, and loading exist. Silent control messages remain off the timeline. |
| Chat | Live incoming text messages | P0 | Implemented locally | Allowed-DM stream, stable-ID upsert, one retained SDK-owned retry proxy, foreground visible-chat refresh, and health UI exist; real reconnect proof remains. |
| Chat | Send, optimistic state, failure, retry | P0 | Implemented locally | Duplicate guards and same-ID unpublished retry exist; Browser SDK 7 terminal failures are disclosed. |
| Local data | Single-connection protection | P0 | Implemented locally | A second tab/window cannot contend for OPFS and gets useful guidance. |
| Local data | Storage-loss/install-limit recognition | P0 | Implemented locally | Browser primitives are checked before wallet access; curated storage, installation, and permanent inbox-limit states never auto-revoke or expose raw database identifiers. |
| Local data | Installation management/revocation UI | P1 | Later | User can deliberately inspect and revoke an old installation when required. |
| Design | Converge-derived compact visual system | P0 | Implemented locally | Palette, bubbles, surfaces, inputs, focus states, and empty states are implemented; embedded-device review remains. |
| Backend | Cloudflare Worker Static Assets | P0 | Deployed | The Worker, `miniapp.converge.cv` Custom Domain, and Farcaster ownership are live; Cloudflare Workers Builds deploys verified `main` commits. Production XMTP remains a separate release gate. |
| Backend | Authenticated XMTP payer Gateway | P0 | Blocked | A decentralized-mainnet move must prove Gateway selection/auth, per-user quotas, viable container hosting, and one funded send. Legacy `production` inbox testing can proceed independently. |
| Backend | Protected API and minimal identity data | P1 | Implemented locally | Exact-host Quick Auth routes and isolated production/preview D1 bindings store only ENS `accepted`/`dismissed` choice by FID; migration and production route proof remain. |
| Backend | Notification token data model | P1 | Later | D1 stores only verified, protected notification lifecycle data after notifications are promoted. |
| Operations | Redacted logs, health, and error visibility | P0 | Committed | Failures are diagnosable without leaking message content, tokens, or full wallet identifiers. |
| Notifications | Add Mini App and store notification permission | P1 | Proposed | Signed webhooks are verified and token lifecycle is correct. |
| Notifications | Notify on incoming XMTP message | P1 | Spike | Privacy-safe bridge works while client is closed without user decryption keys. |
| Sharing | Share app with Farcaster compose action | P1 | Later | User can share a generic app card without leaking private conversation details. |
| Settings | Expanded privacy/identity/about sheet | P1 | Later | Add trusted profile/FID, inbox/installation details, version, notifications, and broader future account-data controls beyond the implemented compact menu. |

## Detailed feature requirements

### 1. Mini App shell and lifecycle

#### Launch

- Load over HTTPS on one canonical production hostname.
- Render a compact shell before waiting on wallet, Quick Auth, XMTP WASM, or network sync.
- Call `sdk.actions.ready()` once the shell is visually ready; never leave the host splash screen waiting on an unbounded network operation.
- Use `sdk.isInMiniApp()` to select embedded or standalone behavior.
- Read host capabilities before showing host-specific controls.
- Treat `sdk.context` as display hints only; never authorize a backend or bind an XMTP identity from unverified context.
- Preconnect only to required first-party/auth/XMTP endpoints and justify every additional origin in the CSP.

#### Host integration

- Use capability-gated host back navigation for nested views and retain a conventional in-app control as a visible fallback when host calls fail or are unavailable.
- Respect safe-area insets from context/CSS for header and composer.
- Listen for relevant host events and remove listeners on teardown.
- Pause or close live work when the page becomes hidden if required for stability; resync when foregrounded.
- Use restrained haptics for intentional actions such as successful send, not for every tap.
- Do not require `addMiniApp()` to use messaging. Ask only after the user has experienced value and understands notifications.

#### Standalone fallback

- Display the same visual shell outside a Farcaster host.
- Explain that the app is designed for Farcaster and provide a clear open-in-Farcaster/share path.
- Permit local development with an injected/test wallet path only in development configuration.
- Never silently substitute a generated production identity just because host wallet access is missing.

### 2. Farcaster identity presentation and trusted ENS preference

#### Trusted session (promoted for the ENS preference flow)

- Use Farcaster Quick Auth for API calls that need a trusted user.
- Verify JWT signature, expiry, and exact domain/audience on the backend.
- Use the verified FID from the JWT subject; do not accept an FID supplied in request JSON or query parameters as authority.
- Keep the session token short-lived and in memory where practical.
- Make public/static app operation independent of Quick Auth when no protected API is needed.
- Start the protected ENS request only after the XMTP inbox is ready so Quick Auth or directory failure cannot block messaging onboarding.
- Do not describe Quick Auth as guaranteed silent: the pinned SDK can invoke the host's Farcaster sign-in action when no valid in-memory token exists. Treat that approval as part of the optional post-inbox identity flow, never the XMTP setup flow.

#### Profile display

- Show avatar, display name, and `@username` from a trusted directory response or clearly mark host-context data as provisional.
- Pair the Farcaster profile with the active wallet/XMTP identity in onboarding and the privacy sheet.
- Truncate addresses visually but make full identifiers copyable from the detail sheet.
- Do not claim that the Farcaster profile “is” the XMTP inbox.

#### ENS primary-name discovery and preference

The implemented definition of “an ENS name connected to Farcaster” is deliberately narrow: the authenticated FID's official Farcaster primary Ethereum address has an ENS primary name whose forward resolution returns that exact address.

Requirements:

- Fetch the Farcaster primary address on the Worker from the Quick Auth-verified FID; never authorize this lookup with host context or a client-supplied FID.
- Normalize the ENS primary name and require reverse and forward mainnet resolution to agree before returning a candidate.
- Return only a public name/address candidate, discovery status, and current preference; use `Cache-Control: no-store`, fail closed on auth/binding errors, and return no candidate when directory or resolver evidence is unavailable.
- Check the candidate against the active XMTP client in the browser. Classify it as the active address, another address in the same inbox, a different inbox, or no inbox without invoking an inbox update.
- Automatically offer the name only for the active-address/same-inbox cases and only while the trusted FID has no saved choice.
- Persist only `accepted` or `dismissed` by trusted FID. Do not persist the address, ENS name, XMTP inbox ID, Quick Auth token, or any message data.
- A dismissal suppresses later automatic prompts. Store a non-authoritative local dismissal bit so the same browser also skips repeat background Quick Auth; keep manual discovery and **Use ENS name** available from the identity/privacy menu.
- Let the user delete the saved choice from that menu through the authenticated API. This restores the unset state and makes the safe offer eligible again.
- Treat acceptance as presentation state only. It changes the inbox label, not the XMTP recovery identity, signer, accounts, installation, or history.
- Let lookup failure degrade to an unavailable menu state without interrupting the active inbox.

### 3. Wallet-backed XMTP identity

#### Default identity model

Recommended default: use the EVM wallet supplied by the Farcaster host as the XMTP recovery identity/signer. This avoids inventing a second account and lets the user access the same inbox from other XMTP clients that use that identity.

Requirements:

- Get the EIP-1193 provider from the Farcaster Mini App SDK.
- Reuse the host's preferred connected account rather than presenting a wallet-picker modal.
- Determine EOA versus supported ERC-1271 smart contract wallet behavior before creating the XMTP signer.
- Use the exact chain ID expected for a smart wallet and keep it consistent on future sessions.
- Convert provider signatures into the byte format required by the current XMTP Browser SDK.
- Explain registration/installation signatures in the progress state shown with the host approval; do not add a preliminary onboarding choice.
- Handle rejection, unsupported wallet behavior, chain mismatch, provider disconnect, and account change.
- Set a production `appVersion` and explicitly select XMTP `dev` or `production`; never let the SDK default choose release behavior.

#### Identity changes

- If the host wallet account changes, stop streams and close the old client before opening another identity.
- Never display cached messages from one identity under another profile.
- Require explicit confirmation before associating additional wallet identities with the same XMTP inbox; this is Later unless needed for host compatibility.

#### ENS and XMTP migration boundary

Farcaster supplies one preferred EIP-1193 account to this Mini App. It does not provide a safe signer inventory for a “primary” and separate embedded-wallet/Warplet address, so Converge Mini does not present those as selectable keys.

The current implementation never adds, removes, or reassigns an XMTP account:

- If the verified ENS address is active or already belongs to the same inbox, the app can safely use its name as a label.
- If it belongs to a different inbox, the app explains that existing XMTP inboxes and their message histories cannot be merged. It does not call the state an available migration.
- If it has no inbox, the Farcaster host still does not expose that ENS address as a signer, so the app cannot prove and add it safely.
- A future first-registration flow targeting another recovery identity would require that identity's signer before registration, explicit user intent, and a separately reviewed protocol. It is not a post-registration migration and is not silently inferred from ENS ownership.

#### Explicitly rejected default

Do not generate and retain a raw app-owned secp256k1 key as the normal production identity without a separate product decision. It lowers signature friction but introduces backup, recovery, portability, storage, and identity-explanation work that contradicts the simplified goal.

### 4. Local XMTP state and installation continuity

The Browser SDK persists SQLite in the origin private file system (OPFS). Current official documentation says the browser database is not encrypted and the VFS does not support multiple simultaneous connections.

Requirements:

- Treat the exact origin as part of the user's installation identity; avoid hostname migrations.
- Choose the canonical production hostname before real-user persistence testing; preview/tunnel origins cannot prove production OPFS continuity, Quick Auth audience, manifest identity, or notification targets.
- Reopen the existing database on every launch.
- Prevent simultaneous access from multiple tabs/windows using a browser coordination lock and an explanatory takeover state.
- Never place decrypted messages in `localStorage`, analytics payloads, Redux/Zustand devtools, console logs, or crash-report breadcrumbs.
- Use a strict CSP and minimal third-party JavaScript because an XSS flaw could read decrypted local data.
- Detect storage availability and failure before beginning registration where possible.
- Test persistence across host close/reopen, device restart, host upgrade, app redeploy, and common storage-pressure scenarios.
- Document that clearing site data can remove local history and consume a new XMTP installation on the next setup.
- Support the current SDK's explicit history-sync behavior for a new installation; do not assume history appears automatically.
- Treat same-origin resume and new-installation recovery as different states: the former should retain full local continuity, while the latter offers best-effort history recovery.
- Explain that cross-installation history sync requires another compatible installation to be online and may return no older history.
- Disclose that XMTP history sync creates a re-encrypted archive and uploads it to the configured history service for the requesting installation; never describe it as a purely peer-to-peer local copy.
- Recognize the ten-active-installation limit and the cumulative inbox-update risk.
- First release recognizes the installation-limit error, stops safely, and explains that an old installation must be revoked; the focused management/revocation sheet is P1.
- Never revoke another installation automatically.

### 5. Conversation inbox

#### Allowed conversations

- List allowed DMs only in the primary inbox for the first release.
- Sync before relying on the local list, then subscribe to conversation and message changes.
- Sort by latest meaningful message activity.
- Show avatar/initial, display name or shortened identity, one-line text/fallback preview, timestamp, and unread affordance only if unread semantics are reliable.
- Avoid false unread counts if cross-client read state is not implemented.
- Preserve cached list content during foreground refresh and show a subtle sync state rather than replacing it with a full-screen spinner.
- Empty state: explain that this inbox works across XMTP and offer **New message**.
- Error state: preserve any cached list, state what failed, and offer retry.

#### Message requests (P1)

- Query new/unknown consent states separately from allowed chats.
- Show a request count without exposing message text in host-level notifications.
- Require an intentional accept action before treating the sender as trusted.
- Decline updates XMTP consent and removes the request from normal view.
- Blocking/muting/reporting are later features; do not label decline as block.

#### Conversation identity

- Resolve participant display data separately from XMTP transport identity and cache it with an expiry.
- Always retain a safe address/inbox fallback when directory lookup fails.
- Make profile links open through the Farcaster SDK when the FID is known.

### 6. Start a direct message

#### Search and resolution

The first release is deliberately address-first. Farcaster-first handle/name search is a P1 enhancement whose directory source is still an open decision.

P0 requirements:

- Accept and normalize a full Ethereum address.
- Check `Client.canMessage()` before enabling the conversation action.
- Explain “not on XMTP yet” separately from network failure or invalid input.
- Prevent starting a DM with the current identity.
- Deduplicate an existing DM and open it rather than creating a confusing duplicate.
- Do not require ENS resolution to start a DM in the first release; the optional own-inbox label flow is separate from recipient resolution.

P1 Farcaster search requirements:

- Debounce user search and cancel stale results.
- Resolve handle/name results to trusted FIDs through the chosen Farcaster directory provider.
- Resolve the FID to verified/primary candidate Ethereum identities.
- Make it visible when a profile has multiple candidate identities and use a deterministic preference rule.
- Never create a conversation from display name or unverified host context alone.

Directory options to compare in the feasibility phase:

- official Farcaster/Snapchain endpoints;
- Neynar as a managed developer API; or
- a minimal first-party cache populated from verified lookups.

Selection criteria: correctness, latency, rate limits, cost, privacy, Cloudflare runtime compatibility, and dependence on a private API key.

### 7. Direct-message view

#### Header

- Round avatar/initial, primary display name, muted handle or shortened XMTP identity.
- Back control that follows host navigation semantics.
- One compact identity/details action; no dense toolbar.
- Connection/sync problems appear as a small status row, not as ambiguous participant status.

#### Message history

- Text is the only authored content type in the first release.
- Render sent messages in orange and received messages on dark translucent blue.
- Use left/right ownership, small timestamps, readable long-text wrapping, and selectable text.
- Treat unknown or unsupported XMTP content types as a safe fallback card; never crash the conversation.
- Page older messages without moving the user's current reading position.
- Stick to the bottom only when the user is already at/near the bottom.
- When new messages arrive while scrolled up, show a compact **New messages** affordance rather than jumping.
- Deduplicate by stable XMTP message identity across sync, stream, optimistic state, and retries.
- Never render untrusted rich HTML from message content.

#### Composer

- Auto-growing plain-text textarea with a practical maximum height.
- Minimum 44px touch targets and a square orange send button.
- Enter behavior must work across mobile keyboards; desktop Enter-to-send and Shift+Enter may be enabled only when predictable.
- Trim only transport-invalid boundary whitespace; preserve intentional internal line breaks.
- Disable empty sends.
- Guard duplicate submission in both UI event handling and message state logic.
- Preserve the draft on send failure and on accidental navigation where practical.
- Use the pinned Browser SDK's documented persisted optimistic/unpublished-message mechanism so the app retains one stable local message identity through preparation, publication, acknowledgement loss, and retry.
- Optimistic message state: preparing, unpublished, publishing, sent, failed.
- After an ambiguous network failure, retry publication of the same local message identity; do not call the ordinary new-message send path again.
- Failed state offers retry and copy; retry cannot create a second optimistic row or a second transport message.
- Display a concise network/offline explanation instead of silently spinning.

### 8. Sync, streaming, and lifecycle reliability

- Perform an explicit initial sync for conversations, consent/preferences, and messages required by the visible view.
- For a new installation, call the current SDK's explicit history-sync request when appropriate and present progress honestly.
- Start streams only after the client and initial state are coherent.
- Keep one stream owner per active client and stop it on identity change, logout, takeover, or teardown.
- On stream error, retain the one SDK-owned proxy while Browser SDK 7 retries it, expose retry/restart health, and never create an untracked second stream.
- Offer an explicit visible-state refresh while the stream is degraded. Treat a synchronous stream-start rejection separately from an underlying stream failure that the SDK is still retrying.
- On foreground/reconnect, resync before assuming no messages were missed.
- Avoid unbounded polling.
- Keep the last usable local view during transient network failures.
- Separate “XMTP is syncing” from “Farcaster profile data is refreshing.”
- Pin the SDK version, track release notes, and schedule upgrades because deprecated XMTP clients can eventually be rejected by the network.

### 9. Farcaster publishing and discovery

#### Manifest

- Serve `/.well-known/farcaster.json` from the exact canonical hostname.
- Include signed `accountAssociation` for the owning Farcaster account.
- Include version, name, home URL, opaque 1024×1024 PNG icon, splash image/background, description, subtitle, category, tags, screenshots, hero/OG metadata, and webhook URL only when enabled.
- Declare `wallet.getEthereumProvider` in `requiredCapabilities` after the host matrix proves it, and declare only the `requiredChains` genuinely required by the supported wallet/SCW flow.
- Keep all image URLs public, absolute, production-hosted, and correctly dimensioned.
- Treat apex and `www` as different app identities; choose one and redirect the other without changing manifest identity.

#### Embed/share card

- Emit a valid `fc:miniapp` meta tag at the root URL.
- Use a 3:2 image and concise launch button copy.
- Share the app generically; never put participant names, message previews, inbox state, or conversation IDs into public embed metadata.
- Add per-route embeds only when they are intentionally public and privacy-reviewed.
- Do not place a raw XMTP conversation ID in a server-visible path or query string. If a P1 notification needs private client routing, prefer a fragment resolved locally; if server resolution is unavoidable, use an authenticated short-lived opaque reference with redacted access logs and a strict referrer policy.

#### Discovery readiness

- Validate manifest and embed with Farcaster developer tools on the production domain.
- Provide required metadata/assets and at least one accurate screenshot.
- Ensure `addMiniApp()` is tested on production rather than tunnel domains.
- Keep account association generation/rotation documented as an operator step.

### 10. Notifications

#### Permission and token lifecycle (P1)

- Ask the user to add/enable the Mini App only after explaining the benefit.
- Receive `miniapp_added`, `miniapp_removed`, `notifications_enabled`, and `notifications_disabled` webhooks.
- Verify signed webhook events against current Farcaster network state before storing anything.
- Store each token with exact notification URL, trusted FID, Farcaster client, status, and timestamps.
- Treat tokens and URLs as secrets. Farcaster may intentionally expose `notificationDetails` to the Mini App through client context; never log or persist that client-visible copy, and never return the server-stored copy from an app API.
- Deactivate tokens immediately on removal/disable or when the host reports them invalid.
- Use stable notification IDs for deduplication and honor host rate limits.
- Keep target URLs on the exact registered hostname.

#### Incoming-message notification bridge (Spike/P1)

The closed Mini App cannot keep a browser XMTP stream alive. Farcaster notification delivery and detection of incoming XMTP traffic are separate systems.

Before implementation, prove an architecture that:

- observes only the user's authorized encrypted XMTP topics/events;
- does not receive the user's decryption keys or plaintext;
- obtains the current topic subscription and HMAC filtering material through a Browser SDK path proven on the target hosts;
- stores any topic/HMAC material with application-layer encryption and rotates/resubscribes it when HMAC keys or stitched-DM topics change;
- maps an event to the correct trusted FID/notification subscription;
- sends generic content such as **New encrypted message** rather than message text;
- deduplicates across retries and multiple installations;
- respects consent, disable/removal, and rate limits; and
- has a clear runtime/cost/operations story.

XMTP push HMAC keys are privacy-sensitive filtering material, but they are not message-decryption keys. They still need encryption, rotation, deletion, strict access control, and a precise disclosure. Current official push examples do not establish the required Browser SDK flow, so do not promise per-message Farcaster notifications until it is proven on the target hosts. Use a generic inbox notification target by default; exact-conversation routing requires a separate metadata/privacy review and an opaque mapping.

### 11. Identity/privacy menu and expanded settings sheet

The implemented compact menu is available from the inbox header rather than as a permanent navigation destination. It shows the active Farcaster wallet, XMTP environment/wallet kind, local-storage disclosure, and the ENS discovery/relationship state. It can rerun discovery, opt into a safe ENS label after a prior dismissal, delete the saved ENS choice, or explain why a separate ENS inbox cannot be connected or merged.

The expanded P1 modal/sheet remains Later. Include:

- Farcaster profile and trusted FID;
- active wallet address and XMTP inbox ID;
- current installation ID/label where useful;
- notification enabled/disabled state;
- short explanation of local unencrypted browser storage;
- refresh/sync action;
- privacy policy, source repository, version, and network environment;
- delete server-side account metadata action; and
- a separate, carefully worded local-data/reconnect action only when the SDK supports a safe implementation.

The visible **Delete saved ENS choice** control calls protected `DELETE /api/me`, removes the authenticated FID's preference, and returns the optional offer to its unset state. Future broader account-data semantics remain part of the expanded sheet.

Do not claim that closing `Client` deletes the Browser SDK database; current SDK behavior only terminates its worker.

## Visual and interaction design

### Family resemblance to `converge.cv`

The current sibling app was audited from its actual source, especially `tailwind.config.js`, `src/index.css`, the layout shell, conversation view, composer, and message bubble components.

Carry forward:

- dark navy/cobalt diagonal background;
- vivid orange primary actions and sent-message bubbles;
- translucent dark-blue surfaces with thin blue borders;
- subtle backdrop blur and restrained shadows;
- blue-white text hierarchy;
- rounded cards/controls and circular avatars;
- system sans typography with weight-based hierarchy;
- identity-forward empty/onboarding states; and
- careful mobile composer and safe-area behavior.

Do not carry forward:

- the `CV` monogram as the new app's final mark;
- desktop/sidebar navigation;
- multiple bottom tabs;
- dense settings, identity switchers, debug tools, and database controls;
- the OG card's sky/indigo palette when it conflicts with the app's canonical blue/orange palette; or
- broad teal/green circuitry as a dominant motif.

### Proposed token direction

Start from the exact application palette currently used by `converge.cv`; prune unused steps rather than approximating a new family:

| Family | Exact reference steps |
| --- | --- |
| Primary | `50 #eff6ff`, `100 #dbeafe`, `200 #bfdbfe`, `300 #93c5fd`, `400 #60a5fa`, `500 #3b82f6`, `600 #2563eb`, `700 #1d4ed8`, `800 #1e40af`, `900 #1e3a8a`, `950 #0b1f4a` |
| Accent | `50 #fff7ed`, `100 #ffedd5`, `200 #fed7aa`, `300 #fdba74`, `400 #fb923c`, `500 #f97316`, `600 #ea580c`, `700 #c2410c`, `800 #9a3412`, `900 #7c2d12` |

Map those reference colors into semantic tokens:

| Token | Proposed value/use |
| --- | --- |
| `--color-bg-deep` | `#0b1f4a` family; deepest shell/background. |
| `--color-bg-mid` | Saturated navy/cobalt for the gradient and elevated areas. |
| `--color-surface` | Translucent deep blue at roughly 40–80% opacity. |
| `--color-border` | Quiet medium blue with enough contrast on glass surfaces. |
| `--color-text` | Blue-tinted near-white, based around `#eff6ff`. |
| `--color-text-muted` | Lighter desaturated blue for metadata and status. |
| `--color-accent` | `#f97316` family for primary action, focus, sent bubbles, and active state. |
| `--color-danger` | Accessible warm red distinct from orange action state. |
| `--radius-control` | Friendly medium radius, approximately Tailwind `rounded-lg`. |
| `--radius-card` | Larger radius, approximately `rounded-xl`. |
| `--radius-bubble` | Large bubble radius with ownership corner treatment. |

Exact contrast values must be tested before tokens are frozen.

Visual acceptance for the scaffold task:

- Review screenshots of onboarding/identity, allowed inbox, empty inbox, conversation, composer-with-keyboard, loading, and error states.
- Capture at Farcaster's approximately 424×695 web modal, a 390×844 mobile viewport, and one narrow 320px-wide stress viewport.
- Compare the background gradient, glass surfaces, orange action/sent bubble, blue received bubble, input focus ring, type hierarchy, and avatar geometry against the audited `converge.cv` source patterns.
- Pass automated contrast checks and manually inspect focus, disabled, error, and reduced-motion states.
- Require explicit screenshot approval before introducing a distinct new brand color or dominant visual motif.

### Layout

- One full-height column using dynamic viewport units with a fallback.
- Branded setup chrome followed by ready messaging screens that use only their compact contextual header, one flexible scrolling content region, and a composer pinned inside the app layout rather than the page body.
- Honor top/bottom safe areas and virtual-keyboard changes.
- Target Farcaster's documented web modal size of roughly 424×695 while scaling cleanly to mobile device dimensions.
- Message bubbles may use roughly 80–85% of the narrow viewport; `converge.cv`'s desktop-friendly 66% cap is too narrow here.
- No horizontal scrolling at supported widths.
- Body background should remain visually complete during overscroll.

### Components to define early

- App shell and header.
- Identity avatar/name/address row.
- Glass card.
- Primary and secondary buttons.
- Text input/search field.
- Empty, loading, error, and offline states.
- Conversation row.
- Message request row.
- Sent, received, failed, and unsupported message bubbles.
- Auto-growing composer.
- Toast/status banner.
- Modal/bottom sheet.
- Skeletons that match final geometry.

### Motion and feedback

- Keep transitions short and functional.
- Respect `prefers-reduced-motion`.
- Avoid animated background effects that increase load or distract from reading.
- Use haptics sparingly and only when the host advertises support.
- Never use color or motion as the only status signal.

### Copy style

- Plain language before protocol terms.
- Say “wallet signature,” “messaging inbox,” and “not a transaction” where relevant.
- Say “Farcaster profile” and “XMTP inbox” separately.
- Prefer “No connected XMTP identity found” over generic “Something went wrong” when that is the actual state.
- Do not say “anonymous,” “fully private,” or “secure” without qualifying what is protected.
- Keep onboarding to one short explanation and one primary action per state.

## Committed technical shape

This is the implementation target. Protocol surfaces that still require live-host proof remain explicitly marked as spikes or blockers.

### Frontend

- React + TypeScript + Vite.
- Tailwind or a small token-driven CSS layer matching `converge.cv`.
- `@farcaster/miniapp-sdk` and the official Farcaster wallet connector only where it reduces integration complexity.
- Current pinned `@xmtp/browser-sdk`, with documented Vite dependency exclusions for XMTP WASM bindings.
- Viem for typed EIP-1193 wallet/signer work.
- Minimal routing: inbox, conversation, compose, and privacy sheet state; avoid importing a large routing/provider tree until route semantics require it.
- Minimal state ownership around one active XMTP client. Do not mirror the whole XMTP database into a second client-side database without a proven need.

### Cloudflare application edge

- One Cloudflare Worker deployment with Static Assets for the SPA and first-party API routes.
- Pin a current reviewed `compatibility_date`, generate binding types from the actual Wrangler configuration, and keep preview/production bindings explicit.
- Keep GitHub Actions read-only. Cloudflare Workers Builds pulls `main` through the Cloudflare GitHub App, runs `npm run check`, and then runs `npx wrangler deploy`; never copy Cloudflare API tokens or account credentials into GitHub secrets.
- D1 only for structured server-side data that is genuinely required.
- Queue only if notification fan-out/retries justify asynchronous processing.
- Turnstile only on public abuse-prone endpoints where it works inside the Mini App flow; do not put it in front of normal authenticated messaging startup.
- No Durable Object in the MVP unless a specific coordination problem appears. XMTP, not a Durable Object, is the message system.
- Restrictive response headers: CSP, frame/embedding policy compatible with approved hosts, referrer policy, MIME sniffing protection, and permission policy.
- Verify those headers on the actual deployed HTML, JavaScript, WebAssembly, manifest, image, and API responses rather than assuming one Worker middleware covers every Static Assets path.
- Configure observability sampling and redaction explicitly; do not rely on provider defaults for request bodies, search inputs, tokens, or identifiers.

### First-party endpoints

| Method/path | Auth | Purpose | MVP status |
| --- | --- | --- | --- |
| `GET /.well-known/farcaster.json` | Public | Signed Mini App manifest. | P0 |
| `GET /api/health` | Public/minimal | Deployment health/version without sensitive dependency detail. | Deployed |
| `GET /api/me/ens` | Quick Auth | Discover the verified FID's forward-verified ENS primary-name candidate and return its saved preference. | Implemented locally |
| `PUT /api/me/ens-preference` | Quick Auth | Idempotently save `accepted` or `dismissed` for the verified FID. | Implemented locally |
| `DELETE /api/me` | Quick Auth | Delete the verified FID's saved ENS preference. | Implemented locally with menu control |
| `POST /api/resolve` | Quick Auth + rate limit | Resolve a bounded Farcaster search body to candidate verified identities without putting raw queries in URLs/history/referrers. | P1 |
| `POST /api/identity/link` | Quick Auth + proof | Store a verified FID/wallet/inbox mapping after a separately specified proof protocol. | P1 spike; do not implement yet |
| `POST /api/farcaster/webhook` | Signed event verification | Apply add/remove/notification token lifecycle. | P1 |
| `POST /api/xmtp-push-subscriptions` | Quick Auth + identity proof | Register/rotate encrypted XMTP topic/HMAC filtering material only after Browser SDK feasibility is proven. | P1 spike; blocked |
| `POST /api/notifications/test` | Admin-only | Verify notification plumbing without exposing an open sender. | P1 |

The implemented identity routes require the exact canonical hostname in production and the exact rendered host outside production, derive the FID only from a verified Quick Auth JWT subject, use prepared D1 statements, and return no-store responses. Auth and binding failures fail closed; unavailable Farcaster/ENS evidence returns no candidate and never authorizes an identity change. No endpoint accepts a wallet private key, XMTP private key, decrypted message, draft, message search query, or raw local database.

### Minimal D1 model

#### `ens_identity_preferences` (implemented locally)

- trusted positive `fid` primary key;
- `choice`, constrained to `accepted` or `dismissed`; and
- `updated_at` Unix timestamp.

There is no stored ENS name, wallet address, XMTP inbox/installation ID, Quick Auth token, profile record, or tombstone. The candidate is re-resolved when requested. `PUT /api/me/ens-preference` replaces the row idempotently and `DELETE /api/me` removes it.

Production and preview use separate `PREFERENCES` D1 databases and the same repository migration under `migrations/`.

### Planned D1 models (not created)

#### `identity_links` (P1 spike)

- trusted `fid`;
- normalized public wallet identifier;
- public XMTP inbox ID;
- proof method/version and verification timestamp;
- last successful client use; and
- no private key material.

The identity-link endpoint is intentionally gated on a separate protocol specification. That specification must define a server nonce/challenge, domain and FID binding, wallet signature format, EOA/SCW verification, XMTP environment and inbox binding, confirmation that the wallet appears in freshly fetched XMTP inbox state, expiry, one-time replay protection, account-change behavior, and verification tests before this table is created in production.

#### `notification_subscriptions` (P1)

- trusted `fid` and client identifier;
- exact notification URL;
- encrypted/token-protected notification token;
- active state and lifecycle timestamps; and
- last result/invalidated timestamp without notification content.

#### `notification_deliveries` (only if needed)

- privacy-safe idempotency key;
- subscription reference;
- status/attempt timestamps; and
- no message text or sender identity in general logs.

#### `xmtp_push_subscriptions` (P1 spike, only if Browser support is proven)

- trusted user/identity-link reference;
- opaque topic/subscription identifier;
- application-layer-encrypted HMAC filtering material;
- source installation and key-generation/version metadata;
- active/rotated/deleted lifecycle timestamps; and
- no message-decryption key or plaintext.

### Data retention

- The ENS accepted/dismissed choice lasts until the user replaces it or invokes the authenticated deletion route. It contains no resolved name/address or XMTP identity.
- Any future identity mapping lasts only while the user uses the service or until deletion.
- Invalid notification tokens are removed promptly.
- Rotated/disabled XMTP push topics and HMAC filtering material are deleted promptly and never retained in ordinary logs or backups beyond the documented recovery window.
- Delivery attempt data gets a short, documented retention window.
- Operational logs use shorter retention in production and redact tokens, JWTs, full addresses, inbox IDs, query contents, and message-related metadata.
- The repository must include a data inventory and deletion behavior before public launch.

## XMTP Gateway and fees release gate

**Current decentralized-mainnet status: Blocked pending an authenticated Browser SDK-to-Gateway proof.** The pinned SDK's legacy `production` environment has a built-in endpoint and can be used for current inbox/signature validation, but the app cannot be called launch-ready while the intended paid-network browser payer path is incomplete or unauthenticated.

Current official XMTP material describes an evolving payer model for decentralized-network traffic:

- apps/agents pay usage-based fees, currently estimated around $5 per 100,000 typical chat messages;
- browser/mobile apps are expected to use an app-hosted XMTP Gateway containing a funded payer wallet key;
- the reference Gateway is a long-running Go service using RPC and WebSocket dependencies, with optional Redis; and
- part of the client authentication integration is still marked **COMING SOON** in the official Gateway guide.

Therefore:

- Revalidate the exact requirements against the pinned Browser SDK immediately before the production architecture is chosen.
- Do not store a payer private key in frontend code, D1, or ordinary Worker environment variables used by broad application code.
- A plain request-driven Worker should not be assumed to replace the reference Go Gateway.
- Cloudflare Containers can run container images on the Workers Paid plan, but Gateway port/protocol, lifecycle, secret, outbound WebSocket, persistence, availability, and cost compatibility require a dedicated spike.
- A separate conventional container host remains a valid split architecture even if the SPA/API stays on Cloudflare.
- Add payer balance monitoring and an actionable `INSUFFICIENT_PAYER_BALANCE` failure state before paid messaging is enforced.

This is a P0 decentralized-mainnet release gate, not a reason to delay client UX and real-host testing on XMTP `dev` or legacy `production`.

## Security and privacy requirements

### Threats in scope

- malicious or spoofed Farcaster host context;
- stolen/replayed Quick Auth or notification tokens;
- forged webhook events;
- XSS reading the unencrypted OPFS message database;
- third-party scripts observing wallet or message activity;
- wallet-signature phishing/confusing prompts;
- identity mix-up after wallet/account changes;
- duplicate sends and replayed API operations;
- directory poisoning or mismatched FID/wallet resolution;
- notification metadata leaks;
- logs/crash tools capturing secrets or plaintext; and
- abuse of app-funded XMTP traffic or public resolution endpoints.

### Required controls

- Verify Quick Auth JWTs server-side against the exact domain.
- Verify Farcaster webhook signatures before any token lifecycle change.
- Prove FID-to-wallet/inbox links; do not trust client assertions alone.
- Apply per-user and per-IP rate limits to app-funded or directory endpoints.
- Use strict input schemas and bounded payload sizes.
- Use CSP without general `'unsafe-eval'`; permit the narrower `'wasm-unsafe-eval'` only where required for XMTP WebAssembly compilation, test it in every supported Farcaster WebView, and treat any host that requires full eval as an explicit security exception or unsupported host.
- Render message text as text, not HTML.
- Keep dependency count small and use lockfiles/reproducible installs.
- Redact secrets and user content by default in logs and error boundaries.
- Never include message previews or participant names in Farcaster notification bodies by default.
- Keep production/development XMTP environments and secrets strictly separate.
- Rotate webhook/API/payer credentials with a documented procedure.
- Add dependency, secret, and static security checks to CI.
- Publish a concise privacy disclosure that accurately describes local unencrypted storage and backend metadata.

### Explicit privacy boundary

The backend may know that a verified FID is associated with public wallet/XMTP identifiers and may hold a notification permission token. It must not know message plaintext, drafts, decrypted attachment data, or the user's private key. If a future feature breaks this boundary, it requires an explicit product/security decision and an update to this document before implementation.

## Accessibility requirements

- Meet WCAG 2.2 AA contrast for text and interactive states.
- Minimum 44×44 CSS pixel primary touch targets.
- Semantic buttons, headings, lists, dialogs, labels, and live regions.
- Visible keyboard focus distinct from hover and active state.
- Screen-reader labels for icon-only controls and message delivery states.
- Dialog focus trapping and return focus.
- Reduced-motion support.
- Text resizing without clipped header/composer or horizontal scrolling.
- Do not encode sent/received/error state by color alone.
- Announce new messages without repeatedly interrupting a screen-reader user.
- Test virtual keyboards, switch control basics, and at least VoiceOver/TalkBack core flows before launch.

## Performance and resilience targets

Initial targets are product budgets to validate during the scaffold spike:

- Branded shell should replace the host splash without waiting for XMTP/network initialization.
- Avoid loading directory, settings, and notification code on the initial inbox path.
- Show cached conversation state as soon as the OPFS client is available, then refresh in place.
- Measure XMTP WASM download/compile and OPFS startup separately from React render time.
- Avoid decorative large images/fonts on the chat path.
- Provide explicit timeouts and retry UI for auth, wallet, directory, sync, and send operations.
- Keep core reading useful during a transient network outage when local data exists.
- Do not claim offline sending; queueing semantics must be deliberately designed before they are shown.
- Preserve unsent drafts through transient errors and normal in-app navigation.
- Add a small build/version identifier to support reports from embedded hosts.

Concrete bundle and latency budgets should be set after measuring the current XMTP Browser SDK on target devices; an arbitrary budget that excludes the main WASM cost would be misleading.

## Observability without surveillance

### Useful events

- app shell ready;
- embedded versus standalone launch;
- Quick Auth success/failure category;
- wallet availability and EOA/SCW category without full address;
- XMTP client create/resume outcome;
- new versus reused installation;
- sync duration/outcome and stream reconnect category;
- recipient resolution/reachability outcome without raw query;
- send success/failure category and latency without content;
- storage/OPFS/install-limit failure category;
- notification subscription lifecycle; and
- build version/host/client family.

### Never collect

- message text, draft text, or unsupported-content payloads;
- private keys or signatures;
- Quick Auth JWTs or notification tokens;
- raw search queries;
- full wallet addresses/inbox IDs in ordinary analytics;
- conversation membership graphs; or
- local database contents.

Prefer aggregate operational metrics. Any product analytics provider must survive the same CSP/privacy review as application code; “no third-party analytics for MVP” is an acceptable default.

## Testing strategy

### Unit tests

- identity normalization and FID/wallet/inbox separation;
- Quick Auth signature, issuer, expiry, exact audience/domain, and invalid-FID failures;
- official Farcaster primary-address parsing plus ENS reverse/forward-match and provider-failure states;
- read-only active-address, same-inbox, different-inbox, and no-inbox classification;
- one-time ENS discovery under React Strict Mode, accepted/dismissed preference writes, and nonblocking failure;
- webhook verification/lifecycle transitions when P1 notifications exist;
- recipient resolution and stale-result cancellation;
- consent/list filtering;
- message deduplication and send/retry reducer;
- persisted unpublished-message publication and acknowledgement-loss behavior;
- URL/deep-link authorization;
- redaction helpers;
- feature/capability gates; and
- exact manifest/embed generation where generated.

### Integration tests

- EIP-1193 provider to XMTP EOA signer.
- Supported Farcaster smart wallet to XMTP SCW signer.
- create versus resume client against XMTP dev environment.
- initial sync, explicit history sync, live stream, reconnect, and teardown.
- OPFS lock/takeover behavior.
- accept/decline message request when the P1 request feature is implemented.
- reachable and unreachable recipient flows.
- Worker + D1 authenticated ENS preference and deletion path.
- signed Farcaster webhook and notification token invalidation when P1 notifications are implemented.

### Browser/end-to-end tests

- first-time setup, signature reject, retry, and success.
- returning user without a signature.
- empty inbox, allowed inbox, stale cached state, and requests when the P1 request feature is implemented.
- send success, offline failure, retry, and duplicate-tap protection.
- acknowledgement-loss retry that republishes the same local XMTP message identity exactly once.
- receive while at bottom and while reading older messages.
- unsupported message fallback.
- keyboard open/close, rotation, safe areas, and small web modal.
- deep link to allowed, nonexistent, and unauthorized conversation.
- standalone fallback.
- reduced motion, keyboard navigation, and basic screen-reader flow.

### Mandatory host/device feasibility matrix

Before deep implementation, test the smallest real XMTP client in:

| Host | Platform | Must prove |
| --- | --- | --- |
| Farcaster web/desktop | Current supported browsers | SDK ready/context, EIP-1193 signing, WASM, OPFS, close/reopen, single-tab guard. |
| Farcaster client | iOS current + one prior major version | Safe areas, keyboard, wallet EOA/SCW signing, OPFS persistence after app kill/relaunch, memory pressure. |
| Farcaster client | Android current + representative older device | Same as iOS plus WebView/WASM performance and back navigation. |
| Standalone browser | Safari, Chrome, Firefox where supported | Explicit fallback or graceful unsupported state; never silent data loss. |

Test both:

- an identity already registered with XMTP; and
- a wallet that has never created an XMTP inbox.

Also test storage deletion/eviction and an inbox near the active-installation limit using dedicated test identities, not a personal production inbox.

### Deployment checks

- typecheck, lint, unit/integration tests, and production build;
- clean working tree and reviewed staged diff;
- preview smoke test against XMTP dev/test environment;
- production manifest and embed validators;
- security headers and HTTPS redirect;
- exact-domain notification target test when enabled;
- D1 migration dry run and backup/rollback notes;
- secret/binding inventory;
- health check and redacted logs;
- deployed asset/version verification; and
- commit and push before moving to the next task.

## Delivery plan and task checkpoints

Each numbered task is a coherent verify/commit/push boundary. If a task grows beyond one reviewable concern, split and push its slices rather than saving a large mixed commit.

### Task 0a: repository and operating guide (complete)

Deliverables:

- local Git repository and GitHub remote;
- `AGENTS.md` operating guide; and
- first pushed checkpoint.

Exit criteria:

- repository exists remotely with the chosen visibility and HTTPS-backed GitHub workflow;
- operating instructions require a verified push after each task.

### Task 0b: product plan and feasibility inventory — complete 2026-07-14

Deliverables:

- this `features.md` living specification;
- official-source constraints and open decisions; and
- no product code.

Exit criteria:

- authoritative P0 scope, release gates, and first spikes are explicit;
- document passes whitespace/structure review and is pushed; and
- user can correct the product direction before scaffolding.

### Task 0c: user product decision checkpoint — complete 2026-07-14

Recorded decisions:

- use the host-wallet-backed XMTP identity;
- use “Converge Mini” as the working name and `https://miniapp.converge.cv` as the canonical origin;
- use address-first compose for P0 while handle search remains P1; and
- deploy the SPA and first-party API on Cloudflare Workers, while keeping the evolving XMTP payer Gateway behind a replaceable boundary.

Exit criteria:

- the primary identity is no longer Proposed;
- the canonical hostname is recorded; and
- the revised decision/spec checkpoint is committed and pushed before runtime work.

### Task 1: runtime feasibility spike

Deliverables:

- minimal Farcaster SDK shell;
- host EVM provider inspection;
- minimal XMTP Browser SDK client on dev environment;
- EOA and SCW signing experiments;
- OPFS resume and second-tab behavior;
- canonical hostname supplied by Task 0c is used in the test plan;
- pinned Browser SDK inspection for payer-Gateway address and authentication support;
- reference Gateway protocol/port/lifecycle fit against Cloudflare Containers and one external container baseline;
- written device/host results; and
- refreshed architecture recommendation.

Exit criteria:

- the enumerated host SDK, wallet signer, OPFS resume, second-connection, and payer-Gateway questions each have evidence or a clearly documented blocker;
- the plan records whether production messaging is currently implementable or remains blocked by missing Browser SDK Gateway authentication;
- no accidental production identity/install exhaustion; and
- exact pinned SDK versions are recorded.

### Task 1b: hosting decision checkpoint — complete 2026-07-14

Use Cloudflare Workers Static Assets plus a Worker API for the application at `miniapp.converge.cv`. Compare Cloudflare Containers with an external container host for the XMTP payer Gateway only after the pinned client proves the required authentication path. Preserve Vercel as a later fallback comparison rather than blocking the frontend/API build.

Exit criteria:

- Cloudflare is selected for the application runtime and static assets;
- the XMTP Gateway runtime remains an explicit, separately measured decision;
- Task 2 names Cloudflare and records verified deployment commands; and
- the hosting decision is committed and pushed.

### Task 2: application and verification scaffold — complete

Implemented locally on 2026-07-14 and deployed on 2026-07-15:

- React 19, strict TypeScript, Vite, and the Cloudflare Vite plugin;
- a Cloudflare Worker with a tested `/api/health` endpoint and bounded API 404 behavior;
- current generated Worker runtime types, `wrangler.jsonc`, preview/production scripts, and the `miniapp.converge.cv` custom-domain target;
- ESLint, Vitest/Testing Library, a production build, and GitHub Actions CI; and
- a verified production-shaped local preview serving both the SPA and Worker API.

The scaffold is live. The first Cloudflare Workers Builds production run pulled and deployed exact commit `87a94baa4d0079e5f59fbfdaec2afee66fd38d4c`; GitHub Actions remains the independent read-only verification path.

Deliverables:

- React/TypeScript/Vite app plus Cloudflare's Vite plugin and Worker runtime;
- early shell deployment on the canonical hostname so all later persistence tests use the final origin;
- automated typecheck/lint/test/build; and
- CI checkpoint.

Exit criteria:

- empty production build and selected-provider local preview pass with pinned tool versions;
- verified commands are added to `AGENTS.md`.

### Task 3: visual shell and Mini App lifecycle — in progress

Implemented locally on 2026-07-14:

- the current Farcaster Mini App detection, context, capability, and `ready()` lifecycle using `@farcaster/miniapp-sdk@0.3.0`;
- an honest standalone state that does not silently introduce a different wallet or XMTP identity;
- host safe-area variables, Visual Viewport keyboard tracking, reduced-motion handling, visible focus, and narrow-screen layout constraints;
- the canonical Converge blue/orange token system, compact glass shell, identity presentation, loading/error states, and capability explanation;
- initial `fc:miniapp` plus legacy `fc:frame` embed metadata; and
- deterministic SVG sources and generated PNG icon, splash, embed, and Open Graph assets, visually inspected after generation.

Extended locally on 2026-07-14:

- capability-gated Farcaster host back is shown only for the New DM and conversation views, owns no duplicate browser-history adapter, and is hidden with its callback cleared on teardown;
- the visible in-app arrow remains intentionally available as a reliable accessibility and host-failure fallback;
- visible `visibilitychange`, `focus`, `pageshow`, and `online` recovery paths coalesce, while hidden documents defer network work until foreground; and
- foreground recovery re-reads wallet account and chain without prompting, tears down a mismatched XMTP identity, and prevents a pending DM creation from reopening after the user navigates back.

Compact ready-messaging extension implemented and locally verified on 2026-07-15:

- once the inbox is ready, the inbox, New DM, and conversation screens use the available viewport directly instead of retaining the global Converge header and encryption footer around their own navigation;
- onboarding, standalone, loading, and terminal setup states keep the branded shell context;
- host and CSS safe-area insets remain honored when the ready messaging chrome is compacted;
- the best-effort local-history warning has one accessible dismiss action remembered on that browser until site data is cleared; and
- detailed local-storage and history-recovery disclosure remains available from the identity/privacy menu after the compact warning is dismissed.

Automated coverage now includes a true 390 × 844 Playwright device viewport assertion with no horizontal overflow. Remaining in Task 3: the inbox/chat/composer states supplied by Tasks 5 and 6 and an embedded-host screenshot on the canonical domain.

Deliverables:

- tokenized Converge-derived theme;
- shell, header, cards, controls, state components, and composer visual states;
- standalone fallback and Mini App detection/`ready()` lifecycle; and
- screenshot/contrast review at the specified viewports.

Exit criteria:

- shell passes embedded-size, keyboard, safe-area, reduced-motion, and focus smoke tests;
- visual acceptance checklist is reviewed; and
- no mock messaging behavior is presented as functional.

### Task 4: host wallet and XMTP identity — implemented locally, host proof pending

Implemented on 2026-07-14:

- dynamic Farcaster host-provider acquisition with no generated-key fallback;
- checksummed wallet identity, chain and contract-code inspection, and EOA/SCW signer construction;
- one origin-wide Web Lock held through XMTP Worker shutdown, with explicit second-window and restart-required states;
- teardown on account, chain, provider-disconnect, and foreground read-only identity mismatch; and
- phased wallet/XMTP/sync explanations plus local-storage disclosure.

Extended locally on 2026-07-14:

- secure-context, Worker, WebAssembly, Web Locks, and OPFS availability are verified before wallet access, while denied persistence continues with a locally dismissible best-effort warning and durable disclosure in the identity/privacy menu;
- XMTP client initialization is bounded to 30 seconds; a timed-out or otherwise unreachable hidden Worker retains the origin lease and requires reload, while any late-returned Client is closed;
- stream teardown always terminates the Client Worker before the caller releases the OPFS lease, even if SDK stream cleanup rejects or never settles; and
- nested/structured-clone-shaped SDK errors are reduced to curated wallet, network, storage, installation-limit, and permanent inbox-update states without returning raw WASM messages, paths, or inbox IDs to the UI.

Extended locally on 2026-07-15:

- embedded startup automatically opens XMTP with the Farcaster host's preferred EVM account after capability detection, without an app-level wallet/key/inbox choice;
- React Strict Mode replay cancels the scheduled first setup before wallet access and produces one live host-wallet/session attempt; and
- rejection and terminal safety states do not auto-loop, while an explicit retry remains available where retrying is safe;
- after the inbox is ready, an exact-domain Quick Auth call derives the trusted FID and discovers its official Farcaster primary Ethereum address plus a reverse/forward-verified ENS primary name;
- the active XMTP client checks that public address without an inbox update, and the one-time offer appears only when it is the active address or already in the same inbox;
- D1 remembers `accepted` or `dismissed` account-wide, a browser-local dismissal hint avoids repeat background Quick Auth on the same device, the compact identity/privacy menu keeps the option available, and failed writes leave the choice visible; and
- acceptance changes only the inbox label, while different-inbox, no-inbox, and unavailable states explain the boundary and never merge, migrate, add, or remove an XMTP identity.

Connection hotfix implemented and locally verified on 2026-07-15:

- the pinned SDK's legacy `production` environment can initialize without a custom Gateway, reach `Client.create()`, and continue to `client.register()`, where XMTP can request the required host-wallet signatures;
- `mainnet` and every decentralized testnet still stop before `Client.create()` unless a non-empty Gateway hostname is configured;
- a missing required Gateway is presented as a non-retryable application configuration problem rather than the generic "The inbox did not open" state; and
- unit coverage distinguishes legacy `local`/`dev`/`production` behavior from decentralized-network behavior so a build-time guard cannot silently block signatures again.

The pinned Browser SDK still requires a document restart if its internal Worker fails during `Client.init()` before returning a closable Client. Registration itself is app-owned and closes safely on wallet rejection. Real desktop/iOS/Android signatures, OPFS re-entry, SCW continuity, storage eviction, and near-limit inbox cases remain required evidence; origin-only code cannot deterministically distinguish a first visit from complete site-data eviction.

Deliverables:

- host wallet connection;
- XMTP signer/create/resume state machine;
- identity presentation and signature explanations;
- optional verified ENS label, remembered preference, and identity-menu re-entry;
- OPFS single-connection guard;
- identity-change teardown; and
- storage/installation error states.

Exit criteria:

- first and returning flows work on target hosts;
- existing installations resume without new XMTP wallet signatures; optional post-inbox Quick Auth may still require a Farcaster sign-in approval when no current token or local dismissal exists; and
- no server/log path sees private keys or message content.

### Task 5: allowed inbox and live receive — implemented locally, network proof pending

Implemented on 2026-07-14:

- allowed-only DM sync, latest-activity list, identity fallback, empty/error/refresh states, and latest 50-message read view;
- allowed-DM live stream, stable-ID upsert, stream health display, foreground inbox refresh, and stale-session callback guards;
- unsupported-content fallback, newest-page chronological display, near-bottom scroll preservation, and screen-reader log semantics; and
- behavioral tests for newest-page order and persisted unpublished-draft recovery.

Extended locally on 2026-07-14:

- cached inbox rows and cached conversation messages render before network sync, remain visible on transient sync failure, and are replaced in place after successful sync;
- a newly registered Mini App installation explicitly calls `sendSyncRequest()` with honest best-effort recovery copy;
- older-message loading expands a contiguous newest-message window, uses exact-nanosecond chronological ordering, deduplicates stable IDs, and preserves the reader's anchor without trusting a sent-time cursor that late history imports could skip;
- the active conversation and inbox resync on foreground/online, while one retained SDK proxy owns retry/restart behavior and explicit refresh plus callback-generation guards prevent duplicate or stale stream work; and
- initial history is excluded from live-region announcements, incoming messages do not steal scroll position, and a “New messages” affordance returns intentionally to the latest message.

Canonical-host persistence, storage eviction, cancellable SDK retry timers/terminal-state signaling, embedded keyboard resize, and two-client dev-network receive evidence remain. Browser SDK 7 exposes neither insertion timestamps on decoded messages nor an archive-import completion event, so history loading can remain honest and gap-safe through a growing contiguous window but cannot claim an immutable insertion-time snapshot.

Deliverables:

- sync/list/stream lifecycle;
- allowed conversation list and text history;
- scroll and incoming-message behavior;
- unsupported-content fallback; and
- relevant automated tests.

Exit criteria:

- conversations created or received after the test installation is established match the reference XMTP client; older cross-installation history is evaluated separately as best-effort;
- foreground/resume sync and live receive pass without duplicate rows; and
- identity switching never displays another identity's cached content.

### Task 6: address-first compose and text send — implemented locally, network proof pending

Implemented on 2026-07-14:

- normalized Ethereum address validation, self-address rejection, XMTP reachability, existing-DM reuse, and synchronous duplicate-create guards;
- auto-growing text composer, Enter/Shift+Enter handling, mobile focus-preserving send control, and duplicate-send guards at component and transport boundaries;
- persisted optimistic send, stable message-ID upsert, batch-publication acknowledgement handling, and per-ID retry guards; and
- honest recovery semantics: `Unpublished` drafts reload as retryable with the same ID, while Browser SDK 7 `Failed` records are terminal because the high-level wrapper does not expose targeted `publishStoredMessage(id)`.

Two-client dev-network exchange, acknowledgement-loss, offline retry, reachability-network-error, and 100-message deduplication evidence remain.

Deliverables:

- normalized Ethereum address input;
- XMTP `canMessage()` gate;
- existing-DM deduplication;
- text composer; and
- send/deduplicate/failure/retry behavior.

Exit criteria:

- two independent test identities exchange a 100-message automated sequence on XMTP dev/test with each message rendered exactly once;
- reachable, unreachable, self, invalid-address, and network-error states are distinct; and
- duplicate tap, offline retry, and acknowledgement-loss suites produce zero duplicate messages while reusing the same persisted local message identity.

### Task 7: production publishing and Gateway proof

Implemented locally on 2026-07-14:

- a schema-tested dynamic `/.well-known/farcaster.json` with canonical metadata and fail-closed account-association configuration;
- a fetchable, no-store metadata-only bootstrap manifest when ownership is absent, with no `accountAssociation` and `noindex: true`; partial, malformed, and wrong-domain association configuration still fails closed;
- opaque account-association signatures are preserved exactly as returned by Farcaster while the signed payload is decoded to enforce the exact canonical domain;
- current root `fc:miniapp` and compatibility `fc:frame` embeds plus opaque, dimension-tested PNG assets;
- static/Worker security headers, immutable hashed-asset caching, preview `noindex`, and explicit Worker-first API/manifest routing;
- Cloudflare version metadata in the tested health response; and
- operator, rollback, security, and privacy/data-inventory documentation.

The Worker and canonical Custom Domain are deployed. On 2026-07-15 the exact-domain Farcaster account association was installed as Cloudflare Worker secrets and Farcaster's public debugger passed schema, signature, FID ownership, and domain validation. The canonical client uses the pinned SDK's legacy `production` environment while decentralized `mainnet` remains separately gated. Remaining: complete real-host launch and embed acceptance, deliberately enable discovery only when launch-ready, and complete the payer-Gateway proof below.

Deliverables:

- Cloudflare Worker Static Assets deployment with the first-party Worker API;
- canonical-domain headers and final routing;
- signed manifest and share assets;
- operator docs, minimal redacted observability, and rollback notes;
- Farcaster validation/discovery readiness; and
- authenticated XMTP Gateway/payer deployment or an explicit production blocker report.

Exit criteria:

- production domain launches in Farcaster and manifest/embed audits pass;
- deployment is reproducible from the repository;
- all P0 privacy/security/reliability gates pass; and
- Gateway selection, authentication, per-user quota enforcement, balance failure, and one funded production send are proven with the pinned Browser SDK rather than inferred from stale docs.

### Task 8: trusted Farcaster directory search (optional P1)

Reusable substrate implemented locally for the Task 4 ENS preference flow: exact-domain Quick Auth verification and a bounded official Farcaster primary-address lookup. General handle/name search, caching, rate limits, and recipient selection remain optional P1 work and must not reuse the ENS label flow as an unproven messaging destination.

Deliverables:

- reuse the verified Quick Auth boundary;
- selected Farcaster directory integration;
- handle/name search and verified identity resolution;
- privacy/rate-limit controls; and
- D1 only if a named cache/link flow requires it.

Exit criteria:

- valid, ambiguous, unreachable, invalid, stale, and provider-error results are distinct;
- server rejects wrong-domain/expired auth and, if identity links are implemented, replayed identity-link proofs; and
- untrusted profile data cannot redirect a message to the wrong identity.

### Task 9: message requests (optional P1)

Deliverables:

- separate request list;
- accept and decline consent actions; and
- request-specific empty, loading, failure, and abuse-safety states.

Exit criteria:

- unknown conversations never enter the allowed list before acceptance;
- accept/decline state agrees with a reference XMTP client after resync.

### Task 10: notification permission and delivery (optional P1)

Deliverables:

- add/enable UX;
- verified Farcaster webhook;
- secure token lifecycle;
- generic test notification;
- incoming-XMTP bridge only if the dedicated spike succeeds; and
- delivery/rate-limit/disable tests.

Exit criteria:

- disabling/removing stops delivery;
- target domain and idempotency rules are correct;
- notification content leaks no private message or participant data.

## Later feature backlog

These features should be reconsidered only after P0 quality and usage justify them.

| Feature | Priority | Status | Reconsider when |
| --- | --- | --- | --- |
| Farcaster notifications for incoming XMTP messages | P1 | Spike | A privacy-safe closed-client observer is proven. |
| Generic app sharing/compose action | P1 | Later | Root embed and core retention are stable. |
| Expanded identity/privacy settings sheet | P1 | Later | The compact menu and ENS-choice deletion are shipped locally; add trusted profile/inbox details and future account-data controls when needed. |
| Read receipts | P2 | Later | Consent, cross-client semantics, and network cost are acceptable. |
| Reactions and replies | P2 | Later | Unsupported fallback and text DMs are robust. |
| Image/file attachments | P2 | Later | Encryption, off-network storage, consent, moderation, CSP, and cost are designed. |
| Group conversations | P2 | Later | DMs prove demand and installation/member semantics are well understood. |
| Group invite links | P2 | Later | Groups and safe public deep links exist. |
| Typing indicators | P2 | Later | Message costs and privacy justify ephemeral traffic. |
| Full-text local search | P2 | Later | A safe local index/storage design exists. |
| Multiple wallet identities per inbox | P2 | Later | Real users need it and recovery/update limits are addressed. |
| Merge or migrate two existing XMTP inboxes | P2 | Blocked | XMTP exposes no safe inbox/history merge; reconsider only if protocol semantics and both signer proofs make the result explicit and portable. |
| Installation management UI | P1 | Later | Error-only recovery is insufficient. |
| History backup/recovery UX | P2 | Later | Current XMTP history-sync model is stable and understandable. |
| Block/mute/report controls | P2 | Later | Abuse model and XMTP semantics are defined; decline remains available now. |
| Dedicated desktop layout | P2 | Out | Embedded mobile-first usage proves a real desktop need. |
| PWA/service-worker install | P2 | Out | Standalone demand justifies a second lifecycle/push model. |
| Multi-inbox switching | P2 | Out | Product explicitly expands beyond simple wallet-backed use. |
| Raw key import/export | P2 | Out | A separate custody/recovery security design is approved. |
| Onchain transaction actions | — | Out | The product direction changes beyond focused messaging. |

## Success measures

### Activation

- Proposed beta target: at least 90% of sessions on the explicitly supported host/version matrix reach a readable inbox or honest empty state, excluding intentional wallet rejection.
- Returning-installation test: 20 of 20 ordinary close/reopen cycles per supported host require zero new XMTP wallet signatures and retain the same installation ID; Quick Auth approval behavior is recorded separately.
- First XMTP setup uses no signatures beyond those required by the pinned XMTP signer flow. Optional post-inbox Quick Auth approval is measured separately and never blocks the inbox or introduces a wallet/key/inbox choice.
- Every wallet rejection, chain mismatch, provider disconnect, and unsupported-wallet fixture reaches its named recovery state rather than a generic spinner.

### Messaging quality

- The two-identity development-network test sends 100 messages and renders each stable XMTP message ID exactly once on both clients.
- The automated double-tap, offline-retry, and acknowledgement-loss suite produces zero duplicate sends across 100 iterations and verifies that retries publish the same local message identity.
- Each supported host passes ten background/foreground and ten forced-stream-reconnect scenarios without manual reload or missed test messages.
- Seeded allowed conversations match the current reference XMTP client for the same test identity after sync.

### Continuity

- The same host/origin reuses the same installation ID for the full close/reopen matrix unless site data is intentionally cleared.
- A canary records any unexpected installation change as a release-blocking diagnostic event without logging the full inbox/installation identifier.
- Storage-unavailable, storage-cleared, and installation-limit fixtures each stop safely in a named recovery state and never auto-revoke another installation.

### Privacy and operations

- Automated canary strings representing private keys, message plaintext, drafts, signatures, auth tokens, and notification tokens produce zero matches in captured client/server logs and analytics payloads.
- Server-side user data is limited to the documented inventory and is deletable.
- Production manifest, embeds, health, and deployment version are continuously verifiable.
- The app can be operated without undocumented manual fixes.

## Release gates

The first public release is blocked until all are true:

- Farcaster desktop, iOS, and Android hosts can load the XMTP WASM/OPFS client reliably.
- EOA and the actual Farcaster smart-wallet path can create/resume/sign with the current XMTP SDK, or unsupported cases are explicitly gated.
- Same-origin OPFS survives ordinary host re-entry and second-connection handling is safe.
- An existing XMTP identity resumes without consuming a new installation in the normal path.
- Allowed conversations, sync, stream, send, failure, and retry pass end-to-end tests.
- Message-request consent tests pass if that P1 feature is included in the release.
- Quick Auth trust-boundary, ENS forward-verification, exact-host API, D1 preference, and deletion tests pass.
- Farcaster webhook signature and token-lifecycle tests pass if notifications are included in the release.
- No backend/log/analytics path receives private keys or message plaintext.
- Production domain, account association, manifest, embeds, assets, and headers pass validation.
- The current XMTP payer/Gateway requirement and deployment are confirmed with a real send on the intended production network.
- Payer balance/failure monitoring exists if fees are active.
- Accessibility and mobile keyboard/safe-area checks pass on representative devices.
- Data inventory, retention, deletion, privacy disclosure, operations, and rollback docs exist.

Notifications for incoming XMTP messages are not a gate unless they are explicitly promoted into the first-release scope.

## Key risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Farcaster webview does not reliably preserve OPFS | Re-signatures, lost local history, installation exhaustion | Run host/device spike first; monitor new installs; provide recovery; reconsider Browser SDK delivery surface if persistence is unacceptable. |
| Browser DB is unencrypted | XSS/local-device compromise can expose decrypted content | Strict CSP, minimal dependencies/scripts, no HTML rendering, clear disclosure, security review. |
| XMTP Browser SDK permits one connection | Multiple tabs/host instances can fail or corrupt access | Browser lock, explicit takeover/close behavior, lifecycle tests. |
| Farcaster wallet is an unsupported/misdetected SCW | Setup/signatures fail | Test real hosts/accounts; detect code/chain correctly; capability-gate unsupported cases. |
| FID/profile is confused with XMTP identity | Messages go to wrong/unreachable address | Trusted resolution, clear identity UI, `canMessage()` before creation, proof before caching links. |
| Host context is trusted as auth | Account spoofing/backend data exposure | Quick Auth verification on server; context only for provisional display. |
| ENS name is mistaken for a migrated XMTP identity | User expects another inbox or history to appear | Offer only an active/same-inbox label; classify the address read-only; explain different/no-inbox states; never mutate or describe a merge. |
| ENS/Farcaster discovery is unavailable or inconsistent | Optional prompt fails or presents a spoofed name | Require trusted FID, official primary address, reverse-plus-forward ENS match, no-store responses, provider failover, and nonblocking failure. |
| Storage clearing creates installations | Ten-installation and 256-update limits are consumed | Persist/reuse DB, detect storage loss, never revoke automatically, recovery tooling and dedicated test wallets. |
| Same wallet is mistaken for guaranteed history recovery | New Mini App installation appears empty or misleads the user | Separate same-origin resume from cross-install history sync; require another compatible installation online; label recovery best-effort and disclose the re-encrypted history service. |
| Incoming notification bridge is not viable in Workers/Browser SDK | Closed-app message notifications unavailable | Keep P1 spike; generic notifications only; separate observer/container architecture if proven. |
| XMTP payer/Gateway docs or SDK are in transition | Production sends fail or infrastructure is mischosen | Pin versions, revalidate before release, prove real test/mainnet flow, keep container host option open. |
| App-funded traffic is abused | Unexpected fees/outage | Trusted auth, gateway authorization, per-user limits, balance alerts, kill switch. |
| `miniapp.converge.cv` changes | Manifest identity, OPFS, tokens, and embeds break | Treat the selected hostname as durable; document any migration; avoid casual hostname changes. |
| Feature creep from `converge.cv` | Mini App becomes slow and difficult to operate | Keep non-goals and Later table visible; require product decision to promote scope. |

## Open product and architecture decisions

These are deliberately not guessed into existence.

1. **P1 recipient discovery:** When handle/name search is promoted, should it use official Farcaster infrastructure, Neynar, or another verified directory source?
2. **Deep-link behavior:** Which future intent schema should open a specific conversation rather than the default allowed inbox?
3. **Message requests:** Keep request accept/decline as post-core P1, or explicitly promote it after real-user inbox testing?
4. **Notifications:** Should add/notification permission be the next milestone after messaging, or wait for a proven closed-app XMTP observer?
5. **Brand separation:** How closely should the final icon/name relate to `converge.cv` while remaining recognizable as a distinct Mini App?
6. **Public standalone mode:** After development fallback is stable, should non-Farcaster visitors be able to connect a wallet and message?
7. **Directory/backend dependency:** Is a managed Farcaster data provider acceptable if it materially simplifies reliable handle search and webhook verification?
8. **Gateway hosting split:** After the feasibility spike, compare Cloudflare Containers and an external container host for the XMTP payer Gateway.
9. **Future ENS signer flow:** If users must target an ENS-controlled recovery identity before first XMTP registration, how will the app obtain that address's signer and present the irreversible identity choice without reintroducing a key/wallet picker? This is not an existing-inbox merge.

## Cloudflare versus Vercel comparison criteria for later

The application host is selected. A later re-evaluation should compare the same concrete workload:

- static Vite/WASM asset caching and response headers;
- edge Quick Auth JWT verification;
- signed Farcaster webhook handling;
- relational token/identity storage and migrations;
- queues/retries for notifications;
- rate limiting and abuse controls;
- logs, metrics, secrets, preview environments, and rollbacks;
- custom-domain/manifest stability;
- XMTP Gateway container compatibility and always-available behavior;
- operational complexity for one maintainer; and
- expected low-volume and scaled cost.

Avoid choosing based only on frontend deploy ergonomics; the evolving XMTP Gateway is likely the differentiating runtime constraint.

## Source notes

Current integration facts in this plan were checked through 2026-07-15 against primary documentation:

- [Farcaster Mini Apps getting started](https://miniapps.farcaster.xyz/docs/getting-started)
- [Farcaster Mini App specification](https://miniapps.farcaster.xyz/docs/specification)
- [Farcaster publishing guide](https://miniapps.farcaster.xyz/docs/guides/publishing)
- [Farcaster sharing guide](https://miniapps.farcaster.xyz/docs/guides/sharing)
- [Farcaster wallet integration](https://miniapps.farcaster.xyz/docs/guides/wallets)
- [Farcaster Quick Auth](https://miniapps.farcaster.xyz/docs/sdk/quick-auth)
- [Farcaster authentication guide](https://miniapps.farcaster.xyz/docs/guides/auth)
- [Farcaster Mini App context](https://miniapps.farcaster.xyz/docs/sdk/context)
- [Farcaster notifications](https://miniapps.farcaster.xyz/docs/guides/notifications)
- [XMTP Browser SDK](https://docs.xmtp.org/chat-apps/sdks/browser)
- [XMTP Browser SDK official repository notes](https://github.com/xmtp/xmtp-js/tree/main/sdks/browser-sdk)
- [XMTP signer creation](https://docs.xmtp.org/chat-apps/core-messaging/create-a-signer)
- [XMTP client creation and browser storage warning](https://docs.xmtp.org/chat-apps/core-messaging/create-a-client)
- [XMTP inbox identity management](https://docs.xmtp.org/chat-apps/core-messaging/manage-inboxes)
- [ENS primary-name and forward-verification guidance](https://docs.ens.domains/web/reverse/)
- [XMTP inboxes, identities, and installations](https://docs.xmtp.org/chat-apps/core-messaging/manage-inboxes)
- [XMTP history sync](https://docs.xmtp.org/chat-apps/list-stream-sync/history-sync)
- [XMTP optimistic message sending](https://docs.xmtp.org/chat-apps/core-messaging/send-messages)
- [XMTP push notification model](https://docs.xmtp.org/chat-apps/push-notifs/understand-push-notifs)
- [XMTP fees](https://docs.xmtp.org/fund-agents-apps/calculate-fees)
- [XMTP Gateway Service](https://docs.xmtp.org/fund-agents-apps/run-gateway)
- [XMTP Gateway-capable SDK update](https://docs.xmtp.org/fund-agents-apps/update-sdk)
- [XMTP decentralized-network funding setup](https://docs.xmtp.org/fund-agents-apps/get-started)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare storage options](https://developers.cloudflare.com/workers/platform/storage-options/)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [Content Security Policy WebAssembly integration](https://www.w3.org/TR/CSP3/#wasm-integration)

SDK, network, payment, host-client, and platform behavior can drift. Recheck these sources when each integration task begins rather than relying only on this snapshot.
