const fs = require('fs');
const { execSync } = require('child_process');
const vm = require('vm');

let failures = 0;
const pendingChecks = [];
function check(label, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            pendingChecks.push(result.then(
                () => console.log('PASS:', label),
                error => { failures++; console.error('FAIL:', label, '-', error.message); }
            ));
        } else {
            console.log('PASS:', label);
        }
    }
    catch (e) { failures++; console.error('FAIL:', label, '-', e.message); }
}

const html = fs.readFileSync('index.html', 'utf8');
const requiredTokens = [
    'id="cardPrompt"',
    'id="progressIndicator"',
    'class="desktop-sidebar"',
    'id="qodQuestion"',
    'id="exploreAllBtn"',
    'id="homeNavBtn"',
    'id="exploreView"',
    'id="exploreYouGetMeBtn"',
    'id="appNavSettings"',
    'id="guessMeSetupModal"',
    'id="guessMeView"'
];
requiredTokens.forEach(tok => check(`index.html contains ${tok}`, () => {
    if (!html.includes(tok)) throw new Error('missing');
}));

check('remove unfinished You Get Me placeholder', () => {
    if (html.includes('Gameplay (answer / predict / reveal) arrives in the next stage.')) {
        throw new Error('unfinished gameplay placeholder remains');
    }
});

check('home features six curated packs with an Explore link', () => {
    const section = html.match(/<section class="featured-experiences" id="featuredExperiences">([\s\S]*?)<\/section>/);
    if (!section) throw new Error('featured pack section is missing');
    const packs = section[1].match(/class="experience-card pack-card"/g) || [];
    if (packs.length !== 6) throw new Error(`expected 6 featured packs, found ${packs.length}`);
    if (!section[1].includes('<h2>Find your moment</h2>')) throw new Error('section heading is missing');
    if (!section[1].includes('id="seeMoreExperiencesBtn"') || !section[1].includes('onclick="showExploreView()"')) {
        throw new Error('See more button is missing');
    }
});

check('home resume card has one concise prompt', () => {
    const section = html.match(/<section class="continue-card hidden" id="continueCard"[\s\S]*?<\/section>/);
    if (!section || section[0].includes('Pick up where you left off')
        || !section[0].includes('Continue your conversation')) {
        throw new Error('resume card repeats its prompt');
    }
});

check('mood section is grouped and its See all action opens Explore', () => {
    const home = html.match(/<section class="categories-section" id="homeMoodSection">([\s\S]*?)<\/section>/);
    const app = fs.readFileSync('js/app.js', 'utf8');
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!home || !home[1].includes('id="exploreAllBtn"')
        || !home[1].includes('onclick="window.showExploreView()"')
        || !styles.includes('#homeMoodSection {\n    padding: 14px;')) {
        throw new Error('home moods are not grouped or See all is not wired to Explore');
    }
    if (!app.includes("moodClone.querySelector('.categories-header .text-link')?.remove();")) {
        throw new Error('Explore shows a redundant See all button that cannot navigate further');
    }
});

check('Explore links to You Get Me', () => {
    const explore = html.match(/<section class="continue-card explore-you-get-me"[\s\S]*?<\/section>/);
    if (!explore || !explore[0].includes('id="exploreYouGetMeBtn"')
        || !explore[0].includes('onclick="window.openGuessMeSetup()"')) {
        throw new Error('You Get Me Explore action is not wired');
    }
});

check('bottom navigation uses Settings instead of a second Profile icon', () => {
    const nav = html.match(/<nav class="app-bottom-nav"[\s\S]*?<\/nav>/);
    if (!nav || !nav[0].includes('data-view="settings"') || !nav[0].includes('data-lucide="settings"')) {
        throw new Error('Settings gear is missing from bottom navigation');
    }
    if (nav[0].includes('>Profile</span>')) throw new Error('duplicate Profile navigation item remains');
    if (!fs.readFileSync('js/app.js', 'utf8').includes("getElementById('appNavSettings')?.addEventListener('click', () => {\n        document.getElementById('toolsDrawerBtn')?.click();")) {
        throw new Error('Settings navigation is not wired to the settings drawer');
    }
});

