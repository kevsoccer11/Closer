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
        await assertFails(set(ref(partner, activeCardPath), { ...sharedCard, id: 'partner-card' }));
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

        console.log('Firebase Realtime Database rules tests passed.');
    } finally {
        await environment.cleanup();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
