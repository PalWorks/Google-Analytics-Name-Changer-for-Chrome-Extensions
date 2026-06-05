# Changelog

All notable changes to GA4 Name Changer are documented here.

---

## [1.0.0] — 2026-06-05

Initial public release.

### Extension features

- **GA4 property slug mapping** — map any GA4 property slug (32-char lowercase strings shared with CWS developers) to a human-readable name; replacements applied live as GA4 renders
- **GA4 account number mapping** — replace the generic "Chrome Web Store developer properties" label with a per-account display name, keyed on the 9-digit GA4 account ID; the numeric ID is preserved and rendered beneath the display name
- **Toolbar popup** — left-clicking the extension icon opens a compact 460 px popup with the full mapping editor; includes a close button and Full Settings shortcut
- **GA4 auto-detection** — on a GA4 tab, the popup queries the content script for the current account ID (parsed from the URL hash) and any unmapped property slugs visible in the DOM, pre-filling rows for immediate naming
- **Non-GA4 tab fallback** — when the popup is opened on a non-GA4 tab, it shows the most recently cached GA4 context (`chrome.storage.local.lastGA4Context`) so mappings remain accessible from any tab
- **Slug overflow note** — if more than three unmapped slugs are detected, an overflow notice in the popup tells the user how many additional slugs were found and directs them to Full Settings
- **Full settings page** — dedicated full-tab page (`open_in_tab: true`) with the same mapping editor and additional vertical space; reachable from the popup header or `chrome://extensions` → Options
- **Account-label health monitor** — the content script writes a `accountLabelLastMatched` heartbeat to `chrome.storage.local` whenever it successfully replaces a GA4 account label; the popup reads this on open and surfaces an orange warning if the label has not matched in 90+ days (early signal that Google renamed the UI element)
- **Import / Export JSON** — round-trips both `mappings` and `accountMappings` keys; import validates entry count (max 200), key/value length (max 256 chars), and file size (max 512 KB) before reading

### Technical notes

- Manifest V3; `permissions: ["storage"]`; `host_permissions` scoped to `https://analytics.google.com/*`; explicit `content_security_policy: script-src 'self'`
- MutationObserver configured with `childList + subtree + characterData` to catch both new DOM nodes and GA4's React-driven in-place text node updates
- `ourWrittenNodes` WeakSet prevents infinite characterData mutation loops from the extension's own `nodeValue` writes
- `slugMap` sorted longest-key-first to prevent partial-match collisions across overlapping slugs
- 80 ms debounce aggregates rapid React render bursts; `replaceAll()` cancels any pending debounce before executing a full-page pass
- `chrome.storage.onChanged` listener guarded against startup race: ignored if the MutationObserver hasn't been created yet
- `chrome.storage.sync.QUOTA_BYTES_PER_ITEM` pre-check before every save to surface quota errors explicitly
- `chrome.runtime.lastError` guards on all async storage and messaging callbacks
- `chrome.tabs.query` used for popup → content script messaging; `tabs` permission not required (only `tab.id` is accessed, not `url` or `title`)
- `minimum_chrome_version: "88"` declared in manifest
