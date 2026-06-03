# Changelog

All notable changes to GA4 Name Changer are documented here.

---

## [1.0.0] — 2026-06-03

### Added

- **GA4 Property Name mapping** — map 32-char extension slugs (or any property identifier) to readable names
- **GA4 Account Number mapping** — replace the generic "Chrome Web Store developer properties" label with a custom name per account, keyed on the 9-digit GA4 account ID
- **Compound account-label pass** — `pairAccountLabels()` finds the "Chrome Web Store developer properties" text node that is adjacent to a known account ID in the DOM and replaces them as a pair, giving each account row a unique readable label
- **SPA-aware content script** — MutationObserver with `characterData: true` catches GA4's React re-renders that update text nodes in-place (not just newly inserted nodes)
- **Loop prevention** — `ourWrittenNodes` WeakSet distinguishes extension-originated `characterData` mutations from GA4-originated ones, preventing infinite replacement loops
- **Longest-slug-first matching** — slugMap entries sorted by descending key length to prevent partial-match collisions between overlapping slugs
- **Two-column Options page** — separate cards for Account Number mappings and Property Name mappings, rendered side-by-side
- **Explicit Save button** with `beforeunload` guard to prevent accidental data loss
- **Import / Export JSON** — round-trips both `mappings` and `accountMappings` keys
- **Storage quota pre-check** — validates serialised byte size against `chrome.storage.sync.QUOTA_BYTES_PER_ITEM` before attempting to save
- **Import validation** — file size cap (512 KB), entry count cap (200 per table), string length cap (256 chars)
- **Toolbar icon action** — clicking the extension icon opens the Options page directly via `background.js` service worker
- **Canvas-based icon generator** — `icons/generate-icons.html` produces icon PNGs at 16 px, 48 px, and 128 px without a build tool
- **Privacy policy page** — `privacy.html` ready for hosting as a Chrome Web Store privacy policy URL

### Technical notes

- Manifest V3 with `permissions: ["storage"]` and `host_permissions` scoped to `analytics.google.com`
- `chrome.storage.sync` for cross-profile persistence; keys: `mappings` and `accountMappings`
- `NodeFilter.SHOW_TEXT` TreeWalker; `SKIP_TAGS` covers `SCRIPT`, `STYLE`, `TEXTAREA`, `NOSCRIPT`, `IFRAME`, `INPUT`, `SELECT`, `OPTION`, `BUTTON`
- Pending debounce batch cancelled on full `replaceAll()` to avoid redundant post-flush work
- `chrome.storage.onChanged` listener guarded against startup race (`if (!observer) return`)
- `minimum_chrome_version: "88"` declared in manifest
