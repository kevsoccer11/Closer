const storageRecoveryWarnings = [];
let modalPageScrollState = null;

function setModalOpen(modal, isOpen) {
    if (!modal) return;
    if (isOpen) {
        if (!modalPageScrollState) {
            const body = document.body;
            const root = document.documentElement;
            const scrollY = window.scrollY || window.pageYOffset || 0;
            modalPageScrollState = {
                scrollY,
                bodyStyles: {
                    position: body.style.position,
                    top: body.style.top,
                    left: body.style.left,
                    right: body.style.right,
                    width: body.style.width,
                    overflow: body.style.overflow
                },
                rootOverflow: root.style.overflow
            };
            body.style.position = 'fixed';
            body.style.top = `-${scrollY}px`;
            body.style.left = '0';
            body.style.right = '0';
            body.style.width = '100%';
            body.style.overflow = 'hidden';
            root.style.overflow = 'hidden';
        }
        modal.classList.remove('hidden');
        return;
    }

    modal.classList.add('hidden');
    if (document.querySelector('.modal-overlay:not(.hidden)') || !modalPageScrollState) return;

    const body = document.body;
    const root = document.documentElement;
    const { scrollY, bodyStyles, rootOverflow } = modalPageScrollState;
    body.style.position = bodyStyles.position;
    body.style.top = bodyStyles.top;
    body.style.left = bodyStyles.left;
    body.style.right = bodyStyles.right;
    body.style.width = bodyStyles.width;
    body.style.overflow = bodyStyles.overflow;
    root.style.overflow = rootOverflow;
    modalPageScrollState = null;
    window.scrollTo(0, scrollY);
}

function recordStorageRecoveryWarning(warning) {
    storageRecoveryWarnings.push(warning);
    try {
        if (typeof document === 'undefined') return;
        const status = document.getElementById('appStatus');
        const notice = getStorageRecoveryNotice();
        if (status && notice && !status.textContent.includes(notice)) {
            status.textContent = [status.textContent, notice].filter(Boolean).join(' ');
        }
    } catch (error) {
        console.error('Could not display the saved-data recovery notice:', error);
    }
}

function getStorageArea(area = 'local') {
    try {
        const storage = area === 'session' ? window.sessionStorage : window.localStorage;
        if (storage) return storage;
        return area === 'session' ? sessionStorage : localStorage;
    } catch (error) {
        recordStorageRecoveryWarning({ key: area, backupSaved: false, reason: 'storage unavailable' });
        console.error(`Could not access ${area} storage:`, error);
        return null;
    }
}

function readStoredValue(key, fallback = null, area = 'local') {
    const storage = getStorageArea(area);
    if (!storage) return fallback;
    try {
        return storage.getItem(key) ?? fallback;
    } catch (error) {
        recordStorageRecoveryWarning({ key, backupSaved: false, reason: 'storage unavailable' });
        console.error(`Could not read saved setting "${key}":`, error);
        return fallback;
    }
}

function readStoredJSON(key, fallback, isValid = () => true) {
    const storage = getStorageArea();
    if (!storage) return fallback;
    let raw;
    try {
        raw = storage.getItem(key);
    } catch (error) {
        recordStorageRecoveryWarning({ key, backupSaved: false, reason: 'storage unavailable' });
        console.error(`Could not read saved data "${key}":`, error);
        return fallback;
    }
    if (raw === null) return fallback;
    try {
        const value = JSON.parse(raw);
        if (!isValid(value)) throw new TypeError('Saved data has an unexpected shape.');
        return value;
    } catch (error) {
        const backupKey = `closer_recovery_backup_${key}`;
        let backupSaved = false;
        try {
            if (!storage.getItem(backupKey)) storage.setItem(backupKey, raw);
            backupSaved = true;
        } catch (backupError) {
            console.error(`Could not preserve a recovery copy for "${key}":`, backupError);
        }
        recordStorageRecoveryWarning({ key, backupSaved, reason: 'invalid saved data' });
        console.error(`Saved data "${key}" could not be loaded; ${backupSaved ? `a copy was saved as "${backupKey}"` : 'a recovery copy could not be saved'}.`, error);
        return fallback;
    }
}

function getStorageRecoveryNotice() {
    if (storageRecoveryWarnings.length === 0) return '';
    const keys = [...new Set(storageRecoveryWarnings.map(item => item.key))].join(', ');
    const backupStatus = storageRecoveryWarnings.some(item => item.reason === 'invalid saved data' && !item.backupSaved)
        ? ' Some data could not be backed up.'
        : storageRecoveryWarnings.some(item => item.backupSaved)
            ? ' Recovery copies were kept in this browser.'
            : '';
    return `Some saved data could not be read safely (${keys}).${backupStatus} It has not been deleted.`;
}

function isObjectArray(value) {
    return Array.isArray(value) && value.every(item => item && typeof item === 'object' && !Array.isArray(item));
}