check('drawer locks background and allows its content to scroll', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const app = fs.readFileSync('js/app.js', 'utf8');
    if (!logic.includes("body.classList.add('drawer-open')") || !logic.includes('window.scrollTo(0, scrollY)')) {
        throw new Error('drawer background scroll lock/restore is missing');
    }
    if (!styles.includes('.drawer-content {\n    min-height: 0;')) {
        throw new Error('drawer content scroll area is missing min-height constraint');
    }
    if (!app.includes("if (drawer && !drawer.classList.contains('hidden')) {\n                closeDrawer();")) {
        throw new Error('Escape key does not release the drawer scroll lock');
    }
});

check('round builder gives the active tab its own bounded scroll area', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const activeTabRule = styles.match(/\.round-tab-panel:not\(\.hidden\) \{([^}]*)\}/);
    const curatedTabRule = styles.match(/#curatedTab:not\(\.hidden\) \{([^}]*)\}/);
    const customTabRule = styles.match(/#customTab:not\(\.hidden\) \{([^}]*)\}/);
    const builderContentRule = styles.match(/\.round-builder-content \{([^}]*)\}/);
    const builderFooterRule = styles.match(/\.round-builder-footer \{([^}]*)\}/);
    const builderCardRule = styles.match(/\.round-builder-card \{([^}]*)\}/);
    if (!activeTabRule || !activeTabRule[1].includes('flex: 1 1 0;')
        || !activeTabRule[1].includes('min-height: 0;')) {
        throw new Error('active round-builder tab does not have a bounded scroll area');
    }
    if (!curatedTabRule || !curatedTabRule[1].includes('overflow-y: auto;')
        || !curatedTabRule[1].includes('-webkit-overflow-scrolling: touch;')) {
        throw new Error('curated packs do not have an independent scroll area');
    }
    if (!customTabRule || !customTabRule[1].includes('display: flex;')
        || !customTabRule[1].includes('flex-direction: column;')
        || !customTabRule[1].includes('overflow: hidden;')
        || !builderContentRule || !builderContentRule[1].includes('overflow-y: auto;')
        || !builderContentRule[1].includes('-webkit-overflow-scrolling: touch;')
        || !builderFooterRule || !builderFooterRule[1].includes('flex: 0 0 auto;')) {
        throw new Error('custom-deck filters do not scroll separately from their action footer');
    }
    if (!builderCardRule || !builderCardRule[1].includes('overflow: hidden;')
        || styles.includes('.round-builder-card .round-builder-content {\n    overflow-y: auto;')) {
        throw new Error('round builder still has nested scroll containers');
    }
    const modalRule = styles.match(/\.modal-overlay \{([^}]*)\}/);
    const navigationRule = styles.match(/\.app-bottom-nav \{([^}]*)\}/);
    const modalZ = modalRule?.[1].match(/z-index:\s*(\d+)/)?.[1];
    const navigationZ = navigationRule?.[1].match(/z-index:\s*(\d+)/)?.[1];
    if (!modalZ || !navigationZ || Number(modalZ) <= Number(navigationZ)) {
        throw new Error('modal is not layered above the fixed bottom navigation');
    }
});

check('card browser includes searchable deck, intensity, type, and category filters', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const browser = logic.match(/function renderCardBrowserDrawerContent\(content\) \{([\s\S]*?)\n\}/);
    if (!browser
        || !browser[1].includes('cardBrowserModuleFilter')
        || !browser[1].includes('cardBrowserIntensityFilter')
        || !browser[1].includes('cardBrowserTypeFilter')
        || !browser[1].includes('cardBrowserCategoryFilter')
        || !browser[1].includes('matchesModule && matchesIntensity && matchesType && matchesCategory')
        || !browser[1].includes('clearFiltersButton.addEventListener')
        || !styles.includes('.card-browser-filters {')
        || !styles.includes('.card-browser-filter select {')) {
        throw new Error('card browser search does not expose and apply its filters');
    }
});

