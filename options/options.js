'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const groupsList     = document.getElementById('groups-list');
const addBtn         = document.getElementById('add-btn');
const addAccountBtn  = document.getElementById('add-account-btn');
const saveBtn        = document.getElementById('save-btn');
const importBtn      = document.getElementById('import-btn');
const exportBtn      = document.getElementById('export-btn');
const importFile     = document.getElementById('import-file');
const statusMsg      = document.getElementById('status-msg');

// ── State ─────────────────────────────────────────────────────────────────────

let isDirty = false;

// ── Dirty tracking ────────────────────────────────────────────────────────────

function markDirty() {
  if (!isDirty) {
    isDirty = true;
    clearStatus();
  }
}

function markClean() {
  isDirty = false;
}

window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── Status messages ───────────────────────────────────────────────────────────

let statusTimer = null;

function showStatus(text, type = 'success') {
  clearTimeout(statusTimer);
  statusMsg.textContent = text;
  statusMsg.className = `status-msg is-${type}`;

  if (type === 'success') {
    statusTimer = setTimeout(() => clearStatus(), 3000);
  }
}

function clearStatus() {
  clearTimeout(statusTimer);
  statusMsg.textContent = '';
  statusMsg.className = 'status-msg';
}

// ── Shared SVG ────────────────────────────────────────────────────────────────

const TRASH_SVG = `
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M1.75 3.5h10.5M5.25 3.5V2.333A.583.583 0 0 1 5.833 1.75h2.334A.583.583 0 0 1 8.75 2.333V3.5m1.75 0v7.583a.583.583 0 0 1-.583.584H4.083A.583.583 0 0 1 3.5 11.083V3.5h7Z"
      stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;


const LISTING_SVG = `
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M6.13 2.33H2.92c-.32 0-.59.26-.59.58v8.17c0 .32.27.58.59.58h8.16c.33 0 .59-.26.59-.58V7.87"
      stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8.75 1.75h3.5v3.5M12.25 1.75L6.42 7.58"
      stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

