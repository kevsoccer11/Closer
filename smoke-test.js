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

check('You Get Me setup has an accessible, touch-sized close control', () => {
    const modal = html.match(/<div class="modal-overlay hidden" id="guessMeSetupModal">([\s\S]*?)<\/div>\s*<\/div>/);
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!modal || !modal[1].includes('class="modal-close"')
        || !modal[1].includes('aria-label="Close"')
        || !styles.includes('#guessMeSetupModal .modal-close {\n    display: inline-flex;\n    flex: 0 0 44px;')
        || !styles.includes('width: 44px;\n    min-width: 44px;\n    height: 44px;')) {
        throw new Error('You Get Me setup close control is missing or too small');
    }
    if (!styles.includes('background: var(--card-bg);')
        || !styles.includes('@media (min-width: 768px) {\n    .modal-overlay#guessMeSetupModal {\n        align-items: center;')) {
        throw new Error('You Get Me setup modal does not respect the theme or center on desktop');
    }
});

check('You Get Me setup keeps room actions visible while its choices scroll', () => {
    const modal = html.match(/<div class="modal-overlay hidden" id="guessMeSetupModal">([\s\S]*?)<\/section>/);
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!modal || !modal[1].includes('class="guess-me-setup-content"')
        || !modal[1].includes('class="guess-me-setup-footer"')
        || !modal[1].includes('id="guessMeCreateRoomBtn"')
        || !modal[1].includes('id="guessMeJoinRoomBtn"')) {
        throw new Error('You Get Me setup does not separate scrollable choices from room actions');
    }
    if (!styles.includes('#guessMeSetupModal .guess-me-setup-content {\n    flex: 1 1 auto;\n    min-height: 0;\n    overflow-y: auto;')
        || !styles.includes('#guessMeSetupModal .guess-me-setup-footer {\n    flex: 0 0 auto;')
        || !styles.includes('--app-bottom-nav-height: 63px;')
        || !styles.includes('padding: 24px 20px calc(24px + var(--app-bottom-nav-height) + env(safe-area-inset-bottom, 0px));')) {
        throw new Error('You Get Me room actions are not kept outside the scrolling content');
    }
});

check('You Get Me lobby controls fit narrow screens and modal headers stay pinned', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!styles.includes('#guessMeView .continue-card {\n    flex-wrap: wrap;')
        || !styles.includes('#guessMeView .continue-card > .btn-primary {\n    flex: 1 0 100%;')
        || !styles.includes('#guessMeView .round-builder-actions {\n    grid-template-columns: repeat(2, minmax(0, 1fr));')
        || !styles.includes('#playModeModal .round-builder-heading,\n#playerNamesModal .round-builder-heading {\n    position: sticky;')) {
        throw new Error('You Get Me controls can be squeezed or modal close controls can scroll out of view');
    }
});

check('play mode choices stay reachable and dark mode uses a transparent logo', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const serviceWorker = fs.readFileSync('sw.js', 'utf8');
    const playMode = html.match(/<div class="modal-overlay hidden" id="playModeModal">([\s\S]*?)<\/section>/);
    if (!playMode || !playMode[1].includes('class="play-mode-options"')
        || !playMode[1].includes('id="playModeSameDeviceBtn"')
        || !playMode[1].includes('id="playModePairedBtn"')
        || !styles.includes('#playModeModal .play-mode-options {\n    display: flex;')
        || !styles.includes('#playModeModal .play-mode-card {\n    gap: 0;')) {
        throw new Error('play-mode choices are not laid out as a compact, reachable group');
    }
    const overlayRule = styles.match(/\.modal-overlay#playModeModal,\s*\.modal-overlay#playerNamesModal,\s*\.modal-overlay#guessMeSetupModal \{([^}]*)\}/);
    const navigationRule = styles.match(/\.app-bottom-nav \{([^}]*)\}/);
    const overlayZIndex = Number(overlayRule?.[1].match(/z-index:\s*(\d+)/)?.[1]);
    const navigationZIndex = Number(navigationRule?.[1].match(/z-index:\s*(\d+)/)?.[1]);
    if (!overlayZIndex || !navigationZIndex || overlayZIndex <= navigationZIndex
        || !overlayRule[1].includes('z-index: 10020;')) {
        throw new Error('bottom navigation can cover modal actions');
    }
    if (!/body:not\(\.light-theme\) \.brand-logo-dark \{[^}]*display: inline-block;/.test(styles)
        || !html.includes('img/closer-logo-light.png')
        || !html.includes('img/closer-logo-dark.png')
        || !serviceWorker.includes('./img/closer-logo-light.png')
        || !serviceWorker.includes('./img/closer-logo-dark.png')) {
        throw new Error('dark mode is not using the transparent logo asset');
    }
});

check('home features six curated packs with an Explore link', () => {
    const section = html.match(/<section class="featured-experiences" id="featuredExperiences">([\s\S]*?)<\/section>/);
    if (!section) throw new Error('featured pack section is missing');
    const packs = section[1].match(/class="experience-card pack-card"/g) || [];
    if (packs.length !== 6) throw new Error(`expected 6 featured packs, found ${packs.length}`);
    if (!section[1].includes('<h2>Find your moment</h2>') || !section[1].includes('<div class="experience-list">')) {
        throw new Error('section heading or curated packs are missing from the shared section');
    }
    if (!section[1].includes('id="seeMoreExperiencesBtn"') || !section[1].includes('onclick="showExploreView()"')) {
        throw new Error('See more button is missing');
    }
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!styles.includes('#homeView #featuredExperiences {')
        || !styles.includes('body:not(.light-theme) #homeView #featuredExperiences {')) {
        throw new Error('Find your moment is not visually grouped with the curated pack cards');
    }
});

