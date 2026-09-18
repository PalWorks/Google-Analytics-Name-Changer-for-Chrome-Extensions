# Architecture

## Overview

GA4 Name Changer is a client-side Manifest V3 Chrome extension. There is no backend, no build step, and no remote code. All text replacement happens in a content script injected into `analytics.google.com`. A lightweight toolbar popup communicates with the content script via message passing to provide quick access to the same mapping functionality.

A service worker exists for two narrow jobs: opening the settings page on first install, and resolving Chrome extension IDs to extension names via `chrome.management`. The extension makes no network requests of any kind.

---

## File map

```
manifest.json          MV3 declaration — popup, options, content script, permissions
background.js          Service worker — local name resolution + first-run onboarding
content/content.js     Core replacement engine — injected into every GA4 page
popup/popup.*          Toolbar popup — quick edit + GA4 auto-detection
options/options.*      Full-tab settings page + welcome modal — backed by chrome.storage.sync
icons/                 Extension icons + Canvas-based icon generator (dev tool)
privacy.html           Hosted privacy policy
```

---

## Content script design

### Two replacement passes per batch

Every time a batch of DOM mutations (or a full page load) triggers processing, two passes run in order:

1. **`pairAccountLabels(root)`** — handles the account-label problem (see below)
2. **`walkTree(root)`** — handles property slug replacements

Order matters: the account-label pass marks the label text node as processed before the regular pass runs, preventing the slug replacer from also touching it.

### Regular pass: `walkTree` + `replaceInNode`

```
walkTree(root)
  └─ createTreeWalker(root, SHOW_TEXT, SKIP_TAGS filter)
       └─ [for each text node] replaceInNode(node)
            ├─ skip if in processedNodes (WeakSet)
            ├─ iterate slugMap (longest key first)
            └─ if changed: mark ourWrittenNodes, set node.nodeValue
```

`slugMap` is built from `chrome.storage.sync` key `mappings`. Entries are sorted **longest key first** to prevent partial-match collisions (e.g. if both `"abc"` and `"abcdef"` are mapped, `"abcdef"` is tried first).

`SKIP_TAGS` prevents touching text inside `SCRIPT`, `STYLE`, `TEXTAREA`, `NOSCRIPT`, `IFRAME`, `INPUT`, `SELECT`, `OPTION`, `BUTTON`.

### Account-label pass: `pairAccountLabels`

GA4 labels every Chrome Web Store developer account with the identical string "Chrome Web Store developer properties". The only differentiator per row is a 9-digit numeric account ID in a sibling text node.

```
pairAccountLabels(root)
  └─ find text nodes containing "Chrome Web Store developer properties"
       └─ for each label node:
            └─ walk up DOM ancestors (max 8 levels)
                 └─ within each ancestor: search for a text node
                    whose trimmed value is a key in accountMap
                    └─ if found:
                         └─ replace the label text with the mapped display name
                            (the numeric account ID is left in place so it
                             remains visible below the display name in the UI)
```

`accountMap` is built from `chrome.storage.sync` key `accountMappings`.

A **heartbeat** (`chrome.storage.local.accountLabelLastMatched`) is written whenever at least one label is successfully replaced. The popup reads this on open and surfaces a warning if the timestamp is more than 90 days old while the user has account mappings configured — an early signal that Google may have renamed that label in a GA4 update.

**Known limitation:** Removing an account mapping does not reverse the label replacement for the current page lifetime. The original GA4 text is always restored on the next page load.

### Observer and loop prevention

GA4 is a React SPA that re-renders by mutating existing text nodes' `nodeValue` directly (characterData mutations), not only by inserting new DOM nodes. To catch both:

```javascript
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true   // catches React reusing cached text nodes
});
```

**Loop prevention problem:** writing `node.nodeValue = replacedText` fires a `characterData` mutation. Without a guard the observer would re-process our own writes indefinitely.

**Solution — `ourWrittenNodes` WeakSet:**

```
replaceInNode(node):
  1. ourWrittenNodes.add(node)   ← tag before writing
  2. node.nodeValue = newText    ← fires characterData mutation

observer callback (characterData mutation):
  if ourWrittenNodes.has(node):
    ourWrittenNodes.delete(node) ← consume tag, ignore our own write
  else:
    processedNodes.delete(node)  ← GA4 wrote this; re-queue for processing
    add parentElement to pending roots
```

This distinguishes extension writes from GA4 writes without observer disconnect/reconnect cycles.

### Debounce

React fires many mutations in rapid succession during a render. An 80 ms debounce (`scheduleBatch`) aggregates them into a single pass. When `replaceAll()` is called (on init or storage change), any pending debounce is cancelled — a full-page pass makes queued partial-root work redundant.

### Storage

