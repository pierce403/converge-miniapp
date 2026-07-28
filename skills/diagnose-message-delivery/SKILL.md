---
name: diagnose-message-delivery
description: Trace Converge Mini open-app XMTP receive failures and closed-app Farcaster alert failures across the browser, current inbox assignment, welcome/topic routes, vapid.party listener and queue, Mini callback, and Farcaster provider. Use when messages or alerts are missing, delayed, stale after inbox migration, or returning notification 425/503-style errors.
---

# Diagnose Message Delivery

Find the earliest unproven or failing boundary. Do not blame a downstream
service merely because it is the most visible component.

## Classify the symptom

- **Open-app receive:** the Mini must mount the inbox currently assigned to the
  Farcaster identity, synchronize XMTP history, and refresh from stream hints.
  Farcaster tokens and vapid.party are not on this path.
- **Closed-app alert:** the XMTP message remains authoritative; the alert is a
  best-effort wake hint through the separately enrolled notification bridge.
- **Both:** diagnose open-app identity/sync first, then the alert bridge. A
  successful route registration does not prove an XMTP receive or native
  display.

Establish whether the host was foregrounded, backgrounded, or closed at send
time. An absent native alert while the Mini was already open is not by itself a
closed-app-alert failure.

## Evidence ladder

Proceed in order and mark each boundary proven, failed, or unknown:

1. Confirm the canonical origin, `/api/health` deployment version, active
   document/bundle freshness, network environment, and whether the test message
   was sent after the latest route refresh. A stale already-open bundle is a
   separate branch; do not reload it during read-only diagnosis without
   approval.
2. Resolve the Farcaster wallet's current inbox from the XMTP network and
   compare it with the mounted client's validated inbox. Record only
   `current assignment matches mounted client: yes/no`; replacing a stale client
   is a later authorized repair.
3. Prove local client readiness, explicit sync/history outcome, conversation
   discovery and visibility state, and the sequence
   `stream hint -> guarded refresh -> UI update`. Seeing the message in another
   XMTP client proves only that installation's retrieval. `Allowed` and
   `Unknown` DMs and active groups are display/alert eligible in Mini; `Denied`,
   inactive groups, missing recovered history, Convos-specific classification,
   and installation welcome delivery are distinct branches. An unverified
   Convos candidate can still appear as an ordinary **XMTP group**, but it must
   never satisfy the signed invite flow. If an authorized manual sync alone
   reveals it, investigate stream/drain handling.
4. For the alert branch, use `GET /api/notifications/status` only as a public
   structural-readiness boolean. Separately prove aggregate counts for an
   encrypted signed lifecycle token and active opaque route without returning
   their identifiers.
5. Check the browser's current installation proof and bounded
   welcome/topic/HMAC snapshot enrollment. Require one installation-matched
   welcome topic even when there are no known conversations, plus only booleans
   for current-installation and target conversation membership. A new
   conversation should match the welcome route; normal topic registration is
   not retroactive. Sending a fresh post-refresh message is an authorized active
   test, not a read-only check.
6. Prove vapid.party's redacted `delivery ready`, `listener ready`, and
   `bridge synced` health states, registration freshness, and target-membership
   boolean without returning the underlying topic, HMAC, inbox, installation,
   or opaque handle.
7. In an authorized isolated test window, use aggregate counter deltas or a
   server-produced correlation boolean to prove listener match, queue attempt,
   signed Mini callback outcome, and replay/lease category. Do not copy the
   stored correlation identifiers into diagnostic output or artifacts.
8. Check the exact allowlisted Farcaster notification-provider response and
   token invalidation/rate-limit category, then verify actual device display.
   Provider acceptance does not prove display; check Farcaster client and OS
   notification settings and require one visible generic alert whose tap opens
   the canonical root.

The earliest missing transition is the working diagnosis. State what has been
proven, what remains unknown, and the smallest safe test or instrumentation
change that distinguishes the remaining hypotheses.

## Safety and mutation boundary

- Start with read-only inspection. Implement or deploy a fix only when the
  request authorizes it.
- Reloads, manual sync, registration refresh, test sends, client replacement,
  toggles, and browser permission prompts are active tests or mutations and
  require authorization.
- Use sampled or aggregate redacted evidence. Never copy the following into
  diagnostic output or artifacts: message content/ciphertext, notification
  URLs/tokens, wallet or sender identity, FIDs,
  inbox/installation/conversation IDs, topics, HMAC keys, opaque handles,
  delivery IDs, signatures, tickets, receipts, cookies, or raw D1/log exports.
- Keep Mini and `../vapid.party` evidence separate and identify which repository
  owns a fix.
- Use the user's external authenticated browser only when the user grants
  control for host interaction; warn before prompts or state changes. Do not
  assume credentials exist in Codex's embedded browser.
- Re-test with a fresh post-registration message and distinguish enrollment,
  callback acceptance, provider acceptance, and visible alert display.
