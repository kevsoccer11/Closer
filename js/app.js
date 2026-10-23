let masterDatabase = [];
let customUserCards = JSON.parse(localStorage.getItem('closer_custom_cards') || '[]');
let partnerCards = JSON.parse(localStorage.getItem('closer_partner_cards') || '[]');
let journalEntries = JSON.parse(localStorage.getItem('closer_journal') || '[]');
let privateRevealEntries = JSON.parse(localStorage.getItem('closer_private_reveals') || '[]');
let privateShareKey = sessionStorage.getItem('closer_private_share_key') || '';
let favoriteIds = JSON.parse(localStorage.getItem('closer_favs') || '[]');

let unspentDeck = [];
let currentCard = null;
let activeModule = 'sexuality';
let activeIntensity = 'all';
let activePromptStyle = 'all';
let activeGameMode = 'classic';
const EXPLICIT_AGE_CONFIRMATION_KEY = 'closer_explicit_age_confirmed';
let compareFirstModules = ['sexuality'];
let compareFirstLevels = ['1', '2', '3'];
let compareFirstRoundId = null;
let compareFirstRoundIndex = 0;
let compareFirstRoundTotal = 0;
let compareFirstRestoreState = null;
let turnTakingEnabled = false;
let activeTurn = 0;
let pickedAnswerer = null;
let usingStarterDeck = false;
let communityVoteCounts = {};
let myCommunityVotes = new Set();
let modeTimer = null;
let modeTimerRemaining = 0;
let cardLoadError = false;
let sharedRevealListener = null;
let sharedCardListener = null;
let activeCardSyncListener = null;
let partnerSeatListener = null;
let joinRequestListener = null;
let roomJoinRequestsListener = null;
let pendingJoinRequests = {};
let receivedSharedReveals = [];
let seenSharedRevealIds = new Set();
let processingSharedRevealIds = new Set();
let shareClientId = sessionStorage.getItem('closer_share_client_id') || '';
let deckOptionsElement = null;
let partnerCardsSectionElement = null;
let partnerCardsListElement = null;
let processingPartnerCardKeys = new Set();
let pairManagementContainer = null;
let pendingJoinRequestRef = null;
let cardAnswerListeners = [];
let cardAnswerSeatListener = null;
let cardAnswerSetupKey = null;
let cardAnswerRoomRef = null;
let cardAnswerCard = null;
let cardAnswerOwnUid = null;
let cardAnswerPartnerUid = null;
let cardAnswerOwn = null;
let cardAnswerPartner = null;

async function initDatabase() {
    console.log("Initializing database...");

    let localCards = [];
    try {
        const response = await fetch('./cards.json');
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const data = await response.json();
        localCards = data.cards || [];
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
    let remoteCards = [];
    if (typeof window.db !== 'undefined' && window.db) {
        try {
            const snapshot = await window.db.ref('cards').once('value');
            const remoteData = snapshot.val();
            if (remoteData) {
                remoteCards = Array.isArray(remoteData)
                    ? remoteData.filter(Boolean)
                    : Object.entries(remoteData).map(([id, card]) => card && ({ ...card, id: card.id || id })).filter(Boolean);
                console.log(`Loaded ${remoteCards.length} cards from Firebase Database`);
            }
        } catch (e) {
            console.warn("Firebase cards read error:", e);
            cardLoadError = true;
        }
    }

    const cardsById = new Map();
    [...localCards, ...remoteCards, ...customUserCards].forEach((card, index) => {
        if (card && card.prompt) cardsById.set(card.id || `loaded-${index}`, { ...card, id: card.id || `loaded-${index}` });
    });
    masterDatabase = [...cardsById.values()];

    if (window.db && window.firebaseConfigured) await loadCommunityVotes();

    rebuildUnspentDeck();
    drawNextCard();
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
        appStatus.textContent = statusMessages.join(' ');
    }
}

function rebuildUnspentDeck() {
    const filteredCards = getFilteredCards();
    const weightedCards = activeGameMode === 'compare-first'
        ? filteredCards
        : filteredCards.flatMap(card => {
            if (card.visibility !== 'community') return [card];
            const extraCopies = Math.min(3, Math.floor((communityVoteCounts[card.id] || 0) / 3));
            return Array.from({ length: 1 + extraCopies }, () => card);
        });
    for (let i = weightedCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [weightedCards[i], weightedCards[j]] = [weightedCards[j], weightedCards[i]];
    }
    unspentDeck = weightedCards;
}

function getFilteredCards() {
    return masterDatabase.filter(card => {
        const matchesCompareFirst = activeGameMode === 'compare-first';
        const matchesModule = matchesCompareFirst
            ? compareFirstModules.includes(card.module)
            : activeModule === 'all' || card.module === activeModule;
        const intensity = String(card.intensity);
        const matchesMode = activeGameMode !== 'deep' || intensity === '3';
        const matchesIntensity = matchesCompareFirst
            ? compareFirstLevels.includes(intensity)
            : activeIntensity === 'all' || intensity === String(activeIntensity);
        const promptStyle = card.promptStyle || (card.contextType === 'action' ? 'activity' : 'question');
        const matchesPromptStyle = matchesCompareFirst || activePromptStyle === 'all' || promptStyle === activePromptStyle;
        return matchesModule && matchesMode && matchesIntensity && matchesPromptStyle
            && (!matchesCompareFirst || (Array.isArray(card.options) && card.options.length >= 2));
    });
}

