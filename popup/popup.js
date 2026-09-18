'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const list            = document.getElementById('mappings-list');
const accountList     = document.getElementById('account-list');
const addBtn          = document.getElementById('add-btn');
const addAccountBtn   = document.getElementById('add-account-btn');
const saveBtn         = document.getElementById('save-btn');
const importBtn       = document.getElementById('import-btn');
const exportBtn       = document.getElementById('export-btn');
const importFile      = document.getElementById('import-file');
const statusMsg       = document.getElementById('status-msg');
const openOptionsBtn  = document.getElementById('open-options-btn');
const helpBtn         = document.getElementById('help-btn');
const closeBtn        = document.getElementById('close-btn');
const detectionBanner = document.getElementById('detection-banner');
const detectionText   = document.getElementById('detection-text');
const autonameBar     = document.getElementById('autoname-bar');
const autonameText    = document.getElementById('autoname-text');
const autonameBtn     = document.getElementById('autoname-btn');

// ── State ─────────────────────────────────────────────────────────────────────

let isDirty = false;

// Every unmapped slug detected on the GA4 tab, including those beyond the
// three-row display cap. Carried to the options page on handoff.
let detectedSlugs = [];
let detectedAccounts = [];
let detectedAccountId = null;

// slug -> extension name, read out of GA4's own report widgets by the content
// script. Free, local, and works for extensions that are not installed here.
let nameHints = {};

// ── Dirty tracking ────────────────────────────────────────────────────────────

function markDirty() {
  if (!isDirty) { isDirty = true; clearStatus(); }
}

function markClean() { isDirty = false; }

// ── Status messages ───────────────────────────────────────────────────────────

let statusTimer = null;

function showStatus(text, type = 'success') {
  clearTimeout(statusTimer);
  statusMsg.textContent = text;
  statusMsg.className = `status-msg is-${type}`;
  if (type === 'success') statusTimer = setTimeout(clearStatus, 3000);
}

function clearStatus() {
  clearTimeout(statusTimer);
  statusMsg.textContent = '';
  statusMsg.className = 'status-msg';
}

// ── Detection banner ──────────────────────────────────────────────────────────

function showDetectionBanner(text, mode = 'live') {
  detectionText.textContent = text;
  detectionBanner.className =
    'detection-banner' + (mode === 'cached' ? ' is-cached' : '');
}

// ── Shared SVG ────────────────────────────────────────────────────────────────

const TRASH_SVG = `
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M1.75 3.5h10.5M5.25 3.5V2.333A.583.583 0 0 1 5.833 1.75h2.334A.583.583 0 0 1 8.75 2.333V3.5m1.75 0v7.583a.583.583 0 0 1-.583.584H4.083A.583.583 0 0 1 3.5 11.083V3.5h7Z"
      stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;


const LISTING_URL = (id) => `https://chromewebstore.google.com/detail/${id}`;