const ADD_SVG = `
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;

// ── One table, grouped by account ─────────────────────────────────────────────
//
// Storage keeps two flat maps — slug -> name and accountId -> name — because
// that is all the replacement engine needs, and that shape is what the popup,
// the content script and Import/Export all agree on. It is NOT changed here.
//
// What changed is only how it is drawn: accounts and properties used to be two
// separate cards, which left the user to work out by eye which extension sat
// under which account. Now each account is a group head with its properties
// nested beneath it, sharing the same two columns, so the account number lines
// up with the property slugs and the account's display name with theirs.
//
// The pairing itself comes from `local.propertyAccounts`, which the content
// script mirrors out of GA4's own account tree. Properties whose account is not
// known yet fall into a catch-all group at the bottom; they are perfectly
// usable there, they are just not filed.

const UNGROUPED = '';   // data-account value of the catch-all group

/** slug -> accountId, as last seen on a GA4 page. Grouping only, never saved. */
let propertyAccounts = {};

// ── Row factory ───────────────────────────────────────────────────────────────

/**
 * One editable identifier/name pair. Accounts and properties differ only in
 * their placeholders, their labels and which actions they carry, so they share
 * this factory and therefore share their column widths exactly.
 */
function makeRow({ kind, key, name, animate, isDetected, isAuto,
                   keyPlaceholder, keyAriaLabel, namePlaceholder, nameAriaLabel }) {
  const row = document.createElement('div');
  let cls = `mapping-row ${kind}-row`;
  if (animate)    cls += ' is-new';
  if (isDetected) cls += ' is-detected';
  if (isAuto)     cls += ' is-auto';
  row.className = cls;

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'input slug-input';
  keyInput.placeholder = keyPlaceholder;
  keyInput.value = key;
  keyInput.spellcheck = false;
  keyInput.autocomplete = 'off';
  keyInput.setAttribute('aria-label', keyAriaLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'input name-input';
  nameInput.placeholder = namePlaceholder;
  nameInput.value = name;
  nameInput.setAttribute('aria-label', nameAriaLabel);

  // Clear the detected/suggested highlights once the user edits the row
  const clearHints = () => { row.classList.remove('is-detected', 'is-suggested'); markDirty(); };
  keyInput.addEventListener('input', clearHints);
  nameInput.addEventListener('input', clearHints);

  if (animate) {
    row.addEventListener('animationend', () => row.classList.remove('is-new'), { once: true });
  }

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (isAuto) {
    const badge = document.createElement('span');
    badge.className = 'badge-auto';
    badge.textContent = 'auto';
    badge.title = 'Worked out automatically. Edit and Save to make it yours.';
    actions.appendChild(badge);
  }

  row.appendChild(keyInput);
  row.appendChild(nameInput);
  row.appendChild(actions);
  return row;
}

/** A property row: an extension ID and the name to show in its place. */
function makePropertyRow(slug = '', name = '', opts = {}) {
  const row = makeRow({
    kind: 'property',
    key: slug,
    name,
    animate: opts.animate,
    isDetected: opts.isDetected,
    isAuto: opts.isAuto,
    keyPlaceholder: 'inkkcgalfjninhfflfhkflidilkjmhof',
    keyAriaLabel: 'GA4 property slug',
    namePlaceholder: 'Property display name',
    nameAriaLabel: 'Property display name',
  });

  const actions = row.querySelector('.row-actions');

  // Chrome forbids extensions from fetching the Web Store, so a slug we could
  // not resolve locally gets a link the user can follow to read the name.
  const listingBtn = document.createElement('button');
  listingBtn.type = 'button';
  listingBtn.className = 'listing-btn is-hidden';
  listingBtn.title = 'Open this extension\'s Chrome Web Store listing';
  listingBtn.setAttribute('aria-label', 'Open Chrome Web Store listing');
  listingBtn.innerHTML = LISTING_SVG;
  listingBtn.addEventListener('click', () => {
    const id = row.querySelector('.slug-input').value.trim();
    if (id) chrome.tabs.create({ url: LISTING_URL(id) });
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-btn';
  deleteBtn.setAttribute('aria-label', 'Remove this property mapping');
  deleteBtn.title = 'Remove this property mapping';
  deleteBtn.innerHTML = TRASH_SVG;
  deleteBtn.addEventListener('click', () => {
    row.remove();
    tidy();
    markDirty();
  });

  actions.appendChild(listingBtn);
  actions.appendChild(deleteBtn);
  return row;
}

/** An account row: the group head. Its delete keeps the properties it holds. */
function makeAccountRow(accountId = '', name = '', opts = {}) {
  const row = makeRow({
    kind: 'account',
    key: accountId,
    name,
    animate: opts.animate,
    isDetected: opts.isDetected,
    isAuto: opts.isAuto,
    keyPlaceholder: '241067359',
    keyAriaLabel: 'GA4 account number',
    namePlaceholder: 'Account display name',
    nameAriaLabel: 'Account display name',
  });

  const actions = row.querySelector('.row-actions');

  const addPropBtn = document.createElement('button');
  addPropBtn.type = 'button';
  addPropBtn.className = 'add-prop-btn';
  addPropBtn.title = 'Add a property under this account';
  addPropBtn.setAttribute('aria-label', 'Add a property under this account');
  addPropBtn.innerHTML = ADD_SVG;
  addPropBtn.addEventListener('click', () => {
    const group = row.closest('.account-group');
    const added = addPropertyRow(group, '', '', { animate: true });
    added.querySelector('.slug-input').focus();
    markDirty();
    added.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-btn';
  deleteBtn.setAttribute('aria-label', 'Remove this account. Its properties are kept.');
  deleteBtn.title = 'Remove this account. Its properties are kept.';
  deleteBtn.innerHTML = TRASH_SVG;
  deleteBtn.addEventListener('click', () => {
    // Deleting the account must not silently delete the properties under it:
    // those are separate mappings the user may well still want. They move to
    // the catch-all group instead.
    const group = row.closest('.account-group');
    const orphans = Array.from(group.querySelectorAll('.property-row'));
    if (orphans.length > 0) {
      const target = ensureGroup(UNGROUPED).querySelector('.group-props');
      orphans.forEach(p => target.appendChild(p));
    }
    group.remove();
    tidy();
    markDirty();
  });

  // Keep the group keyed by what is actually typed. Without this, a group the
  // user just added stays keyed by its placeholder, and the popup handoff would
  // build a second group for the same account.
  row.querySelector('.slug-input').addEventListener('input', (e) => {
    const typed = e.target.value.trim();
    const group = row.closest('.account-group');
    if (group && typed) group.dataset.account = typed;
  });

  actions.appendChild(addPropBtn);
  actions.appendChild(deleteBtn);
  return row;
}

// ── Groups ────────────────────────────────────────────────────────────────────

function groupFor(accountId) {
  const key = accountId || UNGROUPED;
  return groupsList.querySelector(`.account-group[data-account="${CSS.escape(key)}"]`);
}

function makeGroupHead() {
  const head = document.createElement('div');
  head.className = 'group-head-plain';
  head.innerHTML = `
    <span class="group-head-label">Not linked to an account</span>
    <span class="group-head-note">Open these properties in Google Analytics once and they file themselves.</span>`;
  return head;
}

function makeGroup(accountId, accountName, opts) {
  const group = document.createElement('section');
  group.className = 'account-group' + (accountId ? '' : ' is-ungrouped');
  group.dataset.account = accountId || UNGROUPED;

  group.appendChild(accountId
    ? makeAccountRow(accountId, accountName || '', opts)
    : makeGroupHead());

  const props = document.createElement('div');
  props.className = 'group-props';
  group.appendChild(props);
  return group;
}

/** The group for this account, created if it is not on the page yet. */
function ensureGroup(accountId, accountName = '', opts = {}) {
  const found = groupFor(accountId);
  if (found) return found;

  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const group = makeGroup(accountId, accountName, opts);

  // The catch-all always sits last, so real accounts stay together at the top.
  const catchAll = accountId ? groupFor(UNGROUPED) : null;
  if (catchAll) groupsList.insertBefore(group, catchAll);
  else groupsList.appendChild(group);

  return group;
}

function addPropertyRow(group, slug = '', name = '', opts = {}) {
  const row = makePropertyRow(slug, name, opts);
  group.querySelector('.group-props').appendChild(row);
  markSharedAccounts();
  return row;
}

/**
 * An account holding more than one extension has no single right name, so it
 * gets a draft built from all of them. Say so on the row, both to explain a
 * two-part name and to explain the field if no draft could be built yet.
 */
function markSharedAccounts() {
  groupsList.querySelectorAll('.account-group').forEach((group) => {
    const row = group.querySelector('.account-row');
    if (!row) return;
    const count = group.querySelectorAll('.property-row').length;
    const shared = count > 1;
    row.classList.toggle('is-shared', shared);
    const input = row.querySelector('.name-input');
    input.placeholder = shared
      ? `Name this account (holds ${count} extensions)`
      : 'Account display name';
    input.title = shared
      ? `This account holds ${count} extensions, so its name is a draft made from all of them. `
        + `Edit it and press Save Changes to make it yours.`
      : '';
  });
}

/**
 * Drop a catch-all group that has nothing left in it, and fall back to the
 * empty state once the table holds no rows at all. Called after every removal.
 */
function tidy() {
  groupsList.querySelectorAll('.account-group.is-ungrouped').forEach((g) => {
    if (g.querySelectorAll('.property-row').length === 0) g.remove();
  });
  if (groupsList.querySelectorAll('.mapping-row').length === 0) renderEmptyState();
  markSharedAccounts();
}

// ── Empty state ───────────────────────────────────────────────────────────────

function renderEmptyState() {
  if (document.getElementById('empty-state')) return;
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.id = 'empty-state';
  div.innerHTML = `
    <svg class="empty-icon" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="4" y="8" width="32" height="24" rx="5" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="10" cy="20" r="2.5" fill="currentColor" opacity="0.4"/>
      <rect x="15" y="14" width="14" height="2.5" rx="1.25" fill="currentColor" opacity="0.35"/>
      <rect x="15" y="20" width="10" height="2.5" rx="1.25" fill="currentColor" opacity="0.25"/>
      <rect x="15" y="26" width="12" height="2.5" rx="1.25" fill="currentColor" opacity="0.2"/>
    </svg>
    <h2>No names yet</h2>
    <p>Open one of your Chrome Web Store properties in Google Analytics and it
       names itself, or add one here by hand.</p>`;
  groupsList.appendChild(div);
}

// ── Render all rows ───────────────────────────────────────────────────────────

function uniqueKeys(...objects) {
  const out = [];
  const seen = new Set();
  objects.forEach((obj) => {
    Object.keys(obj || {}).forEach((k) => {
      if (seen.has(k)) return;
      seen.add(k);
      out.push(k);
    });
  });
  return out;
}

/**
 * Draw the whole table from storage's four maps plus the pairing.
 *
 * The user's own names and the ones the extension derived are rendered as the
 * same kind of editable row; derived ones simply carry an `auto` badge. A user
 * name always wins over a derived one for the same key, which mirrors exactly
 * what the content script does when it replaces text on the page.
 */
function renderAll({ mappings, accountMappings, autoMappings, autoAccountMappings, pairs }) {
  groupsList.innerHTML = '';

  const userProps = mappings || {};
  const autoProps = autoMappings || {};
  const userAccs  = accountMappings || {};
  const autoAccs  = autoAccountMappings || {};
  const parent    = pairs || {};

  const propKeys = uniqueKeys(userProps, autoProps);
  const accKeys  = uniqueKeys(userAccs, autoAccs);

  // An account earns a group if it is named, or if it holds a known property
  propKeys.forEach((slug) => {
    const id = parent[slug];
    if (id && !accKeys.includes(id)) accKeys.push(id);
  });

  if (propKeys.length === 0 && accKeys.length === 0) { renderEmptyState(); return; }

  accKeys.forEach((id) => {
    const owned = Object.prototype.hasOwnProperty.call(userAccs, id);
    ensureGroup(id, owned ? userAccs[id] : (autoAccs[id] || ''), { isAuto: !owned && id in autoAccs });
  });

  propKeys.forEach((slug) => {
    const owned = Object.prototype.hasOwnProperty.call(userProps, slug);
    addPropertyRow(
      ensureGroup(parent[slug] || UNGROUPED),
      slug,
      owned ? userProps[slug] : (autoProps[slug] || ''),
      { isAuto: !owned && slug in autoProps }
    );
  });

  markSharedAccounts();
}

// ── Read current DOM state ────────────────────────────────────────────────────

function getMappingsFromDOM() {
  const mappings = {};
  groupsList.querySelectorAll('.property-row').forEach((row) => {
    const slug = row.querySelector('.slug-input').value.trim();
    const name = row.querySelector('.name-input').value.trim();
    if (slug && name) mappings[slug] = name;
  });
  return mappings;
}

function getAccountMappingsFromDOM() {
  const mappings = {};
  groupsList.querySelectorAll('.account-row').forEach((row) => {
    const id   = row.querySelector('.slug-input').value.trim();
    const name = row.querySelector('.name-input').value.trim();
    if (id && name) mappings[id] = name;
  });
  return mappings;
}

// ── Save ──────────────────────────────────────────────────────────────────────

const ITEM_QUOTA = (chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192);

function bytesOf(obj) {
  return new Blob([JSON.stringify(obj)]).size;
}

function save() {
  const mappings        = getMappingsFromDOM();
  const accountMappings = getAccountMappingsFromDOM();

  if (bytesOf(mappings) > ITEM_QUOTA) {
    showStatus('Too many property mappings — reduce entries and try again.', 'error');
    return;
  }
  if (bytesOf(accountMappings) > ITEM_QUOTA) {
    showStatus('Too many account mappings — reduce entries and try again.', 'error');
    return;
  }

  chrome.storage.sync.set({ mappings, accountMappings }, () => {
    if (chrome.runtime.lastError) {
      showStatus('Save failed. Please try again.', 'error');
      return;
    }
    markClean();
    showStatus('Saved successfully!', 'success');
  });
}

// ── Add buttons ───────────────────────────────────────────────────────────────

addAccountBtn.addEventListener('click', () => {
  // A blank account number cannot key a group, so the new group is parked under
  // a placeholder key until the user types a real one.
  let key = 'new';
  let n = 1;
  while (groupFor(key)) key = `new-${++n}`;

  const group = ensureGroup(key, '', { animate: true });
  const input = group.querySelector('.account-row .slug-input');
  input.value = '';
  input.focus();
  markDirty();
  group.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

addBtn.addEventListener('click', () => {
  // With no account chosen, a new property goes to the catch-all. Use the plus
  // on an account row to add one directly under that account.
  const group = ensureGroup(UNGROUPED);
  const row = addPropertyRow(group, '', '', { animate: true });
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

      // Validate property mappings if present
      if (parsed.mappings !== undefined) {
        if (typeof parsed.mappings !== 'object' || Array.isArray(parsed.mappings)) {
          throw new Error('mappings must be an object.');
        }
        const entries = Object.entries(parsed.mappings);
        if (entries.length > 200) throw new Error('Too many property mappings (max 200).');
        for (const [k, v] of entries) {
          if (typeof k !== 'string' || typeof v !== 'string') {
            throw new Error('All mappings keys and values must be strings.');
          }
          if (k.length > 256 || v.length > 256) {
            throw new Error('Mapping keys and values must be 256 characters or fewer.');
          }
        }
      }

      // Validate account mappings if present
      if (parsed.accountMappings !== undefined) {
        if (typeof parsed.accountMappings !== 'object' || Array.isArray(parsed.accountMappings)) {
          throw new Error('accountMappings must be an object.');
        }
        const entries = Object.entries(parsed.accountMappings);
        if (entries.length > 200) throw new Error('Too many account mappings (max 200).');
        for (const [k, v] of entries) {
          if (typeof k !== 'string' || typeof v !== 'string') {
            throw new Error('All accountMappings keys and values must be strings.');
          }
          if (k.length > 256 || v.length > 256) {
            throw new Error('Account mapping keys and values must be 256 characters or fewer.');
          }
        }
      }

      if (!parsed.mappings && !parsed.accountMappings) {
        throw new Error('File must contain at least one of: mappings, accountMappings.');
      }

      // An import replaces only what the file carries; anything it leaves out
      // keeps whatever is on the page. Derived names are dropped from the view
      // so the user sees exactly what they imported.
      renderAll({
        mappings:            parsed.mappings        || getMappingsFromDOM(),
        accountMappings:     parsed.accountMappings || getAccountMappingsFromDOM(),
        autoMappings:        {},
        autoAccountMappings: {},
        pairs:               propertyAccounts
      });

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

// ── Popup handoff ─────────────────────────────────────────────────────────────
// The popup cannot warn before it closes, so it stashes its rows (including the
// detected slugs its three-row cap never rendered) under local.pendingDetection.
// This consumes that stash exactly once, then clears it.

const HANDOFF_TTL_MS = 10 * 60 * 1000;

function mergeHandoffAccounts(entries) {
  let touched = 0;
  (entries || []).forEach(({ key, name }) => {
    if (!key) return;

    const group = groupFor(key);
    if (group) {
      // Already on the page: only fill a name the user has not set here
      const input = group.querySelector('.account-row .name-input');
      if (name && input && !input.value.trim()) {
        input.value = name;
        input.closest('.mapping-row').classList.add('is-detected');
        touched++;
      }
      return;
    }

    ensureGroup(key, name || '', { isDetected: true, animate: true });
    touched++;
  });
  return touched;
}

function mergeHandoffProperties(entries) {
  const existing = new Map();
  groupsList.querySelectorAll('.property-row').forEach((row) => {
    existing.set(row.querySelector('.slug-input').value.trim(), row);
  });

  let touched = 0;
  (entries || []).forEach(({ key, name }) => {
    if (!key) return;

    const row = existing.get(key);
    if (row) {
      const input = row.querySelector('.name-input');
      if (name && !input.value.trim()) {
        input.value = name;
        row.classList.add('is-detected');
        touched++;
      }
      return;
    }

    // Rows are appended in the order the popup sent them, so that order is
    // what the user sees. The group comes from the pairing the content script
    // recorded; without one the row lands in the catch-all.
    const group = ensureGroup(propertyAccounts[key] || UNGROUPED);
    existing.set(key, addPropertyRow(group, key, name || '', { isDetected: true, animate: true }));
    touched++;
  });
  return touched;
}

function consumeHandoff(done) {
  chrome.storage.local.get(['pendingDetection'], (result) => {
    if (chrome.runtime.lastError) { if (done) done(); return; }

    const pending = result.pendingDetection;
    chrome.storage.local.remove('pendingDetection', () => void chrome.runtime.lastError);

    if (!pending || typeof pending.ts !== 'number' ||
        Date.now() - pending.ts > HANDOFF_TTL_MS) {
      if (done) done();
      return;
    }

    // Accounts first, so a property handed over with a known account has a
    // group waiting for it rather than falling into the catch-all.
    const accounts = mergeHandoffAccounts(
      (pending.accounts || []).map(a => ({ key: a.id, name: a.name }))
    );
    const props = mergeHandoffProperties(
      (pending.properties || []).map(p => ({ key: p.slug, name: p.name }))
    );

    if (props + accounts > 0) {
      markDirty();
      showStatus(`Carried over ${props + accounts} row(s) from the popup. Save to apply.`, 'success');
    }
    if (done) done();
  });
}

// ── Auto-naming from the Chrome Web Store ─────────────────────────────────────
// A Chrome Web Store property slug IS the extension's ID, so the listing URL can
// be rebuilt from it and its title read back. The fetch itself lives in the
// service worker; this page owns the consent (setting + optional permission).

const autonameToggle = document.getElementById('autoname-toggle');
const toastHost      = document.getElementById('toast-host');
const fetchNamesBtn  = document.getElementById('fetch-names-btn');
const fetchBtnLabel  = document.getElementById('fetch-btn-label');
const managementToggle = document.getElementById('management-toggle');

const FETCH_BTN_LABEL = 'Fill missing names';

// chrome.management.get reports the name of any extension installed in this
// profile. It is the only way to derive an extension's name locally: Chrome
// blocks extensions from fetching the Web Store outright. See DECISIONS.md ADR-004.
const MANAGEMENT_PERMISSION = { permissions: ['management'] };
const EXTENSION_ID_RE = /^[a-p]{32}$/;
const LISTING_URL = (id) => `https://chromewebstore.google.com/detail/${id}`;