async function loadCommunityVotes() {
    try {
        const snapshot = await window.db.ref('cardVotes').once('value');
        const votes = snapshot.val() || {};
        communityVoteCounts = {};
        myCommunityVotes = new Set();
        let user = window.firebase.auth().currentUser;
        if (!user && window.firebaseAuthReady) {
            try {
                user = await window.firebaseAuthReady;
            } catch (error) {
                console.warn('Signed-in user vote state is unavailable:', error);
            }
        }

        Object.entries(votes).forEach(([cardId, cardVotes]) => {
            if (!cardVotes || typeof cardVotes !== 'object') return;
            const voters = Object.keys(cardVotes).filter(uid => cardVotes[uid]);
            communityVoteCounts[cardId] = voters.length;
            if (user && cardVotes[user.uid]) myCommunityVotes.add(cardId);
        });
    } catch (error) {
        console.warn('Community vote counts could not be loaded:', error);
        const status = document.getElementById('appStatus');
        if (status) status.textContent = `${status.textContent} Community votes are temporarily unavailable.`.trim();
    }
}

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

function setCommunityActions(card) {
    const isCommunityCard = card.visibility === 'community';
    const user = isCommunityCard && window.firebaseConfigured && window.firebase
        ? window.firebase.auth().currentUser
        : null;
    const isOwnCard = Boolean(user && card.createdBy === user.uid);
    const voteButton = document.getElementById('communityVoteBtn');
    const reportButton = document.getElementById('reportCardBtn');
    if (voteButton) {
        voteButton.classList.toggle('hidden', !isCommunityCard || isOwnCard);
        voteButton.classList.toggle('active', myCommunityVotes.has(card.id));
        voteButton.setAttribute('aria-pressed', String(myCommunityVotes.has(card.id)));
        const count = document.getElementById('communityVoteCount');
        if (count) count.textContent = String(communityVoteCounts[card.id] || 0);
    }
    if (reportButton) reportButton.classList.toggle('hidden', !isCommunityCard || isOwnCard);
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

function updateQuestionTypeSelection(style, announce = false) {
    activePromptStyle = style;
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
    document.getElementById('questionTypeSummary').textContent = labels[style];
    const confirmation = document.getElementById('questionTypeConfirmation');
    confirmation.textContent = announce ? `${labels[style]} selected.` : '';
}

function drawNextCard(isRemoteUpdate = false) {
    if (isCompareFirstSessionActive() && window.currentRoomRole !== 'host' && !isRemoteUpdate) {
        setCardActionStatus('Only the host can advance the Compare First session.');
        return;
    }
    if (activeGameMode !== 'compare-first' && unspentDeck.length === 0) rebuildUnspentDeck();
    if (unspentDeck.length === 0) {
        if (activeGameMode === 'compare-first' && compareFirstRoundIndex > 0) {
            completeCompareFirstRound();
            return;
        }
        currentCard = null;
        const badge = document.getElementById('cardCategory');
        const prompt = document.getElementById('cardPrompt');
        if (badge) badge.innerText = 'No questions found';
        if (prompt) prompt.innerText = 'Try changing your deck filters to find a question.';
        const nextCardBtn = document.getElementById('nextCardBtn');
        if (nextCardBtn) nextCardBtn.disabled = true;
        stopModeTimer();
        document.getElementById('actionTimerBar')?.classList.add('hidden');
        document.getElementById('communityVoteBtn')?.classList.add('hidden');
        document.getElementById('reportCardBtn')?.classList.add('hidden');
        if (activeGameMode === 'compare-first') {
            const setupStatus = document.getElementById('compareFirstSetupStatus');
            if (setupStatus) setupStatus.textContent = 'No multiple-choice cards match those module and level filters.';
        }
        return;
    }

    currentCard = { ...unspentDeck.pop(), roundId: createCardRoundId() };
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
    updateCompareFirstControls();

    if (typeof window.roomRef !== 'undefined' && window.roomRef && !isRemoteUpdate && currentCard.module !== 'explicit') {
        window.roomRef.child('activeCard').set(currentCard);
    }
}

function updateCompareFirstControls() {
    const nextCardBtn = document.getElementById('nextCardBtn');
    if (!nextCardBtn) return;
    if (!currentCard?.compareFirst) {
        nextCardBtn.textContent = 'Skip question';
        nextCardBtn.disabled = !currentCard;
        return;
    }
    const isHost = window.currentRoomRole === 'host';
    const answersSubmitted = Boolean(cardAnswerOwn && cardAnswerPartner);
    nextCardBtn.textContent = currentCard.compareFirstIndex >= currentCard.compareFirstTotal
        ? 'Finish poll round'
        : `Next poll · ${currentCard.compareFirstIndex}/${currentCard.compareFirstTotal}`;
    nextCardBtn.disabled = !isHost || !answersSubmitted;
}

function isCompareFirstSessionActive() {
    return activeGameMode === 'compare-first'
        || Boolean(currentCard?.compareFirst || currentCard?.compareFirstComplete);
}

function hasExplicitAgeConfirmation() {
    return localStorage.getItem(EXPLICIT_AGE_CONFIRMATION_KEY) === 'true';
}

function selectModule(module) {
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
    document.getElementById('cardCategory').textContent = 'Compare First';
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
        nextCardBtn.textContent = 'Poll round complete';
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

function advanceCard() {
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
    if (pickedAnswerer === 'Partner A') activeTurn = 0;
    if (pickedAnswerer === 'Partner B') activeTurn = 1;
    pickedAnswerer = null;
    if (turnTakingEnabled && currentCard) activeTurn = activeTurn === 0 ? 1 : 0;
    drawNextCard();
}

function renderCard(card) {
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
    document.getElementById('compareFirstComplete')?.classList.add('hidden');
    setCardActionStatus('');
    const badge = document.getElementById('cardCategory');
    const prompt = document.getElementById('cardPrompt');
    if (badge) badge.innerText = card.category || 'General';
    if (prompt) prompt.innerText = card.prompt;
    renderCardAnswerPanel(card);

    const favBtn = document.getElementById('favCardBtn');
    if (favBtn) favBtn.classList.toggle('active', favoriteIds.includes(card.id));
    if (favBtn) favBtn.setAttribute('aria-pressed', String(favoriteIds.includes(card.id)));
    const turnIndicator = document.getElementById('turnIndicator');
    if (turnIndicator) {
        turnIndicator.textContent = pickedAnswerer || `Partner ${activeTurn + 1} answers`;
        turnIndicator.classList.toggle('hidden', !turnTakingEnabled && !pickedAnswerer);
    }

    setCommunityActions(card);
    renderModeTimer();
    updateCompareFirstControls();
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
        const ownLabel = cardAnswerOwnUid === cardAnswerRoomRef?.hostUid ? 'Host' : 'You';
        const partnerLabel = cardAnswerPartnerUid === cardAnswerRoomRef?.hostUid ? 'Host' : 'Partner';
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
    if (!panel || !optionsContainer || !submitButton) return;
    if (!Array.isArray(card.options) || card.options.length < 2) {
        panel.classList.add('hidden');
        detachCardAnswerListeners();
        cardAnswerSetupKey = null;
        cardAnswerCard = null;
        return;
    }

    panel.classList.remove('hidden');
    if (cardAnswerCard?.roundId !== card.roundId) {
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

// Drawer & Modal Controller Functions
function openDrawer(title, contentHtml) {
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
    if (drawer) drawer.classList.remove('hidden');
    if (overlay) overlay.classList.remove('hidden');
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
        const includeQuestion = canLinkCurrentQuestion && document.getElementById('journalIncludeQuestion').checked;
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
            activeModule = card.module;
            activeGameMode = 'classic';
            activeIntensity = 'all';
            activePromptStyle = 'all';
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
            updateSectionView();
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
            || ![1, 2, 3].includes(Number(card.intensity))
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

    if (privateRevealEntries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'private-reveal-empty';
        empty.textContent = 'Your private entries will appear here. Only reveal one when you are ready.';
        list.appendChild(empty);
        return;
    }

    privateRevealEntries.forEach((entry, index) => {
        const item = document.createElement('article');
        item.className = 'private-reveal-item';
        const label = document.createElement('span');
        label.className = 'private-reveal-item-label';
        label.textContent = entry.type;
        const text = document.createElement('p');
        text.id = `private-reveal-content-${index}`;
        text.className = 'private-reveal-item-text hidden';
        text.textContent = entry.text;
        const actions = document.createElement('div');
        actions.className = 'private-reveal-item-actions';
        const revealButton = document.createElement('button');
        revealButton.type = 'button';
        revealButton.textContent = 'Reveal to partner';
        revealButton.setAttribute('aria-expanded', 'false');
        revealButton.setAttribute('aria-controls', text.id);
        revealButton.onclick = () => {
            const isRevealed = !text.classList.contains('hidden');
            text.classList.toggle('hidden', isRevealed);
            revealButton.textContent = isRevealed ? 'Reveal to partner' : 'Hide entry';
            revealButton.setAttribute('aria-expanded', String(!isRevealed));
        };
        const shareButton = document.createElement('button');
        shareButton.className = 'private-share-entry-btn';
        shareButton.type = 'button';
        shareButton.textContent = 'Share encrypted';
        shareButton.disabled = !window.roomRef || !privateShareKey;
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
            privateRevealEntries.splice(index, 1);
            localStorage.setItem('closer_private_reveals', JSON.stringify(privateRevealEntries));
            renderWildRevealEntries();
        };
        actions.append(revealButton, shareButton, deleteButton);
        item.append(label, text, actions);
        list.appendChild(item);
    });
    updatePrivateShareUi();
}

function updateSectionView() {
    const isWild = activeModule === 'secrets';
    const isExplicit = activeModule === 'explicit';
    document.body.dataset.module = activeModule;
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
        ? ['Flirty', 'Sensual', 'Steamy']
        : module === 'explicit'
            ? ['Warm-up', 'Direct', 'Detailed']
        : ['Mild', 'Moderate', 'Wild'];

    document.querySelectorAll('.intensity-btn[data-level]').forEach(button => {
        const level = Number(button.dataset.level);
        if (level >= 1 && level <= 3) button.textContent = labels[level - 1];
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
        ? ['Flirty', 'Sensual', 'Steamy']
        : ['Mild', 'Moderate', 'Wild'];
    document.querySelectorAll('#customIntensity option').forEach(option => {
        const level = Number(option.value);
        if (level >= 1 && level <= 3) option.textContent = labels[level - 1];
    });
}

function closeDrawer() {
    const drawer = document.getElementById('appDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (drawer) drawer.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
}

function toggleModal(show) {
    const modal = document.getElementById('customCardModal');
    if (modal) {
        if (show) modal.classList.remove('hidden');
        else modal.classList.add('hidden');
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
        statusText.textContent = `Room created and ready · Host · ${window.currentRoomCode}`;
    } else if (window.currentRoomRole === 'partner') {
        statusText.textContent = `Connected to room ${window.currentRoomCode} · Partner`;
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

    if (window.currentRoomRole !== 'host') return;
    const requests = Object.entries(pendingJoinRequests).filter(([, request]) => request?.status === 'pending');
    const section = document.createElement('section');
    section.className = 'room-requests-section';
    const heading = document.createElement('h4');
    heading.textContent = 'Join requests';
    section.appendChild(heading);
    if (requests.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'room-request-empty';
        empty.textContent = 'No pending requests. Only one partner can be approved.';
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
    pairManagementContainer.appendChild(section);
}

async function resolveJoinRequest(uid, approved) {
    if (!window.roomRef || window.currentRoomRole !== 'host') return;
    const requestRef = window.roomRef.child(`joinRequests/${uid}`);
    try {
        if (approved) {
            const partnerRef = window.roomRef.child('members/partner');
            const result = await partnerRef.transaction(currentUid => currentUid === null ? uid : undefined);
            if (!result.committed) {
                setPairStatus('This room already has a partner. The two-person limit has been reached.');
                return;
            }
        }
        await requestRef.update({
            status: approved ? 'approved' : 'denied',
            resolvedAt: Date.now()
        });
        setPairStatus(approved
            ? 'Partner approved. They can now enter the room.'
            : 'Join request denied.');
    } catch (error) {
        console.error('Could not resolve the room join request:', error);
        setPairStatus(`Could not ${approved ? 'approve' : 'deny'} the request: ${error.message}`);
    }
}

function setPairStatus(message) {
    const status = document.getElementById('pairStatus');
    if (status) status.textContent = message;
}

function detachRoomAccessListeners() {
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
    if (partnerSeatListener && window.roomRef) {
        window.roomRef.child('members/partner').off('value', partnerSeatListener);
        partnerSeatListener = null;
    }
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
    localStorage.setItem('closer_room_code', roomCode);
    window.roomRef = window.db.ref(`rooms/${roomCode}`);

    activeCardSyncListener = snapshot => {
        const remoteCard = snapshot.val();
        if (remoteCard?.module === 'explicit' && !hasExplicitAgeConfirmation()) return;
        if (remoteCard && (!currentCard
            || remoteCard.id !== currentCard.id
            || remoteCard.roundId !== currentCard.roundId)) {
            currentCard = remoteCard;
            renderCard(currentCard);
        }
    };
    window.roomRef.child('activeCard').on('value', activeCardSyncListener);
    attachPrivateRevealListener();
    attachPartnerCardListener();

    if (role === 'host') {
        roomJoinRequestsListener = snapshot => {
            pendingJoinRequests = snapshot.val() || {};
            renderPairManagement();
        };
        window.roomRef.child('joinRequests').on('value', roomJoinRequestsListener);
    } else {
        pendingJoinRequests = {};
    }

    updatePrivateShareUi();
    renderWildRevealEntries();
    if (currentCard) renderCard(currentCard);
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
    if (currentCard && currentCard.module !== 'explicit') await window.roomRef.child('activeCard').set(currentCard);
    setPairStatus('Room created. Share the room code with your partner; you decide whether to approve their request.');
    renderPairManagement();
}

async function requestRoomAccess(roomCode) {
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
        connectToRoom(roomCode, 'host');
        renderPairManagement();
        return;
    }
    if (partnerSnapshot.val() === user.uid) {
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
            roomRef.child('members/partner').once('value').then(partnerSeat => {
                if (partnerSeat.val() !== user.uid) {
                    setPairStatus('Approval could not be confirmed. You have not joined the room.');
                    return;
                }
                connectToRoom(roomCode, 'partner');
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

// Bind event listeners safely on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    deckOptionsElement = document.getElementById('deckOptions');
    partnerCardsSectionElement = document.getElementById('partnerCardsSection');
    partnerCardsListElement = document.getElementById('partnerCardsList');
    // 1. Advance from the card or skip button
    const cardContainer = document.getElementById('cardContainer');
    if (cardContainer) {
        cardContainer.onclick = (event) => {
            if (event.target.closest('button, input, label, select, textarea')) return;
            if (isCompareFirstSessionActive()) return;
            advanceCard();
        };
    }

    const nextCardBtn = document.getElementById('nextCardBtn');
    if (nextCardBtn) {
        nextCardBtn.onclick = () => advanceCard();
    }

    const gameModeSelect = document.getElementById('gameModeSelect');
    if (gameModeSelect) {
        gameModeSelect.onchange = () => {
            const compareSetup = document.getElementById('compareFirstSetup');
            if (isCompareFirstSessionActive() && window.currentRoomRole !== 'host') {
                gameModeSelect.value = 'compare-first';
                setCardActionStatus('Only the host can control the Compare First session.');
                return;
            }
            if (gameModeSelect.value === 'compare-first') {
                const selectedModules = activeModule === 'life'
                    ? ['life']
                    : activeModule === 'sexuality'
                        ? ['sexuality']
                        : ['sexuality', 'life'];
                document.querySelectorAll('input[name="compareFirstModule"]').forEach(input => {
                    input.checked = selectedModules.includes(input.value);
                });
                document.querySelectorAll('input[name="compareFirstLevel"]').forEach(input => {
                    input.checked = activeIntensity === 'all' || activeIntensity === input.value;
                });
                compareSetup.classList.remove('hidden');
                return;
            }
            compareSetup.classList.add('hidden');
            if (activeGameMode === 'compare-first') exitCompareFirstMode();
            activeGameMode = gameModeSelect.value;
            activeIntensity = 'all';
            document.querySelectorAll('.intensity-btn').forEach(btn => {
                const isActive = btn.dataset.level === 'all';
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            });
            renderModeTimer();
            rebuildUnspentDeck();
            drawNextCard();
        };
    }

    document.getElementById('startCompareFirstBtn').onclick = startCompareFirstSession;
    document.getElementById('answerMorePollsBtn').onclick = answerMoreCompareFirstPolls;
    document.getElementById('continueRegularCardsBtn').onclick = continueToRegularCards;

    const pickTurnBtn = document.getElementById('pickTurnBtn');
    if (pickTurnBtn) {
        pickTurnBtn.onclick = () => {
            const choices = ['Partner A', 'Partner B', 'Both'];
            pickedAnswerer = choices[Math.floor(Math.random() * choices.length)];
            activeTurn = pickedAnswerer === 'Partner B' ? 1 : 0;
            const result = document.getElementById('turnPickerResult');
            if (result) result.textContent = `${pickedAnswerer} answers first`;
            const indicator = document.getElementById('turnIndicator');
            if (indicator) {
                indicator.textContent = `${pickedAnswerer} answers`;
                indicator.classList.remove('hidden');
            }
        };
    }

    const timerToggleBtn = document.getElementById('timerToggleBtn');
    if (timerToggleBtn) {
        timerToggleBtn.onclick = () => {
            if (modeTimer) {
                stopModeTimer();
                timerToggleBtn.textContent = 'Resume';
                return;
            }
            if (modeTimerRemaining <= 0) renderModeTimer();
            timerToggleBtn.textContent = 'Pause';
            modeTimer = setInterval(() => {
                modeTimerRemaining -= 1;
                document.getElementById('timerClock').textContent = formatTimer(modeTimerRemaining);
                if (modeTimerRemaining <= 0) {
                    stopModeTimer();
                    timerToggleBtn.textContent = 'Done';
                    setCardActionStatus('Reflection time is up. Continue whenever you’re ready.');
                }
            }, 1000);
        };
    }

    const communityVoteBtn = document.getElementById('communityVoteBtn');
    if (communityVoteBtn) {
        communityVoteBtn.onclick = async (event) => {
            event.stopPropagation();
            if (!currentCard || currentCard.visibility !== 'community' || !window.db || !window.firebase) return;
            communityVoteBtn.disabled = true;
            try {
                const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
                if (!user) throw new Error('Sign in is required to vote.');
                const voteRef = window.db.ref(`cardVotes/${currentCard.id}/${user.uid}`);
                const wasVoted = myCommunityVotes.has(currentCard.id);
                const result = await voteRef.transaction(value => value ? null : true);
                const isVoted = Boolean(result.snapshot.val());
                const voteCount = communityVoteCounts[currentCard.id] || 0;
                communityVoteCounts[currentCard.id] = Math.max(0, voteCount + (isVoted ? 1 : 0) - (wasVoted ? 1 : 0));
                if (isVoted) myCommunityVotes.add(currentCard.id);
                else myCommunityVotes.delete(currentCard.id);
                setCommunityActions(currentCard);
                rebuildUnspentDeck();
                setCardActionStatus(isVoted ? 'Upvote saved.' : 'Upvote removed.');
            } catch (error) {
                console.error('Community upvote failed:', error);
                setCardActionStatus(`Could not save your upvote: ${error.message}`);
            } finally {
                communityVoteBtn.disabled = false;
            }
        };
    }

    const reportCardBtn = document.getElementById('reportCardBtn');
    if (reportCardBtn) {
        reportCardBtn.onclick = async (event) => {
            event.stopPropagation();
            if (!currentCard || currentCard.visibility !== 'community' || !window.db || !window.firebase) return;
            if (!confirm('Report this public card for moderator review?')) return;
            reportCardBtn.disabled = true;
            try {
                const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
                if (!user) throw new Error('Sign in is required to report a card.');
                await window.db.ref(`cardReports/${currentCard.id}/${user.uid}`).set({
                    reason: 'community-report',
                    createdAt: window.firebase.database.ServerValue.TIMESTAMP
                });
                setCardActionStatus('Report sent for moderator review. Thank you.');
            } catch (error) {
                console.error('Community report failed:', error);
                setCardActionStatus(`Could not send your report: ${error.message}`);
            } finally {
                reportCardBtn.disabled = false;
            }
        };
    }

    const turnModeBtn = document.getElementById('turnModeBtn');
    if (turnModeBtn) {
        turnModeBtn.onclick = () => {
            turnTakingEnabled = !turnTakingEnabled;
            activeTurn = 0;
            turnModeBtn.setAttribute('aria-pressed', String(turnTakingEnabled));
            turnModeBtn.textContent = turnTakingEnabled ? 'Turn-taking on' : 'Turn-taking off';
            const turnIndicator = document.getElementById('turnIndicator');
            if (turnIndicator) turnIndicator.classList.toggle('hidden', !turnTakingEnabled);
            if (turnTakingEnabled && turnIndicator) turnIndicator.textContent = 'Partner 1 answers';
        };
    }

    // 2. Favorite Toggle Button on Main Card
    const favCardBtn = document.getElementById('favCardBtn');
    if (favCardBtn) {
        favCardBtn.onclick = (e) => {
            e.stopPropagation();
            if (!currentCard) return;
            const index = favoriteIds.indexOf(currentCard.id);
            if (index > -1) {
                favoriteIds.splice(index, 1);
            } else {
                favoriteIds.push(currentCard.id);
            }
            localStorage.setItem('closer_favs', JSON.stringify(favoriteIds));
            favCardBtn.classList.toggle('active', favoriteIds.includes(currentCard.id));
            favCardBtn.setAttribute('aria-pressed', String(favoriteIds.includes(currentCard.id)));
        };
    }

    // 3. Pair Partner Button (Realtime Room Sync)
    const pairBtn = document.getElementById('pairPartnerBtn');
    if (pairBtn) {
        pairBtn.onclick = () => {
            if (!window.db) {
                openDrawer('Pair Partner', `
                    <div class="drawer-item">
                        <p><strong>Room access is not configured yet.</strong></p>
                        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:6px;">Configure Firebase and deploy the included database rules to create host-approved rooms. Local play is still available.</p>
                    </div>
                `);
                return;
            }
            const html = `
                <div class="room-create-section">
                    <p>Create a room as host. Your partner can request to join, and you decide whether to approve them. Rooms allow one host and one partner.</p>
                    <button id="createRoomBtn" class="btn-primary" type="button">Create room</button>
                </div>
                <div class="room-join-section">
                    <label for="roomCodeInput">Room code from the host</label>
                    <input type="text" id="roomCodeInput" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Paste the host’s room code" />
                    <button id="joinRoomBtn" class="btn-secondary" type="button">Request to join</button>
                </div>
                <p id="pairStatus" class="pair-status" role="status" aria-live="polite"></p>
                <div id="pairManagementContainer"></div>
            `;
            openDrawer('Pair Partner', html);
            pairManagementContainer = document.getElementById('pairManagementContainer');
            if (window.currentRoomCode) renderPairManagement();
            const createButton = document.getElementById('createRoomBtn');
            if (createButton) {
                createButton.onclick = async () => {
                    createButton.disabled = true;
                    try {
                        await createRoom();
                        setPairStatus('Room created. Copy the code and share it with your partner.');
                    } catch (error) {
                        console.error('Could not create a room:', error);
                        setPairStatus(`Could not create a room: ${error.message}`);
                        createButton.disabled = false;
                    }
                };
            }
            const joinBtn = document.getElementById('joinRoomBtn');
            if (joinBtn) {
                joinBtn.onclick = async () => {
                    const input = document.getElementById('roomCodeInput').value.trim();
                    if (!input) {
                        setPairStatus('Enter the room code shared by the host.');
                        return;
                    }
                    joinBtn.disabled = true;
                    try {
                        await requestRoomAccess(input);
                        setPairStatus(window.currentRoomRole === 'host'
                            ? 'Connected as host.'
                            : window.currentRoomRole === 'partner'
                                ? 'The host has approved you.'
                                : 'Request sent. Wait for the host to approve or deny access.');
                    } catch (error) {
                        console.error('Could not request room access:', error);
                        setPairStatus(error.message);
                    } finally {
                        joinBtn.disabled = false;
                    }
                };
            }
            renderPairManagement();
        };
    }

    // 4. User Profile Button
    const profileBtn = document.getElementById('userProfileBtn');
    if (profileBtn) {
        profileBtn.onclick = () => {
            const customCount = customUserCards.length;
            const favCount = favoriteIds.length;
            const html = `
                <div class="drawer-item">
                    <p><strong>User Profile Stats</strong></p>
                    <p style="margin-top:6px;">Custom Questions Created: <strong>${customCount}</strong></p>
                    <p style="margin-top:4px;">Favorite Questions Bookmarked: <strong>${favCount}</strong></p>
                </div>
            `;
            openDrawer('Profile Stats', html);
        };
    }

    // 5. Journal Drawer Button
    const journalBtn = document.getElementById('journalDrawerBtn');
    if (journalBtn) {
        journalBtn.onclick = () => {
            openDrawer('Date Night Journal', '');
            const content = document.getElementById('drawerContent');
            renderJournalDrawerContent(content);
        };
    }

    // 6. Favorites Drawer Button
    const favsBtn = document.getElementById('favsDrawerBtn');
    if (favsBtn) {
        favsBtn.onclick = () => {
            openDrawer('Favorites', '');
            const content = document.getElementById('drawerContent');
            renderFavoritesDrawerContent(content);
        };
    }

    // 7. Settings Drawer Button
    const toolsBtn = document.getElementById('toolsDrawerBtn');
    if (toolsBtn) {
        toolsBtn.onclick = () => {
            const html = `
                <div class="drawer-item">
                    <p><strong>Database Status</strong></p>
                    <p style="margin-top:4px;">Total Cards in Master Deck: <strong>${masterDatabase.length}</strong></p>
                </div>
                <button id="resetAppBtn" class="btn-secondary" style="color:#ef4444; border-color:rgba(239,68,68,0.4); padding:10px; border-radius:10px;">Reset Local Storage Data</button>
            `;
            openDrawer('Settings', html);
            const content = document.getElementById('drawerContent');
            if (deckOptionsElement) {
                deckOptionsElement.classList.remove('hidden');
                deckOptionsElement.open = true;
                content.prepend(deckOptionsElement);
            }
            if (partnerCardsSectionElement) {
                content.appendChild(partnerCardsSectionElement);
                renderPartnerCards();
            }

            const resetBtn = document.getElementById('resetAppBtn');
            if (resetBtn) {
                resetBtn.onclick = () => {
                    if (confirm("Are you sure you want to reset local custom cards and favorites?")) {
                        localStorage.clear();
                        location.reload();
                    }
                };
            }
        };
    }

    // 8. Drawer Close Handlers
    const closeDrawerBtn = document.getElementById('closeDrawerBtn');
    if (closeDrawerBtn) closeDrawerBtn.onclick = () => closeDrawer();

    const drawerOverlay = document.getElementById('drawerOverlay');
    if (drawerOverlay) drawerOverlay.onclick = () => closeDrawer();

    // 9. Module Navigation Tabs
    document.querySelectorAll('.module-tab').forEach(tab => {
        tab.onclick = (e) => {
            e.stopPropagation();
            if (isCompareFirstSessionActive() && window.currentRoomRole !== 'host') {
                setCardActionStatus('Only the host can control the Compare First session.');
                return;
            }
            const selectedModule = tab.dataset.module;
            if (selectedModule === 'explicit' && !hasExplicitAgeConfirmation()) {
                document.getElementById('explicitAgeGate')?.classList.remove('hidden');
                return;
            }
            if (activeGameMode === 'compare-first') exitCompareFirstMode();
            selectModule(selectedModule);
        };
    });

    document.getElementById('confirmExplicitAccessBtn')?.addEventListener('click', () => {
        localStorage.setItem(EXPLICIT_AGE_CONFIRMATION_KEY, 'true');
        document.getElementById('explicitAgeGate')?.classList.add('hidden');
        selectModule('explicit');
    });
    document.getElementById('cancelExplicitAccessBtn')?.addEventListener('click', () => {
        document.getElementById('explicitAgeGate')?.classList.add('hidden');
    });

    // 10. Intensity Level Filter Buttons
    document.querySelectorAll('.intensity-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            if (isCompareFirstSessionActive() && window.currentRoomRole !== 'host') {
                setCardActionStatus('Only the host can control the Compare First session.');
                return;
            }
            if (activeGameMode === 'compare-first') exitCompareFirstMode();
            document.querySelectorAll('.intensity-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.intensity-btn').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            activeIntensity = btn.dataset.level;
            if (activeGameMode === 'deep' && activeIntensity !== 'all' && activeIntensity !== '3') {
                activeGameMode = 'classic';
                document.getElementById('gameModeSelect').value = activeGameMode;
                renderModeTimer();
            }
            rebuildUnspentDeck();
            drawNextCard();
        };
    });

    // 11. Prompt Style Filters
    document.querySelectorAll('.prompt-style-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            if (isCompareFirstSessionActive() && window.currentRoomRole !== 'host') {
                setCardActionStatus('Only the host can control the Compare First session.');
                return;
            }
            if (activeGameMode === 'compare-first') exitCompareFirstMode();
            document.querySelectorAll('.prompt-style-btn').forEach(styleBtn => {
                const isActive = styleBtn === btn;
                styleBtn.classList.toggle('active', isActive);
                styleBtn.setAttribute('aria-pressed', String(isActive));
            });
            const selectedStyle = btn.dataset.promptStyle;
            updateQuestionTypeSelection(selectedStyle, true);
            rebuildUnspentDeck();
            drawNextCard();
        };
    });

    // 12. Custom Card Modal Triggers
    const openModalBtn = document.getElementById('openAddCardModal');
    if (openModalBtn) openModalBtn.onclick = (e) => {
        e.stopPropagation();
        if (isCompareFirstSessionActive()) {
            setCardActionStatus('Finish the poll round or continue to regular cards before adding a card.');
            return;
        }
        const customModuleSelect = document.getElementById('customModule');
        if (customModuleSelect) {
            customModuleSelect.value = activeModule === 'life' ? 'life' : 'sexuality';
            updateCustomIntensityLabels(customModuleSelect.value);
        }
        document.querySelector('input[name="publishMode"][value="private"]').checked = true;
        setPublishStatus('');
        toggleModal(true);
    };

    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) closeModalBtn.onclick = (e) => { e.stopPropagation(); toggleModal(false); };

    const customModuleSelect = document.getElementById('customModule');
    if (customModuleSelect) {
        customModuleSelect.onchange = () => updateCustomIntensityLabels(customModuleSelect.value);
        updateCustomIntensityLabels(activeModule);
    }

    const customAnswerFormat = document.getElementById('customAnswerFormat');
    const customOptionsField = document.getElementById('customOptionsField');
    const customPromptStyle = document.getElementById('customPromptStyle');
    if (customAnswerFormat && customOptionsField && customPromptStyle) {
        customAnswerFormat.onchange = () => {
            const isMultipleChoice = customAnswerFormat.value === 'multiple-choice';
            customOptionsField.classList.toggle('hidden', !isMultipleChoice);
            if (isMultipleChoice) customPromptStyle.value = 'question';
            customPromptStyle.disabled = isMultipleChoice;
        };
    }

    // 13. Save Custom Card
    const saveCardBtn = document.getElementById('saveCustomCardBtn');
    if (saveCardBtn) {
        saveCardBtn.onclick = async (e) => {
            e.stopPropagation();
            const mod = document.getElementById('customModule').value;
            const cat = document.getElementById('customCategory').value || 'Custom Questions';
            const intensity = parseInt(document.getElementById('customIntensity').value) || 1;
            const promptText = document.getElementById('customPrompt').value.trim();
            const isMultipleChoice = document.getElementById('customAnswerFormat').value === 'multiple-choice';
            const promptStyle = isMultipleChoice ? 'question' : document.getElementById('customPromptStyle').value;
            const options = isMultipleChoice
                ? document.getElementById('customOptions').value.split('\n').map(option => option.trim()).filter(Boolean)
                : null;
            const publishMode = document.querySelector('input[name="publishMode"]:checked').value;

            if (!promptText) {
                setPublishStatus('Please enter card text.');
                return;
            }
            if (mod === 'secrets') {
                setPublishStatus('Use Wild & Unspoken to save personal entries privately on this device.');
                return;
            }
            if (promptText.length > 280) {
                setPublishStatus('Cards must be 280 characters or fewer.');
                return;
            }
            if (isMultipleChoice && (options.length < 2 || options.length > 6)) {
                setPublishStatus('Enter between 2 and 6 answer choices, one per line.');
                return;
            }
            if (isMultipleChoice && options.some(option => option.length > 120)) {
                setPublishStatus('Each answer choice must be 120 characters or fewer.');
                return;
            }
            if (isMultipleChoice && new Set(options.map(option => option.toLocaleLowerCase())).size !== options.length) {
                setPublishStatus('Answer choices must be unique.');
                return;
            }

            if (publishMode === 'community' && !window.db) {
                setPublishStatus('Global sharing is unavailable. Configure Firebase first, or choose a local or partner-only option.');
                return;
            }
            if (publishMode === 'partner' && (!window.db || !window.roomRef || !window.currentRoomCode)) {
                setPublishStatus('Connect to your partner’s paired room before sharing this card.');
                return;
            }

            saveCardBtn.disabled = true;
            setPublishStatus(publishMode === 'community'
                ? 'Sharing to the Global Deck…'
                : publishMode === 'partner'
                    ? 'Sharing with your partner…'
                    : 'Saving to this device…');
            let authorId = null;
            let cardId = `custom-${Date.now()}`;
            if (publishMode !== 'private') {
                try {
                    const user = window.firebase.auth().currentUser || await window.firebaseAuthReady;
                    if (!user) throw new Error('Firebase sign-in is required to share a card.');
                    authorId = user.uid;
                    const generatedKey = publishMode === 'community'
                        ? window.db.ref('cards').push().key
                        : window.roomRef.child('sharedCards').push().key;
                    if (!generatedKey) throw new Error('Could not generate a card ID.');
                    cardId = `${publishMode}-${generatedKey}`;
                } catch (error) {
                    console.error('Card sharing authentication failed:', error);
                    setPublishStatus(`Could not share the card: ${error.message}`);
                    saveCardBtn.disabled = false;
                    return;
                }
            }
            const newCard = {
                id: cardId,
                module: mod,
                category: cat,
                intensity: intensity,
                prompt: promptText,
                promptStyle,
                contextType: isMultipleChoice ? 'poll' : promptStyle === 'activity' ? 'action' : (mod === 'secrets' ? 'consent' : 'story'),
                ...(isMultipleChoice ? { options } : {}),
                visibility: publishMode === 'community' ? 'community' : publishMode === 'partner' ? 'partner' : 'private',
                ...(authorId ? { createdBy: authorId } : {})
            };

            if (publishMode === 'community') {
                try {
                    await window.db.ref('cards/' + cardId).set(newCard);
                } catch (error) {
                    console.error('Global Deck publishing failed:', error);
                    setPublishStatus(`Could not publish: ${error.message}`);
                    saveCardBtn.disabled = false;
                    return;
                }
            } else if (publishMode === 'partner') {
                try {
                    await window.roomRef.child(`sharedCards/${cardId.slice('partner-'.length)}`).set({
                        senderUid: authorId,
                        card: newCard,
                        createdAt: new Date().toISOString()
                    });
                } catch (error) {
                    console.error('Partner card sharing failed:', error);
                    setPublishStatus(`Could not share this card with your partner: ${error.message}`);
                    saveCardBtn.disabled = false;
                    return;
                }
                customUserCards.push(newCard);
                localStorage.setItem('closer_custom_cards', JSON.stringify(customUserCards));
            } else {
                customUserCards.push(newCard);
                localStorage.setItem('closer_custom_cards', JSON.stringify(customUserCards));
            }

            masterDatabase.push(newCard);
            document.getElementById('customCategory').value = '';
            document.getElementById('customPrompt').value = '';
            document.getElementById('customOptions').value = '';
            document.getElementById('customAnswerFormat').value = 'open';
            document.getElementById('customOptionsField').classList.add('hidden');
            document.getElementById('customPromptStyle').disabled = false;
            document.getElementById('gameModeSelect').value = 'classic';
            activeGameMode = 'classic';
            renderModeTimer();
            toggleModal(false);
            saveCardBtn.disabled = false;
            setPublishStatus('');

            activeModule = mod;
            document.querySelectorAll('.module-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.module === mod);
                t.setAttribute('aria-pressed', String(t.dataset.module === mod));
            });
            activePromptStyle = promptStyle;
            updateQuestionTypeSelection(promptStyle);
            activeIntensity = 'all';
            updateIntensityLabels();
            document.querySelectorAll('.intensity-btn').forEach(btn => {
                const isActive = btn.dataset.level === 'all';
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            });

            rebuildUnspentDeck();
            drawNextCard();
            updateSectionView();
            setCardActionStatus(publishMode === 'community'
                ? 'Your card is now in the Global Deck.'
                : publishMode === 'partner'
                    ? 'Your card was sent to your partner and saved in your deck.'
                    : 'Your card was saved in your deck on this device.');
        };
    }

    // 14. Shuffle All Button
    const shuffleBtn = document.getElementById('shuffleAllBtn');
    if (shuffleBtn) {
        shuffleBtn.onclick = (e) => {
            e.stopPropagation();
            if (isCompareFirstSessionActive()) {
                setCardActionStatus('Finish the poll round or continue to regular cards before shuffling.');
                return;
            }
            rebuildUnspentDeck();
            drawNextCard();
        };
    }

    const privateShareKeyInput = document.getElementById('privateShareKey');
    if (privateShareKeyInput && privateShareKey) privateShareKeyInput.value = privateShareKey;

    const generateShareKeyBtn = document.getElementById('generatePrivateShareKey');
    if (generateShareKeyBtn) {
        generateShareKeyBtn.onclick = async () => {
            if (!window.crypto?.getRandomValues) {
                setPrivateShareStatus('Secure random key generation is not available in this browser.');
                return;
            }
            const key = encodeBase64Url(window.crypto.getRandomValues(new Uint8Array(32)));
            privateShareKeyInput.value = key;
            await applyPrivateShareKey(key);
        };
    }

    const useShareKeyBtn = document.getElementById('usePrivateShareKey');
    if (useShareKeyBtn) {
        useShareKeyBtn.onclick = () => applyPrivateShareKey(privateShareKeyInput.value);
    }

    const copyShareKeyBtn = document.getElementById('copyPrivateShareKey');
    if (copyShareKeyBtn) {
        copyShareKeyBtn.onclick = async () => {
            if (!privateShareKey) return;
            try {
                await navigator.clipboard.writeText(privateShareKey);
                setPrivateShareStatus('Sharing key copied. Send it through a trusted channel separate from the room code.');
            } catch (error) {
                console.error('Could not copy the sharing key:', error);
                setPrivateShareStatus('Could not access the clipboard. Reveal the key field and copy it manually.');
            }
        };
    }

    const toggleShareKeyBtn = document.getElementById('togglePrivateShareKey');
    if (toggleShareKeyBtn) {
        toggleShareKeyBtn.onclick = () => {
            const isVisible = privateShareKeyInput.type === 'text';
            privateShareKeyInput.type = isVisible ? 'password' : 'text';
            toggleShareKeyBtn.textContent = isVisible ? 'Show key' : 'Hide key';
            toggleShareKeyBtn.setAttribute('aria-pressed', String(!isVisible));
        };
    }

    const privateRevealForm = document.getElementById('privateRevealForm');
    if (privateRevealForm) {
        privateRevealForm.onsubmit = event => {
            event.preventDefault();
            const textInput = document.getElementById('privateRevealText');
            const text = textInput.value.trim();
            if (!text) {
                document.getElementById('privateRevealStatus').textContent = 'Write an entry before saving.';
                return;
            }
            privateRevealEntries.unshift({
                id: `reveal-${Date.now()}`,
                type: document.getElementById('privateRevealType').value,
                text,
                createdAt: new Date().toISOString()
            });
            localStorage.setItem('closer_private_reveals', JSON.stringify(privateRevealEntries));
            textInput.value = '';
            document.getElementById('privateRevealStatus').textContent = 'Saved privately on this device. Reveal it whenever you are ready.';
            renderWildRevealEntries();
        };
    }

    updateSectionView();
    updatePrivateShareUi();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    initDatabase();
});