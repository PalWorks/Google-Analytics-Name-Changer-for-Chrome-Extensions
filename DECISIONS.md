# DECISIONS.md

Architecture decision records. Each entry states what was chosen, what was rejected,
and why. If you are about to reverse one of these, read the alternatives first: they
were considered and did not work.

---

## ADR-001: No build step

**Status:** accepted

**Decision.** The repository root is the extension. No bundler, transpiler, package
manager, lockfile, or `node_modules`.

**Why.** The entire extension is roughly 1500 lines of vanilla JS against APIs that
ship in the browser. A build step would add a dependency tree, a supply chain surface,
and a gap between the source under review and the code that runs, in exchange for
nothing this project needs. Chrome Web Store review is also simpler when the uploaded
package is readable source.

**Rejected.** Vite or esbuild with a `src` to `dist` pipeline. Rejected as pure
overhead at this size.

**Consequence.** No TypeScript, no JSX, no npm test runner. Verification is manual
and lives in [PLAYBOOK.md](PLAYBOOK.md).

---

## ADR-002: `WeakSet` tagging for mutation loop prevention

**Status:** accepted. Load bearing, see [AGENTS.md](AGENTS.md).

**Decision.** Before every `node.nodeValue` write, the node is added to the
`ourWrittenNodes` `WeakSet`. The `MutationObserver` callback consumes that tag and
ignores the resulting `characterData` mutation.

**Why.** GA4 is a React SPA that re-renders partly by mutating existing text nodes in
place, so the observer must watch `characterData` to catch SPA navigation and async
data fills. But the extension's own writes fire the same mutation type, which without
a guard loops forever.

**Rejected.**

* *Disconnect the observer around each write.* Loses every mutation GA4 makes during
  the disconnected window. Under React's rapid render bursts, that window is exactly
  when the interesting mutations happen.
* *Compare old and new values in the mutation record.* Unreliable: GA4 legitimately
  rewrites a node back to the same value, and the record's `oldValue` requires
  `characterDataOldValue`, which adds memory pressure across a very large DOM.
* *A sentinel character or zero width marker in the text.* Pollutes text the user
  copies out of GA4.

**Consequence.** A `WeakSet` tag is consumed exactly once. Any write that forgets to
tag causes an infinite loop; any consumption outside the observer causes the same.

---

## ADR-003: Account labels are paired, not matched

**Status:** accepted

**Decision.** `pairAccountLabels()` locates the fixed English string
`Chrome Web Store developer properties`, then walks up to eight DOM ancestor levels
looking for a text node whose trimmed value is a key in `accountMappings`, and renames
the label. The numeric account ID is deliberately left in place.

**Why.** Google gives every Chrome Web Store developer account the identical label.
There is no per account attribute, class, or data property to key on. The numeric ID
rendered nearby is the only differentiator available in the DOM.

**Rejected.**

* *CSS selectors against GA4's class names.* They are minified and rotate between
  deploys.
* *Replacing the numeric ID instead of the label.* The ID is the only thing that makes
  the row identifiable when a mapping is missing or wrong.

**Consequence.** The feature depends on an exact English string that Google controls
and can change without notice. Mitigated, not solved, by the
`accountLabelLastMatched` heartbeat and the 90 day staleness warning in the popup.
Eight levels is an empirical bound, not a principled one.

---

## ADR-004: Extension names are read locally, because Chrome blocks the Web Store

**Status:** accepted in v1.1.0. Supersedes an implementation that was built, tested and discarded.

**Context.** A Chrome Web Store property slug is the extension's ID, so the public listing
URL is reconstructable as `https://chromewebstore.google.com/detail/<id>` and the real title
sits in that page's `og:title`. The obvious implementation is to fetch it.

**That implementation does not work, and cannot be made to work.** Chrome blocks extensions
from issuing requests to the Web Store and to the extension update infrastructure. Verified
against Chromium 1234 with the host permission granted and `permissions.contains` returning
true:

