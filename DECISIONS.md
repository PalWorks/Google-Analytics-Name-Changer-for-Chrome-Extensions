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
Bulk Bookmark Cleaner and Sorter - Chrome Web Store         60 views
Bulk Bookmark Cleaner and Sorter - Интернет-магазин Chrome   1
Bulk Bookmark Cleaner and Sorter - Chrome ウェブストア          1
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

* the claim that no request is ever made in the course of the extension's own work, which
  remains true and is a real part of this extension's pitch to a privacy-conscious developer
  audience. The feedback relay of ADR-016 does not weaken it: that fires only when the user
  submits a form, carries only what the user typed, and carries nothing about their analytics.
  A naming backend would be a background request about the user's own data, which is a
  different thing entirely
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
endpoint, no permission and no network request from the extension. Switching to the endpoint
means updating `privacy.html` and declaring the collected fields in the Chrome Web Store data
disclosure, because name and email are personal data. **This was done on 2026-09-19; see
ADR-016,** which also records that the expected `optional_host_permissions` entry turned out
to be unnecessary.

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
`accountTree` that pairs them exactly (see ADR-009).

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

**An empty report is not a settled answer.** Added after measuring: GA4's page is interactive
several seconds before its "Views by page title" card has any rows. A pass that early sees no
candidates at all, and treating that as "settled on no name" ended the polling and left the
first name waiting for whatever mutation happened next — over 20 seconds on a live account.
While there are no candidates the extension keeps waiting, on a slower cadence and a longer
budget, which brought the same measurement down to 8.7 seconds.

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

**Why.** GA4's inline `accountTree` (ADR-009) was the obvious single source, and it is exact.
It is not complete: measured on a live profile, `window.preload` carried **18 accounts** while
the user holds more, and the account being viewed was **absent from its own page's tree**. Any
account outside that preloaded set would never be paired, so the settings table introduced in
ADR-012 would file those properties into the catch-all forever.

The URL has no such limit. `#/a<accountId>p<propertyId>` names both, for every page the user
actually opens, and it is read at the same settled moment as the name.

**Consequence.** A property is filed the first time it is opened. Until then it sits in the
catch-all group, which is a display difference only — nothing about replacement depends on it.

---

## ADR-015 — An account holding several extensions gets a combined draft, not a blank

**Date.** 2026-09-19 · **Status.** Accepted

Replaces the "only name an account that holds exactly one extension" rule, which was never
written up as an ADR of its own — it lived in a code comment in `persistNameHint`. That is the
gap this record closes.

**Decision.** An account label is built from **all** the extensions the account holds: one
extension gives its own name shortened, several give each name cut harder and joined with
`" + "` — `Tab Session Saver + Dark Mode` — capped at 38 characters. Extensions not yet named
are **counted**, not guessed at, so a half-known account reads `Dark Mode Everywhere Page Grid +
1 more`. The label is rewritten as the remaining names are learned.

**Why.** The previous rule left such accounts blank, on the grounds that naming an account
after one of several extensions is arbitrary. That reasoning is sound and is preserved: what
was wrong was the conclusion. A blank field is not neutral — it reads as a broken feature, and
it leaves the user with the unreadable nine-digit account number that this extension exists to
remove. A draft that names every extension in the account is not arbitrary, and every draft is
editable and badged `auto`, so the cost of a mediocre draft is one edit while the cost of a
blank is the original problem.

**Why counting rather than guessing.** Labelling a two-extension account after the single
extension we have seen so far would reintroduce exactly the arbitrary result this avoids, and
would look settled rather than partial. `+ 1 more` is honest and self-correcting.

**Rejected.**

* *Concatenating without separators* (`AmazonMyOrdersFlipRotate`). Shorter, unreadable.
* *Naming after the most-viewed extension.* Arbitrary, and it changes as traffic changes.
* *Using GA4's own account name.* It is the same generic string for every Chrome Web Store
  developer account, which is the problem being solved.

**Consequence.** The 38-character cap means a three-extension account gets roughly ten
characters each, which is terse (`Alpha Tab + Beta + Gamma`). See the amendment below: that
consequence was worse in practice than it reads here, and the rule was changed.

