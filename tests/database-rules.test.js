const fs = require('node:fs');
const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const { get, ref, remove, set } = require('firebase/database');

const roomCode = 'abcdefghijklmnopqrstuv';
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

        await assertSucceeds(get(ref(host, sharedDeckPath)));
        await assertSucceeds(get(ref(partner, sharedDeckPath)));
        await assertFails(get(ref(outsider, sharedDeckPath)));

        const validQuestionIds = Object.fromEntries(
            Array.from({ length: 30 }, (_, index) => [String(index), `question-${index}`])
        );
        await assertSucceeds(set(ref(host, `rooms/${roomCode}/guessMe/questionIds`), validQuestionIds));
        await assertFails(set(ref(host, `rooms/${roomCode}/guessMe/questionIds`), {
            ...validQuestionIds,
            30: 'question-30'
        }));

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
