const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, 'cards.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const errors = [];
const warnings = [];
const VALID_MODULES = new Set(['sexuality', 'life', 'explicit']);
const VALID_CONTEXT = new Set(['story', 'action', 'consent', 'poll', 'alignment', 'discovery', 'humor', 'reflection', 'vulnerability', 'preference', 'game', 'flirting', 'intimacy', 'growth', 'trial', 'connection', 'trust', 'fantasy', 'honesty', 'sensory', 'nostalgia', 'thrill', 'spontaneity', 'anticipation', 'playful', 'couple']);
const VALID_STYLES = new Set(['question', 'activity']);
const VALID_PILLARS = new Set(['spark', 'heat', 'closer', 'afterhours']);

if (!data || !Array.isArray(data.cards)) {
  errors.push('Top-level "cards" must be an array.');
} else {
  const ids = new Set();
  const seenPrompts = new Set();
  const prefixCounts = new Map();
  data.cards.forEach((card, index) => {
    const loc = `card[${index}]${card && card.id ? ` (${card.id})` : ''}`;
    if (!card || typeof card !== 'object') { errors.push(`${loc}: not an object`); return; }
    for (const field of ['id', 'module', 'category', 'intensity', 'prompt', 'contextType', 'promptStyle']) {
      if (card[field] === undefined || card[field] === null) errors.push(`${loc}: missing ${field}`);
    }
    if (typeof card.id !== 'string' || !card.id) errors.push(`${loc}: id must be a non-empty string`);
    if (card.pillar !== undefined && !VALID_PILLARS.has(card.pillar)) errors.push(`${loc}: invalid pillar ${card.pillar}`);
    else if (ids.has(card.id)) errors.push(`${loc}: duplicate id ${card.id}`);
    else ids.add(card.id);
    if (!VALID_MODULES.has(card.module)) errors.push(`${loc}: invalid module ${card.module}`);
    if (typeof card.category !== 'string' || card.category.length === 0 || card.category.length > 50) errors.push(`${loc}: invalid category`);
    if (![1, 2, 3, 4].includes(card.intensity)) errors.push(`${loc}: invalid intensity ${card.intensity}`);
    if (typeof card.prompt !== 'string' || card.prompt.length === 0 || card.prompt.length > 280) errors.push(`${loc}: invalid prompt`);
    if (typeof card.prompt === 'string') {
      const key = card.prompt.trim().toLowerCase();
      if (seenPrompts.has(key)) warnings.push(`${loc}: duplicate prompt`);
      else seenPrompts.add(key);
      const prefix = key.slice(0, 60);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
    }
    if (card.promptStyle === 'question' && !/[?!.:]$/.test(card.prompt.trim())) warnings.push(`${loc}: question prompt should end with punctuation`);
    if (!VALID_CONTEXT.has(card.contextType)) errors.push(`${loc}: invalid contextType ${card.contextType}`);
    if (!VALID_STYLES.has(card.promptStyle)) errors.push(`${loc}: invalid promptStyle ${card.promptStyle}`);
    const hasOptions = Object.prototype.hasOwnProperty.call(card, 'options');
    if (hasOptions) {
      if (!Array.isArray(card.options) || card.options.length < 2 || card.options.length > 6) errors.push(`${loc}: options must have 2-6 entries`);
      else if (card.options.some(o => typeof o !== 'string' || o.length === 0 || o.length > 120)) errors.push(`${loc}: invalid option entry`);
      if (card.contextType !== 'poll') errors.push(`${loc}: options only allowed for poll cards`);
    } else if (card.contextType === 'poll') {
      warnings.push(`${loc}: poll card has no options (will render as a regular question)`);
    }
    // Module/pillar accuracy: Heat cards should not contain explicit sexual content
    if (card.pillar === 'heat' && /orgasm|anal|oral|penetrat|intercourse|genital|climax|fetish|kink|bondage|handjob|blowjob/i.test(card.prompt)) {
      warnings.push(`${loc}: heat card contains explicit keyword — consider moving to afterhours`);
    }
    // Natural wording: flag very short prompts
    if (typeof card.prompt === 'string' && card.prompt.trim().length < 12) {
      warnings.push(`${loc}: prompt very short (${card.prompt.trim().length} chars)`);
    }
    // no extra? allow
  });
  for (const [prefix, count] of prefixCounts) {
    if (count > 3) warnings.push(`near-duplicate prefix (${count}x): "${prefix}…"`);
  }
  console.log(`Validated ${data.cards.length} cards (${ids.size} unique ids).`);
}

if (warnings.length) {
  console.warn(`Found ${warnings.length} validation warning(s):`);
  warnings.slice(0, 20).forEach(w => console.warn(' - ' + w));
  if (warnings.length > 20) console.warn(`...and ${warnings.length - 20} more`);
}
if (errors.length) {
  console.error(`Found ${errors.length} validation error(s):`);
  errors.slice(0, 50).forEach(e => console.error(' - ' + e));
  if (errors.length > 50) console.error(`...and ${errors.length - 50} more`);
  process.exit(1);
} else {
  console.log('cards.json validation passed.');
}