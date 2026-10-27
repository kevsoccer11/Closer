const fs = require('fs');
const { execSync } = require('child_process');

let failures = 0;
function check(label, fn) {
    try { fn(); console.log('PASS:', label); }
    catch (e) { failures++; console.error('FAIL:', label, '-', e.message); }
}

const html = fs.readFileSync('index.html', 'utf8');
const requiredTokens = ['id="cardPrompt"', 'id="roundPackSelect"', 'id="progressIndicator"', 'id="packFilterChips"', 'class="desktop-sidebar"', 'id="browseModeBtn"'];
requiredTokens.forEach(tok => check(`index.html contains ${tok}`, () => {
    if (!html.includes(tok)) throw new Error('missing');
}));

['js/app.js', 'js/app-logic.js', 'js/app-state.js'].forEach(f => check(`syntax ${f}`, () => {
    execSync(`node --check ${f}`, { stdio: 'pipe' });
}));

check('validate cards.json', () => { execSync('node validate-cards.js cards.json', { stdio: 'pipe' }); });
check('validate explicit-cards.json', () => { execSync('node validate-cards.js explicit-cards.json', { stdio: 'pipe' }); });

if (failures > 0) { console.error(`\n${failures} smoke test(s) failed.`); process.exit(1); }
else { console.log('\nAll smoke tests passed.'); }