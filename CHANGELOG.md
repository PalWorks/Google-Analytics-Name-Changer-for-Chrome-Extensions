# Changelog

All notable changes to Google Analytics (GA4) Name Changer for Chrome Extension Developers are documented here.

---

## [1.1.0] — 2026-09-18

Auto-naming, onboarding, and a documentation set for contributors and agents.

### Added

- **Name harvesting from GA4's own reports** — the primary naming source, and it costs nothing. A Chrome Web Store developer property's "Page title and screen class" report lists the store listing pages that were viewed, titled `<Extension Name> - <localised store name>`, so the extension's real name is already on the page. Titles are split on the last `" - "` (which strips the store suffix in any language and preserves names containing `" - "`), generic store pages are dropped, and the remainder ranked by views. Hints accumulate in `chrome.storage.local.nameHints` as the user browses, so visiting a property once names it permanently. Needs no permission and no network. A hint is only recorded when exactly one property slug is visible, so an open account switcher never causes a mislabel
- **Multi-account detection** — the popup previously detected only the account in the URL, so the other accounts listed in GA4's account switcher were invisible to it. All of them are now detected, paired with their labels, and a property ID sitting next to a slug is correctly never offered as an account
- **Cross-tab detection** — opening the popup from a non-GA4 tab now finds a GA4 tab elsewhere in the same window instead of falling back to cached context. Needs no new permission: Chrome exposes `url` for tabs matching host permissions the extension already holds
- **Account names suggested from their property** — a Chrome Web Store developer account holds one extension, so when a single account and a single named property are on screen the account is suggested a shortened form of the extension's name
- **Auto-naming from installed extensions** — a Chrome Web Store property slug is the extension's own ID, so any of those extensions installed in this Chrome profile can be named automatically via `chrome.management.get()`. Off by default and gated behind the optional `management` permission; turning it off calls `chrome.permissions.remove()`. Resolution is entirely local, so the extension still makes no network requests of any kind. Only `get` is ever called, and only the `name` field read
- **Chrome Web Store listing link** — anything neither harvesting nor `chrome.management` could name reveals a button on its row that opens the public store listing in a new tab for the user to read the name from
- **Service worker (`background.js`)** — hosts name resolution behind three independent gates: the setting, the live permission check, and an `/^[a-p]{32}$/` format check. Also opens the settings page on first install
- **Welcome modal** — two-slide onboarding on the options page, opened automatically on first install via `chrome.runtime.onInstalled`, and reachable any time from the popup's new **?** button. Slide 2 is the auto-naming opt-in and states exactly what the permission is and is not used for
- **Fill missing names** — options-page button that resolves every row holding a valid extension ID with no display name yet. Suggested names render italic until reviewed and saved
- **Popup → options handoff** — the popup stashes its rows under `chrome.storage.local.pendingDetection` before navigating to Full Settings, and the options page merges them in once and clears the key. TTL 10 minutes
- **Documentation set** — `AGENTS.md` (hard invariants and contributor contract), `DOMAIN.md` (the four identifiers and storage keys), `DECISIONS.md` (eight ADRs), `PLAYBOOK.md` (setup, manual test checklist, debugging, release, rollback), `LIMITATIONS.md` (known constraints and technical debt), `SECURITY.md` (threat model and reporting)

- **Automatic naming with no save step** — derived names live in `chrome.storage.local.autoMappings` and are merged **under** the user's own `sync.mappings`, so they apply to the page immediately while anything the user typed still wins. The content script watches local storage, so a name lands the moment it is derived. `mappings` is never written to by the extension, so nothing the user owns is clobbered or synced without them asking. Auto rows show badged "auto" in both surfaces and are ordinary editable rows, so **Save** now means "make this mine". `autoNamingEnabled` (default on) turns the layer off without deleting anything
- **GA4's own account tree as the authoritative source** — every GA4 page inlines `window.preload = JSON.parse(...)` carrying every account ID, property ID and property slug with exact pairing. A content script cannot read page JS variables but can read that script element's text. This gives the current property exactly (via the property ID in the URL), every account without opening the switcher, and every property slug. It fixed a real deadlock: on one live page the slug was rendered only inside a `<button>`, so scraping could not attribute it and nothing was ever named
- **Robust name extraction** — no longer depends on one particular report table. Two independent strategies feed one score: page-title report tables weighted by views, and any store-listing-shaped text anywhere on the page. A title is recognised by its tail containing "Chrome", which held across every localisation seen live (Web Store, ウェブストア, 線上應用程式商店, Web Mağazası, Webáruház, 应用商店, 웹 스토어) and cleanly rejects the store's own pages, since "Chrome Web Store - Extensions" has a tail of "Extensions". A tie between two names returns nothing rather than guessing
- **"How are these names worked out?"** — a collapsible card on the options page explaining the three naming sources in short form
- **Feedback form** — name, email, optional phone and message, with installation diagnostics attached. The extension never holds the Resend API key; it posts to a relay Worker that does, and falls back to a pre-filled `mailto:` when no endpoint is configured, so it works with no infrastructure and no permission

### Fixed

- **Unsaved popup edits were silently discarded.** Clicking **Full Settings** closed the popup without preserving anything typed into it. Extension popups do not fire `beforeunload`, so the `isDirty` guard used by the options page is unavailable; the `pendingDetection` handoff replaces it
- **Accounts holding more than one extension were named wrongly.** An account is now only named after its extension when GA4's tree confirms it holds exactly one property; one live test account holds two
- **The slug overflow note was untrue.** It directed the user to Full Settings to map the remaining slugs, but those slugs existed only in popup memory and were never carried anywhere. The handoff now carries every detected slug, including the ones beyond the three-row display cap

### Changed

- The options page row factory gained the `is-detected` and `is-suggested` states the popup already had, plus a shared row actions cell, and editing a row clears both hints
- `privacy.html` updated for the optional permission, and its "no network requests" claim restated as unconditional, which it now is
- `README.md` and `ARCHITECTURE.md` updated for the service worker, handoff, welcome modal, new storage keys and revised permission set

### Removed

- The checked-in `dist/` directory and `dist.zip`. They were byte-identical hand-maintained copies of the source, gitignored so drift would have been invisible, and carried a real risk of shipping a stale build. Packaging now runs from the repository root against `.crxignore`; the exact command is in `PLAYBOOK.md`

### Verified against live GA4

Detection, harvesting, multi-account scanning and the cross-tab fallback were all exercised against a real Chrome Web Store developer account with four accounts and two properties. Harvesting produced the correct extension name; the account switcher produced all four account IDs; the single-slug guard correctly declined to record a hint while the switcher was open.

### Notes

An earlier implementation of auto-naming fetched the extension's public Chrome Web Store listing and parsed its title. That approach was completed and then discarded: **Chrome blocks extension-initiated requests to `chromewebstore.google.com`, `chrome.google.com/webstore` and `clients2.google.com/service/update2`**, even with the host permission granted, while every other origin succeeds. It is a deliberate platform protection. `DECISIONS.md` ADR-004 records the measurements so the approach is not attempted again. `minimum_chrome_version` stays at `88` as a result, since the `optional_host_permissions` key that briefly required `102` is no longer used.

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