let autonameStatusTimer = null;

/**
 * The result of something the user asked for, spoken from the corner.
 *
 * It used to sit inside the toolbar, where a two-line result squeezed the
 * switch descriptions beside it down to one word per line. A toast cannot
 * move the page at all, and takes itself away afterwards. Progress does not
 * come through here: a running button says what it is doing itself.
 */
function showAutonameStatus(text, type = '') {
  clearTimeout(autonameStatusTimer);
  toastHost.replaceChildren();
  if (!text) return;

  const el = document.createElement('div');
  el.className = 'toast' + (type ? ` is-${type}` : '');
  el.textContent = text;
  toastHost.appendChild(el);

  // An error is the one worth reading twice, so it stays longer.
  autonameStatusTimer = setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 320);
  }, type === 'error' ? 9000 : 5500);
}

/** Put the work on the button doing it, instead of in a line of status text. */
function setFetchBusy(busy, text) {
  fetchNamesBtn.classList.toggle('is-running', busy);
  fetchNamesBtn.disabled = busy;
  fetchBtnLabel.textContent = busy ? text : FETCH_BTN_LABEL;
}

function setAutonameEnabled(on) {
  autonameToggle.checked = on;
  fetchNamesBtn.disabled = false; // always usable; hints need no permission
}

/** Reflects the live permission state, not just the stored flag. */
function setManagementEnabled(on) {
  managementToggle.checked = on;
}