check('game controls include pause, edit, and end actions', () => {
    const response = html.match(/<div class="response-section hidden">([\s\S]*?)<\/div>\s*<div class="modal-overlay hidden" id="guessMeSetupModal">/);
    const app = fs.readFileSync('js/app.js', 'utf8');
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    if (!response || !response[1].includes('id="pauseGameBtn"')
        || !response[1].includes('id="editRoundBtn"')
        || !response[1].includes('id="quitGameBtn"')
        || !response[1].includes('aria-label="End conversation"')
        || !app.includes("getElementById('pauseGameBtn')?.addEventListener('click', pauseConversation)")
        || !app.includes('openRoundBuilder(true)')
        || !logic.includes('function pauseConversation()')
        || !logic.includes('Conversation paused. Your place is saved.')) {
        throw new Error('in-game pause, edit, or end control is missing or not wired');
    }
    if (!logic.includes("isEditing ? 'Apply & restart round' : 'Start conversation'")
        || !logic.includes('Your current progress will be reset.')) {
        throw new Error('editing a round does not explain that it will restart');
    }
});

check('card prompt and game controls use compact mobile sizing', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const prompt = styles.match(/\.card-prompt \{([^}]*)\}/);
    const compactLayout = styles.match(/@media \(max-width: 480px\) \{\s*body:not\(\.landing\) main:not\(\.hidden\) \{([\s\S]*?)\n\}/);
    if (!prompt?.[1].includes('clamp(1.15rem, 3.8vw, 1.5rem)')
        || !compactLayout?.[1].includes('.card-face')
        || !compactLayout[1].includes('min-height: 0;')
        || !compactLayout[1].includes('font-size: clamp(0.95rem, 3.8vw, 1.1rem)')
        || !compactLayout[1].includes('flex-shrink: 0;')
        || !styles.includes('width: min(100%, 560px);')
        || !styles.includes('.card-play-actions,\n.game-management-actions {')) {
        throw new Error('card text or mobile game controls remain oversized');
    }
});

check('starting a round resets the game view scroll position', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const gameView = logic.match(/function showGameView\(\) \{([^}]*)\}/);
    const roundSelection = logic.match(/function applyRoundSelection\(selection, startLight = false, questionCount = null\) \{([\s\S]*?)\n\}/);
    if (!gameView || !gameView[1].includes("if (!document.querySelector('.modal-overlay:not(.hidden)')) window.scrollTo(0, 0);")) {
        throw new Error('entering the game does not reset scroll when no modal is open');
    }
    if (!roundSelection || roundSelection[1].indexOf('closeRoundBuilder();') > roundSelection[1].indexOf('showGameView();')) {
        throw new Error('round builder restores the previous page scroll after starting the game');
    }
});

check('home resume card does not show a remaining-card count', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const homeView = logic.match(/function showHomeView\(\) \{([\s\S]*?)\n\}/);
    if (!homeView || homeView[1].includes('cards remaining') || homeView[1].includes('savedDeck.length')) {
        throw new Error('home resume card still displays the remaining-card count');
    }
});

check('landing and Explore typography use a restrained scale', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const hero = styles.match(/#homeView \.app-hero-content h2 \{([^}]*)\}/);
    const explore = styles.match(/\.screen-heading h2 \{([^}]*)\}/);
    const packTitle = styles.match(/\.experience-content h3 \{([^}]*)\}/);
    const packDescription = styles.match(/\.experience-content p \{([^}]*)\}/);
    if (!styles.match(/body \{[^}]*font-size: 15px;/)
        || !hero?.[1].includes('clamp(1.65rem, 6.5vw, 2.1rem)')
        || !explore?.[1].includes('font-size: 1.375rem;')
        || !packTitle?.[1].includes('font-size: 0.88rem;')
        || !packDescription?.[1].includes('font-size: 0.75rem;')) {
        throw new Error('landing typography has not been reduced to the intended scale');
    }
});

check('history clearing requires confirmation before deleting data', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const app = fs.readFileSync('js/app.js', 'utf8');
    const gameHistory = logic.match(/clearBtn\.onclick = \(\) => \{([\s\S]*?)\n    \};/);
    const playHistory = app.match(/getElementById\('resetPlayHistoryBtn'\)\?\.addEventListener\('click', \(\) => \{([\s\S]*?)\n    \}\);/);
    if (!gameHistory || !gameHistory[1].includes("if (!confirm('Clear all game history saved on this device? This cannot be undone.')) return;")
        || gameHistory[1].indexOf('confirm(') > gameHistory[1].indexOf('gameHistory = []')) {
        throw new Error('game-history deletion is not guarded by confirmation');
    }
    if (!playHistory || !playHistory[1].includes("if (!confirm('Reset played-card history on this device and in your shared room? This cannot be undone.')) return;")
        || playHistory[1].indexOf('confirm(') > playHistory[1].indexOf('playedCardIds.clear()')) {
        throw new Error('played-card history reset is not guarded by confirmation');
    }
});