check('Explore shows every curated pack and mood shortcuts filter matching packs', () => {
    const app = fs.readFileSync('js/app.js', 'utf8');
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const curatedGrid = html.match(/<div class="pack-grid compact">([\s\S]*?)<\/div>/);
    const curatedPacks = curatedGrid?.[1].match(/class="pack-card"/g) || [];
    if (curatedPacks.length !== 22 || curatedPacks.length % 2 !== 0
        || !app.includes("document.querySelector('#curatedTab .pack-grid')")
        || !app.includes("packsClone.className = 'pack-grid compact explore-curated-grid'")
        || !app.includes("document.querySelectorAll('#curatedTab .pack-card, #exploreContent .pack-card')")
        || html.includes('explore-pack-actions')
        || !app.includes("if (moodFilters) packsSection.appendChild(moodFilters);")
        || app.includes('const moodClone = homeMoodSection.cloneNode(true);')) {
        throw new Error(`Explore does not include every curated pack (found ${curatedPacks.length})`);
    }
    const packSelectionHelper = logic.match(/function getCuratedPackSelection\(key\) \{[\s\S]*?\n\}/);
    const curatedKeys = [...curatedGrid[1].matchAll(/data-pack="([^"]+)"/g)].map(match => match[1]);
    const packSelections = packSelectionHelper && vm.runInNewContext(
        `${packSelectionHelper[0]}\n${JSON.stringify(curatedKeys)}.map(key => [key, getCuratedPackSelection(key)])`
    );
    if (!packSelections || packSelections.length !== curatedPacks.length
        || packSelections.some(([key, selection]) => key === 'escalation'
            ? selection !== null
            : !selection || !Array.isArray(selection.modules) || !selection.modules.length)) {
        throw new Error('one or more Explore packs do not have a playable selection');
    }
    const moodHelper = logic.match(/function getExploreMoodValues\(mood\) \{[\s\S]*?\n\}/);
    const moodGroups = moodHelper && vm.runInNewContext(`${moodHelper[0]}\n({ connection: getExploreMoodValues('connection'), playful: getExploreMoodValues('playful'), deep: getExploreMoodValues('deep'), intimacy: getExploreMoodValues('intimacy') })`);
    if (!moodGroups
        || moodGroups.connection.join(',') !== 'connection,reflective,tender'
        || moodGroups.playful.join(',') !== 'playful'
        || moodGroups.deep.join(',') !== 'deep,reflective'
        || moodGroups.intimacy.join(',') !== 'intimacy,romantic,spicy,passionate'
        || !app.includes("button.addEventListener('click', () => {\n            if (!button.closest('#exploreContent'))")) {
        throw new Error('home mood shortcuts do not filter the complete Explore pack list');
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
        || !styles.includes('#homeMoodSection,\n#homeView #featuredExperiences {\n    padding: 14px;')) {
        throw new Error('home moods are not grouped or See all is not wired to Explore');
    }
    if (app.includes('const moodClone = homeMoodSection.cloneNode(true);')
        || !app.includes("if (moodFilters) packsSection.appendChild(moodFilters);")) {
        throw new Error('Explore mood shortcuts are not grouped with the curated packs');
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
    if (!fs.readFileSync('js/app.js', 'utf8').includes("document.getElementById('appNavSettings')?.addEventListener('click', () => {\n        dismissOverlaysForNavigation();\n        document.getElementById('toolsDrawerBtn')?.click();")) {
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
    if (!modalZ || !navigationZ || Number(navigationZ) <= Number(modalZ)) {
        throw new Error('bottom navigation is not clickable above modal overlays');
    }
});

check('round builder start action is available on curated tab', () => {
    const app = fs.readFileSync('js/app.js', 'utf8');
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const customTabStart = html.indexOf('<div class="round-tab-panel hidden" id="customTab">');
    const footerStart = html.indexOf('<div class="round-builder-footer">', customTabStart);
    const customTabClosedBeforeFooter = html.slice(customTabStart, footerStart).trimEnd().endsWith('</div>');
    if (customTabStart < 0 || footerStart < 0 || !customTabClosedBeforeFooter
        || !html.includes("document.getElementById('saveCustomDeckBtn').classList.add('hidden')")
        || !html.includes("document.getElementById('saveCustomDeckBtn').classList.remove('hidden')")
        || !app.includes("document.getElementById('saveCustomDeckBtn')?.classList.toggle('hidden', target !== 'custom')")
        || !logic.includes("document.getElementById('saveCustomDeckBtn')?.classList.add('hidden')")
        || !styles.includes('#roundBuilderModal .round-builder-actions.single-action {\n    grid-template-columns: minmax(0, 1fr);')
        || !styles.includes('#roundBuilderModal .round-builder-actions.single-action button {\n    width: 100%;')) {
        throw new Error('round builder actions are hidden or misleading on the curated tab');
    }
});

check('bottom navigation closes open overlays before navigating', () => {
    const app = fs.readFileSync('js/app.js', 'utf8');
    const navigation = app.match(/const dismissOverlaysForNavigation = \(\) => \{([\s\S]*?)\n    \};/);
    if (!navigation || !navigation[1].includes("document.querySelectorAll('.modal-overlay:not(.hidden)')")
        || !navigation[1].includes('setModalOpen(modal, false)')
        || !navigation[1].includes('closeDrawer()')
        || !navigation[1].includes('pendingGameStart = null;')) {
        throw new Error('navigation does not close modal/drawer state before routing');
    }
    const navBindings = app.match(/document\.getElementById\('exploreNavBtn'\).*?const filterExploreCards = \(\) => \{/s);
    if (!navBindings || (navBindings[0].match(/dismissOverlaysForNavigation\(\);/g) || []).length !== 6) {
        throw new Error('one or more bottom-navigation actions do not dismiss open overlays');
    }
});

check('Explore and card browser controls clear the fixed bottom navigation', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!styles.includes('padding: 16px 18px calc(var(--app-bottom-nav-height) + 48px + env(safe-area-inset-bottom, 0px));')
        || !styles.includes('padding: calc(16px + env(safe-area-inset-top, 0px)) 18px calc(var(--app-bottom-nav-height) + 24px + env(safe-area-inset-bottom, 0px));')) {
        throw new Error('page and drawer scrolling do not reserve enough space above the fixed bottom navigation');
    }
});

check('paired pack selection remains in the connected round builder until the host starts', () => {
    const app = fs.readFileSync('js/app.js', 'utf8');
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const builderPackSelection = app.match(/if \(btn\.closest\('#curatedTab'\)\) \{([\s\S]*?)\n            \}\n            startPackByKey/);
    const pairedStart = logic.match(/startButton\.onclick = \(\) => \{([\s\S]*?)\n        \};\n        startSection\.append/);
    if (!builderPackSelection
        || !builderPackSelection[1].includes('applyPack(packKey);')
        || !builderPackSelection[1].includes('updateRoundMatchCount();')
        || builderPackSelection[1].includes('startPackByKey(')
        || !app.includes("document.querySelector('.round-tab[data-tab=\"custom\"]')?.addEventListener('click'")
        || !pairedStart
        || !pairedStart[1].includes('openRoundBuilder();')
        || !pairedStart[1].includes('if (pendingPack) pendingPack.click();')
        || !pairedStart[1].includes('window.pendingPackKey = null;')) {
        throw new Error('paired pack selection restarts mode selection or loses the selected pack before starting');
    }
});

check('card browser includes searchable deck, intensity, type, and category filters', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const browser = logic.match(/function renderCardBrowserDrawerContent\(content, initialView = 'list'\) \{([\s\S]*?)\n\}/);
    if (!browser
        || !browser[1].includes('cardBrowserModuleFilter')
        || !browser[1].includes('cardBrowserIntensityFilter')
        || !browser[1].includes('cardBrowserTypeFilter')
        || !browser[1].includes('cardBrowserCategoryFilter')
        || !browser[1].includes("checkbox.type = 'checkbox'")
        || !browser[1].includes('const selectedCategories = new Set()')
        || !browser[1].includes('selectedCategories.has(String(card.category || \'General\'))')
        || !browser[1].includes('selectedCategories.clear()')
        || !browser[1].includes('clearFiltersButton.addEventListener')
        || !styles.includes('.card-browser-filters {')
        || !styles.includes('.card-browser-category-list {')
        || !styles.includes('max-height: 190px;')
        || !styles.includes('.card-browser-filter select {')) {
        throw new Error('card browser category checkboxes are missing or do not filter results');
    }
});