managementToggle.addEventListener('change', () => {
  if (managementToggle.checked) {
    enableAutoName((granted) => { if (granted) fillMissingNames(); });
  } else {
    disableAutoName();
  }
});

/**
 * Turn auto-naming on. Requests the optional permission first: without it the
 * service worker refuses to look anything up, so persisting the setting alone
 * would leave a toggle that looks on but does nothing.
 */
function enableAutoName(onResult) {
  chrome.permissions.request(MANAGEMENT_PERMISSION, (granted) => {
    if (chrome.runtime.lastError || !granted) {
      setManagementEnabled(false);
      showAutonameStatus('Permission declined. Auto-naming stays off.', 'error');
      if (onResult) onResult(false);
      return;
    }
    chrome.storage.sync.set({ autoResolveNames: true }, () => {
      if (chrome.runtime.lastError) {
        setManagementEnabled(false);
        showAutonameStatus('Could not save the setting.', 'error');
        if (onResult) onResult(false);
        return;
      }
      setManagementEnabled(true);
      showAutonameStatus('Now also naming from your installed extensions.', 'success');
      if (onResult) onResult(true);
    });
  });
}

function disableAutoName() {
  chrome.storage.sync.set({ autoResolveNames: false }, () => void chrome.runtime.lastError);
  // Hand the permission back rather than keeping a grant we will not use.
  chrome.permissions.remove(MANAGEMENT_PERMISSION, () => void chrome.runtime.lastError);
  setManagementEnabled(false);
  showAutonameStatus('Permission given back. Names already filled in are kept.', 'success');
}

