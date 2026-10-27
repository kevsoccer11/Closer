// Bind event listeners safely on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    // Basic focus trapping for open dialogs/drawers.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const dialog = document.querySelector('.modal-overlay:not(.hidden) .modal-card, .drawer.open, .drawer:not(.hidden)');
        if (!dialog) return;
        const focusables = Array.from(dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter(el => !el.disabled && el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
    document.addEventListener('visibilitychange', () => {
        document.body.classList.toggle('app-blurred', document.hidden);
    });
    const cardContainer = document.getElementById('cardContainer');
    if (cardContainer) {
        cardContainer.addEventListener('click', () => {
            if (tapToAdvance) advanceCard(false);
        });
        cardContainer.style.cursor = tapToAdvance ? 'pointer' : 'default';
    }
    // Apply saved theme (default to light).
    if (localStorage.getItem('closer_theme') !== 'dark') document.body.classList.add('light-theme');
    const offlineBanner = document.getElementById('offlineBanner');
    const updateOffline = () => {
        if (!offlineBanner) return;
        offlineBanner.classList.toggle('hidden', navigator.onLine);
    };
    window.addEventListener('online', updateOffline);
    window.addEventListener('offline', updateOffline);
    deckOptionsElement = document.getElementById('deckOptions');
    partnerCardsSectionElement = document.getElementById('partnerCardsSection');
    partnerCardsListElement = document.getElementById('partnerCardsList');
    // 1. Advance cards with the explicit controls to avoid accidental skips.
    const nextCardBtn = document.getElementById('nextCardBtn');
    if (nextCardBtn) {
        nextCardBtn.onclick = () => advanceCard(false);
    }
    document.getElementById('passCardBtn')?.addEventListener('click', () => advanceCard(true));
    document.getElementById('undoBtn')?.addEventListener('click', undoCard);
    const startQuickGameBtn = document.getElementById('startQuickGameBtn');
    if (startQuickGameBtn) {
        startQuickGameBtn.onclick = () => {
            startQuickGame();
        };
    }
    document.querySelectorAll('.round-pack-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.pack) {
                applyPack(btn.dataset.pack);
                closeRoundBuilder();
            }
        });
    });
    document.querySelectorAll('#packFilterChips .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#packFilterChips .filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const filter = chip.dataset.filter;
            document.querySelectorAll('.pack-card').forEach(card => {
                const show = filter === 'all' || card.dataset.filter === filter;
                card.style.display = show ? '' : 'none';
            });
        });
    });
    document.querySelectorAll('.pack-card').forEach(btn => {
        btn.addEventListener('click', () => {
            applyPack(btn.dataset.pack);
        });
    });
    document.getElementById('warmUpNextBtn')?.addEventListener('click', () => {
        if (!warmUpEnabled || Number(activeIntensity) >= 4) return;
        if (!canCurrentUserAdvanceCard()) {
            setCardActionStatus(`It is ${getPlayerIdentifier(activeTurn)}'s turn to advance.`);
            return;
        }
        activeIntensity = String(Number(activeIntensity) + 1);
        document.querySelectorAll('.intensity-btn').forEach(button => {
            const selected = button.dataset.level === activeIntensity;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        updateRoundSummary();
        rebuildUnspentDeck();
        drawNextCard();
    });

    document.getElementById('roundSummaryBtn')?.addEventListener('click', openRoundBuilder);
    document.getElementById('createRoundFromSettingsBtn')?.addEventListener('click', openRoundBuilder);
    const createDeckBtn = document.getElementById('createDeckBtn');
    if (createDeckBtn) {
        createDeckBtn.onclick = () => {
            const name = prompt('Deck name:');
            if (!name || !name.trim()) return;
            const deck = { id: `deck-${Date.now()}`, name: name.trim(), cardIds: [] };
            customDecks.push(deck);
            localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
            renderMyDecks();
        };
    }
    const addCurrentCardToDeckBtn = document.getElementById('addCurrentCardToDeckBtn');
    if (addCurrentCardToDeckBtn) {
        addCurrentCardToDeckBtn.onclick = () => {
            if (!currentCard) return;
            if (customDecks.length === 0) {
                showToast('Create a deck first.');
                return;
            }
            const names = customDecks.map(d => d.name).join(', ');
            const chosen = prompt(`Add to which deck? (${names})`);
            const deck = customDecks.find(d => d.name.toLowerCase() === (chosen || '').trim().toLowerCase());
            if (!deck) { showToast('Deck not found.'); return; }
            if (!deck.cardIds.includes(currentCard.id)) {
                deck.cardIds.push(currentCard.id);
                localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
                showToast(`Added to ${deck.name}.`);
            } else {
                showToast('Already in deck.');
            }
            renderMyDecks();
        };
    document.querySelectorAll('.bottom-nav button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.action === 'home') showHomeView();
            if (btn.dataset.action === 'packs') openRoundBuilder();
            if (btn.dataset.action === 'play') {
                if (localStorage.getItem('closer_unspent_deck')) {
                    const savedDeck = JSON.parse(localStorage.getItem('closer_unspent_deck'));
                    const savedCard = JSON.parse(localStorage.getItem('closer_current_card'));
                    if (savedDeck && savedCard) { unspentDeck = savedDeck; currentCard = savedCard; renderCard(currentCard); showGameView(); }
                } else {
                    openRoundBuilder();
                }
            }
            if (btn.dataset.action === 'favorites') {
                const favBtn = document.querySelector('#favsDrawerBtn');
                if (favBtn) favBtn.click();
            }
        });
    });
    document.getElementById('manageDecksBtn')?.addEventListener('click', () => {
        const toolsBtn = document.getElementById('toolsDrawerBtn');
        if (toolsBtn) toolsBtn.click();
    });
    document.getElementById('homePairBtn')?.addEventListener('click', () => {
        const toolsBtn = document.getElementById('toolsDrawerBtn');
        if (toolsBtn) toolsBtn.click();
    });
    const continueGameBtn = document.getElementById('continueGameBtn');
    if (continueGameBtn) {
        continueGameBtn.onclick = () => {
            try {
                const savedDeck = JSON.parse(localStorage.getItem('closer_unspent_deck') || 'null');
                const savedCard = JSON.parse(localStorage.getItem('closer_current_card') || 'null');
                if (Array.isArray(savedDeck) && savedCard && savedCard.id) {
                    unspentDeck = savedDeck;
                    currentCard = savedCard;
                    // restore filters if saved
                    try {
                        const f = JSON.parse(localStorage.getItem('closer_round_filters') || 'null');
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
        };
    }
    document.querySelectorAll('.discovery-card').forEach(btn => {
        btn.addEventListener('click', () => {
            const mood = btn.dataset.mood;
            const map = { playful: 'playful', romantic: 'aftercare', deep: 'deep-talk', intimate: 'kinky-explorative' };
            if (map[mood]) startPackByKey(map[mood]);
        });
    });
    document.getElementById('exploreAllBtn')?.addEventListener('click', () => openRoundBuilder());
    document.querySelectorAll('.desktop-sidebar button[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.action === 'packs') openRoundBuilder();
            if (btn.dataset.action === 'favorites') {
                const favBtn = document.querySelector('#favoritesBtn, .favorites-btn');
                if (favBtn) favBtn.click();
                else openDrawer('Favorites', '');
            }
            if (btn.dataset.action === 'settings') {
                const toolsBtn = document.getElementById('toolsDrawerBtn');
                if (toolsBtn) toolsBtn.click();
            }
        });
    });
    }
    const exitDeckModeBtn = document.getElementById('exitDeckModeBtn');
    if (exitDeckModeBtn) {
        exitDeckModeBtn.onclick = () => {
            activeDeckId = null;
            localStorage.removeItem('closer_active_deck');
            rebuildUnspentDeck();
            drawNextCard();
            renderMyDecks();
        };
    }

    const browseBtn = document.getElementById('browseModeBtn');
    if (browseBtn) {
        const updateBrowseLabel = () => {
            browseBtn.textContent = `Browse mode: ${browseMode ? 'On' : 'Off'}`;
            browseBtn.classList.toggle('active', browseMode);
        };
        browseBtn.onclick = () => {
            browseMode = !browseMode;
            updateBrowseLabel();
            const turnIndicator = document.getElementById('turnIndicator');
            if (turnIndicator) {
                turnIndicator.classList.toggle('hidden', browseMode);
            }
        };
        updateBrowseLabel();
    }
    document.getElementById('resetPlayHistoryBtn')?.addEventListener('click', () => {
        playedCardIds.clear();
        localStorage.removeItem('closer_played_cards');
        if (window.roomRef) window.roomRef.child('playedCards').remove().catch(() => {});
        rebuildUnspentDeck();
        drawNextCard();
        setPairStatus('Play history cleared.');
    });
    document.getElementById('wildUnspokenBtn')?.addEventListener('click', () => {
        if (activeGameMode === 'compare-first') exitCompareFirstMode();
        selectModule('secrets');
    });
    document.getElementById('closeRoundBuilderBtn')?.addEventListener('click', closeRoundBuilder);
    document.getElementById('roundBuilderModal')?.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeRoundBuilder();
            document.getElementById('roundSummaryBtn')?.focus();
        }
    });
    document.getElementById('roundBuilderModal')?.addEventListener('click', event => {
        if (event.target === event.currentTarget) closeRoundBuilder();
    });
    document.getElementById('selectAllTopicsBtn')?.addEventListener('click', () => {
        document.querySelectorAll('#roundTopics input[type="checkbox"]').forEach(input => { input.checked = true; });
        updateRoundMatchCount();
    });
    document.getElementById('clearTopicsBtn')?.addEventListener('click', () => {
        document.querySelectorAll('#roundTopics input[type="checkbox"]').forEach(input => { input.checked = false; });
        updateRoundMatchCount();
    });
    document.getElementById('roundBuilderModal')?.addEventListener('change', event => {
        const target = event.target;
        if (target.matches('input[name="roundDeck"]')) {
            if (target.value === 'explicit' && target.checked && !hasExplicitAgeConfirmation()) {
                target.checked = false;
                document.getElementById('explicitAgeGate')?.classList.remove('hidden');
                return;
            }
            activeTopics = null;
            renderRoundTopics();
        } else if (target.matches('#roundTopics input[type="checkbox"], input[name="roundIntensity"], #includeQuestions, #includeActivities, #includeMultipleChoice')) {
            updateRoundMatchCount();
        }
    });
    document.getElementById('settingsIncludeMultipleChoice')?.addEventListener('change', event => {
        includeMultipleChoice = event.currentTarget.checked;
        const builderToggle = document.getElementById('includeMultipleChoice');
        if (builderToggle) builderToggle.checked = includeMultipleChoice;
        warmUpEnabled = false;
        updateRoundSummary();
        rebuildUnspentDeck();
        drawNextCard();
    });
    document.getElementById('startRoundBtn')?.addEventListener('click', () => {
        applyRoundSelection(getRoundBuilderSelection());
    });
    document.getElementById('startLightRoundBtn')?.addEventListener('click', () => {
        applyRoundSelection(getRoundBuilderSelection(), true);
    });

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
            const choices = [0, 1, 2];
            const selected = choices[Math.floor(Math.random() * choices.length)];
            activeTurn = selected === 1 ? 1 : 0;
            pickedAnswererIndex = selected === 2 ? null : selected;
            pickedAnswerer = selected === 2 ? 'both' : 'selected';
            const result = document.getElementById('turnPickerResult');
            const answererLabel = selected === 2 ? 'Both answer' : `${getPlayerIdentifier(activeTurn)} answers first`;
            if (result) result.textContent = answererLabel;
            const indicator = document.getElementById('turnIndicator');
            if (indicator) {
                indicator.textContent = answererLabel;
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
            if (turnTakingEnabled && turnIndicator) turnIndicator.textContent = `${getPlayerIdentifier(0)} answers`;
        };
    }

    // 2. Favorite Toggle Button on Main Card
    const favCardBtn = document.getElementById('favCardBtn');
    if (favCardBtn) {
        favCardBtn.onclick = (e) => {
            e.stopPropagation();
            if (!currentCard) return;
            let menu = document.getElementById('saveMenu');
            if (menu) { menu.remove(); return; }
            menu = document.createElement('div');
            menu.id = 'saveMenu';
            menu.style.cssText = 'position:fixed;z-index:9999;background:rgba(22,22,29,0.98);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
            const close = () => menu.remove();
            const title = document.createElement('strong');
            title.textContent = 'Save to…';
            title.style.cssText = 'font-size:0.85rem;color:#f8fafc;';
            menu.appendChild(title);
            const makeCheck = (label, checked = false) => {
                const wrap = document.createElement('label');
                wrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:0.85rem;color:#f8fafc;cursor:pointer;';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = checked;
                cb.style.cssText = 'width:16px;height:16px;accent-color:#f43f5e;';
                wrap.appendChild(cb);
                wrap.appendChild(document.createTextNode(label));
                return { wrap, cb };
            };
            const favCheck = makeCheck('Favorites', favoriteIds.includes(currentCard.id));
            menu.appendChild(favCheck.wrap);
            const deckChecks = [];
            if (customDecks.length === 0) {
                const note = document.createElement('p');
                note.textContent = 'No custom decks yet (create in Profile).';
                note.style.cssText = 'font-size:0.75rem;color:#94a3b8;margin:0;';
                menu.appendChild(note);
            } else {
                customDecks.forEach(deck => {
                    const dc = makeCheck(deck.name, deck.cardIds.includes(currentCard.id));
                    deckChecks.push({ deck, cb: dc.cb });
                    menu.appendChild(dc.wrap);
                });
            }
            let sharedCheck = null;
            if (window.roomRef) {
                sharedCheck = makeCheck('Shared deck', false);
                menu.appendChild(sharedCheck.wrap);
            }
            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.textContent = 'Save';
            saveBtn.style.cssText = 'background:#f43f5e;border:none;color:#fff;padding:8px 10px;border-radius:8px;cursor:pointer;font-weight:700;margin-top:4px;';
            saveBtn.onclick = async (ev) => {
                ev.stopPropagation();
                // Favorites
                if (favCheck.cb.checked) {
                    if (!favoriteIds.includes(currentCard.id)) {
                        favoriteIds.push(currentCard.id);
                        localStorage.setItem('closer_favs', JSON.stringify(favoriteIds));
                        favCardBtn.classList.add('active');
                        favCardBtn.setAttribute('aria-pressed', 'true');
                    }
                } else {
                    const idx = favoriteIds.indexOf(currentCard.id);
                    if (idx > -1) {
                        favoriteIds.splice(idx, 1);
                        localStorage.setItem('closer_favs', JSON.stringify(favoriteIds));
                        favCardBtn.classList.remove('active');
                        favCardBtn.setAttribute('aria-pressed', 'false');
                    }
                }
                // Custom decks
                deckChecks.forEach(({ deck, cb }) => {
                    if (cb.checked) {
                        if (!deck.cardIds.includes(currentCard.id)) {
                            deck.cardIds.push(currentCard.id);
                        }
                    } else {
                        const idx = deck.cardIds.indexOf(currentCard.id);
                        if (idx > -1) deck.cardIds.splice(idx, 1);
                    }
                });
                localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
                // Shared deck
                if (sharedCheck && sharedCheck.cb.checked && window.roomRef) {
                    try {
                        await window.roomRef.child(`sharedDeck/${currentCard.id}`).set({ card: currentCard, addedBy: window.firebase?.auth().currentUser?.uid });
                        showToast('Saved.');
                        renderSharedDeck();
                    } catch (e) { showToast('Shared deck failed.'); }
                }
                showToast('Saved.');
                close();
            };
            menu.appendChild(saveBtn);
            const rect = favCardBtn.getBoundingClientRect();
            const menuWidth = 240;
            const left = Math.min(rect.left, window.innerWidth - menuWidth - 8);
            menu.style.top = `${rect.bottom + 6}px`;
            menu.style.left = `${Math.max(8, left)}px`;
            menu.style.width = `${Math.min(menuWidth, window.innerWidth - 16)}px`;
            document.body.appendChild(menu);
            setTimeout(() => {
                const closer = (ev) => {
                    if (!menu.contains(ev.target)) { close(); document.removeEventListener('click', closer); }
                };
                document.addEventListener('click', closer);
            }, 0);
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
                <p id="lastSynced" class="pair-status" aria-live="polite"></p>
                <div id="pairManagementContainer"></div>
                <div class="shared-deck-section">
                    <h4>Shared deck</h4>
                    <button id="addCurrentToSharedDeckBtn" class="btn-secondary" type="button">Add current card to shared deck</button>
                    <div id="sharedDeckList" class="partner-cards-list"></div>
                </div>
            `;
            openDrawer('Pair Partner', html);
const addSharedBtn = document.getElementById('addCurrentToSharedDeckBtn');
    if (addSharedBtn) {
        addSharedBtn.onclick = async () => {
            if (!currentCard || !window.roomRef) return;
            try {
                await window.roomRef.child(`sharedDeck/${currentCard.id}`).set({ card: currentCard, addedBy: window.firebase?.auth().currentUser?.uid });
                showToast('Added to shared deck.');
                renderSharedDeck();
            } catch (e) {
                showToast('Could not add card.');
            }
        };
    }
    renderSharedDeck();
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
                <div class="deck-section" id="myDecksSection">
                    <h4>My decks</h4>
                    <div class="deck-actions">
                        <button class="btn-secondary" id="createDeckBtn" type="button">Create deck</button>
                        <button class="btn-secondary" id="addCurrentCardToDeckBtn" type="button">Add current card</button>
                        <button class="btn-secondary" id="exitDeckModeBtn" type="button">Exit deck mode</button>
                    </div>
                    <div id="myDecksList"></div>
                </div>
                <div class="shared-deck-section">
                    <h4>Shared deck</h4>
                    <button id="addCurrentToSharedDeckBtn" class="btn-secondary" type="button">Add current card to shared deck</button>
                    <div id="sharedDeckList" class="partner-cards-list"></div>
                </div>
            `;
            openDrawer('Profile Stats', html);
            const content = document.getElementById('drawerContent');
renderMyDecks();
    const createDeckBtn = document.getElementById('createDeckBtn');
    if (createDeckBtn) {
        createDeckBtn.onclick = () => {
            const name = prompt('Deck name:');
            if (!name || !name.trim()) return;
            const deck = { id: `deck-${Date.now()}`, name: name.trim(), cardIds: [] };
            customDecks.push(deck);
            localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
            renderMyDecks();
        };
    }
    const addCurrentCardToDeckBtn = document.getElementById('addCurrentCardToDeckBtn');
    if (addCurrentCardToDeckBtn) {
        addCurrentCardToDeckBtn.onclick = () => {
            if (!currentCard) return;
            if (customDecks.length === 0) { showToast('Create a deck first.'); return; }
            const names = customDecks.map(d => d.name).join(', ');
            const chosen = prompt(`Add to which deck? (${names})`);
            const deck = customDecks.find(d => d.name.toLowerCase() === (chosen || '').trim().toLowerCase());
            if (!deck) { showToast('Deck not found.'); return; }
            if (!deck.cardIds.includes(currentCard.id)) {
                deck.cardIds.push(currentCard.id);
                localStorage.setItem('closer_custom_decks', JSON.stringify(customDecks));
                showToast(`Added to ${deck.name}.`);
            } else {
const addSharedBtn = document.getElementById('addCurrentToSharedDeckBtn');
    if (addSharedBtn) {
        addSharedBtn.onclick = async () => {
            if (!currentCard || !window.roomRef) {
                showToast('Pair with a partner to use the shared deck.');
                return;
            }
            try {
                await window.roomRef.child(`sharedDeck/${currentCard.id}`).set({ card: currentCard, addedBy: window.firebase?.auth().currentUser?.uid });
                showToast('Added to shared deck.');
                renderSharedDeck();
            } catch (e) {
                showToast('Could not add card.');
            }
        };
    }
    renderSharedDeck();
                showToast('Already in deck.');
            }
            renderMyDecks();
        };
    }
    const exitDeckModeBtn = document.getElementById('exitDeckModeBtn');
    if (exitDeckModeBtn) {
        exitDeckModeBtn.onclick = () => {
            activeDeckId = null;
            localStorage.removeItem('closer_active_deck');
            rebuildUnspentDeck();
            drawNextCard();
            renderMyDecks();
        };
    }
            const paired = Boolean(window.currentRoomRole);
            const ownIndex = window.currentRoomRole === 'partner' ? 1 : 0;
            const identityForm = document.createElement('form');
            identityForm.className = 'player-identity-form';
            identityForm.innerHTML = `
                <h4>Player identifiers</h4>
                <label for="playerOneName">${paired ? 'Host name' : 'Player 1 name'}</label>
                <input id="playerOneName" type="text" maxlength="24" autocomplete="nickname">
                <label for="playerOneIcon">${paired ? 'Host icon' : 'Player 1 icon'}</label>
                <select id="playerOneIcon">${PLAYER_ICONS.map(icon => `<option value="${icon}">${icon}</option>`).join('')}</select>
                <label for="playerTwoName">${paired ? 'Partner name' : 'Player 2 name'}</label>
                <input id="playerTwoName" type="text" maxlength="24" autocomplete="nickname">
                <label for="playerTwoIcon">${paired ? 'Partner icon' : 'Player 2 icon'}</label>
                <select id="playerTwoIcon">${PLAYER_ICONS.map(icon => `<option value="${icon}">${icon}</option>`).join('')}</select>
                <p class="publish-note">${paired ? 'Your name and icon sync to your partner. Only you can change your own identifier.' : 'Names and icons stay on this device. In a paired room, each person sets their own identifier.'}</p>
                <button class="btn-primary" type="submit">Save identifiers</button>
                <p id="playerIdentityStatus" class="publish-status" role="status" aria-live="polite"></p>
            `;
            for (const [index, role] of ['host', 'partner'].entries()) {
                const inputSuffix = index === 0 ? 'One' : 'Two';
                const nameInput = identityForm.querySelector(`#player${inputSuffix}Name`);
                const iconSelect = identityForm.querySelector(`#player${inputSuffix}Icon`);
                const identity = paired ? roomDisplayNames[role] || playerNames[role] : playerNames[role];
                nameInput.value = identity.name;
                iconSelect.value = identity.icon;
                if (paired && index !== ownIndex) {
                    nameInput.disabled = true;
                    iconSelect.disabled = true;
                }
            }
            identityForm.onsubmit = event => {
                event.preventDefault();
                const status = identityForm.querySelector('#playerIdentityStatus');
                if (paired) {
                    const index = ownIndex + 1;
                    savePlayerIdentity(ownIndex, identityForm.querySelector(`#player${index}Name`).value, identityForm.querySelector(`#player${index}Icon`).value);
                } else {
                    savePlayerIdentity(0, identityForm.querySelector('#playerOneName').value, identityForm.querySelector('#playerOneIcon').value);
                    savePlayerIdentity(1, identityForm.querySelector('#playerTwoName').value, identityForm.querySelector('#playerTwoIcon').value);
                }
                if (status) status.textContent = 'Identifiers saved.';
                setTimeout(() => closeDrawer(), 600);
            };
            content.appendChild(identityForm);
        };
    }

