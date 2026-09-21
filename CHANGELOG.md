# Changelog

All notable changes to Google Analytics (GA4) Name Changer for Chrome Extension Developers are documented here.

---

## [1.1.0] — 2026-09-21

**First public release.** Version 1.0.0 was never published: it required every name to be
typed by hand. This version works the names out for itself, from the Google Analytics reports
the user already has, and adds the surfaces around that: onboarding, a listing site, a
feedback relay, and a documentation set for contributors and agents.

Headings below are grouped by the wave of work they came from, because this version was built
and tested over several days against a live Chrome Web Store developer account.

### Added

- **Name harvesting from GA4's own reports** — the primary naming source, and it costs nothing. A Chrome Web Store developer property's "Page title and screen class" report lists the store listing pages that were viewed, titled `<Extension Name> - <localised store name>`, so the extension's real name is already on the page. Titles are split on the last `" - "` (which strips the store suffix in any language and preserves names containing `" - "`), generic store pages are dropped, and the remainder ranked by views. Hints accumulate in `chrome.storage.local.nameHints` as the user browses, so visiting a property once names it permanently. Needs no permission and no network. A hint is only recorded when exactly one property slug is visible, so an open account switcher never causes a mislabel
- **Multi-account detection** — the popup previously detected only the account in the URL, so the other accounts listed in GA4's account switcher were invisible to it. All of them are now detected, paired with their labels, and a property ID sitting next to a slug is correctly never offered as an account
- **Cross-tab detection** — opening the popup from a non-GA4 tab now finds a GA4 tab elsewhere in the same window instead of falling back to cached context. Needs no new permission: Chrome exposes `url` for tabs matching host permissions the extension already holds
- **Account names suggested from their properties** — an account holding one extension is suggested that extension's name, shortened; an account holding several is suggested a draft built from all of them
- **Auto-naming from installed extensions** — a Chrome Web Store property slug is the extension's own ID, so any of those extensions installed in this Chrome profile can be named automatically via `chrome.management.get()`. Off by default and gated behind the optional `management` permission; turning it off calls `chrome.permissions.remove()`. Resolution is entirely local, so the extension still makes no network requests of any kind. Only `get` is ever called, and only the `name` field read
- **Chrome Web Store listing link** — anything neither harvesting nor `chrome.management` could name reveals a button on its row that opens the public store listing in a new tab for the user to read the name from
- **Service worker (`background.js`)** — hosts name resolution behind three independent gates: the setting, the live permission check, and an `/^[a-p]{32}$/` format check. Also opens the settings page on first install
- **Welcome modal** — two-slide onboarding on the options page, opened automatically on first install via `chrome.runtime.onInstalled`, and reachable any time from the popup's new **?** button. Slide 2 is the auto-naming opt-in and states exactly what the permission is and is not used for
- **Fill missing names** — options-page button that resolves every row holding a valid extension ID with no display name yet. Suggested names render italic until reviewed and saved
- **Popup → options handoff** — the popup stashes its rows under `chrome.storage.local.pendingDetection` before navigating to Full Settings, and the options page merges them in once and clears the key. TTL 10 minutes
- **Documentation set** — `AGENTS.md` (hard invariants and contributor contract), `DOMAIN.md` (the four identifiers and storage keys), `DECISIONS.md` (twenty-one ADRs), `PLAYBOOK.md` (setup, manual test checklist, debugging, release, rollback), `LIMITATIONS.md` (known constraints and technical debt), `SECURITY.md` (threat model and reporting)

