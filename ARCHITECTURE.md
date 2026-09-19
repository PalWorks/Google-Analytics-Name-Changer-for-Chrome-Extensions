# Architecture

## Overview

Google Analytics (GA4) Name Changer for Chrome Extension Developers is a client-side Manifest V3 Chrome extension. There is no backend, no build step, and no remote code. All text replacement happens in a content script injected into `analytics.google.com`. A lightweight toolbar popup communicates with the content script via message passing to provide quick access to the same mapping functionality.

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

### Name harvesting

GA4's "Page title and screen class" report for a Chrome Web Store developer property lists the store listing pages that were viewed, and the store titles them `<Extension Name> - <localised store name>`. **The extension's real name is therefore already on the page**, with no lookup of any kind:

```
Gmail Labels and Search Queries as Tabs - Chrome Web Store         60 views
Gmail Labels and Search Queries as Tabs - Интернет-магазин Chrome   1
Chrome Web Store - Extensions                                       0   <- generic, dropped
```

```
maybeHarvest()                        (5s settled · 1.2s settling · 2.5s awaiting reports)
  ├─ visibleTextValues()
  ├─ exactly one slug visible?  ──no──▶ skip: cannot attribute the report
  ├─ reportTitleRows()                  find tables headed "page title / screen class"
  ├─ split each title on the LAST " - " strips the store suffix in any language,
  │                                     and preserves names containing " - "
  ├─ drop GENERIC_TITLES               "chrome web store", "extensions", …
  ├─ rank remaining names by views
  └─ persist to local.nameHints[slug]
```

**The single-slug guard is the important part.** A report belongs to whichever property is selected. With the account switcher open, several slugs are on screen and attributing the report to one of them would mean trusting GA4's minified class names, which [DECISIONS.md](DECISIONS.md) ADR-003 refuses to do. So harvesting is skipped entirely unless exactly one slug is visible. Verified against live GA4: switcher closed produces a hint, switcher open produces `null`.

Harvesting runs from the observer callback **before** its empty-map early return, because a user with no mappings yet is precisely who benefits most. It also runs once ~2.5 s after init, since GA4 fills its report widgets asynchronously.

### Settling: not every read is safe to believe

GA4 rewrites the URL on a property switch **immediately** and refetches its report widgets about **four seconds later** (measured live). A read inside that window pairs the new property's slug with the previous extension's name. So a harvested name is attributed only once the candidates have **changed** since the switch and then **held still** for a further pass. A full page load skips the "changed" requirement, since a fresh document cannot be showing a previous property's data.

An empty candidate set is not a settled answer: GA4's page is interactive several seconds before its report has rows. While there is nothing on screen to name, the extension keeps waiting on a slower cadence (2.5 s, up to 90 s) instead of concluding "no name". Measured on a live cold load: over 20 s to the first name before this, 8.7 s after.

See [DECISIONS.md](DECISIONS.md) ADR-013.

### Naming sources, in priority order

| Tier | Source | Cost | Covers |
|---|---|---|---|
| 1 | `nameHints` harvested from GA4 reports | free, no permission | The property currently in view, installed or not |
| 2 | `chrome.management.get()` | optional permission | Extensions installed in this profile |
| 3 | Store listing link | one click, manual | Everything else |

### Naming an account

An account label is built from the extensions the account holds, which `propertyAccounts` and GA4's own tree together identify:

| Account holds | Label |
|---|---|
| one extension | that name, shortened to 24 chars |
| several, all named | each cut harder and joined: `Amazon MyOrders + Flip Rotate` |
| several, some unnamed | the known ones plus a count: `Amazon MyOrders Page Grid + 1 more` |
| none named yet | nothing written |

