'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Google Analytics (GA4) Name Changer for Chrome Extension Developers
// service worker
//
// Two jobs:
//   1. Open the settings page once on first install (onboarding).
//   2. Resolve Chrome extension IDs to extension names.
//
// On (2): a GA4 property slug for a Chrome Web Store developer property IS the
// extension's ID, so the name is derivable from what GA4 already renders.
//
// It is derived WITHOUT any network request. Chrome deliberately blocks
// extensions from fetching the Chrome Web Store (chromewebstore.google.com,
// chrome.google.com/webstore) and the CRX update endpoint
// (clients2.google.com/service/update2), so reading the public listing from
// here is not possible by design, not by oversight. See DECISIONS.md ADR-004.
//
// What works instead is chrome.management.get(), which reports the name of any
// extension installed in this profile. For a Chrome Web Store developer looking
// at their own analytics, that covers the extensions they actually run. Anything
// not installed locally is reported as unresolved, and the UI offers to open its
// public listing in a tab so the user can read the name themselves.
//
// Resolution is gated three ways and refuses unless all three hold:
//   a. the user turned on `autoResolveNames` (sync storage, default false)
//   b. the user granted the optional "management" permission
//   c. the requested string is a syntactically valid extension ID
// ─────────────────────────────────────────────────────────────────────────────

const MANAGEMENT_PERMISSION = { permissions: ['management'] };

// A Chrome extension ID is exactly 32 characters drawn from a-p (a base-16
// alphabet shifted into the letter range). Anything else is never looked up.
const EXTENSION_ID_RE = /^[a-p]{32}$/;

const MAX_IDS_PER_REQUEST = 100;

// ── First-run onboarding ─────────────────────────────────────────────────────

/**
 * Adopt Google Analytics tabs that were already open.
 *
 * Chrome injects a content script only into pages that load after the extension
 * does. A GA4 tab open at the moment of install, update or reload therefore has
 * no content script, and shows raw 32-character IDs until the user happens to
 * refresh it. Most users will read that as the extension being broken.
 *
 * So inject it into those tabs instead of asking them to refresh. Reloading the
 * tab for them was rejected: it throws away scroll position, an open report
 * configuration and any unsaved state on the page (ADR-017).
 *
 * Querying tabs by URL needs no `tabs` permission; Chrome allows it against
 * hosts the extension already has permission for, which is analytics.google.com
 * and nothing else. The same is true of what may be injected: `scripting` is
 * bounded by the declared host permissions.
 */
function adoptOpenGA4Tabs() {
  chrome.tabs.query({ url: GA4_TAB_MATCH }, (tabs) => {
    if (chrome.runtime.lastError || !tabs) return;

    tabs.forEach((tab) => {
      if (typeof tab.id !== 'number') return;

      // A tab that answers already has a live copy. Injecting a second one
      // would give the page two MutationObservers for no gain.
      chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
        // Reading lastError is what marks it handled; an unreachable tab is the
        // expected case here, not a fault.
        const noContentScript = !!chrome.runtime.lastError || !response;
        if (!noContentScript) return;

        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, files: ['content/content.js'] },
          () => { void chrome.runtime.lastError; }
        );
      });
    });
  });
}

const GA4_TAB_MATCH = 'https://analytics.google.com/*';

chrome.runtime.onInstalled.addListener((details) => {
  // install, update and developer reload all orphan the open tabs
  adoptOpenGA4Tabs();

  if (details.reason !== 'install') return;
  chrome.runtime.openOptionsPage();
});

// ── Toolbar badge ────────────────────────────────────────────────────────────
//
// A display-only extension has a real problem: once it works, the page looks
// like a page Google rendered correctly, so there is nothing to tell the user
// it is running. The badge is the answer, and it is the idiom users already
// read. It carries the number of distinct identifiers named on that tab.
//
// Per-tab, never global: the count belongs to one page. Chrome clears a
// tab-scoped badge when the tab navigates, so nothing has to be reset here
// when the user leaves Google Analytics.
//
// No new permission. `chrome.action` is granted by declaring `action` in the
// manifest, which this extension already does for its popup.

const BADGE_BG = '#4F46E5';
const BADGE_MAX = 99;

function setBadge(tabId, count) {
  const n = Number(count) || 0;
  const text = n <= 0 ? '' : (n > BADGE_MAX ? BADGE_MAX + '+' : String(n));

  chrome.action.setBadgeText({ tabId, text }, () => { void chrome.runtime.lastError; });
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BG },
    () => { void chrome.runtime.lastError; });

  chrome.action.setTitle({
    tabId,
    title: n <= 0
      ? 'GA4 Name Changer — nothing to rename on this page yet'
      : `GA4 Name Changer — ${n} name${n === 1 ? '' : 's'} applied on this page`
  }, () => { void chrome.runtime.lastError; });
}

// ── Gating ───────────────────────────────────────────────────────────────────

function isEnabled() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['autoResolveNames'], (result) => {
      if (chrome.runtime.lastError) { resolve(false); return; }
      resolve(result.autoResolveNames === true);
    });
  });
}

function hasPermission() {
  return new Promise((resolve) => {
    chrome.permissions.contains(MANAGEMENT_PERMISSION, (granted) => {
      if (chrome.runtime.lastError) { resolve(false); return; }
      resolve(granted === true);
    });
  });
}

// ── Single lookup ────────────────────────────────────────────────────────────

/**
 * Resolve one extension ID to its name, or null if it is not installed in this
 * profile. chrome.management.get sets lastError rather than throwing for an
 * unknown ID, so the callback must read it before touching the result.
 */
function lookupName(id) {
  return new Promise((resolve) => {
    try {
      chrome.management.get(id, (info) => {
        if (chrome.runtime.lastError || !info || !info.name) { resolve(null); return; }
        resolve(info.name);
      });
    } catch (err) {
      // Permission revoked between the gate check and here.
      resolve(null);
    }
  });
}

// ── Batch resolver ───────────────────────────────────────────────────────────

async function resolveNames(rawIds) {
  const ids = Array.from(new Set(
    (Array.isArray(rawIds) ? rawIds : [])
      .filter(id => typeof id === 'string' && EXTENSION_ID_RE.test(id))
  )).slice(0, MAX_IDS_PER_REQUEST);

  if (ids.length === 0) return { names: {}, unresolved: [], reason: 'no-valid-ids' };

  if (!await isEnabled())     return { names: {}, unresolved: ids, reason: 'disabled' };
  if (!await hasPermission()) return { names: {}, unresolved: ids, reason: 'no-permission' };

  // Local lookups, so there is no rate limit to respect and no cache to keep:
  // reading live means a renamed extension is never reported under a stale name.
  const names = {};
  const unresolved = [];

  const results = await Promise.all(ids.map(lookupName));
  results.forEach((name, i) => {
    if (name) names[ids[i]] = name;
    else unresolved.push(ids[i]);
  });

  return { names, unresolved, reason: 'ok' };
}

// ── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  // Reported by the content script after each pass. Fire and forget: the badge
  // is cosmetic, and a tab that has gone away is not an error worth raising.
  if (msg.action === 'namesApplied') {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId === 'number') setBadge(tabId, msg.count);
    return false;
  }

  if (msg.action !== 'resolveNames') return false;

  resolveNames(msg.ids)
    .then(sendResponse)
    .catch(() => sendResponse({ names: {}, unresolved: [], reason: 'error' }));

  return true; // keep the message channel open for the async reply
});
