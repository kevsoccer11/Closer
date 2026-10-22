let masterDatabase = [];
let customUserCards = JSON.parse(localStorage.getItem('closer_custom_cards') || '[]');
let favoriteIds = JSON.parse(localStorage.getItem('closer_favs') || '[]');

let unspentDeck = [];
let currentCard = null;
let activeModule = 'sexuality';
let activeIntensity = 'all';

const CONTEXT_RULES = {
    consent: [
        { label: 'Yes / Into It', class: 'green' },
        { label: 'Maybe / Discuss', class: 'yellow' },
        { label: 'Hard Pass', class: 'red' }
    ],
    action: [
        { label: 'Doing It Now! 🔥', class: 'green' },
        { label: 'Negotiate / Modify', class: 'yellow' },
        { label: 'Pass / Swap', class: 'red' }
    ],
    alignment: [
        { label: '100% Agree', class: 'green' },
        { label: 'Compromise', class: 'yellow' },
        { label: 'Disagree', class: 'red' }
    ],
    story: [
        { label: 'Love Sharing 💬', class: 'green' },
        { label: 'Ask Follow-up ❓', class: 'yellow' },
        { label: 'Skip Topic ⏭️', class: 'red' }
    ]
};

async function initDatabase() {
    console.log("Initializing database...");

    // 1. Fetch live cards from Firebase
    if (typeof window.db !== 'undefined' && window.db) {
        try {
            const snapshot = await window.db.ref('cards').once('value');
            const remoteData = snapshot.val();
            if (remoteData) {
                masterDatabase = Array.isArray(remoteData) ? remoteData.filter(Boolean) : Object.values(remoteData);
                console.log(`Loaded ${masterDatabase.length} cards from Firebase Database`);
            }
        } catch (e) {
            console.warn("Firebase cards read error:", e);
        }
    }

    // 2. Fallback to cards.json or built-in seed deck
    if (!masterDatabase || masterDatabase.length === 0) {
        try {
            const response = await fetch('./cards.json');
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
            const data = await response.json();
            masterDatabase = [...(data.cards || []), ...customUserCards];
            console.log(`Loaded ${masterDatabase.length} cards from local cards.json`);
        } catch (err) {
            console.warn("Local cards.json fetch failed. Injecting fallback deck.", err);
            masterDatabase = [
                { id: 'sec-fb1', module: 'sexuality', category: 'Past History', intensity: 1, prompt: 'What was a moment early in our relationship that made your heart race?', contextType: 'story' },
                { id: 'sec-fb2', module: 'sexuality', category: 'Spicy Dares', intensity: 2, prompt: 'Give your partner a slow 60-second back massage right now.', contextType: 'action' },
                { id: 'life-fb1', module: 'life', category: 'Shared Goals', intensity: 1, prompt: 'What is one trip or experience you want us to plan in the next 12 months?', contextType: 'alignment' },
                { id: 'secret-fb1', module: 'secrets', category: 'Desires', intensity: 3, prompt: 'What is a secret fantasy you have thought about but never spoken out loud?', contextType: 'consent' },
                ...customUserCards
            ];
        }
    }

    rebuildUnspentDeck();
    drawNextCard();
}

