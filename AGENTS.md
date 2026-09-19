# AGENTS.md

Behaviour contract for AI agents and automated tooling working in this repository.
Read this before editing any file. Read [DOMAIN.md](DOMAIN.md) before touching anything
that handles identifiers, and [ARCHITECTURE.md](ARCHITECTURE.md) before touching
`content/content.js`.

---

## What this project is

A Manifest V3 Chrome extension. Pure client side. No backend, no framework, no
bundler, no transpiler, no package manager, no tests. The files in the repository
root **are** the shipped extension. What you edit is what runs.

---

## Hard invariants

Breaking any of these produces a bug that is silent, intermittent, or both. Do not
change the code they govern without reading the reasoning in
[ARCHITECTURE.md](ARCHITECTURE.md) and [DECISIONS.md](DECISIONS.md) first.

### 1. The `ourWrittenNodes` loop guard

Writing `node.nodeValue` fires a `characterData` mutation that the extension's own
`MutationObserver` receives. `ourWrittenNodes` is a `WeakSet` tagged immediately
**before** every write; the observer consumes the tag and ignores that mutation.

* Never write `nodeValue` without adding the node to `ourWrittenNodes` first.
* Never consume a tag anywhere except the observer callback.
* Never "fix" the loop by disconnecting and reconnecting the observer. That was
  considered and rejected; see [DECISIONS.md](DECISIONS.md) ADR-002.

### 2. Pass ordering

Within one batch, `pairAccountLabels(root)` must run **before** `walkTree(root)`.
The account pass marks its label node into `processedNodes`, which is what stops the
slug replacer from also rewriting that node. Reversing the order corrupts account labels.

### 3. `slugMap` sort order

`slugMap` is built sorted longest key first. This prevents a short slug that is a
prefix of a longer one from matching first and corrupting the longer replacement.
Any code that rebuilds this map must preserve the sort.

### 4. The extension makes no network requests

There is no `fetch`, `XMLHttpRequest`, or `WebSocket` anywhere in this codebase, and no
page references a remote resource. Do not add one.

If you are about to add a fetch to the Chrome Web Store: **it will not work.** Chrome
blocks extension-initiated requests to `chromewebstore.google.com`,
`chrome.google.com/webstore` and `clients2.google.com/service/update2`, even with the
host permission granted. This was implemented, measured and reverted; the evidence is in
[DECISIONS.md](DECISIONS.md) ADR-004. Do not spend the afternoon rediscovering it.

Name resolution runs through `chrome.management.get()` in `background.js`, gated on all
three of:

1. `chrome.storage.sync.autoResolveNames === true`
2. `chrome.permissions.contains({ permissions: ['management'] })`
3. the target string matching `/^[a-p]{32}$/`

Never move resolution into `content/content.js`. Never make `management` a required
permission. Never call anything from `chrome.management` other than `get`. Never remove a
gate "temporarily".

### 5. Never put an API key, token or secret in this extension

The package is readable by anyone who installs it. The feedback form therefore posts to a
relay that holds the Resend key server-side, and falls back to `mailto:` when none is
configured. See [DECISIONS.md](DECISIONS.md) ADR-011. If you are about to add a credential to
any file here, stop.

### 6. Auto-derived names must never overwrite the user's own

`autoMappings` is merged **under** `sync.mappings` in `rebuildMaps()`. The extension writes
only to the `auto*` keys in local storage and never to the user's `mappings`. Reversing that
precedence, or writing derived names into the user's own store, silently destroys their work
and syncs the damage to their other devices.

### 7. Harvesting must never guess which property a report belongs to

`harvestNameHint()` records a slug-to-name hint only when **exactly one** property slug is
visible on the page. With the account switcher open several are, and the only way to attribute
the report would be to trust GA4's minified class names, which invariant 3 of ADR-003 refuses.
A wrong hint silently mislabels a property, which is worse than no hint.

Do not relax the single-slug check. Do not add a class-name-based fallback.

### 8. Never interpolate user data into `innerHTML`

`innerHTML` is used in this codebase only with module scope SVG string constants.
User supplied values reach the DOM exclusively through `.value`, `.textContent`,
or `.nodeValue`. Keep it that way.

### 9. Never attribute a name while the reports may still be the previous property's

Google Analytics rewrites the URL on a property switch immediately and refetches its report
widgets about four seconds later. `harvestNameHint()` therefore refuses to attribute anything
until the candidate set has **changed** since the switch and then **held still** for a pass.
See [DECISIONS.md](DECISIONS.md) ADR-013.

Do not replace that with a fixed delay, and do not weaken it to "held still" alone: reports
that have not begun refreshing also hold still, which is the exact failure this prevents. It
was a live bug, not a theoretical one.

### 10. Never guess which extension an account is named after