- **Automatic naming with no save step** — derived names live in `chrome.storage.local.autoMappings` and are merged **under** the user's own `sync.mappings`, so they apply to the page immediately while anything the user typed still wins. The content script watches local storage, so a name lands the moment it is derived. `mappings` is never written to by the extension, so nothing the user owns is clobbered or synced without them asking. Auto rows show badged "auto" in both surfaces and are ordinary editable rows, so **Save** now means "make this mine". `autoNamingEnabled` (default on) turns the layer off without deleting anything
- **GA4's own account tree as the authoritative source** — every GA4 page inlines `window.preload = JSON.parse(...)` carrying every account ID, property ID and property slug with exact pairing. A content script cannot read page JS variables but can read that script element's text. This gives the current property exactly (via the property ID in the URL), every account without opening the switcher, and every property slug. It fixed a real deadlock: on one live page the slug was rendered only inside a `<button>`, so scraping could not attribute it and nothing was ever named
- **Robust name extraction** — no longer depends on one particular report table. Two independent strategies feed one score: page-title report tables weighted by views, and any store-listing-shaped text anywhere on the page. A title is recognised by its tail containing "Chrome", which held across every localisation seen live (Web Store, ウェブストア, 線上應用程式商店, Web Mağazası, Webáruház, 应用商店, 웹 스토어) and cleanly rejects the store's own pages, since "Chrome Web Store - Extensions" has a tail of "Extensions". A tie between two names returns nothing rather than guessing
- **"How are these names worked out?"** — a collapsible card on the options page explaining the three naming sources in short form
- **One settings table, grouped by account** — the settings page used to show `accountMappings` and `mappings` as two cards side by side, which is the shape of storage rather than the shape of the problem: nothing on the page said which extension sat under which account. They are now one table, with each account as a group head and the properties it holds nested beneath it, sharing the same two columns so identifiers and display names line up across both row kinds. The pairing comes from `chrome.storage.local.propertyAccounts`, mirrored out of GA4's own inline account tree, so properties file themselves the first time they are opened; anything unpaired sits in a catch-all group at the bottom and behaves identically. **The saved shape is unchanged** — still two flat maps — so the content script, the popup and every JSON file already exported keep working. Removing an account moves its properties to the catch-all rather than deleting them. See ADR-012
- **`auto` badges align down one column** — an account row carries a badge plus an add button, a property row a badge plus a delete button, and packing them toward the end put the badge at a different position on each kind, so the column zig-zagged. The actions cell is now a fixed three-slot grid, so the badge and both buttons hold the same column on every row
- **An account holding several extensions gets a combined draft name** — it used to be left blank, on the grounds that naming it after one of several extensions is arbitrary. The reasoning held; the conclusion did not. A blank field reads as a broken feature and leaves the user staring at the nine-digit account number this extension exists to remove. Such an account is now named from **all** of them — `Amazon MyOrders + Flip Rotate` — capped at 38 characters so it still fits GA4's breadcrumb. Extensions not yet named are counted rather than guessed at (`Amazon MyOrders Page Grid + 1 more`) and the label is rewritten as they are learned. Badged `auto` and editable like any other name. See ADR-015
- **Settings toolbar laid out as two columns** — the two switches were stacked in the left half of a full-width card, leaving the right half empty and the card twice as tall as it needed to be. They now sit side by side as peers, each with its own description, and stack again below 860px
- **Accordion affordance** — every collapsible section now carries a large chevron at the trailing edge that rotates 180 degrees on open, so the control reads as expandable and reports its current state. Previously the sections had only a leading topic icon and nothing indicating they opened
- **Feedback form** — name, email and message, with installation diagnostics attached. The extension never holds the Resend API key; it posts to a relay Worker that does, and falls back to a pre-filled `mailto:` when no endpoint is configured, so it works with no infrastructure and no permission

### Fixed: the naming engine