check('home shortcuts have dark-mode card styling', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!styles.includes('body:not(.light-theme) .home-shortcut {')
        || !styles.includes('background: linear-gradient(140deg, var(--card-bg), var(--primary-soft));')) {
        throw new Error('home shortcuts do not adapt to dark mode');
    }
});

check('header logos use the same larger dimensions in both themes', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const sharedLogoRule = styles.match(/\.brand-logo \{([^}]*)\}/);
    if (!sharedLogoRule || !sharedLogoRule[1].includes('height: 3.5rem;')
        || !sharedLogoRule[1].includes('width: 9rem;')
        || !sharedLogoRule[1].includes('object-fit: contain;')) {
        throw new Error('shared header logo sizing is missing');
    }
    if (styles.includes('body.light-theme .brand-logo')
        || styles.includes('body.light-theme .app-title')) {
        throw new Error('a theme-specific header logo size overrides the shared dimensions');
    }
    if (!html.includes('img/Closer%20Everyday%20Heart%20Logo.png')
        || !html.includes('img/Closer%20Heart%20Connect%20Logo%20Dark.png')) {
        throw new Error('the paired light and dark logo assets are not both in use');
    }
});

check('Explore controls and cards have dark-mode styling', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!styles.includes('body:not(.light-theme) .explore-search,')
        || !styles.includes('body:not(.light-theme) .explore-mood-filters .filter-chip:not(.active) {')
        || !styles.includes('body:not(.light-theme) #exploreContent .category-card,')
        || !styles.includes('body:not(.light-theme) #exploreContent .experience-card {')
        || !styles.includes('body:not(.light-theme) .app-bottom-nav {')) {
        throw new Error('Explore controls or cards do not adapt to dark mode');
    }
});

['js/app.js', 'js/app-logic.js', 'js/app-state.js'].forEach(f => check(`syntax ${f}`, () => {
    execSync(`node --check ${f}`, { stdio: 'pipe' });
}));

check('validate YGM-question-bank.json', () => {
    const d = JSON.parse(fs.readFileSync('YGM-question-bank.json', 'utf8'));
    if (d.count !== 135) throw new Error('count mismatch');
    if (!Array.isArray(d.questions) || d.questions.length !== 135) throw new Error('questions length');
    const ids = d.questions.map(q => q.id);
    if (new Set(ids).size !== ids.length) throw new Error('duplicate ids');
    if (d.questions.some(q => !Array.isArray(q.options) || q.options.length !== 4)) throw new Error('options count');
});