### Amendment, 2026-09-21 — a word floor, and a count past two extensions

The character cap alone produced labels like `OpenFullPage + Google + 1 more`. Two faults, both
from cutting on characters with no floor on words:

* **One word is rarely the extension.** `Google Analytics Name Changer for Chrome Extensions`
  cut to thirteen characters is `Google`, which reads as somebody else's product, not as ours.
* **Three names at ten characters each is not a signpost, it is three fragments.**

The rule is now:

| Extensions in the account | Label |
| --- | --- |
| One | its name, shortened as before |
| Two | both names, each at least **two** words |
| Three or more | the **first** name at at least **three** words, then `+ N more` |

The word floor **wins over the 38-character cap** when the two disagree, so a label may run a
character or two long. That is the right way round: a label the user can read and then edit
beats one that fits and says nothing. Counting past two rather than cramming is the same
honesty argument as `+ 1 more` above, applied to names we do have.

`shortenName()` takes a third argument, `minWords`, and `tidyForCombining()` now also drops a
separator dash, because cutting `OpenFullPage - Capture Screen` mid-phrase left the hyphen
dangling. Both are duplicated in `popup.js`, which must stay in step.

---

## ADR-016 — The feedback relay is deployed, and the privacy claim is narrowed to match

**Status:** accepted 2026-09-19. Supersedes the "not yet deployed" half of ADR-011.

**Context.** ADR-011 built the relay and left it unwired: `FEEDBACK_ENDPOINT` was `''`, so the
form composed a `mailto:` and the extension made no network request in any configuration. That
kept an unusually strong privacy claim, and the claim was load-bearing in the store listing,
the site and the onboarding.

**Decision.** Deploy the Worker and wire it up.

* Worker `ga4nc-feedback` on Cloudflare, endpoint
  `https://ga4nc-feedback.sunmooncal.workers.dev/feedback`.
* `FEEDBACK_ENDPOINT` in `options/options.js` points at it.
* The Resend API key is a Worker secret and is never in the package.

**Why.** A `mailto:` hands the work to the user's mail client, which means the report arrives
only if the user has a configured desktop mail client, notices the composed draft, and presses
send in a second application. On a machine using webmail it often arrives as nothing at all.
A support channel that silently drops reports is worse than a support channel with a
disclosure.

**What this costs, stated plainly.** The extension can no longer claim it never makes a
network request. That claim was true and it was good. What replaces it is narrower and still
true:

> Nothing about your Google Analytics data is ever transmitted. The only thing the extension
> ever sends is a support message you typed and submitted yourself.

**No host permission was needed.** ADR-011 predicted an `optional_host_permissions` entry. It
turned out to be unnecessary: the Worker returns `Access-Control-Allow-Origin` echoing the
calling extension's origin, so the `POST` from the options page satisfies CORS on its own.
A host permission would have added a line to the store's permission list for no gain, so it
was deliberately not added. Keep it that way.

**Safety properties, all in `worker/feedback-worker.js` and verified against the deployment:**

| Probe | Result |
|---|---|
| `OPTIONS` from an extension origin | 204, CORS headers echo the origin |
| `GET` | 405 |
| `POST` from `https://evil.example.com` | 403, so it cannot be used as an open mail relay |
| `POST` from a `chrome-extension://` origin | reaches validation |
| Body over 16 KB, bad JSON, invalid email, message under 10 chars | rejected |

The relay stores nothing. It validates, forwards to Resend, and forgets.

**Degradation.** `sendByEndpoint()` falls back to `sendByMail()` on any non-OK response or
network error, so an unreachable or unconfigured relay returns the feature to its previous
behaviour rather than breaking it.

**Rejected.**

* *Stay on `mailto:` only.* Keeps the stronger claim, but loses reports, which is the whole
  point of having the form.
* *Send diagnostics without asking.* The form renders the exact diagnostics block on screen
  before the user submits. Nothing is sent that the user has not been shown.