const tapBtn = document.getElementById('settingsTapToAdvanceBtn');
    if (tapBtn) {
        tapBtn.textContent = `Tap card to advance: ${tapToAdvance ? 'On' : 'Off'}`;
        tapBtn.onclick = () => {
            tapToAdvance = !tapToAdvance;
            localStorage.setItem('closer_tap_to_advance', String(tapToAdvance));
            tapBtn.textContent = `Tap card to advance: ${tapToAdvance ? 'On' : 'Off'}`;
            const cc = document.getElementById('cardContainer');
            if (cc) cc.style.cursor = tapToAdvance ? 'pointer' : 'default';
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
                <details class="settings-tree-group">
                    <summary>Players &amp; partner</summary>
                    <div class="settings-tree-content">
                        <button class="settings-link" id="settingsProfileBtn" type="button">Names and icons</button>
                        <button class="settings-link" id="settingsPartnerBtn" type="button">Connect another device</button>
                    </div>
                </details>
                <details class="settings-tree-group">
                    <summary>Privacy &amp; comfort</summary>
                    <div class="settings-tree-content">
                        <p class="settings-help-copy">You can pass any card without explaining. Explicit cards stay on this device and are not synced to your partner. Saved entries and favorites are stored in this browser.</p>
                        <button id="resetAppBtn" class="btn-secondary reset-local-data-btn" type="button">Clear local app data</button>
                    </div>
                </details>
document.querySelectorAll('.pillar-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.pillar-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.pillar-btn').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            activePillar = btn.dataset.pillar;
            rebuildUnspentDeck();
            drawNextCard();
        };
    });
                <details class="settings-tree-group" open>
                    <summary>Appearance & accessibility</summary>
                    <div class="settings-tree-content">
                        <label class="toggle-switch">Theme (light) <input type="checkbox" id="settingsThemeToggle"></label>
                        <label class="toggle-switch">Large text <input type="checkbox" id="settingsLargeTextToggle"></label>
                        <label class="toggle-switch">Dyslexia font <input type="checkbox" id="settingsDyslexiaToggle"></label>
                        <label class="toggle-switch">Color-blind safe <input type="checkbox" id="settingsColorBlindToggle"></label>
                        <label class="toggle-switch">High contrast <input type="checkbox" id="settingsHighContrastToggle"></label>
                        <label class="toggle-switch">Tap card to advance <input type="checkbox" id="settingsTapToAdvanceToggle"></label>
                    </div>
                </details>
                <details class="settings-tree-group">
                    <summary>Help &amp; about</summary>
                    <div class="settings-tree-content">
                        <p class="settings-help-copy">Take turns, answer together, or simply talk through a question. There is no timer or required answer in a relaxed round.</p>
                        <p class="settings-help-copy">Deck includes ${masterDatabase.length.toLocaleString()} available cards on this device.</p>
                        <button class="settings-link" id="settingsFavoritesBtn" type="button">Saved questions</button>
                        <button class="settings-link" id="settingsJournalBtn" type="button">Date night journal</button>
                        <button class="settings-link" id="settingsShortcutsBtn" type="button">Keyboard shortcuts</button>
                    </div>
                </details>
            `;
            openDrawer('Settings', html);
            const content = document.getElementById('drawerContent');
            if (deckOptionsElement) {
                deckOptionsElement.classList.remove('hidden');
                deckOptionsElement.open = true;
                content.prepend(deckOptionsElement);
renderMyDecks();
            }
            if (partnerCardsSectionElement) {
                content.appendChild(partnerCardsSectionElement);
                renderPartnerCards();
            }

            const openHeaderPanel = (sourceId) => {
                closeDrawer();
                document.getElementById(sourceId)?.click();
            };
            document.getElementById('settingsProfileBtn').onclick = () => openHeaderPanel('userProfileBtn');
            document.getElementById('settingsPartnerBtn').onclick = () => openHeaderPanel('pairPartnerBtn');
const applyAccessibility = () => {
        document.body.classList.toggle('large-text', localStorage.getItem('closer_large_text') === 'true');
        document.body.classList.toggle('dyslexia-font', localStorage.getItem('closer_dyslexia_font') === 'true');
        document.body.classList.toggle('colorblind-safe', localStorage.getItem('closer_colorblind_safe') === 'true');
        document.body.classList.toggle('high-contrast', localStorage.getItem('closer_high_contrast') === 'true');
    };
    applyAccessibility();
    const applyTheme = () => {
        const light = localStorage.getItem('closer_theme') !== 'dark';
        document.body.classList.toggle('light-theme', light);
    };
    applyTheme();
    const bindToggle = (id, key, onChange) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked = localStorage.getItem(key) === 'true';
        el.onchange = () => {
            localStorage.setItem(key, String(el.checked));
            if (onChange) onChange(el.checked);
            applyAccessibility();
            applyTheme();
        };
    };
    bindToggle('settingsLargeTextToggle', 'closer_large_text');
    bindToggle('settingsDyslexiaToggle', 'closer_dyslexia_font');
    bindToggle('settingsColorBlindToggle', 'closer_colorblind_safe');
    bindToggle('settingsHighContrastToggle', 'closer_high_contrast');
    const themeToggle = document.getElementById('settingsThemeToggle');
    if (themeToggle) {
        themeToggle.checked = localStorage.getItem('closer_theme') !== 'dark';
        themeToggle.onchange = () => {
            localStorage.setItem('closer_theme', themeToggle.checked ? 'light' : 'dark');
            applyTheme();
        };
    }
    const tapToggle = document.getElementById('settingsTapToAdvanceToggle');
    if (tapToggle) {
        tapToggle.checked = localStorage.getItem('closer_tap_to_advance') === 'true';
        tapToggle.onchange = () => {
            tapToAdvance = tapToggle.checked;
            localStorage.setItem('closer_tap_to_advance', String(tapToAdvance));
            const cc = document.getElementById('cardContainer');
            if (cc) cc.style.cursor = tapToAdvance ? 'pointer' : 'default';
        };
    }
document.getElementById('settingsFavoritesBtn').onclick = () => openHeaderPanel('favsDrawerBtn');
document.getElementById('settingsShortcutsBtn').onclick = () => openDrawer('Keyboard shortcuts', `<div class="drawer-item"><p><strong>Space/Enter:</strong> Next question</p><p><strong>P:</strong> Pass for now</p><p><strong>F:</strong> Favorite</p><p><strong>Esc:</strong> Quick hide Wild & Unspoken</p></div>`);
            document.getElementById('settingsJournalBtn').onclick = () => openHeaderPanel('journalDrawerBtn');

            const resetBtn = document.getElementById('resetAppBtn');
            if (resetBtn) {
                resetBtn.onclick = () => {
                    if (confirm("This clears saved questions, favorites, names and icons, journal entries, private entries, and room details from this browser. Continue?")) {
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

    document.getElementById('confirmExplicitAccessBtn')?.addEventListener('click', async () => {
        localStorage.setItem(EXPLICIT_AGE_CONFIRMATION_KEY, 'true');
        await loadExplicitCards();
        document.getElementById('explicitAgeGate')?.classList.add('hidden');
        const deckCheckbox = document.querySelector('input[name="roundDeck"][value="explicit"]');
        if (deckCheckbox && !document.getElementById('roundBuilderModal')?.classList.contains('hidden')) {
            deckCheckbox.checked = true;
            activeTopics = null;
            renderRoundTopics();
            return;
        }
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
            warmUpEnabled = false;
            if (activeGameMode === 'deep' && activeIntensity !== 'all' && activeIntensity !== '3') {
                activeGameMode = 'classic';
                document.getElementById('gameModeSelect').value = activeGameMode;
                renderModeTimer();
            }
            rebuildUnspentDeck();
            drawNextCard();
        };
    });

    // 10b. Mood Filters
    document.querySelectorAll('.mood-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.mood-btn').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            activeMood = btn.dataset.mood;
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
            warmUpEnabled = false;
            updateRoundSummary();
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

    // Keyboard shortcuts for quick play.
    document.addEventListener('keydown', (event) => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.querySelector('.modal-overlay:not(.hidden), .drawer:not(.hidden)')) return;
        if (event.code === 'Space' || event.code === 'Enter') {
            event.preventDefault();
            advanceCard(false);
        } else if (event.key.toLowerCase() === 'p') {
            advanceCard(true);
        } else if (event.key.toLowerCase() === 'f') {
            document.getElementById('favCardBtn')?.click();
        }
    });
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
    if (!localStorage.getItem('closer_onboarded')) {
        localStorage.setItem('closer_onboarded', 'true');
        setTimeout(() => {
            openDrawer('Welcome to Closer', `<div class="drawer-item"><p><strong>Create a round</strong> to choose decks, topics, and intensity.</p><p><strong>Turn-taking</strong> shows whose turn it is; pass anytime if it is your turn.</p><p><strong>Wild & Unspoken</strong> is a private space for secrets and fantasies.</p><p><strong>Settings</strong> holds filters, players, and privacy options.</p></div>`);
        }, 600);
    }
            toggleShareKeyBtn.textContent = isVisible ? 'Show key' : 'Hide key';
            toggleShareKeyBtn.setAttribute('aria-pressed', String(!isVisible));
        };
    }

    // QR code for key sharing.
    const showQrKeyBtn = document.getElementById('showQrKeyBtn');
    const qrContainer = document.getElementById('qrKeyContainer');
    if (showQrKeyBtn && qrContainer) {
        showQrKeyBtn.onclick = () => {
            if (!privateShareKey) {
                setPrivateShareStatus('Generate or enter a key first.');
                return;
            }
            qrContainer.classList.toggle('hidden');
            if (!qrContainer.classList.contains('hidden')) {
                qrContainer.replaceChildren();
                if (typeof QRCode !== 'undefined') {
                    new QRCode(qrContainer, { text: privateShareKey, width: 160, height: 160 });
                } else {
                    qrContainer.textContent = privateShareKey;
                }
            }
        };
    }

    // Key fingerprint.
    const updateFingerprint = async () => {
        const el = document.getElementById('keyFingerprint');
        if (!el) return;
        if (!privateShareKey) { el.textContent = ''; return; }
        try {
            const data = new TextEncoder().encode(privateShareKey);
            const hash = await crypto.subtle.digest('SHA-256', data);
            const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
            el.textContent = `Key fingerprint: ${hex.slice(0, 4).toUpperCase()} ${hex.slice(4, 8).toUpperCase()} ${hex.slice(8, 12).toUpperCase()} ${hex.slice(12, 16).toUpperCase()}`;
        } catch (e) {
            el.textContent = '';
        }
    };
    const origApply = applyPrivateShareKey;
    window.applyPrivateShareKey = async (key) => {
        await origApply(key);
        updateFingerprint();
    };
    updateFingerprint();

    // Remember key on this device.
    const rememberKey = document.getElementById('rememberKey');
    if (rememberKey) {
        rememberKey.checked = localStorage.getItem('closer_remember_key') === 'true';
        rememberKey.onchange = () => {
            localStorage.setItem('closer_remember_key', String(rememberKey.checked));
            if (rememberKey.checked && privateShareKey) {
                localStorage.setItem('closer_private_share_key_persisted', privateShareKey);
            } else {
                localStorage.removeItem('closer_private_share_key_persisted');
            }
        };
    }
    if (localStorage.getItem('closer_remember_key') === 'true') {
        const saved = localStorage.getItem('closer_private_share_key_persisted');
        if (saved && !privateShareKey) {
            privateShareKeyInput.value = saved;
            applyPrivateShareKey(saved);
        }
    }


    const privateRevealForm = document.getElementById('privateRevealForm');
    if (privateRevealForm) {
        const saveEntry = (draft = false) => {
            const textInput = document.getElementById('privateRevealText');
            const text = textInput.value.trim();
            if (!draft && !text) {
                document.getElementById('privateRevealStatus').textContent = 'Write an entry before saving.';
                return;
            }
            const consent = document.getElementById('privateRevealConsent');
            if (!draft && consent && !consent.checked) {
                document.getElementById('privateRevealStatus').textContent = 'Please confirm consent before saving.';
                return;
            }
            const tags = (document.getElementById('privateRevealTags')?.value || '')
                .split(',').map(t => t.trim()).filter(Boolean);
            const expiryDays = Number(document.getElementById('privateRevealExpiry')?.value || 0);
            const expiresAt = expiryDays > 0
                ? new Date(Date.now() + expiryDays * 86400000).toISOString()
                : null;
            const entry = {
                id: `reveal-${Date.now()}`,
                type: document.getElementById('privateRevealType').value,
                text,
                tags,
                draft: Boolean(draft),
                expiresAt,
                revealed: false,
                createdAt: new Date().toISOString()
            };
            privateRevealEntries.unshift(entry);
            localStorage.setItem('closer_private_reveals', JSON.stringify(privateRevealEntries));
            if (!draft) textInput.value = '';
            document.getElementById('privateRevealTags').value = '';
            if (consent) consent.checked = false;
            document.getElementById('privateRevealStatus').textContent = draft
                ? 'Draft saved on this device.'
                : 'Saved privately on this device. Reveal it whenever you are ready.';
            renderWildRevealEntries();
        };
        privateRevealForm.onsubmit = event => {
            event.preventDefault();
            saveEntry(false);
        };
        document.getElementById('saveDraftBtn')?.addEventListener('click', () => saveEntry(true));
    }

    // Search + quick hide.
    // Backup export/import.
    const exportBtn = document.getElementById('exportBackupBtn');
    if (exportBtn) {
        exportBtn.onclick = () => {
            const backup = { version: 1, exportedAt: new Date().toISOString(), entries: privateRevealEntries };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'closer-wild-unspoken-backup.json';
            a.click();
            URL.revokeObjectURL(url);
            showToast('Backup downloaded.');
        };
    }
    const importBtn = document.getElementById('importBackupBtn');
    const importInput = document.getElementById('importBackupInput');
    if (importBtn && importInput) {
        importBtn.onclick = () => importInput.click();
        importInput.onchange = async () => {
            const file = importInput.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (Array.isArray(data.entries)) {
                    privateRevealEntries = data.entries;
                    localStorage.setItem('closer_private_reveals', JSON.stringify(privateRevealEntries));
                    renderWildRevealEntries();
                    showToast('Backup imported.');
                }
            } catch (e) {
                showToast('Import failed.');
            }
            importInput.value = '';
        };
    }


    document.getElementById('privateRevealSearch')?.addEventListener('input', renderWildRevealEntries);
    document.getElementById('privateRevealTagFilter')?.addEventListener('change', renderWildRevealEntries);
    const quickHideBtn = document.getElementById('quickHideBtn');
    if (quickHideBtn) {
        quickHideBtn.onclick = () => {
            document.getElementById('wildUnspokenPanel')?.classList.add('hidden');
            showToast('Wild & Unspoken hidden.');
        };
    }
    // Blur-on-blur deterrent.
    document.addEventListener('visibilitychange', () => {
        const panel = document.getElementById('wildUnspokenPanel');
        if (!panel || panel.classList.contains('hidden')) return;
        if (document.hidden) panel.classList.add('blurred');
        else panel.classList.remove('blurred');
    });

    updateSectionView();
    updatePrivateShareUi();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    initDatabase();
});