/**
 * The toggle drives on-page automatic naming, which is local, needs no
 * permission and is on by default. The separate `management` opt-in is handled
 * by the onboarding slide and by fillMissingNames(), not by this switch.
 */
autonameToggle.addEventListener('change', () => {
  const on = autonameToggle.checked;
  chrome.storage.local.set({ autoNamingEnabled: on }, () => {
    if (chrome.runtime.lastError) {
      showAutonameStatus('Could not save the setting.', 'error');
      return;
    }
    showAutonameStatus(on
      ? 'Automatic naming on. Open a GA4 property and it names itself.'
      : 'Automatic naming off. Existing names stay until you delete them.', 'success');
  });
});

/** Rows that carry a valid extension ID but no display name yet. */
function rowsAwaitingNames() {
  const out = [];
  groupsList.querySelectorAll('.property-row').forEach((row) => {
    const slug = row.querySelector('.slug-input').value.trim();
    const name = row.querySelector('.name-input').value.trim();
    if (slug && !name && EXTENSION_ID_RE.test(slug)) out.push({ row, slug });
  });
  return out;
}

/**
 * Names harvested by the content script from GA4's own report widgets. These
 * cost nothing, need no permission, and cover extensions that are not installed
 * locally, so they are applied before chrome.management is consulted.
 */
function applyNameHints(targets, hints) {
  let filled = 0;
  targets.forEach(({ row, slug }) => {
    const name = hints[slug];
    if (!name) return;
    const input = row.querySelector('.name-input');
    if (input.value.trim()) return;
    input.value = name;
    row.classList.add('is-suggested');
    filled++;
  });
  return filled;
}

function fillMissingNames() {
  chrome.storage.local.get(['nameHints'], (stored) => {
    const hints = (!chrome.runtime.lastError && stored.nameHints) || {};
    const hinted = applyNameHints(rowsAwaitingNames(), hints);
    if (hinted > 0) markDirty();
    fillFromManagement(hinted);
  });
}

function fillFromManagement(alreadyHinted) {
  const targets = rowsAwaitingNames();
  if (targets.length === 0) {
    if (alreadyHinted > 0) {
      showAutonameStatus(
        `Filled ${alreadyHinted} from your GA4 reports. Review, then Save Changes.`, 'success');
    } else {
      showAutonameStatus('No rows are waiting for a name.');
    }
    return;
  }

  setFetchBusy(true, `Checking ${targets.length}\u2026`);

  chrome.runtime.sendMessage(
    { action: 'resolveNames', ids: targets.map(t => t.slug) },
    (response) => {
      setFetchBusy(false);

      if (chrome.runtime.lastError || !response) {
        showAutonameStatus('Lookup failed. Try again.', 'error');
        return;
      }
      if (response.reason === 'no-permission' || response.reason === 'disabled') {
        setManagementEnabled(false);
        if (alreadyHinted > 0) {
          showAutonameStatus(
            `Filled ${alreadyHinted} from your GA4 reports. Turn on auto-naming to ` +
            `also name extensions installed here.`, 'success');
        } else {
          showAutonameStatus(
            'Nothing to name from your GA4 reports. Turn on auto-naming to use ' +
            'your installed extensions too.', 'error');
        }
        return;
      }

      const names = response.names || {};
      let filled = 0;
      targets.forEach(({ row, slug }) => {
        if (names[slug]) {
          row.querySelector('.name-input').value = names[slug];
          row.classList.add('is-suggested');
          filled++;
        } else {
          // Not installed here, so surface the link to its public listing
          row.querySelector('.listing-btn').classList.remove('is-hidden');
        }
      });

      const missed = targets.length - filled;
      const total  = filled + alreadyHinted;
      if (total === 0) {
        showAutonameStatus(
          `None of these ${targets.length} are installed in this profile, and your ` +
          `GA4 reports did not name them. Use the link on each row to open its listing.`, 'error');
        return;
      }
      markDirty();
      showAutonameStatus(
        `Filled ${total}${missed > 0 ? `, ${missed} still unnamed` : ''}. ` +
        `Review, then Save Changes.`, 'success'
      );
    }
  );
}


// ── Naming the properties the user has never opened ──────────────────────────
//
// A name is read out of a property's own "Page title and screen class" report,
// and GA4 renders only the property being viewed, so a property the user has
// never opened cannot be named. The onboarding slide asks them to click through
// their properties once; this does it for them (ADR-018).
//
// Two facts make it cheap. GA4's inlined account tree gives every property's
// numeric id, mirrored into `local.propertyIds` by the content script, so a URL
// can be built for a property that has never been visited. And a GA4 tab keeps
// rendering its reports while in the background, measured at under ten seconds
// to harvest a name, so this runs in a tab the user never sees and never has to
// look away from.
//
// Sequential on purpose: several GA4 tabs at once is a lot of load on someone
// else's servers to save a few seconds of something already running unattended.

const cycleBtn      = document.getElementById('cycle-btn');
const cycleBtnLabel = document.getElementById('cycle-btn-label');
const cycleStopBtn  = document.getElementById('cycle-stop-btn');

const CYCLE_BTN_LABEL = 'Visit and name the rest';