| Key | Store | Type | Description |
|-----|-------|------|-------------|
| `mappings` | sync | `{ [slug]: name }` | Property slug → display name |
| `accountMappings` | sync | `{ [accountId]: name }` | GA4 account number → display name |
| `autoResolveNames` | sync | `boolean` | Auto-naming opt-in. Absent or `false` means off. |
| `welcomeSeenVersion` | sync | `number` | Onboarding already shown for this version |
| `lastGA4Context` | local | `{ accountId, slugs }` | Last detected GA4 state (popup fallback for non-GA4 tabs) |
| `accountLabelLastMatched` | local | `number` (timestamp ms) | Heartbeat for label health monitoring |
| `pendingDetection` | local | `{ ts, accountId, properties, accounts }` | Popup → options handoff. TTL 10 min, consumed once. |

`mappings` and `accountMappings` are each stored as a single `chrome.storage.sync` item. A pre-save byte-size check against `QUOTA_BYTES_PER_ITEM` (8 192 bytes) surfaces quota errors before Chrome silently rejects them. The other two sync keys are scalars and are not size-checked.

---

## Popup design

The popup communicates with the content script via `chrome.tabs.sendMessage`:

```
popup.js                             content.js (active GA4 tab)
  │                                        │
  ├─ chrome.tabs.query(active tab)         │
  ├─ chrome.tabs.sendMessage(             │
  │    tab.id, { action: 'getGA4Data' }) ──▶ onMessage handler
  │                                        ├─ parse accountId from location.hash
  │                                        ├─ walk DOM for unmapped slugs
  │                                        ├─ cache result → chrome.storage.local
  │  ◀── sendResponse({ accountId, slugs }) ┘
  ├─ pre-fill detected rows (green highlight)
  ├─ initAutoName() → resolve names, or offer to turn it on
  └─ fall back to lastGA4Context if no response (non-GA4 tab)
```

Three strips sit between the header and the mapping lists, each shown only when it applies: the **detection banner** (live GA4 context, or the cached "Last seen" fallback), the **label health warning** (account labels stale for 90+ days), and the **auto-naming strip**, which either offers to turn the feature on or reports what it named.

The header carries **Full Settings**, a **?** button that reopens onboarding, and close. The first two both route through `openOptions()`, which writes the handoff before navigating.

The `tabs` permission is **not** declared in the manifest, and neither is `activeTab`. `chrome.tabs.query` always returns tab objects carrying `id`; only the privileged fields (`url`, `title`, `favIconUrl`) are gated behind `tabs`. This code reads `tab.id` and nothing else, so no permission is required. `chrome.tabs.create`, used by the listing links, is likewise unrestricted.

---

## Service worker design

`background.js` has no persistent state and does exactly two things.

### First-run onboarding

`chrome.runtime.onInstalled` with `reason === 'install'` opens the options page, where the welcome modal shows itself.

### Name resolution

The insight: **for Chrome Web Store developer properties, the GA4 property slug and the Chrome extension ID are the same 32-character string.** That makes the extension identifiable from what GA4 already renders.

The obvious way to turn that into a name, fetching the public store listing, is impossible: **Chrome blocks extension-initiated requests to `chromewebstore.google.com`, `chrome.google.com/webstore` and the CRX update endpoint**, even with the host permission granted, while every other origin works. This was built, measured and reverted; see [DECISIONS.md](DECISIONS.md) ADR-004.

Resolution therefore runs locally against `chrome.management`, and the extension makes no network request at all.

```
popup.js / options.js                    background.js
  │                                            │
  ├─ sendMessage({ action:'resolveNames',      │
  │                ids:[...] }) ──────────────▶ resolveNames()
  │                                            ├─ filter ids against /^[a-p]{32}$/
  │                                            ├─ gate: sync.autoResolveNames === true
  │                                            ├─ gate: permissions.contains('management')
  │                                            ├─ chrome.management.get(id) per id, in parallel
  │  ◀── { names, unresolved, reason } ────────┘ └─ installed → names, otherwise → unresolved
  │
  ├─ names      → fill the row, mark .is-suggested
  └─ unresolved → reveal that row's listing link
```

**Three gates, all required.** An ID is only looked up if it is syntactically a valid extension ID, the user has enabled `autoResolveNames`, and the optional `management` permission is currently granted. The `reason` field distinguishes `ok`, `disabled`, `no-permission` and `no-valid-ids` so the UI can respond specifically rather than showing a generic failure.

**No cache.** Lookups are local and complete in single-digit milliseconds for a whole batch, so caching would add staleness (a renamed extension reported under its old name) to save nothing.

**Coverage is partial by construction.** `chrome.management` sees only the current Chrome profile. An extension the user publishes but does not run locally comes back in `unresolved`, and its row reveals a button that calls `chrome.tabs.create()` on `https://chromewebstore.google.com/detail/<id>`. Chrome blocks *reading* that page but not *navigating* to it, so the user can read the name there and type it.

**Only `get` is ever called.** Never `getAll`, `setEnabled`, or `uninstall`, and only the `name` field of the result is read.

---

## Popup → options handoff