const LISTING_SVG = `
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M6.13 2.33H2.92c-.32 0-.59.26-.59.58v8.17c0 .32.27.58.59.58h8.16c.33 0 .59-.26.59-.58V7.87"
      stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8.75 1.75h3.5v3.5M12.25 1.75L6.42 7.58"
      stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

// ── Row factory ───────────────────────────────────────────────────────────────

function makeRow({ slug, name, animate, isDetected, parentList, slugPlaceholder, slugAriaLabel }) {
  const row = document.createElement('div');
  let cls = 'mapping-row';
  if (animate)    cls += ' is-new';
  if (isDetected) cls += ' is-detected';
  row.className = cls;

  const slugInput = document.createElement('input');
  slugInput.type = 'text';
  slugInput.className = 'input slug-input';
  slugInput.placeholder = slugPlaceholder;
  slugInput.value = slug;
  slugInput.spellcheck = false;
  slugInput.autocomplete = 'off';
  slugInput.setAttribute('aria-label', slugAriaLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'input name-input';
  nameInput.placeholder = 'Display name';
  nameInput.value = name;
  nameInput.setAttribute('aria-label', 'Display name');

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-btn';
  deleteBtn.setAttribute('aria-label', 'Remove this mapping');
  deleteBtn.innerHTML = TRASH_SVG;

  deleteBtn.addEventListener('click', () => {
    row.remove();
    if (parentList.children.length === 0) renderEmptyState(parentList);
    markDirty();
  });

  // Remove the detected/suggested highlights once the user starts editing
  const clearHints = () => { row.classList.remove('is-detected', 'is-suggested'); markDirty(); };
  slugInput.addEventListener('input', clearHints);
  nameInput.addEventListener('input', clearHints);

  if (animate) {
    row.addEventListener('animationend', () => row.classList.remove('is-new'), { once: true });
  }

  // Chrome forbids extensions from fetching the Web Store, so a slug we could
  // not resolve locally gets a link the user can follow to read the name.
  const listingBtn = document.createElement('button');
  listingBtn.type = 'button';
  listingBtn.className = 'listing-btn is-hidden';
  listingBtn.title = 'Open this extension\'s Chrome Web Store listing';
  listingBtn.setAttribute('aria-label', 'Open Chrome Web Store listing');
  listingBtn.innerHTML = LISTING_SVG;
  listingBtn.addEventListener('click', () => {
    const id = slugInput.value.trim();
    if (id) chrome.tabs.create({ url: LISTING_URL(id) });
  });

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.appendChild(listingBtn);
  actions.appendChild(deleteBtn);

  row.appendChild(slugInput);
  row.appendChild(nameInput);
  row.appendChild(actions);
  return row;
}

function createRow(slug = '', name = '', animate = false, isDetected = false) {
  return makeRow({
    slug, name, animate, isDetected,
    parentList: list,
    slugPlaceholder: 'egedbdckafdbomeh…',
    slugAriaLabel: 'GA4 property slug',
  });
}

function createAccountRow(slug = '', name = '', animate = false, isDetected = false) {
  return makeRow({
    slug, name, animate, isDetected,
    parentList: accountList,
    slugPlaceholder: '376297388',
    slugAriaLabel: 'GA4 account number',
  });
}

// ── Empty state ───────────────────────────────────────────────────────────────

function renderEmptyState(targetList) {
  const isAccount = targetList === accountList;
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.id = isAccount ? 'account-empty-state' : 'empty-state';
  div.innerHTML = `
    <svg class="empty-icon" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="4" y="8" width="32" height="24" rx="5" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="10" cy="20" r="2.5" fill="currentColor" opacity="0.4"/>
      <rect x="15" y="14" width="14" height="2.5" rx="1.25" fill="currentColor" opacity="0.35"/>
      <rect x="15" y="20" width="10" height="2.5" rx="1.25" fill="currentColor" opacity="0.25"/>
      <rect x="15" y="26" width="12" height="2.5" rx="1.25" fill="currentColor" opacity="0.2"/>
    </svg>
    <h2>No mappings yet</h2>
    <p>${isAccount
      ? 'Add an account number to rename it.'
      : 'Add a property slug to rename it.'
    }</p>`;
  targetList.appendChild(div);
}

// ── Render all rows ───────────────────────────────────────────────────────────

function renderMappings(mappings) {
  list.innerHTML = '';
  const entries = Object.entries(mappings || {});
  if (entries.length === 0) { renderEmptyState(list); return; }
  entries.forEach(([slug, name]) => list.appendChild(createRow(slug, name)));
}

function renderAccountMappings(mappings) {
  accountList.innerHTML = '';
  const entries = Object.entries(mappings || {});
  if (entries.length === 0) { renderEmptyState(accountList); return; }
  entries.forEach(([id, name]) => accountList.appendChild(createAccountRow(id, name)));
}

// ── Read current DOM state ────────────────────────────────────────────────────

function getMappingsFromDOM() {
  const mappings = {};
  list.querySelectorAll('.mapping-row').forEach((row) => {
    const slug = row.querySelector('.slug-input').value.trim();
    const name = row.querySelector('.name-input').value.trim();
    if (slug && name) mappings[slug] = name;
  });
  return mappings;
}

function getAccountMappingsFromDOM() {
  const mappings = {};
  accountList.querySelectorAll('.mapping-row').forEach((row) => {
    const id   = row.querySelector('.slug-input').value.trim();
    const name = row.querySelector('.name-input').value.trim();
    if (id && name) mappings[id] = name;
  });
  return mappings;
}

// ── Save ──────────────────────────────────────────────────────────────────────

const ITEM_QUOTA = (chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192);
function bytesOf(obj) { return new Blob([JSON.stringify(obj)]).size; }

function save() {
  const mappings        = getMappingsFromDOM();
  const accountMappings = getAccountMappingsFromDOM();

  if (bytesOf(mappings) > ITEM_QUOTA) {
    showStatus('Too many property mappings.', 'error'); return;
  }
  if (bytesOf(accountMappings) > ITEM_QUOTA) {
    showStatus('Too many account mappings.', 'error'); return;
  }

  chrome.storage.sync.set({ mappings, accountMappings }, () => {
    if (chrome.runtime.lastError) { showStatus('Save failed.', 'error'); return; }
    markClean();
    showStatus('Saved!', 'success');
  });
}

// ── Add buttons ───────────────────────────────────────────────────────────────

addBtn.addEventListener('click', () => {
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();
  const row = createRow('', '', true);
  list.appendChild(row);
  row.querySelector('.slug-input').focus();
  markDirty();
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

addAccountBtn.addEventListener('click', () => {
  const empty = document.getElementById('account-empty-state');
  if (empty) empty.remove();
  const row = createAccountRow('', '', true);
  accountList.appendChild(row);
  row.querySelector('.slug-input').focus();
  markDirty();
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// ── Save button ───────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', save);

// ── Export JSON ───────────────────────────────────────────────────────────────

exportBtn.addEventListener('click', () => {
  const mappings        = getMappingsFromDOM();
  const accountMappings = getAccountMappingsFromDOM();
  const json = JSON.stringify({ mappings, accountMappings }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ga4-name-changer-mappings.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ── Import JSON ───────────────────────────────────────────────────────────────

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', () => {
  const file = importFile.files[0];
  if (!file) return;

  if (file.size > 512 * 1024) {
    showStatus('Import failed: file too large (max 512 KB).', 'error');
    importFile.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);


      if (parsed.mappings !== undefined) {
        if (typeof parsed.mappings !== 'object' || Array.isArray(parsed.mappings))
          throw new Error('mappings must be an object.');
        const entries = Object.entries(parsed.mappings);
        if (entries.length > 200) throw new Error('Too many property mappings (max 200).');
        for (const [k, v] of entries) {
          if (typeof k !== 'string' || typeof v !== 'string')
            throw new Error('All mapping keys and values must be strings.');
          if (k.length > 256 || v.length > 256)
            throw new Error('Keys/values must be ≤256 characters.');
        }
      }

      if (parsed.accountMappings !== undefined) {
        if (typeof parsed.accountMappings !== 'object' || Array.isArray(parsed.accountMappings))
          throw new Error('accountMappings must be an object.');
        const entries = Object.entries(parsed.accountMappings);
        if (entries.length > 200) throw new Error('Too many account mappings (max 200).');
        for (const [k, v] of entries) {
          if (typeof k !== 'string' || typeof v !== 'string')
            throw new Error('All mapping keys and values must be strings.');
          if (k.length > 256 || v.length > 256)
            throw new Error('Keys/values must be ≤256 characters.');
        }
      }

      if (!parsed.mappings && !parsed.accountMappings)
        throw new Error('File must contain mappings and/or accountMappings.');

      if (parsed.mappings)        renderMappings(parsed.mappings);
      if (parsed.accountMappings) renderAccountMappings(parsed.accountMappings);

      const total = Object.keys(parsed.mappings || {}).length
                  + Object.keys(parsed.accountMappings || {}).length;
      markDirty();
      showStatus(`Imported ${total} mapping(s). Save to apply.`, 'success');
    } catch (err) {
      showStatus(`Import failed: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file);
  importFile.value = '';
});

