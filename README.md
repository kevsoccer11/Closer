# Closer

## Private entries and journal

Wild & Unspoken entries and Date Night Journal notes are saved in this browser's local storage. Wild & Unspoken entries are hidden until the user chooses to reveal them on-screen. Local storage is not encrypted, so anyone with access to the same browser profile or device may be able to read it. Removing site data or resetting local storage deletes these entries.

Deck filters, game mode, turn-taking, shuffle, and custom question controls are available in Settings rather than on the main question screen.

Custom cards can stay in the creator's local deck, be explicitly shared to the paired room, or be published to the Global Deck. Device-only cards are not copied into the partner's saved deck, but the paired room syncs the currently active card. Cards explicitly shared by a partner are saved in a separate **Cards from your partner** section in Settings and can be played or removed there. Partner-shared cards use `rooms/{roomCode}/sharedCards`; they are not published to the Global Deck.

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