check('card browser loads explicit cards after age confirmation', async () => {
    class TestElement {
        constructor(tagName = 'div') {
            this.tagName = tagName;
            this.children = [];
            this.attributes = {};
            this.listeners = {};
            this.classList = { add() {}, remove() {}, toggle() {} };
            this.dataset = {};
            this.style = {};
            this.isConnected = true;
            this.value = '';
            this.textContent = '';
        }
        append(...elements) {
            elements.forEach(element => {
                if (this.tagName === 'select' && this.children.length === 0) this.value = element.value;
                this.children.push(element);
            });
        }
        appendChild(element) {
            if (this.tagName === 'select' && this.children.length === 0) this.value = element.value;
            this.children.push(element);
        }
        replaceChildren(...elements) { this.children = elements; }
        setAttribute(name, value) { this.attributes[name] = value; }
        addEventListener(type, callback) {
            (this.listeners[type] ||= []).push(callback);
        }
        dispatch(type) {
            return this.listeners[type]?.map(callback => callback({ target: this, currentTarget: this })).at(-1);
        }
    }

    const stored = new Map();
    const storage = {
        getItem: key => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key)
    };
    const ageGate = new TestElement();
    let ageGateOpened = false;
    const context = vm.createContext({
        window: { localStorage: storage, sessionStorage: storage },
        localStorage: storage,
        sessionStorage: storage,
        document: {
            createElement: tagName => new TestElement(tagName),
            getElementById: id => id === 'explicitAgeGate' ? ageGate : null
        },
        fetch: async () => ({
            ok: true,
            json: async () => ({
                cards: [{ id: 'explicit-test-card', module: 'explicit', pillar: 'afterhours', category: 'Test', intensity: 1, prompt: 'Explicit card prompt?' }]
            })
        }),
        console: { error() {}, warn() {}, log() {} }
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('js/app-logic.js', 'utf8'), context);
    context.setModalOpen = (_modal, open) => { ageGateOpened = open; };
    const content = new TestElement();
    context.renderCardBrowserDrawerContent(content);

    const findById = (element, id) => {
        if (element.id === id) return element;
        for (const child of element.children) {
            const found = findById(child, id);
            if (found) return found;
        }
        return null;
    };
    const moduleFilter = findById(content, 'cardBrowserModuleFilter');
    moduleFilter.value = 'explicit';
    await moduleFilter.dispatch('change');
    if (!ageGateOpened || moduleFilter.value !== 'all') {
        throw new Error('explicit card access was not guarded by age confirmation');
    }

    storage.setItem('closer_explicit_age_confirmed', 'true');
    const loaded = await context.loadExplicitCards();
    context.resumeExplicitCardBrowserFilter(loaded);
    const resultCount = content.children.find(child => child.className === 'card-browser-count');
    if (!loaded || !resultCount?.textContent.includes('1 card found.')
        || vm.runInContext('masterDatabase.length', context) !== 1) {
        throw new Error('explicit cards were not loaded and displayed after confirmation');
    }
    const app = fs.readFileSync('js/app.js', 'utf8');
    if (!app.includes('if (resumeExplicitCardBrowserFilter()) return;')
        || !app.includes('cancelExplicitCardBrowserFilter();')) {
        throw new Error('the age confirmation actions do not resume or cancel the pending browser filter');
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

check('custom deck play ignores unrelated filters and opens the game view', () => {
    class TestElement {
        constructor() {
            this.children = [];
            this.dataset = {};
            this.attributes = {};
            this.classList = {
                add() {},
                remove() {},
                toggle() {}
            };
        }
        append(...elements) { this.children.push(...elements); }
        appendChild(element) { this.children.push(element); }
        replaceChildren(...elements) { this.children = elements; }
        setAttribute(name, value) { this.attributes[name] = value; }
    }

    const stored = new Map();
    const storage = {
        getItem: key => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key)
    };
    const deckList = new TestElement();
    const exitButton = new TestElement();
    const body = { dataset: { pack: 'previous-pack' } };
    const events = [];
    const context = vm.createContext({
        window: { localStorage: storage, sessionStorage: storage },
        localStorage: storage,
        sessionStorage: storage,
        document: {
            body,
            createElement: () => new TestElement(),
            getElementById: id => ({ myDecksList: deckList, exitDeckModeBtn: exitButton }[id] || null),
            querySelectorAll: () => [],
            querySelector: () => null
        },
        console: { error() {}, warn() {}, log() {} }
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('js/app-logic.js', 'utf8'), context);
    context.testCards = [
        { id: 'deck-card', module: 'explicit', category: 'After Hours', intensity: 3, promptStyle: 'question' },
        { id: 'other-card', module: 'spark', category: 'Playful', intensity: 1, promptStyle: 'question' }
    ];
    vm.runInContext(`
        masterDatabase = testCards;
        customDecks = [{ id: 'selected-deck', name: 'Selected', cardIds: ['deck-card'] }];
        activePillars = ['spark'];
        activeTopics = [];
        activeMood = 'deep';
        includeQuestions = false;
        favoritesOnly = true;
        activeGameMode = 'compare-first';
    `, context);
    context.recordEvent = event => events.push(event);
    vm.runInContext(`
        exitCompareFirstMode = () => { activeGameMode = 'classic'; };
        updateQuestionTypeSelection = () => {};
        updateActiveModulePresentation = () => {};
        closeDrawer = () => recordEvent('close');
        showGameView = () => recordEvent('show');
        drawNextCard = () => recordEvent('draw');
    `, context);

    context.renderMyDecks();
    const playButton = deckList.children[0].children[1].children[0];
    playButton.onclick();

    const selectedIds = vm.runInContext('unspentDeck.map(card => card.id)', context);
    if (selectedIds.length !== 1 || selectedIds[0] !== 'deck-card') {
        throw new Error('deck cards were still filtered by unrelated round settings');
    }
    if (vm.runInContext('activeDeckId', context) !== 'selected-deck'
        || stored.get('closer_active_deck') !== 'selected-deck') {
        throw new Error('selected deck mode was not persisted');
    }
    if (vm.runInContext('activeMood', context) !== 'all'
        || vm.runInContext('favoritesOnly', context)
        || vm.runInContext('activeGameMode', context) !== 'classic'
        || body.dataset.pack !== undefined) {
        throw new Error('deck play did not clear incompatible round state');
    }
    if (events.join(',') !== 'draw,close,show') {
        throw new Error(`expected to draw, close the drawer, and show the game; got ${events.join(',')}`);
    }

    vm.runInContext("customDecks = [{ id: 'empty-deck', name: 'Empty', cardIds: [] }]; activeDeckId = null;", context);
    context.renderMyDecks();
    const emptyPlayButton = deckList.children[0].children[1].children[0];
    if (!emptyPlayButton.disabled || emptyPlayButton.textContent !== 'Add cards to play') {
        throw new Error('empty deck does not clearly disable its Play action');
    }
});

check('starting another round exits custom deck mode and saved decks honor mood', async () => {
    const stored = new Map([['closer_active_deck', 'old-deck']]);
    const storage = {
        getItem: key => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key)
    };
    const context = vm.createContext({
        window: { localStorage: storage, sessionStorage: storage },
        localStorage: storage,
        sessionStorage: storage,
        document: {
            getElementById: () => null,
            querySelectorAll: () => [],
            querySelector: () => null
        },
        console: { error() {}, warn() {}, log() {} }
    });
    vm.runInContext(fs.readFileSync('js/app-state.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('js/app-logic.js', 'utf8'), context);
    context.testCards = [
        { id: 'spicy-card', module: 'explicit', category: 'After Hours', intensity: 3, promptStyle: 'question', mood: 'spicy' },
        { id: 'deep-card', module: 'explicit', category: 'After Hours', intensity: 2, promptStyle: 'question', mood: 'deep' }
    ];
    vm.runInContext(`
        masterDatabase = testCards;
        activeDeckId = 'old-deck';
        activeGameMode = 'classic';
    `, context);
    vm.runInContext(`
        updateQuestionTypeSelection = () => {};
        updateActiveModulePresentation = () => {};
        updateRoundSummary = () => {};
        rebuildUnspentDeck = () => {};
        drawNextCard = () => { currentCard = testCards[0]; };
        closeRoundBuilder = () => {};
        showGameView = () => {};
    `, context);

    const savedCards = context.getCardsForRoundSelection({
        modules: ['afterhours'],
        topics: null,
        mood: 'spicy',
        questions: true,
        activities: true,
        multipleChoice: true
    });
    if (savedCards.length !== 1 || savedCards[0].id !== 'spicy-card') {
        throw new Error('saved deck selection did not apply the selected mood');
    }
    const started = await context.applyRoundSelection({
        modules: ['spark'],
        topics: null,
        mood: 'all',
        questions: true,
        activities: true,
        multipleChoice: true
    });
    if (!started || vm.runInContext('activeDeckId', context) !== null
        || stored.has('closer_active_deck')) {
        throw new Error('starting a new round left the previous custom deck active');
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

check('header uses the transparent logo with the same dimensions in both themes', () => {
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
    if (!html.includes('img/closer-logo-light.png')
        || !html.includes('img/closer-logo-dark.png')
        || !styles.includes('body:not(.light-theme) .brand-logo-dark')) {
        throw new Error('the transparent logo is not reused with a dark-mode treatment');
    }
    if (!styles.includes('@media (min-width: 1024px) {\n    body {\n        padding-left: 280px;\n    }\n    .top-bar .brand-block {\n        display: none;')) {
        throw new Error('desktop header duplicates the sidebar logo');
    }
});

check('desktop sidebar logo is centered and sized to use the brand area', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const brandRule = styles.match(/\.sidebar-brand \{([^}]*)\}/);
    const logoRule = styles.match(/\.sidebar-brand \.brand-logo \{([^}]*)\}/);
    if (!brandRule || !brandRule[1].includes('display: flex;')
        || !brandRule[1].includes('justify-content: center;')) {
        throw new Error('desktop sidebar brand is not horizontally centered');
    }
    if (!logoRule || !logoRule[1].includes('height: 6rem;')
        || !logoRule[1].includes('width: 9rem;')) {
        throw new Error('desktop sidebar logo does not use the available brand space');
    }
});

check('You Get Me length and vibe selectors use spaced wrapping chip layouts', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    const chipsRule = styles.match(/\.round-builder-chips \{([^}]*)\}/);
    if (!chipsRule || !chipsRule[1].includes('display: flex;')
        || !chipsRule[1].includes('flex-wrap: wrap;')
        || !chipsRule[1].includes('gap: 8px;')) {
        throw new Error('You Get Me selector chips do not have a responsive spaced layout');
    }
});

check('Explore controls and cards have dark-mode styling', () => {
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!styles.includes('body:not(.light-theme) .explore-search,')
        || !styles.includes('body:not(.light-theme) .explore-mood-filters .filter-chip:not(.active) {')
        || !styles.includes('body:not(.light-theme) #exploreContent .category-card,')
        || !styles.includes('body:not(.light-theme) #exploreContent .experience-card,')
        || !styles.includes('body:not(.light-theme) #exploreContent .explore-curated-grid .pack-card {')
        || !styles.includes('body:not(.light-theme) .app-bottom-nav {')) {
        throw new Error('Explore controls or cards do not adapt to dark mode');
    }
});

['js/app.js', 'js/app-logic.js', 'js/app-state.js'].forEach(f => check(`syntax ${f}`, () => {
    execSync(`node --check ${f}`, { stdio: 'pipe' });
}));

check('validate YGM-question-bank.json', () => {
    const d = JSON.parse(fs.readFileSync('YGM-question-bank.json', 'utf8'));
    if (d.count !== 440) throw new Error(`expected 440 questions, found ${d.count}`);
    if (!Array.isArray(d.questions) || d.questions.length !== 440) throw new Error('questions length');
    const ids = d.questions.map(q => q.id);
    if (new Set(ids).size !== ids.length) throw new Error('duplicate ids');
    if (d.questions.some(q => !Array.isArray(q.options) || q.options.length !== 4
        || q.options.some(option => typeof option !== 'string' || !option.trim())
        || typeof q.question !== 'string' || !q.question.trim())) throw new Error('invalid question or options');
    const listed = new Set(d.categories);
    const used = new Set(d.questions.map(q => q.category));
    if (listed.size !== d.categories.length) throw new Error('duplicate entries in categories list');
    const unlisted = [...used].filter(c => !listed.has(c));
    const unused = [...listed].filter(c => !used.has(c));
    if (unlisted.length || unused.length) {
        throw new Error(`categories list out of sync (unlisted: ${unlisted.join(', ') || 'none'}; unused: ${unused.join(', ') || 'none'})`);
    }
    const newCategories = ['support_stress', 'conflict_repair', 'values_future', 'vulnerability_growth'];
    if (newCategories.some(category => !d.categories.includes(category)
        || d.questions.filter(question => question.category === category).length !== 10)) {
        throw new Error('deeper relationship categories are missing or unbalanced');
    }
});

check('general question bank includes new life-stage and support topics', () => {
    const cards = JSON.parse(fs.readFileSync('cards.json', 'utf8')).cards;
    const additions = cards.filter(card => /^coverage-\d{3}$/.test(card.id));
    const expectedCategories = [
        'Family Planning & Reproductive Health',
        'Body Changes & Life Stages',
        'Access Needs & Neurodiversity',
        'Identity, Culture & Belonging',
        'Grief, Stress & Support',
        'Care Work & Shared Load'
    ];
    if (additions.length !== 30 || new Set(additions.map(card => card.id)).size !== 30) {
        throw new Error('expected 30 uniquely identified coverage cards');
    }
    if (expectedCategories.some(category => additions.filter(card => card.category === category).length !== 5)) {
        throw new Error('coverage categories should each have five questions');
    }
    const normalize = prompt => prompt.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const existingPrompts = new Set(cards.filter(card => !additions.includes(card)).map(card => normalize(card.prompt)));
    if (additions.some(card => existingPrompts.has(normalize(card.prompt)))) {
        throw new Error('a coverage question duplicates an existing prompt');
    }
});

check('deck health: pillar sizes, story density, unique prompts and clean wording', () => {
    const main = JSON.parse(fs.readFileSync('cards.json', 'utf8')).cards;
    const explicit = JSON.parse(fs.readFileSync('explicit-cards.json', 'utf8')).cards;
    const all = [...main, ...explicit];
    const pillarOf = card => card.pillar || (card.module === 'explicit' ? 'afterhours' : 'closer');
    const minimums = { spark: 800, heat: 900, closer: 1000, together: 900, afterhours: 2000 };
    for (const [pillar, min] of Object.entries(minimums)) {
        const count = all.filter(card => pillarOf(card) === pillar).length;
        if (count < min) throw new Error(`${pillar} has ${count} cards, expected at least ${min}`);
    }
    const reference = JSON.parse(fs.readFileSync('questions-reference.json', 'utf8'));
    if (reference.total !== all.length || reference.questions.length !== all.length) {
        throw new Error('questions-reference.json is out of date; regenerate it from cards.json and explicit-cards.json');
    }
    const stories = main.filter(card => card.contextType === 'story').length;
    if (stories < 250) throw new Error(`only ${stories} story cards; expected at least 250`);
    const normalize = prompt => prompt.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const seen = new Map();
    for (const card of all) {
        const key = normalize(card.prompt);
        if (seen.has(key)) throw new Error(`duplicate prompt in ${seen.get(key)} and ${card.id}`);
        seen.set(key, card.id);
        if (/\b(\w+) \1\b/i.test(card.prompt) && !/\b(that that|had had)\b/i.test(card.prompt)) {
            throw new Error(`repeated word in ${card.id}: ${card.prompt}`);
        }
    }
    const openers = new Map();
    for (const card of main) {
        const opener = normalize(card.prompt).split(' ').slice(0, 5).join(' ');
        openers.set(opener, (openers.get(opener) || 0) + 1);
    }
    for (const [opener, count] of openers) {
        if (count > 60) throw new Error(`prompt opener "${opener}" is used ${count} times; vary the wording`);
    }
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const storyTopics = [...logic.match(/const STORY_PACK_TOPICS = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    for (const topic of storyTopics) {
        if (!main.some(card => `${pillarOf(card)}::${card.category}` === topic)) throw new Error(`Story Time topic has no cards: ${topic}`);
    }
    const followUps = main.filter(card => card.followUp !== undefined);
    if (followUps.length < 100) throw new Error('expected follow-up prompts on the story cards');
    if (followUps.some(card => typeof card.followUp !== 'string' || !card.followUp.trim() || card.followUp.length > 200)) {
        throw new Error('invalid followUp text');
    }
    if (new Set(followUps.map(card => card.followUp)).size !== followUps.length) throw new Error('followUp prompts must be unique per card');
    if (!/PACK_SIZE_MIN = 8;\s*const PACK_SIZE_MAX = 25;/.test(logic) || !logic.includes('getRandomPackSize(pool.length)') || !logic.includes('getUnplayedPackCards') || !logic.includes("You've covered this pack") || !logic.includes('estimateCardMinutes')) {
        throw new Error('packs should draw a random size with a time estimate');
    }
    const sizeHelper = logic.match(/function getRandomPackSize\(available = Infinity\) \{[\s\S]*?\n\}/);
    const sizes = sizeHelper && vm.runInNewContext(`const PACK_SIZE_MIN = 8; const PACK_SIZE_MAX = 25;\n${sizeHelper[0]}\nArray.from({ length: 400 }, () => getRandomPackSize()).concat([getRandomPackSize(3), getRandomPackSize(12)])`);
    if (!sizes || Math.max(...sizes) > 25 || Math.min(...sizes) < 3 || new Set(sizes).size < 10 || sizes[400] > 3 || sizes[401] > 12) {
        throw new Error('pack sizes must be random, capped at 25 and limited by available cards');
    }
    if (!html.includes('id="cardFollowUp"') || !logic.includes('card.followUp')) throw new Error('follow-up prompts are not rendered');
});

check('You Get Me selection filters by vibe and avoids duplicates', () => {
    const bank = JSON.parse(fs.readFileSync('YGM-question-bank.json', 'utf8')).questions;
    const categories = {
        mixed: null,
        playful: ['silly_ridiculous', 'everyday_personality', 'couple_fun', 'preferences_unexpected', 'travel', 'movies', 'food'],
        romantic: ['everyday_personality', 'couple_fun', 'preferences_unexpected', 'sweet_flirty', 'travel', 'food'],
        deep: ['everyday_personality', 'couple_fun', 'sweet_flirty', 'support_stress', 'conflict_repair', 'values_future', 'vulnerability_growth', 'fears']
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
        const selected = Array.from(context.window.pickGuessMeQuestions(100, vibe));
        if (selected.length !== 100) throw new Error(`${vibe} should return 100 questions`);
        if (new Set(selected).size !== selected.length) throw new Error(`${vibe} returned duplicate questions`);
        if (selected.some(id => {
            const question = bank.find(item => item.id === id);
            return !question || (allowedCategories && !allowedCategories.includes(question.category));
        })) throw new Error(`${vibe} returned a question outside its category`);
    });
    if (context.window.pickGuessMeQuestions(10, 'deep').length !== 10) throw new Error('deep selection count mismatch');
    const deepIds = Array.from(context.window.pickGuessMeQuestions(200, 'deep'));
    const deepCategories = new Set(deepIds.map(id => bank.find(item => item.id === id)?.category));
    for (const category of ['support_stress', 'conflict_repair', 'values_future', 'vulnerability_growth']) {
        if (!deepCategories.has(category)) throw new Error(`deep selection omitted ${category}`);
    }
    if (context.window.pickGuessMeQuestions(0, 'mixed').length !== 0) throw new Error('zero-length selection should be empty');
    let lengthInput = { value: '100' };
    context.document.getElementById = id => id === 'guessMeQuestionCount' ? lengthInput : null;
    context.document.querySelector = selector => selector === '#guessMeVibeChips .filter-chip.active'
        ? { dataset: { vibe: 'deep' } }
        : null;
    const selection = context.window.getGuessMeSelection();
    if (selection.length !== 100 || selection.vibe !== 'deep') throw new Error('custom round length was not read');
    lengthInput.value = '101';
    let rejectedInvalidLength = false;
    try { context.window.getGuessMeSelection(); } catch { rejectedInvalidLength = true; }
    if (!rejectedInvalidLength) throw new Error('round lengths above 100 were accepted');
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
        || !rules.questionIds['.validate'].includes("!newData.child('100').exists()")
        || !rules.questionIds.$questionIndex['.validate'].includes('[1-9][0-9]')
        || !rules.length['.validate'].includes('newData.val() <= 100')) {
        throw new Error('question IDs are not validated with supported list bounds');
    }
    if (rules.hostReady['.write'].includes("members/partner")
        || !rules.partnerReady['.write'].includes('newData.val() === false')) {
        throw new Error('ready state writes are not constrained to the owning player');
    }
});

check('You Get Me lets players choose a round length and requires mutual replay consent', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const setup = html.match(/id="guessMeQuestionCount"[^>]+/);
    if (!setup || !setup[0].includes('min="1"') || !setup[0].includes('max="100"')
        || !logic.includes("await window.roomRef.child(`guessMe/replayVotes/${myRole}`).set(vote);")
        || !logic.includes("gm.replayVotes?.host !== 'yes' || gm.replayVotes?.partner !== 'yes'")
        || !logic.includes('await startGuessMeReplay(gm);')) {
        throw new Error('custom question count or mutual replay voting is missing');
    }
});