const CYCLE_TIMEOUT_MS = 30000;  // per property, then give up and move on
const CYCLE_POLL_MS    = 750;

let cycleRunning   = false;
let cycleCancelled = false;

const pSleep       = (ms)        => new Promise(r => setTimeout(r, ms));
const pLocal       = (keys)      => new Promise(r => chrome.storage.local.get(keys, r));
const pSync        = (keys)      => new Promise(r => chrome.storage.sync.get(keys, r));
const pTabsQuery   = (q)         => new Promise(r => chrome.tabs.query(q, (x) => { void chrome.runtime.lastError; r(x || []); }));
const pTabsCreate  = (props)     => new Promise(r => chrome.tabs.create(props, (x) => { void chrome.runtime.lastError; r(x || null); }));
const pTabsUpdate  = (id, props) => new Promise(r => chrome.tabs.update(id, props, (x) => { void chrome.runtime.lastError; r(x || null); }));
const pTabsRemove  = (id)        => new Promise(r => chrome.tabs.remove(id, () => { void chrome.runtime.lastError; r(); }));
const pTabsGet     = (id)        => new Promise(r => chrome.tabs.get(id, (x) => { void chrome.runtime.lastError; r(x || null); }));

/**
 * The origin, path and query to hang a property hash off.
 *
 * Taken from a GA4 tab the user already has open, when there is one, because
 * the query string carries `authuser`. Someone signed into several Google
 * accounts is looking at a specific one, and dropping that parameter would
 * open a different account's Analytics, where none of these properties exist.
 */
function ga4Base(openTabUrl) {
  const fallback = 'https://analytics.google.com/analytics/web/';
  if (!openTabUrl) return fallback;
  try {
    const u = new URL(openTabUrl);
    if (u.hostname !== 'analytics.google.com') return fallback;
    return u.origin + u.pathname + u.search;
  } catch (err) {
    return fallback;
  }
}

const ga4PropertyUrl = (base, t) =>
  `${base}#/a${t.accountId}p${t.propertyId}/reports/intelligenthome`;

/** Properties GA4 has told us about, that we can address, and that have no name. */
async function collectCycleTargets() {
  const sync  = await pSync(['mappings']);
  const local = await pLocal(['autoMappings', 'propertyAccounts', 'propertyIds']);
  const user  = sync.mappings || {};
  const auto  = local.autoMappings || {};
  const pairs = local.propertyAccounts || {};
  const ids   = local.propertyIds || {};

  return Object.keys(ids)
    .filter(slug => pairs[slug] && ids[slug] && !user[slug] && !auto[slug])
    .map(slug => ({ slug, accountId: pairs[slug], propertyId: ids[slug] }));
}

/** Poll until the content script files a name for this slug, or we give up. */
async function waitForName(slug, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cycleCancelled) return null;
    await pSleep(CYCLE_POLL_MS);
    const local = await pLocal(['autoMappings']);
    const name = (local.autoMappings || {})[slug];
    if (name) return name;
  }
  return null;
}

/**
 * While it runs, the button is the progress indicator: its label is replaced by
 * the property it is on, and Stop appears under it as its own control rather
 * than the button changing meaning under the cursor.
 */
function setCycleUi(running) {
  cycleBtn.classList.toggle('is-running', running);
  cycleBtn.disabled = running;
  cycleStopBtn.hidden = !running;
  cycleStopBtn.disabled = false;
  fetchNamesBtn.disabled = running;
  if (!running) cycleBtnLabel.textContent = CYCLE_BTN_LABEL;
}

/** Show a newly named property without re-rendering rows the user may be editing. */
function addNamedRow(slug, accountId, name) {
  propertyAccounts[slug] = accountId;
  addPropertyRow(ensureGroup(accountId || UNGROUPED), slug, name, { isAuto: true });
  markSharedAccounts();
}

async function runCycle() {
  const targets = await collectCycleTargets();
  if (targets.length === 0) {
    showAutonameStatus('Every property Google Analytics has told us about already has a name.');
    refreshCycleButton();
    return;
  }

  cycleRunning = true;
  cycleCancelled = false;
  setCycleUi(true);

  const open = await pTabsQuery({ url: 'https://analytics.google.com/*' });
  const base = ga4Base(open.length ? open[0].url : null);

  let tab = null;
  let named = 0;

  try {
    // Our own tab, opened in the background and closed at the end, so the
    // user's own GA4 tab is never navigated away from what they were reading.
    tab = await pTabsCreate({ url: ga4PropertyUrl(base, targets[0]), active: false });
    if (!tab) {
      showAutonameStatus('Could not open a Google Analytics tab.', 'error');
      return;
    }

    for (let i = 0; i < targets.length; i++) {
      if (cycleCancelled) break;
      const t = targets[i];
      cycleBtnLabel.textContent = `Visiting ${i + 1} of ${targets.length}\u2026`;

      if (i > 0) {
        if (!(await pTabsGet(tab.id))) { tab = null; break; }  // user closed it
        await pTabsUpdate(tab.id, { url: ga4PropertyUrl(base, t), active: false });
      }

      const name = await waitForName(t.slug, CYCLE_TIMEOUT_MS);
      if (name) {
        named++;
        addNamedRow(t.slug, t.accountId, name);
      }
    }
  } finally {
    if (tab) await pTabsRemove(tab.id);
    cycleRunning = false;
    setCycleUi(false);
  }

  const missed = targets.length - named;
  if (cycleCancelled) {
    showAutonameStatus(`Stopped. Named ${named} of ${targets.length}.`, named ? 'success' : '');
  } else if (missed === 0) {
    showAutonameStatus(`Named all ${named}. Review them, then Save Changes.`, 'success');
  } else if (named > 0) {
    showAutonameStatus(
      `Named ${named} of ${targets.length}. The other ${missed} had no store-listing views to read a name from.`);
  } else {
    showAutonameStatus(
      'Could not read any names. Check you are signed in to Google Analytics in this browser.', 'error');
  }
  refreshCycleButton();
}

