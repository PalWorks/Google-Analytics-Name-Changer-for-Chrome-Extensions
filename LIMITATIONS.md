# LIMITATIONS.md

Known constraints, accepted trade offs, and technical debt. Read this before reporting
a bug or "fixing" something here: most entries are deliberate.

---

## Fragile by dependency on Google's UI

### The account label is an exact English string

`pairAccountLabels()` matches the literal `Chrome Web Store developer properties`.
Google can change this string in any GA4 deploy, with no notice and no version to pin
against. If they do, account label replacement stops silently while property slug
replacement keeps working.

**Mitigation, not a fix:** the content script writes an `accountLabelLastMatched`
timestamp on every successful replacement, and the popup warns when that goes 90+ days
stale while account mappings exist. This detects the breakage; it does not prevent it.

**Not localised.** A GA4 UI in any language other than English will not match at all.

### The ancestor search depth is empirical

The pairing walks up a maximum of eight DOM ancestor levels looking for the account ID.
Eight was chosen by inspecting the live GA4 DOM, not derived from anything. A GA4
layout change that adds wrapper elements can push the ID out of range.

### Property slug detection requires an exact text node

The popup's detection matches text nodes whose entire trimmed value is 20 or more
lowercase letters. If GA4 ever renders a slug with adjacent text in the same node, or
truncates it in the DOM rather than with CSS, detection returns nothing. Replacement
of already mapped slugs is unaffected; it uses substring matching.

---

## Auto naming

### Chrome blocks extensions from reading the Chrome Web Store

The obvious implementation of this feature, fetching the public listing page and reading its
title, is impossible. Chrome refuses extension-initiated requests to
`chromewebstore.google.com`, `chrome.google.com/webstore` and the CRX update endpoint on
`clients2.google.com`, even with the host permission granted. Every other origin works with
the same setup, so this is a deliberate platform protection. See [DECISIONS.md](DECISIONS.md)
ADR-004 for the measured evidence.

Names are therefore read from `chrome.management.get()` instead, which has the constraints below.

### Harvesting needs the property's report to be on screen

Names read from GA4's own reports (the primary source) require a view that actually contains
the "Page title and screen class" widget, such as Home or the Reports snapshot. On a report
that does not include it, nothing is harvested.

It also needs the listing to have been viewed in the selected date range. A brand-new
extension with no traffic will not name itself this way.

### Harvesting refuses to guess when several properties are visible

A report belongs to whichever property is selected, so a hint is only recorded when exactly
one property slug is on screen. With the account switcher open, several are, and harvesting is
skipped rather than risk attaching the wrong name to a property. In practice this means
hints are collected with the switcher closed, which is the normal browsing state.

### Account IDs other than the current one need the switcher open

Verified against live GA4: with the account switcher closed there are **no** numeric account
IDs in the DOM at all, so only the account in the URL can be detected. Opening the switcher
renders every account and all of them are picked up. There is no way to enumerate accounts
without the user opening that panel.

### A numeric ID could in principle be mistaken for an account ID

Account detection accepts an 8 to 12 digit text node whose nearest preceding label is not a
property slug. A metric rendered as a bare 8 to 12 digit number with a text label above it
would be picked up as a candidate account. GA4 formats large metrics with separators, so this
has not been observed, and a wrong row costs one click to delete before saving.

### Only extensions installed in this profile can be named by `chrome.management`

`chrome.management` sees the current Chrome profile and nothing else. An extension the user
publishes but does not have installed, or has installed under a different profile, cannot be
resolved. Those rows get a link to the public listing instead, which opens in a tab so the
user can read the name and type it.

This means coverage is good for a developer working in the browser where their own extensions
are installed, and poor for someone auditing a portfolio they do not run locally.

### The name comes from the local install, not the store listing

`chrome.management.get()` reports the name from the installed extension's manifest, which is
the store listing name in practice but is not guaranteed to be. If a listing was renamed and
the local copy has not updated yet, the older name is suggested. Suggestions are marked and
must be reviewed before saving, so this surfaces rather than silently persisting.

### Unpacked and sideloaded extensions resolve too

Anything installed in the profile resolves, including development builds loaded unpacked. That
is usually helpful, but the name shown is whatever that build's manifest says.

### The `management` permission is broader than what is used

`chrome.management.get()` is the only call made, and only its `name` field is read. The
permission it requires also allows enabling, disabling and uninstalling extensions. There is
no narrower read-only variant to request. It is kept optional so that a user who does not want
the feature never grants it, but a user who does grant it is trusting the extension with more
capability than it exercises.

### The 90 day label staleness window is a guess

A reasonable default with no empirical basis behind it.

---

## Behavioural

### Removing a mapping does not undo it until reload

