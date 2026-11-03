const fs = require('node:fs');
const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const { get, ref, remove, runTransaction, set, update } = require('firebase/database');

const roomCode = 'abcdefghijklmnopqrstuv';
const joinRoomCode = 'bcdefghijklmnopqrstuvw';
const sharedDeckPath = `rooms/${roomCode}/sharedDeck`;

async function seedRoom(environment) {
    await environment.withSecurityRulesDisabled(async context => {
        const database = context.database();
        await set(ref(database, `rooms/${roomCode}/members/host`), 'host-uid');
        await set(ref(database, `rooms/${roomCode}/members/partner`), 'partner-uid');
        await set(ref(database, `${sharedDeckPath}/host-card`), {
            addedBy: 'host-uid',
            card: { id: 'host-card', prompt: 'A host card' }
        });
    });
}

async function main() {
    const environment = await initializeTestEnvironment({
        projectId: 'demo-closer-rules',
        database: {
            rules: fs.readFileSync('database.rules.json', 'utf8')
        }
    });
    try {
        await seedRoom(environment);
        const host = environment.authenticatedContext('host-uid').database();
        const partner = environment.authenticatedContext('partner-uid').database();
        const outsider = environment.authenticatedContext('outsider-uid').database();

        const activeCardPath = `rooms/${roomCode}/activeCard`;
        const sharedCard = { id: 'question-1', module: 'closer', roundId: 'round-1', sharedRoundStartedAt: Date.now() };
        await assertSucceeds(set(ref(host, activeCardPath), sharedCard));
        await assertSucceeds(get(ref(partner, activeCardPath)));
        await assertSucceeds(set(ref(partner, activeCardPath), { ...sharedCard, id: 'partner-card', startedBy: 'partner-uid' }));
        await assertFails(set(ref(partner, activeCardPath), { ...sharedCard, id: 'spoofed', startedBy: 'host-uid' }));
        await assertSucceeds(set(ref(host, activeCardPath), sharedCard));
        await assertFails(set(ref(outsider, activeCardPath), sharedCard));

        await assertSucceeds(get(ref(host, sharedDeckPath)));
        await assertSucceeds(get(ref(partner, sharedDeckPath)));
        await assertFails(get(ref(outsider, sharedDeckPath)));

        const validQuestionIds = Object.fromEntries(
            Array.from({ length: 100 }, (_, index) => [String(index), `question-${index}`])
        );
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/questionIds`), validQuestionIds));
        await assertFails(set(ref(host, `rooms/${roomCode}/guessMe/questionIds`), {
            ...validQuestionIds,
            100: 'question-100'
        }));

        await assertSucceeds(set(ref(host, `rooms/${roomCode}/gameMode`), 'guess-me'));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/length`), 100));
        await assertFails(set(ref(host, `rooms/${roomCode}/guessMe/length`), 101));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/currentIndex`), 99));
        await assertFails(set(ref(host, `rooms/${roomCode}/guessMe/currentIndex`), 100));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/status`), 'lobby'));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/status`), 'playing'));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/status`), 'complete'));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/replayVotes/host`), 'yes'));
        await assertFails(set(ref(host, `rooms/${roomCode}/guessMe/replayVotes/partner`), 'yes'));
        await assertSucceeds(set(ref(partner, `rooms/${roomCode}/guessMe/replayVotes/partner`), 'no'));
        await assertFails(set(ref(partner, `rooms/${roomCode}/guessMe/replayVotes/host`), 'no'));
        await assertSucceeds(remove(ref(host, `rooms/${roomCode}/guessMe/replayVotes/partner`)));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/status`), 'lobby'));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/status`), 'playing'));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/status`), 'paused'));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/status`), 'playing'));
        await assertSucceeds(set(ref(partner, `rooms/${roomCode}/guessMe/status`), 'paused'));
        await assertSucceeds(set(ref(partner, `rooms/${roomCode}/guessMe/status`), 'playing'));
        await assertSucceeds(set(ref(partner, `rooms/${roomCode}/guessMe/status`), 'ended'));
        await assertFails(set(ref(partner, `rooms/${roomCode}/guessMe/status`), 'playing'));
        await assertFails(set(ref(outsider, `rooms/${roomCode}/guessMe/status`), 'paused'));
        await assertFails(set(ref(host, `rooms/${roomCode}/guessMe/status`), 'playing'));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/predictorUid`), 'partner-uid'));
        await assertFails(set(ref(partner, `rooms/${roomCode}/guessMe/predictorUid`), 'host-uid'));
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/scores/partner`), 1));
        await assertFails(set(ref(partner, `rooms/${roomCode}/guessMe/scores/partner`), 2));

        const hostForJoin = environment.authenticatedContext('joining-host').database();
        const partnerForJoin = environment.authenticatedContext('joining-partner').database();
        await assertSucceeds(set(ref(hostForJoin, `rooms/${joinRoomCode}/members/host`), 'joining-host'));
        await assertSucceeds(set(ref(hostForJoin, `rooms/${joinRoomCode}/gameMode`), 'guess-me'));
        await assertSucceeds(set(ref(partnerForJoin, `rooms/${joinRoomCode}/joinRequests/joining-partner`), {
            requesterUid: 'joining-partner',
            status: 'pending',
            requestedAt: Date.now()
        }));
        await assertSucceeds(runTransaction(
            ref(hostForJoin, `rooms/${joinRoomCode}/members/partner`),
            currentUid => currentUid === null ? 'joining-partner' : undefined
        ));
        await assertSucceeds(update(
            ref(hostForJoin, `rooms/${joinRoomCode}/joinRequests/joining-partner`),
            { status: 'approved', resolvedAt: Date.now() }
        ));
        await assertSucceeds(get(ref(partnerForJoin, `rooms/${joinRoomCode}/gameMode`)));
        await assertSucceeds(set(ref(partnerForJoin, `rooms/${joinRoomCode}/guessMe/partnerReady`), true));

        const inviteRoom = 'cdefghijklmnopqrstuvwx';
        const inviteHost = environment.authenticatedContext('invite-host').database();
        const guestA = environment.authenticatedContext('invite-guest-a').database();
        const guestB = environment.authenticatedContext('invite-guest-b').database();
        const base = `rooms/${inviteRoom}`;
        const token = 'tokentokentokentoken1234';
        const joinWithToken = (db, uid, inviteToken) => update(ref(db, base), {
            [`joinRequests/${uid}`]: { requesterUid: uid, status: 'pending', requestedAt: Date.now(), name: 'Alex', icon: '⭐', inviteToken },
            'invite/claimedBy': uid
        });
        await assertSucceeds(set(ref(inviteHost, `${base}/members/host`), 'invite-host'));
        await assertSucceeds(set(ref(inviteHost, `${base}/invite`), { token, expiresAt: Date.now() + 60000 }));
        await assertFails(get(ref(guestA, `${base}/invite/token`)));
        await assertSucceeds(get(ref(guestA, `${base}/invite/expiresAt`)));
        await assertFails(joinWithToken(guestA, 'invite-guest-a', 'wrongtokenwrongtoken1234'));
        await assertSucceeds(joinWithToken(guestA, 'invite-guest-a', token));
        await assertFails(joinWithToken(guestB, 'invite-guest-b', token));
        await assertSucceeds(set(ref(inviteHost, `${base}/invite`), { token: 'newtokennewtokennew5678', expiresAt: Date.now() + 60000 }));
        await assertSucceeds(joinWithToken(guestB, 'invite-guest-b', 'newtokennewtokennew5678'));
        await assertSucceeds(set(ref(inviteHost, `${base}/invite`), { token: 'expiredexpiredexpired12', expiresAt: Date.now() - 1000 }));
        const guestC = environment.authenticatedContext('invite-guest-c').database();
        await assertFails(joinWithToken(guestC, 'invite-guest-c', 'expiredexpiredexpired12'));
        await assertFails(set(ref(guestC, `${base}/invite`), { token: 'stolenstolenstolen1234', expiresAt: Date.now() + 60000 }));
        // The plain room code without a token still works and still waits for host approval.
        await assertSucceeds(set(ref(guestC, `${base}/joinRequests/invite-guest-c`), { requesterUid: 'invite-guest-c', status: 'pending', requestedAt: Date.now() }));

        const consentPath = `rooms/${roomCode}/explicitConsent`;
        await assertSucceeds(set(ref(host, `${consentPath}/host`), true));
        await assertSucceeds(set(ref(partner, `${consentPath}/partner`), true));
        await assertFails(set(ref(host, `${consentPath}/partner`), true));
        await assertFails(set(ref(partner, `${consentPath}/host`), false));
        await assertFails(set(ref(outsider, `${consentPath}/host`), true));
        await assertFails(set(ref(host, `${consentPath}/host`), 'yes'));
        await assertSucceeds(get(ref(partner, consentPath)));
        await assertFails(get(ref(outsider, consentPath)));
        await assertSucceeds(set(ref(host, activeCardPath), { id: 'explicit-1', module: 'explicit', roundId: 'r2', sharedRoundStartedAt: Date.now() }));

        const switchPath = `rooms/${roomCode}/switchRequest`;
        await assertSucceeds(set(ref(host, switchPath), { by: 'host-uid', label: 'Spark pack', at: Date.now() }));
        await assertFails(set(ref(partner, switchPath), { by: 'host-uid', label: 'Spark pack', at: Date.now(), status: 'approved', extra: 1 }));
        await assertSucceeds(update(ref(partner, switchPath), { status: 'approved' }));
        await assertFails(update(ref(partner, switchPath), { label: 'Changed' }));
        await assertFails(set(ref(outsider, switchPath), null));
        await assertSucceeds(remove(ref(host, switchPath)));
        await assertFails(set(ref(partner, switchPath), { by: 'host-uid', label: 'Spoof', at: Date.now() }));
        await assertSucceeds(set(ref(partner, switchPath), { by: 'partner-uid', label: 'Heat pack', at: Date.now() }));
        await assertSucceeds(update(ref(host, switchPath), { status: 'declined' }));
        await assertSucceeds(remove(ref(partner, switchPath)));

        const lockPath = `rooms/${roomCode}/roundStart`;
        await assertSucceeds(set(ref(host, lockPath), { by: 'host-uid', at: Date.now() }));
        await assertFails(set(ref(partner, lockPath), { by: 'partner-uid', at: Date.now() }));
        await assertFails(set(ref(outsider, lockPath), { by: 'host-uid', at: Date.now() }));
        await assertSucceeds(get(ref(partner, lockPath)));
        await assertSucceeds(remove(ref(host, lockPath)));
        await assertFails(set(ref(host, lockPath), { by: 'partner-uid', at: Date.now() }));
        await assertSucceeds(set(ref(partner, lockPath), { by: 'partner-uid', at: Date.now() }));
        await assertSucceeds(remove(ref(partner, lockPath)));
        await assertSucceeds(set(ref(host, lockPath), { by: 'host-uid', at: Date.now() - 60000 }));
        await assertSucceeds(set(ref(partner, lockPath), { by: 'partner-uid', at: Date.now() }));
        await assertSucceeds(remove(ref(partner, lockPath)));

        const scoreTransaction = await runTransaction(
            ref(host, `rooms/${roomCode}/guessMe/scores/partner`),
            score => (Number(score) || 0) + 1
        );
        if (!scoreTransaction.committed || scoreTransaction.snapshot.val() !== 2) {
            throw new Error('You Get Me host score transaction did not commit');
        }

        await assertSucceeds(set(ref(host, `${sharedDeckPath}/host-new`), {
            addedBy: 'host-uid',
            card: { id: 'host-new', prompt: 'Host can add' }
        }));
        await assertSucceeds(set(ref(partner, `${sharedDeckPath}/partner-new`), {
            addedBy: 'partner-uid',
            card: { id: 'partner-new', prompt: 'Partner can add' }
        }));
        await assertFails(set(ref(partner, `${sharedDeckPath}/host-card`), {
            addedBy: 'partner-uid',
            card: { id: 'host-card', prompt: 'Partner cannot replace host card' }
        }));
        await assertFails(remove(ref(host, `${sharedDeckPath}/partner-new`)));
        await assertSucceeds(remove(ref(partner, `${sharedDeckPath}/partner-new`)));

        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/status`), 'lobby'));
        await assertFails(set(ref(partner, `rooms/${roomCode}/guessMe/status`), 'lobby'));
        await assertSucceeds(set(ref(partner, `rooms/${roomCode}/gameMode`), 'conversation'));

        const reqPath = `rooms/${roomCode}/guessMeRequest`;
        await assertSucceeds(set(ref(partner, reqPath), { by: 'partner-uid', length: 10, vibe: 'mixed', at: Date.now() }));
        await assertSucceeds(get(ref(host, reqPath)));
        await assertFails(set(ref(partner, reqPath), { by: 'host-uid', length: 10, vibe: 'mixed', at: Date.now() }));
        await assertFails(set(ref(outsider, reqPath), { by: 'outsider-uid', length: 10, vibe: 'mixed', at: Date.now() }));
        await assertSucceeds(remove(ref(host, reqPath)));

        const deckPath = `rooms/${roomCode}/roundDeck`;
        await assertSucceeds(set(ref(partner, deckPath), { id: 'r1', ids: ['a', 'b', 'c'], by: 'partner-uid' }));
        await assertSucceeds(get(ref(host, deckPath)));
        await assertFails(set(ref(partner, deckPath), { id: 'r2', ids: ['a'], by: 'host-uid' }));
        await assertFails(set(ref(outsider, deckPath), { id: 'r3', ids: ['a'], by: 'outsider-uid' }));

        const presencePath = `rooms/${roomCode}/presence`;
        await assertSucceeds(set(ref(host, `${presencePath}/host`), { online: true, lastSeen: Date.now() }));
        await assertSucceeds(set(ref(partner, `${presencePath}/partner`), { online: false, lastSeen: Date.now() }));
        await assertFails(set(ref(partner, `${presencePath}/host`), { online: false, lastSeen: Date.now() }));
        await assertFails(set(ref(outsider, `${presencePath}/partner`), { online: true, lastSeen: Date.now() }));
        await assertFails(set(ref(host, `${presencePath}/host`), { online: 'yes', lastSeen: Date.now() }));
        await assertSucceeds(get(ref(partner, presencePath)));
        await assertFails(get(ref(outsider, presencePath)));

        console.log('Firebase Realtime Database rules tests passed.');
    } finally {
        await environment.cleanup();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
