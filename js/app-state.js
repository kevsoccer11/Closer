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
        name: localStorage.getItem(`${PLAYER_ONE_NAME_KEY}_name`) || 'Player 1',
        icon: localStorage.getItem(`${PLAYER_ONE_NAME_KEY}_icon`) || '❤️'
    },
    partner: {
        name: localStorage.getItem(`${PLAYER_TWO_NAME_KEY}_name`) || 'Player 2',
        icon: localStorage.getItem(`${PLAYER_TWO_NAME_KEY}_icon`) || '⭐'
    }
};
let roomDisplayNames = {};
let playerNamesListener = null;
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
let localAnswerRoundId = null;
let localAnswerIndices = [null, null];
let localAnswerPhase = 'choose';
let explicitCardsLoaded = false;
let partnerConnected = false;
let roundTotalCards = 0;
let lastSyncedAt = null;
let roundStats = { played: 0, passed: 0 };
let passedCardIds = [];
let undoState = null;
let playedCardIds = new Set(JSON.parse(localStorage.getItem('closer_played_cards') || '[]'));
let favoritesOnly = false;
let activeMood = 'all';
let activeQuestionCount = null;
let tapToAdvance = localStorage.getItem('closer_tap_to_advance') === 'true';
let activePillar = 'all';
let browseMode = false;
let progressiveMode = false;
let progressivePhase = null; // 'nonexplicit' | 'explicit'
let customDecks = JSON.parse(localStorage.getItem('closer_custom_decks') || '[]');
let activeDeckId = localStorage.getItem('closer_active_deck') || null;
let roundConfiguredByUser = false;