- **A property switch could write another extension's name into a property, permanently.** Google Analytics rewrites the URL as soon as you switch property but refetches its report widgets around four seconds later (measured live). Harvesting inside that window paired the new property's slug with the previous extension's name and persisted it, so the breadcrumb showed the wrong extension until something overwrote it — reported from live use as names that were wrong, that vanished, or that only a refresh would fix. A name is now attributed only once the reports have demonstrably changed since the switch and then held still for a further pass. See ADR-013
- **A wrong pairing could not heal itself.** The same name under two slugs is always a stale read, since two Chrome Web Store extensions do not share a byte-identical name. The property whose slug comes from GA4's own account tree now takes the name and the other claim is dropped, so a bad pairing written earlier is corrected on the next visit rather than blocking the rightful property forever
- **Properties in accounts outside GA4's preloaded tree were never filed.** `window.preload` carries a capped account list — 18 on a live profile that holds more, not including the account being viewed. The account and property are now read from the URL as well, so every property is filed the first time it is opened. See ADR-014
- **The first name took over 20 seconds on a cold page load.** GA4's page is interactive well before its page-title report has any rows, and a harvest pass that early saw no candidate names at all. That was treated as "settled on no name", which stopped the polling and left the first name waiting for an unrelated mutation. An empty report is now understood as "not loaded yet" and is waited out. Measured on a live account: 20s+ before, 8.7s after
- **Harvesting could stall on a page that stopped mutating.** Settling needs two passes and passes were driven only by the MutationObserver, so a page that had finished rendering never completed one. Unsettled passes are now self-driven, and a throttled call re-arms the timer instead of silently ending the chain

### Added: store listing, site and packaging

- **Chrome Web Store listing assets** — `store/LISTING.md` holds the product name, short description with three tested alternates, the full detailed description, the single-purpose statement, a permission justification for `storage`, the `analytics.google.com` host permission and the optional `management` permission, and the privacy declarations. `store/assets/` holds a 440×280 small promo tile, a 1400×560 marquee tile and five 1280×800 screenshots, rendered at exact size by `store/src/render.mjs`. Every claim in the permission justifications was checked against the source: no `management.getAll`, no `fetch`/XHR/WebSocket, no `eval`, no external script or style references, one host permission. `store/` is excluded from the package. Every example name, extension ID and account number in the copy and the imagery is fictional, and each account label shown is checked against the shipping `combineAccountName()` so nothing depicted is a label the extension could not really produce