let masterDatabase = [];
let customUserCards = readStoredJSON('closer_custom_cards', [], isObjectArray);
let partnerCards = readStoredJSON('closer_partner_cards', [], isObjectArray);
let journalEntries = readStoredJSON('closer_journal', [], isObjectArray);
let privateRevealEntries = readStoredJSON('closer_private_reveals', [], isObjectArray);
let privateShareKey = readStoredValue('closer_private_share_key', '', 'session');
let favoriteIds = readStoredJSON('closer_favs', [], value => Array.isArray(value) && value.every(id => typeof id === 'string'));

let unspentDeck = [];
let currentCard = null;
let activeModule = 'sexuality';
let activeIntensity = 'all';
let activePromptStyle = 'all';
let activeGameMode = 'classic';
let activeModules = ['spark'];
let activePillars = ['spark'];
let activeTopics = null;
let includeQuestions = true;
let includeActivities = true;
let includeMultipleChoice = true;
let warmUpEnabled = false;
const EXPLICIT_AGE_CONFIRMATION_KEY = 'closer_explicit_age_confirmed';
const PLAYER_ONE_NAME_KEY = 'closer_player_one';
const PLAYER_TWO_NAME_KEY = 'closer_player_two';
const PLAYER_ICONS = ['❤️', '⭐', '🌙', '☀️', '🔥', '🌿', '🪐', '🦊', '🐻', '🦋'];
let playerNames = {
    host: {
        name: readStoredValue(`${PLAYER_ONE_NAME_KEY}_name`) || 'Player 1',
        icon: readStoredValue(`${PLAYER_ONE_NAME_KEY}_icon`) || '❤️'
    },
    partner: {
        name: readStoredValue(`${PLAYER_TWO_NAME_KEY}_name`) || 'Player 2',
        icon: readStoredValue(`${PLAYER_TWO_NAME_KEY}_icon`) || '⭐'
    }
};
let roomDisplayNames = {};
let roomPresence = {};
let guessMeRequestListener = null;
let sharedDeckRound = null;
let presenceState = {};
let playerNamesListener = null;
let explicitConsentListener = null;
let switchRequestListener = null;
let roomExplicitConsent = {};
let pendingExplicitRoomConsent = false;
let compareFirstModules = ['sexuality'];
let compareFirstLevels = ['1', '2', '3'];
let compareFirstRoundId = null;
let compareFirstRoundIndex = 0;
let compareFirstRoundTotal = 0;
let compareFirstRestoreState = null;
let turnTakingEnabled = true;
let activeTurn = 0;
let pickedAnswerer = null;
let pickedAnswererIndex = null;
let usingStarterDeck = false;
let modeTimer = null;
let modeTimerRemaining = 0;
let cardLoadError = false;
let sharedRevealListener = null;
let sharedCardListener = null;
let activeCardSyncListener = null;
let partnerSeatListener = null;
let gameModeListener = null;
let currentRoomGameMode = null;
let currentRoomGameModeLoaded = false;
let joinRequestListener = null;
let roomJoinRequestsListener = null;
let pendingJoinRequests = {};
let receivedSharedReveals = [];
let seenSharedRevealIds = new Set();
let processingSharedRevealIds = new Set();
let shareClientId = readStoredValue('closer_share_client_id', '', 'session');
let deckOptionsElement = null;
let partnerCardsSectionElement = null;
let partnerCardsListElement = null;
let processingPartnerCardKeys = new Set();
let pairManagementContainer = null;
let pendingJoinRequestRef = null;
let cardAnswerListeners = [];
let cardAnswerSeatListener = null;
let cardAnswerRetryTimer = null;
let cardAnswerSetupKey = null;
let cardAnswerRoomRef = null;
let cardAnswerCard = null;
let cardAnswerOwnUid = null;
let cardAnswerPartnerUid = null;
let cardAnswerOwn = null;
let cardAnswerPartner = null;
let localAnswerRoundId = null;
let localAnswerIndices = [null, null];
let localAnswerPhase = 'choose';
let explicitCardsLoaded = false;
let partnerConnected = false;
let roundTotalCards = 0;
let lastSyncedAt = null;
let roundStats = { played: 0, passed: 0 };
let passedCardIds = [];
let undoStack = [];
let playedCardIds = new Set(readStoredJSON('closer_played_cards', [], value => Array.isArray(value) && value.every(id => typeof id === 'string')));
let favoritesOnly = false;
let activeMood = 'all';
let activeQuestionCount = null;
let tapToAdvance = readStoredValue('closer_tap_to_advance') === 'true';
let activePillar = 'all';
let browseMode = false;
let progressiveMode = false;
let progressivePhase = null; // 'nonexplicit' | 'explicit'
let customDecks = readStoredJSON('closer_custom_decks', [], value => Array.isArray(value)
    && value.every(deck => deck && typeof deck.id === 'string' && typeof deck.name === 'string'
        && Array.isArray(deck.cardIds) && deck.cardIds.every(id => typeof id === 'string')));
let activeDeckId = readStoredValue('closer_active_deck');
let gameHistory = readStoredJSON('closer_game_history', [], isObjectArray);
let onboardingDone = readStoredValue('closer_onboarding_done') === 'true';