| Target | Result |
|---|---|
| `https://example.com/` | 200 |
| `https://www.google.com/` | 200 |
| `https://analytics.google.com/` | 200 |
| `https://chromewebstore.google.com/…` | `TypeError: Failed to fetch` |
| `https://chrome.google.com/webstore/…` | `TypeError: Failed to fetch` |
| `https://clients2.google.com/service/update2/crx…` | `TypeError: Failed to fetch` |

Every other origin succeeds with the same permission setup, so this is a deliberate platform
protection against extensions scraping or manipulating the store, not a CORS or permission
misconfiguration. Page navigation to those URLs is unaffected; only extension-initiated
requests are blocked.

**Decision.** Resolve names with `chrome.management.get(id)`, which reports the name of any
extension installed in the current profile. For a Chrome Web Store developer looking at their
own analytics, that covers the extensions they actually run. Anything not installed locally is
returned as unresolved, and the UI reveals a per-row link that opens the public listing in a
tab, where the user can read the name and type it.

**Why this is better than the fetch design, not merely a fallback.**

* It makes **no network request at all**, so the extension's unconditional privacy claim survives.
* Resolution is instant (measured at 2 ms for a batch) rather than one 650 KB page load per ID.
* It cannot go stale, so no cache and no cache invalidation are needed.
* It does not depend on the store's HTML shape, which Google can restructure at any time.

**Rejected.**

* *The Chrome Web Store API.* There is no public read API for listing metadata.
* *An intermediary service of our own.* Would mean running a backend and routing the user's
  extension IDs through a third party.
* *The CRX download endpoint on `clients2.google.com`.* Blocked by the same protection, and
  the manifest name inside a CRX is frequently an `__MSG_` i18n placeholder anyway.
* *Opening the listing in a hidden tab and scraping it.* Extensions cannot inject content
  scripts into Web Store pages either, and doing it visibly would be user-hostile.

**Consequence.** Coverage is partial by construction: only locally installed extensions
resolve automatically. This is stated plainly in the onboarding, the settings copy and
[LIMITATIONS.md](LIMITATIONS.md), and the listing link exists specifically to cover the rest.

---

## ADR-005: Auto naming is opt in via an optional `management` permission

**Status:** accepted in v1.1.0

**Decision.** `management` is declared under `optional_permissions`, never `permissions`. The
feature is additionally gated on an `autoResolveNames` setting that defaults to false. Turning
it off calls `chrome.permissions.remove()`.

**Why.** `management` carries a broad warning ("Manage your apps, extensions, and themes") and
genuinely is a powerful permission: it can enable, disable and uninstall extensions. This
extension only ever calls `chrome.management.get()` to read a name, but the user has no way to
know that from the warning string alone. Making it optional means a user who never turns the
feature on has an extension that provably cannot enumerate anything, and the install-time
permission list stays minimal, which matters most at the moment trust is being established.

**Rejected.**

* *Required `management`.* Simpler code, no runtime prompt, but every user pays the warning
  cost for a feature only some want, and the install prompt becomes materially scarier.
* *Setting flag alone, permission always granted.* A flag the user can flip is not a capability
  boundary. The permission is.

**Consequence.** Two gates must agree, so the UI must reconcile them: the permission can be
revoked from `chrome://extensions` without the extension knowing. `initAutoNameState()`
therefore treats the live permission check, not the stored flag, as the truth and resets the
flag if they disagree. Chrome Web Store review is also stricter about `management`, so the
listing must justify it explicitly.

---

## ADR-006: The permission grant lives on the options page, never the popup

**Status:** accepted in v1.1.0

**Decision.** `chrome.permissions.request()` is called only from the options page.
The popup's auto naming offer is a link that opens the options page at `#autoname`.

