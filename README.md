# Closer

## Private entries and journal

Wild & Unspoken entries and Date Night Journal notes are saved in this browser's local storage. Wild & Unspoken entries are hidden until the user chooses to reveal them on-screen. Local storage is not encrypted, so anyone with access to the same browser profile or device may be able to read it. Removing site data or resetting local storage deletes these entries.

Deck filters, game mode, turn-taking, shuffle, and custom question controls are available in Settings rather than on the main question screen.

Custom cards can stay in the creator's local deck, be explicitly shared to the paired room, or be published to the Global Deck. Device-only cards are not copied into the partner's saved deck, but the paired room syncs the currently active card. Cards explicitly shared by a partner are saved in a separate **Cards from your partner** section in Settings and can be played or removed there. Partner-shared cards use `rooms/{roomCode}/sharedCards`; they are not published to the Global Deck.

Multiple-choice cards include an `options` array in `cards.json`. When adding a card, choose Flame & Passion or Deep Connection, select **Multiple choice**, and enter 2–6 answer choices on separate lines. Multiple-choice cards can be kept on the device, shared with a partner, or published to the Global Deck. **Compare First** is available in Settings → Game mode: the host chooses modules and levels, then starts a round of up to 50 multiple-choice cards. Both partners must submit before the host advances each poll; after the round they can start another or continue to regular cards. This mode requires an approved paired room. Firebase administrators can access Global Deck cards and room answer records. The room stores only each partner's current-round choice, replacing it on a later multiple-choice card. Deploy the current `database.rules.json` to enable multiple-choice Global Deck publishing, partner card sharing, and reveal-after-both-read answer rules.

## Built-in card deck

The built-in deck is loaded from `cards.json` and does not need to be copied into Firebase. It contains 2,672 cards: 1,100 Flame & Passion cards, 1,072 Deep Connection cards, and 500 Explicit cards, including 513 multiple-choice cards across the existing sections. The 2,000 added cards are split evenly between Flame & Passion and Deep Connection, with 500 multiple-choice cards. Flame & Passion level 3 is reserved for distinctly steamy prompts; more general intimacy and communication prompts belong in lower levels. The separate Explicit section has an 18+ self-attestation gate and is intended for frank, consensual discussion; this client-side gate does not verify age or protect the bundled card text from direct access. Explicit cards are not synced to paired rooms. Keep intimate activities consensual, private, and respectful of agreed boundaries. The JSON file is about 854 KB. Give every new card a unique `id`; use `module` values `sexuality`, `life`, or `explicit`, an `intensity` from 1 to 3, and an `options` array for multiple-choice cards. After changing the bundled deck, increment `CACHE_NAME` in `sw.js` so installed apps fetch the update.

Wild & Unspoken also supports explicit paired sharing. Both devices must connect to the same Firebase room and use the same randomly generated 256-bit key. Exchange that key with your partner through a trusted channel separate from the room code. The app encrypts each entry with AES-GCM in the browser; only ciphertext, a random IV, sender UID and tab ID, and timestamp are sent to `rooms/{roomCode}/sharedReveals`. The receiving device decrypts in memory, keeps the entry hidden until the recipient chooses to reveal it, and attempts to remove its encrypted room copy after successful receipt. Received plaintext is not saved to local storage. The key and tab ID are held in session storage for the current browser tab.

Room access requires Firebase Anonymous Authentication and the restrictive rules in `database.rules.json`. Room codes are random 128-bit invite secrets, and knowing one only lets a person request access; the host must approve them. A room has one host slot and one partner slot, with the two-person limit enforced by database rules. Firebase administrators can access database contents, and anyone admitted to a room can read partner-shared card text; Wild & Unspoken entries additionally require the separate encryption key. Firebase is disabled until a valid configuration is supplied in `js/firebase-config.js`.

## Community deck setup

Private prompts are saved only in the current browser's `closer_custom_cards` local storage entry. Global Deck publishing, community upvotes, and reports require a valid Firebase configuration in `js/firebase-config.js`, Firebase Anonymous Authentication enabled, and Realtime Database rules that permit authenticated community-card reads and appropriately validated writes.

Community prompts are stored under `cards/{cardId}` with `visibility: "community"`. Votes are stored per authenticated user under `cardVotes/{cardId}/{uid}`, and moderation reports under `cardReports/{cardId}/{uid}`. Reports are queued for moderator review; this app does not automatically remove reported prompts. The supplied Realtime Database rules allow public reads of community cards, restrict writes to authenticated authors, validate card fields, restrict votes and reports to a user's own UID, and allow report reads only to users with the `moderator` custom claim.

## Firebase room setup

1. Configure `js/firebase-config.js` with the Firebase project's web app settings and enable Anonymous Authentication.
2. In the Firebase console, open **Realtime Database → Rules**, replace the rules with the contents of `database.rules.json`, and publish them. The default rules deny access to all unspecified paths.
3. Test with two authenticated devices: one creates a room and shares its code; the other requests access; the host approves or denies that request. A second partner cannot claim the already-filled seat.

The rules intentionally reject legacy short room codes and old room records. Create a new room after deploying them. Room sharing cannot work until a valid Firebase project is configured and the rules have been published.