- **Public listing site** — a one-page site at
  [palworks.github.io](https://palworks.github.io/Google-Analytics-Name-Changer-for-Chrome-Extensions/),
  served by GitHub Pages from the repo root on `main`. Self-contained HTML with inline CSS, no
  JavaScript and no third-party requests, so it renders with nothing to block. Carries a
  JSON-LD `@graph` of `WebSite`, `Organization`, `WebPage`, `SoftwareApplication`, a ten-question
  `FAQPage` and a four-step `HowTo`; Open Graph and Twitter card metadata over a 1200×630 preview
  rendered by `site/src/render.mjs`; a canonical URL; `robots.txt` naming the search and AI
  crawlers explicitly rather than leaving them to a wildcard; an image sitemap; and `llms.txt`
  plus `llms-full.txt` for language models. Every FAQ answer on the page has a matching
  `Question` in the structured data. All site files are excluded from the package

- **A new extension icon** — the old one was a card above an arrow above a second card, which
  reads as a download rather than a rename and collapsed into an indistinct blob at the 16px
  toolbar size. The new mark shows the substitution itself: a segmented upper row, the way a
  32-character ID reads to a human, above one solid bar, the way a name reads. The 16px variant
  is drawn with fewer, fatter segments rather than scaled down from the 128px one. Adds a 32px
  size, and a 512px and SVG pair for the site. `icons/src/icon.mjs` replaces the old Canvas
  generator

- **MIT licence** — the repository, the site and the store copy all described this as open
  source while no licence file existed, which legally means all rights reserved. `LICENSE`
  now says MIT, and the site's `SoftwareApplication` schema declares it

- **The feedback relay is deployed, and the feedback form now uses it** — Cloudflare Worker
  `ga4nc-feedback`, with the Resend API key as a Worker secret and never in the package.
  `FEEDBACK_ENDPOINT` points at it. A `mailto:` only arrives if the user has a configured
  desktop mail client and presses send in a second application, so on a machine using webmail
  reports were being lost silently. The form still falls back to `mailto:` if the relay is
  unreachable. No host permission was needed: the relay returns an `Access-Control-Allow-Origin`
  echoing the extension's own origin, so the POST satisfies CORS by itself and the store's
  permission list is unchanged. See DECISIONS.md ADR-016

- **Already-open Google Analytics tabs are adopted instead of being asked to refresh** — Chrome
  injects a content script only into pages that load after the extension does, so a GA4 tab open
  at the moment of install or update showed raw IDs until the user happened to reload it, which
  reads as broken software. `background.js` now queries those tabs on `onInstalled`, pings each,
  and injects the content script into any that does not answer. Measured with the behaviour
  disabled, a ping into such a tab returns "Receiving end does not exist"; with it enabled the
  same ping returns alive, with no refresh. Costs the `scripting` permission, which is bounded by
  the host permission already declared. Reloading the tab for the user was rejected: it discards
  their scroll position, report configuration and anything unsaved. Two guards prevent a double
  injection, because the ping cannot detect an orphaned copy left by an update: the content
  script now tears down any previous copy of itself on start-up. See DECISIONS.md ADR-017

- **A new icon, built from what the tool actually is** — an extension puzzle piece with analytics
  bars inside it. The previous mark was abstract to the point of saying nothing. Neither the
  Chrome Web Store nor the Google Analytics logo is reproduced: both are Google marks, and
  putting either in a third-party icon invites a rejection under the store's impersonation and
  IP policy while implying an endorsement that does not exist. A puzzle piece and a bar chart
  carry the same meaning and belong to nobody

- **A third onboarding slide: "Open each property once"** — the extension had never told users
  the one thing they actually have to do. A name is read from each property's own "Page title
  and screen class" report, and Google Analytics renders only the property being viewed, so a
  property never opened cannot be named. The slide says so and carries a CSS-only looping demo
  of three slugs turning into names, badge and all. Three rows share one set of keyframes offset
  by a per-row `--d` delay rather than one set each, and `prefers-reduced-motion` settles it on
  the end state instead of animating. It sits between the explainer and the opt-in, so the
  opt-in stays last and the popup's `#autoname` deep link, which targets the last slide, still
  lands correctly. `WELCOME_VERSION` bumped to `2` so existing users see it rather than missing
  the instruction forever; verified by loading the options page with `welcomeSeenVersion: 1`
  stored and watching onboarding reopen

- **"Visit and name the rest": the extension names the properties you never opened** — the last
  naming gap. A name is read from a property's own report and GA4 renders only the property
  being viewed, so a property never opened could not be named; the onboarding slide asks the
  user to click through them by hand, and this does it for them. One tab, opened with
  `active: false`, walked through each unnamed property, closed at the end. The button appears
  only when there is something to do, carries the count, and becomes its own Stop control while
  running. Rows are appended as names land rather than re-rendering, so an edit in progress is
  not lost.

  Two measurements made it possible. A backgrounded GA4 tab keeps rendering its reports,
  measured at under ten seconds to harvest a name, so this never takes focus. And GA4's inlined
  tree carries every property's numeric id, now mirrored into `local.propertyIds`, so a URL can
  be built for a property that has never been visited. The base URL is taken from a GA4 tab the
  user already has open so that `authuser` is preserved: without it, a user signed into several
  Google accounts would be sent to a different account's Analytics entirely.

  No new permission. Querying, creating, updating and removing a tab all work under the host
  permission already held. Verified end to end on a live account: two unnamed properties, one
  named in under ten seconds, the other correctly reported as having no store-listing views to
  read from, the temporary tab closed in both the completed and the stopped case. See
  DECISIONS.md ADR-018

- **Ruled out, with measurements, every other way of getting the name** — GA4's own property
  objects carry fourteen fields and the `name` field *is* the extension ID; the page's
  localStorage, sessionStorage, IndexedDB and cookies were searched for ten known extension
  names and returned zero hits. The GA4 Admin API would return the same `displayName` we
  already have. The name is genuinely absent from Google's analytics data and present only in
  the user's own report rows, because the Chrome Web Store put it in a page title. Recorded in
  ADR-018 so it is not re-investigated

### Fixed: user acceptance testing

- **A property nobody has named now has a row in the settings table.** The table was built
  from the names that existed, so a property Google Analytics had told us about but that
  nothing had managed to name was listed in the popup and missing from the settings page, with
  no way to type a name for it by hand and nothing for "Fill missing names" to act on. Those
  properties now get an empty row in their own account's group, which is also what re-enables
  the fill button on a profile whose only unnamed property is one of them

- **"Unsaved changes" appears next to Save in both surfaces**, and a second **Save Changes**
  sits above the table as well as below it, because the table is long enough that the footer
  button is off screen while the rows at the top are being edited. In the popup the pill means
  "you changed something" rather than "something is unsaved": detection fills the popup with
  unsaved rows every time it opens, so a pill driven by the dirty flag would be lit before the
  user had done anything. The popup gets no `beforeunload` at all, so the pill is the only
  warning it can give


- **A run now shows how long it is waiting.** "Visiting 1 of 1…" with a spinner and no number
  reads as a hang, and the wait is real: up to 30 seconds per property, and a property with no
  store-listing views uses all of it. The button now counts down, "Visiting 1 of 1… 18s", and
  discovery counts down too. Nothing about the timing changed; it just stopped being invisible

- **No chrome.\* call can hang a run any more.** The helpers already survived a call that
  *throws* after the extension is replaced. The worse case is a callback that simply never
  fires, which leaves the await pending for ever and the button spinning until the tab is
  closed. Every call now has a five-second watchdog, and the whole run has a wall-clock
  ceiling on top of the per-property timeout

- **A finished run reloads the settings page**, so the account labels it changed are visible
  rather than only the property rows it appended. Only when something actually changed, and
  only when there is nothing unsaved to lose. The result message is carried across the reload
  and the `#cycle` hash is stripped first, without which the reload would start another run.
  See ADR-021

- **An "Unsaved changes" pill in the footer.** The browser's confirmation dialog is the last
  line of defence and Chrome will not show it in a tab the user has never touched, so the
  state is now visible before they are halfway out of the page. Saving on the user's behalf
  was rejected: Save means "make this mine", and auto-saving would promote drafts they have
  never read into their own synced mappings


- **The unsaved-changes guard was arming when nobody had touched the page, and Chrome was
  blocking it.** The popup opens the settings page with `chrome.tabs.create`, and
  `consumeHandoff()` merges its rows and marks the page dirty straight away, so the page could
  be dirty before the frame had ever had a user gesture. Chrome refuses a `beforeunload`
  dialog in that state and logs *"Blocked attempt to show a 'beforeunload' confirmation
  panel"*, which is what showed up in `chrome://extensions`. The practical cost was worse than
  the log line: on a settings tab opened from the popup, the guard was not there at all. It
  now arms on the first pointer or key event, which is also exactly when Chrome will allow the
  dialog, and anything the user typed needed a gesture to type. Verified by dispatching the
  event in all three states

- **An orphaned content script could throw `Extension context invalidated` into the user's
  error log.** A content script keeps running after the extension that injected it is
  reloaded, updated or disabled: the DOM half is fine, every `chrome.*` call then throws
  synchronously, and so does reading `chrome.runtime.lastError`. The shape that bit was a
  write inside a read's callback, where the throw is uncaught. All content-script storage now
  goes through `localGet()` / `localSet()`, which guard the call and the callback body.
  Verified by clearing the error list, reloading the extension with a GA4 tab open, and
  confirming it stayed empty. The settings page, which Chrome closes on reload, keeps a
  lighter version of the same guard so a long run ends with "the extension was updated" rather
  than in silence. Recorded as invariant 12 in AGENTS.md

- **A run had four ways out and only some of them tidied up.** Every exit now passes one
  place, so the temporary tab is always closed and the button always returns to a correct
  label, including the "could not open a tab" path, which previously left the count stale

### Changed

- **The naming button works from nothing.** Found in UAT on an empty profile: the button was
  not there at all. It was hidden whenever there was nothing to visit, and a profile Google
  Analytics has never spoken to has nothing to visit for the same reason a fully named one
  does. With nothing known it now reads **"Open GA4 and name all properties"** and the run
  begins by opening Analytics in the background tab and reading the property list out of it.
  Hidden in exactly one case: GA4 has told us about properties and every one is named.

  Two measurements were needed. Opening Analytics with no `authuser` loaded a **different
  Google identity** — 18 accounts in its inlined tree and not one Chrome Web Store property,
  against 5 accounts and all 8 extensions with `?authuser=1` — so the content script now
  remembers that base in `local.ga4Base` and the settings page falls back to it. And the
  property list arrives in two writes, the URL's property at about 7.5 seconds and the full
  account tree at about 10, so discovery waits for the count to hold still rather than acting
  on the first one and calling the other seven absent. See ADR-018 and its amendment

- **"Fill missing names" is greyed out when there is nothing to fill**, with the reason on
  hover, instead of staying live and answering "no rows are waiting for a name" after the
  fact. It tracks the table as rows are typed, filled and deleted

- **A run that reads no names no longer blames your sign-in.** Reaching that point means the
  properties were found and visited, so the message now says what is actually true: they have
  no store-listing views to read a name from

- **The extension now says it is running.** Raised in UAT, by the person who wrote the spec:
  *"I'm not clear. How to use our extension post load?"* A display-only extension is invisible
  once it works, because a name it substituted looks exactly like a name Google rendered, so
  "working" and "never loaded" are pixel-identical. The toolbar icon now carries the number of
  distinct identifiers named on that page, with the tooltip reading "3 names applied on this
  page", or "nothing to rename on this page yet" when there is nothing. Per tab, cleared by
  Chrome when the tab navigates, and reset by the content script on a property switch, which
  is a hash change rather than a page load. No new permission: `chrome.action` comes with the
  `action` manifest key the popup already needs. See ADR-019

- **Both naming actions are in the popup too**, which is where the user already is when they
  notice a row has no name, and where the badge sends them. **Fill missing names** runs in the
  popup and reports on its own button. **Visit and name N more** hands over to the settings
  page with `#cycle` and the run starts there, because Chrome destroys a popup the moment it
  loses focus and the walk takes about ten seconds per property. See ADR-020

- **A combined account label keeps whole words, and counts past two extensions.** The cap was
  in characters with no floor on words, so `Google Analytics Name Changer for Chrome
  Extensions` shortened to `Google` and an account read `OpenFullPage + Google + 1 more`: one
  word that reads as somebody else's product. Two extensions now give both names at **two**
  words each, three or more give the **first** at **three** words plus `+ N more`, and the word
  floor wins over the 38-character cap when they disagree. A separator dash inside a name is
  dropped before cutting, so `OpenFullPage - Capture Screen` no longer leaves a hyphen
  dangling. The same account now reads `OpenFullPage Capture Screen + 2 more`. See ADR-015 and
  its 2026-09-21 amendment

- **The settings toolbar stopped stealing space from the text beside it.** The status message
  and the two action buttons sat in one horizontal row in the same flex container as the switch
  descriptions, so a two-line result — `Named 6 of 7. The other 1 had no store-listing views to
  read a name from.` — squeezed those descriptions down to roughly one word per line. The
  actions are now a fixed-width column of stacked buttons, which cannot take width from
  anything, and status is split by kind: **progress** goes on the button doing the work,
  replacing its label (`Visiting 2 of 7…`, `Checking 3…`) with its icon spinning, and
  **results** go to a toast pinned to the corner that fades itself out. Neither can move the
  page. **Stop** is now its own button beneath the running one instead of the running button
  changing meaning under the cursor

- **Buttons marked `hidden` are actually hidden.** `.btn-ghost` sets `display: inline-flex`, and
  an author rule beats the user agent's `[hidden] { display: none }` whatever its specificity,
  so **Visit and name the rest** stayed on screen with nothing to do and read `Visit and name 0
  more`. An explicit `[hidden]` rule per button class fixes it

- **The feedback form no longer asks for a phone number.** It was optional, never going to be used to answer anyone, and it added an entire personal-data category to the Chrome Web Store disclosure for no return. Email plus the attached diagnostics is enough to reproduce a problem and reply to it

- **Feedback now sends from `GA4NameChanger.Support@palworks.ai` to `support@palworks.ai`.**
  The first relay deployment ran on `onboarding@resend.dev`, because the key it held belonged to
  a Resend account with no verified domain and sending from `palworks.ai` returned 403. That
  shared sender only delivers to the account owner's own address, which was fragile. The Worker
  now holds a key from the account where `palworks.ai` is verified, dedicated to this Worker,
  `sending_access` only, and scoped to that one domain ID. Verified end to end: the relay
  returns 200 and Resend reports the message sent from the new address to the new recipient

- **Example data in the product is fictional too.** The settings and popup placeholder text, the
  explainer card's combined-account example, the first onboarding slide's before/after preview
  and several source comments all used our own real extension IDs, names and a real Google
  Analytics account number. The repository and the shipped package are both public, so they now
  use the same fictional cast as the store assets

- **The feedback form's input fields had no visible border.** `.field-input` set `border-color`,
  but `.input` later in the same stylesheet sets the `border` shorthand, which resets the colour
  to transparent; at equal specificity the later rule won. The fields rendered as text floating
  on a white card. Fixed with a doubled `.input.field-input` selector, which outranks it whatever
  the source order. Measured before and after: computed `border-color` went from
  `rgba(0, 0, 0, 0)` to the border token

- **The "no network requests" claim is narrowed to match what the extension now does.** It was
  unconditional and true; with the relay wired up it is not. Every statement of it in
  `privacy.html`, `SECURITY.md`, `ARCHITECTURE.md`, `README.md`, `AGENTS.md`, `store/LISTING.md`,
  `index.html`, `llms.txt`, `llms-full.txt`, the options page and two rendered store assets was
  rewritten to the narrower claim that is still true: nothing about the user's Google Analytics
  data is ever transmitted, naming and replacement make no network request at all, and the only
  thing the extension ever sends is a support message the user typed and submitted. Verified
  against the source: exactly one `fetch` in the codebase, no `XMLHttpRequest`, no `WebSocket`

- **The Chrome Web Store privacy declaration changes from "none" to Personally identifiable
  information.** Name and email are now transmitted when a user submits feedback, so the data
  type has to be declared and a privacy policy URL is now required. `store/LISTING.md` carries
  the exact wording, and the note tying the declaration back to `FEEDBACK_ENDPOINT` so it is
  reverted if the endpoint is ever removed

### Fixed: popup and account naming

- **Unsaved popup edits were silently discarded.** Clicking **Full Settings** closed the popup without preserving anything typed into it. Extension popups do not fire `beforeunload`, so the `isDirty` guard used by the options page is unavailable; the `pendingDetection` handoff replaces it
- **Accounts holding more than one extension were named wrongly.** An account was labelled after whichever single extension happened to be on screen. It is now labelled from all of them (ADR-015); one live test account holds two and another holds three
- **The slug overflow note was untrue.** It directed the user to Full Settings to map the remaining slugs, but those slugs existed only in popup memory and were never carried anywhere. The handoff now carries every detected slug, including the ones beyond the three-row display cap

### Changed: options page and docs

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