/** Offer the button only when it has something to do, with the count on it. */
function refreshCycleButton() {
  if (!cycleBtn) return;
  collectCycleTargets().then((targets) => {
    if (cycleRunning) return;
    cycleBtn.hidden = targets.length === 0;
    cycleBtnLabel.textContent = targets.length === 1
      ? 'Visit and name 1 more'
      : `Visit and name ${targets.length} more`;
    cycleBtn.title =
      `Opens a background Google Analytics tab, visits ${targets.length} `
      + `unnamed propert${targets.length === 1 ? 'y' : 'ies'} in turn, and reads each name `
      + 'from its own report. Roughly 10 seconds each. You can keep working.';
  });
}

cycleBtn.addEventListener('click', () => {
  if (cycleRunning) return;
  runCycle();
});

cycleStopBtn.addEventListener('click', () => {
  if (!cycleRunning) return;
  cycleCancelled = true;
  cycleStopBtn.disabled = true;
  cycleBtnLabel.textContent = 'Stopping\u2026';
});

fetchNamesBtn.addEventListener('click', fillMissingNames);

function initAutoNameState(onReady) {
  chrome.storage.local.get(['autoNamingEnabled'], (local) => {
    const on = chrome.runtime.lastError ? true : local.autoNamingEnabled !== false;
    setAutonameEnabled(on);

    // Reconcile the separate management opt-in: the permission can be revoked
    // from chrome://extensions behind our back, so the live check wins over the
    // stored flag and a disagreement resets it.
    chrome.storage.sync.get(['autoResolveNames'], (syncResult) => {
      const wanted = !chrome.runtime.lastError && syncResult.autoResolveNames === true;
      chrome.permissions.contains(MANAGEMENT_PERMISSION, (granted) => {
        if (wanted && granted !== true) {
          chrome.storage.sync.set({ autoResolveNames: false }, () => void chrome.runtime.lastError);
        }
        const usable = wanted && granted === true;
        setManagementEnabled(usable);
        if (onReady) onReady(usable);
      });
    });
  });
}

// ── Welcome modal ─────────────────────────────────────────────────────────────

const WELCOME_VERSION = 2; // bump to re-show onboarding after a redesign
// 2 (2026-09-21): added the "open each property once" slide. Existing users
// have never been told the one thing they must actually do, so they are shown
// the onboarding again rather than left to work it out.

const overlay      = document.getElementById('welcome-overlay');
const slides       = Array.from(document.querySelectorAll('.slide'));
const dots         = Array.from(document.querySelectorAll('.dot'));
const welcomeBack  = document.getElementById('welcome-back');
const welcomeNext  = document.getElementById('welcome-next');
const welcomeDone  = document.getElementById('welcome-done');
const welcomeClose = document.getElementById('welcome-close');
const welcomeEnable = document.getElementById('welcome-enable');
const welcomeSkip   = document.getElementById('welcome-skip');

let slideIndex = 0;

function renderSlide() {
  slides.forEach((s, i) => s.classList.toggle('is-hidden', i !== slideIndex));
  dots.forEach((d, i) => d.classList.toggle('is-active', i === slideIndex));

  const isLast = slideIndex === slides.length - 1;
  welcomeBack.classList.toggle('is-hidden', slideIndex === 0);
  welcomeNext.classList.toggle('is-hidden', isLast);
  welcomeDone.classList.toggle('is-hidden', !isLast);
}

function openWelcome() {
  slideIndex = 0;
  renderSlide();
  overlay.classList.remove('is-hidden');
  welcomeNext.focus();
  document.addEventListener('keydown', onWelcomeKey);
}

function closeWelcome() {
  overlay.classList.add('is-hidden');
  document.removeEventListener('keydown', onWelcomeKey);
  chrome.storage.sync.set({ welcomeSeenVersion: WELCOME_VERSION }, () => void chrome.runtime.lastError);
}

function onWelcomeKey(e) {
  if (e.key === 'Escape') closeWelcome();
}

welcomeNext.addEventListener('click', () => {
  if (slideIndex < slides.length - 1) { slideIndex++; renderSlide(); }
});
welcomeBack.addEventListener('click', () => {
  if (slideIndex > 0) { slideIndex--; renderSlide(); }
});
welcomeDone.addEventListener('click', closeWelcome);
welcomeClose.addEventListener('click', closeWelcome);
welcomeSkip.addEventListener('click', closeWelcome);

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeWelcome();
});

welcomeEnable.addEventListener('click', () => {
  enableAutoName((granted) => {
    closeWelcome();
    if (granted) fillMissingNames();
  });
});

/**
 * The popup links here with #welcome (help) or #autoname (turn auto-naming on).
 * Anything else falls back to showing onboarding once per WELCOME_VERSION.
 */
function initWelcome(autoNameIsOn) {
  const hash = window.location.hash;

  if (hash === '#welcome') { openWelcome(); return; }

  if (hash === '#autoname') {
    if (autoNameIsOn) { fillMissingNames(); return; }
    slideIndex = slides.length - 1;   // land straight on the opt-in slide
    renderSlide();
    overlay.classList.remove('is-hidden');
    welcomeEnable.focus();
    document.addEventListener('keydown', onWelcomeKey);
    return;
  }

  chrome.storage.sync.get(['welcomeSeenVersion'], (result) => {
    if (chrome.runtime.lastError) return;
    if (result.welcomeSeenVersion === WELCOME_VERSION) return;
    openWelcome();
  });
}

// ── Load on startup ───────────────────────────────────────────────────────────

chrome.storage.sync.get(['mappings', 'accountMappings'], (result) => {
  const mappings        = (!chrome.runtime.lastError && result.mappings)        || {};
  const accountMappings = (!chrome.runtime.lastError && result.accountMappings) || {};
  if (chrome.runtime.lastError) showStatus('Could not load saved mappings.', 'error');

  chrome.storage.local.get(
    ['autoMappings', 'autoAccountMappings', 'propertyAccounts'],
    (local) => {
      const ok = !chrome.runtime.lastError;
      propertyAccounts = (ok && local.propertyAccounts) || {};

      renderAll({
        mappings,
        accountMappings,
        autoMappings:        (ok && local.autoMappings)        || {},
        autoAccountMappings: (ok && local.autoAccountMappings) || {},
        pairs:               propertyAccounts
      });
      markClean();

      // Strictly sequenced: the handoff rows must exist before initWelcome is
      // allowed to reach fillMissingNames(), or there is nothing for it to name.
      consumeHandoff(() => initAutoNameState(initWelcome));

      // Offered only when GA4 has told us about a property we cannot name yet.
      refreshCycleButton();
    }
  );
});