check('You Get Me lobby lets the host approve or deny join requests', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const lobby = logic.match(/async function renderGuessMe\(gm\) \{([\s\S]*?)if \(gm\.status === 'complete'\)/);
    if (!lobby || !lobby[1].includes('if (isHost)')
        || !lobby[1].includes('createJoinRequestsSection(')
        || !lobby[1].includes('guessMeJoinRequestStatus')) {
        throw new Error('host join-request actions are missing from the You Get Me lobby');
    }
    const listener = logic.match(/if \(role === 'host'\) \{\s*roomJoinRequestsListener = snapshot => \{([\s\S]*?)\n        \};/);
    if (!listener || !listener[1].includes('refreshGuessMeState()')) {
        throw new Error('new join requests do not refresh the visible You Get Me lobby');
    }
    if (!logic.includes('approveButton.onclick = () => resolveJoinRequest(uid, true);')
        || !logic.includes('denyButton.onclick = () => resolveJoinRequest(uid, false);')) {
        throw new Error('host join-request approval or denial action is not wired');
    }
});

check('You Get Me reveals for both players and supports shared pause, resume, and end', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')).rules.rooms.$roomCode.guessMe.status;
    const ruleTests = fs.readFileSync('tests/database-rules.test.js', 'utf8');
    if (!logic.includes("if (gm.status === 'playing' && ss.answerSubmitted && ss.guessSubmitted && !ss.resolved && isHost)")
        || !logic.includes('if (ss.resolved && !ss.scored && isHost) {\n        (async () => {')
        || !logic.includes('nextBtn.disabled = gm.status === \'paused\' || !ss.scored || !revealReady || !isHost;')
        || !logic.includes("gm.status === 'paused' ? 'Resume game' : 'Pause game'")
        || !logic.includes("textContent = 'End game';")
        || !logic.includes("if (gm.status === 'ended')")) {
        throw new Error('shared reveal, pause/resume, or partial results flow is missing');
    }
    if (!rules['.write'].includes("members/partner")
        || !rules['.validate'].includes("newData.val() === 'paused'")
        || !rules['.validate'].includes("newData.val() === 'ended'")
        || !ruleTests.includes("guessMe/status`), 'paused'"))
        throw new Error('shared game state transitions are not covered by database rules tests');
});