An account holding several extensions is labelled from **all** of them
(`Amazon MyOrders + Flip Rotate`). Extensions not yet named are **counted** (`+ 1 more`), never
skipped over so the label reads as if it were complete. See [DECISIONS.md](DECISIONS.md)
ADR-015.

Labelling a two-extension account after the one extension that happens to be on screen is the
bug this replaced. Do not reintroduce it by dropping the unknown count.

### 11. The settings table's grouping is presentation, not storage

Storage is two flat maps: `sync.mappings` (slug → name) and `sync.accountMappings`
(accountId → name). The settings page *draws* them as one table grouped by account, using
`local.propertyAccounts` for the pairing, but it saves those same two flat maps and nothing
else. See [DECISIONS.md](DECISIONS.md) ADR-012.

Do not nest the saved shape to match the table. The content script, the popup and every
JSON file a user has already exported depend on the flat shape. `propertyAccounts` is
disposable: if it is missing the table degrades to a flat list, which is correct, not broken,
so nothing may read it for replacement.

---

## Coding conventions

* `'use strict';` at the top of every JS file.
* Two space indentation. Single quotes. Semicolons.
* Section headers use the existing box drawing comment style: `// ── Name ──────`.
* Vanilla DOM APIs only. Do not add a dependency, a build step, or a framework.
* Callback style `chrome.*` APIs in the popup, options page, and content script.
  Promise wrappers are acceptable in `background.js` only, where the resolver is async.
* Guard every async `chrome.*` callback with a `chrome.runtime.lastError` check.
* Comments explain **why**, not what. Prefer one accurate comment on a non obvious
  invariant over narrating the obvious.

---

## Restricted areas

| Path | Rule |
|---|---|
| `content/content.js` | Highest risk file. Read ARCHITECTURE.md in full first. Changes here can break replacement silently on live GA4 pages. |
| `background.js` | Do not add a network call, and do not widen the `chrome.management` surface beyond `get`. |
| `manifest.json` | Do not add any `permissions`, `optional_permissions` or `host_permissions` entry without recording the reason in DECISIONS.md and updating `privacy.html`, `SECURITY.md` and README in the same change. |
| `privacy.html` | Must stay factually true of the shipped code. If you change what the extension sends or stores, update this file in the same change. |
| `icons/generate-icons.html` | Dev tool, not shipped. Excluded by `.crxignore`. |
| `googled7379778f776f48c.html` | Google Search Console verification token for the GitHub Pages site. Never rename, edit, or delete. |

---

## Definition of done

A change is not complete until all of these hold:

1. `node --check` passes on every JS file you touched.
2. The extension loads unpacked with no errors in `chrome://extensions`.
3. You manually ran the relevant checks in [PLAYBOOK.md](PLAYBOOK.md). There is no
   automated test suite; manual verification is the only verification.
4. `CHANGELOG.md` has an entry if user visible behaviour changed.
5. `privacy.html` and `README.md` still describe the code accurately.
6. A new known constraint is recorded in [LIMITATIONS.md](LIMITATIONS.md); a new
   architectural choice is recorded in [DECISIONS.md](DECISIONS.md).

---

## Things that look like bugs but are not

Do not "fix" these without discussion. Each is a deliberate, documented decision.

* **`processedNodes` is never cleared except in `replaceAll()`.** Intentional. The
  observer un marks individual nodes when GA4 rewrites them.
* **Removing an account mapping does not restore the original label until reload.**
  Known and accepted. See [LIMITATIONS.md](LIMITATIONS.md).
* **The popup has no `beforeunload` guard while the options page does.** Extension
  popups do not fire `beforeunload`. The popup uses the `pendingDetection` handoff
  instead.
* **The popup never calls `chrome.permissions.request()`.** That call tears down an
  extension popup before its callback runs. Granting happens on the options page only.
* **`tabs` is not in `permissions`.** Only `tab.id` is read, which does not require it.
  Do not add the permission.
* **`management` is optional and resolution is gated on a live permission check, not the
  stored flag.** The permission can be revoked from `chrome://extensions` without the
  extension being told, so the flag alone is not trustworthy. See ADR-005.
* **Auto naming does not cover every extension, and that is not a bug.**
  `chrome.management` sees only the current profile. Unresolved rows get a store listing
  link instead. Do not try to "fix" the coverage gap with a fetch; see invariant 4.
* **`background.js` uses promise wrappers while every other file uses callbacks.** The
  resolver is async; the rest is not. Do not "harmonise" this.
* **Harvesting runs before the observer's empty-map early return.** Deliberate: a user with no
  mappings yet is exactly who needs name hints. It is throttled to once per 5 s instead.
* **Account detection only finds one account when the switcher is closed.** Verified against
  live GA4: no numeric account IDs exist in the DOM at all until that panel is opened.
* **`chrome.tabs.query({url})` works without the `tabs` permission.** Chrome exposes `url` for
  tabs matching host permissions the extension already holds. Verified empirically. Do not add
  `tabs` to make cross-tab detection "work".