**Why.** Calling `chrome.permissions.request()` from an extension popup dismisses the
popup when Chrome's confirmation dialog takes focus, and the callback frequently never
runs. This is long standing Chromium behaviour ([crbug.com/952645](https://crbug.com/952645)),
not something this extension can work around.

**Consequence.** Turning the feature on costs one extra click from the popup. Once
granted, the popup resolves names inline with no further prompts.

---

## ADR-007: Popup to options handoff instead of an unsaved changes warning

**Status:** accepted in v1.1.0

**Decision.** On navigating to the options page, the popup stashes its rows, including
detected slugs beyond its three row display cap, into
`chrome.storage.local.pendingDetection`. The options page merges them in once and
clears the key. TTL is 10 minutes.

**Why.** Extension popups do not fire `beforeunload`, so the `isDirty` guard the
options page uses is unavailable. Before this, clicking Full Settings silently
discarded whatever the user had typed, and the overflow note telling them to
"open Full Settings to map all" was false: the overflow slugs existed only in popup
memory and were never carried anywhere.

**Rejected.**

* *Auto save on popup close.* Would persist half typed rows, and rows with an empty
  display name are filtered out on save anyway, so it would have fixed nothing.
* *A confirm dialog on the Full Settings click.* Adds friction and still loses the
  overflow slugs.

**Consequence.** Merge semantics must be conservative. The handoff only fills a name
the options page does not already have; it never overwrites one.

---

## ADR-008: Documentation set scoped to six files

**Status:** accepted in v1.1.0

**Decision.** From the agent documentation guide's 28 candidate files, this repository
carries AGENTS, DOMAIN, PLAYBOOK, DECISIONS, LIMITATIONS, and SECURITY, alongside the
existing README, ARCHITECTURE, and CHANGELOG.

**Why.** Each of the six describes something an agent cannot infer from the source.
The rest of the guide's list assumes conditions this project does not have: there is no
test suite for TESTING.md, no production service for RUNBOOK.md or OBSERVABILITY.md, no
tool surface for SKILLS.md, no work queue for TASKS.md, and only eight source files, so
CONTEXT_MAP.md would restate the README. Empty ceremony files cost context and decay
into misinformation.

**Consequence.** Revisit if the project grows a test suite, a backend, or a second
contributor. ROADMAP.md is deliberately absent because there is no committed roadmap to
record yet.

---

## ADR-009: Extension names are harvested from GA4's own reports

**Status:** accepted in v1.1.0. Primary naming source, ahead of ADR-004.

**Context.** Testing against a live Chrome Web Store developer property revealed that the
name is *already on the GA4 page*. The "Page title and screen class" report lists the store
listing pages that were viewed, and the store titles them `<Extension Name> - <store name>`:

```
Gmail Labels and Search Queries as Tabs - Chrome Web Store         60 views
Gmail Labels and Search Queries as Tabs - Интернет-магазин Chrome   1
Gmail Labels and Search Queries as Tabs - Chrome ウェブストア          1
Chrome Web Store - Extensions                                       0   <- generic
Chrome Web Store - Search Results                                   0   <- generic
```

**Decision.** Read the name out of that report. Split each row's title on the **last** `" - "`,
which strips the store suffix in any language while preserving names that themselves contain
`" - "`. Drop generic store pages by name (`chrome web store`, `extensions`, `search results`,
and similar). Rank the remaining candidates by view count and take the winner.

**Why this beats every other source.**

* Costs nothing: no network request, no permission, no server.
* Works for extensions that are **not installed locally**, which is exactly the gap
  `chrome.management` (ADR-004) cannot cover.
* The name is the store listing name, which is what the user actually wants to see.
* Hints accumulate in `chrome.storage.local.nameHints` as the user browses GA4, so visiting a
  property once names it permanently.

**The single-slug guard.** A report belongs to whichever property is selected. With the
account switcher open, several property slugs are on screen at once and there is no
non-fragile way to tell which one the report describes. Rather than risk mislabelling a
property, harvesting is skipped entirely unless exactly one slug is visible. Verified live:
switcher closed yields a hint, switcher open yields `null`.

**Rejected.**

* *Reading the property header via GA4's class names to attribute the report.* Those class
  names are minified and rotate between deploys; ADR-003 already refuses to depend on them.
* *Harvesting continuously on every mutation.* The scan walks the page, so it is throttled to
  once per 5 s and also runs once ~2.5 s after load, since GA4 fills report widgets
  asynchronously.

**Consequence.** Naming now has three tiers, tried in this order: harvested hints (free,
covers the property in view), `chrome.management` (free, covers installed extensions), and the
store listing link (manual, covers everything else). A property that is never visited and is
not installed still cannot be named automatically. See ADR-010.

---

## ADR-010: No backend, for now

**Status:** accepted in v1.1.0. Revisit if the coverage gap proves real in use.

**Context.** A server-side proxy could fetch the public store listing and return the name for
any extension ID, closing every coverage gap at once. Chrome blocks the extension from doing
this itself (ADR-004), but nothing blocks a server of ours from doing it.

**Decision.** Not built. The three tiers in ADR-009 cover the realistic cases, and a backend
would cost:

* the unconditional "zero network requests" claim, which is currently true and is a real part
  of this extension's pitch to a privacy-conscious developer audience
* a host permission for the endpoint, plus privacy policy and Chrome Web Store disclosure
* an service to run, monitor and keep available
* server-side scraping of the Chrome Web Store, whose terms around automated access are worth
  checking before relying on it commercially

**The gap it would close.** A property the user never opens in GA4 *and* does not have
installed locally. Everything else is already covered for free.

**If it is built later,** it belongs behind the same contextual opt-in as ADR-005: offered when
a GA4 property is in view, permission requested at the moment the user says yes, and off until
then.

---

## ADR-011: Feedback is relayed by a server, never sent by the extension

**Status:** accepted in v1.1.0

**Decision.** The options page has a feedback form. It does **not** call Resend. It posts a
plain JSON body to `FEEDBACK_ENDPOINT`, a Cloudflare Worker
([worker/feedback-worker.js](worker/feedback-worker.js)) that holds the Resend API key as a
secret. With no endpoint configured, the form falls back to opening a pre-filled `mailto:`.

**Why.** Resend authenticates with an API key. **Any key shipped inside a Chrome extension is
readable by everyone who installs it** — the package is just files on disk, and anyone can
unzip it or open devtools. A leaked key lets a stranger send mail as `palworks.ai`, which
costs domain reputation, invites spam complaints, and is billable. There is no way to hide a
secret in a client. The local `resend` CLI is not an option either: it runs on the developer's
machine, not in a user's browser.

**Rejected.**

* *Ship the API key in the extension.* Refused outright, for the reasons above.
* *A third-party form service.* Routes the user's name and email through someone else,
  which then needs its own disclosure.

**Consequence.** Until the Worker is deployed the form uses `mailto:`, which needs no
endpoint, no permission and no network request from the extension, and therefore keeps the
unconditional privacy claim intact. Switching to the endpoint means adding its origin to
`optional_host_permissions`, updating `privacy.html`, and declaring the collected fields in the
Chrome Web Store data disclosure, because name and email are personal data.

**Amended 2026-09-18.** The phone field was removed. It was optional, never going to be
used to answer anyone, and it added a whole extra personal-data category to the Chrome Web
Store disclosure for nothing. Email plus the diagnostics is enough to reproduce a problem
and reply to it.

---

## ADR-012 — One settings table, grouped by account, not two side-by-side

**Date.** 2026-09-18 · **Status.** Accepted

**Decision.** The settings page shows a single table. Each account is a group head row and
the properties it holds are nested beneath it, sharing the same two columns: identifier and
display name. Properties whose account is not known yet fall into a catch-all group at the
bottom.

**Why.** The two cards were `accountMappings` and `mappings` drawn side by side, which is
the shape of the *storage*, not the shape of the user's problem. A developer with three
accounts and five extensions had to pair them up by eye, and nothing on the page said which
extension sat under which account. The extension already knows: GA4 ships an inline
`accountTree` that pairs them exactly (see ADR-008).

**What did NOT change: the storage shape.** Storage stays two flat maps, `sync.mappings`
(slug → name) and `sync.accountMappings` (accountId → name). The replacement engine, the
popup, Import and Export all agree on that shape, and re-nesting it would have broken every
exported file users already hold. The pairing that drives the grouping lives separately in
`local.propertyAccounts` and is **presentation only** — the content script never reads it.
Losing it degrades the table to a flat list, which is exactly the old behaviour, not a bug.

**Rejected.**

* *A real `<table>` with `rowspan` on the account cell.* Semantically tidy, but every add or
  delete forces the rowspan to be recomputed, and that arithmetic is precisely the sort of
  bookkeeping that goes wrong quietly.
* *Indenting property rows with left padding.* The obvious way to show nesting, but padding
  shifts every grid track, so the display-name column would no longer line up between an
  account row and the property rows under it — losing the one thing the merge was for. The
  indent is applied as a margin on the slug input alone, which leaves the tracks alone.
* *Repeating the account number on every property row.* Four true columns, but it reads as
  noise the moment an account holds more than one extension, which is the case the merge
  exists to clarify.

**Consequence (a).** Deleting an account no longer deletes anything else: its properties move to
the catch-all group, because they are independent mappings the user may still want. Accounts
render in ascending numeric order, since JavaScript orders integer-like object keys that way;
this is stable and predictable, but it is not insertion order.



---

## ADR-013 — A harvested name is attributed only after the reports settle

**Date.** 2026-09-18 · **Status.** Accepted

**Decision.** After an in-page property switch, a name harvested from GA4's reports is
attributed only once the report candidates have **changed** from what they showed at the
moment of the switch **and then held still** for one further pass. A full page load skips the
"changed" requirement, because a fresh document cannot be showing a previous property's data.
If the reports never settle, nothing is recorded.

**Why.** Reported from live use: after switching property, the breadcrumb showed a different
extension's name, a refresh fixed it, and names sometimes went wrong or vanished on returning
to a property.

Google Analytics is a single-page app. Switching property rewrites the URL **immediately** and
refetches the report widgets **asynchronously**. Measured live, that window is about four
seconds. Harvesting inside it reads the new property's slug from the URL and the previous
property's name from the reports, writes that pairing to `autoMappings`, and the wrong name
then sticks — it is persisted, so it survives until something overwrites it.

"Held still for a pass" alone is not sufficient and was tried first: reports that have not
started refreshing also hold still, which is exactly the stale case. Requiring a change from
the pre-switch fingerprint is what proves the refetch actually happened.

**Also decided: one extension, one name.** If a harvested name is already attributed to a
different slug, one of the two is a stale read, because two Chrome Web Store extensions do not
carry byte-identical names. A slug taken from GA4's own account tree is exact and evicts the
other claim; anything less certain yields. Without the eviction, a single bad pairing written
before this existed would lock the rightful property out of its own name permanently.

**Rejected.**

* *A fixed delay after a switch.* A guess about someone else's network. Too short and it
  still writes the wrong name; too long and naming feels broken.
* *Trusting GA4's loading spinners.* Class-name dependent, which ADR-003 invariant 3 refuses.

**Consequence.** A name now appears a second or two later than before, and a property whose
reports never settle is left unnamed. Both are the right trade: an unnamed property is
recoverable by typing, a wrongly named one is silently misleading.

**Not our lag.** GA4's own breadcrumb keeps showing the *previous* property for about four
seconds after the URL changes. Measured with replacement disabled entirely, the raw slug on
the page is still the old property's for ~4s. The extension renders whatever GA4 currently
shows, so that delay is visible through it and cannot be fixed from here.

---

## ADR-014 — Property-to-account pairing is recorded from the URL, not only the tree

**Date.** 2026-09-18 · **Status.** Accepted

**Decision.** `local.propertyAccounts` is written from two sources: GA4's inline `accountTree`
(bulk) and the account and property in the URL of whatever page the user is on (exact).

**Why.** The tree was the obvious single source, and ADR-008 established it as authoritative.
It is not complete: measured on a live profile, `window.preload` carried **18 accounts** while
the user holds more, and the account being viewed was **absent from its own page's tree**. Any
account outside that preloaded set would never be paired, so the settings table introduced in
ADR-012 would file those properties into the catch-all forever.

The URL has no such limit. `#/a<accountId>p<propertyId>` names both, for every page the user
actually opens, and it is read at the same settled moment as the name.

**Consequence.** A property is filed the first time it is opened. Until then it sits in the
catch-all group, which is a display difference only — nothing about replacement depends on it.