check('You Get Me compares both locked choices before the host can continue', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const styles = fs.readFileSync('css/styles.css', 'utf8');
    if (!logic.includes("qp.textContent = ss.resolved ? 'Both choices are locked in.")
        || !logic.includes('if (!ss.resolved && q && Array.isArray(q.options)')
        || !logic.includes("comparison.className = 'guess-me-answer-comparison';")
        || !logic.includes("createAnswerTile(answererName, 'chose', revealAnswer")
        || !logic.includes("createAnswerTile(predictorName, 'predicted', revealGuess")
        || !logic.includes('const revealReady = ss.resolved')
        || !logic.includes('|| !revealReady || !isHost;')
        || !logic.includes("if (!isHost || !revealReady || !ss.scored || gm.status !== 'playing') return;")
        || !styles.includes('#guessMeView .guess-me-answer-comparison {')
        || !styles.includes('@media (prefers-reduced-motion: reduce)')) {
        throw new Error('You Get Me should reveal both locked choices together before the host advances');
    }
});

check('approved private rooms direct the host to choose a pack', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const state = fs.readFileSync('js/app-state.js', 'utf8');
    if (!logic.includes("startButton.textContent = 'Choose a pack and start';")
        || !logic.includes('closeDrawer();\n            openRoundBuilder();')
        || !/partnerConnected\s*&& currentRoomGameModeLoaded && currentRoomGameMode !== 'guess-me'/.test(logic)
        || !logic.includes('renderPairManagement();\n            }\n        };\n        window.roomRef.child(\'members/partner\')')
        || !state.includes('let currentRoomGameModeLoaded = false;')) {
        throw new Error('regular paired rooms do not offer pack selection after the partner joins');
    }
});