Capped at 38 characters, because the label sits in GA4's breadcrumb beside the property name. Unnamed siblings are **counted, never guessed at**: labelling a two-extension account after the single extension we happen to have seen is exactly the arbitrary result the count avoids. The label is rewritten as the remaining names are learned, and is badged `auto`, so editing it and saving promotes it into the user's own `accountMappings`.

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
| `nameHints` | local | `{ [slug]: name }` | Extension names harvested from GA4's own report widgets. Accumulates as the user browses. |
| `autoMappings` | local | `{ [slug]: name }` | Derived property names, applied with no save. Merged **under** `mappings`. |
| `autoAccountMappings` | local | `{ [accountId]: name }` | Derived account names, merged under `accountMappings`. |
| `autoNamingEnabled` | local | `boolean` | On-page automatic naming. Absent or `true` means on. |
| `propertyAccounts` | local | `{ [slug]: accountId }` | Which account each property sits under, from GA4's inline account tree **and** from the account/property in the URL (the tree is capped and omits accounts, see ADR-014). Presentation only: it groups the settings table and is never read by the replacement engine. Merged, never replaced. |

`mappings` and `accountMappings` are each stored as a single `chrome.storage.sync` item. A pre-save byte-size check against `QUOTA_BYTES_PER_ITEM` (8 192 bytes) surfaces quota errors before Chrome silently rejects them. The other two sync keys are scalars and are not size-checked.

---

## Popup design

The popup communicates with the content script via `chrome.tabs.sendMessage`:

```
popup.js                             content.js (a GA4 tab)
  │                                        │
  ├─ findGA4Tab(): active tab, else        │
  │    any GA4 tab in this window          │
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

**Cross-tab detection.** The popup is often opened while looking at something else, so `findGA4Tab()` tries the active tab first and then falls back to any `analytics.google.com` tab in the same window, labelling the banner "(other tab)".

The `tabs` permission is **not** declared in the manifest, and neither is `activeTab`. `chrome.tabs.query` always returns tab objects carrying `id`, and Chrome additionally exposes `url` and `title` **for tabs matching the host permissions the extension already holds**, which is what makes the `{ url: 'https://analytics.google.com/*' }` query work. Tabs outside those permissions stay hidden. Verified empirically; `chrome.tabs.create`, used by the listing links, is likewise unrestricted.

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
  └─ window.close()                            │      ├─ mergeHandoffAccounts() then …Properties()
                                               │      ├─ storage.local.remove(key)
                                               │      └─ markDirty() + status message
```

**Merge semantics are conservative.** An incoming row whose slug is already on the options page only fills a display name that is currently empty; it never overwrites one. New slugs are appended, in the order the popup sent them, with the `is-detected` highlight.

Accounts are merged **before** properties, so that a property whose account is known by `propertyAccounts` finds its group already built rather than dropping into the catch-all.

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

## Automatic naming without a save

Derived names are a **second layer beneath** the user's own, never a write into them.

```
rebuildMaps()
  ├─ layer 1: autoMappings        (local, derived by the extension)
  └─ layer 2: mappings            (sync, typed by the user)   ← always wins
```

The content script watches `chrome.storage.local` as well as `sync`, so the moment a name is
derived it is written to `autoMappings`, the listener fires, and `replaceAll()` re-renders the
page with the real name. No user action is involved at any point.

`mappings` is never written to by the content script, so nothing the user owns can be clobbered
and nothing is synced to their other devices without them asking. Both surfaces render auto
entries badged "auto"; because they are ordinary editable rows, pressing **Save** promotes them
into the user's own mappings, which is what makes Save still meaningful.

`autoNamingEnabled` (default true) disables the whole layer without deleting anything.

---

## Feedback form

The options page carries a feedback form. **The extension never calls Resend**: an API key
shipped in an extension is readable by anyone who installs it. The form posts to a relay
([worker/feedback-worker.js](worker/feedback-worker.js)) which holds the key as a Worker
secret, and with no endpoint configured it falls back to composing a `mailto:`, which needs no
network request and no permission.

Diagnostics are limited to installation facts (versions, install type, permission state,
mapping counts) and deliberately exclude every piece of the user's analytics: no slugs, no
account numbers, no display names, no URLs. The exact payload is shown in the form behind a
collapsed disclosure before anything is sent. See [DECISIONS.md](DECISIONS.md) ADR-011.

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
