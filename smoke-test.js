const fs = require('fs');
const { execSync } = require('child_process');

let failures = 0;
function check(label, fn) {
    try { fn(); console.log('PASS:', label); }
    catch (e) { failures++; console.error('FAIL:', label, '-', e.message); }
}

const html = fs.readFileSync('index.html', 'utf8');
const requiredTokens = ['id="cardPrompt"', 'id="progressIndicator"', 'class="desktop-sidebar"', 'id="qodQuestion"', 'id="exploreAllBtn"', 'id="homeNavBtn"'];
requiredTokens.forEach(tok => check(`index.html contains ${tok}`, () => {
    if (!html.includes(tok)) throw new Error('missing');
}));

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

check('validate cards.json', () => { execSync('node validate-cards.js cards.json', { stdio: 'pipe' }); });
check('validate explicit-cards.json', () => { execSync('node validate-cards.js explicit-cards.json', { stdio: 'pipe' }); });

if (failures > 0) { console.error(`\n${failures} smoke test(s) failed.`); process.exit(1); }
else { console.log('\nAll smoke tests passed.'); }