* *Add the origin to `optional_host_permissions` anyway, for belt and braces.* It would appear
  on the store's permission list and buy nothing, since CORS already permits the call.

**Reversal.** Set `FEEDBACK_ENDPOINT` back to `''`. The form returns to `mailto:`, and the
unconditional claim becomes true again. Then revert the privacy wording in `privacy.html`,
`SECURITY.md`, `store/LISTING.md`, `index.html`, `llms.txt`, `llms-full.txt` and `README.md`.

**Amended 2026-09-21 — sender and recipient.** Now
`GA4 Name Changer Support <GA4NameChanger.Support@palworks.ai>` to `support@palworks.ai`.

The first deployment could not use those addresses. Its key belonged to a Resend account with
no verified domain, so sending from `palworks.ai` returned
`403 "The palworks.ai domain is not verified"`; it ran on `onboarding@resend.dev`, Resend's
shared sender, which measurably refuses every recipient but the account owner's own address.
That worked only because `TO` happened to be that address, and would have broken the moment it
changed.

`palworks.ai` is verified on the `support@palworks.ai` account, so the Worker now holds a key
from that account instead. The key is dedicated to this Worker rather than shared with another
service, is `sending_access` only, and is scoped to the `palworks.ai` domain ID, so a leak of
it could send as that domain and do nothing else. It is stored in the user's secrets folder
under the same per-app naming convention as the others.

**The rule this leaves behind:** the domain in `FROM` must be verified on the same Resend
account as `RESEND_API_KEY`. Changing one without the other returns 403 at send time, not at
deploy time, so it fails silently into the `mailto:` fallback.

---

## ADR-017 — Already-open GA4 tabs are adopted, not asked to refresh

**Status:** accepted 2026-09-19

**Context.** Chrome injects a content script only into pages that load *after* the extension
does. A Google Analytics tab that was already open at the moment of install, update or reload
therefore has no content script at all: it keeps showing raw 32-character IDs until the user
happens to refresh it.

This is the worst possible first impression. The user installs the extension, the settings page
opens, they switch back to the Analytics tab they already had open, and nothing has changed.
Most people read that as broken software, not as a page that needs reloading.

Measured, with adoption disabled: pinging the content script in an open GA4 tab immediately
after `chrome.runtime.reload()` returns *"Could not establish connection. Receiving end does not
exist."* With adoption enabled, the same ping returns alive, with no refresh of the tab.

**Decision.** On `chrome.runtime.onInstalled`, the service worker queries every tab matching
`https://analytics.google.com/*`, pings each one, and injects `content/content.js` into any that
does not answer. This covers install, update, and developer reload, all three of which orphan
open tabs.

This requires the `scripting` permission.

**Why not just tell the user to refresh.** It works, but it spends the user's goodwill on a
problem we created and can fix ourselves. A banner that says "please refresh" is an admission
that the tool does not work yet.

**Why not reload the tab for them.** `chrome.tabs.reload()` needs no extra permission and would
also work. Rejected: it discards scroll position, the report configuration the user has set up,
any date range or comparison they were in the middle of, and anything unsaved on the page.
Silently throwing away someone's work to save them one keystroke is a bad trade. Injection
achieves the same result and costs the user nothing.

**On the permission.** `scripting` is bounded by the host permissions already declared, and
`https://analytics.google.com/*` is the only one, so this grants no reach the extension did not
already have. [Inference] It is also understood to add no new user-facing permission warning,
since the warning shown is the host one that is already present; this is worth confirming
against the warning list the dashboard shows at upload, because it is the only thing that would
change what a user is asked to accept.

**Double injection.** Two guards, because either alone is insufficient:

1. `background.js` pings before injecting, so a tab that already has a live copy never gets a
   second one. This is the common case.
2. `content/content.js` calls `globalThis.__GA4NC__.teardown()` on start-up if a previous copy
   is present. This is the case the ping cannot catch: after an *update*, the old copy is
   orphaned. Its `chrome.*` context is dead, so it cannot answer a ping, but its
   `MutationObserver` is still live and still rewriting the page. The new copy tells it to
   disconnect. Teardown only undoes DOM-side work, because calling `removeListener` on an
   invalidated context throws.