function rebuildUnspentDeck() {
    let filtered = masterDatabase.filter(card => {
        const matchesModule = activeModule === 'all' || card.module === activeModule;
        const matchesIntensity = activeModule === 'life' || activeIntensity === 'all' || String(card.intensity) === String(activeIntensity);
        return matchesModule && matchesIntensity;
    });

    for (let i = filtered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
    unspentDeck = filtered;
}

function drawNextCard(isRemoteUpdate = false) {
    if (unspentDeck.length === 0) rebuildUnspentDeck();
    if (unspentDeck.length === 0) return;

    currentCard = unspentDeck.pop();
    renderCard(currentCard);

    if (typeof window.roomRef !== 'undefined' && window.roomRef && !isRemoteUpdate) {
        window.roomRef.child('activeCard').set(currentCard);
    }
}

function renderCard(card) {
    const badge = document.getElementById('cardCategory');
    const prompt = document.getElementById('cardPrompt');
    if (badge) badge.innerText = card.category || 'General';
    if (prompt) prompt.innerText = card.prompt;

    const favBtn = document.getElementById('favCardBtn');
    if (favBtn) favBtn.classList.toggle('active', favoriteIds.includes(card.id));

    const totalInFilter = masterDatabase.filter(c => {
        const matchesModule = activeModule === 'all' || c.module === activeModule;
        const matchesIntensity = activeModule === 'life' || activeIntensity === 'all' || String(c.intensity) === String(activeIntensity);
        return matchesModule && matchesIntensity;
    }).length;

    const counter = document.getElementById('deckCounter');
    if (counter) {
        const drawnCount = totalInFilter - unspentDeck.length;
        counter.innerText = `Card ${drawnCount > 0 ? drawnCount : 1} of ${totalInFilter}`;
    }

    renderResponseControls(card);
}

function renderResponseControls(card) {
    const responseBar = document.getElementById('responseBar');
    if (!responseBar) return;
    responseBar.innerHTML = '';
    const rules = CONTEXT_RULES[card.contextType] || CONTEXT_RULES.alignment;
    rules.forEach(rule => {
        const btn = document.createElement('button');
        btn.className = `response-btn ${rule.class}`;
        btn.innerText = rule.label;
        btn.onclick = (e) => {
            e.stopPropagation();
            drawNextCard();
        };
        responseBar.appendChild(btn);
    });
}

function toggleModal(show) {
    const modal = document.getElementById('customCardModal');
    if (modal) {
        if (show) modal.classList.remove('hidden');
        else modal.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Flip / Draw Next Card
    const cardContainer = document.getElementById('cardContainer');
    if (cardContainer) {
        cardContainer.onclick = () => drawNextCard();
    }

    // 2. Module Navigation Tabs
    document.querySelectorAll('.module-tab').forEach(tab => {
        tab.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.module-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeModule = tab.dataset.module;
            rebuildUnspentDeck();
            drawNextCard();
        };
    });

    // 3. Intensity Filter Buttons
    document.querySelectorAll('.intensity-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.intensity-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeIntensity = btn.dataset.level;
            rebuildUnspentDeck();
            drawNextCard();
        };
    });

    // 4. Custom Card Modal Handlers
    const openBtn = document.getElementById('openAddCardModal');
    if (openBtn) openBtn.onclick = (e) => { e.stopPropagation(); toggleModal(true); };

    const closeBtn = document.getElementById('closeModalBtn');
    if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); toggleModal(false); };

    // 5. Save Custom Card
    const saveBtn = document.getElementById('saveCustomCardBtn');
    if (saveBtn) {
        saveBtn.onclick = async (e) => {
            e.stopPropagation();
            const mod = document.getElementById('customModule').value;
            const cat = document.getElementById('customCategory').value || 'Custom Questions';
            const intensity = parseInt(document.getElementById('customIntensity').value) || 1;
            const promptText = document.getElementById('customPrompt').value.trim();

            if (!promptText) {
                alert("Please enter a question prompt!");
                return;
            }

            const cardId = 'custom-' + Date.now();
            const newCard = {
                id: cardId,
                module: mod,
                category: cat,
                intensity: intensity,
                prompt: promptText,
                contextType: mod === 'secrets' ? 'consent' : (mod === 'sexuality' ? 'action' : 'story')
            };

            if (typeof window.db !== 'undefined' && window.db) {
                try {
                    await window.db.ref('cards/' + cardId).set(newCard);
                    console.log("Card permanently saved to Firebase Database!");
                } catch (err) {
                    console.error("Firebase save failed:", err);
                }
            }

            customUserCards.push(newCard);
            masterDatabase.push(newCard);
            localStorage.setItem('closer_custom_cards', JSON.stringify(customUserCards));

            document.getElementById('customPrompt').value = '';
            toggleModal(false);

            activeModule = mod;
            document.querySelectorAll('.module-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.module === mod);
            });

            rebuildUnspentDeck();
            drawNextCard();
        };
    }

    // 6. Shuffle All Button
    const shuffleBtn = document.getElementById('shuffleAllBtn');
    if (shuffleBtn) {
        shuffleBtn.onclick = (e) => {
            e.stopPropagation();
            rebuildUnspentDeck();
            drawNextCard();
        };
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    initDatabase();
});