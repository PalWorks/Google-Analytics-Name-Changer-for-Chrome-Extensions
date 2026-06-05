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
const closeBtn        = document.getElementById('close-btn');
const detectionBanner = document.getElementById('detection-banner');
const detectionText   = document.getElementById('detection-text');

// ── State ─────────────────────────────────────────────────────────────────────

let isDirty = false;

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

  // Remove the detected highlight once the user starts editing
  slugInput.addEventListener('input', () => { row.classList.remove('is-detected'); markDirty(); });
  nameInput.addEventListener('input', () => { row.classList.remove('is-detected'); markDirty(); });

  if (animate) {
    row.addEventListener('animationend', () => row.classList.remove('is-new'), { once: true });
  }

  row.appendChild(slugInput);
  row.appendChild(nameInput);
  row.appendChild(deleteBtn);
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

// ── Header action buttons ─────────────────────────────────────────────────────

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

closeBtn.addEventListener('click', () => window.close());

// ── GA4 auto-detection ────────────────────────────────────────────────────────

function addDetectedAccountRow(accountId, currentAccountMappings) {
  if (currentAccountMappings[accountId]) return; // already mapped — skip
  const empty = document.getElementById('account-empty-state');
  if (empty) empty.remove();
  const row = createAccountRow(accountId, '', true, true);
  // Insert before existing rows so it's immediately visible
  accountList.insertBefore(row, accountList.firstChild);
  row.querySelector('.name-input').focus();
  markDirty();
}

function addDetectedSlugRows(slugs, currentMappings) {
  const newSlugs = (slugs || []).filter(s => !currentMappings[s]);
  const toShow   = newSlugs.slice(0, 3);
  const overflow = newSlugs.length - toShow.length;

  if (toShow.length === 0) return;

  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  // Reverse so newSlugs[0] lands at list.firstChild after all insertions
  toShow.slice().reverse().forEach(slug => {
    const row = createRow(slug, '', true, true);
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
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) { loadLastContext(); return; }

    chrome.tabs.sendMessage(tab.id, { action: 'getGA4Data' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        // Not a GA4 tab (no content script) — fall back to cached context
        loadLastContext();
        return;
      }

      const { accountId, slugs } = response;
      const accountLabel = accountId ? `· Account ${accountId}` : '';
      showDetectionBanner(`GA4 page detected ${accountLabel}`.trim(), 'live');

      if (accountId) addDetectedAccountRow(accountId, currentAccountMappings);
      addDetectedSlugRows(slugs, currentMappings);
      // If no account row stole focus, land on the first detected slug's name field
      if (!accountId) {
        const firstSlug = list.querySelector('.is-detected');
        if (firstSlug) firstSlug.querySelector('.name-input').focus();
      }
    });
  });
}

function loadLastContext() {
  chrome.storage.local.get(['lastGA4Context'], (result) => {
    if (chrome.runtime.lastError || !result.lastGA4Context) return;
    const { accountId } = result.lastGA4Context;
    if (accountId) {
      showDetectionBanner(`Last seen · Account ${accountId}`, 'cached');
    }
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