// ── Feedback form ─────────────────────────────────────────────────────────────
//
// Delivery note: the extension CANNOT talk to Resend directly. Resend needs an
// API key, and any key shipped inside an extension is readable by everyone who
// installs it, which would let anyone send mail as our domain. The key belongs
// on a server. So this form posts a plain JSON body to FEEDBACK_ENDPOINT, and
// that endpoint (see worker/feedback-worker.js) holds the key and calls Resend.
//
// The Worker replies with an Access-Control-Allow-Origin echoing this extension's
// own origin, so the POST satisfies CORS on its own and needs no host permission
// in the manifest. Keep it that way: a host permission here would buy nothing and
// cost a line on the store's permission list.
//
// If the endpoint is unreachable, misconfigured, or rate-limited, sendByEndpoint()
// falls back to opening a pre-filled email, so the form still works. Setting
// FEEDBACK_ENDPOINT back to '' returns the feature to mail-only.

const FEEDBACK_ENDPOINT = 'https://ga4nc-feedback.sunmooncal.workers.dev/feedback';
const FEEDBACK_TO       = 'support@palworks.ai';

const fbForm    = document.getElementById('feedback-form');
const fbName    = document.getElementById('fb-name');
const fbEmail   = document.getElementById('fb-email');
const fbMessage = document.getElementById('fb-message');
const fbSubmit  = document.getElementById('fb-submit');
const fbStatus  = document.getElementById('fb-status');
const fbDiag    = document.getElementById('fb-diagnostics');

let diagnostics = null;

/**
 * Installation details support needs to reproduce a problem. Deliberately
 * excludes everything about the user's analytics: no slugs, no names, no
 * account numbers, no URLs. Counts only.
 */
function collectDiagnostics(callback) {
  const manifest = chrome.runtime.getManifest();
  const base = {
    extension: `${manifest.name} v${manifest.version}`,
    extensionId: chrome.runtime.id,
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: (navigator.userAgentData && navigator.userAgentData.platform) || 'unknown',
    reportedAt: new Date().toISOString()
  };

  chrome.management.getSelf((self) => {
    if (!chrome.runtime.lastError && self) base.installType = self.installType;

    chrome.permissions.contains(MANAGEMENT_PERMISSION, (granted) => {
      base.managementPermission = chrome.runtime.lastError ? 'unknown' : !!granted;

      chrome.storage.sync.get(['mappings', 'accountMappings'], (sync) => {
        base.userPropertyMappings = Object.keys((!chrome.runtime.lastError && sync.mappings) || {}).length;
        base.userAccountMappings  = Object.keys((!chrome.runtime.lastError && sync.accountMappings) || {}).length;

        chrome.storage.local.get(
          ['autoMappings', 'autoAccountMappings', 'autoNamingEnabled', 'accountLabelLastMatched'],
          (local) => {
            if (!chrome.runtime.lastError) {
              base.autoPropertyNames  = Object.keys(local.autoMappings || {}).length;
              base.autoAccountNames   = Object.keys(local.autoAccountMappings || {}).length;
              base.autoNamingEnabled  = local.autoNamingEnabled !== false;
              base.accountLabelMatched = local.accountLabelLastMatched
                ? new Date(local.accountLabelLastMatched).toISOString()
                : 'never';
            }
            callback(base);
          }
        );
      });
    });
  });
}

function renderDiagnostics() {
  collectDiagnostics((d) => {
    diagnostics = d;
    fbDiag.textContent = Object.entries(d)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  });
}

function showFeedbackStatus(text, type = '') {
  fbStatus.textContent = text;
  fbStatus.className = 'status-msg' + (type ? ` is-${type}` : '');
}

function markInvalid(field, invalid) {
  field.classList.toggle('is-invalid', invalid);
}

function feedbackBody() {
  const lines = [
    `Name:  ${fbName.value.trim() || '(not given)'}`,
    `Email: ${fbEmail.value.trim()}`,
    '',
    fbMessage.value.trim(),
    '',
    '--- installation details ---',
    ...Object.entries(diagnostics || {}).map(([k, v]) => `${k}: ${v}`)
  ];
  return lines.join('\n');
}

/** No endpoint deployed: hand the composed message to the user's mail client. */
function sendByMail() {
  const subject = `GA4 Name Changer feedback from ${fbName.value.trim() || fbEmail.value.trim()}`;
  const url = `mailto:${FEEDBACK_TO}`
    + `?subject=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(feedbackBody())}`;
  chrome.tabs.create({ url });
  showFeedbackStatus('Opened in your email app. Press send there to finish.', 'success');
}

function sendByEndpoint() {
  fbSubmit.disabled = true;
  showFeedbackStatus('Sending…');

  fetch(FEEDBACK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: fbName.value.trim(),
      email: fbEmail.value.trim(),
      message: fbMessage.value.trim(),
      diagnostics
    })
  })
    .then((res) => {
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      fbForm.reset();
      renderDiagnostics();
      showFeedbackStatus('Thanks. Your feedback has been sent.', 'success');
    })
    .catch((err) => {
      showFeedbackStatus(`Could not send (${err.message}). Opening your email app instead…`, 'error');
      setTimeout(sendByMail, 1200);
    })
    .finally(() => { fbSubmit.disabled = false; });
}

if (fbForm) {
  renderDiagnostics();

  [fbEmail, fbMessage].forEach((field) => {
    field.addEventListener('input', () => markInvalid(field, false));
  });

  fbForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fbEmail.value.trim());
    const msgOk   = fbMessage.value.trim().length >= 10;

    markInvalid(fbEmail, !emailOk);
    markInvalid(fbMessage, !msgOk);

    if (!emailOk) { showFeedbackStatus('Please enter a valid email address.', 'error'); fbEmail.focus(); return; }
    if (!msgOk)   { showFeedbackStatus('Please write at least a sentence.', 'error'); fbMessage.focus(); return; }

    if (FEEDBACK_ENDPOINT) sendByEndpoint();
    else sendByMail();
  });
}