// ── Handoff to the options page ───────────────────────────────────────────────
// The popup cannot warn before closing (extension popups get no beforeunload),
// so anything typed here is stashed in local storage and picked up by the
// options page. Overflow slugs that never got a row are carried too, which is
// what makes the "open Full Settings to map all" note actually true.

const HANDOFF_TTL_MS = 10 * 60 * 1000; // options.js ignores anything older

function buildHandoff() {
  const properties = [];
  const seen = new Set();

  list.querySelectorAll('.mapping-row').forEach((row) => {
    const slug = row.querySelector('.slug-input').value.trim();
    const name = row.querySelector('.name-input').value.trim();
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    properties.push({ slug, name });
  });

  // Detected slugs the three-row cap never rendered
  detectedSlugs.forEach((slug) => {
    if (seen.has(slug)) return;
    seen.add(slug);
    properties.push({ slug, name: '' });
  });

  const accounts = [];
  const seenAccounts = new Set();
  accountList.querySelectorAll('.mapping-row').forEach((row) => {
    const id   = row.querySelector('.slug-input').value.trim();
    const name = row.querySelector('.name-input').value.trim();
    if (!id || seenAccounts.has(id)) return;
    seenAccounts.add(id);
    accounts.push({ id, name });
  });

  detectedAccounts.forEach(({ id }) => {
    if (!id || seenAccounts.has(id)) return;
    seenAccounts.add(id);
    accounts.push({ id, name: '' });
  });

  return { ts: Date.now(), accountId: detectedAccountId, properties, accounts };
}

