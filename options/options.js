'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const list           = document.getElementById('mappings-list');
const accountList    = document.getElementById('account-list');
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

// ── Generic row factory ───────────────────────────────────────────────────────

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

  // Clear the detected/suggested highlights once the user edits the row
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
    slugPlaceholder: 'egedbdckafdbomehjaihjhbcgmngmlah',
    slugAriaLabel: 'GA4 property name',
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
      ? 'Add your GA4 account numbers to rename account labels.'
      : 'Click "Add Mapping" to rename your first property slug.'
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

// ── Add mapping buttons ───────────────────────────────────────────────────────

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

// ── Popup handoff ─────────────────────────────────────────────────────────────
// The popup cannot warn before it closes, so it stashes its rows (including the
// detected slugs its three-row cap never rendered) under local.pendingDetection.
// This consumes that stash exactly once, then clears it.

const HANDOFF_TTL_MS = 10 * 60 * 1000;

function mergeHandoffRows(entries, targetList, factory, emptyStateId) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  const existing = new Map();
  targetList.querySelectorAll('.mapping-row').forEach((row) => {
    existing.set(row.querySelector('.slug-input').value.trim(), row);
  });

  let touched = 0;
  // Reversed, because each new row is inserted at the top: iterating backwards
  // leaves the incoming rows in their original popup order.
  entries.slice().reverse().forEach(({ key, name }) => {
    if (!key) return;
    const row = existing.get(key);

    if (row) {
      // Already on the page: only fill a name the user has not set here
      const nameInput = row.querySelector('.name-input');
      if (name && !nameInput.value.trim()) {
        nameInput.value = name;
        row.classList.add('is-detected');
        touched++;
      }
      return;
    }

    const empty = document.getElementById(emptyStateId);
    if (empty) empty.remove();
    const newRow = factory(key, name || '', true, true);
    targetList.insertBefore(newRow, targetList.firstChild);
    existing.set(key, newRow);
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

    const props = mergeHandoffRows(
      (pending.properties || []).map(p => ({ key: p.slug, name: p.name })),
      list, createRow, 'empty-state'
    );
    const accounts = mergeHandoffRows(
      (pending.accounts || []).map(a => ({ key: a.id, name: a.name })),
      accountList, createAccountRow, 'account-empty-state'
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
const autonameStatus = document.getElementById('autoname-status');
const fetchNamesBtn  = document.getElementById('fetch-names-btn');

// chrome.management.get reports the name of any extension installed in this
// profile. It is the only way to derive an extension's name locally: Chrome
// blocks extensions from fetching the Web Store outright. See DECISIONS.md ADR-004.
const MANAGEMENT_PERMISSION = { permissions: ['management'] };
const EXTENSION_ID_RE = /^[a-p]{32}$/;
const LISTING_URL = (id) => `https://chromewebstore.google.com/detail/${id}`;

let autonameStatusTimer = null;

function showAutonameStatus(text, type = '') {
  clearTimeout(autonameStatusTimer);
  autonameStatus.textContent = text;
  autonameStatus.className = 'status-msg' + (type ? ` is-${type}` : '');
  if (type === 'success') {
    autonameStatusTimer = setTimeout(() => {
      autonameStatus.textContent = '';
      autonameStatus.className = 'status-msg';
    }, 4000);
  }
}

function setAutonameEnabled(on) {
  autonameToggle.checked = on;
  fetchNamesBtn.disabled = !on;
}

/**
 * Turn auto-naming on. Requests the optional permission first: without it the
 * service worker refuses to look anything up, so persisting the setting alone
 * would leave a toggle that looks on but does nothing.
 */
function enableAutoName(onResult) {
  chrome.permissions.request(MANAGEMENT_PERMISSION, (granted) => {
    if (chrome.runtime.lastError || !granted) {
      setAutonameEnabled(false);
      showAutonameStatus('Permission declined. Auto-naming stays off.', 'error');
      if (onResult) onResult(false);
      return;
    }
    chrome.storage.sync.set({ autoResolveNames: true }, () => {
      if (chrome.runtime.lastError) {
        setAutonameEnabled(false);
        showAutonameStatus('Could not save the setting.', 'error');
        if (onResult) onResult(false);
        return;
      }
      setAutonameEnabled(true);
      showAutonameStatus('Auto-naming on.', 'success');
      if (onResult) onResult(true);
    });
  });
}

function disableAutoName() {
  chrome.storage.sync.set({ autoResolveNames: false }, () => void chrome.runtime.lastError);
  // Hand the permission back rather than keeping a grant we will not use.
  chrome.permissions.remove(MANAGEMENT_PERMISSION, () => void chrome.runtime.lastError);
  setAutonameEnabled(false);
  showAutonameStatus('Auto-naming off.', 'success');
}

autonameToggle.addEventListener('change', () => {
  if (autonameToggle.checked) enableAutoName();
  else disableAutoName();
});

/** Rows that carry a valid extension ID but no display name yet. */
function rowsAwaitingNames() {
  const out = [];
  list.querySelectorAll('.mapping-row').forEach((row) => {
    const slug = row.querySelector('.slug-input').value.trim();
    const name = row.querySelector('.name-input').value.trim();
    if (slug && !name && EXTENSION_ID_RE.test(slug)) out.push({ row, slug });
  });
  return out;
}

function fillMissingNames() {
  const targets = rowsAwaitingNames();
  if (targets.length === 0) {
    showAutonameStatus('No rows are waiting for a name.');
    return;
  }

  fetchNamesBtn.disabled = true;
  showAutonameStatus(`Checking ${targets.length} extension(s)…`);

  chrome.runtime.sendMessage(
    { action: 'resolveNames', ids: targets.map(t => t.slug) },
    (response) => {
      fetchNamesBtn.disabled = false;

      if (chrome.runtime.lastError || !response) {
        showAutonameStatus('Lookup failed. Try again.', 'error');
        return;
      }
      if (response.reason === 'no-permission' || response.reason === 'disabled') {
        setAutonameEnabled(false);
        showAutonameStatus('Auto-naming is off. Turn it on first.', 'error');
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
      if (filled === 0) {
        showAutonameStatus(
          `None of these ${targets.length} are installed in this profile. ` +
          `Use the link on each row to open its Chrome Web Store listing.`, 'error');
        return;
      }
      markDirty();
      showAutonameStatus(
        `Filled ${filled}${missed > 0 ? `, ${missed} not installed here` : ''}. ` +
        `Review, then Save Changes.`, 'success'
      );
    }
  );
}

fetchNamesBtn.addEventListener('click', fillMissingNames);

function initAutoNameState(onReady) {
  chrome.storage.sync.get(['autoResolveNames'], (syncResult) => {
    const wanted = !chrome.runtime.lastError && syncResult.autoResolveNames === true;
    chrome.permissions.contains(MANAGEMENT_PERMISSION, (granted) => {
      // The permission can be revoked from chrome://extensions behind our back,
      // so the granted state, not the stored flag, is what the UI reflects.
      const on = wanted && granted === true && !chrome.runtime.lastError;
      if (wanted && !on) {
        chrome.storage.sync.set({ autoResolveNames: false }, () => void chrome.runtime.lastError);
      }
      setAutonameEnabled(on);
      if (onReady) onReady(on);
    });
  });
}

// ── Welcome modal ─────────────────────────────────────────────────────────────

const WELCOME_VERSION = 1; // bump to re-show onboarding after a redesign

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
  if (chrome.runtime.lastError) {
    showStatus('Could not load saved mappings.', 'error');
    renderMappings({});
    renderAccountMappings({});
    return;
  }
  renderMappings(result.mappings);
  renderAccountMappings(result.accountMappings);
  markClean();

  // Strictly sequenced: the handoff rows must exist before initWelcome is
  // allowed to reach fillMissingNames(), or there is nothing for it to name.
  consumeHandoff(() => initAutoNameState(initWelcome));
});
