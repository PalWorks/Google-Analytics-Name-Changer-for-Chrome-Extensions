# Architecture

## Overview

GA4 Name Changer is a pure client-side Manifest V3 Chrome extension. There is no backend, no build step, and no remote code. All text replacement happens in a content script injected into `analytics.google.com`.

---

## File Map

```
background.js          Service worker — opens Options on toolbar icon click
content/content.js     Core engine — injected into every GA4 page
options/options.*      Settings UI — full-tab page backed by chrome.storage.sync
manifest.json          MV3 declaration
```

---

## Content Script Design

### Two replacement passes per batch

Every time a batch of DOM mutations (or a full page load) triggers processing, two passes run in order:

1. **`pairAccountLabels(root)`** — handles the account-label problem (see below)
2. **`walkTree(root)`** — handles property slug replacements

Order matters: the account-label pass marks the numeric account ID text nodes as processed so the regular pass doesn't also replace them (which would produce "Gmail Labels / Gmail Labels").

### Regular pass: walkTree + replaceInNode

```
walkTree(root)
  └─ createTreeWalker(root, SHOW_TEXT, skipFilter)
       └─ [for each text node] replaceInNode(node)
            ├─ skip if in processedNodes (WeakSet)
            ├─ iterate slugMap (longest key first)
            └─ if changed: mark ourWrittenNodes, set node.nodeValue
```

`slugMap` is built from `chrome.storage.sync` key `mappings`. Entries are sorted **longest key first** to prevent partial-match collisions (e.g., if slug "abc" and "abcdef" both exist, "abcdef" is tried first).

`SKIP_TAGS` prevents touching content inside `SCRIPT`, `STYLE`, `TEXTAREA`, `NOSCRIPT`, `IFRAME`, `INPUT`, `SELECT`, `OPTION`, `BUTTON`.

### Account-label pass: pairAccountLabels

The GA4 account switcher shows every Chrome Web Store developer account with the identical label "Chrome Web Store developer properties". The only unique identifier per row is a 9-digit numeric account ID in a sibling text node.

```
pairAccountLabels(root)
  └─ find text nodes containing "Chrome Web Store developer properties"
       └─ for each label node:
            └─ walk up DOM ancestors (max 8 levels)
                 └─ within each ancestor: search for a text node
                    whose trimmed value is a key in accountMap
                    └─ if found:
                         ├─ replace label text with the mapped name
                         └─ clear the numeric ID text node (now redundant)
```

`accountMap` is built from `chrome.storage.sync` key `accountMappings`.

**Known limitation:** If a user removes an account mapping and saves, the label replacement is not reversed until the page is reloaded. The DOM mutation is permanent within the page lifetime — a page reload always restores the original GA4 text.

### Observer and loop prevention

GA4 is a React SPA that re-renders by updating existing text nodes' `nodeValue` directly (characterData mutations), not just by inserting new nodes. To catch both cases:

```javascript
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true   // ← catches React reusing cached text nodes
});
```

**Loop prevention problem:** writing `node.nodeValue = replacedText` generates a characterData mutation. Without a guard, the observer would re-process our own writes infinitely.

**Solution — `ourWrittenNodes` WeakSet:**

```
replaceInNode(node):
  1. ourWrittenNodes.add(node)   ← tag before writing
  2. node.nodeValue = newText    ← triggers characterData mutation

observer callback (characterData mutation):
  if ourWrittenNodes.has(node):
    ourWrittenNodes.delete(node) ← consume the tag, ignore the mutation
  else:
    processedNodes.delete(node)  ← GA4 wrote this; re-queue for processing
    add parentElement to roots
```

This cleanly distinguishes extension writes from GA4 writes without observer disconnect/reconnect.

### Debounce

React fires many mutations in rapid succession during a render. A 80 ms debounce (`scheduleBatch`) aggregates them into a single pass. When `replaceAll()` is called (init or storage change), any pending debounce is cancelled — a full-page pass makes partial-root processing redundant.

### Storage

| Key | Type | Description |
|-----|------|-------------|
| `mappings` | `{ [slug: string]: name: string }` | Property slug → display name |
| `accountMappings` | `{ [accountId: string]: name: string }` | GA4 account number → display name |

Both are stored as single `chrome.storage.sync` items. Pre-save size validation compares against `QUOTA_BYTES_PER_ITEM` (8,192 bytes) to surface quota errors before Chrome silently rejects them.

---

## Options Page Design

Two-column CSS Grid layout (`cards-grid: 1fr 1fr`), each card independently managing its own list of rows via the shared `makeRow()` factory. Both tables write through to the same `save()` function, which persists both storage keys atomically in a single `chrome.storage.sync.set` call.

The `isDirty` flag and `beforeunload` guard prevent accidental loss of unsaved mappings.

---

## Security Properties

- No remote code execution — all JS is bundled, no CDN fetches
- No `innerHTML` with user-supplied data — all user input written via `.value` or `.nodeValue`
- Static SVG constants injected via `innerHTML` are module-scope literals with no user interpolation
- `host_permissions` scoped to `https://analytics.google.com/*` only
- `permissions` contains only `storage`
- Explicit `content_security_policy` declared in manifest (`script-src 'self'`)

---

## Browser Compatibility

Requires Chrome 88+ (`minimum_chrome_version` declared). Uses: `WeakSet`, `TreeWalker`, `MutationObserver`, `characterData` observation, `chrome.storage.sync`, `chrome.storage.onChanged`, `chrome.action.onClicked`.
