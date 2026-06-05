# Architecture

## Overview

GA4 Name Changer is a pure client-side Manifest V3 Chrome extension. There is no backend, no build step, and no remote code. All text replacement happens in a content script injected into `analytics.google.com`. A lightweight toolbar popup communicates with the content script via message passing to provide quick access to the same mapping functionality.

---

## File map

```
manifest.json          MV3 declaration — popup, options, content script, permissions
content/content.js     Core replacement engine — injected into every GA4 page
popup/popup.*          Toolbar popup — quick edit + GA4 auto-detection
options/options.*      Full-tab settings page — backed by chrome.storage.sync
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
| `lastGA4Context` | local | `{ accountId, slugs }` | Last detected GA4 state (popup fallback for non-GA4 tabs) |
| `accountLabelLastMatched` | local | `number` (timestamp ms) | Heartbeat for label health monitoring |

Both sync keys are stored as single `chrome.storage.sync` items. A pre-save byte-size check against `QUOTA_BYTES_PER_ITEM` (8 192 bytes) surfaces quota errors before Chrome silently rejects them.

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
  └─ fall back to lastGA4Context if no response (non-GA4 tab)
```

The `tabs` permission is **not** declared in the manifest. `chrome.tabs.query` returns tab objects with the `id` field available under the `activeTab` model; only `tab.id` (not `url` or `title`) is used, which does not require the `tabs` permission.

---

## Options page design

Full-tab (`open_in_tab: true`) two-column CSS Grid layout, each column independently managing its own list of mapping rows via a shared `makeRow()` factory. Both columns write through the same `save()` function, which persists both storage keys in a single `chrome.storage.sync.set` call.

The `isDirty` flag and `beforeunload` guard prevent accidental loss of unsaved changes.

---

## Security properties

- No remote code — all JS is bundled in the package; no CDN fetches, no `eval`
- No `innerHTML` with user-supplied data — user input is only written via `.value` or `.nodeValue`
- Static SVG constants injected via `innerHTML` are module-scope literals with no user data interpolated
- `host_permissions` scoped to `https://analytics.google.com/*` only
- `permissions` contains only `"storage"`
- Explicit `content_security_policy` in manifest: `script-src 'self'; object-src 'self'`

---

## Browser compatibility

Requires Chrome 88+ (`minimum_chrome_version` declared in manifest). APIs used: `WeakSet`, `TreeWalker`, `MutationObserver` with `characterData` observation, `chrome.storage.sync`, `chrome.storage.local`, `chrome.storage.onChanged`, `chrome.runtime.onMessage`, `chrome.tabs.query`, `chrome.tabs.sendMessage`.
