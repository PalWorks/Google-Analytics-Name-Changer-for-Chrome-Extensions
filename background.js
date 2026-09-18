'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// GA4 Name Changer service worker
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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  chrome.runtime.openOptionsPage();
});

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
  if (!msg || msg.action !== 'resolveNames') return false;

  resolveNames(msg.ids)
    .then(sendResponse)
    .catch(() => sendResponse({ names: {}, unresolved: [], reason: 'error' }));

  return true; // keep the message channel open for the async reply
});
