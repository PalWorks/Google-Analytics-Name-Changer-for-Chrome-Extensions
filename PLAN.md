# GA4 Name Changer — Implementation Plan

## Problem
Google Analytics 4 (GA4) shares properties from the Chrome Web Store using opaque extension ID slugs
(e.g. `egedbdckafdbomehjaihjhbcgmngmlah`) instead of human-readable extension names. This extension
lets developers map those slugs to readable names, replacing them live inside the GA4 interface.

## File Structure
```
ga4-name-changer/
├── manifest.json            — MV3 manifest (minimal permissions)
├── privacy.html             — Privacy policy page (required for Chrome Web Store)
├── PLAN.md                  — This file
├── icons/
│   ├── generate-icons.html  — Open in Chrome once to generate + download PNGs
│   ├── icon16.png           — Generated output
│   ├── icon48.png           — Generated output
│   └── icon128.png          — Generated output
├── options/
│   ├── options.html         — Settings UI
│   ├── options.css          — Minimalist Apple/Google-style design
│   └── options.js           — CRUD for slug→name mappings, save, export/import
└── content/
    └── content.js           — MutationObserver-based text replacer for analytics.google.com
```

## Architecture

### Permissions (minimal footprint for store review)
- `"storage"` — for chrome.storage.sync
- `host_permissions: ["https://analytics.google.com/*"]` — scoped to GA4 only
- No background service worker needed

### Storage Schema
```json
{ "mappings": { "slug1": "Name 1", "slug2": "Name 2" } }
```
Stored in `chrome.storage.sync` — syncs across signed-in Chrome profiles automatically.
Practical limit: ~500 mappings well within the 100KB sync quota.

### Content Script Strategy
1. Load `mappings` from `chrome.storage.sync` on page load
2. Build a sorted `Map<slug, name>` (longest-first to prevent partial-match collisions)
3. Walk all text nodes via `TreeWalker`, replace slug occurrences using `node.nodeValue`
4. `MutationObserver` (childList + subtree) watches for new DOM nodes added by GA4's React SPA
5. Debounce mutations at 80ms — batches React's rapid re-render bursts
6. `WeakSet` tracks processed text nodes to prevent redundant re-walks
7. `chrome.storage.onChanged` listener refreshes mappings in real-time (no tab reload needed)

Key safety detail: `node.nodeValue = newText` creates a `characterData` mutation, NOT a
`childList` mutation — our observer only watches `childList`, so our own writes never trigger
re-observation. No disconnect/reconnect needed.

### Options Page
- Full-tab (`open_in_tab: true`) for comfortable editing
- Two-column grid: Slug (monospace) | Display Name
- Rows are dynamically added/removed
- Explicit **Save** button with "Saved!" toast
- **beforeunload** guard prevents accidental tab close with unsaved changes
- Export / Import JSON buttons for backup and sharing
- Empty state with call-to-action when no mappings exist

### Icon Design
- 128×128, 48×48, 16×16 PNG
- Indigo-to-violet gradient background (#6366F1 → #8B5CF6)
- White tag/label icon centered (classic "naming/labelling" metaphor)
- Generated via `icons/generate-icons.html` (Canvas API, no build tools required)

## Design System (Options Page)
| Token           | Value                                                              |
|-----------------|--------------------------------------------------------------------|
| Background      | `#f5f5f7`                                                          |
| Card            | `#ffffff`                                                          |
| Border          | `#e8e8ed`                                                          |
| Text primary    | `#1d1d1f`                                                          |
| Text secondary  | `#6e6e73`                                                          |
| Accent          | `#4F46E5` (indigo)                                                 |
| Danger          | `#FF3B30`                                                          |
| Success         | `#34C759`                                                          |
| Font            | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI"`     |
| Font (slug)     | `"SF Mono", "Fira Code", "Roboto Mono", monospace`                 |
| Border radius   | `12px` (cards), `8px` (inputs/buttons)                             |
| Shadow          | `0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06)`         |

## Execution Order
1. `manifest.json`
2. `icons/generate-icons.html` (icon generator)
3. `options/options.html`
4. `options/options.css`
5. `options/options.js`
6. `content/content.js`
7. `privacy.html`
8. Self-audit all files for correctness, security, and Chrome Web Store compliance

## Chrome Web Store Publishing Checklist
- [ ] Manifest V3 compliant
- [ ] Minimal permissions (storage + scoped host_permission only)
- [ ] Single purpose policy: renames GA4 property slugs
- [ ] No remote code execution
- [ ] Privacy policy URL provided
- [ ] Icons: 16, 48, 128px PNG
- [ ] Screenshots: Options page + GA4 before/after (1280×800 recommended)
- [ ] Store description ≤132 chars short, full description in listing