check('shared conversation starts only after the host syncs its first card', () => {
    const logic = fs.readFileSync('js/app-logic.js', 'utf8');
    const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')).rules.rooms.$roomCode.activeCard;
    const start = logic.match(/async function applyRoundSelection\(selection[\s\S]*?\n}\n\nfunction openRoundBuilder/);
    const listener = logic.match(/activeCardSyncListener = snapshot => \{([\s\S]*?)\n    \};/);
    const createRoom = logic.match(/async function createRoom\(\) \{([\s\S]*?)\n}\n\nasync function requestRoomAccess/);
    if (!start || !start[0].includes('await window.roomRef.child(\'activeCard\').set({')
        || !start[0].includes('sharedRoundStartedAt: Date.now()')
        || !start[0].includes('Could not start the shared conversation because room sync failed')
        || !listener || !listener[1].includes('Number.isFinite(remoteCard?.sharedRoundStartedAt)')
        || !listener[1].includes('sharedRoundStartedBeforeModeLoaded = true')
        || !createRoom || createRoom[1].includes('activeCard')
        || !start[0].includes('isSeatedRoomMember()')) {
        throw new Error('paired players do not share an acknowledged round-start transition');
    }
    if (!logic.includes('} else if (sharedRoundStartedBeforeModeLoaded) {')) {
        throw new Error('the round-start transition is not applied after the room mode loads');
    }
    if (!rules['.write'].includes("members/host")
        || !rules['.write'].includes("members/partner")
        || !rules.startedBy) {
        throw new Error('either room member should be able to publish the shared active card, stamped with their uid');
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
    const draw = logic.match(/function drawNextCard\([\s\S]*?\n\}/);
    const renderCard = logic.match(/function renderCard\(card\) \{([\s\S]*?)\n\}/);
    const renderAnswers = logic.match(/function renderCardAnswerPanel\(card\) \{([\s\S]*?)\n\}/);
    const browseStyle = styles.match(/\.browse-indicator \{([^}]*)\}/);
    if (!progress || progress[1].includes('if (browseMode)')
        || !progress[1].includes('text.textContent = `${played} / ${total}`;')) {
        throw new Error('preview mode does not update the selected-round progress indicator');
    }
    if (!html.includes('Preview · not saved')
        || !browseStyle?.[1].includes('white-space: normal;')
        || !browseStyle[1].includes('max-width: calc(100% - 44px);')) {
        throw new Error('preview label can overflow the card header');
    }
    const customTabStart = html.indexOf('id="customTab"');
    const previewByCardPosition = html.indexOf('id="previewCustomCardsBtn"');
    const previewByListPosition = html.indexOf('id="previewCustomListBtn"');
    const cardBrowser = logic.match(/function renderCardBrowserDrawerContent\(content, initialView = 'list'\) \{([\s\S]*?)\n\}/);
    if (customTabStart < 0
        || previewByCardPosition < customTabStart
        || previewByListPosition < customTabStart
        || !html.includes('Preview individual questions and add the ones you want to a custom deck.')
        || html.includes('id="browseModeCustomBtn"')
        || html.includes('id="previewRoundListBtn"')
        || !app.includes("openCustomDeckCardBrowser('card')")
        || !app.includes("openCustomDeckCardBrowser('list')")
        || !app.includes("renderCardBrowserDrawerContent(document.getElementById('drawerContent'), view)")
        || !cardBrowser?.[1].includes("intro.textContent = 'Preview each question, then add or remove cards from your custom deck.';")
        || !cardBrowser?.[1].includes("addBtn.textContent = already ? 'Remove from deck' : 'Add to deck';")
        || !cardBrowser[1].includes("if (cardIndex >= 0) deck.cardIds.splice(cardIndex, 1);")
        || !cardBrowser[1].includes("showToast(cardIndex >= 0 ? 'Removed from deck.' : 'Added to deck.');")
        || !cardBrowser[1].includes("createDeckBtn.textContent = 'New deck';")
        || !cardBrowser[1].includes("listViewButton.textContent = 'List view';")
        || !cardBrowser[1].includes("cardViewButton.textContent = 'Card view';")
        || !cardBrowser[1].includes("'card-container card-browser-item card-preview-item'")
        || !cardBrowser[1].includes("'drawer-item card-browser-item'")
        || !cardBrowser[1].includes("previewFace.className = 'card-face card-browser-preview-face'")
        || !cardBrowser[1].includes("`${cardIndex + 1} of ${matchingCards.length}`")
        || !cardBrowser[1].includes("const cardsToRender = currentView === 'card' ? [currentCards[cardIndex]] : currentCards;")
        || !cardBrowser[1].includes("previousCardButton.textContent = 'Previous card';")
        || !cardBrowser[1].includes("nextCardButton.textContent = 'Next card';")
        || !cardBrowser[1].includes('card.options.join')
        || !cardBrowser[1].includes('displayedLimit += 60;')
        || !styles.includes('.card-browser-list.card-view {')
        || !renderAnswers?.[1].includes('if (browseMode)')
        || !renderAnswers[1].includes('radio.disabled = true;')
        || !renderAnswers[1].includes("submitButton.classList.add('hidden')")
        || !draw?.[0].includes("if (!browseMode) {\n        try {\n            localStorage.setItem('closer_unspent_deck'")
        || !renderCard?.[1].includes("browseIndicator.classList.toggle('hidden', !browseMode)")
        || !logic.match(/function updateTurnIndicator\(\) \{[\s\S]*?turnIndicator\.classList\.add\('hidden'\)/)) {
        throw new Error('preview list/card views or preview-only persistence behavior are missing');
    }
});

check('validate cards.json', () => { execSync('node validate-cards.js cards.json', { stdio: 'pipe' }); });
check('validate explicit-cards.json', () => { execSync('node validate-cards.js explicit-cards.json', { stdio: 'pipe' }); });
check('rephrased explicit prompt templates stay varied and retain their cards', () => {
    const bank = JSON.parse(fs.readFileSync('explicit-cards.json', 'utf8'));
    const cardsById = new Map(bank.cards.map(card => [card.id, card]));
    const expectedIds = [
        '0001 0051 0076 0101 0126 0151 0176 0201 0251 0276 0301 0326 0351 0376 0401 0426 0451 0476',
        '0003 0053 0078 0103 0128 0153 0178 0203 0253 0278 0303 0328 0353 0378 0403 0428 0453 0478',
        '0005 0030 0055 0080 0105 0130 0155 0180 0205 0230 0255 0280 0305 0330 0355 0380 0405 0430 0455 0480',
        '0009 0059 0084 0109 0134 0159 0184 0209 0234 0259 0284 0309 0334 0359 0384 0409 0434 0459 0484',
        '0024 0074 0099 0124 0149 0174 0199 0224 0249 0274 0299 0324 0349 0374 0399 0424 0449 0474 0499',
        '0015 0040 0065 0090 0115 0140 0165 0190 0215 0240 0265 0290 0315 0340 0365 0390 0415 0440 0465 0490'
    ].flatMap(group => group.split(' ').map(id => `explicit-${id}`));
    const repeatedTemplates = /would you be into it\s*[—–-]\s*or save that for later|slow and teasing or straight to the good stuff|who.?s calling the shots during|director.?s cut|if you get quiet while|position or setup you’ve been wanting to try for/i;
    if (expectedIds.length !== 114
        || expectedIds.some(id => !cardsById.has(id))
        || expectedIds.some(id => repeatedTemplates.test(cardsById.get(id).prompt))
        || bank.cards.some(card => repeatedTemplates.test(card.prompt))) {
        throw new Error('targeted explicit prompts should retain their IDs without restoring repeated templates');
    }
});
check('oral-sex prompts use invitational, non-pressuring language', () => {
    const bank = JSON.parse(fs.readFileSync('explicit-cards.json', 'utf8'));
    const recentOralPrompts = bank.cards.filter(card => card.category === 'Oral Sex' && card.id.startsWith('new-'));
    const aggressivePhrasing = /ten times harder|push harder|grip tightly|working perfectly|working flawlessly|TRUTH:|intense oral sex/i;
    if (recentOralPrompts.length !== 10 || recentOralPrompts.some(card => aggressivePhrasing.test(card.prompt))) {
        throw new Error('recent oral-sex prompts still contain forceful or performance-focused wording');
    }
});
check('explicit prompts avoid pressure in sleep, oral-sex, and edging scenarios', () => {
    const bank = JSON.parse(fs.readFileSync('explicit-cards.json', 'utf8'));
    const cardsById = new Map(bank.cards.map(card => [card.id, card]));
    const expected = new Map([
        ['new-39340cc5-c476-4b70-9d35-ab957048ceba', {
            promptIncludes: ['nonsexual', 'wait until we’re both awake'],
            options: []
        }],
        ['new-4b9d58f4-d352-42fe-a52f-d8760d29533b', {
            promptIncludes: ['check in or pause'],
            options: []
        }],
        ['new-12f94420-b80d-4c2e-bf64-9bdab1799602', {
            promptIncludes: [],
            options: [
                'Resting my hands at your hips, if that feels good',
                'Keeping my hands completely away so you focus on the mouth',
                'Checking with you before holding your hands',
                'Letting you guide my hands or hair, if you want'
            ]
        }],
        ['new-ff0a4ad2-366b-401e-969b-b73121d57864', {
            promptIncludes: [],
            options: [
                'Making eye contact when it feels natural',
                'Closing my eyes fully to sink deeply into the physical sensations',
                'Gently running your hands through my hair, if we both enjoy it',
                'Sharing sounds or words that feel natural'
            ]
        }]
    ]);

    for (const [id, check] of expected) {
        const card = cardsById.get(id);
        const text = card ? [card.prompt, ...(card.options || [])].join(' ') : '';
        if (!card || check.promptIncludes.some(phrase => !card.prompt.includes(phrase))
            || (check.options.length && JSON.stringify(card.options) !== JSON.stringify(check.options))
            || /masturbating aggressively|while you were trying to sleep|aggressively to anchor|restraining your hands|aggressively guide|absolute limit of time|before you lose control/i.test(text)) {
            throw new Error(`explicit card ${id} is missing the safer wording`);
        }
    }
});

Promise.all(pendingChecks).then(() => {
    if (failures > 0) { console.error(`\n${failures} smoke test(s) failed.`); process.exit(1); }
    else { console.log('\nAll smoke tests passed.'); }
});