function openOptions(hash = '') {
  chrome.storage.local.set({ pendingDetection: buildHandoff() }, () => {
    void chrome.runtime.lastError;
    if (hash && chrome.runtime.getURL) {
      chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html${hash}`) });
    } else {
      chrome.runtime.openOptionsPage();
    }
    window.close();
  });
}

// ── Header action buttons ─────────────────────────────────────────────────────

openOptionsBtn.addEventListener('click', () => openOptions());

helpBtn.addEventListener('click', () => openOptions('#welcome'));

closeBtn.addEventListener('click', () => window.close());

// ── Auto-naming from the Chrome Web Store ─────────────────────────────────────
// A GA4 property slug for a CWS developer property IS the Chrome extension ID,
// so the store listing URL can be reconstructed from it and its title read back.
//
// The network call lives in the service worker, which refuses unless the user
// has both enabled the setting and granted the optional host permission.
// Granting cannot happen here: chrome.permissions.request() tears down the
// popup before its callback runs (crbug.com/952645), so the popup only ever
// offers to hand the user over to the options page to grant it.

function showAutonameBar(text, { actionLabel = null, state = 'info' } = {}) {
  autonameText.textContent = text;
  autonameBar.className = `autoname-bar is-${state}`;
  if (actionLabel) {
    autonameBtn.textContent = actionLabel;
    autonameBtn.classList.remove('is-hidden');
  } else {
    autonameBtn.classList.add('is-hidden');
  }
}

function unnamedDetectedSlugs() {
  const out = [];
  list.querySelectorAll('.mapping-row').forEach((row) => {
    const slug = row.querySelector('.slug-input').value.trim();
    const name = row.querySelector('.name-input').value.trim();
    if (slug && !name) out.push(slug);
  });
  return out;
}

function applyResolvedNames(names, unresolved = []) {
  const unresolvedSet = new Set(unresolved);
  let filled = 0;

  list.querySelectorAll('.mapping-row').forEach((row) => {
    const slugInput = row.querySelector('.slug-input');
    const nameInput = row.querySelector('.name-input');
    const slug      = slugInput.value.trim();
    const resolved  = names[slug];

    if (resolved && !nameInput.value.trim()) {
      nameInput.value = resolved;
      row.classList.add('is-suggested');
      filled++;
      return;
    }

    // Not installed locally, so offer the public listing instead
    if (unresolvedSet.has(slug) && !nameInput.value.trim()) {
      row.querySelector('.listing-btn').classList.remove('is-hidden');
    }
  });

  if (filled > 0) markDirty();
  return filled;
}

function runAutoName() {
  const ids = unnamedDetectedSlugs();
  if (ids.length === 0) return;

  showAutonameBar('Naming from your installed extensions…', { state: 'working' });

  chrome.runtime.sendMessage({ action: 'resolveNames', ids }, (response) => {
    if (chrome.runtime.lastError || !response) {
      showAutonameBar('Name lookup unavailable.', { state: 'info' });
      return;
    }
    if (response.reason === 'no-permission' || response.reason === 'disabled') {
      offerAutoName();
      return;
    }
    const filled = applyResolvedNames(response.names || {}, response.unresolved || []);
    const missed = ids.length - filled;
    if (filled === 0) {
      showAutonameBar('None are installed here. Use the link on each row to check its listing.',
        { state: 'info' });
    } else {
      showAutonameBar(
        `Named ${filled}` + (missed > 0 ? `, ${missed} not installed here` : '') + ' · review, then Save',
        { state: 'done' }
      );
    }
  });
}

function offerAutoName() {
  if (unnamedDetectedSlugs().length === 0) return;
  showAutonameBar('Name these automatically from your installed extensions?',
    { actionLabel: 'Turn on', state: 'offer' });
}

autonameBtn.addEventListener('click', () => openOptions('#autoname'));

function initAutoName() {
  suggestAccountNameFromProperty();
  const hinted = list.querySelectorAll('.mapping-row.is-suggested').length;
  if (hinted > 0) {
    showAutonameBar(
      `Named ${hinted} from this GA4 report · review, then Save`, { state: 'done' });
  }
  chrome.storage.sync.get(['autoResolveNames'], (result) => {
    if (chrome.runtime.lastError) return;
    if (result.autoResolveNames === true) runAutoName();
    else if (unnamedDetectedSlugs().length > 0) offerAutoName();
  });
}

// ── GA4 auto-detection ────────────────────────────────────────────────────────

/**
 * A short form of an extension name, for use as an account display name.
 *
 * Chrome Web Store developer accounts hold one extension each, so the account
 * is best labelled by that extension. The full name is usually too long for the
 * switcher row, so this keeps roughly the first few words and trims any
 * dangling connector word left at the end.
 */
const TRAILING_STOPWORDS = new Set([
  'and','or','the','a','an','as','of','for','to','in','on','with','by','my','your'
]);

function shortenName(name, maxChars = 24) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const kept = [words[0]];
  for (let i = 1; i < words.length; i++) {
    if ((kept.join(' ') + ' ' + words[i]).length > maxChars) break;
    kept.push(words[i]);
  }
  while (kept.length > 1 && TRAILING_STOPWORDS.has(kept[kept.length - 1].toLowerCase())) {
    kept.pop();
  }
  return kept.join(' ');
}

/**
 * GA4 only puts the currently open account in the URL, but the account switcher
 * renders every account the user can see. The content script scans for all of
 * them, so every unmapped account gets a row rather than just the current one.
 */
function addDetectedAccountRows(accounts, currentAccountMappings) {
  const newAccounts = (accounts || []).filter(a => a && a.id && !currentAccountMappings[a.id]);
  detectedAccounts = newAccounts;
  if (newAccounts.length === 0) return;

  const empty = document.getElementById('account-empty-state');
  if (empty) empty.remove();

  // Reversed, because each row is inserted at the top: iterating backwards
  // leaves them in the order GA4 listed them.
  newAccounts.slice().reverse().forEach(({ id }) => {
    accountList.insertBefore(createAccountRow(id, '', true, true), accountList.firstChild);
  });

  accountList.querySelector('.name-input').focus();
  markDirty();
}

/**
 * When a single account and a single named property are on screen, they belong
 * to each other, so the account can be labelled from the extension's name.
 * Only ever fills a blank field, and is styled as a suggestion for review.
 */
function suggestAccountNameFromProperty() {
  const accountRows = accountList.querySelectorAll('.mapping-row');
  if (accountRows.length !== 1) return;

  const nameInput = accountRows[0].querySelector('.name-input');
  if (nameInput.value.trim()) return;

  const named = list.querySelectorAll('.mapping-row.is-suggested');
  if (named.length !== 1) return;

  const full = named[0].querySelector('.name-input').value.trim();
  const short = shortenName(full);
  if (!short) return;

  nameInput.value = short;
  accountRows[0].classList.add('is-suggested');
  markDirty();
}

function addDetectedSlugRows(slugs, currentMappings) {
  const newSlugs = (slugs || []).filter(s => !currentMappings[s]);
  detectedSlugs = newSlugs; // remembered in full for the options-page handoff

  const toShow   = newSlugs.slice(0, 3);
  const overflow = newSlugs.length - toShow.length;

  if (toShow.length === 0) return;

  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  // Reverse so newSlugs[0] lands at list.firstChild after all insertions
  toShow.slice().reverse().forEach(slug => {
    const hinted = nameHints[slug] || '';
    const row = createRow(slug, hinted, true, true);
    if (hinted) row.classList.add('is-suggested');
    list.insertBefore(row, list.firstChild);
    markDirty();
  });

  // Tell the user if more slugs were detected but not shown
  const overflowNote = document.getElementById('slug-overflow-note');
  if (overflowNote) {
    if (overflow > 0) {
      overflowNote.textContent =
        `+${overflow} more slug${overflow > 1 ? 's' : ''} detected — open Full Settings to map all`;
      overflowNote.classList.remove('is-hidden');
    } else {
      overflowNote.classList.add('is-hidden');
    }
  }
}

function initDetection(currentMappings, currentAccountMappings) {
  chrome.storage.local.get(['nameHints'], (stored) => {
    nameHints = (!chrome.runtime.lastError && stored.nameHints) || {};
    runDetection(currentMappings, currentAccountMappings);
  });
}

/**
 * Ask a GA4 tab for the current page context.
 *
 * The active tab is tried first, but the popup is frequently opened while
 * looking at something else, so a GA4 tab anywhere in the same window is used
 * as a fallback. Querying by URL needs no extra permission: `tabs` is NOT
 * declared, and Chrome exposes `url` only for tabs matching the host
 * permissions this extension already holds for analytics.google.com.
 */
function findGA4Tab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
    if (chrome.runtime.lastError) { callback(null, false); return; }

    const isGA4Active = activeTab && typeof activeTab.url === 'string' &&
                        activeTab.url.startsWith('https://analytics.google.com/');
    if (isGA4Active) { callback(activeTab, true); return; }

    // Not looking at GA4 right now: fall back to a GA4 tab in this window
    chrome.tabs.query(
      { url: 'https://analytics.google.com/*', currentWindow: true },
      (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
          // Last resort: the active tab may still host the content script even
          // if its url was not readable.
          callback(activeTab || null, true);
          return;
        }
        callback(tabs[0], false);
      }
    );
  });
}

function runDetection(currentMappings, currentAccountMappings) {
  findGA4Tab((tab, isActive) => {
    if (!tab) { loadLastContext(); return; }

    chrome.tabs.sendMessage(tab.id, { action: 'getGA4Data' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        // Not a GA4 tab (no content script) — fall back to cached context
        loadLastContext();
        return;
      }

      const { accountId, accounts, slugs, hint } = response;
      detectedAccountId = accountId || null;
      if (hint && hint.slug && hint.name) nameHints[hint.slug] = hint.name;

      // Older cached payloads only carried a single accountId
      const found = Array.isArray(accounts)
        ? accounts
        : (accountId ? [{ id: accountId, label: null }] : []);

      const where = isActive ? '' : ' (other tab)';
      showDetectionBanner(
        'GA4 page detected' +
        (found.length > 1 ? ` · ${found.length} accounts`
          : accountId ? ` · Account ${accountId}` : '') + where,
        'live'
      );

      addDetectedAccountRows(found, currentAccountMappings);
      addDetectedSlugRows(slugs, currentMappings);

      // If no account row stole focus, land on the first detected slug's name field
      if (!accountList.querySelector('.is-detected')) {
        const firstSlug = list.querySelector('.is-detected');
        if (firstSlug) firstSlug.querySelector('.name-input').focus();
      }
      initAutoName();
    });
  });
}

function loadLastContext() {
  chrome.storage.local.get(['lastGA4Context'], (result) => {
    if (chrome.runtime.lastError || !result.lastGA4Context) return;
    const { accountId, accounts } = result.lastGA4Context;
    const count = Array.isArray(accounts) ? accounts.length : 0;
    if (count > 1)      showDetectionBanner(`Last seen · ${count} accounts`, 'cached');
    else if (accountId) showDetectionBanner(`Last seen · Account ${accountId}`, 'cached');
  });
}

// ── Account-label health check ────────────────────────────────────────────────
// The content script writes accountLabelLastMatched whenever it successfully
// replaces a GA4 account label. If that timestamp goes stale (90+ days) while
// the user has account mappings configured, it likely means Google renamed the
// UI element — so we surface a warning in the Account Numbers section.

function checkLabelHealth(accountMappings) {
  if (Object.keys(accountMappings).length === 0) return;

  chrome.storage.local.get(['accountLabelLastMatched'], (result) => {
    if (chrome.runtime.lastError) return;
    const lastMatched = result.accountLabelLastMatched;
    if (!lastMatched) return; // never matched yet — user may not have visited the account list page

    const daysSince = Math.floor((Date.now() - lastMatched) / 86_400_000);
    if (daysSince < 90) return;

    const warning = document.getElementById('label-warning');
    const text    = document.getElementById('label-warning-text');
    if (warning && text) {
      text.textContent =
        `Account labels last matched ${daysSince} days ago. Google may have ` +
        `renamed this UI element — verify your account mappings are still working.`;
      warning.classList.remove('is-hidden');
    }
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

chrome.storage.sync.get(['mappings', 'accountMappings'], (result) => {
  if (chrome.runtime.lastError) {
    showStatus('Could not load saved mappings.', 'error');
    renderMappings({});
    renderAccountMappings({});
    return;
  }
  const m  = result.mappings        || {};
  const am = result.accountMappings || {};
  renderMappings(m);
  renderAccountMappings(am);
  markClean();
  checkLabelHealth(am);
  initDetection(m, am);
});