Deleting a mapping stops future replacements but does not restore text already
rewritten on an open page. The original GA4 text returns on the next page load.
Reversing in place would mean retaining every original value indefinitely, which is a
memory cost paid on every page for an uncommon action.

### The popup cannot warn about unsaved changes

Extension popups do not fire `beforeunload`. Closing the popup with the X, by clicking
outside it, or by pressing Escape discards unsaved rows with no warning. The
`pendingDetection` handoff covers only the Full Settings and auto naming paths, because
those are the ones the extension itself initiates.

### The popup caps detection at three rows

More detected slugs than that produce an overflow note. All of them are carried to the
options page by the handoff, but the popup itself will not render them.

### The handoff can fire when not expected

`pendingDetection` is consumed by whichever options page loads first within 10 minutes.
Opening the options page independently, shortly after using the popup on a GA4 tab, will
pick up those rows. This is usually the desired behaviour and is why the TTL is short.

---

## Storage

### Sync quota caps the number of mappings

`mappings` and `accountMappings` are each a single `chrome.storage.sync` item, subject
to `QUOTA_BYTES_PER_ITEM` of 8192 bytes. At a 32 character slug plus a typical display
name, that is roughly 130 to 150 property mappings. Size is checked before saving and
the save is refused with an error rather than silently truncated. Import separately
caps at 200 entries.

**If this becomes a real ceiling,** the fix is splitting across multiple sync items, or
moving to `chrome.storage.local` and losing cross device sync. Neither is implemented.

### Mappings are global, not per account

One slug maps to one name everywhere. A slug appearing under two GA4 accounts cannot
have a different name in each.

---

## Engineering

### There is no automated test suite

Zero unit tests, zero integration tests, no CI. Verification is the manual checklist in
[PLAYBOOK.md](PLAYBOOK.md). The replacement engine's core behaviours, mutation loop
prevention and pass ordering, are exactly the kind of thing tests would catch and
currently nothing does.

**Why it has not been added:** the interesting behaviour only exists against a live,
authenticated GA4 SPA. Meaningful coverage needs a DOM harness with recorded GA4
fixtures, which is a larger piece of work than the extension itself.

### GA4's own breadcrumb lags a property switch by about four seconds

Switching property rewrites the URL at once, but Google Analytics keeps rendering the
**previous** property's name in its breadcrumb for roughly four seconds before catching up.
Measured directly: with this extension's replacement switched off, the raw slug on the page is
still the old property's at t+3s and has changed by t+5s.

The extension renders whatever GA4 currently shows, so for those few seconds it shows the
previous extension's display name. There is no fix from inside a content script that does not
involve inventing text GA4 has not rendered, which the design refuses. A page refresh resolves
it immediately.

This is distinct from the bug fixed in ADR-013, where the wrong name was *persisted* rather
than merely displayed late.

### A combined account label names two extensions, and counts the rest

The label is kept near 38 characters so it fits GA4's breadcrumb beside the property name. Two
extensions get about 17 characters each, which reads well. Three or more do **not** all fit, so
only the first is named, at three words or more, and the rest are counted: `Tab Session Saver
Pro + 2 more`. An account holding four extensions therefore shows one of them by name.

That is the trade, and it replaced a worse one: cutting all three to about ten characters gave
`Alpha Tab + Beta + Gamma`, three fragments rather than a label. Where the word floor and the
character cap disagree the floor wins, so a label may run a character or two long. See ADR-015
and its 2026-09-21 amendment. Every label is editable.

### A property is filed under its account only once it has been opened

`propertyAccounts` is built from GA4's preloaded account tree, which is capped (18 accounts on
a live profile that holds more), plus the account in the URL of each page actually visited.
A property in neither source sits in the settings table's catch-all group until the user opens
it once. Nothing about replacement depends on this; only the grouping does.

### The popup and options page duplicate logic

`makeRow`, `renderEmptyState`, `getMappingsFromDOM`, `save`, and the entire import and
export block exist in near identical form in both `popup/popup.js` and
`options/options.js`, and have already drifted in their copy and validation messages.
A shared module would fix this, but with no build step it would mean a third script tag
and manual load order management. Currently accepted; revisit if a third surface appears.

### A property that is never visited and is not installed cannot be named automatically

This is the one remaining gap, and the only thing a backend would close. Harvesting covers any
property the user opens in GA4; `chrome.management` covers anything installed locally; the
listing link covers the rest manually. See [DECISIONS.md](DECISIONS.md) ADR-010 for why no
backend is built yet.

### The account name shortener is a heuristic

An account is labelled from its property's extension name, cut to roughly 24 characters on a
word boundary with any dangling connector word trimmed. "Bulk Bookmark Cleaner Queries as
Tabs" becomes "Bulk Bookmark Cleaner". It is a suggestion in an editable field, not a rule.