**Consequence.** `permissions` gains a second entry, so `README.md`, `SECURITY.md`,
`privacy.html`, `store/LISTING.md`, `index.html` and the `llms` files all had to be updated in
the same change, per invariant 5 in AGENTS.md. The Chrome Web Store dashboard also requires a
justification for `scripting`; it is in `store/LISTING.md`.

**Reversal.** Remove `adoptOpenGA4Tabs()` and its call, drop `scripting` from the manifest, and
delete the teardown export and the `ping` handler from the content script. The extension returns
to needing a refresh.

---

## ADR-018 — The extension visits unopened properties itself, in a background tab

**Status:** accepted 2026-09-21

**Context.** A name is read out of a property's own "Page title and screen class" report, and
GA4 renders only the property being viewed. So a property the user has never opened cannot be
named. ADR-009's tiers cover everything else; this is the one remaining gap, and until now the
only remedy was asking the user to click through their properties by hand, which is what the
onboarding slide added in this release does.

Two measurements changed what was possible.

**One: GA4's own data does not contain the name.** The inlined account tree gives every
property object, and on a live profile those objects carry fourteen fields:

```
id  name  trackingId  premium  s4id  trashed  entityId  isEnhancedProperty
type  accountId  propertySubtype  standardPropertyConfig  upwardAccessOnly
permitsEditAccess
```

`name` **is** the extension ID. There is no display name anywhere. The page's `localStorage`
(seven keys), `sessionStorage` (empty), IndexedDB (no databases) and its seventeen
JS-readable cookies were all searched for ten known extension names: zero hits. This closes
off the whole family of "read it from storage or cache" ideas, and it also disposes of the GA4
Admin API, which would return the same `displayName` we already have, at the cost of OAuth, a
client secret and a network request. The report-title trick is not a workaround for a missing
API. The name is genuinely absent from Google's analytics data, and present only in the user's
own report rows because the Chrome Web Store put it in a page title.

**Two: a backgrounded GA4 tab still renders its reports.** Measured: a tab driven to an
unnamed property while a different tab held focus harvested the name in under ten seconds.
That is what makes this acceptable rather than obnoxious.

**Decision.** A "Visit and name the rest" button on the settings page. It opens **one** tab
with `active: false`, walks it through each unnamed property in turn, waits for the content
script to file a name, and closes the tab at the end.

* The button appears only when there is something to do, and carries the count.
* It turns into its own Stop control while running.
* Each property gets 30 seconds before it moves on.
* Rows are appended as names land, rather than re-rendering the table, so edits in progress
  survive.

**The query string is preserved.** The base URL is taken from a GA4 tab the user already has
open, because it carries `authuser`. Someone signed into several Google accounts is looking at
a specific one, and a URL without that parameter opens a different account's Analytics, where
none of these properties exist. This is the detail most likely to be lost in a rewrite.

**Why a new tab rather than the user's own.** Navigating a tab the user is reading, and
leaving it on a property they did not choose, is worse than opening and closing our own. The
cost is one extra tab for the duration.

**Rejected.**

* *Several tabs in parallel.* Finishes sooner, but it is a lot of load on someone else's
  servers to save a minute of something already running unattended.
* *Doing it automatically on install.* It would generate report queries the user never asked
  for. This is a button, pressed deliberately, with a count on it saying what it will do.
* *Reloading in the foreground.* Steals focus for minutes.
* *`chrome.tabs` permission.* Not needed. Querying GA4 tabs by URL, creating, updating and
  removing a tab all work under the host permission already held.

**Cost.** `local.propertyIds` is a new stored map, slug to GA4's numeric property id, mirrored
from the same tree that already supplies `propertyAccounts`. No new permission, no network
request, and nothing new is transmitted.

**Known limitation.** A property with no store-listing views has no title to read, so it times
out after 30 seconds and is reported honestly: *"the other N had no store-listing views to
read a name from."* Measured on a real account with a brand-new property. Detecting that
faster would mean exposing the content script's `awaitingReports` state so the driver could
give up as soon as the report is known to be empty rather than merely slow; worth doing if
users report the wait, not before.


