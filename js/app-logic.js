let pendingGameStart = null;
let ygmQuestionBank = [];
let pendingExplicitCardBrowserFilter = null;
const COMMUNITY_CARD_PAGE_SIZE = 100;
let communityCardsLastKey = null;
let communityCardsHasMore = true;
let communityCardsLoadInFlight = false;
let communityDeckLoadInFlight = false;
window.ygmQuestionBank = ygmQuestionBank;


async function initDatabase() {
    console.log("Initializing database...");

    let localCards = [];
    try {
        const response = await fetch('./cards.json');
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const data = await response.json();
        localCards = data.cards || [];
        if (hasExplicitAgeConfirmation()) {
            try {
                const explicitResponse = await fetch('./explicit-cards.json');
                if (explicitResponse.ok) {
                    const explicitData = await explicitResponse.json();
                    localCards = localCards.concat(explicitData.cards || []);
                    explicitCardsLoaded = true;
                }
            } catch (explicitErr) {
                console.warn('Explicit cards could not be loaded:', explicitErr);
            }
        }
    } catch (err) {
        console.warn("Local cards.json fetch failed. Injecting fallback deck.", err);
        usingStarterDeck = true;
        localCards = [
            { id: 'sec-fb1', module: 'sexuality', category: 'Past History', intensity: 1, prompt: 'What was a moment early in our relationship that made your heart race?', contextType: 'story' },
            { id: 'sec-fb2', module: 'sexuality', category: 'Spicy Dares', intensity: 2, prompt: 'Give your partner a slow 60-second back massage right now.', contextType: 'action' },
            { id: 'life-fb1', module: 'life', category: 'Shared Goals', intensity: 1, prompt: 'What is one trip or experience you want us to plan in the next 12 months?', contextType: 'alignment' },
            { id: 'secret-fb1', module: 'secrets', category: 'Desires', intensity: 3, prompt: 'What is a secret fantasy you have thought about but never spoken out loud?', contextType: 'consent' }
        ];
    }
    const cardsById = new Map();
    [...localCards, ...customUserCards].forEach((card, index) => {
        if (card && card.prompt) cardsById.set(card.id || `loaded-${index}`, { ...card, id: card.id || `loaded-${index}` });
    });
    masterDatabase = [...cardsById.values()];
    window.masterDatabase = masterDatabase;
    try { updateCuratedPackMeta(); } catch (e) { console.warn(e); }
    try {
        const ygmResp = await fetch('./YGM-question-bank.json');
        if (ygmResp.ok) {
            const ygmData = await ygmResp.json();
            ygmQuestionBank = (ygmData && Array.isArray(ygmData.questions)) ? ygmData.questions : [];
            window.ygmQuestionBank = ygmQuestionBank;
            console.log(`Loaded ${ygmQuestionBank.length} You Get Me questions.`);
        }
    } catch (e) {
        console.warn('You Get Me bank could not be loaded:', e);
        ygmQuestionBank = [];
        window.ygmQuestionBank = ygmQuestionBank;
    }


    let restoredRound = false;
    try {
        const savedFilters = readStoredJSON('closer_round_filters', null, value => value === null || (
            typeof value === 'object' && !Array.isArray(value)
            && (value.activePillars === undefined || (Array.isArray(value.activePillars) && value.activePillars.every(item => typeof item === 'string')))
            && (value.activeTopics === undefined || value.activeTopics === null || (Array.isArray(value.activeTopics) && value.activeTopics.every(item => typeof item === 'string')))
            && (value.activeMood === undefined || typeof value.activeMood === 'string')
            && ['includeQuestions', 'includeActivities', 'includeMultipleChoice'].every(key => value[key] === undefined || typeof value[key] === 'boolean')
        ));
        if (savedFilters) {
            activePillars = savedFilters.activePillars || activePillars;
            activeModules = [...activePillars];
            activeTopics = savedFilters.activeTopics ?? activeTopics;
            activeMood = savedFilters.activeMood || activeMood;
            includeQuestions = savedFilters.includeQuestions ?? includeQuestions;
            includeActivities = savedFilters.includeActivities ?? includeActivities;
            includeMultipleChoice = savedFilters.includeMultipleChoice ?? includeMultipleChoice;
        }
    } catch (e) {}
    const savedDeck = readStoredJSON('closer_unspent_deck', null, value => value === null || (Array.isArray(value) && value.every(card => card && typeof card.id === 'string' && typeof card.prompt === 'string')));
    const savedCard = readStoredJSON('closer_current_card', null, value => value === null || (typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string' && typeof value.prompt === 'string'));
    if (Array.isArray(savedDeck) && savedCard && savedCard.id) {
        unspentDeck = savedDeck;
        currentCard = savedCard;
        restoredRound = true;
    }

    if (!restoredRound) {
        showHomeView();
    } else {
        renderCard(currentCard);
        showHomeView();
    }
    updateRoundSummary();
    if (typeof showQod === 'function') showQod();
    if (!document.getElementById('roundBuilderModal')?.classList.contains('hidden')) renderRoundTopics();
    const appStatus = document.getElementById('appStatus');
    if (appStatus) {
        const statusMessages = [];
        if (!window.firebaseConfigured) {
            statusMessages.push('Local play · Community sharing unavailable until Firebase is configured.');
        }
        if (cardLoadError) statusMessages.push('Community cards could not be loaded from Firebase.');
        if (usingStarterDeck) {
            statusMessages.push('Showing a small starter deck because the full deck could not load.');
        }
        const recoveryNotice = getStorageRecoveryNotice();
        if (recoveryNotice) statusMessages.push(recoveryNotice);
        appStatus.textContent = statusMessages.join(' ');
    }
    if (window.db) {
        scheduleCommunityDeckLoad();
    } else {
        const status = document.getElementById('communityCardsStatus');
        if (status) status.textContent = 'Global Deck is unavailable without a Firebase connection. Local cards remain available.';
    }
    const savedCode = readStoredValue('closer_room_code');
    const savedRole = readStoredValue('closer_room_role');
    // Do not auto-connect to a previous room on load; pairing is an explicit user action.
    // (Saved code/role are retained for manual reconnect.)
    void savedCode; void savedRole;

}

function scheduleCommunityDeckLoad() {
    const startLoading = () => { void loadCommunityDeck(); };
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(startLoading));
    } else {
        setTimeout(startLoading, 0);
    }
}

async function loadCommunityCards() {
    const button = document.getElementById('loadCommunityCardsBtn');
    const status = document.getElementById('communityCardsStatus');
    if (communityCardsLoadInFlight) return false;
    if (!window.db) {
        if (status) status.textContent = 'Global Deck requires a Firebase connection. Your local cards remain available.';
        return false;
    }
    if (!communityCardsHasMore) return true;
    communityCardsLoadInFlight = true;
    if (button) {
        button.classList.add('hidden');
        button.disabled = true;
    }
    if (status) status.textContent = 'Loading Global Deck cards…';
    try {
        let query = window.db.ref('cards').orderByKey();
        if (communityCardsLastKey) query = query.startAt(communityCardsLastKey);
        const snapshot = await query.limitToFirst(COMMUNITY_CARD_PAGE_SIZE + 1 + (communityCardsLastKey ? 1 : 0)).once('value');
        const rows = [];
        snapshot.forEach(child => rows.push([child.key, child.val()]));
        const nextRows = rows.filter(([key]) => !communityCardsLastKey || key > communityCardsLastKey);
        const page = nextRows.slice(0, COMMUNITY_CARD_PAGE_SIZE);
        communityCardsHasMore = nextRows.length > page.length;
        if (page.length > 0) communityCardsLastKey = page[page.length - 1][0];
        const cardsById = new Map(masterDatabase.map(card => [card.id, card]));
        let added = 0;
        page.forEach(([key, card]) => {
            if (!card || card.visibility !== 'community' || typeof card.prompt !== 'string' || !card.prompt.trim()) return;
            const id = typeof card.id === 'string' && card.id ? card.id : key;
            if (!cardsById.has(id)) added++;
            cardsById.set(id, { ...card, id });
        });
        masterDatabase = [...cardsById.values()];
        window.masterDatabase = masterDatabase;
        if (typeof updateCuratedPackMeta === 'function') updateCuratedPackMeta();
        if (typeof updateRoundMatchCount === 'function') updateRoundMatchCount();
        cardLoadError = false;
        if (status) {
            status.textContent = added
                ? `Loaded ${added} Global Deck ${added === 1 ? 'card' : 'cards'}.${communityCardsHasMore && communityDeckLoadInFlight ? ' Loading remaining cards in the background…' : communityCardsHasMore ? '' : ' Global Deck is up to date.'}`
                : communityCardsHasMore
                    ? `No new cards in this batch.${communityDeckLoadInFlight ? ' Loading remaining cards in the background…' : ''}`
                    : 'No additional Global Deck cards found.';
        }
        return true;
    } catch (error) {
        cardLoadError = true;
        console.error('Could not load a Global Deck page:', error);
        if (status) status.textContent = 'Could not load Global Deck cards. Check your connection and try again.';
        if (button) {
            button.textContent = 'Retry Global Deck loading';
            button.disabled = false;
            button.classList.remove('hidden');
        }
        return false;
    } finally {
        communityCardsLoadInFlight = false;
    }
}
window.loadCommunityCards = loadCommunityCards;