Extension popups do not fire `beforeunload`, so the `isDirty` guard the options page uses is unavailable there. Without a handoff, clicking **Full Settings** silently discarded whatever the user had typed, and the overflow note directing them to Full Settings was untrue: slugs beyond the three-row cap existed only in popup memory.

```
popup.js                                  options.js
  │                                            │
  ├─ buildHandoff()                            │
  │    ├─ every rendered row, with typed names │
  │    └─ + detectedSlugs beyond the 3-row cap │
  ├─ storage.local.set({ pendingDetection }) ──┼──▶ consumeHandoff()
  ├─ openOptionsPage() / tabs.create(#hash)    │      ├─ discard if older than 10 min
  └─ window.close()                            │      ├─ mergeHandoffRows() into each list
                                               │      ├─ storage.local.remove(key)
                                               │      └─ markDirty() + status message
```

**Merge semantics are conservative.** An incoming row whose slug is already on the options page only fills a display name that is currently empty; it never overwrites one. New slugs are inserted at the top of the list with the `is-detected` highlight.

The handoff is consumed exactly once and cleared immediately, so it cannot replay. The 10-minute TTL bounds how stale an injection can be.

---

## Welcome modal

Two slides in the options page, driven by `slideIndex` over `.slide[data-slide]` elements. Slide 1 explains the replacement with a before/after preview; slide 2 is the auto-naming opt-in and states exactly what the `management` permission is and is not used for.

Shown when `sync.welcomeSeenVersion !== WELCOME_VERSION`. Bumping `WELCOME_VERSION` re-shows it after a redesign. Dismissal by any route (Done, close button, overlay click, Escape) records the version.

The popup links in with a hash: `#welcome` opens slide 1 on demand, `#autoname` jumps straight to the opt-in slide, or skips the modal entirely and runs a lookup if the feature is already on.

**Why the permission grant lives here and not in the popup:** `chrome.permissions.request()` dismisses an extension popup when Chrome's confirmation dialog takes focus, and its callback frequently never runs ([crbug.com/952645](https://crbug.com/952645)). The popup therefore only ever *offers*, and hands over to this page to actually grant.

---

## Options page design

Full-tab (`open_in_tab: true`) two-column CSS Grid layout, each column independently managing its own list of mapping rows via a shared `makeRow()` factory. Both columns write through the same `save()` function, which persists both mapping keys in a single `chrome.storage.sync.set` call.

The `isDirty` flag and `beforeunload` guard prevent accidental loss of unsaved changes. The popup cannot do this (extension popups get no `beforeunload`), which is what the handoff above exists to solve.

Above the grid sits the auto-naming toolbar: the opt-in switch and the **Fill missing names** button. `initAutoNameState()` reconciles the stored `autoResolveNames` flag against a live `chrome.permissions.contains()` check on every load, because the permission can be revoked from `chrome://extensions` without the extension being told. The live check wins, and a disagreement resets the flag.

Each mapping row ends in a `.row-actions` cell holding two buttons: a listing link, hidden until resolution reports that slug as unresolved, and delete. Rows carry two hint classes, `is-detected` (arrived from detection or the handoff) and `is-suggested` (name came from resolution, not the user), both cleared on first edit.

---

## Security properties

- No remote code — all JS is bundled in the package; no CDN fetches, no `eval`
- No `innerHTML` with user-supplied data — user input is only written via `.value`, `.textContent` or `.nodeValue`
- Static SVG constants injected via `innerHTML` are module-scope literals with no user data interpolated
- `host_permissions` scoped to `https://analytics.google.com/*` only
- `optional_permissions` contains `"management"` — not granted at install; requested only on explicit opt-in, and released via `chrome.permissions.remove()` when the feature is turned off. Only `chrome.management.get()` is ever called, and only its `name` field read
- `permissions` contains only `"storage"`; `tabs` is deliberately not requested
- **Zero network egress.** No `fetch`, no `XMLHttpRequest`, no `WebSocket`, no remote resource referenced by any page
- Message handlers take no caller-supplied selectors or code: `getGA4Data` takes no parameters, `resolveNames` filters its input against `/^[a-p]{32}$/`
- Explicit `content_security_policy` in manifest: `script-src 'self'; object-src 'self'`

See [SECURITY.md](SECURITY.md) for the full threat model, and [DECISIONS.md](DECISIONS.md) ADR-004/005 for why name resolution is local and why `management` is optional.

---

## Browser compatibility

Requires Chrome 88+ (`minimum_chrome_version` declared in manifest).

APIs used: `WeakSet`, `TreeWalker`, `MutationObserver` with `characterData` observation, `chrome.storage.sync`, `chrome.storage.local`, `chrome.storage.onChanged`, `chrome.runtime.onMessage`, `chrome.runtime.onInstalled`, `chrome.permissions.contains/request/remove`, `chrome.management.get`, `chrome.tabs.query`, `chrome.tabs.create`, `chrome.tabs.sendMessage`.