---

## ADR-019 — The toolbar badge is the only place the extension says it is running

**Date.** 2026-09-21 · **Status.** Accepted

**Context.** Raised during UAT, by the person who specified the product: *"I'm not clear. How
to use our extension post load?"* That is the whole finding. A display-only extension has a
structural problem no other kind has — **once it works, it is invisible**. A name we
substituted looks exactly like a name Google rendered, so a working extension and an extension
that never loaded are pixel-identical. The user cannot tell the difference unless they already
know what the slug was, which is the knowledge the extension exists to spare them.

**Decision.** The content script counts the **distinct identifiers** it has named on the page
and reports the number to the service worker, which writes it to that tab's action badge and
title: *"GA4 Name Changer — 3 names applied on this page"*.

* **Distinct identifiers, not replacements.** GA4 prints the same slug in the breadcrumb, the
  account switcher and several report rows. "17" would say nothing about a page holding three
  extensions.
* **Per tab, never global.** The count belongs to one page. Chrome clears a tab-scoped badge
  when the tab navigates, so leaving Google Analytics needs no handling here.
* **Reset on a property switch.** A switch is a hash change, not a page load. Without an
  explicit reset the badge still read `1` while the user looked at the raw slug of a property
  with no name. Reset once per property: clearing repeatedly during the switch would drop
  names already counted, because `processedNodes` will not offer those nodes again unless GA4
  rewrites them.
* **Coalesced.** One GA4 render fires the observer many times. Reports are debounced 400ms and
  suppressed when the number has not changed, so the service worker is not woken to be told
  what it already knows.

**No new permission.** `chrome.action` is granted by declaring `action` in the manifest, which
this extension already does for its popup. The permission warning list at install is unchanged.

**Rejected.**

* *A banner or toast on the GA4 page.* Louder, and it breaks the rule that the page is never
  decorated: the extension edits text Google rendered and adds nothing of its own. A user who
  screenshots a report should not find our UI in it.
* *Colouring replaced names.* Same objection, and it would survive into screenshots and
  exported PDFs.
* *A badge on every Google Analytics page regardless of count.* It would say "installed", not
  "working", which is the question actually being asked.

**Consequence.** The badge reads empty on a property that has no name yet, which is correct but
can be read as "broken" by a user who does not know the property is unnamed. The title string
says so in words — *"nothing to rename on this page yet"* — and the popup, opened from that
same icon, offers the two naming actions directly (ADR-020).

---

## ADR-020 — The popup carries the naming actions, and hands the long one over

**Date.** 2026-09-21 · **Status.** Accepted

**Context.** Both naming actions lived only on the settings page. The popup is where the user
already is when they notice a row has no name, and it was the surface reached from the badge
that had just told them something was unnamed.

**Decision.** The popup gets the same two buttons, side by side, each shown only when it has
something to do:

* **Fill missing names** runs in the popup, exactly as on the settings page, reporting progress
  on the button itself.
* **Visit and name N more** does **not** run in the popup. It hands over to the settings page
  with `#cycle`, which starts the run there.

**Why the second one cannot run here.** Chrome destroys a popup the moment it loses focus, and
the walk takes about ten seconds per property. A run started in the popup would die the first
time the user looked at anything else, halfway through, with a stray tab left open. Handing
over is not a workaround for a missing API; it is the only correct place for a long-running
job with visible state.

**Why a missing permission hands over too.** `chrome.permissions.request()` dismisses an
extension popup before its callback runs ([crbug.com/952645](https://crbug.com/952645)), so the
popup cannot ask. Pressing the button means "do it", so it opens the settings page at the
opt-in rather than quietly offering again in the strip above.

**Consequence.** `countUnvisitedProperties()` in `popup.js` duplicates the filter in
`collectCycleTargets()` in `options.js`. Two copies of one rule, which must stay in step; the
alternative was a shared module, which this codebase does not have and which would be its
first, for eight lines.