async function loadCommunityDeck() {
    if (communityDeckLoadInFlight) return;
    communityDeckLoadInFlight = true;
    try {
        while (communityCardsHasMore) {
            const loaded = await loadCommunityCards();
            if (!loaded || !communityCardsHasMore) break;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    } finally {
        communityDeckLoadInFlight = false;
    }
}
window.loadCommunityDeck = loadCommunityDeck;

function rebuildUnspentDeck() {
    const filteredCards = getFilteredCards();
    let candidateCards = filteredCards;
    const unplayed = filteredCards.filter(card => !playedCardIds.has(card.id));
    if (unplayed.length > 0) candidateCards = unplayed;
    const weightedCards = candidateCards;
    for (let i = weightedCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [weightedCards[i], weightedCards[j]] = [weightedCards[j], weightedCards[i]];
    }
    const declustered = [...weightedCards];
    for (let i = 1; i < declustered.length; i++) {
        if (declustered[i].category === declustered[i - 1].category && declustered[i].intensity === declustered[i - 1].intensity) {
            for (let j = i + 1; j < declustered.length; j++) {
                if (declustered[j].category !== declustered[i - 1].category) {
                    [declustered[i], declustered[j]] = [declustered[j], declustered[i]];
                    break;
                }
            }
        }
    }
    unspentDeck = activeQuestionCount ? declustered.slice(0, activeQuestionCount) : declustered;
roundTotalCards = unspentDeck.length;
}

function getPillar(card) {
    if (card.pillar) return card.pillar;
    if (card.module === 'explicit') return 'afterhours';
    if (card.module === 'sexuality') {
        if (card.intensity >= 3) return 'afterhours';
        if (card.intensity === 2) return 'heat';
        return 'spark';
    }
    // life
    const cat = (card.category || '').toLowerCase();
    if (/intimacy|desire|flirt|romance|affection|touch|sensual|pleasure|attraction|kiss/.test(cat)) return 'heat';
    if (/fun|playful|humor|random|game|sport|adventure|travel|casual|getting to know/.test(cat)) return 'spark';
    if (/home|money|financ|work|career|family|community|friends|gathering|health|caregiv|aging|retirement|future|life stages|relocation|disab|technology/.test(cat)) return 'together';
    return 'closer';
}
function getMood(card) {
    if (card.mood) return card.mood;
    const intensity = Number(card.intensity) || 1;
    if (card.module === 'explicit') return 'spicy';
    const pillar = getPillar(card);
    const cat = (card.category || '').toLowerCase();
    const contextType = (card.contextType || '').toLowerCase();
    if (pillar === 'afterhours') return 'spicy';
    if (pillar === 'heat') {
        if (/kink|libido|mismatch|openness/.test(cat)) return 'spicy';
        if (intensity === 1 && /flirt|ritual|playful|tease|teasing/.test(cat)) return 'playful';
        if (intensity >= 2 && /desire|sensual|pleasure|initiation|intimacy|touch|past history/.test(cat)) return 'passionate';
        return 'romantic';
    }
    if (pillar === 'spark') {
        if (/ideal dates/.test(cat)) return 'romantic';
        if (/growing up|college/.test(cat)) return 'reflective';
        if (/adventure|travel|sports|fitness|dare|spontan/.test(cat)
            || ((contextType === 'action' || contextType === 'spontaneity' || contextType === 'thrill' || contextType === 'trial') && /try|new|explore|challenge/.test(cat))) return 'adventurous';
        return 'playful';
    }
    if (pillar === 'together') {
        if (/adventure|travel/.test(cat)) return 'adventurous';
        if (/friends|social|gathering|celebration|pets|community/.test(cat)) return 'playful';
        if (/money stress|financial trauma|disab|chronic|cultural|religious|caregiving/.test(cat)) return 'deep';
        if (/future|growth|life stages|aging|retirement|career|money|financ|work|relocation|long-distance|technology/.test(cat)) return 'reflective';
        return 'tender';
    }
    // closer
    if (/joy|appreciation|aftercare|our story|early relationship/.test(cat)) return 'tender';
    if (/trust|safety/.test(cat)) return intensity >= 2 ? 'deep' : 'tender';
    if (/conflict|repair|apolog|communication|dating through|regrets|growing up|college|lightbulb/.test(cat)) return 'reflective';
    return 'deep';
}

function getExploreMoodValues(mood) {
    const moodGroups = {
        connection: ['connection', 'reflective', 'tender'],
        playful: ['playful'],
        deep: ['deep', 'reflective'],
        romantic: ['romantic', 'passionate'],
        intimacy: ['intimacy', 'romantic', 'spicy', 'passionate'],
        adventure: ['adventure', 'adventurous']
    };
    return moodGroups[mood] || [mood];
}

function getFilteredCards() {
    if (activeDeckId) {
        const deck = customDecks.find(item => item.id === activeDeckId);
        if (!deck) return [];
        const cardIds = new Set(deck.cardIds);
        return masterDatabase.filter(card => cardIds.has(card.id));
    }
    return masterDatabase.filter(card => {
        const matchesCompareFirst = activeGameMode === 'compare-first';
        const matchesModule = true; // module filter replaced by pillar filter
        const matchesPillar = activePillars.length === 0 || activePillars.includes(getPillar(card));
        const intensity = String(card.intensity);
        const matchesMode = true;
        const matchesIntensity = true;
        const promptStyle = card.promptStyle || (card.contextType === 'action' ? 'activity' : 'question');
        const isMultipleChoice = Array.isArray(card.options) && card.options.length >= 2;
        const matchesPromptStyle = matchesCompareFirst
            || (isMultipleChoice ? includeMultipleChoice : promptStyle === 'activity' ? includeActivities : includeQuestions);
        const matchesTopic = matchesCompareFirst || activeTopics === null
            || activeTopics.includes(`${getPillar(card)}::${card.category || 'General'}`);
        if (favoritesOnly && !favoriteIds.includes(card.id)) return false;
        if (activeMood !== 'all' && getMood(card) !== activeMood) return false;
        return matchesModule && matchesPillar && matchesMode && matchesIntensity && matchesPromptStyle
            && matchesTopic
            && (!matchesCompareFirst || isMultipleChoice);
    });
}

const STORY_PACK_TOPICS = ['closer::Our Story', 'closer::Growing Up Stories', 'closer::College & Early Career Stories', 'closer::Dating Through the Years', 'closer::Regrets & Do-Overs', 'spark::Story Time', 'spark::Growing Up Stories', 'spark::College & Early Career Stories', 'spark::Dating Stories', 'spark::Ideal Dates'];

function applyPack(pack) {
    const packs = {
        'first-date': { modules: ['spark', 'closer'], topics: ['spark::Getting to Know You', 'spark::Casual & Everyday', 'spark::Learning & Curiosity', 'spark::Dating Stories', 'spark::Ideal Dates', 'closer::Early Relationship Discovery'], intensity: '1', questions: true, activities: true, multipleChoice: true },
        'after-fight': { modules: ['closer'], topics: null, intensity: 'all', questions: true, activities: true, multipleChoice: true },
        'travel-night': { modules: ['spark', 'together'], topics: ['spark::Adventure & Travel', 'together::Adventure & Travel', 'spark::Sports & Fitness', 'spark::Pets & Animals'], intensity: 'all', questions: true, activities: true, multipleChoice: true },
        'deep-talk': { modules: ['closer', 'together'], topics: null, intensity: '3', questions: true, activities: true, multipleChoice: true },
        'kinky-explorative': { modules: ['afterhours'], topics: null, intensity: 'all', questions: true, activities: true, multipleChoice: true },
        'reconnection': { modules: ['closer'], topics: null, intensity: 'all', questions: true, activities: true, multipleChoice: true },
        'long-distance': { modules: ['closer', 'together'], topics: null, intensity: 'all', questions: true, activities: true, multipleChoice: true },
        'new-parents': { modules: ['closer', 'together'], topics: null, intensity: 'all', questions: true, activities: true, multipleChoice: true },
        'playful': { modules: ['spark', 'heat'], topics: null, intensity: '1', questions: true, activities: true, multipleChoice: true },
        'deeper-connection': { modules: ['closer'], topics: null, questions: true, activities: true, multipleChoice: true },
        'playful-chemistry': { modules: ['spark'], topics: null, questions: true, activities: true, multipleChoice: true },
        'build-the-tension': { modules: ['heat'], topics: null, questions: true, activities: true, multipleChoice: true },
        'after-hours': { modules: ['afterhours'], topics: null, questions: true, activities: true, multipleChoice: true },
        'story-time': { modules: ['closer', 'spark'], topics: STORY_PACK_TOPICS, questions: true, activities: true, multipleChoice: true }
    };
    const selection = packs[pack];
    if (!selection) return;
    // Set topics filter: if topics provided, need activeTopics set; applyRoundSelection expects topics array or null.
    // Ensure topics exist in round builder? applyRoundSelection uses selection.topics directly.
    activePillars = (selection.modules && selection.modules.length) ? selection.modules : ['spark'];
    activeModules = [...activePillars];
    activeTopics = (selection.topics && selection.topics.length) ? selection.topics : null;
    activeMood = selection.mood || 'all';
    includeQuestions = selection.questions;
    includeActivities = selection.activities;
    includeMultipleChoice = selection.multipleChoice;
    document.querySelectorAll('input[name="roundPillar"]').forEach(input => { input.checked = activePillars.includes(input.value); });
    const moodInput = document.querySelector('input[name="roundMood"][value="' + activeMood + '"]');
    if (moodInput) moodInput.checked = true;
    const q = document.getElementById('includeQuestions'); if (q) q.checked = includeQuestions;
    const a = document.getElementById('includeActivities'); if (a) a.checked = includeActivities;
    const m = document.getElementById('includeMultipleChoice'); if (m) m.checked = includeMultipleChoice;
    renderRoundTopics();
    document.body.dataset.pack = pack;
}
function startQuickGame(skipPlayModeCheck = false) {
    if (!skipPlayModeCheck) { openPlayModeModal(() => startQuickGame(true)); return; }
    const selected = document.getElementById('roundPackSelect')?.value;
    if (selected === 'escalation') {
        startProgressiveGame();
        document.body.dataset.pack = 'slow-burn';
        return;
    }
    if (!selected) { showToast('Select a quick pack.'); return; }
    const packs = {
        'first-date': { modules: ['spark', 'closer'], topics: ['spark::Getting to Know You', 'spark::Casual & Everyday', 'spark::Learning & Curiosity', 'spark::Dating Stories', 'spark::Ideal Dates', 'closer::Early Relationship Discovery'], questions: true, activities: true, multipleChoice: true, mood: 'all' },
        'after-fight': { modules: ['closer'], topics: null, questions: true, activities: true, multipleChoice: true, mood: 'all' },
        'travel-night': { modules: ['spark', 'together'], topics: ['spark::Adventure & Travel', 'together::Adventure & Travel', 'spark::Sports & Fitness', 'spark::Pets & Animals'], questions: true, activities: true, multipleChoice: true, mood: 'all' },
        'deep-talk': { modules: ['closer', 'together'], topics: null, questions: true, activities: true, multipleChoice: true, mood: 'deep' },
        'kinky-explorative': { modules: ['afterhours'], topics: null, questions: true, activities: true, multipleChoice: true, mood: 'spicy' },
        'reconnection': { modules: ['closer'], topics: null, questions: true, activities: true, multipleChoice: true, mood: 'all' },
        'long-distance': { modules: ['closer', 'together'], topics: null, questions: true, activities: true, multipleChoice: true, mood: 'all' },
        'new-parents': { modules: ['closer', 'together'], topics: null, questions: true, activities: true, multipleChoice: true, mood: 'all' },
        'playful': { modules: ['spark', 'heat'], topics: null, questions: true, activities: true, multipleChoice: true, mood: 'playful' },
    };
    const selection = packs[selected];
    if (!selection) { showToast('Unknown pack.'); return; }
    applyRoundSelection({
        modules: selection.modules,
        topics: selection.topics,
        mood: selection.mood,
        questions: selection.questions,
        activities: selection.activities,
        multipleChoice: selection.multipleChoice
    }, selected === 'first-date').catch(error => {
        console.error('Could not start quick pack:', error);
        showToast(`Could not start conversation: ${error.message}`);
    });
    document.body.dataset.pack = selected;
}

function getCuratedPackSelection(key) {
    const STORY_PACK_TOPICS = ['closer::Our Story', 'closer::Growing Up Stories', 'closer::College & Early Career Stories', 'closer::Dating Through the Years', 'closer::Regrets & Do-Overs', 'spark::Story Time', 'spark::Growing Up Stories', 'spark::College & Early Career Stories', 'spark::Dating Stories', 'spark::Ideal Dates'];
    const packs = {
        'deeper-connection': { modules: ['closer'], topics: null, mood: 'deep', questions: true, activities: true, multipleChoice: true },
        'playful-chemistry': { modules: ['spark'], topics: null, mood: 'playful', questions: true, activities: true, multipleChoice: true },
        'build-the-tension': { modules: ['heat'], topics: null, mood: 'romantic', questions: true, activities: true, multipleChoice: true },
        'after-hours': { modules: ['afterhours'], topics: null, mood: 'spicy', questions: true, activities: true, multipleChoice: true },
        'playful': { modules: ['spark', 'heat'], topics: null, mood: 'playful', questions: true, activities: true, multipleChoice: true },
        'first-date': { modules: ['spark', 'closer'], topics: ['spark::Getting to Know You', 'spark::Casual & Everyday', 'spark::Learning & Curiosity', 'spark::Dating Stories', 'spark::Ideal Dates', 'closer::Early Relationship Discovery'], mood: 'all', questions: true, activities: true, multipleChoice: true },
        'deep-talk': { modules: ['closer', 'together'], topics: null, mood: 'deep', questions: true, activities: true, multipleChoice: true },
        'travel-night': { modules: ['spark', 'together'], topics: ['spark::Adventure & Travel', 'together::Adventure & Travel', 'spark::Sports & Fitness', 'spark::Pets & Animals'], mood: 'all', questions: true, activities: true, multipleChoice: true },
        'reconnection': { modules: ['closer'], topics: null, mood: 'all', questions: true, activities: true, multipleChoice: true },
        'kinky-explorative': { modules: ['afterhours'], topics: null, mood: 'spicy', questions: true, activities: true, multipleChoice: true },
        'long-distance': { modules: ['closer', 'together'], topics: null, mood: 'all', questions: true, activities: true, multipleChoice: true },
        'new-parents': { modules: ['closer', 'together'], topics: null, mood: 'all', questions: true, activities: true, multipleChoice: true },
        'after-fight': { modules: ['closer'], topics: null, mood: 'all', questions: true, activities: true, multipleChoice: true },
        'story-time': { modules: ['closer', 'spark'], topics: STORY_PACK_TOPICS, mood: 'all', questions: true, activities: true, multipleChoice: true },
        'escalation': null
    };
    return packs[key] || null;
}

function startPackByKey(key, skipPlayModeCheck = false) {
    if (!skipPlayModeCheck) { window.pendingPackKey = key; openPlayModeModal(() => startPackByKey(key, true)); return; }
    if (!masterDatabase || masterDatabase.length === 0) {
        showToast('Loading cards, please try again in a moment.');
        setTimeout(() => startPackByKey(key), 800);
        return;
    }
    activeDeckId = null;
    favoritesOnly = false;
    if (key === 'escalation') { startProgressiveGame(); showGameView(); return; }
    const pack = getCuratedPackSelection(key);
    if (!pack) { showToast('Unknown pack.'); return; }
    applyRoundSelection({
        modules: pack.modules,
        topics: pack.topics,
        mood: pack.mood,
        questions: pack.questions,
        activities: pack.activities,
        multipleChoice: pack.multipleChoice
    }, false, Math.floor(Math.random() * 16) + 10).catch(error => {
        console.error('Could not start selected pack:', error);
        showToast(`Could not start conversation: ${error.message}`);
    });
    document.body.dataset.pack = key;
    window.pendingPackKey = null;
}

function buildProgressiveDeck(count, pillars) {
    activePillars = pillars;
    activeModules = [...pillars];
    activeTopics = null;
    activeMood = 'all';
    includeQuestions = true;
    includeActivities = true;
    includeMultipleChoice = true;
    const filtered = getFilteredCards().filter(card => pillars.includes(card.pillar || 'closer'));
    const unplayed = filtered.filter(card => !playedCardIds.has(card.id));
    const pool = unplayed.length >= count ? unplayed : filtered;
    const byIntensity = {};
    pool.forEach(card => {
        const level = Number(card.intensity) || 1;
        if (!byIntensity[level]) byIntensity[level] = [];
        byIntensity[level].push(card);
    });
    const ordered = [];
    [1, 2, 3, 4].forEach(level => {
        const arr = byIntensity[level] ? [...byIntensity[level]] : [];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        ordered.push(...arr);
    });
    return ordered.slice(0, count).map(card => ({ ...card }));
}

function startProgressiveGame(skipPlayModeCheck = false) {
    if (!skipPlayModeCheck) { openPlayModeModal(() => startProgressiveGame(true)); return; }
    progressiveMode = true;
    progressivePhase = 'nonexplicit';
    activeTurn = Math.random() < 0.5 ? 1 : 0;
    roundStats = { played: 0, passed: 0 };
    passedCardIds = [];
    pickedAnswerer = null;
    pickedAnswererIndex = null;
    unspentDeck = buildProgressiveDeck(50, ['spark', 'heat', 'closer']);
    roundTotalCards = unspentDeck.length;
    updateRoundSummary();
    drawNextCard();
    showGameView();
}

function startProgressiveExplicit(skipPlayModeCheck = false) {
    if (!skipPlayModeCheck) { openPlayModeModal(() => startProgressiveExplicit(true)); return; }
    progressiveMode = true;
    progressivePhase = 'explicit';
    activeTurn = Math.random() < 0.5 ? 1 : 0;
    roundStats = { played: 0, passed: 0 };
    passedCardIds = [];
    pickedAnswerer = null;
    pickedAnswererIndex = null;
    unspentDeck = buildProgressiveDeck(20, ['afterhours']);
    roundTotalCards = unspentDeck.length;
    updateRoundSummary();
    drawNextCard();
    showGameView();
}



function updateCuratedPackMeta() {
    const packs = {
        'deeper-connection': { modules: ['closer'], topics: null, mood: 'deep', questions: true, activities: true, multipleChoice: true },
        'playful-chemistry': { modules: ['spark'], topics: null, mood: 'playful', questions: true, activities: true, multipleChoice: true },
        'build-the-tension': { modules: ['heat'], topics: null, mood: 'romantic', questions: true, activities: true, multipleChoice: true },
        'after-hours': { modules: ['afterhours'], topics: null, mood: 'spicy', questions: true, activities: true, multipleChoice: true },
        'playful': { modules: ['spark', 'heat'], topics: null, mood: 'playful', questions: true, activities: true, multipleChoice: true },
        'first-date': { modules: ['spark', 'closer'], topics: ['spark::Getting to Know You', 'spark::Casual & Everyday', 'spark::Learning & Curiosity', 'spark::Dating Stories', 'spark::Ideal Dates', 'closer::Early Relationship Discovery'], mood: 'all', questions: true, activities: true, multipleChoice: true },
        'deep-talk': { modules: ['closer', 'together'], topics: null, mood: 'deep', questions: true, activities: true, multipleChoice: true },
        'travel-night': { modules: ['spark', 'together'], topics: ['spark::Adventure & Travel', 'together::Adventure & Travel', 'spark::Sports & Fitness', 'spark::Pets & Animals'], mood: 'all', questions: true, activities: true, multipleChoice: true },
        'reconnection': { modules: ['closer'], topics: null, mood: 'all', questions: true, activities: true, multipleChoice: true },
        'kinky-explorative': { modules: ['afterhours'], topics: null, mood: 'spicy', questions: true, activities: true, multipleChoice: true },
        'long-distance': { modules: ['closer', 'together'], topics: null, mood: 'all', questions: true, activities: true, multipleChoice: true },
        'new-parents': { modules: ['closer', 'together'], topics: null, mood: 'all', questions: true, activities: true, multipleChoice: true },
        'after-fight': { modules: ['closer'], topics: null, mood: 'all', questions: true, activities: true, multipleChoice: true },
        'story-time': { modules: ['closer', 'spark'], topics: STORY_PACK_TOPICS, mood: 'all', questions: true, activities: true, multipleChoice: true }
    };
    const saved = {
        activePillars: [...activePillars],
        activeModules: [...activeModules],
        activeTopics: activeTopics ? [...activeTopics] : null,
        activeMood: activeMood,
        includeQuestions: includeQuestions,
        includeActivities: includeActivities,
        includeMultipleChoice: includeMultipleChoice,
        activeIntensity: activeIntensity
    };
    document.querySelectorAll('.pack-card[data-pack]').forEach(card => {
        const key = card.dataset.pack;
        if (key === 'escalation') {
            const meta = card.querySelector('.pack-meta');
            if (meta) meta.textContent = '50 questions · 60-90 min';
            return;
        }
        const pack = packs[key];
        if (!pack) return;
        activePillars = (pack.modules && pack.modules.length) ? pack.modules : ['spark'];
        activeModules = [...activePillars];
        activeTopics = (pack.topics && pack.topics.length) ? pack.topics : null;
        activeMood = pack.mood || 'all';
        includeQuestions = pack.questions;
        includeActivities = pack.activities;
        includeMultipleChoice = pack.multipleChoice;
        activeIntensity = 'all';
        const filtered = getFilteredCards();
        const available = filtered.length;
        const cap = Math.min(available, 25);
        const lo = Math.min(10, available);
        const hi = cap;
        const estMin = Math.round(lo * 1.5);
        const estMax = Math.round(hi * 2.5);
        const meta = card.querySelector('.pack-meta');
        if (meta) meta.textContent = (available < 10 ? available : '10–25') + ' questions · ' + estMin + '–' + estMax + ' min';
    });
    activePillars = saved.activePillars;
    activeModules = saved.activeModules;
    activeTopics = saved.activeTopics;
    activeMood = saved.activeMood;
    includeQuestions = saved.includeQuestions;
    includeActivities = saved.includeActivities;
    includeMultipleChoice = saved.includeMultipleChoice;
    activeIntensity = saved.activeIntensity;
}

function showHomeView() {
    document.body.classList.add('landing');
    document.getElementById('homeView')?.classList.remove('hidden');
    document.getElementById('exploreView')?.classList.add('hidden');
    document.getElementById('guessMeView')?.classList.add('hidden');
    document.querySelector('main')?.classList.add('hidden');
    document.querySelector('.response-section')?.classList.add('hidden');
    setActiveNavigationView('play');
    const continueCard = document.getElementById('continueCard');
    const hasSaved = !!readStoredValue('closer_unspent_deck') && !!readStoredValue('closer_current_card');
    if (continueCard) {
        continueCard.classList.toggle('hidden', !hasSaved);
    }
    const list = document.getElementById('homeDecksList');
    if (list) {
        list.innerHTML = '';
        const decks = (typeof customDecks !== 'undefined' ? customDecks : []).slice(0, 3);
        if (decks.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = 'No decks yet. Create one from Settings.';
            empty.style.color = 'var(--text-muted)';
            list.appendChild(empty);
        } else {
            decks.forEach(deck => {
                const item = document.createElement('div');
                item.textContent = `${deck.name} (${deck.cardIds.length} cards)`;
                item.style.padding = '6px 0';
                list.appendChild(item);
            });
        }
    }
}
function showGameView() {
    document.body.classList.remove('landing');
    document.getElementById('homeView')?.classList.add('hidden');
    document.getElementById('exploreView')?.classList.add('hidden');
    document.getElementById('guessMeView')?.classList.add('hidden');
    document.querySelector('main')?.classList.remove('hidden');
    document.querySelector('.response-section')?.classList.remove('hidden');
    setActiveNavigationView('play');
    if (!document.querySelector('.modal-overlay:not(.hidden)')) window.scrollTo(0, 0);
}

function setActiveNavigationView(view) {
    document.querySelectorAll('.app-bottom-nav [data-view]').forEach(button => {
        const active = button.dataset.view === view;
        button.classList.toggle('active', active);
        button.setAttribute('aria-current', active ? 'page' : 'false');
    });
}

function showExploreView() {
    document.body.classList.add('landing');
    document.getElementById('homeView')?.classList.add('hidden');
    document.querySelector('main')?.classList.add('hidden');
    document.querySelector('.response-section')?.classList.add('hidden');
    document.getElementById('guessMeView')?.classList.add('hidden');
    document.getElementById('exploreView')?.classList.remove('hidden');
    setActiveNavigationView('explore');
}
window.showExploreView = showExploreView;

let guessMeListener = null;
let guessMeListenerRefs = [];
let guessMeRefreshInFlight = false;
let guessMeRefreshPending = false;
let guessMeReplayStarting = false;
function showGuessMeView() {
    document.body.classList.remove('landing');
    document.getElementById('homeView')?.classList.add('hidden');
    document.getElementById('exploreView')?.classList.add('hidden');
    document.querySelector('main')?.classList.add('hidden');
    document.querySelector('.response-section')?.classList.add('hidden');
    document.getElementById('guessMeView')?.classList.remove('hidden');
    setActiveNavigationView('connect');
}
function hideGuessMeView() {
    document.getElementById('guessMeView')?.classList.add('hidden');
}
function reportGuessMeError(error) {
    console.error('You Get Me sync failed:', error);
    const view = document.getElementById('guessMeView');
    if (!view) return;
    let status = document.getElementById('guessMeError');
    if (!status) {
        status = document.createElement('p');
        status.id = 'guessMeError';
        status.className = 'round-builder-status';
        status.setAttribute('role', 'alert');
        view.appendChild(status);
    }
    status.textContent = `Could not sync You Get Me: ${error.message}`;
}
async function refreshGuessMeState() {
    if (!window.roomRef) return;
    if (guessMeRefreshInFlight) {
        guessMeRefreshPending = true;
        return;
    }

    guessMeRefreshInFlight = true;
    try {
        do {
            guessMeRefreshPending = false;
            const roomRef = window.roomRef;
            if (!roomRef) return;
            const paths = [
                'status', 'length', 'vibe', 'currentIndex', 'hostReady', 'partnerReady',
                'scores/host', 'scores/partner', 'question', 'answererUid', 'predictorUid',
                'submissionStatus/answerSubmitted', 'submissionStatus/guessSubmitted',
                'submissionStatus/resolved', 'submissionStatus/scored',
                'replayVotes/host', 'replayVotes/partner', 'questionIds'
            ];
            const snapshots = await Promise.all(paths.map(path => roomRef.child(`guessMe/${path}`).once('value')));
            if (window.roomRef !== roomRef) return;
            const values = Object.fromEntries(paths.map((path, index) => [path, snapshots[index].val()]));
            const submissionStatus = {
                answerSubmitted: values['submissionStatus/answerSubmitted'],
                guessSubmitted: values['submissionStatus/guessSubmitted'],
                resolved: values['submissionStatus/resolved'],
                scored: values['submissionStatus/scored']
            };
            const gm = {
                status: values.status,
                length: values.length,
                vibe: values.vibe,
                currentIndex: values.currentIndex,
                hostReady: values.hostReady,
                partnerReady: values.partnerReady,
                scores: { host: values['scores/host'], partner: values['scores/partner'] },
                question: values.question,
                questionIds: values.questionIds,
                replayVotes: { host: values['replayVotes/host'], partner: values['replayVotes/partner'] },
                answererUid: values.answererUid,
                predictorUid: values.predictorUid,
                submissionStatus
            };
            if (submissionStatus.resolved) {
                const [answerSnapshot, guessSnapshot] = await Promise.all([
                    roomRef.child('guessMe/answer').once('value'),
                    roomRef.child('guessMe/guess').once('value')
                ]);
                if (window.roomRef !== roomRef) return;
                gm.answer = answerSnapshot.val();
                gm.guess = guessSnapshot.val();
            }
            if (gm.status) await renderGuessMe(gm);
        } while (guessMeRefreshPending);
    } catch (error) {
        reportGuessMeError(error);
    } finally {
        guessMeRefreshInFlight = false;
        if (guessMeRefreshPending) refreshGuessMeState();
    }
}
function attachGuessMeListener() {
    if (!window.roomRef) return;
    detachGuessMeListener();
    const paths = [
        'status', 'length', 'vibe', 'question', 'submissionStatus', 'currentIndex',
        'hostReady', 'partnerReady', 'scores', 'replayVotes'
    ];
    guessMeListener = () => { refreshGuessMeState(); };
    guessMeListenerRefs = paths.map(path => window.roomRef.child(`guessMe/${path}`));
    guessMeListenerRefs.forEach(ref => ref.on('value', guessMeListener, error => {
        reportGuessMeError(error);
    }));
    refreshGuessMeState();
}
function detachGuessMeListener() {
    guessMeListenerRefs.forEach(ref => ref.off('value', guessMeListener));
    guessMeListenerRefs = [];
    guessMeListener = null;
}
function leaveGuessMeRoom() {
    detachGuessMeListener();
    detachRoomAccessListeners();
    hideGuessMeView();
    window.roomRef = null;
    window.currentRoomCode = null;
    window.currentRoomRole = null;
    showHomeView();
    setPairStatus('You left the You Get Me session. The room remains available to its members.');
}
window.showGuessMeView = showGuessMeView;
window.hideGuessMeView = hideGuessMeView;
window.attachGuessMeListener = attachGuessMeListener;
window.detachGuessMeListener = detachGuessMeListener;
window.leaveGuessMeRoom = leaveGuessMeRoom;



function getRoundBuilderSelection() {
    const modules = [...document.querySelectorAll('input[name="roundPillar"]:checked')].map(input => input.value);
    const topics = [...document.querySelectorAll('#roundTopics input[type="checkbox"]:checked')].map(input => input.value);
    const allTopics = document.querySelectorAll('#roundTopics input[type="checkbox"]').length;
    return {
        modules,
        topics: topics.length === allTopics ? null : topics,
        mood: document.querySelector('input[name="roundMood"]:checked')?.value || 'all',
        questions: Boolean(document.getElementById('includeQuestions')?.checked),
        activities: Boolean(document.getElementById('includeActivities')?.checked),
        multipleChoice: Boolean(document.getElementById('includeMultipleChoice')?.checked)
    };
}

function getCardsForRoundSelection(selection) {
    return masterDatabase.filter(card => {
        if (!selection.modules.includes(getPillar(card))) return false;
        if (selection.topics !== null && !selection.topics.includes(`${getPillar(card)}::${card.category || 'General'}`)) return false;
        if (selection.mood && selection.mood !== 'all' && getMood(card) !== selection.mood) return false;
        const isMultipleChoice = Array.isArray(card.options) && card.options.length >= 2;
        if (isMultipleChoice) return selection.multipleChoice;
        const promptStyle = card.promptStyle || (card.contextType === 'action' ? 'activity' : 'question');
        return promptStyle === 'activity' ? selection.activities : selection.questions;
    });
}

function renderRoundTopics() {
    const container = document.getElementById('roundTopics');
    if (!container) return;
    const modules = [...document.querySelectorAll('input[name="roundPillar"]:checked')].map(input => input.value);
    const topics = [...new Set(masterDatabase
        .filter(card => modules.includes(getPillar(card)))
        .map(card => `${getPillar(card)}::${card.category || 'General'}`))]
        .sort((a, b) => a.split('::')[1].localeCompare(b.split('::')[1]));
    container.replaceChildren();
    topics.forEach(topic => {
        const [module, category] = topic.split('::');
        const label = document.createElement('label');
        label.className = 'round-topic-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = topic;
        input.checked = activeTopics === null || activeTopics.includes(topic);
        const text = document.createElement('span');
        text.textContent = `${category} · ${module === 'spark' ? 'Spark' : module === 'heat' ? 'Heat' : module === 'closer' ? 'Closer' : module === 'together' ? 'Life Together' : 'After Hours'}`;
        label.append(input, text);
        container.appendChild(label);
    });
    updateRoundMatchCount();
}

function updateRoundMatchCount() {
    const output = document.getElementById('roundMatchCount');
    const startButton = document.getElementById('startRoundBtn');
    if (!output) return;
    const selection = getRoundBuilderSelection();
    const count = getCardsForRoundSelection(selection).length;
    output.textContent = `${count} ${count === 1 ? 'card' : 'cards'} match this round.`;
    if (startButton) startButton.disabled = count === 0;
}

function updateRoundSummary() {
    const summary = document.getElementById('roundSummaryText');
    if (!summary) return;
    if (activeModules.length === 1 && activeModules[0] === 'secrets') {
        summary.textContent = 'Private entries · Not part of a question round';
        return;
    }
    const deckNames = {
        spark: 'Spark',
        heat: 'Heat',
        closer: 'Closer',
        together: 'Life Together',
        afterhours: 'After Hours'
    };
    const deckSummary = activeModules.length === 5
        ? 'All pillars'
        : activeModules.map(module => deckNames[module]).join(' + ') || 'No pillars';
    const topicSummary = activeTopics === null
        ? 'All topics'
        : `${activeTopics.length} ${activeTopics.length === 1 ? 'topic' : 'topics'}`;
    const levelSummary = activeIntensity === 'all'
        ? 'All levels'
        : `${activeIntensity === '1' ? 'Mild' : activeIntensity === '2' ? 'Moderate' : 'Wild'}`;
    if (!roundConfiguredByUser) {
        summary.textContent = '';
        summary.classList.add('hidden');
    } else {
        summary.textContent = `${deckSummary} · ${topicSummary} · ${levelSummary}`;
        summary.classList.remove('hidden');
    }
}

function updateActiveModulePresentation() {
    activeModule = activeModules.length === 1 ? activeModules[0] : 'all';
    const pillar = activePillars.length === 1 ? activePillars[0] : 'spark';
    const moduleMap = { spark: 'sexuality', heat: 'life', closer: 'life', together: 'life', afterhours: 'explicit' };
    document.body.dataset.module = moduleMap[pillar] || 'sexuality';
    document.body.dataset.pillar = pillar;
    updateIntensityLabels(activeModule);
    updateIntensityFilterVisibility();
    updateSectionView();
    updateRoundSummary();
}

function updateIntensityFilterVisibility() {
    const onlyDeepConnection = activeModules.length === 1 && activeModules[0] === 'life';
    const intensityBar = document.getElementById('intensityBar');
    if (intensityBar) intensityBar.classList.toggle('hidden', onlyDeepConnection);
    // round builder intensity group follows the checked decks
    updateRoundIntensityVisibility();
}

function updateRoundIntensityVisibility() {
    const checked = [...document.querySelectorAll('input[name="roundPillar"]:checked')].map(input => input.value);
    const onlyDeepConnection = checked.length === 1 && checked[0] === 'life';
    const group = document.getElementById('roundIntensityGroup');
    if (group) group.classList.toggle('hidden', onlyDeepConnection);
}

async function applyRoundSelection(selection, startLight = false, questionCount = null) {
    if (selection.modules.length === 0) {
        const status = document.getElementById('roundBuilderStatus');
        if (status) status.textContent = 'Choose at least one deck to start.';
        return false;
    }
    if (!browseMode && window.roomRef && window.currentRoomRole === 'partner') {
        const message = 'The host chooses the pack and starts the shared conversation.';
        const status = document.getElementById('roundBuilderStatus');
        if (status) status.textContent = message;
        showToast(message);
        return false;
    }
    if (activeDeckId) {
        activeDeckId = null;
        localStorage.removeItem('closer_active_deck');
    }
    activePillars = (selection.modules && selection.modules.length) ? selection.modules : ['spark'];
    activeModules = [...activePillars];
    roundConfiguredByUser = true;
    if (selection.modules.length === 1 && selection.modules[0] === 'life') {
        selection.intensity = 'all';
    }
    activeTopics = (selection.topics && selection.topics.length) ? selection.topics : null;
    activeIntensity = startLight ? '0' : 'all';
    activeMood = selection.mood || 'all';
    includeQuestions = selection.questions;
    includeActivities = selection.activities;
    includeMultipleChoice = selection.multipleChoice;
    if (questionCount !== null && questionCount !== undefined) {
        activeQuestionCount = questionCount;
    } else {
        const qc = document.getElementById('roundQuestionCount');
        if (qc) {
            activeQuestionCount = qc.value ? parseInt(qc.value, 10) : null;
        }
    }
    activeTurn = Math.random() < 0.5 ? 1 : 0;
    progressiveMode = false;
    progressivePhase = null;
    passedCardIds = [];
roundStats = { played: 0, passed: 0 };
    undoStack = [];
    pickedAnswerer = null;
    pickedAnswererIndex = null;
    activePromptStyle = includeQuestions && includeActivities
        ? 'all'
        : includeActivities ? 'activity' : 'question';
    warmUpEnabled = startLight;
    if (activeGameMode === 'compare-first') exitCompareFirstMode();
    if (activeGameMode === 'deep') {
        activeGameMode = 'classic';
        document.getElementById('gameModeSelect').value = 'classic';
    }
    document.querySelectorAll('.mood-btn').forEach(button => {
        const selected = button.dataset.mood === activeMood;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    updateQuestionTypeSelection(activePromptStyle, false, false);
    updateActiveModulePresentation();
    rebuildUnspentDeck();
    updateRoundSummary();
    try { localStorage.setItem('closer_round_filters', JSON.stringify({ activePillars, activeTopics, activeMood, includeQuestions, includeActivities, includeMultipleChoice })); } catch (e) {}

    const sharedHostStart = !browseMode && window.roomRef && window.currentRoomRole === 'host';
    currentCard = null;
    drawNextCard(false, !sharedHostStart);
    if (!currentCard) {
        const message = 'No cards match this selection yet. Try another pack or check that cards have loaded.';
        const status = document.getElementById('roundBuilderStatus');
        if (status) status.textContent = message;
        showToast(message);
        return false;
    }
    if (sharedHostStart && currentCard.module === 'explicit') {
        const message = 'Explicit cards cannot be started in a paired room.';
        const status = document.getElementById('roundBuilderStatus');
        if (status) status.textContent = message;
        showToast(message);
        return false;
    }
    if (sharedHostStart) {
        try {
            await window.roomRef.child('activeCard').set({
                ...currentCard,
                sharedRoundStartedAt: Date.now()
            });
        } catch (error) {
            console.error('Could not sync the shared round start:', error);
            const message = `Could not start the shared conversation because room sync failed: ${error.message}`;
            const status = document.getElementById('roundBuilderStatus');
            if (status) status.textContent = message;
            showToast('Room sync failed. Check your connection and try starting again.');
            return false;
        }
    }
    closeRoundBuilder();
    showGameView();
    return true;
}

function openRoundBuilder(isEditing = false) {
    const modal = document.getElementById('roundBuilderModal');
    if (!modal) return;
    modal.dataset.editing = String(isEditing);
    setModalOpen(modal, true);
    const title = document.getElementById('roundBuilderTitle');
    const intro = document.getElementById('roundBuilderIntro');
    const startButton = document.getElementById('startRoundBtn');
    if (title) title.textContent = isEditing ? 'Edit current round' : 'Start new conversation';
    if (intro) intro.textContent = isEditing
        ? 'Change the filters for a new round. Your current progress will be reset.'
        : 'Pick a curated pack or build your own custom conversation below.';
    if (startButton) startButton.textContent = isEditing ? 'Apply & restart round' : 'Start conversation';
    modal.dataset.selectedPack = '';
    document.querySelectorAll('#curatedTab .pack-card').forEach(packCard => {
        packCard.classList.remove('selected');
        packCard.setAttribute('aria-pressed', 'false');
    });
    // Reset tabs to Curated
    document.querySelectorAll('.round-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    const curatedTabBtn = document.querySelector('.round-tab[data-tab="curated"]');
    if (curatedTabBtn) { curatedTabBtn.classList.add('active'); curatedTabBtn.setAttribute('aria-selected', 'true'); }
    document.getElementById('curatedTab')?.classList.remove('hidden');
    document.getElementById('customTab')?.classList.add('hidden');
    document.getElementById('saveCustomDeckBtn')?.classList.add('hidden');
    document.querySelector('#roundBuilderModal .round-builder-actions')?.classList.add('single-action');
    try {
        document.querySelectorAll('input[name="roundPillar"]').forEach(input => {
            input.checked = activePillars.includes(input.value);
        });
        const mood = document.querySelector(`input[name="roundMood"][value="${activeMood}"]`);
        if (mood) mood.checked = true;
        const iq = document.getElementById('includeQuestions'); if (iq) iq.checked = includeQuestions;
        const ia = document.getElementById('includeActivities'); if (ia) ia.checked = includeActivities;
        const imc = document.getElementById('includeMultipleChoice'); if (imc) imc.checked = includeMultipleChoice;
        const status = document.getElementById('roundBuilderStatus');
        if (status) status.textContent = '';
        renderRoundTopics();
        updateRoundIntensityVisibility();
        document.querySelectorAll('input[name="roundPillar"]').forEach(input => {
            input.onchange = () => {
                activeTopics = null;
                renderRoundTopics();
                updateRoundIntensityVisibility();
                updateRoundMatchCount();
            };
        });
        const content = document.querySelector('.round-builder-content');
        if (content) content.scrollTop = 0;
        const qc = document.getElementById('roundQuestionCount');
        if (qc) {
            qc.value = activeQuestionCount ? String(activeQuestionCount) : '';
            qc.onchange = () => { activeQuestionCount = qc.value ? parseInt(qc.value, 10) : null; };
        }
        document.getElementById('closeRoundBuilderBtn')?.focus();
    } catch (e) {
        console.error('openRoundBuilder error', e);
    }
}

function closeRoundBuilder() {
    const modal = document.getElementById('roundBuilderModal');
    if (!modal) return;
    modal.dataset.editing = 'false';
    const title = document.getElementById('roundBuilderTitle');
    const intro = document.getElementById('roundBuilderIntro');
    const startButton = document.getElementById('startRoundBtn');
    if (title) title.textContent = 'Start new conversation';
    if (intro) intro.textContent = 'Pick a curated pack or build your own custom conversation below.';
    if (startButton) startButton.textContent = 'Start conversation';
    setModalOpen(modal, false);
}

function openGuessMeSetup() {
    const modal = document.getElementById('guessMeSetupModal');
    if (!modal) return;
    // reset selection
    ['#guessMeVibeChips'].forEach(selector => {
        document.querySelectorAll(`${selector} .filter-chip`).forEach((button, index) => {
            const selected = index === 0;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        const lengthInput = document.getElementById('guessMeQuestionCount');
        if (lengthInput) lengthInput.value = '20';
    });
    const createButton = document.getElementById('guessMeCreateRoomBtn');
    if (createButton) createButton.disabled = false;
    const status = document.getElementById('guessMeSetupStatus');
    if (status) status.textContent = '';
    setModalOpen(modal, true);
}
function closeGuessMeSetup() {
    setModalOpen(document.getElementById('guessMeSetupModal'), false);
}
function getGuessMeSelection() {
    const lengthInput = document.getElementById('guessMeQuestionCount');
    const vibeBtn = document.querySelector('#guessMeVibeChips .filter-chip.active');
    const length = Number(lengthInput?.value);
    const vibe = vibeBtn?.dataset.vibe;
    if (!Number.isInteger(length) || length < 1 || length > 100) {
        throw new Error('Choose a round length between 1 and 100 questions.');
    }
    return {
        length,
        vibe: ['mixed', 'playful', 'romantic', 'deep'].includes(vibe) ? vibe : 'mixed'
    };
}
window.openGuessMeSetup = openGuessMeSetup;
window.closeGuessMeSetup = closeGuessMeSetup;
window.getGuessMeSelection = getGuessMeSelection;


function setCardActionStatus(message) {
    const status = document.getElementById('cardActionStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('hidden', !message);
}

function setPublishStatus(message) {
    const status = document.getElementById('publishStatus');
    if (status) status.textContent = message;
}

function stopModeTimer() {
    if (modeTimer) clearInterval(modeTimer);
    modeTimer = null;
}

function renderModeTimer(reset = true) {
    const timerBar = document.getElementById('actionTimerBar');
    if (!timerBar) return;
    stopModeTimer();

    if (activeGameMode === 'classic' || activeGameMode === 'compare-first') {
        timerBar.classList.add('hidden');
        return;
    }

    const duration = 120;
    if (reset) modeTimerRemaining = duration;
    timerBar.classList.remove('hidden');
    document.getElementById('timerLabel').textContent = 'Reflection timer';
    document.getElementById('timerClock').textContent = formatTimer(modeTimerRemaining);
    document.getElementById('timerToggleBtn').textContent = 'Start';
}

function formatTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function updateQuestionTypeSelection(style, announce = false, syncTypes = true) {
    activePromptStyle = style;
    if (syncTypes) {
        includeQuestions = style !== 'activity';
        includeActivities = style !== 'question';
    }
    const questionToggle = document.getElementById('includeQuestions');
    const activityToggle = document.getElementById('includeActivities');
    const multipleChoiceToggle = document.getElementById('includeMultipleChoice');
    if (questionToggle) questionToggle.checked = includeQuestions;
    if (activityToggle) activityToggle.checked = includeActivities;
    if (multipleChoiceToggle) multipleChoiceToggle.checked = includeMultipleChoice;
    const settingsMultipleChoiceToggle = document.getElementById('settingsIncludeMultipleChoice');
    if (settingsMultipleChoiceToggle) settingsMultipleChoiceToggle.checked = includeMultipleChoice;
    const labels = {
        all: 'All question types',
        question: 'Questions to answer',
        activity: 'Activities to try'
    };
    document.querySelectorAll('.prompt-style-btn').forEach(btn => {
        const isActive = btn.dataset.promptStyle === style;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
    const questionTypeSummary = document.getElementById('questionTypeSummary');
    if (questionTypeSummary) questionTypeSummary.textContent = labels[style];
    const confirmation = document.getElementById('questionTypeConfirmation');
    if (confirmation) confirmation.textContent = announce ? `${labels[style]} selected.` : '';
}

function drawNextCard(isRemoteUpdate = false, syncSharedCard = true) {
    if (isCompareFirstSessionActive() && window.currentRoomRole !== 'host' && !isRemoteUpdate) {
        setCardActionStatus('Only the host can advance the Compare First session.');
        return;
    }
    if (activeGameMode !== 'compare-first' && unspentDeck.length === 0 && warmUpEnabled) {
        let nextLevel = Number(activeIntensity) + 1;
        while (nextLevel <= 3 && unspentDeck.length === 0) {
            activeIntensity = String(nextLevel);
            rebuildUnspentDeck();
            nextLevel += 1;
        }
        if (unspentDeck.length === 0) {
            warmUpEnabled = false;
            activeIntensity = '3';
            rebuildUnspentDeck();
        }
        document.querySelectorAll('.intensity-btn').forEach(button => {
            const selected = button.dataset.level === activeIntensity;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        updateRoundSummary();
    } else if (activeGameMode !== 'compare-first' && unspentDeck.length === 0) {
        const isCuratedPack = document.body.dataset.pack && document.body.dataset.pack !== 'escalation';
        if (!isCuratedPack) {
            rebuildUnspentDeck();
        }
    }
    if (unspentDeck.length === 0) {
        document.getElementById('cardFollowUp')?.classList.add('hidden');
        if (!masterDatabase || masterDatabase.length === 0) {
            return; // cards not loaded yet; avoid false 'Round complete'
        }
        if (activeGameMode === 'compare-first' && compareFirstRoundIndex > 0) {
            completeCompareFirstRound();
            return;
        }
        currentCard = null;
        if (progressiveMode && progressivePhase === 'nonexplicit') {
            const prompt = document.getElementById('cardPrompt');
            if (prompt) {
                prompt.innerHTML = '';
                prompt.style.textAlign = 'center';
                const title = document.createElement('strong');
                title.textContent = 'Slow Burn complete';
                const summary = document.createElement('p');
                summary.textContent = `You played ${roundStats.played} cards. Continue to the explicit 20-question game, or start a new conversation?`;
                const yes = document.createElement('button');
                yes.type = 'button';
                yes.className = 'btn-primary';
                yes.textContent = 'Continue to explicit game';
                yes.style.marginTop = '12px';
                yes.style.display = 'block';
                yes.style.marginLeft = 'auto';
                yes.style.marginRight = 'auto';
                yes.onclick = () => { startProgressiveExplicit(); };
                const no = document.createElement('button');
                no.type = 'button';
                no.className = 'btn-secondary';
                no.textContent = 'Start new conversation';
                no.style.marginTop = '12px';
                no.style.display = 'block';
                no.style.marginLeft = 'auto';
                no.style.marginRight = 'auto';
                no.onclick = () => { showHomeView(); openRoundBuilder(); };
                prompt.append(title, summary, yes, no);
            }
            const nextCardBtn = document.getElementById('nextCardBtn');
            if (nextCardBtn) nextCardBtn.disabled = true;
            const passCardBtn = document.getElementById('passCardBtn');
            if (passCardBtn) passCardBtn.disabled = true;
            document.getElementById('warmUpNextBtn')?.classList.add('hidden');
            stopModeTimer();
            document.getElementById('actionTimerBar')?.classList.add('hidden');
            return;
        }
        if (progressiveMode && progressivePhase === 'explicit') {
            progressiveMode = false;
            progressivePhase = null;
        }
        if (browseMode) {
            currentCard = null;
            const prompt = document.getElementById('cardPrompt');
            if (prompt) {
                prompt.innerHTML = '';
                prompt.style.textAlign = 'center';
                const title = document.createElement('strong');
                title.textContent = "End of preview";
                const summary = document.createElement('p');
                summary.textContent = "You've reached the end of this preview. Start a real conversation, or keep previewing.";
                const begin = document.createElement('button');
                begin.type = 'button';
                begin.className = 'btn-primary';
                begin.textContent = 'Begin conversation';
                begin.style.marginTop = '12px';
                begin.style.display = 'block';
                begin.style.marginLeft = 'auto';
                begin.style.marginRight = 'auto';
                begin.onclick = () => {
                    browseMode = false;
                    const browseIndicator = document.getElementById('browseIndicator');
                    if (browseIndicator) browseIndicator.classList.add('hidden');
                    roundStats = { played: 0, passed: 0 };
                    passedCardIds = [];
                    currentCard = null;
                    rebuildUnspentDeck();
                    updateRoundSummary();
                    drawNextCard();
                    showGameView();
                };
                const cont = document.createElement('button');
                cont.type = 'button';
                cont.className = 'btn-secondary';
                cont.textContent = 'Continue preview';
                cont.style.marginTop = '8px';
                cont.style.display = 'block';
                cont.style.marginLeft = 'auto';
                cont.style.marginRight = 'auto';
                cont.onclick = () => {
                    roundStats = { played: 0, passed: 0 };
                    passedCardIds = [];
                    currentCard = null;
                    rebuildUnspentDeck();
                    updateRoundSummary();
                    drawNextCard();
                    showGameView();
                };
                prompt.append(title, summary, begin, cont);
            }
            const nextCardBtn = document.getElementById('nextCardBtn');
            if (nextCardBtn) nextCardBtn.disabled = true;
            const passCardBtn = document.getElementById('passCardBtn');
            if (passCardBtn) passCardBtn.disabled = true;
            stopModeTimer();
            document.getElementById('actionTimerBar')?.classList.add('hidden');
            return;
        }
    // Round is complete: clear saved game so "Continue" no longer shows.
    try { localStorage.removeItem('closer_unspent_deck'); localStorage.removeItem('closer_current_card'); } catch (e) {}
    const prompt = document.getElementById('cardPrompt');
    if (prompt) {
        prompt.innerHTML = '';
        prompt.style.textAlign = 'center';
        const title = document.createElement('strong');
        title.textContent = 'Conversation complete';
        const summary = document.createElement('p');
        summary.textContent = `You played ${roundStats.played} cards and passed ${roundStats.passed}.`;
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'btn-primary';
        again.textContent = 'Start new conversation';
        again.style.marginTop = '12px';
        again.style.display = 'block';
        again.style.marginLeft = 'auto';
        again.style.marginRight = 'auto';
        again.onclick = () => {
            roundStats = { played: 0, passed: 0 };
            showHomeView();
            openRoundBuilder();
        };
        const activePack = document.body.dataset.pack;
        const isCuratedPack = activePack && activePack !== 'escalation';
        if (isCuratedPack) {
            const samePack = document.createElement('button');
            samePack.type = 'button';
            samePack.className = 'btn-primary';
            samePack.textContent = 'Play another round (same pack)';
            samePack.style.marginTop = '8px';
            samePack.style.display = 'block';
            samePack.style.marginLeft = 'auto';
            samePack.style.marginRight = 'auto';
            samePack.onclick = () => {
                roundStats = { played: 0, passed: 0 };
                passedCardIds = [];
                currentCard = null;
                rebuildUnspentDeck();
                updateRoundSummary();
                drawNextCard();
                showGameView();
            };
            prompt.append(title, summary, again, samePack);
        } else {
            prompt.append(title, summary, again);
        }
        if (passedCardIds.length > 0) {
            const missed = document.createElement('button');
            missed.type = 'button';
            missed.className = 'btn-secondary';
            missed.textContent = 'Answer missed questions';
            missed.style.marginTop = '8px';
            missed.style.display = 'block';
            missed.style.marginLeft = 'auto';
            missed.style.marginRight = 'auto';
            missed.onclick = () => {
                const cards = passedCardIds.map(id => masterDatabase.find(c => c.id === id)).filter(Boolean);
                const unique = [...new Map(cards.map(c => [c.id, c])).values()];
                if (unique.length === 0) { showToast('No missed questions to replay.'); return; }
                unspentDeck = [...unique];
                for (let i = unspentDeck.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [unspentDeck[i], unspentDeck[j]] = [unspentDeck[j], unspentDeck[i]];
                }
                roundTotalCards = unspentDeck.length;
                roundStats = { played: 0, passed: 0 };
                passedCardIds = [];
                currentCard = null;
                drawNextCard();
                showGameView();
            };
            prompt.append(missed);
        }
    }
    const nextCardBtn = document.getElementById('nextCardBtn');
    if (nextCardBtn) nextCardBtn.disabled = true;
    const passCardBtn = document.getElementById('passCardBtn');
    if (passCardBtn) passCardBtn.disabled = true;
    document.getElementById('warmUpNextBtn')?.classList.add('hidden');
    stopModeTimer();
    document.getElementById('actionTimerBar')?.classList.add('hidden');
    if (activeGameMode === 'compare-first') {
        const setupStatus = document.getElementById('compareFirstSetupStatus');
        if (setupStatus) setupStatus.textContent = 'No multiple-choice cards match those module and level filters.';
    }
    return;
    }

    currentCard = { ...unspentDeck.pop(), roundId: createCardRoundId(), turnIndex: activeTurn };
    if (currentCard?.id && !browseMode) {
        playedCardIds.add(currentCard.id);
        localStorage.setItem('closer_played_cards', JSON.stringify([...playedCardIds]));
        syncPlayedCardsToRoom();
    }
    roundStats.played += 1;
    if (activeGameMode === 'compare-first') {
        compareFirstRoundIndex += 1;
        currentCard.compareFirst = true;
        currentCard.compareFirstRoundId = compareFirstRoundId;
        currentCard.compareFirstIndex = compareFirstRoundIndex;
        currentCard.compareFirstTotal = compareFirstRoundTotal;
        currentCard.compareFirstModules = compareFirstModules;
        currentCard.compareFirstLevels = compareFirstLevels;
    }
    renderCard(currentCard);
    if (!browseMode) {
        try {
            localStorage.setItem('closer_unspent_deck', JSON.stringify(unspentDeck));
            localStorage.setItem('closer_current_card', JSON.stringify(currentCard));
        } catch (e) {}
    }
    updateCompareFirstControls();

    if (syncSharedCard && window.roomRef && window.currentRoomRole === 'host' && !browseMode
        && !isRemoteUpdate && currentCard.module !== 'explicit') {
        window.roomRef.child('activeCard').set({
            ...currentCard,
            sharedRoundStartedAt: Date.now()
        }).catch(error => {
            console.error('Could not sync the active room card:', error);
            const message = `Card shown on this device, but room sync failed: ${error.message}`;
            setCardActionStatus(message);
            showToast('Room sync failed. Your partner may not see this card.');
        });
    }
}

function updateCardProgressSlider() {
    const slider = document.getElementById('cardProgressSlider');
    const fill = document.getElementById('cardProgressFill');
    const text = document.getElementById('cardProgressText');
    if (!slider || !fill || !text) return;
    let played = 0;
    let total = 0;
    if (currentCard?.compareFirst) {
        played = currentCard.compareFirstIndex || 0;
        total = currentCard.compareFirstTotal || 0;
    } else {
        played = (roundStats?.played || 0);
        total = roundTotalCards || 0;
    }
    if (!total) {
        slider.classList.add('hidden');
        return;
    }
    slider.classList.remove('hidden');
    const pct = Math.min(100, Math.max(0, (played / total) * 100));
    fill.style.width = pct + '%';
    text.textContent = `${played} / ${total}`;
}
function updateCompareFirstControls() {
    const nextCardBtn = document.getElementById('nextCardBtn');
    const passCardBtn = document.getElementById('passCardBtn');
    if (!nextCardBtn) return;
    if (!currentCard?.compareFirst) {
        const label = nextCardBtn.querySelector('.btn-label');
        if (label) label.textContent = 'Next';
        const canAdvance = Boolean(currentCard) && canCurrentUserAdvanceCard();
        nextCardBtn.disabled = !canAdvance;
        if (passCardBtn) {
            passCardBtn.classList.remove('hidden');
            passCardBtn.disabled = !canAdvance;
        }
        return;
    }
    if (passCardBtn) {
        passCardBtn.classList.add('hidden');
        passCardBtn.disabled = true;
    }
    const isHost = window.currentRoomRole === 'host';
    const answersSubmitted = Boolean(cardAnswerOwn && cardAnswerPartner);
    const label = nextCardBtn.querySelector('.btn-label');
    if (label) label.textContent = currentCard.compareFirstIndex >= currentCard.compareFirstTotal
        ? 'Finish poll round'
        : `Next poll · ${currentCard.compareFirstIndex}/${currentCard.compareFirstTotal}`;
    nextCardBtn.disabled = !isHost || !answersSubmitted;
}

function isCompareFirstSessionActive() {
    return activeGameMode === 'compare-first'
        || Boolean(currentCard?.compareFirst || currentCard?.compareFirstComplete);
}

function hasExplicitAgeConfirmation() {
    return readStoredValue(EXPLICIT_AGE_CONFIRMATION_KEY) === 'true';
}

async function loadExplicitCards() {
    if (explicitCardsLoaded) return true;
    try {
        const response = await fetch('./explicit-cards.json');
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const data = await response.json();
        const existingIds = new Set(masterDatabase.map(card => card.id));
        (data.cards || []).forEach(card => {
            if (card && card.prompt && !existingIds.has(card.id)) {
                masterDatabase.push({ ...card, id: card.id || `explicit-${Date.now()}` });
                existingIds.add(card.id);
            }
        });
        explicitCardsLoaded = true;
        return true;
    } catch (error) {
        console.warn('Explicit cards could not be loaded:', error);
        return false;
    }
}

function resumeExplicitCardBrowserFilter(cardsLoaded = explicitCardsLoaded) {
    const resume = pendingExplicitCardBrowserFilter;
    pendingExplicitCardBrowserFilter = null;
    if (!resume) return false;
    resume(cardsLoaded);
    return true;
}

function cancelExplicitCardBrowserFilter() {
    pendingExplicitCardBrowserFilter = null;
}

function getPlayerIdentifier(index) {
    const role = index === 0 ? 'host' : 'partner';
    const identity = window.currentRoomRole ? roomDisplayNames[role] : playerNames[role];
    const name = identity?.name || (window.currentRoomRole ? (role === 'host' ? 'Host' : 'Partner') : `Player ${index + 1}`);
    const icon = PLAYER_ICONS.includes(identity?.icon) ? identity.icon : playerNames[role].icon;
    return `${icon} ${name}`;
}

function savePlayerIdentity(index, name, icon) {
    const role = index === 0 ? 'host' : 'partner';
    const localName = name.trim().replace(/\s+/g, ' ').slice(0, 24) || `Player ${index + 1}`;
    const localIdentity = { name: localName, icon: PLAYER_ICONS.includes(icon) ? icon : PLAYER_ICONS[index] };
    playerNames[role] = localIdentity;
    const storageKey = index === 0 ? PLAYER_ONE_NAME_KEY : PLAYER_TWO_NAME_KEY;
    localStorage.setItem(`${storageKey}_name`, localIdentity.name);
    localStorage.setItem(`${storageKey}_icon`, localIdentity.icon);
    if (currentCard) renderCard(currentCard);

    if (window.roomRef && window.currentRoomRole === role) {
        window.roomRef.child(`playerNames/${role}`).set(localIdentity).catch(error => {
            console.error('Could not sync your player identity:', error);
            const status = document.getElementById('playerIdentityStatus');
            if (status) status.textContent = `Saved on this device, but could not sync to the room: ${error.message}`;
        });
    }
}

async function selectModule(module) {
    if (module === 'secrets') {
        activeModule = module;
        updateSectionView();
        return;
    }
    if (module === 'explicit' && hasExplicitAgeConfirmation()) {
        await loadExplicitCards();
    }
    // Map legacy module to pillar for filtering.
    const pillarMap = { sexuality: 'spark', life: 'closer', explicit: 'afterhours' };
    activePillars = module === 'life' ? ['closer', 'together'] : [pillarMap[module] || 'closer'];
    activeModules = [module];
    activeTopics = null;
    updateActiveModulePresentation();
    document.querySelectorAll('.module-tab').forEach(tab => {
        const isActive = tab.dataset.module === module;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-pressed', String(isActive));
    });
    activeModule = module;
    activeIntensity = 'all';
    document.querySelectorAll('.intensity-btn').forEach(button => {
        const isActive = button.dataset.level === 'all';
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
    updateSectionView();
    updateRoundSummary();
    rebuildUnspentDeck();
    drawNextCard();
}

function enterCompareFirstModeFromCard(card) {
    compareFirstRestoreState ||= {
        module: activeModule,
        intensity: activeIntensity,
        promptStyle: activePromptStyle
    };
    activeGameMode = 'compare-first';
    compareFirstModules = Array.isArray(card.compareFirstModules)
        ? card.compareFirstModules
        : [card.module];
    compareFirstLevels = Array.isArray(card.compareFirstLevels)
        ? card.compareFirstLevels.map(String)
        : [String(card.intensity)];
    compareFirstRoundId = card.compareFirstRoundId || compareFirstRoundId;
    compareFirstRoundIndex = card.compareFirstIndex || card.compareFirstTotal || 1;
    compareFirstRoundTotal = card.compareFirstTotal || 50;
    activeModule = compareFirstModules[0] || card.module;
    activePromptStyle = 'all';
    document.querySelectorAll('.module-tab').forEach(tab => {
        const isActive = tab.dataset.module === activeModule;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-pressed', String(isActive));
    });
    updateQuestionTypeSelection('all');
    updateSectionView();
    const gameModeSelect = document.getElementById('gameModeSelect');
    if (gameModeSelect) gameModeSelect.value = 'compare-first';
    renderModeTimer();
}

function exitCompareFirstMode() {
    if (compareFirstRestoreState) {
        activeModule = compareFirstRestoreState.module;
        activeIntensity = compareFirstRestoreState.intensity;
        activePromptStyle = compareFirstRestoreState.promptStyle;
        compareFirstRestoreState = null;
        document.querySelectorAll('.module-tab').forEach(tab => {
            const isActive = tab.dataset.module === activeModule;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-pressed', String(isActive));
        });
        document.querySelectorAll('.intensity-btn').forEach(button => {
            const isActive = button.dataset.level === activeIntensity;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
        updateQuestionTypeSelection(activePromptStyle);
        updateSectionView();
    }
    activeGameMode = 'classic';
    compareFirstRoundId = null;
    compareFirstRoundIndex = 0;
    compareFirstRoundTotal = 0;
    document.getElementById('compareFirstComplete')?.classList.add('hidden');
    const gameModeSelect = document.getElementById('gameModeSelect');
    if (gameModeSelect) gameModeSelect.value = 'classic';
    renderModeTimer();
}

async function startCompareFirstSession() {
    const status = document.getElementById('compareFirstSetupStatus');
    const modules = [...document.querySelectorAll('input[name="compareFirstModule"]:checked')].map(input => input.value);
    const levels = [...document.querySelectorAll('input[name="compareFirstLevel"]:checked')].map(input => input.value);
    if (modules.length === 0 || levels.length === 0) {
        if (status) status.textContent = 'Choose at least one module and one level.';
        return;
    }
    if (!window.roomRef || window.currentRoomRole !== 'host') {
        if (status) status.textContent = 'Connect to your partner and create a room as host before starting Compare First.';
        return;
    }

    try {
        const partnerSnapshot = await window.roomRef.child('members/partner').once('value');
        if (!partnerSnapshot.val()) {
            if (status) status.textContent = 'Your partner must join the room before you start the poll round.';
            return;
        }
    } catch (error) {
        console.error('Could not verify the paired room:', error);
        if (status) status.textContent = `Could not check room membership: ${error.message}`;
        return;
    }

    compareFirstRestoreState = {
        module: activeModule,
        intensity: activeIntensity,
        promptStyle: activePromptStyle
    };
    compareFirstModules = modules;
    compareFirstLevels = levels;
    compareFirstRoundId = createCardRoundId();
    compareFirstRoundIndex = 0;
    activeGameMode = 'compare-first';
    activeModule = modules[0];
    activePromptStyle = 'all';
    document.querySelectorAll('.module-tab').forEach(tab => {
        const isActive = tab.dataset.module === activeModule;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-pressed', String(isActive));
    });
    updateQuestionTypeSelection('all');
    updateSectionView();
    renderModeTimer();
    rebuildUnspentDeck();
    compareFirstRoundTotal = Math.min(50, unspentDeck.length);
    if (compareFirstRoundTotal === 0) {
        exitCompareFirstMode();
        rebuildUnspentDeck();
        drawNextCard();
        if (status) status.textContent = 'No multiple-choice cards match those module and level choices.';
        return;
    }
    document.getElementById('gameModeSelect').value = 'compare-first';
    document.getElementById('compareFirstSetup').classList.add('hidden');
    if (status) status.textContent = '';
    setCardActionStatus(`Compare First started: ${compareFirstRoundTotal} polls. Compare and discuss each answer before continuing.`);
    drawNextCard();
    closeDrawer();
}

function renderCompareFirstComplete(card) {
    const answerPanel = document.getElementById('cardAnswerPanel');
    const completePanel = document.getElementById('compareFirstComplete');
    const message = document.getElementById('compareFirstCompleteMessage');
    const hostNote = document.getElementById('compareFirstHostNote');
    if (!completePanel || !message || !hostNote) return;
    detachCardAnswerListeners();
    cardAnswerCard = null;
    cardAnswerOwn = null;
    cardAnswerPartner = null;
    answerPanel?.classList.add('hidden');
    completePanel.classList.remove('hidden');
    setCardActionStatus('');
    document.getElementById('cardPrompt').textContent = 'You completed your multiple-choice round.';
    message.textContent = `${card.compareFirstTotal} polls completed. Take a moment to discuss your answers, then decide whether to answer more polls or move into the regular cards.`;
    const isHost = window.currentRoomRole === 'host';
    document.getElementById('answerMorePollsBtn').disabled = !isHost;
    document.getElementById('continueRegularCardsBtn').disabled = !isHost;
    hostNote.textContent = isHost
        ? 'The host chooses when to continue.'
        : 'Discuss the results with your partner. The host chooses when to continue.';
    const nextCardBtn = document.getElementById('nextCardBtn');
    if (nextCardBtn) {
        nextCardBtn.disabled = true;
        const label = nextCardBtn.querySelector('.btn-label');
        if (label) label.textContent = 'Poll complete';
    }
    const gameModeSelect = document.getElementById('gameModeSelect');
    if (gameModeSelect) gameModeSelect.value = 'compare-first';
}

function completeCompareFirstRound() {
    if (window.currentRoomRole !== 'host' || !currentCard?.compareFirst) return;
    const completeCard = {
        id: `compare-first-complete-${compareFirstRoundId}`,
        module: currentCard.module,
        category: 'Compare First',
        intensity: currentCard.intensity,
        prompt: 'You completed your multiple-choice round.',
        promptStyle: 'question',
        compareFirstComplete: true,
        compareFirstRoundId,
        compareFirstTotal: compareFirstRoundIndex,
        compareFirstModules,
        compareFirstLevels,
        roundId: createCardRoundId()
    };
    currentCard = completeCard;
    renderCompareFirstComplete(completeCard);
    window.roomRef.child('activeCard').set(completeCard).catch(error => {
        console.error('Could not sync the completed poll round:', error);
        setCardActionStatus(`Poll round completed, but room sync failed: ${error.message}`);
    });
}

function answerMoreCompareFirstPolls() {
    if (window.currentRoomRole !== 'host') return;
    if (unspentDeck.length === 0) rebuildUnspentDeck();
    compareFirstRoundId = createCardRoundId();
    compareFirstRoundIndex = 0;
    compareFirstRoundTotal = Math.min(50, unspentDeck.length);
    if (compareFirstRoundTotal === 0) {
        setCardActionStatus('No more multiple-choice cards match this selection.');
        return;
    }
    drawNextCard();
}

function continueToRegularCards() {
    if (window.currentRoomRole !== 'host') return;
    exitCompareFirstMode();
    document.getElementById('compareFirstSetup')?.classList.add('hidden');
    rebuildUnspentDeck();
    drawNextCard();
}

function canCurrentUserAdvanceCard() {
    if (browseMode) return true; // browse mode: anyone can advance freely
    if (!window.currentRoomRole) return true; // local play: anyone on the device can advance
    if (isCompareFirstSessionActive()) return window.currentRoomRole === 'host';
    if (!turnTakingEnabled) return true; // turn-taking off: keep existing free-advance behavior
    const turnOwnerRole = activeTurn === 1 ? 'partner' : 'host';
    return window.currentRoomRole === turnOwnerRole;
}

function advanceCard(passed = false) {
    if (!canCurrentUserAdvanceCard()) {
        setCardActionStatus(`It is ${getPlayerIdentifier(activeTurn)}'s turn to advance.`);
        return;
    }
    undoStack.push({
        currentCard: currentCard ? { ...currentCard } : null,
        unspentDeck: [...unspentDeck],
        activeTurn,
        passed
    });
    if (undoStack.length > 20) undoStack.shift();
    if (passed && currentCard && !browseMode) {
        roundStats.passed += 1;
        if (!passedCardIds.includes(currentCard.id)) passedCardIds.push(currentCard.id);
        const isCuratedPack = document.body.dataset.pack && document.body.dataset.pack !== 'escalation';
        if (!isCuratedPack) {
            // Return the passed card to the deck so it can appear again later.
            const insertAt = Math.floor(Math.random() * (unspentDeck.length + 1));
            unspentDeck.splice(insertAt, 0, currentCard);
        }
    }
    if (currentCard?.compareFirst) {
        if (window.currentRoomRole !== 'host') {
            setCardActionStatus('The host advances the poll round after you have both submitted and discussed this card.');
            return;
        }
        if (!cardAnswerOwn || !cardAnswerPartner) {
            setCardActionStatus('Wait until both partners submit an answer before continuing to the next poll.');
            return;
        }
        if (currentCard.compareFirstIndex >= currentCard.compareFirstTotal) {
            completeCompareFirstRound();
            return;
        }
    }
if (!passed && !browseMode) {
        if (pickedAnswererIndex !== null) activeTurn = pickedAnswererIndex;
        if (turnTakingEnabled && currentCard) activeTurn = activeTurn === 0 ? 1 : 0;
    }
    pickedAnswerer = null;
    pickedAnswererIndex = null;
    if (currentCard && !browseMode) {
        gameHistory.unshift({
            id: currentCard.id,
            prompt: currentCard.prompt,
            module: currentCard.module,
            passed: !!passed,
            date: new Date().toISOString()
        });
        if (gameHistory.length > 200) gameHistory.length = 200;
        localStorage.setItem('closer_game_history', JSON.stringify(gameHistory));
    }
    const container = document.getElementById('cardFace') || document.getElementById('cardContainer');
    const stack = document.getElementById('cardContainer');
    const preview = document.getElementById('cardPreview');
    const previewPrompt = document.getElementById('cardPreviewPrompt');
    // Capture the upcoming card for the preview.
    const upcoming = unspentDeck.length ? unspentDeck[unspentDeck.length - 1] : null;
    if (upcoming && previewPrompt) previewPrompt.textContent = upcoming.prompt || '';
    if (container) {
        container.classList.add('card-exiting');
        if (stack) stack.classList.add('stack-peek');
        if (preview && browseMode) {
            preview.classList.remove('hidden');
            preview.classList.add('show');
        }
        setTimeout(() => {
            container.classList.remove('card-exiting');
            if (stack) stack.classList.remove('stack-peek');
            if (preview) {
                preview.classList.remove('show');
                preview.classList.add('hidden');
            }
            drawNextCard();
        }, 700);
    } else {
        if (preview) {
            preview.classList.remove('show');
            preview.classList.add('hidden');
        }
        drawNextCard();
    }
}

function undoCard() {
    if (undoStack.length === 0) {
        setCardActionStatus('Nothing to undo.');
        return;
    }
    const state = undoStack.pop();
    currentCard = state.currentCard;
    unspentDeck = [...state.unspentDeck];
    activeTurn = state.activeTurn;
    if (currentCard) renderCard(currentCard);
    setCardActionStatus('Went back.');
}
function renderCard(card) {
const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (card.compareFirstComplete) {
        enterCompareFirstModeFromCard(card);
        renderCompareFirstComplete(card);
        return;
    }
    if (card.compareFirst && activeGameMode !== 'compare-first') {
        enterCompareFirstModeFromCard(card);
    } else if (!card.compareFirst && activeGameMode === 'compare-first') {
        exitCompareFirstMode();
    }
    if (Number.isInteger(card.turnIndex) && [0, 1].includes(card.turnIndex)) activeTurn = card.turnIndex;
    document.getElementById('compareFirstComplete')?.classList.add('hidden');
    setCardActionStatus('');
    const prompt = document.getElementById('cardPrompt');
    if (prompt) prompt.innerText = card.prompt;
    const followUp = document.getElementById('cardFollowUp');
    if (followUp) {
        const followUpText = typeof card.followUp === 'string' ? card.followUp.trim() : '';
        followUp.textContent = followUpText ? `Dig deeper: ${followUpText}` : '';
        followUp.classList.toggle('hidden', !followUpText);
    }
    renderCardAnswerPanel(card);

    const favBtn = document.getElementById('favCardBtn');
    if (favBtn) favBtn.classList.toggle('active', favoriteIds.includes(card.id));
    if (favBtn) favBtn.setAttribute('aria-pressed', String(favoriteIds.includes(card.id)));
    const inDeckBadge = document.getElementById('cardInDeckBadge');
    if (inDeckBadge) {
        const inDeck = (typeof customDecks !== 'undefined') && customDecks.some(d => Array.isArray(d.cardIds) && d.cardIds.includes(card.id));
        inDeckBadge.classList.toggle('hidden', !inDeck);
    }
    const turnIndicator = document.getElementById('turnIndicator');
    if (turnIndicator) {
        if (browseMode) {
            turnIndicator.classList.add('hidden');
        } else {
            const pickedLabel = pickedAnswerer === 'both'
                ? 'Both answer'
                : pickedAnswerer === 'selected'
                    ? `${getPlayerIdentifier(pickedAnswererIndex)} answers first`
                    : null;
            turnIndicator.textContent = pickedLabel || `${getPlayerIdentifier(activeTurn)} answers`;
            turnIndicator.classList.toggle('hidden', !turnTakingEnabled && !pickedAnswerer);
        }
    }
    const browseIndicator = document.getElementById('browseIndicator');
    if (browseIndicator) browseIndicator.classList.toggle('hidden', !browseMode);
    const progressIndicator = document.getElementById('progressIndicator');
    updateCardProgressSlider();
    const announcer = document.getElementById('srAnnouncer');
    if (announcer) {
        if (browseMode) {
            announcer.textContent = `${card.category || 'Card'}.`;
        } else {
            announcer.textContent = `${card.category || 'Card'}. ${getPlayerIdentifier(activeTurn)}'s turn.`;
        }
    }
    const skipHint = document.getElementById('skipHint');
    if (skipHint) skipHint.classList.toggle('hidden', !canCurrentUserAdvanceCard());
    const warmUpNextBtn = document.getElementById('warmUpNextBtn');
    if (warmUpNextBtn) warmUpNextBtn.classList.toggle('hidden', !warmUpEnabled || Number(activeIntensity) >= 4);

    renderModeTimer();
    updateCompareFirstControls();
    const container = document.getElementById('cardFace') || document.getElementById('cardContainer');
    if (container) {
        container.classList.remove('card-exiting');
        container.classList.remove('card-entering');
        container.classList.remove('card-drawn');
        void container.offsetWidth;
        requestAnimationFrame(() => {
            container.classList.add('card-entering');
            setTimeout(() => {
                container.classList.remove('card-entering');
                container.classList.add('card-drawn');
                setTimeout(() => container.classList.remove('card-drawn'), 500);
            }, 450);
        });
    }
    const stack = document.getElementById('cardContainer');
    if (stack) {
        stack.classList.remove('deck-drawn');
        void stack.offsetWidth;
        stack.classList.add('deck-drawn');
        setTimeout(() => stack.classList.remove('deck-drawn'), 420);
    }
    if (container) {
        container.classList.remove('card-exiting');
        container.classList.remove('card-entering');
        void container.offsetWidth;
        requestAnimationFrame(() => {
            container.classList.add('card-entering');
            setTimeout(() => container.classList.remove('card-entering'), 320);
        });
    }
}

function createCardRoundId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function detachCardAnswerListeners() {
    cardAnswerListeners.forEach(({ ref, handler }) => ref.off('value', handler));
    cardAnswerListeners = [];
    if (cardAnswerSeatListener && window.roomRef) {
        window.roomRef.child('members/partner').off('value', cardAnswerSeatListener);
        cardAnswerSeatListener = null;
    }
}

function validCardAnswer(answer, card) {
    return answer
        && answer.roundId === card.roundId
        && Number.isInteger(answer.optionIndex)
        && answer.optionIndex >= 0
        && answer.optionIndex < card.options.length;
}

function updateCardAnswerComparison() {
    const panel = document.getElementById('cardAnswerPanel');
    const optionsContainer = document.getElementById('cardAnswerOptions');
    const submitButton = document.getElementById('submitCardAnswer');
    const status = document.getElementById('cardAnswerStatus');
    const comparison = document.getElementById('cardAnswerComparison');
    if (!panel || !optionsContainer || !submitButton || !status || !comparison || !cardAnswerCard) return;

    const selectedRadio = optionsContainer.querySelector('input[name="cardAnswer"]:checked');
    optionsContainer.querySelectorAll('input[name="cardAnswer"]').forEach((radio, index) => {
        radio.checked = cardAnswerOwn
            ? index === cardAnswerOwn.optionIndex
            : selectedRadio?.value === String(index);
        radio.disabled = Boolean(cardAnswerOwn) || !cardAnswerOwnUid || !cardAnswerPartnerUid;
    });
    submitButton.disabled = Boolean(cardAnswerOwn) || !cardAnswerOwnUid || !cardAnswerPartnerUid;
    comparison.replaceChildren();
    comparison.classList.toggle('hidden', !cardAnswerOwn || !cardAnswerPartner);

    if (cardAnswerOwn && cardAnswerPartner) {
        const matched = cardAnswerOwn.optionIndex === cardAnswerPartner.optionIndex;
        const heading = document.createElement('strong');
        heading.className = matched ? 'answer-match' : 'answer-difference';
        heading.textContent = matched ? 'You agree!' : 'Different answers';
        const ownAnswer = document.createElement('p');
        const partnerAnswer = document.createElement('p');
        const ownLabel = getPlayerIdentifier(cardAnswerOwnUid === cardAnswerRoomRef?.hostUid ? 0 : 1);
        const partnerLabel = getPlayerIdentifier(cardAnswerPartnerUid === cardAnswerRoomRef?.hostUid ? 0 : 1);
        ownAnswer.textContent = `${ownLabel}: ${cardAnswerCard.options[cardAnswerOwn.optionIndex]}`;
        partnerAnswer.textContent = `${partnerLabel}: ${cardAnswerCard.options[cardAnswerPartner.optionIndex]}`;
        comparison.append(heading, ownAnswer, partnerAnswer);
        status.textContent = 'Both answers are in. Talk about what you chose.';
    } else if (cardAnswerOwn) {
        status.textContent = 'Answer submitted privately. Your choices will show together after your partner answers.';
    } else if (!cardAnswerOwnUid) {
        status.textContent = 'Connect to a host-approved room with your partner to compare answers.';
    } else if (!cardAnswerPartnerUid) {
        status.textContent = 'Waiting for your partner to join the room.';
    } else {
        status.textContent = 'Choose an answer. It stays hidden from your partner until both of you submit.';
    }
    updateCompareFirstControls();
}

function attachPartnerAnswerListener() {
    if (!cardAnswerOwn || !cardAnswerPartnerUid || !cardAnswerRoomRef?.ref || !cardAnswerCard) return;
    const partnerAnswerRef = cardAnswerRoomRef.ref.child(`answers/current/${cardAnswerPartnerUid}`);
    const handler = snapshot => {
        const answer = snapshot.val();
        cardAnswerPartner = validCardAnswer(answer, cardAnswerCard) ? answer : null;
        updateCardAnswerComparison();
    };
    partnerAnswerRef.on('value', handler, error => {
        console.error('Could not read the partner answer:', error);
        const status = document.getElementById('cardAnswerStatus');
        if (status) status.textContent = 'Could not load your partner’s answer. Check the room access rules.';
    });
    cardAnswerListeners.push({ ref: partnerAnswerRef, handler });
}

async function setupCardAnswerRoom(card, retry = false) {
    if (!window.roomRef || !card.roundId || !window.firebase) {
        updateCardAnswerComparison();
        return;
    }
    const setupKey = `${window.currentRoomCode}:${card.roundId}`;
    if (!retry && cardAnswerSetupKey === setupKey) return;
    detachCardAnswerListeners();
    cardAnswerSetupKey = setupKey;
    cardAnswerRoomRef = {
        ref: window.roomRef,
        hostUid: null
    };
    cardAnswerCard = card;
    cardAnswerOwnUid = null;
    cardAnswerPartnerUid = null;
    cardAnswerOwn = null;
    cardAnswerPartner = null;
    updateCardAnswerComparison();

    try {
        const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
        if (!user || window.roomRef !== cardAnswerRoomRef.ref) return;
        const [hostSnapshot, partnerSnapshot] = await Promise.all([
            cardAnswerRoomRef.ref.child('members/host').once('value'),
            cardAnswerRoomRef.ref.child('members/partner').once('value')
        ]);
        const hostUid = hostSnapshot.val();
        const partnerUid = partnerSnapshot.val();
        if (hostUid !== user.uid && partnerUid !== user.uid) return;
        cardAnswerRoomRef.hostUid = hostUid;
        cardAnswerOwnUid = user.uid;
        cardAnswerPartnerUid = user.uid === hostUid ? partnerUid : hostUid;
        if (!cardAnswerPartnerUid) {
            cardAnswerSeatListener = snapshot => {
                if (snapshot.val() && currentCard?.roundId === card.roundId) {
                    setupCardAnswerRoom(card, true);
                }
            };
            cardAnswerRoomRef.ref.child('members/partner').on('value', cardAnswerSeatListener);
            updateCardAnswerComparison();
            return;
        }

        const ownAnswerRef = cardAnswerRoomRef.ref.child(`answers/current/${user.uid}`);
        const ownHandler = snapshot => {
            const answer = snapshot.val();
            cardAnswerOwn = validCardAnswer(answer, card) ? answer : null;
            if (cardAnswerOwn) attachPartnerAnswerListener();
            updateCardAnswerComparison();
        };
        ownAnswerRef.on('value', ownHandler, error => {
            console.error('Could not load your answer:', error);
            const status = document.getElementById('cardAnswerStatus');
            if (status) status.textContent = 'Could not load your answer. Check the room access rules.';
        });
        cardAnswerListeners.push({ ref: ownAnswerRef, handler: ownHandler });
    } catch (error) {
        console.error('Could not set up paired answer comparison:', error);
        const status = document.getElementById('cardAnswerStatus');
        if (status) status.textContent = `Could not set up answer comparison: ${error.message}`;
    }
}

function renderCardAnswerPanel(card) {
    const panel = document.getElementById('cardAnswerPanel');
    const optionsContainer = document.getElementById('cardAnswerOptions');
    const submitButton = document.getElementById('submitCardAnswer');
    const status = document.getElementById('cardAnswerStatus');
    const comparison = document.getElementById('cardAnswerComparison');
    if (!panel || !optionsContainer || !submitButton) return;
    if (!Array.isArray(card.options) || card.options.length < 2) {
        panel.classList.add('hidden');
        detachCardAnswerListeners();
        cardAnswerSetupKey = null;
        cardAnswerCard = null;
        localAnswerRoundId = null;
        return;
    }

    panel.classList.remove('hidden');
    if (browseMode) {
        optionsContainer.replaceChildren();
        const legend = document.createElement('legend');
        legend.textContent = 'Answer choices · preview only';
        optionsContainer.appendChild(legend);
        card.options.forEach(option => {
            const label = document.createElement('label');
            label.className = 'card-answer-option';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.disabled = true;
            const text = document.createElement('span');
            text.textContent = option;
            label.append(radio, text);
            optionsContainer.appendChild(label);
        });
        submitButton.classList.add('hidden');
        if (status) status.textContent = 'Answers are not collected in preview mode.';
        comparison?.classList.add('hidden');
        detachCardAnswerListeners();
        cardAnswerSetupKey = null;
        cardAnswerCard = null;
        localAnswerRoundId = null;
        return;
    }
    if (!window.roomRef) {
        detachCardAnswerListeners();
        cardAnswerSetupKey = null;
        cardAnswerCard = card;
        if (localAnswerRoundId !== card.roundId) {
            localAnswerRoundId = card.roundId;
            localAnswerIndices = [null, null];
            localAnswerPhase = 'choose';
        }
        renderLocalCardAnswers(card, optionsContainer, submitButton, document.getElementById('cardAnswerStatus'), document.getElementById('cardAnswerComparison'));
        return;
    }
    const pairedSetupKey = `${window.currentRoomCode}:${card.roundId}`;
    optionsContainer.classList.remove('hidden');
    submitButton.classList.remove('hidden');
    if (cardAnswerCard?.roundId !== card.roundId || cardAnswerSetupKey !== pairedSetupKey) {
        detachCardAnswerListeners();
        cardAnswerSetupKey = null;
        cardAnswerCard = card;
        cardAnswerOwnUid = null;
        cardAnswerPartnerUid = null;
        cardAnswerOwn = null;
        cardAnswerPartner = null;
        const legend = document.createElement('legend');
        legend.textContent = 'Choose one answer';
        optionsContainer.replaceChildren(legend);
        card.options.forEach((option, index) => {
            const label = document.createElement('label');
            label.className = 'card-answer-option';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'cardAnswer';
            radio.value = String(index);
            const text = document.createElement('span');
            text.textContent = option;
            label.append(radio, text);
            optionsContainer.appendChild(label);
        });
        submitButton.onclick = async () => {
            const selected = optionsContainer.querySelector('input[name="cardAnswer"]:checked');
            if (!selected || !cardAnswerOwnUid || !cardAnswerPartnerUid || !cardAnswerRoomRef?.ref) return;
            submitButton.disabled = true;
            try {
                await cardAnswerRoomRef.ref.child(`answers/current/${cardAnswerOwnUid}`).set({
                    roundId: card.roundId,
                    optionIndex: Number(selected.value),
                    submittedAt: Date.now()
                });
            } catch (error) {
                console.error('Could not submit the answer:', error);
                const status = document.getElementById('cardAnswerStatus');
                if (status) status.textContent = `Could not submit your answer: ${error.message}`;
                submitButton.disabled = false;
            }
        };
        setupCardAnswerRoom(card);
    }
    updateCardAnswerComparison();
}

function renderLocalCardAnswers(card, optionsContainer, submitButton, status, comparison) {
    if (!status || !comparison) return;
    optionsContainer.replaceChildren();
    comparison.replaceChildren();
    comparison.classList.add('hidden');
    submitButton.classList.remove('hidden');
    submitButton.disabled = false;
    const legend = document.createElement('legend');
    optionsContainer.appendChild(legend);

    if (localAnswerPhase === 'handoff') {
        legend.textContent = 'Answer saved privately';
        submitButton.textContent = `Pass the phone to ${getPlayerIdentifier(1)}`;
        status.textContent = `Your choice is hidden. Hand over the phone, then let ${getPlayerIdentifier(1)} tap to continue.`;
        submitButton.onclick = () => {
            localAnswerPhase = 'choose';
            renderLocalCardAnswers(card, optionsContainer, submitButton, status, comparison);
        };
        return;
    }

    if (localAnswerPhase === 'reveal') {
        const heading = document.createElement('strong');
        heading.textContent = localAnswerIndices[0] === localAnswerIndices[1] ? 'You picked the same answer!' : 'You picked different answers';
        const firstAnswer = document.createElement('p');
        firstAnswer.textContent = `${getPlayerIdentifier(0)}: ${card.options[localAnswerIndices[0]]}`;
        const secondAnswer = document.createElement('p');
        secondAnswer.textContent = `${getPlayerIdentifier(1)}: ${card.options[localAnswerIndices[1]]}`;
        comparison.append(heading, firstAnswer, secondAnswer);
        comparison.classList.remove('hidden');
        optionsContainer.classList.add('hidden');
        submitButton.classList.add('hidden');
        status.textContent = 'Both answers are in. Talk about what you chose.';
        return;
    }

    optionsContainer.classList.remove('hidden');
    const activePlayer = localAnswerIndices[0] === null ? 0 : 1;
    legend.textContent = `${getPlayerIdentifier(activePlayer)}, choose privately`;
    card.options.forEach((option, index) => {
        const label = document.createElement('label');
        label.className = 'card-answer-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'cardAnswer';
        radio.value = String(index);
        const text = document.createElement('span');
        text.textContent = option;
        label.append(radio, text);
        optionsContainer.appendChild(label);
    });
    submitButton.textContent = `Lock in ${getPlayerIdentifier(activePlayer)}’s answer`;
    status.textContent = activePlayer === 0
        ? 'Your answer stays hidden when you hand the phone to your partner.'
        : 'Your partner’s answer is still hidden. Lock in yours to reveal both.';
    submitButton.onclick = () => {
        const selected = optionsContainer.querySelector('input[name="cardAnswer"]:checked');
        if (!selected) {
            status.textContent = 'Choose an answer before locking it in.';
            return;
        }
        localAnswerIndices[activePlayer] = Number(selected.value);
        localAnswerPhase = activePlayer === 0 ? 'handoff' : 'reveal';
        renderLocalCardAnswers(card, optionsContainer, submitButton, status, comparison);
    };
}

// Drawer & Modal Controller Functions
let drawerScrollState = null;
function openDrawer(title, contentHtml) {
    const body = document.body;
    window._lastFocusedBeforeDrawer = document.activeElement;
    const titleEl = document.getElementById('drawerTitle');
    const contentEl = document.getElementById('drawerContent');
    const drawer = document.getElementById('appDrawer');
    const overlay = document.getElementById('drawerOverlay');

    if (deckOptionsElement && contentEl?.contains(deckOptionsElement)) {
        deckOptionsElement.remove();
    }
    const partnerCardsSection = document.getElementById('partnerCardsSection');
    if (partnerCardsSection && contentEl?.contains(partnerCardsSection)) partnerCardsSection.remove();
    if (deckOptionsElement) {
        deckOptionsElement.classList.add('hidden');
        deckOptionsElement.open = false;
    }
    if (titleEl) titleEl.innerText = title;
    if (contentEl) contentEl.innerHTML = contentHtml;
    if (!drawerScrollState) {
        drawerScrollState = {
            scrollY: window.scrollY,
            position: body.style.position,
            top: body.style.top,
            width: body.style.width,
            overflow: body.style.overflow
        };
        body.classList.add('drawer-open');
        body.style.top = `-${drawerScrollState.scrollY}px`;
    }
    if (drawer) drawer.classList.remove('hidden');
    if (overlay) overlay.classList.remove('hidden');
    setTimeout(() => {
        const first = drawer?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (first) first.focus();
    }, 0);
}

function appendDrawerMessage(content, message, className = 'drawer-item') {
    const item = document.createElement('div');
    item.className = className;
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    item.appendChild(paragraph);
    content.appendChild(item);
    return item;
}

function renderJournalDrawerContent(content) {
    content.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'drawer-intro';
    intro.textContent = 'Write a memory or reflection from your date night. Entries stay on this device.';
    content.appendChild(intro);

    const form = document.createElement('form');
    form.className = 'journal-entry-form';
    const label = document.createElement('label');
    label.htmlFor = 'journalEntryText';
    label.textContent = 'Your journal entry';
    const textarea = document.createElement('textarea');
    textarea.id = 'journalEntryText';
    textarea.rows = 3;
    textarea.maxLength = 2000;
    textarea.placeholder = 'What would you like to remember from tonight?';
    textarea.required = true;
    form.append(label, textarea);

    const canLinkCurrentQuestion = currentCard && activeModule !== 'secrets';
    if (canLinkCurrentQuestion) {
        const contextLabel = document.createElement('label');
        contextLabel.className = 'journal-context-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'journalIncludeQuestion';
        const optionText = document.createElement('span');
        optionText.textContent = `Include this question: “${currentCard.prompt}”`;
        contextLabel.append(checkbox, optionText);
        form.appendChild(contextLabel);
    }

    const saveButton = document.createElement('button');
    saveButton.className = 'btn-primary';
    saveButton.type = 'submit';
    saveButton.textContent = 'Save journal entry';
    form.appendChild(saveButton);
    form.onsubmit = event => {
        event.preventDefault();
        const text = textarea.value.trim();
        if (!text) return;
        const includeQuestion = canLinkCurrentQuestion && (document.getElementById('journalIncludeQuestion')?.checked ?? false);
        journalEntries.unshift({
            id: `journal-${Date.now()}`,
            prompt: text,
            date: new Date().toLocaleString(),
            ...(includeQuestion ? { linkedPrompt: currentCard.prompt } : {})
        });
        localStorage.setItem('closer_journal', JSON.stringify(journalEntries));
        renderJournalDrawerContent(content);
    };
    content.appendChild(form);

    if (journalEntries.length === 0) {
        appendDrawerMessage(content, 'No journal entries yet. Add your first memory above.');
        return;
    }

    journalEntries.forEach((entry, index) => {
        const item = document.createElement('div');
        item.className = 'drawer-item';
        const prompt = document.createElement('p');
        prompt.className = 'drawer-item-title';
        prompt.textContent = entry.prompt || entry.text || '';
        if (entry.linkedPrompt) {
            const linkedPrompt = document.createElement('p');
            linkedPrompt.className = 'drawer-item-meta';
            linkedPrompt.textContent = `Question: ${entry.linkedPrompt}`;
            item.append(prompt, linkedPrompt);
        } else {
            item.appendChild(prompt);
        }
        const date = document.createElement('p');
        date.className = 'drawer-item-meta';
        date.textContent = entry.date;
        const actions = document.createElement('div');
        actions.className = 'drawer-item-actions';
        const removeButton = document.createElement('button');
        removeButton.className = 'drawer-remove-btn';
        removeButton.type = 'button';
        removeButton.textContent = 'Delete entry';
        removeButton.setAttribute('aria-label', `Delete journal entry: ${entry.prompt || entry.text || ''}`);
        removeButton.onclick = () => {
            journalEntries.splice(index, 1);
            localStorage.setItem('closer_journal', JSON.stringify(journalEntries));
            renderJournalDrawerContent(content);
        };
        actions.appendChild(removeButton);
        item.append(prompt, date, actions);
        content.appendChild(item);
    });
}

function renderFavoritesDrawerContent(content) {
    content.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'drawer-intro';
    intro.textContent = 'Bookmarked Favorite Questions:';
    content.appendChild(intro);
    const favCards = masterDatabase.filter(card => favoriteIds.includes(card.id));

    if (favCards.length === 0) {
        appendDrawerMessage(content, 'No favorites saved yet. Tap the bookmark icon on any card to save it here!');
        return;
    }

    const playFavBtn = document.createElement('button');
    playFavBtn.className = 'btn-primary';
    playFavBtn.type = 'button';
    playFavBtn.textContent = favoritesOnly ? 'Exit favorites play' : 'Play favorites';
    playFavBtn.onclick = () => {
        favoritesOnly = !favoritesOnly;
        rebuildUnspentDeck();
        drawNextCard();
        renderFavoritesDrawerContent(content);
    };
    content.appendChild(playFavBtn);

    favCards.forEach(card => {
        const item = document.createElement('div');
        item.className = 'drawer-item';
        const prompt = document.createElement('p');
        const category = document.createElement('strong');
        category.textContent = `[${card.category || 'General'}] `;
        prompt.append(category, document.createTextNode(card.prompt));
        const actions = document.createElement('div');
        actions.className = 'drawer-item-actions';
        const removeButton = document.createElement('button');
        removeButton.className = 'drawer-remove-btn';
        removeButton.type = 'button';
        removeButton.textContent = 'Remove bookmark';
        removeButton.setAttribute('aria-label', `Remove bookmark: ${card.prompt}`);
        removeButton.onclick = () => {
            favoriteIds = favoriteIds.filter(id => id !== card.id);
            localStorage.setItem('closer_favs', JSON.stringify(favoriteIds));
            if (currentCard?.id === card.id) {
                const favoriteButton = document.getElementById('favCardBtn');
                if (favoriteButton) {
                    favoriteButton.classList.remove('active');
                    favoriteButton.setAttribute('aria-pressed', 'false');
                }
            }
            renderFavoritesDrawerContent(content);
        };
        actions.appendChild(removeButton);
        item.append(prompt, actions);
        content.appendChild(item);
    });
}

function renderGameHistoryDrawerContent(content) {
    content.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'drawer-intro';
    intro.textContent = 'Recently played cards (this device).';
    content.appendChild(intro);
    if (gameHistory.length === 0) {
        appendDrawerMessage(content, 'No game history yet. Play a round to start tracking.');
        return;
    }
    const clearBtn = document.createElement('button');
    clearBtn.className = 'drawer-remove-btn';
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear history';
    clearBtn.onclick = () => {
        if (!confirm('Clear all game history saved on this device? This cannot be undone.')) return;
        gameHistory = [];
        localStorage.removeItem('closer_game_history');
        if (typeof showToast === 'function') showToast('History cleared.');
        renderGameHistoryDrawerContent(content);
    };
    content.appendChild(clearBtn);
    gameHistory.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'drawer-item';
        const prompt = document.createElement('p');
        prompt.textContent = entry.prompt;
        const meta = document.createElement('p');
        meta.className = 'drawer-item-meta';
        meta.textContent = `${entry.passed ? 'Passed' : 'Played'} · ${entry.module || 'general'} · ${new Date(entry.date).toLocaleString()}`;
        item.append(prompt, meta);
        content.appendChild(item);
    });
}

function renderCardBrowserDrawerContent(content, initialView = 'list') {
    content.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'drawer-intro';
    intro.textContent = 'Preview each question, then add or remove cards from your custom deck.';
    content.appendChild(intro);

    const deckRow = document.createElement('div');
    deckRow.className = 'room-invite-row';
    const deckSelect = document.createElement('select');
    deckSelect.id = 'cardBrowserDeckSelect';
    deckSelect.style.flex = '1';
    const refreshDeckOptions = () => {
        deckSelect.replaceChildren();
        if (customDecks.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Create a deck first';
            deckSelect.appendChild(opt);
            deckSelect.disabled = true;
            return;
        }
        deckSelect.disabled = false;
        customDecks.forEach(deck => {
            const opt = document.createElement('option');
            opt.value = deck.id;
            opt.textContent = `${deck.name} (${deck.cardIds.length})`;
            deckSelect.appendChild(opt);
        });
        if (activeDeckId) deckSelect.value = activeDeckId;
    };
    refreshDeckOptions();
    const createDeckBtn = document.createElement('button');
    createDeckBtn.className = 'btn-secondary';
    createDeckBtn.type = 'button';
    createDeckBtn.textContent = 'New deck';
    createDeckBtn.onclick = () => {
        const name = prompt('Deck name:');
        if (!name || !name.trim()) return;
        const deck = { id: `deck-${Date.now()}`, name: name.trim(), cardIds: [] };
        customDecks.push(deck);
        localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
        renderMyDecks();
        refreshDeckOptions();
        deckSelect.value = deck.id;
        renderList();
    };
    deckRow.append(deckSelect, createDeckBtn);
    content.appendChild(deckRow);

    const viewControls = document.createElement('div');
    viewControls.className = 'card-browser-view-controls';
    viewControls.setAttribute('role', 'group');
    viewControls.setAttribute('aria-label', 'Card preview layout');
    const listViewButton = document.createElement('button');
    listViewButton.type = 'button';
    listViewButton.className = 'btn-secondary';
    listViewButton.textContent = 'List view';
    listViewButton.setAttribute('aria-pressed', String(initialView !== 'card'));
    const cardViewButton = document.createElement('button');
    cardViewButton.type = 'button';
    cardViewButton.className = 'btn-secondary';
    cardViewButton.textContent = 'Card view';
    cardViewButton.setAttribute('aria-pressed', String(initialView === 'card'));
    viewControls.append(listViewButton, cardViewButton);
    content.appendChild(viewControls);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search cards...';
    searchInput.className = 'card-browser-search';
    searchInput.setAttribute('aria-label', 'Search cards');
    content.appendChild(searchInput);

    const filters = document.createElement('div');
    filters.className = 'card-browser-filters';
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filter cards');
    const createFilter = (labelText, id, options) => {
        const label = document.createElement('label');
        label.className = 'card-browser-filter';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        const select = document.createElement('select');
        select.id = id;
        options.forEach(({ value, text }) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            select.appendChild(option);
        });
        label.append(caption, select);
        return { label, select };
    };
    const moduleControl = createFilter('Deck', 'cardBrowserModuleFilter', [
        { value: 'all', text: 'All decks' },
        { value: 'life', text: 'Deep Connection' },
        { value: 'sexuality', text: 'Flame & Passion' },
        { value: 'explicit', text: 'Explicit' }
    ]);
    const intensityControl = createFilter('Intensity', 'cardBrowserIntensityFilter', [
        { value: 'all', text: 'All levels' },
        ...[1, 2, 3, 4].map(level => ({ value: String(level), text: `Level ${level}` }))
    ]);
    const typeControl = createFilter('Card type', 'cardBrowserTypeFilter', [
        { value: 'all', text: 'All types' },
        { value: 'question', text: 'Conversation' },
        { value: 'activity', text: 'Activity' },
        { value: 'multiple-choice', text: 'Multiple choice' }
    ]);
    const moduleFilter = moduleControl.select;
    const intensityFilter = intensityControl.select;
    const typeFilter = typeControl.select;
    const categoryControl = document.createElement('fieldset');
    categoryControl.className = 'card-browser-category-filter';
    categoryControl.id = 'cardBrowserCategoryFilter';
    const categoryLegend = document.createElement('legend');
    categoryLegend.textContent = 'Categories';
    const categoryList = document.createElement('div');
    categoryList.className = 'card-browser-category-list';
    categoryControl.append(categoryLegend, categoryList);
    const selectedCategories = new Set();
    const refreshCategoryOptions = () => {
        const categories = [...new Set((masterDatabase || [])
            .filter(card => moduleFilter.value === 'all' || (card.module || 'general') === moduleFilter.value)
            .map(card => String(card.category || 'General')))]
            .sort((a, b) => a.localeCompare(b));
        for (const selectedCategory of selectedCategories) {
            if (!categories.includes(selectedCategory)) selectedCategories.delete(selectedCategory);
        }
        categoryList.replaceChildren();
        categories.forEach(category => {
            const label = document.createElement('label');
            label.className = 'card-browser-category-option';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = category;
            checkbox.checked = selectedCategories.has(category);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) selectedCategories.add(category);
                else selectedCategories.delete(category);
                renderList();
            });
            const text = document.createElement('span');
            text.textContent = category;
            label.append(checkbox, text);
            categoryList.appendChild(label);
        });
    };
    filters.append(moduleControl.label, intensityControl.label, typeControl.label);
    content.appendChild(filters);
    content.appendChild(categoryControl);

    const clearFiltersButton = document.createElement('button');
    clearFiltersButton.className = 'card-browser-clear-filters';
    clearFiltersButton.type = 'button';
    clearFiltersButton.textContent = 'Clear filters';
    content.appendChild(clearFiltersButton);

    const resultCount = document.createElement('p');
    resultCount.className = 'card-browser-count';
    resultCount.setAttribute('role', 'status');
    resultCount.setAttribute('aria-live', 'polite');
    content.appendChild(resultCount);

    const cardNavigation = document.createElement('div');
    cardNavigation.className = 'card-browser-card-navigation hidden';
    const previousCardButton = document.createElement('button');
    previousCardButton.type = 'button';
    previousCardButton.className = 'btn-secondary';
    previousCardButton.textContent = 'Previous card';
    const cardPosition = document.createElement('span');
    cardPosition.className = 'card-browser-card-position';
    cardPosition.setAttribute('aria-live', 'polite');
    const nextCardButton = document.createElement('button');
    nextCardButton.type = 'button';
    nextCardButton.className = 'btn-secondary';
    nextCardButton.textContent = 'Next card';
    cardNavigation.append(previousCardButton, cardPosition, nextCardButton);
    content.appendChild(cardNavigation);

    const list = document.createElement('div');
    list.className = 'card-browser-list';
    content.appendChild(list);
    let currentView = initialView === 'card' ? 'card' : 'list';
    let displayedLimit = 60;
    let currentCards = [];
    let matchingCardCount = 0;
    let cardIndex = 0;
    const showMoreButton = document.createElement('button');
    showMoreButton.type = 'button';
    showMoreButton.className = 'btn-secondary card-browser-show-more';
    showMoreButton.textContent = 'Show more cards';
    content.appendChild(showMoreButton);

    refreshCategoryOptions();
    let explicitLoadFailed = false;
    const renderList = () => {
        list.replaceChildren();
        if (explicitLoadFailed && moduleFilter.value === 'explicit') {
            showMoreButton.classList.add('hidden');
            cardNavigation.classList.add('hidden');
            resultCount.textContent = 'Explicit cards could not be loaded. Check your connection and try again.';
            appendDrawerMessage(list, resultCount.textContent);
            return;
        }
        const query = (searchInput.value || '').toLowerCase().trim();
        const selectedDeckId = deckSelect.value;
        const deck = customDecks.find(d => d.id === selectedDeckId);
        const matchingCards = (masterDatabase || []).filter(card => {
            const matchesQuery = !query || [card.prompt, card.category, card.module]
                .some(value => String(value || '').toLowerCase().includes(query));
            const matchesModule = moduleFilter.value === 'all' || (card.module || 'general') === moduleFilter.value;
            const matchesIntensity = intensityFilter.value === 'all' || String(card.intensity || 1) === intensityFilter.value;
            const isMultipleChoice = Array.isArray(card.options) && card.options.length >= 2;
            const promptStyle = card.promptStyle || (card.contextType === 'action' ? 'activity' : 'question');
            const cardType = isMultipleChoice ? 'multiple-choice' : promptStyle === 'activity' ? 'activity' : 'question';
            const matchesType = typeFilter.value === 'all' || cardType === typeFilter.value;
            const matchesCategory = selectedCategories.size === 0 || selectedCategories.has(String(card.category || 'General'));
            return matchesQuery && matchesModule && matchesIntensity && matchesType && matchesCategory;
        });
        matchingCardCount = matchingCards.length;
        currentCards = matchingCards.slice(0, displayedLimit);
        cardIndex = Math.min(cardIndex, Math.max(currentCards.length - 1, 0));
        resultCount.textContent = matchingCards.length > currentCards.length
            ? `Showing ${currentCards.length} of ${matchingCards.length} matching cards.`
            : `${matchingCards.length} ${matchingCards.length === 1 ? 'card' : 'cards'} found.`;
        showMoreButton.classList.toggle('hidden', currentView === 'card' || currentCards.length >= matchingCards.length);
        cardNavigation.classList.toggle('hidden', currentView !== 'card' || currentCards.length === 0);
        cardPosition.textContent = currentCards.length ? `${cardIndex + 1} of ${matchingCards.length}` : '0 of 0';
        previousCardButton.disabled = cardIndex === 0;
        nextCardButton.disabled = cardIndex >= matchingCardCount - 1;
        if (currentCards.length === 0) {
            appendDrawerMessage(list, 'No cards match these filters. Try changing or clearing your search and filters.');
            return;
        }
        const cardsToRender = currentView === 'card' ? [currentCards[cardIndex]] : currentCards;
        cardsToRender.forEach(card => {
            const cardView = currentView === 'card';
            const item = document.createElement(cardView ? 'article' : 'div');
            item.className = cardView
                ? 'card-container card-browser-item card-preview-item'
                : 'drawer-item card-browser-item';
            const previewFace = cardView ? document.createElement('div') : null;
            if (previewFace) {
                previewFace.className = 'card-face card-browser-preview-face';
                item.appendChild(previewFace);
            }
            const header = cardView ? document.createElement('div') : null;
            if (header) {
                header.className = 'card-header';
                const categoryBadge = document.createElement('span');
                categoryBadge.className = 'card-badge';
                categoryBadge.textContent = card.category || 'General';
                header.appendChild(categoryBadge);
                previewFace.appendChild(header);
            }
            const body = cardView ? document.createElement('div') : null;
            if (body) {
                body.className = 'card-body';
                previewFace.appendChild(body);
            }
            const prompt = document.createElement('p');
            prompt.className = cardView ? 'card-prompt card-browser-prompt' : 'card-browser-prompt';
            prompt.textContent = card.prompt;
            const meta = document.createElement('p');
            meta.className = 'drawer-item-meta';
            meta.textContent = `${card.module || 'general'} · ${card.category || 'General'} · intensity ${card.intensity || 1}`;
            if (body) body.appendChild(prompt);
            else item.append(prompt, meta);
            if (Array.isArray(card.options) && card.options.length >= 2) {
                const options = document.createElement('p');
                options.className = 'drawer-item-meta card-browser-options';
                options.textContent = card.options.join(' · ');
                if (body) body.appendChild(options);
                else item.appendChild(options);
            }
            const footer = cardView ? document.createElement('div') : null;
            if (footer) {
                footer.className = 'card-footer card-browser-card-footer';
                footer.appendChild(meta);
                previewFace.appendChild(footer);
            }
            const actions = document.createElement('div');
            actions.className = cardView ? 'drawer-item-actions card-browser-card-actions' : 'drawer-item-actions';
            const addBtn = document.createElement('button');
            addBtn.className = cardView ? 'btn-primary card-browser-add-card' : 'drawer-action-btn';
            addBtn.type = 'button';
            const already = deck ? deck.cardIds.includes(card.id) : false;
            addBtn.textContent = already ? 'Remove from deck' : 'Add to deck';
            addBtn.disabled = !deck;
            addBtn.onclick = () => {
                if (!deck) return;
                const cardIndex = deck.cardIds.indexOf(card.id);
                if (cardIndex >= 0) deck.cardIds.splice(cardIndex, 1);
                else deck.cardIds.push(card.id);
                localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
                renderMyDecks();
                refreshDeckOptions();
                deckSelect.value = deck.id;
                renderList();
                showToast(cardIndex >= 0 ? 'Removed from deck.' : 'Added to deck.');
            };
            actions.appendChild(addBtn);
            if (footer) footer.appendChild(actions);
            else item.appendChild(actions);
            list.appendChild(item);
        });
    };
    const setView = view => {
        const cardView = view === 'card';
        currentView = cardView ? 'card' : 'list';
        listViewButton.setAttribute('aria-pressed', String(!cardView));
        cardViewButton.setAttribute('aria-pressed', String(cardView));
        list.classList.toggle('card-view', cardView);
        renderList();
        Array.from(list.children).forEach(item => item.classList.toggle('card-preview-item', cardView));
    };
    listViewButton.addEventListener('click', () => setView('list'));
    cardViewButton.addEventListener('click', () => setView('card'));
    showMoreButton.addEventListener('click', () => {
        displayedLimit += 60;
        renderList();
    });
    previousCardButton.addEventListener('click', () => {
        if (cardIndex === 0) return;
        cardIndex -= 1;
        renderList();
    });
    nextCardButton.addEventListener('click', () => {
        if (cardIndex >= currentCards.length - 1) {
            if (currentCards.length >= matchingCardCount) return;
            displayedLimit += 60;
        }
        cardIndex += 1;
        renderList();
    });
    searchInput.addEventListener('input', renderList);
    moduleFilter.addEventListener('change', async () => {
        explicitLoadFailed = false;
        if (moduleFilter.value === 'explicit' && !hasExplicitAgeConfirmation()) {
            moduleFilter.value = 'all';
            pendingExplicitCardBrowserFilter = cardsLoaded => {
                if (!moduleFilter.isConnected) return;
                moduleFilter.value = 'explicit';
                explicitLoadFailed = !cardsLoaded;
                refreshCategoryOptions();
                renderList();
            };
            refreshCategoryOptions();
            renderList();
            setModalOpen(document.getElementById('explicitAgeGate'), true);
            return;
        }
        if (moduleFilter.value === 'explicit') {
            explicitLoadFailed = !(await loadExplicitCards());
        }
        refreshCategoryOptions();
        renderList();
    });
    [intensityFilter, typeFilter].forEach(filter => {
        filter.addEventListener('change', renderList);
    });
    clearFiltersButton.addEventListener('click', () => {
        searchInput.value = '';
        moduleFilter.value = 'all';
        intensityFilter.value = 'all';
        typeFilter.value = 'all';
        explicitLoadFailed = false;
        cancelExplicitCardBrowserFilter();
        selectedCategories.clear();
        refreshCategoryOptions();
        renderList();
    });
    deckSelect.addEventListener('change', renderList);
    setView(initialView);
    renderList();
}

function createDeckHome() {
    const name = prompt('Deck name:');
    if (!name || !name.trim()) return;
    const deck = { id: `deck-${Date.now()}`, name: name.trim(), cardIds: [] };
    customDecks.push(deck);
    localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
    renderMyDecks();
    showToast(`Created deck "${deck.name}".`);
}
window.createDeckHome = createDeckHome;

function renderMyDecks() {
    const list = document.getElementById('myDecksList');
    if (!list) return;
    list.replaceChildren();
    if (customDecks.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'private-reveal-empty';
        empty.textContent = 'No custom decks yet. Create one to collect cards from any module.';
        list.appendChild(empty);
        return;
    }
    customDecks.forEach(deck => {
        const item = document.createElement('div');
        item.className = 'drawer-item';
        const name = document.createElement('p');
        name.textContent = `${deck.name} (${deck.cardIds.length} cards)`;
        const actions = document.createElement('div');
        actions.className = 'drawer-item-actions';
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'drawer-action-btn';
        const hasCards = deck.cardIds.length > 0;
        playBtn.textContent = activeDeckId === deck.id ? 'Playing' : hasCards ? 'Play' : 'Add cards to play';
        playBtn.disabled = activeDeckId === deck.id || !hasCards;
        if (!hasCards) {
            playBtn.setAttribute('aria-label', `Add cards to ${deck.name} before playing.`);
            playBtn.title = 'Add cards to this deck before playing.';
        }
        playBtn.onclick = () => {
            const deckCards = masterDatabase.filter(card => deck.cardIds.includes(card.id));
            if (deckCards.length === 0) {
                showToast(deck.cardIds.length
                    ? 'This deck has no available cards. Add cards to it before playing.'
                    : 'Add cards to this deck before playing.');
                return;
            }
            activeDeckId = deck.id;
            localStorage.setItem('closer_active_deck', deck.id);
            if (activeGameMode === 'compare-first') exitCompareFirstMode();
            if (activeGameMode === 'deep') {
                activeGameMode = 'classic';
                const gameModeSelect = document.getElementById('gameModeSelect');
                if (gameModeSelect) gameModeSelect.value = 'classic';
            }
            activePillars = [...new Set(deckCards.map(getPillar))];
            activeModules = [...activePillars];
            activeTopics = null;
            activeMood = 'all';
            activeIntensity = 'all';
            includeQuestions = true;
            includeActivities = true;
            includeMultipleChoice = true;
            activePromptStyle = 'all';
            activeQuestionCount = null;
            favoritesOnly = false;
            warmUpEnabled = false;
            progressiveMode = false;
            progressivePhase = null;
            roundStats = { played: 0, passed: 0 };
            passedCardIds = [];
            undoStack = [];
            pickedAnswerer = null;
            pickedAnswererIndex = null;
            browseMode = false;
            document.querySelectorAll('.mood-btn').forEach(button => {
                const selected = button.dataset.mood === 'all';
                button.classList.toggle('active', selected);
                button.setAttribute('aria-pressed', String(selected));
            });
            updateQuestionTypeSelection(activePromptStyle, false, false);
            updateActiveModulePresentation();
            if (document.body?.dataset) delete document.body.dataset.pack;
            document.getElementById('browseIndicator')?.classList.add('hidden');
            rebuildUnspentDeck();
            drawNextCard();
            closeDrawer();
            showGameView();
            renderMyDecks();
        };
        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'drawer-action-btn';
        renameBtn.textContent = 'Rename';
        renameBtn.onclick = () => {
            const newName = prompt('New deck name:', deck.name);
            if (newName && newName.trim()) {
                deck.name = newName.trim();
                localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
                renderMyDecks();
            }
        };
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'drawer-action-btn danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = () => {
            customDecks = customDecks.filter(d => d.id !== deck.id);
            if (activeDeckId === deck.id) {
                activeDeckId = null;
                localStorage.removeItem('closer_active_deck');
            }
            localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
            rebuildUnspentDeck();
            drawNextCard();
            renderMyDecks();
        };
        actions.append(playBtn, renameBtn, deleteBtn);
        item.append(name, actions);
        list.appendChild(item);
    });
    const exitBtn = document.getElementById('exitDeckModeBtn');
    if (exitBtn) exitBtn.disabled = !activeDeckId;
}

function encodeBase64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function setPrivateShareStatus(message) {
    const status = document.getElementById('privateShareStatus');
    if (status) status.textContent = message;
}

function getShareClientId() {
    if (!shareClientId) {
        shareClientId = window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : encodeBase64Url(window.crypto.getRandomValues(new Uint8Array(16)));
        sessionStorage.setItem('closer_share_client_id', shareClientId);
    }
    return shareClientId;
}

function renderPartnerCards() {
    const list = partnerCardsListElement;
    const section = partnerCardsSectionElement;
    if (!list || !section) return;
    list.replaceChildren();
    section.classList.remove('hidden');

    if (partnerCards.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'private-reveal-empty';
        empty.textContent = window.roomRef
            ? 'Cards shared by your partner will appear here.'
            : 'Connect to the same paired room as your partner to receive cards.';
        list.appendChild(empty);
        return;
    }

    partnerCards.forEach((card, index) => {
        const item = document.createElement('article');
        item.className = 'partner-card-item';
        const category = document.createElement('span');
        category.className = 'private-reveal-item-label';
        category.textContent = card.category || 'Card from your partner';
        const prompt = document.createElement('p');
        prompt.className = 'partner-card-text';
        prompt.textContent = card.prompt;
        const actions = document.createElement('div');
        actions.className = 'partner-card-actions';
        const useButton = document.createElement('button');
        useButton.type = 'button';
        useButton.textContent = 'Use this card';
        useButton.onclick = () => {
            activeModules = [card.module];
            activeTopics = null;
            updateActiveModulePresentation();
            activeGameMode = 'classic';
            activeIntensity = 'all';
            includeMultipleChoice = true;
            warmUpEnabled = false;
            document.querySelectorAll('.module-tab').forEach(tab => {
                const isActive = tab.dataset.module === activeModule;
                tab.classList.toggle('active', isActive);
                tab.setAttribute('aria-pressed', String(isActive));
            });
            document.getElementById('gameModeSelect').value = 'classic';
            document.querySelectorAll('.intensity-btn').forEach(button => {
                const isActive = button.dataset.level === 'all';
                button.classList.toggle('active', isActive);
                button.setAttribute('aria-pressed', String(isActive));
            });
            updateQuestionTypeSelection('all');
            renderModeTimer();
            updateRoundSummary();
            rebuildUnspentDeck();
            unspentDeck.push(card);
            closeDrawer();
            drawNextCard();
        };
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = 'Remove';
        removeButton.setAttribute('aria-label', `Remove card from partner: ${card.prompt}`);
        removeButton.onclick = () => {
            partnerCards.splice(index, 1);
            localStorage.setItem('closer_partner_cards', JSON.stringify(partnerCards));
            renderPartnerCards();
        };
        actions.append(useButton, removeButton);
        item.append(category, prompt, actions);
        list.appendChild(item);
    });
}

async function receivePartnerCard(snapshot, roomRef) {
    const record = snapshot.val();
    if (!record || !record.card || typeof record.senderUid !== 'string'
        || processingPartnerCardKeys.has(snapshot.key)) return;
    processingPartnerCardKeys.add(snapshot.key);
    try {
        const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
        if (!user || record.senderUid === user.uid) return;
        const card = record.card;
        if (!['sexuality', 'life'].includes(card.module)
            || typeof card.prompt !== 'string'
            || card.prompt.trim().length === 0
            || card.prompt.length > 280
            || ![1, 2, 3, 4].includes(Number(card.intensity))
            || !['question', 'activity'].includes(card.promptStyle)
            || (card.options !== undefined && (!Array.isArray(card.options)
                || card.options.length < 2
                || card.options.length > 6
                || card.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 120)))
            || (card.contextType === 'poll') !== Array.isArray(card.options)) {
            throw new Error('The received card has invalid fields.');
        }
        const localId = `partner-${snapshot.key}`;
        if (!partnerCards.some(savedCard => savedCard.id === localId)) {
            partnerCards.unshift({
                id: localId,
                module: card.module,
                category: typeof card.category === 'string' ? card.category.slice(0, 50) : 'Card from your partner',
                intensity: Number(card.intensity),
                prompt: card.prompt,
                promptStyle: card.promptStyle,
                contextType: card.contextType === 'poll' ? 'poll' : card.promptStyle === 'activity' ? 'action' : 'story',
                ...(Array.isArray(card.options) ? { options: card.options } : {}),
                receivedAt: record.createdAt || new Date().toISOString()
            });
            localStorage.setItem('closer_partner_cards', JSON.stringify(partnerCards));
            renderPartnerCards();
        }
        try {
            await roomRef.child(snapshot.key).remove();
        } catch (error) {
            console.error('Received partner card could not be removed from the room:', error);
        }
    } catch (error) {
        console.error('Could not receive the partner card:', error);
    } finally {
        processingPartnerCardKeys.delete(snapshot.key);
    }
}

function attachPartnerCardListener() {
    if (!window.roomRef) return;
    if (sharedCardListener) {
        sharedCardListener.ref.off('child_added', sharedCardListener.handler);
    }
    const ref = window.roomRef.child('sharedCards');
    const handler = snapshot => receivePartnerCard(snapshot, ref);
    sharedCardListener = { ref, handler };
    ref.on('child_added', handler);
}

function updatePrivateShareUi() {
    const connected = Boolean(window.roomRef && window.currentRoomCode);
    const keyReady = Boolean(privateShareKey);
    const copyButton = document.getElementById('copyPrivateShareKey');
    if (copyButton) copyButton.disabled = !keyReady;
    document.querySelectorAll('.private-share-entry-btn').forEach(button => {
        button.disabled = !connected || !keyReady;
        button.title = !connected
            ? 'Pair both devices to the same room first.'
            : !keyReady
                ? 'Set the same sharing key on both devices first.'
                : '';
    });
    if (connected && keyReady) {
        setPrivateShareStatus(`Connected to room ${window.currentRoomCode}. Sharing key is active for this tab.`);
    } else if (!connected) {
        setPrivateShareStatus('Pair both devices to the same room to enable encrypted sharing.');
    } else {
        setPrivateShareStatus('Connected. Generate a key or enter the key your partner shared with you.');
    }
}

async function applyPrivateShareKey(value) {
    if (!window.crypto?.subtle) {
        setPrivateShareStatus('Encrypted sharing requires a browser with Web Crypto support.');
        return false;
    }
    try {
        const bytes = decodeBase64Url(value.trim());
        if (bytes.length !== 32) throw new Error('The sharing key must be a valid 256-bit key.');
        await window.crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        privateShareKey = value.trim();
        sessionStorage.setItem('closer_private_share_key', privateShareKey);
        attachPrivateRevealListener();
        updatePrivateShareUi();
        renderWildRevealEntries();
        setPrivateShareStatus('Sharing key set for this tab. Exchange this exact key with your partner through a separate trusted channel.');
        return true;
    } catch (error) {
        console.error('Could not set the encrypted sharing key:', error);
        setPrivateShareStatus(`Could not use this key: ${error.message}`);
        return false;
    }
}

async function getPrivateShareCryptoKey() {
    if (!privateShareKey) throw new Error('Set a sharing key first.');
    const bytes = decodeBase64Url(privateShareKey);
    return window.crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function renderSharedRevealInbox() {
    const list = document.getElementById('sharedRevealList');
    if (!list) return;
    list.replaceChildren();
    if (receivedSharedReveals.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'private-reveal-empty';
        empty.textContent = 'Partner entries will appear here after you connect to the same room and use the same sharing key.';
        list.appendChild(empty);
        return;
    }

    receivedSharedReveals.forEach((entry, index) => {
        const item = document.createElement('article');
        item.className = 'private-reveal-item shared-reveal-item';
        const label = document.createElement('span');
        label.className = 'private-reveal-item-label';
        label.textContent = `Partner shared · ${entry.type}`;
        const text = document.createElement('p');
        text.id = `shared-reveal-content-${index}`;
        text.className = 'private-reveal-item-text hidden';
        text.textContent = entry.text;
        const actions = document.createElement('div');
        actions.className = 'private-reveal-item-actions';
        const revealButton = document.createElement('button');
        revealButton.type = 'button';
        revealButton.textContent = 'Reveal entry';
        revealButton.setAttribute('aria-expanded', 'false');
        revealButton.setAttribute('aria-controls', text.id);
        revealButton.onclick = () => {
            const isRevealed = !text.classList.contains('hidden');
            text.classList.toggle('hidden', isRevealed);
            revealButton.textContent = isRevealed ? 'Reveal entry' : 'Hide entry';
            revealButton.setAttribute('aria-expanded', String(!isRevealed));
        };
        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.textContent = 'Clear';
        clearButton.onclick = () => {
            receivedSharedReveals.splice(index, 1);
            renderSharedRevealInbox();
        };
        actions.append(revealButton, clearButton);
        item.append(label, text, actions);
        list.appendChild(item);
    });
}

async function receiveSharedReveal(snapshot, roomRef) {
    const record = snapshot.val();
    if (!record || seenSharedRevealIds.has(snapshot.key) || processingSharedRevealIds.has(snapshot.key)) return;
    if (!privateShareKey) {
        setPrivateShareStatus('An encrypted entry is waiting. Enter your partner’s sharing key to receive it.');
        return;
    }
    processingSharedRevealIds.add(snapshot.key);
    try {
        const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
        if (!user || record.senderClientId === getShareClientId()) return;
        if (typeof record.iv !== 'string' || typeof record.ciphertext !== 'string' || record.ciphertext.length > 6000) {
            throw new Error('The encrypted entry has an invalid format.');
        }
        const key = await getPrivateShareCryptoKey();
        const plaintext = await window.crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: decodeBase64Url(record.iv),
                additionalData: new TextEncoder().encode(String(window.currentRoomCode))
            },
            key,
            decodeBase64Url(record.ciphertext)
        );
        const entry = JSON.parse(new TextDecoder().decode(plaintext));
        if (!['Secret', 'Fantasy', 'Something unspoken'].includes(entry.type) || typeof entry.text !== 'string' || entry.text.length > 1000) {
            throw new Error('The decrypted entry has an invalid format.');
        }
        seenSharedRevealIds.add(snapshot.key);
        receivedSharedReveals.unshift({ type: entry.type, text: entry.text });
        renderSharedRevealInbox();
        setPrivateShareStatus('Your partner shared an encrypted entry. Reveal it when you are ready.');
        try {
            await roomRef.child(snapshot.key).remove();
        } catch (error) {
            console.error('The received encrypted entry could not be removed from the room:', error);
            setPrivateShareStatus('Entry received, but its encrypted copy could not be cleared from the room.');
        }
    } catch (error) {
        console.error('Could not decrypt the partner entry:', error);
        setPrivateShareStatus('Could not open the encrypted entry. Check that both devices use the same sharing key.');
    } finally {
        processingSharedRevealIds.delete(snapshot.key);
    }
}

function attachPrivateRevealListener() {
    if (!window.roomRef) return;
    if (sharedRevealListener && sharedRevealListener.ref) {
        sharedRevealListener.ref.off('child_added', sharedRevealListener.handler);
    }
    const ref = window.roomRef.child('sharedReveals');
    const handler = snapshot => receiveSharedReveal(snapshot, ref);
    sharedRevealListener = { ref, handler };
    ref.on('child_added', handler);
}

async function sharePrivateReveal(entry) {
    if (!window.roomRef || !window.currentRoomCode) {
        setPrivateShareStatus('Pair this device to the same room as your partner before sharing.');
        return;
    }
    if (!privateShareKey) {
        setPrivateShareStatus('Set the same sharing key on both devices before sharing.');
        return;
    }
    try {
        const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
        if (!user) throw new Error('Firebase sign-in is required for paired sharing.');
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const key = await getPrivateShareCryptoKey();
        const payload = new TextEncoder().encode(JSON.stringify({ type: entry.type, text: entry.text }));
        const ciphertext = await window.crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv,
                additionalData: new TextEncoder().encode(String(window.currentRoomCode))
            },
            key,
            payload
        );
        const messageRef = window.roomRef.child('sharedReveals').push();
        if (!messageRef.key) throw new Error('Could not create a sharing message.');
        await messageRef.set({
            senderUid: user.uid,
            senderClientId: getShareClientId(),
            iv: encodeBase64Url(iv),
            ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
            createdAt: new Date().toISOString()
        });
        setPrivateShareStatus('Encrypted entry sent to the paired room. Your partner can reveal it in Wild & Unspoken.');
    } catch (error) {
        console.error('Could not share the encrypted partner entry:', error);
        setPrivateShareStatus(`Could not share the entry: ${error.message}`);
    }
}

function renderWildRevealEntries() {
    const list = document.getElementById('privateRevealList');
    if (!list) return;
    list.replaceChildren();

    const now = Date.now();
    // Filter expired entries.
    privateRevealEntries = privateRevealEntries.filter(entry => !entry.expiresAt || new Date(entry.expiresAt).getTime() > now);

    const tagFilter = document.getElementById('privateRevealTagFilter');
    if (tagFilter) {
        const tags = [...new Set(privateRevealEntries.flatMap(e => e.tags || []))];
        const current = tagFilter.value;
        tagFilter.replaceChildren();
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'All tags';
        tagFilter.appendChild(all);
        tags.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = `#${t}`;
            tagFilter.appendChild(opt);
        });
        tagFilter.value = tags.includes(current) ? current : '';
    }

    const query = (document.getElementById('privateRevealSearch')?.value || '').trim().toLowerCase();
    const tagFilterValue = (document.getElementById('privateRevealTagFilter')?.value || '').trim();
    const filtered = privateRevealEntries.filter(entry => {
        if (tagFilterValue && !(entry.tags || []).includes(tagFilterValue)) return false;
        if (!query) return true;
        const haystack = [entry.type, entry.text, ...(entry.tags || [])].join(' ').toLowerCase();
        return haystack.includes(query);
    });

    if (filtered.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'private-reveal-empty';
        empty.textContent = query ? 'No entries match your search.' : 'Your private entries will appear here. Only reveal one when you are ready.';
        list.appendChild(empty);
        localStorage.setItem('closer_private_reveals', JSON.stringify(privateRevealEntries));
        updatePrivateShareUi();
        return;
    }

    filtered.forEach((entry, index) => {
        const item = document.createElement('article');
        item.className = 'private-reveal-item';
        if (entry.draft) item.classList.add('draft');
        const label = document.createElement('span');
        label.className = 'private-reveal-item-label';
        label.textContent = entry.draft ? `${entry.type} (draft)` : entry.type;
        if (entry.tags && entry.tags.length) {
            const tags = document.createElement('span');
            tags.className = 'private-reveal-tags';
            tags.textContent = entry.tags.map(t => `#${t}`).join(' ');
            label.appendChild(tags);
        }
        const text = document.createElement('p');
        text.id = `private-reveal-content-${index}`;
        text.className = 'private-reveal-item-text hidden';
        text.textContent = entry.text;
        const actions = document.createElement('div');
        actions.className = 'private-reveal-item-actions';
        const revealButton = document.createElement('button');
        revealButton.type = 'button';
        revealButton.textContent = 'Reveal';
        revealButton.setAttribute('aria-expanded', String(Boolean(entry.revealed)));
        revealButton.setAttribute('aria-controls', text.id);
        if (entry.revealed) text.classList.remove('hidden');
        revealButton.textContent = entry.revealed ? 'Hide' : 'Reveal';
        revealButton.onclick = () => {
            entry.revealed = !entry.revealed;
            text.classList.toggle('hidden', !entry.revealed);
            revealButton.textContent = entry.revealed ? 'Hide' : 'Reveal';
            revealButton.setAttribute('aria-expanded', String(entry.revealed));
            localStorage.setItem('closer_private_reveals', JSON.stringify(privateRevealEntries));
        };
        const shareButton = document.createElement('button');
        shareButton.className = 'private-share-entry-btn';
        shareButton.type = 'button';
        shareButton.textContent = 'Share encrypted';
        shareButton.disabled = !window.roomRef || !privateShareKey || entry.draft;
        shareButton.onclick = async () => {
            shareButton.disabled = true;
            try {
                await sharePrivateReveal(entry);
            } finally {
                updatePrivateShareUi();
            }
        };
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.setAttribute('aria-label', `Delete private ${entry.type.toLowerCase()} entry`);
        deleteButton.onclick = () => {
            privateRevealEntries.splice(privateRevealEntries.indexOf(entry), 1);
            localStorage.setItem('closer_private_reveals', JSON.stringify(privateRevealEntries));
            renderWildRevealEntries();
        };
        actions.append(revealButton, shareButton, deleteButton);
        item.append(label, text, actions);
        list.appendChild(item);
    });
    localStorage.setItem('closer_private_reveals', JSON.stringify(privateRevealEntries));
    updatePrivateShareUi();
}

function updateSectionView() {
    const isWild = activeModule === 'secrets';
    const isExplicit = !isWild && activeModules.includes('explicit');
    document.body.dataset.module = isWild ? 'secrets' : activeModules.length === 1 ? activeModules[0] : 'sexuality';
    updateIntensityLabels();
    document.getElementById('cardContainer')?.classList.toggle('hidden', isWild);
    document.querySelector('.response-section')?.classList.toggle('hidden', isWild);
    document.getElementById('appStatus')?.classList.toggle('hidden', isWild);
    document.getElementById('cardActionStatus')?.classList.toggle('hidden', isWild);
    document.getElementById('wildUnspokenPanel')?.classList.toggle('hidden', !isWild);
    document.getElementById('explicitContentNotice')?.classList.toggle('hidden', !isExplicit);
    if (isWild) renderWildRevealEntries();
}

function updateIntensityLabels(module = activeModule) {
    const labels = module === 'sexuality'
        ? ['Flirty', 'Sensual', 'Steamy', 'Extreme']
        : module === 'explicit'
            ? ['Warm-up', 'Direct', 'Detailed', 'Extreme']
        : ['Mild', 'Moderate', 'Wild', 'Extreme'];

    document.querySelectorAll('.intensity-btn[data-level]').forEach(button => {
        const level = Number(button.dataset.level);
        if (level >= 1 && level <= 4) button.textContent = labels[level - 1];
    });

    const deepOption = document.querySelector('#gameModeSelect option[value="deep"]');
    if (deepOption) {
        deepOption.textContent = module === 'sexuality'
            ? 'Deep talk · Steamy cards + reflection timer'
            : 'Deep talk · Level 3 + reflection timer';
    }
}

function updateCustomIntensityLabels(module) {
    const labels = module === 'sexuality'
        ? ['Flirty', 'Sensual', 'Steamy', 'Extreme']
        : ['Mild', 'Moderate', 'Wild', 'Extreme'];
    document.querySelectorAll('#customIntensity option').forEach(option => {
        const level = Number(option.value);
        if (level >= 1 && level <= 4) option.textContent = `Level ${level} - ${labels[level - 1]}`;
    });
}

function closeDrawer() {
    const drawer = document.getElementById('appDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (drawer) drawer.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
    if (drawerScrollState) {
        const { scrollY, position, top, width, overflow } = drawerScrollState;
        document.body.classList.remove('drawer-open');
        document.body.style.position = position;
        document.body.style.top = top;
        document.body.style.width = width;
        document.body.style.overflow = overflow;
        drawerScrollState = null;
        window.scrollTo(0, scrollY);
    }
    if (window._settingsPreviousNav) {
        setActiveNavigationView(window._settingsPreviousNav);
        window._settingsPreviousNav = null;
    }
    if (window._lastFocusedBeforeDrawer && typeof window._lastFocusedBeforeDrawer.focus === 'function') {
        window._lastFocusedBeforeDrawer.focus();
    }
}

function toggleModal(show) {
    const modal = document.getElementById('customCardModal');
    if (modal) {
        if (show) {
            window._lastFocusedBeforeModal = document.activeElement;
            setModalOpen(modal, true);
            setTimeout(() => {
                const first = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                if (first) first.focus();
            }, 0);
        } else {
            setModalOpen(modal, false);
            if (window._lastFocusedBeforeModal && typeof window._lastFocusedBeforeModal.focus === 'function') window._lastFocusedBeforeModal.focus();
        }
    }
}

function renderPairManagement() {
    if (!pairManagementContainer) return;
    pairManagementContainer.replaceChildren();
    const roomStatus = document.createElement('div');
    roomStatus.className = 'drawer-item';
    roomStatus.setAttribute('role', 'status');
    roomStatus.setAttribute('aria-live', 'polite');
    const statusText = document.createElement('p');
    if (!window.currentRoomCode) {
        statusText.textContent = 'Not connected to a room.';
    } else if (window.currentRoomRole === 'host') {
        statusText.textContent = partnerConnected
            ? `Partner connected · Host · ${window.currentRoomCode}`
            : `Room created and ready · Host · ${window.currentRoomCode}`;
    } else if (window.currentRoomRole === 'partner') {
        statusText.textContent = `Connected to room ${window.currentRoomCode} · Partner. The host will choose a pack; the game will open here automatically.`;
    } else if (window.currentRoomRole === 'requesting') {
        statusText.textContent = `Request pending · Room ${window.currentRoomCode}`;
    } else {
        statusText.textContent = 'Not connected to a room.';
    }
    roomStatus.appendChild(statusText);
    pairManagementContainer.appendChild(roomStatus);

    if (window.currentRoomRole === 'host' && window.currentRoomCode) {
        const invite = document.createElement('section');
        invite.className = 'room-invite-section';
        const label = document.createElement('label');
        label.htmlFor = 'roomInviteCode';
        label.textContent = 'Share this room code with your partner';
        const row = document.createElement('div');
        row.className = 'room-invite-row';
        const codeInput = document.createElement('input');
        codeInput.id = 'roomInviteCode';
        codeInput.type = 'text';
        codeInput.readOnly = true;
        codeInput.value = window.currentRoomCode;
        codeInput.setAttribute('aria-label', 'Room invite code');
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'btn-secondary';
        copyButton.textContent = 'Copy code';
        copyButton.onclick = async () => {
            try {
    // Sync shared deck into local deck.
    if (window.roomRef) {
        window.roomRef.child('sharedDeck').on('value', snapshot => {
            const data = snapshot.val() || {};
            const cards = Object.values(data).map(d => d.card).filter(Boolean);
            const ids = new Set(masterDatabase.map(c => c.id));
            let changed = false;
            cards.forEach(card => {
                if (card && card.id && !ids.has(card.id)) {
                    masterDatabase.push(card);
                    ids.add(card.id);
                    changed = true;
                }
            });
            if (changed) {
                rebuildUnspentDeck();
                renderSharedDeck();
            }
        });
    }
                await navigator.clipboard.writeText(window.currentRoomCode);
                setPairStatus('Room code copied. Your partner will still need your approval to join.');
            } catch (error) {
                console.error('Could not copy the room code:', error);
                codeInput.focus();
                codeInput.select();
                setPairStatus('Copy is unavailable. Select and copy the room code above.');
            }
        };
        row.append(codeInput, copyButton);
        invite.append(label, row);
        pairManagementContainer.appendChild(invite);
    }

    if (window.currentRoomRole === 'host' && partnerConnected
        && currentRoomGameModeLoaded && currentRoomGameMode !== 'guess-me') {
        const startSection = document.createElement('section');
        startSection.className = 'room-create-section';
        const prompt = document.createElement('p');
        prompt.textContent = 'Your partner is connected. Choose a pack or customize a round, then start your conversation.';
        const startButton = document.createElement('button');
        startButton.type = 'button';
        startButton.className = 'btn-primary';
        startButton.textContent = 'Choose a pack and start';
        startButton.onclick = () => {
            closeDrawer();
            openRoundBuilder();
            if (window.pendingPackKey) {
                const pendingPack = [...document.querySelectorAll('#curatedTab .pack-card')]
                    .find(card => card.dataset.pack === window.pendingPackKey);
                if (pendingPack) pendingPack.click();
                window.pendingPackKey = null;
            }
        };
        startSection.append(prompt, startButton);
        pairManagementContainer.appendChild(startSection);
    }

    if (window.currentRoomRole !== 'host') return;
    pairManagementContainer.appendChild(createJoinRequestsSection(
        'No pending requests. Only one partner can be approved.'
    ));
}

function createJoinRequestsSection(emptyMessage, statusId = null) {
    const section = document.createElement('section');
    section.className = 'room-requests-section';
    const heading = document.createElement('h4');
    heading.textContent = 'Join requests';
    section.appendChild(heading);
    const requests = Object.entries(pendingJoinRequests).filter(([, request]) => request?.status === 'pending');
    if (requests.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'room-request-empty';
        empty.textContent = emptyMessage;
        section.appendChild(empty);
    }
    requests.forEach(([uid]) => {
        const item = document.createElement('div');
        item.className = 'room-request-item';
        const label = document.createElement('p');
        label.textContent = `Someone is requesting to join (${uid.slice(0, 8)}…).`;
        const actions = document.createElement('div');
        actions.className = 'room-request-actions';
        const approveButton = document.createElement('button');
        approveButton.type = 'button';
        approveButton.textContent = 'Approve';
        approveButton.onclick = () => resolveJoinRequest(uid, true);
        const denyButton = document.createElement('button');
        denyButton.type = 'button';
        denyButton.textContent = 'Deny';
        denyButton.onclick = () => resolveJoinRequest(uid, false);
        actions.append(approveButton, denyButton);
        item.append(label, actions);
        section.appendChild(item);
    });
    if (statusId) {
        const status = document.createElement('p');
        status.id = statusId;
        status.className = 'pair-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        section.appendChild(status);
    }
    return section;
}

function setJoinRequestStatus(message) {
    setPairStatus(message);
    const status = document.getElementById('guessMeJoinRequestStatus');
    if (status) status.textContent = message;
}

async function resolveJoinRequest(uid, approved) {
    if (!window.roomRef || window.currentRoomRole !== 'host') return;
    const requestRef = window.roomRef.child(`joinRequests/${uid}`);
    try {
        if (approved) {
            const partnerRef = window.roomRef.child('members/partner');
            const result = await partnerRef.transaction(currentUid => currentUid === null ? uid : undefined);
            if (!result.committed) {
                setJoinRequestStatus('This room already has a partner. The two-person limit has been reached.');
                return;
            }
        }
        await requestRef.update({
            status: approved ? 'approved' : 'denied',
            resolvedAt: Date.now()
        });
        setJoinRequestStatus(approved
            ? 'Partner approved. They can now enter the room.'
            : 'Join request denied.');
    } catch (error) {
        console.error('Could not resolve the room join request:', error);
        setJoinRequestStatus(`Could not ${approved ? 'approve' : 'deny'} the request: ${error.message}`);
    }
}

function setPairStatus(message) {
    const status = document.getElementById('pairStatus');
    if (status) status.textContent = message;
}

function updateSyncStatus() {
    const el = document.getElementById('lastSynced');
    if (!el) return;
    if (!lastSyncedAt) { el.textContent = 'Last synced: never'; return; }
    const d = new Date(lastSyncedAt);
    el.textContent = `Last synced: ${d.toLocaleTimeString()}`;
}

async function renderSharedDeck() {
    const list = document.getElementById('sharedDeckList');
    if (!list || !window.roomRef) return;
    list.replaceChildren();
    try {
        const snapshot = await window.roomRef.child('sharedDeck').once('value');
        const data = snapshot.val() || {};
        const cards = Object.values(data).map(d => d.card).filter(Boolean);
        if (cards.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'private-reveal-empty';
            empty.textContent = 'No shared cards yet.';
            list.appendChild(empty);
            return;
        }
        cards.forEach(card => {
            const item = document.createElement('div');
            item.className = 'drawer-item';
            const prompt = document.createElement('p');
            prompt.textContent = card.prompt;
            item.appendChild(prompt);
            list.appendChild(item);
        });
    } catch (e) {
        console.warn('Could not load shared deck:', e);
    }
}

function syncPlayedCardsToRoom() {
    if (!window.roomRef || !window.currentRoomCode) return;
    try {
        const payload = {};
        playedCardIds.forEach(id => { payload[id] = true; });
        window.roomRef.child('playedCards').set(payload).catch(() => {});
    } catch (error) {
        console.warn('Could not sync played cards:', error);
    }
}

async function loadPlayedCardsFromRoom() {
    if (!window.roomRef) return;
    try {
        const snapshot = await window.roomRef.child('playedCards').once('value');
        const data = snapshot.val() || {};
        Object.keys(data).forEach(id => playedCardIds.add(id));
        localStorage.setItem('closer_played_cards', JSON.stringify([...playedCardIds]));
    } catch (error) {
        console.warn('Could not load played cards from room:', error);
    }
}

function showToast(message) {
    let toast = document.getElementById('appToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appToast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--card-bg);color:var(--text-main);padding:10px 16px;border-radius:999px;border:1px solid var(--card-border);box-shadow:0 8px 24px rgba(0,0,0,0.25);z-index:9999;font-size:0.9rem;opacity:0;transition:opacity 0.2s ease;pointer-events:none;max-width:90vw;';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

function updateConnectionStatus() {
    const btn = document.getElementById('pairPartnerBtn');
    if (!btn) return;
    const role = window.currentRoomRole;
    const connected = role === 'partner'
        || (role === 'host' && partnerConnected);
    btn.classList.toggle('connected', connected);
    btn.title = connected
        ? `Connected with partner · ${window.currentRoomCode ? window.currentRoomCode.slice(0, 6) + '…' : ''}`
        : role === 'host'
            ? 'Waiting for partner to join…'
            : role === 'requesting'
                ? 'Join request pending…'
                : 'Pair with partner';
    btn.setAttribute('aria-label', connected ? 'Connected with partner' : 'Pair with partner');
}

function detachRoomAccessListeners() {
    detachGuessMeListener();
    detachCardAnswerListeners();
    cardAnswerSetupKey = null;
    cardAnswerRoomRef = null;
    cardAnswerCard = null;
    cardAnswerOwnUid = null;
    cardAnswerPartnerUid = null;
    cardAnswerOwn = null;
    cardAnswerPartner = null;
    if (sharedRevealListener) {
        sharedRevealListener.ref.off('child_added', sharedRevealListener.handler);
        sharedRevealListener = null;
    }
    if (sharedCardListener) {
        sharedCardListener.ref.off('child_added', sharedCardListener.handler);
        sharedCardListener = null;
    }
    if (activeCardSyncListener && window.roomRef) {
        window.roomRef.child('activeCard').off('value', activeCardSyncListener);
        activeCardSyncListener = null;
    }
    if (playerNamesListener && window.roomRef) {
        window.roomRef.child('playerNames').off('value', playerNamesListener);
        playerNamesListener = null;
    }
    if (partnerSeatListener && window.roomRef) {
        window.roomRef.child('members/partner').off('value', partnerSeatListener);
        partnerSeatListener = null;
    }
    if (gameModeListener && window.roomRef) {
        window.roomRef.child('gameMode').off('value', gameModeListener);
        gameModeListener = null;
    }
    if (window.roomRef) window.roomRef.child('sharedDeck').off('value');
    if (joinRequestListener && pendingJoinRequestRef) {
        pendingJoinRequestRef.off('value', joinRequestListener);
        joinRequestListener = null;
    }
    pendingJoinRequestRef = null;
    if (roomJoinRequestsListener && window.roomRef) {
        window.roomRef.child('joinRequests').off('value', roomJoinRequestsListener);
        roomJoinRequestsListener = null;
    }
}

function connectToRoom(roomCode, role) {
    if (!window.db) throw new Error('Firebase pairing is not configured.');
    detachRoomAccessListeners();
    window.currentRoomCode = roomCode;
    window.currentRoomRole = role;
    partnerConnected = role === 'partner';
    currentRoomGameMode = null;
    currentRoomGameModeLoaded = false;
    localStorage.setItem('closer_room_code', roomCode);
    localStorage.setItem('closer_room_role', role);
    window.roomRef = window.db.ref(`rooms/${roomCode}`);
    roomDisplayNames = {};
    playerNamesListener = snapshot => {
        roomDisplayNames = snapshot.val() || {};
        if (currentCard) renderCard(currentCard);
    };
    window.roomRef.child('playerNames').on('value', playerNamesListener, error => {
        console.error('Could not load room player names:', error);
        setCardActionStatus('Could not load player names. Check the room access rules.');
    });
    const currentUser = window.firebase?.auth().currentUser;
    if (currentUser) {
        const identityRef = window.roomRef.child(`playerNames/${role}`);
        identityRef.once('value').then(snapshot => {
            if (snapshot.exists()) return;
            return identityRef.set(playerNames[role]);
        }).catch(error => {
            console.error('Could not save the room player identity:', error);
            setCardActionStatus(`Your identifier is saved on this device but could not sync to the room: ${error.message}`);
        });
    }

    let sharedRoundStartedBeforeModeLoaded = false;
    activeCardSyncListener = snapshot => {
        const remoteCard = snapshot.val();
        if (remoteCard?.module === 'explicit' && !hasExplicitAgeConfirmation()) return;
        if (remoteCard && (!currentCard
            || remoteCard.id !== currentCard.id
            || remoteCard.roundId !== currentCard.roundId)) {
            currentCard = remoteCard;
            renderCard(currentCard);
        }
        if (role === 'partner' && Number.isFinite(remoteCard?.sharedRoundStartedAt)) {
            if (currentRoomGameModeLoaded) {
                if (currentRoomGameMode !== 'guess-me') showGameView();
            } else {
                sharedRoundStartedBeforeModeLoaded = true;
            }
        }
        lastSyncedAt = new Date().toISOString();
        updateSyncStatus();
    };
    window.roomRef.child('activeCard').on('value', activeCardSyncListener);
    attachPrivateRevealListener();
    attachPartnerCardListener();

    if (role === 'host') {
        roomJoinRequestsListener = snapshot => {
            pendingJoinRequests = snapshot.val() || {};
            renderPairManagement();
            if (!document.getElementById('guessMeView')?.classList.contains('hidden')) {
                refreshGuessMeState();
            }
        };
        window.roomRef.child('joinRequests').on('value', roomJoinRequestsListener, error => {
            console.error('Could not load room join requests:', error);
            setJoinRequestStatus(`Could not load join requests: ${error.message}`);
        });
    } else {
        pendingJoinRequests = {};
    }

    updatePrivateShareUi();
    renderWildRevealEntries();
    if (currentCard) renderCard(currentCard);
    updateConnectionStatus();
    loadPlayedCardsFromRoom();
    gameModeListener = snapshot => {
        currentRoomGameMode = snapshot.val();
        currentRoomGameModeLoaded = true;
        renderPairManagement();
        if (currentRoomGameMode === 'guess-me') {
            sharedRoundStartedBeforeModeLoaded = false;
            closeGuessMeSetup();
            showGuessMeView();
            attachGuessMeListener();
        } else if (role === 'partner' && sharedRoundStartedBeforeModeLoaded) {
            sharedRoundStartedBeforeModeLoaded = false;
            showGameView();
        }
    };
    window.roomRef.child('gameMode').on('value', gameModeListener, error => {
        console.error('Could not read the connected room game mode:', error);
        setPairStatus(`Could not load room details: ${error.message}`);
    });
    if (role === 'partner') {
        showToast('Connected to your partner.');
    }
    if (role === 'host') {
        partnerSeatListener = snapshot => {
            const partnerUid = snapshot.val();
            if (partnerUid) {
                partnerConnected = true;
                showToast('Your partner joined the room.');
                updateConnectionStatus();
                renderPairManagement();
            }
        };
        window.roomRef.child('members/partner').on('value', partnerSeatListener);
    }
}

function generateRoomCode() {
    if (!window.crypto?.getRandomValues) throw new Error('Secure room-code generation is not available in this browser.');
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    return encodeBase64Url(bytes);
}

async function createRoom() {
    if (!window.db || !window.firebase) throw new Error('Firebase pairing is not configured.');
    const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
    if (!user) throw new Error('Firebase sign-in is required to create a room.');
    const roomCode = generateRoomCode();
    const result = await window.db.ref(`rooms/${roomCode}/members/host`)
        .transaction(currentUid => currentUid === null ? user.uid : undefined);
    if (!result.committed) throw new Error('Could not reserve a new room. Please try again.');
    connectToRoom(roomCode, 'host');
    setPairStatus('Room created. Share the room code with your partner; you decide whether to approve their request.');
    renderPairManagement();
}

async function requestRoomAccess(roomCode, expectedGameMode = null) {
    if (!window.db || !window.firebase) throw new Error('Firebase pairing is not configured.');
    if (!/^[A-Za-z0-9_-]{22}$/.test(roomCode)) {
        throw new Error('Enter a valid room code from the host.');
    }
    const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
    if (!user) throw new Error('Firebase sign-in is required to request access.');
    const roomRef = window.db.ref(`rooms/${roomCode}`);
    const [hostSnapshot, partnerSnapshot] = await Promise.all([
        roomRef.child('members/host').once('value'),
        roomRef.child('members/partner').once('value')
    ]);
    if (!hostSnapshot.val()) throw new Error('That room does not exist or is unavailable.');
    if (hostSnapshot.val() === user.uid) {
        if (expectedGameMode) {
            const mode = await roomRef.child('gameMode').once('value');
            if (mode.val() !== expectedGameMode) throw new Error('That room is not set up for You Get Me.');
        }
        connectToRoom(roomCode, 'host');
        renderPairManagement();
        return;
    }
    if (partnerSnapshot.val() === user.uid) {
        if (expectedGameMode) {
            const mode = await roomRef.child('gameMode').once('value');
            if (mode.val() !== expectedGameMode) throw new Error('That room is not set up for You Get Me.');
        }
        connectToRoom(roomCode, 'partner');
        renderPairManagement();
        return;
    }
    if (partnerSnapshot.val()) throw new Error('This room already has two people. The room is full.');

    detachRoomAccessListeners();
    window.currentRoomCode = roomCode;
    window.currentRoomRole = 'requesting';
    window.roomRef = null;
    if (currentCard) renderCard(currentCard);
    updatePrivateShareUi();
    const requestRef = roomRef.child(`joinRequests/${user.uid}`);
    pendingJoinRequestRef = requestRef;
    try {
        await requestRef.set({
            requesterUid: user.uid,
            status: 'pending',
            requestedAt: Date.now()
        });
    } catch (error) {
        pendingJoinRequestRef = null;
        window.currentRoomCode = null;
        window.currentRoomRole = null;
        updatePrivateShareUi();
        throw error;
    }
    setPairStatus('Request sent. You will join only if the host approves you.');
    joinRequestListener = snapshot => {
        const request = snapshot.val();
        if (!request) return;
        if (request.status === 'denied') {
            setPairStatus('The host denied your request. You are not in the room.');
        } else if (request.status === 'approved') {
            Promise.all([
                roomRef.child('members/partner').once('value'),
                expectedGameMode ? roomRef.child('gameMode').once('value') : Promise.resolve(null)
            ]).then(([partnerSeat, gameModeSnapshot]) => {
                if (partnerSeat.val() !== user.uid) {
                    setPairStatus('Approval could not be confirmed. You have not joined the room.');
                    return;
                }
                connectToRoom(roomCode, 'partner');
                if (expectedGameMode && gameModeSnapshot.val() !== expectedGameMode) {
                    closeGuessMeSetup();
                    showHomeView();
                    const message = 'You joined the room, but it is not set up for You Get Me.';
                    setPairStatus(message);
                    showToast(message);
                    renderPairManagement();
                    return;
                }
                setPairStatus('The host approved you. You are now connected.');
                renderPairManagement();
            }).catch(error => {
                console.error('Could not verify room approval:', error);
                setPairStatus(`Could not confirm approval: ${error.message}`);
            });
        }
    };
    requestRef.on('value', joinRequestListener);
    renderPairManagement();
}


function openNewGameFlow() {
    openPlayModeModal(() => openRoundBuilder());
window.openNewGameFlow = openNewGameFlow;

}
function openPlayModeModal(pending) {
    pendingGameStart = pending || null;
    setModalOpen(document.getElementById('playModeModal'), true);
}
function closePlayModeModal() {
    setModalOpen(document.getElementById('playModeModal'), false);
}
function openPlayerNamesModal() {
    const s1 = document.getElementById('pn1Icon');
    const s2 = document.getElementById('pn2Icon');
    if (s1) s1.innerHTML = PLAYER_ICONS.map(i => `<option value="${i}">${i}</option>`).join('');
    if (s2) s2.innerHTML = PLAYER_ICONS.map(i => `<option value="${i}">${i}</option>`).join('');
    const n1 = document.getElementById('pn1Name');
    const n2 = document.getElementById('pn2Name');
    if (n1) n1.value = playerNames.host?.name || 'Player 1';
    if (n2) n2.value = playerNames.partner?.name || 'Player 2';
    if (s1) s1.value = playerNames.host?.icon || PLAYER_ICONS[0];
    if (s2) s2.value = playerNames.partner?.icon || PLAYER_ICONS[1];
    setModalOpen(document.getElementById('playerNamesModal'), true);
}
function closePlayerNamesModal() {
    setModalOpen(document.getElementById('playerNamesModal'), false);
}

function getQodDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getSafeQodPool() {
    const db = window.masterDatabase || masterDatabase || [];
    return db.filter(c => c && c.module !== 'explicit' && c.module !== 'sexuality' && c.prompt);
}

function ensureDailyQod() {
    const today = getQodDateKey();
    let storedDate = null;
    storedDate = readStoredValue('closer_qod_date');
    if (storedDate !== today) {
        const pool = getSafeQodPool();
        const picked = [];
        const used = new Set();
        let attempts = 0;
        while (picked.length < 5 && attempts < 50) {
            attempts++;
            if (pool.length === 0) break;
            const card = pool[Math.floor(Math.random() * pool.length)];
            if (used.has(card.id)) continue;
            used.add(card.id);
            picked.push(card.prompt);
        }
        try {
            localStorage.setItem('closer_qod_date', today);
            localStorage.setItem('closer_qod_questions', JSON.stringify(picked));
            localStorage.setItem('closer_qod_index', '0');
        } catch (e) {}
    }
}

function getCurrentQodQuestions() {
    try {
        const q = readStoredJSON('closer_qod_questions', [], value => Array.isArray(value) && value.every(question => typeof question === 'string'));
        if (Array.isArray(q) && q.length > 0) return q;
    } catch (e) {}
    // fallback
    const pool = getSafeQodPool();
    return pool.slice(0, 5).map(c => c.prompt);
}

function getCurrentQodIndex() {
    let i = 0;
    i = parseInt(readStoredValue('closer_qod_index', '0'), 10) || 0;
    const qs = getCurrentQodQuestions();
    if (i < 0) i = 0;
    if (i > qs.length) i = qs.length;
    return i;
}

function showQod() {
    ensureDailyQod();
    const qs = getCurrentQodQuestions();
    const idx = getCurrentQodIndex();
    const el = document.getElementById('qodQuestion');
    const anotherBtn = document.getElementById('qodAnother');
    const startLink = document.getElementById('qodStartConv');
    if (idx < qs.length) {
        if (el) el.textContent = qs[idx];
        if (anotherBtn) anotherBtn.classList.remove('hidden');
        if (startLink) startLink.classList.add('hidden');
    } else {
        // reached the end of the 5
        if (el) el.textContent = "You've explored today's questions. Start a new conversation to keep connecting.";
        if (anotherBtn) anotherBtn.classList.add('hidden');
        if (startLink) startLink.classList.remove('hidden');
    }
}

function advanceQod() {
    const qs = getCurrentQodQuestions();
    let idx = getCurrentQodIndex();
    if (idx < qs.length) {
        idx += 1;
        try { localStorage.setItem('closer_qod_index', String(idx)); } catch (e) {}
    }
    showQod();
    return true;
}

function loadAnotherQod() {
    advanceQod();
    return true;
}
window.loadAnotherQod = loadAnotherQod;
window.advanceQod = advanceQod;
window.showQod = showQod;

function resumeSavedGame() {
    try {
        const savedDeck = readStoredJSON('closer_unspent_deck', null, value => value === null || (Array.isArray(value) && value.every(card => card && typeof card.id === 'string' && typeof card.prompt === 'string')));
        const savedCard = readStoredJSON('closer_current_card', null, value => value === null || (typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string' && typeof value.prompt === 'string'));
        if (Array.isArray(savedDeck) && savedCard && savedCard.id) {
            unspentDeck = savedDeck;
            currentCard = savedCard;
            try {
                const f = readStoredJSON('closer_round_filters', null, value => value === null || (typeof value === 'object' && !Array.isArray(value)));
                if (f) {
                    activePillars = f.activePillars || activePillars;
                    activeModules = [...activePillars];
                    activeTopics = f.activeTopics ?? null;
                    activeMood = f.activeMood || 'all';
                    includeQuestions = f.includeQuestions ?? includeQuestions;
                    includeActivities = f.includeActivities ?? includeActivities;
                    includeMultipleChoice = f.includeMultipleChoice ?? includeMultipleChoice;
                }
            } catch (e) {}
            renderCard(currentCard);
            showGameView();
        }
    } catch (e) {}
}
window.resumeSavedGame = resumeSavedGame;
function pauseConversation() {
    const wasPreview = browseMode;
    browseMode = false;
    stopModeTimer();
    showHomeView();
    window.scrollTo(0, 0);
    if (typeof showToast === 'function') {
        showToast(wasPreview ? 'Preview closed. Your place was not saved.' : 'Conversation paused. Your place is saved.');
    }
}
window.pauseConversation = pauseConversation;
function quitConversation() {
    if (!confirm('End this conversation? Your progress will be discarded.')) return;
    try {
        localStorage.removeItem('closer_unspent_deck');
        localStorage.removeItem('closer_current_card');
    } catch (e) {}
    currentCard = null;
    unspentDeck = [];
    roundStats = { played: 0, passed: 0 };
    passedCardIds = [];
    browseMode = false;
    const browseIndicator = document.getElementById('browseIndicator');
    if (browseIndicator) browseIndicator.classList.add('hidden');
    stopModeTimer();
    document.getElementById('actionTimerBar')?.classList.add('hidden');
    showHomeView();
    if (typeof showToast === 'function') showToast('Conversation ended.');
}
window.quitConversation = quitConversation;

function pickGuessMeQuestions(length, vibe) {
    const pool = (Array.isArray(window.ygmQuestionBank) ? window.ygmQuestionBank : []).filter(q =>
        q && typeof q.id === 'string' && typeof q.question === 'string'
        && Array.isArray(q.options) && q.options.length === 4
        && q.options.every(option => typeof option === 'string' && option.trim())
    );
    const categoryMap = {
        playful: ['silly_ridiculous', 'everyday_personality', 'couple_fun', 'preferences_unexpected', 'travel', 'movies', 'food'],
        romantic: ['everyday_personality', 'couple_fun', 'preferences_unexpected', 'sweet_flirty', 'travel', 'food'],
        deep: ['everyday_personality', 'couple_fun', 'sweet_flirty', 'support_stress', 'conflict_repair', 'values_future', 'vulnerability_growth', 'fears']
    };
    const categories = categoryMap[vibe];
    const filtered = categories ? pool.filter(question => categories.includes(question.category)) : pool;
    const shuffled = [...filtered];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    return shuffled.slice(0, Math.min(Math.max(0, Number(length) || 0), shuffled.length)).map(q => q.id);
}

async function ensureGuessMeQuestionBank() {
    if (!Array.isArray(window.ygmQuestionBank) || window.ygmQuestionBank.length === 0) {
        const response = await fetch('./YGM-question-bank.json');
        if (!response.ok) throw new Error(`Could not load the You Get Me question bank (HTTP ${response.status}).`);
        const data = await response.json();
        if (!data || !Array.isArray(data.questions)) throw new Error('The You Get Me question bank is invalid.');
        ygmQuestionBank = data.questions;
        window.ygmQuestionBank = ygmQuestionBank;
    }
    return window.ygmQuestionBank;
}
window.pickGuessMeQuestions = pickGuessMeQuestions;

async function loadGuessMeQuestion(requestedIndex) {
    if (!window.roomRef || window.currentRoomRole !== 'host') return;
    const [statusSnapshot, idsSnapshot, indexSnapshot] = await Promise.all([
        window.roomRef.child('guessMe/status').once('value'),
        window.roomRef.child('guessMe/questionIds').once('value'),
        window.roomRef.child('guessMe/currentIndex').once('value')
    ]);
    if (statusSnapshot.val() !== 'playing') return;
    const ids = Array.isArray(idsSnapshot.val()) ? idsSnapshot.val() : [];
    const idx = requestedIndex ?? indexSnapshot.val() ?? 0;
    if (idx >= ids.length) { await window.roomRef.child('guessMe/status').set('complete'); return; }
    const bank = await ensureGuessMeQuestionBank();
    const card = bank.find(q => q.id === ids[idx]);
    if (!card) throw new Error(`Question ${ids[idx]} is missing from the You Get Me bank.`);
    const [hostSnapshot, partnerSnapshot] = await Promise.all([
        window.roomRef.child('members/host').once('value'),
        window.roomRef.child('members/partner').once('value')
    ]);
    const hostUid = hostSnapshot.val();
    const partnerUid = partnerSnapshot.val();
    if (!hostUid || !partnerUid) throw new Error('Both players must join the room before the game starts.');
    const answererUid = (idx % 2 === 0) ? hostUid : partnerUid;
    const predictorUid = (idx % 2 === 0) ? partnerUid : hostUid;
    await window.roomRef.update({
        'guessMe/status': 'playing',
        'guessMe/currentIndex': idx,
        'guessMe/answer': null,
        'guessMe/guess': null,
        'guessMe/question': { id: card.id, prompt: card.question, options: card.options },
        'guessMe/answererUid': answererUid,
        'guessMe/predictorUid': predictorUid,
        'guessMe/submissionStatus/answerSubmitted': false,
        'guessMe/submissionStatus/guessSubmitted': false,
        'guessMe/submissionStatus/resolved': false,
        'guessMe/submissionStatus/scored': false
    });
}
async function startGuessMeReplay(gm) {
    if (window.currentRoomRole !== 'host' || guessMeReplayStarting
        || gm.replayVotes?.host !== 'yes' || gm.replayVotes?.partner !== 'yes') return;
    guessMeReplayStarting = true;
    try {
        await ensureGuessMeQuestionBank();
        const ids = pickGuessMeQuestions(gm.length, gm.vibe);
        if (ids.length !== gm.length) {
            throw new Error(`Only ${ids.length} questions are available for this vibe. Choose a shorter round.`);
        }
        await window.roomRef.update({
            'guessMe/status': 'lobby',
            'guessMe/hostReady': false,
            'guessMe/partnerReady': false,
            'guessMe/scores/host': 0,
            'guessMe/scores/partner': 0,
            'guessMe/question': null,
            'guessMe/answer': null,
            'guessMe/guess': null,
            'guessMe/submissionStatus/answerSubmitted': false,
            'guessMe/submissionStatus/guessSubmitted': false,
            'guessMe/submissionStatus/resolved': false,
            'guessMe/submissionStatus/scored': false,
            'guessMe/questionIds': null,
            'guessMe/currentIndex': 0,
            'guessMe/replayVotes/host': null,
            'guessMe/replayVotes/partner': null
        });
    } catch (error) {
        reportGuessMeError(error);
    } finally {
        guessMeReplayStarting = false;
    }
}
async function transitionGuessMeStatus(nextStatus) {
    if (!window.roomRef) throw new Error('You are no longer connected to this room.');
    const statusRef = window.roomRef.child('guessMe/status');
    const currentStatus = (await statusRef.once('value')).val();
    const allowed = (currentStatus === 'playing' && ['paused', 'ended'].includes(nextStatus))
        || (currentStatus === 'paused' && ['playing', 'ended'].includes(nextStatus));
    if (!allowed) {
        if (typeof showToast === 'function') showToast('The game changed on the other device. Your screen will update.');
        return;
    }
    await statusRef.set(nextStatus);
}
async function renderGuessMe(gm) {
    const view = document.getElementById('guessMeView');
    if (!view) return;
    view.replaceChildren();
    const header = document.createElement('section');
    header.className = 'app-hero';
    const h = document.createElement('h2');
    h.id = 'guessMeTitle';
    h.textContent = gm.status === 'lobby' ? 'You Get Me — Lobby'
        : gm.status === 'complete' ? 'You Get Me — Results'
            : gm.status === 'paused' ? 'You Get Me — Paused'
                : gm.status === 'ended' ? 'You Get Me — Game ended' : 'You Get Me';
    const p = document.createElement('p');
    const questionCount = Array.isArray(gm.questionIds) ? gm.questionIds.length : gm.length;
    p.textContent = gm.status === 'lobby'
        ? 'Ready check'
        : gm.status === 'complete'
            ? `${questionCount} questions played`
            : gm.status === 'ended'
                ? `Game ended after ${Math.min(questionCount, (gm.currentIndex || 0) + (gm.submissionStatus?.resolved ? 1 : 0))} completed questions`
                : `${gm.status === 'paused' ? 'Paused · ' : ''}Question ${((gm.currentIndex || 0) + 1)} of ${questionCount}`;
    header.append(h, p);
    view.appendChild(header);
    const isHost = window.currentRoomRole === 'host';
    if (['playing', 'paused'].includes(gm.status)) {
        const controls = document.createElement('section');
        controls.className = 'guess-me-controls';
        controls.setAttribute('aria-label', 'Shared game controls');
        const status = document.createElement('p');
        status.textContent = gm.status === 'paused'
            ? 'The game is paused for both players.'
            : 'Both players are in the same round.';
        const actions = document.createElement('div');
        actions.className = 'guess-me-control-actions';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'btn-primary';
        toggle.textContent = gm.status === 'paused' ? 'Resume game' : 'Pause game';
        toggle.onclick = async () => {
            toggle.disabled = true;
            try {
                await transitionGuessMeStatus(gm.status === 'paused' ? 'playing' : 'paused');
            } catch (error) {
                reportGuessMeError(error);
                toggle.disabled = false;
            }
        };
        const end = document.createElement('button');
        end.type = 'button';
        end.className = 'btn-secondary';
        end.textContent = 'End game';
        end.onclick = async () => {
            if (!confirm('End this game for both of you? Your current scores will be saved, but you will not be able to resume.')) return;
            end.disabled = true;
            try {
                await transitionGuessMeStatus('ended');
            } catch (error) {
                reportGuessMeError(error);
                end.disabled = false;
            }
        };
        actions.append(toggle, end);
        controls.append(status, actions);
        view.appendChild(controls);
    }
    if (gm.status === 'lobby') {
        if (isHost) {
            view.appendChild(createJoinRequestsSection(
                'Share the room code with your partner. Their request will appear here.',
                'guessMeJoinRequestStatus'
            ));
        }
        const card = document.createElement('section'); card.className = 'continue-card';
        const icon = document.createElement('span'); icon.className='continue-icon'; icon.textContent='♡'; icon.setAttribute('aria-hidden','true');
        const content = document.createElement('div'); content.className = 'continue-content';
        const label = document.createElement('span'); label.className = 'continue-label'; label.textContent = 'Ready check';
        const t = document.createElement('h2'); t.className = 'continue-title';
        t.textContent = (isHost ? gm.hostReady : gm.partnerReady) ? 'You are ready ✓' : 'Mark yourself ready when you are set.';
        const hostName = roomDisplayNames.host?.name || 'Player A';
        const partnerName = roomDisplayNames.partner?.name || 'Player B';
        const readiness = document.createElement('p');
        readiness.className = 'round-builder-intro';
        readiness.textContent = `${hostName}: ${gm.hostReady ? 'ready' : 'not ready'} · ${partnerName}: ${gm.partnerReady ? 'ready' : 'not ready'}`;
        content.append(label, t, readiness);
        if (isHost && window.currentRoomCode) {
            const codeP = document.createElement('p');
            codeP.className = 'round-builder-intro';
            codeP.textContent = 'Room code: ' + window.currentRoomCode;
            codeP.style.fontWeight = '700';
            codeP.style.wordBreak = 'break-all';
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-secondary';
            copyBtn.textContent = 'Copy code';
            copyBtn.style.marginTop = '6px';
            copyBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(window.currentRoomCode);
                    if (typeof showToast === 'function') showToast('Room code copied.');
                } catch (error) {
                    console.error('Could not copy the You Get Me room code:', error);
                    if (typeof showToast === 'function') showToast('Copy failed — select the code manually.');
                }
            };
            content.append(codeP, copyBtn);
        }
        const readyBtn = document.createElement('button'); readyBtn.className='btn-primary';
        const iAmReady = isHost ? gm.hostReady : gm.partnerReady;
        readyBtn.textContent = iAmReady ? 'I need a moment' : "I'm ready";
        readyBtn.onclick = async () => {
            try {
                const key = isHost ? 'hostReady' : 'partnerReady';
                await window.roomRef.child(`guessMe/${key}`).set(!(isHost ? gm.hostReady : gm.partnerReady));
            } catch (e) {
                console.error('Could not update You Get Me ready status:', e);
                reportGuessMeError(e);
            }
        };
        const start = document.createElement('button'); start.className='btn-primary'; start.textContent='Start game';
        start.classList.toggle('hidden', !isHost);
        start.disabled = !(gm.hostReady && gm.partnerReady);
        start.onclick = async () => {
            start.disabled = true;
            try {
                if (!gm.hostReady || !gm.partnerReady) throw new Error('Both players must be ready before starting.');
                await ensureGuessMeQuestionBank();
                const ids = pickGuessMeQuestions(gm.length, gm.vibe);
                if (!ids.length) throw new Error(`No You Get Me questions are available for the ${gm.vibe} vibe.`);
                if (ids.length !== gm.length) {
                    throw new Error(`Only ${ids.length} questions are available for this vibe. Choose a shorter round.`);
                }
                await window.roomRef.update({
                    'guessMe/questionIds': ids,
                    'guessMe/length': ids.length,
                    'guessMe/currentIndex': 0,
                    'guessMe/status': 'playing'
                });
                await loadGuessMeQuestion(0);
            } catch (error) {
                console.error('Could not start You Get Me:', error);
                reportGuessMeError(error);
                start.disabled = false;
            }
        };
        card.append(icon, content, readyBtn, start);
        view.appendChild(card);
        const info = document.createElement('section'); info.className='categories-section';
        const ip = document.createElement('p'); ip.className='round-builder-intro';
        ip.textContent = 'Length: ' + gm.length + ' questions · Vibe: ' + gm.vibe + ' · You are ' + (isHost ? 'Player A (host)' : 'Player B (partner)') + '.';
        const actions = document.createElement('div'); actions.className='modal-actions round-builder-actions';
        const leave = document.createElement('button'); leave.className='btn-secondary'; leave.textContent='Leave room';
        leave.onclick = leaveGuessMeRoom;
        actions.append(leave);
        info.append(ip, actions);
        view.appendChild(info);
        return;
    }
    if (gm.status === 'ended') {
        const card = document.createElement('section');
        card.className = 'continue-card';
        const content = document.createElement('div');
        content.className = 'continue-content';
        const label = document.createElement('span');
        label.className = 'continue-label';
        label.textContent = 'Partial results';
        const title = document.createElement('h2');
        title.className = 'continue-title';
        title.textContent = 'Game ended';
        const hostScore = gm.scores?.host ?? 0;
        const partnerScore = gm.scores?.partner ?? 0;
        const total = gm.scores ? hostScore + partnerScore : 0;
        const played = Array.isArray(gm.questionIds) ? gm.questionIds.length : gm.length;
        const completed = Math.min(played, (gm.currentIndex || 0) + (gm.submissionStatus?.resolved ? 1 : 0));
        const summary = document.createElement('p');
        const hostName = roomDisplayNames.host?.name || 'Player A';
        const partnerName = roomDisplayNames.partner?.name || 'Player B';
        summary.textContent = `Completed ${completed} of ${played} questions. ${hostName}: ${hostScore} correct · ${partnerName}: ${partnerScore} correct (${total} total).`;
        content.append(label, title, summary);
        const leave = document.createElement('button');
        leave.type = 'button';
        leave.className = 'btn-secondary';
        leave.textContent = 'Leave game';
        leave.onclick = leaveGuessMeRoom;
        card.append(content, leave);
        view.appendChild(card);
        return;
    }
    if (gm.status === 'complete') {
        const card = document.createElement('section'); card.className='continue-card';
        const content = document.createElement('div'); content.className='continue-content';
        const label = document.createElement('span'); label.className='continue-label'; label.textContent='Results';
        const t = document.createElement('h2'); t.className='continue-title';
        const hostScore = gm.scores?.host ?? 0;
        const partnerScore = gm.scores?.partner ?? 0;
        const total = hostScore + partnerScore;
        const played = Array.isArray(gm.questionIds) ? gm.questionIds.length : gm.length;
        const pct = played ? total / played : 0;
        let title = 'Still Discovering Each Other';
        if (pct >= 0.91) title = 'Practically Mind Readers';
        else if (pct >= 0.71) title = 'You Know Them Well';
        else if (pct >= 0.51) title = 'Pretty in Sync';
        else if (pct >= 0.31) title = 'Getting to Know Your Person';
        t.textContent = title;
        const summary = document.createElement('p');
        const hostName = roomDisplayNames.host?.name || 'Player A';
        const partnerName = roomDisplayNames.partner?.name || 'Player B';
        summary.textContent = `Played ${played} questions. ${hostName}: ${hostScore} predictions correct · ${partnerName}: ${partnerScore} predictions correct.`;
        content.append(label, t, summary);
        card.appendChild(content);
        const replayVotes = gm.replayVotes || {};
        const myRole = isHost ? 'host' : 'partner';
        const partnerRole = isHost ? 'partner' : 'host';
        const myVote = replayVotes[myRole];
        const partnerVote = replayVotes[partnerRole];
        const replayPrompt = document.createElement('p');
        replayPrompt.className = 'round-builder-intro';
        replayPrompt.textContent = 'Would you both like to play another round?';
        const replayStatus = document.createElement('p');
        replayStatus.className = 'card-answer-status';
        replayStatus.setAttribute('role', 'status');
        replayStatus.textContent = myVote === 'no'
            ? 'You chose to finish this game.'
            : partnerVote === 'no' ? 'Your partner chose to finish this game.'
                : myVote === 'yes' ? 'You’re in. Waiting for your partner.'
                    : partnerVote === 'yes' ? 'Your partner is up for another round. What do you think?'
                        : 'Choose whether you would like to continue.';
        const voteButtons = document.createElement('div');
        voteButtons.className = 'guess-me-replay-actions';
        ['yes', 'no'].forEach(vote => {
            const button = document.createElement('button');
            button.className = vote === 'yes' ? 'btn-primary' : 'btn-secondary';
            button.textContent = vote === 'yes' ? 'Yes, play another round' : 'No, finish here';
            button.disabled = Boolean(myVote || partnerVote === 'no');
            button.onclick = async () => {
                button.disabled = true;
                try {
                    await window.roomRef.child(`guessMe/replayVotes/${myRole}`).set(vote);
                } catch (error) {
                    reportGuessMeError(error);
                    button.disabled = false;
                }
            };
            voteButtons.appendChild(button);
        });
        const home = document.createElement('button'); home.className='btn-secondary'; home.textContent='Leave game';
        home.onclick = leaveGuessMeRoom;
        card.append(replayPrompt, voteButtons, replayStatus, home);
        view.appendChild(card);
        if (isHost && replayVotes.host === 'yes' && replayVotes.partner === 'yes') {
            await startGuessMeReplay(gm);
        }
        return;
    }
    const q = gm.question;
    const idx = gm.currentIndex || 0;
    const hostIsAnswerer = (idx % 2 === 0);
    const iAmAnswerer = isHost ? hostIsAnswerer : !hostIsAnswerer;
    const ss = gm.submissionStatus || {};
    if (gm.status === 'playing' && ss.answerSubmitted && ss.guessSubmitted && !ss.resolved && isHost) {
        try {
            await window.roomRef.child('guessMe/submissionStatus/resolved').set(true);
        } catch (error) {
            reportGuessMeError(error);
        }
        return;
    }
    if (ss.resolved && !ss.scored && isHost) {
        (async () => {
            try {
                const scoreLock = await window.roomRef.child('guessMe/submissionStatus/scored')
                    .transaction(current => current === true ? undefined : true);
                if (scoreLock.committed && gm.answer?.value === gm.guess?.value) {
                    const hostIsPredictor = idx % 2 !== 0;
                    const scorePath = `guessMe/scores/${hostIsPredictor ? 'host' : 'partner'}`;
                    await window.roomRef.child(scorePath).transaction(current => (Number(current) || 0) + 1);
                }
            } catch (error) {
                reportGuessMeError(error);
            }
        })();
    }
    const revealAnswer = gm.answer?.value;
    const revealGuess = gm.guess?.value;
    const revealOptions = q?.options;
    const revealReady = ss.resolved
        && Array.isArray(revealOptions)
        && Number.isInteger(revealAnswer)
        && Number.isInteger(revealGuess)
        && revealAnswer >= 0 && revealAnswer < revealOptions.length
        && revealGuess >= 0 && revealGuess < revealOptions.length;
    const qCard = document.createElement('section'); qCard.className='app-hero';
    const qp = document.createElement('p'); qp.className='round-builder-intro';
    const answererName = roomDisplayNames[hostIsAnswerer ? 'host' : 'partner']?.name || (hostIsAnswerer ? 'Player A' : 'Player B');
    const predictorName = roomDisplayNames[hostIsAnswerer ? 'partner' : 'host']?.name || (hostIsAnswerer ? 'Player B' : 'Player A');
    qp.textContent = ss.resolved ? 'Both choices are locked in. Here’s how they compare!'
        : iAmAnswerer ? `Your turn to choose, ${answererName}.`
            : 'Guess what your partner will say.';
    const qText = document.createElement('h2');
    qText.textContent = q ? (ss.resolved || iAmAnswerer ? q.prompt : 'Guess: ' + q.prompt) : 'Loading question…';
    qCard.append(qp, qText);
    if (!ss.resolved && q && Array.isArray(q.options) && q.options.length === 4) {
        const opts = document.createElement('div');
        opts.style.display='flex'; opts.style.flexDirection='column'; opts.style.gap='8px'; opts.style.marginTop='12px';
        const alreadySubmitted = iAmAnswerer ? ss.answerSubmitted : ss.guessSubmitted;
        const waitingForAnswer = !iAmAnswerer && !ss.answerSubmitted;
        q.options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className='btn-secondary'; btn.style.textAlign='left'; btn.textContent=opt;
            btn.dataset.idx = i;
            btn.setAttribute('aria-pressed', 'false');
            btn.disabled = alreadySubmitted || waitingForAnswer || gm.status === 'paused';
            btn.onclick = () => {
                opts.querySelectorAll('button').forEach(option => {
                    option.classList.remove('active');
                    option.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
            };
            opts.appendChild(btn);
        });
        qCard.appendChild(opts);
        const submit = document.createElement('button'); submit.className='btn-primary'; submit.style.marginTop='12px';
        submit.disabled = alreadySubmitted || waitingForAnswer || gm.status === 'paused';
        submit.textContent = gm.status === 'paused' ? 'Game paused'
            : alreadySubmitted ? 'Answer locked'
                : iAmAnswerer ? 'Lock in answer'
                    : waitingForAnswer ? 'Waiting for partner…' : 'Lock in guess';
        const actionStatus = document.createElement('p');
        actionStatus.className = 'card-answer-status';
        actionStatus.setAttribute('role', 'status');
        actionStatus.textContent = gm.status === 'paused' ? 'Resume the game when you are both ready to continue.'
            : iAmAnswerer
            ? (ss.answerSubmitted ? 'Your answer is locked. Your partner is making a guess.' : 'Your partner will not see your answer until both of you lock in.')
            : (ss.guessSubmitted ? 'Your guess is locked. Waiting to reveal together.' : waitingForAnswer ? 'Your partner picks their answer first.' : 'Choose what you think your partner selected.');
        submit.onclick = async () => {
            const sel = opts.querySelector('button.active');
            if (!sel) {
                actionStatus.textContent = 'Choose an option before locking in.';
                return;
            }
            submit.disabled = true;
            try {
                const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
                if (!user) throw new Error('Sign in is required to submit an answer.');
                const expectedUid = iAmAnswerer ? gm.answererUid : gm.predictorUid;
                if (user.uid !== expectedUid) throw new Error('It is not your turn to submit this choice.');
                const value = Number(sel.dataset.idx);
                const timestamp = Date.now();
                if (iAmAnswerer) {
                    await window.roomRef.update({
                        'guessMe/answer': { uid: user.uid, value, submittedAt: timestamp },
                        'guessMe/submissionStatus/answerSubmitted': true
                    });
                } else {
                    await window.roomRef.update({
                        'guessMe/guess': { uid: user.uid, value, submittedAt: timestamp },
                        'guessMe/submissionStatus/guessSubmitted': true
                    });
                }
            } catch (error) {
                console.error('Could not submit You Get Me choice:', error);
                actionStatus.textContent = `Could not submit your choice: ${error.message}`;
                submit.disabled = false;
            }
        };
        qCard.append(submit, actionStatus);
    }
    view.appendChild(qCard);
    if (ss.resolved) {
        const reveal = document.createElement('section');
        reveal.className = 'continue-card guess-me-reveal';
        reveal.setAttribute('aria-labelledby', 'guessMeRevealTitle');
        const content = document.createElement('div');
        content.className = 'continue-content guess-me-reveal-content';
        const label = document.createElement('span');
        label.className = 'continue-label';
        label.textContent = 'The big reveal';
        const t = document.createElement('h2');
        t.className = 'continue-title';
        t.id = 'guessMeRevealTitle';
        const correct = revealReady && revealAnswer === revealGuess;
        t.textContent = !revealReady ? 'Your choices are on their way…'
            : correct ? 'You’re in sync! ✨' : 'A fun surprise! 💛';
        const comparison = document.createElement('div');
        comparison.className = 'guess-me-answer-comparison';
        comparison.setAttribute('role', 'group');
        comparison.setAttribute('aria-label', 'Both players’ choices');
        const createAnswerTile = (name, heading, value, className) => {
            const tile = document.createElement('article');
            tile.className = `guess-me-answer-tile ${className}`;
            const who = document.createElement('h3');
            who.textContent = `${name} ${heading}`;
            const answer = document.createElement('p');
            answer.className = 'guess-me-answer-value';
            answer.textContent = revealReady ? revealOptions[value] : 'Loading both choices…';
            tile.append(who, answer);
            return tile;
        };
        comparison.append(
            createAnswerTile(answererName, 'chose', revealAnswer, 'guess-me-answer-actual'),
            createAnswerTile(predictorName, 'predicted', revealGuess, 'guess-me-answer-guess')
        );
        const result = document.createElement('p');
        result.className = 'guess-me-reveal-result';
        result.setAttribute('aria-live', 'polite');
        result.textContent = revealReady
            ? correct ? 'Nailed it! Take a moment to celebrate your match.' : 'Different picks, and something new to learn about each other.'
            : 'Waiting for both choices to load before continuing.';
        content.append(label, t, comparison, result);
        reveal.appendChild(content);
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn-primary';
        nextBtn.textContent = isHost ? 'Next question' : 'Waiting for host';
        nextBtn.disabled = gm.status === 'paused' || !ss.scored || !revealReady || !isHost;
        if (gm.status === 'paused') nextBtn.textContent = 'Resume to continue';
        else if (!revealReady || !ss.scored) nextBtn.textContent = 'Revealing…';
        nextBtn.onclick = async () => {
            if (!isHost || !revealReady || !ss.scored || gm.status !== 'playing') return;
            const nextIdx = (gm.currentIndex||0) + 1;
            if (nextIdx >= (gm.length||0)) {
                try {
                    await window.roomRef.child('guessMe/status').set('complete');
                } catch (error) {
                    reportGuessMeError(error);
                }
            } else {
                try {
                    await loadGuessMeQuestion(nextIdx);
                } catch (error) {
                    reportGuessMeError(error);
                }
            }
        };
        reveal.appendChild(nextBtn);
        view.appendChild(reveal);
    }
}
window.renderGuessMe = renderGuessMe;