check('You Get Me selection filters by vibe and avoids duplicates', () => {
    const bank = JSON.parse(fs.readFileSync('YGM-question-bank.json', 'utf8')).questions;
    const categories = {
        mixed: null,
        playful: ['silly_ridiculous', 'everyday_personality', 'couple_fun', 'preferences_unexpected'],
        romantic: ['everyday_personality', 'couple_fun', 'preferences_unexpected', 'sweet_flirty'],
        deep: ['everyday_personality', 'couple_fun', 'sweet_flirty']
    };
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const context = vm.createContext({
        window: {},
        localStorage: storage,
        sessionStorage: storage,
        document: {},
        console
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('js/app-logic.js', 'utf8'), context);
    context.window.ygmQuestionBank = bank;

    Object.entries(categories).forEach(([vibe, allowedCategories]) => {
        const selected = Array.from(context.window.pickGuessMeQuestions(30, vibe));
        if (selected.length !== 30) throw new Error(`${vibe} should return 30 questions`);
        if (new Set(selected).size !== selected.length) throw new Error(`${vibe} returned duplicate questions`);
        if (selected.some(id => {
            const question = bank.find(item => item.id === id);
            return !question || (allowedCategories && !allowedCategories.includes(question.category));
        })) throw new Error(`${vibe} returned a question outside its category`);
    });
    if (context.window.pickGuessMeQuestions(10, 'deep').length !== 10) throw new Error('deep selection count mismatch');
    if (context.window.pickGuessMeQuestions(0, 'mixed').length !== 0) throw new Error('zero-length selection should be empty');
});

check('community moderation code is removed', () => {
    const activeCode = ['js/app.js', 'js/app-logic.js', 'js/app-state.js', 'database.rules.json']
        .map(file => fs.readFileSync(file, 'utf8'))
        .join('\n');
    if (/cardVotes|cardReports|voteOnCard|reportCard/.test(activeCode)) {
        throw new Error('moderation state or handlers remain active');
    }
});

check('You Get Me rules enforce room roles and question-id bounds', () => {
    const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')).rules.rooms.$roomCode.guessMe;
    if (rules.questionIds['.validate'].includes('numChildren()')
        || !rules.questionIds['.validate'].includes("!newData.child('30').exists()")
        || !rules.questionIds.$questionIndex['.validate'].includes('[12][0-9]')) {
        throw new Error('question IDs are not validated with supported list bounds');
    }
    if (rules.hostReady['.write'].includes("members/partner")
        || !rules.partnerReady['.write'].includes('newData.val() === false')) {
        throw new Error('ready state writes are not constrained to the owning player');
    }
});

check('Shared Deck rules allow members to read the collection and owners to manage their cards', () => {
    const sharedDeck = JSON.parse(fs.readFileSync('database.rules.json', 'utf8'))
        .rules.rooms.$roomCode.sharedDeck;
    const memberCheck = "auth.uid === root.child('rooms').child($roomCode).child('members/host').val()";
    if (!sharedDeck['.read'] || !sharedDeck['.read'].includes(memberCheck)
        || !sharedDeck['.read'].includes("members/partner")) {
        throw new Error('member read access is not granted at sharedDeck collection path');
    }
    if (!sharedDeck.$cardId['.write'].includes("auth.uid === newData.child('addedBy').val()")
        || !sharedDeck.$cardId['.write'].includes("auth.uid === data.child('addedBy').val()")) {
        throw new Error('shared card writes/deletes are not restricted to their owner');
    }
});

check('partner card receiver accepts supported Level 4 cards', async () => {
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
    const context = vm.createContext({
        window: {
            firebase: { auth: () => ({ currentUser: { uid: 'partner-uid' } }) },
            firebaseAuthReady: Promise.resolve({ uid: 'partner-uid' })
        },
        localStorage: storage,
        sessionStorage: storage,
        document: {},
        console: { error() {}, warn() {}, log() {} }
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('js/app-logic.js', 'utf8'), context);
    context.renderPartnerCards = () => {};
    let removed = false;
    const snapshot = {
        key: 'shared-level-four',
        val: () => ({
            senderUid: 'host-uid',
            createdAt: new Date().toISOString(),
            card: {
                module: 'life', category: 'Deep Connection', intensity: 4,
                prompt: 'What is something meaningful you want us to explore?',
                promptStyle: 'question', contextType: 'story'
            }
        })
    };
    await context.receivePartnerCard(snapshot, {
        child: () => ({ remove: async () => { removed = true; } })
    });
    const savedCards = vm.runInContext('partnerCards', context);
    if (savedCards.length !== 1 || savedCards[0].intensity !== 4) {
        throw new Error('Level 4 partner card was not saved');
    }
    if (!removed) throw new Error('received partner card was not removed from the room');
});

check('malformed saved arrays are backed up and reported without replacing the original', () => {
    const values = new Map([['closer_custom_cards', '{broken-json']]);
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
    const context = vm.createContext({
        window: { localStorage: storage, sessionStorage: storage },
        localStorage: storage,
        sessionStorage: storage,
        console: { error() {}, warn() {}, log() {} }
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), context);
    if (values.get('closer_custom_cards') !== '{broken-json') {
        throw new Error('malformed source data was overwritten');
    }
    if (values.get('closer_recovery_backup_closer_custom_cards') !== '{broken-json') {
        throw new Error('malformed source data was not copied for recovery');
    }
    if (vm.runInContext('customUserCards.length', context) !== 0
        || !context.getStorageRecoveryNotice().includes('Recovery copies were kept')) {
        throw new Error('safe fallback or recovery notice was not provided');
    }
});

check('blocked browser storage does not abort application state initialization', () => {
    const unavailableStorage = {
        getItem() { throw new Error('Storage access denied'); },
        setItem() { throw new Error('Storage access denied'); },
        removeItem() { throw new Error('Storage access denied'); }
    };
    const context = vm.createContext({
        window: { localStorage: unavailableStorage, sessionStorage: unavailableStorage },
        localStorage: unavailableStorage,
        sessionStorage: unavailableStorage,
        console: { error() {}, warn() {}, log() {} }
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), context);
    if (vm.runInContext('customUserCards.length', context) !== 0
        || !context.getStorageRecoveryNotice().includes('could not be read safely')) {
        throw new Error('storage unavailability was not handled safely');
    }
});

check('modal scroll lock contains page scrolling and restores the previous position', () => {
    const body = { style: { position: 'relative', top: '', left: '', right: '', width: '', overflow: 'auto' } };
    const root = { style: { overflow: 'auto' } };
    const makeModal = () => {
        const modal = { hidden: true };
        modal.classList = {
            remove() { modal.hidden = false; },
            add() { modal.hidden = true; }
        };
        return modal;
    };
    const firstModal = makeModal();
    const secondModal = makeModal();
    let restoredScrollY = null;
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const context = vm.createContext({
        window: {
            localStorage: storage,
            sessionStorage: storage,
            scrollY: 240,
            pageYOffset: 240,
            scrollTo: (_x, y) => { restoredScrollY = y; }
        },
        localStorage: storage,
        sessionStorage: storage,
        document: {
            body,
            documentElement: root,
            querySelector: () => [firstModal, secondModal].find(modal => !modal.hidden) || null
        },
        console: { error() {}, warn() {}, log() {} }
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), context);
    context.setModalOpen(firstModal, true);
    if (body.style.position !== 'fixed' || body.style.top !== '-240px'
        || body.style.overflow !== 'hidden' || root.style.overflow !== 'hidden') {
        throw new Error('opening a modal did not lock the page at its current position');
    }
    context.setModalOpen(secondModal, true);
    context.setModalOpen(firstModal, false);
    if (body.style.position !== 'fixed') throw new Error('closing one modal unlocked the page under another modal');
    context.setModalOpen(secondModal, false);
    if (body.style.position !== 'relative' || body.style.overflow !== 'auto'
        || root.style.overflow !== 'auto' || restoredScrollY !== 240) {
        throw new Error('closing the last modal did not restore the page styles and scroll position');
    }
});

check('community cards load in bounded background pages after the app is ready', async () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const initializer = logic.slice(logic.indexOf('async function initDatabase()'), logic.indexOf('async function loadCommunityCards()'));
    if (initializer.includes("ref('cards')") || !logic.includes('limitToFirst(COMMUNITY_CARD_PAGE_SIZE + 1 +')) {
        throw new Error('community cards still load on startup or without a page bound');
    }
    if (!initializer.includes('scheduleCommunityDeckLoad();')
        || !logic.includes('window.requestAnimationFrame(() => window.requestAnimationFrame(startLoading))')
        || !logic.includes('async function loadCommunityDeck()')) {
        throw new Error('the Global Deck is not scheduled to load after the initial screen');
    }
    if (!html.includes('id="communityCardsStatus"')
        || !html.includes('class="btn-secondary hidden" id="loadCommunityCardsBtn"')
        || !html.includes('Global Deck cards load automatically in the background')) {
        throw new Error('Global Deck automatic status or failure-only retry control is missing');
    }
    const records = Array.from({ length: 250 }, (_, index) => {
        const key = `card-${String(index).padStart(3, '0')}`;
        return [key, { id: key, prompt: `Prompt ${index}`, visibility: 'community' }];
    });
    const requests = [];
    const db = {
        ref: () => {
            const request = { cursor: null, limit: null };
            const query = {
                orderByKey: () => query,
                startAt: cursor => { request.cursor = cursor; return query; },
                limitToFirst: limit => { request.limit = limit; return query; },
                once: async () => {
                    requests.push(request);
                    const start = request.cursor ? records.findIndex(([key]) => key === request.cursor) : 0;
                    const rows = records.slice(start, start + request.limit);
                    return { forEach: callback => rows.forEach(([key, value]) => callback({ key, val: () => value })) };
                }
            };
            return query;
        }
    };
    const elements = { communityCardsStatus: { textContent: '' } };
    const context = vm.createContext({
        window: { db },
        document: { getElementById: id => elements[id] || null },
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        console,
        setTimeout,
        clearTimeout
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('js/app-logic.js', 'utf8'), context);
    context.updateCuratedPackMeta = () => {};
    context.updateRoundMatchCount = () => {};

    await context.loadCommunityCards();
    if (requests.length !== 1 || requests[0].limit !== 101 || context.window.masterDatabase.length !== 100) {
        throw new Error(`first page mismatch: requests=${requests.length}, limit=${requests[0]?.limit}, cards=${context.window.masterDatabase?.length}, status=${elements.communityCardsStatus.textContent}`);
    }
    await context.loadCommunityCards();
    if (requests.length !== 2 || requests[1].cursor !== 'card-099' || requests[1].limit !== 102
        || context.window.masterDatabase.length !== 200
        || elements.communityCardsStatus.textContent.includes('Load more')) {
        throw new Error('continuation page did not resume after the last loaded key');
    }
    await context.loadCommunityCards();
    if (requests.length !== 3 || requests[2].cursor !== 'card-199'
        || context.window.masterDatabase.length !== 250) {
        throw new Error('final page did not finish incremental loading');
    }

    const backgroundRequests = [];
    const backgroundElements = { communityCardsStatus: { textContent: '' } };
    const backgroundContext = vm.createContext({
        window: {
            db: {
                ref: () => {
                    const request = { cursor: null, limit: null };
                    const query = {
                        orderByKey: () => query,
                        startAt: cursor => { request.cursor = cursor; return query; },
                        limitToFirst: limit => { request.limit = limit; return query; },
                        once: async () => {
                            backgroundRequests.push(request);
                            const start = request.cursor ? records.findIndex(([key]) => key === request.cursor) : 0;
                            const rows = records.slice(start, start + request.limit);
                            return { forEach: callback => rows.forEach(([key, value]) => callback({ key, val: () => value })) };
                        }
                    };
                    return query;
                }
            }
        },
        document: { getElementById: id => backgroundElements[id] || null },
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        console,
        setTimeout: callback => { callback(); return 0; },
        clearTimeout
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), backgroundContext);
    vm.runInContext(fs.readFileSync('js/app-logic.js', 'utf8'), backgroundContext);
    backgroundContext.updateCuratedPackMeta = () => {};
    backgroundContext.updateRoundMatchCount = () => {};
    await backgroundContext.loadCommunityDeck();
    if (backgroundRequests.length !== 3 || backgroundRequests[2].cursor !== 'card-199'
        || backgroundContext.window.masterDatabase.length !== 250
        || !backgroundElements.communityCardsStatus.textContent.includes('Global Deck is up to date.')) {
        throw new Error('background load did not fetch the complete deck in bounded pages');
    }
});

check('preview mode displays progress and keeps its label inside the card header', () => {
    const app = fs.readFileSync('js/app.js', 'utf8');
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const progress = logic.match(/function updateCardProgressSlider\(\) \{([\s\S]*?)\n\}/);
    const browseStyle = styles.match(/\.browse-indicator \{([^}]*)\}/);
    if (!progress || progress[1].includes('if (browseMode)')
        || !progress[1].includes('text.textContent = `${played} / ${total}`;')) {
        throw new Error('preview mode does not update the selected-round progress indicator');
    }
    if (!html.includes('Preview · not saved') || !app.includes("showToast('Previewing cards · not saved.')")
        || !browseStyle?.[1].includes('white-space: normal;')
        || !browseStyle[1].includes('max-width: calc(100% - 44px);')) {
        throw new Error('preview label can overflow the card header');
    }
});

check('validate cards.json', () => { execSync('node validate-cards.js cards.json', { stdio: 'pipe' }); });
check('validate explicit-cards.json', () => { execSync('node validate-cards.js explicit-cards.json', { stdio: 'pipe' }); });

Promise.all(pendingChecks).then(() => {
    if (failures > 0) { console.error(`\n${failures} smoke test(s) failed.`); process.exit(1); }
    else { console.log('\nAll smoke tests passed.'); }
});