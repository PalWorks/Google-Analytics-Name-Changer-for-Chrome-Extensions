# Chrome Web Store listing

Copy for the developer dashboard. Fields are in the order the dashboard asks for them.
Nothing in this folder ships inside the package. See `.crxignore`.

**Every example name, extension ID and account number in this file and in `src/` is
fictional.** Real ones are not used: an account number ties our own Analytics estate to a
public, permanently mirrored asset, and a real product name in a promo tile reads as an
advertisement for that product rather than for this tool. The cast below is checked against
the shipping `combineAccountName()` so every label shown is one the extension would really
produce.

| Example | Role |
|---|---|
| `Tab Session Saver Pro` | the hero name, shown in both tiles |
| `Dark Mode Everywhere` | shares an account with the hero, giving `Tab Session Saver + Dark Mode` |
| `Coupon Finder - Auto Apply` | contains " - ", so it proves the last-separator split |
| `Quick Screenshot and Annotate` | long enough to show the account label being shortened |
| `Bulk Bookmark Cleaner and Sorter` | second shortening case |
| `Price History Tracker` | short, so account and property labels come out identical |

---

## Product name

```
Google Analytics (GA4) Name Changer for Chrome Extension Developers
```

67 characters, within the 75-character limit.

---

## Short description (summary)

Shown under the title in search results and on the listing card. **132 characters maximum.**

```
See real extension names in GA4 instead of 32-character IDs. Automatic, local, and it never sends your analytics anywhere.
```

122 characters.

### Alternates, if you want to test something different

| Variant | Chars | Angle |
|---|---|---|
| `Replace 32-character extension IDs in Google Analytics with real names. Automatic, local, and your analytics stay yours.` | 120 | Plain-benefit |
| `GA4 shows your extension as a 32-character ID. This shows its name, automatically, with no account and no network calls.` | 120 | Problem-first |
| `Rename GA4 property slugs and account numbers to real Chrome extension names. Works automatically. No tracking at all.` | 118 | Keyword-dense |

---

## Category and language

* **Category:** Developer Tools
* **Language:** English
* **Website:** https://palworks.github.io/Google-Analytics-Name-Changer-for-Chrome-Extensions/
* **Support URL:** https://github.com/PalWorks/Google-Analytics-Name-Changer-for-Chrome-Extensions/issues
* **Privacy policy URL:** https://palworks.github.io/Google-Analytics-Name-Changer-for-Chrome-Extensions/privacy.html
  (**required**, because the item now declares a data type. See Privacy practices below.)

---

## Detailed description

> Paste as plain text. The store renders line breaks but not Markdown, so the copy below uses
> spacing and capitals rather than syntax.

```
Chrome Web Store analytics arrive in Google Analytics 4 under a 32-character extension ID,
and every developer account is labelled with the same generic string. If you ship more than
one extension, every report, comparison and account switcher looks identical.

This extension puts your real names back, live inside analytics.google.com.

inkkcgalfjninhfflfhkflidilkjmhof   →   Tab Session Saver Pro
241067359                          →   Tab Session Saver + Dark Mode


IT NAMES YOUR EXTENSIONS FOR YOU

There is nothing to set up. Open a Chrome Web Store property in Google Analytics and the name
appears by itself, usually within a few seconds.

It works because the name is already on your screen. Your own "Page title and screen class"
report lists your store listing, and the Chrome Web Store titles every listing page
"<Extension Name> - Chrome Web Store". Splitting that suffix off the end gives the name, with
no lookup and no request to anyone.

Because the split takes the last separator, it works in every language the store is published
in (Интернет-магазин Chrome, Chrome ウェブストア, Cửa hàng Chrome trực tuyến), and it keeps
names that themselves contain a dash intact. It also works for extensions you do not have
installed.


ACCOUNT NUMBERS GET REAL NAMES TOO

Google labels every Chrome Web Store developer account identically, so the nine-digit account
number is the only thing telling them apart. Each account is named after the extension it
holds. An account holding several is named after all of them, as in "Tab Session Saver + Dark
Mode". Extensions it has not seen yet are counted rather than guessed at, so a half-explored
account reads "Tab Session Saver Pro + 1 more" and corrects itself when you open the rest.


EVERYTHING IN ONE TABLE

The settings page shows every account with the extensions it owns nested underneath, paired
from Google Analytics' own account tree. Worked-out names are badged "auto". Type over any of
them and press Save, and yours wins from then on: on this machine and, through Chrome sync,
on your others.

Import and export the whole set as plain JSON, so you can move it between machines or keep it
in version control.


YOUR ANALYTICS NEVER LEAVE YOUR DEVICE

There is no account to create, no telemetry, no analytics and no tracking. Every name is
worked out from the page already open in front of you, and naming and replacing make no
network request at all.

Your traffic figures, revenue, user counts, property names and account numbers are never
transmitted. Not to us, not to anyone.

The extension sends exactly one thing, and only when you ask it to: if you fill in the
feedback form on the settings page and press send, your message, your email address, your
name if you gave one, and the installation details shown to you on that same page are sent
so that your report can be answered. Those details are counts and version numbers only, with
no property slugs, no display names, no account numbers and no URLs. If you never use the
form, the extension never makes a request.

Nothing in your Google Analytics account is modified. The replacement is display-only and
lives in your browser; your configuration, your data and your reports are untouched. Remove
the extension and Google Analytics looks exactly as it did before.


ONE OPTIONAL EXTRA

If you would like it, you can grant Chrome's "management" permission and any extension ID that
matches something installed in your own Chrome profile is named from Chrome directly. It is
off by default, it reads names and nothing else, and switching it off hands the permission
straight back. Names are resolved entirely locally, with no network request.


WHO IT IS FOR

- Chrome extension developers reading Chrome Web Store analytics in GA4
- Anyone publishing more than one extension from one developer account
- Agencies and studios managing extensions across several Google Analytics accounts
- Teams comparing installs, uninstalls and store-listing traffic across a portfolio


OPEN SOURCE

Plain JavaScript. No build step, no bundler, no dependencies, no remote code. What ships is
what you can read on GitHub, and the full architecture, the design decisions and the known
limitations are all written down in the repository.
```

---

## Single purpose

The store requires one sentence describing a single purpose.

```
This extension replaces Chrome Web Store extension IDs and Google Analytics account numbers
shown on analytics.google.com with display names chosen by the user, so that Chrome Web Store
developers can read their own analytics.
```

---

## Permission justifications

Paste each into the matching box in the dashboard. Keep them literal. Every claim here is
verifiable from the source.

### `storage`

```
Stores the display names the user assigns to their extension IDs and Google Analytics account
numbers, plus their preferences. This is the extension's entire function: without storage there
is nothing to substitute onto the page. Names the user types are kept in chrome.storage.sync so
they follow the user's Chrome profile; names the extension works out for itself are kept in
chrome.storage.local and stay on the device. No storage is read or written by any remote party,
because the extension has no backend for them. The only data the extension ever transmits is
a support message the user types into the feedback form and submits themselves.
```

### Host permission: `https://analytics.google.com/*`

```
The extension's only function is to substitute readable names for extension IDs and account
numbers as they are displayed inside Google Analytics. That requires reading and rewriting text
nodes on analytics.google.com, and nowhere else. This is the single site listed, there are no
wildcard or broad host permissions, and no page content is collected, transmitted or stored off
the device. The rewriting is display-only and does not alter the user's Google Analytics data
or configuration.
```

### Optional permission: `management`

```
Optional and off by default. When the user turns it on, the extension calls
chrome.management.get() with a 32-character extension ID taken from the user's own Google
Analytics property list, in order to read that extension's name and show it instead of the ID.

Only the "name" field is read. Nothing is installed, uninstalled, enabled, disabled or modified,
and chrome.management.getAll() is never called, so no inventory of the user's extensions is ever
built. The only other management call in the source is chrome.management.getSelf(), used to note
this extension's own install type on a support report the user chooses to send; that call needs
no permission and returns information about this extension only. The permission is requested at the moment the user enables the feature, never at install,
and turning the feature off calls chrome.permissions.remove() to hand it straight back.

It is needed because Chrome deliberately blocks extensions from requesting the Chrome Web Store
(chromewebstore.google.com and the CRX update endpoint), so an extension's public name cannot be
fetched. Reading it locally through chrome.management is the only way to resolve an ID the user's
own Google Analytics reports have not already named.
```

### Remote code

```
No. The extension contains no remote code. There is no build step, no bundler, no external
library, no CDN reference and no eval or dynamically constructed code. Every file in the package
is plain JavaScript, CSS and HTML that can be read as shipped.

The extension makes exactly one network request, and it is not code: the feedback form on the
settings page posts the user's own message as JSON to a relay that forwards it by email. It
fires only on form submission, and nothing is ever executed from the response.
```

---

## Privacy practices

### What the extension collects

```
Only what a user types into the optional feedback form and submits. The extension has no
analytics, no telemetry and no tracking, and it transmits nothing in the background. Nothing
about the user's Google Analytics data is ever collected or transmitted.

When, and only when, a user fills in the feedback form on the settings page and presses send,
their message, their email address, their name if supplied, and installation details are sent
to a relay operated by the developer, which forwards them by email so the report can be
answered. The installation details are shown to the user on that same page before they send,
and are counts, version numbers and flags only: no property slugs, no display names, no
account numbers and no URLs. This data is used solely to reply to the user and reproduce the
problem. It is never sold and never used for advertising or profiling.
```

### Data-use certifications

Tick all three. They remain accurate: the email provider is a service provider processing the
message on the developer's behalf, which is an approved use case, and answering a support
request the user initiated is within the item's single purpose.

* I do not sell or transfer user data to third parties, outside of approved use cases
* I do not use or transfer user data for purposes unrelated to my item's single purpose
* I do not use or transfer user data to determine creditworthiness or for lending purposes

### Data types

Declare **Personally identifiable information** only, and in the "how it is used" box state:
name and email address, supplied voluntarily by the user in the feedback form, used only to
reply to their support request.

Everything else on the store's list is **not** collected: no health information, no financial
information, no authentication information, no personal communications beyond the support
message the user chose to send, no location, no web history, no user activity, and no website
content. The names the user assigns stay in their own Chrome profile and are never transmitted.

> This section is tied to `FEEDBACK_ENDPOINT` in `options/options.js`. If that is ever set
> back to `''`, the form reverts to opening the user's own mail client, the extension
> transmits nothing, and this declaration must be reverted to "none". See DECISIONS.md
> ADR-016.

---

## Assets

Rendered by `store/src/render.mjs` into `store/assets/`, at the exact sizes the store requires.

| File | Size | Slot |
|---|---|---|
| `promo-tile-small-440x280.png` | 440 × 280 | Small promo tile |
| `promo-tile-marquee-1400x560.png` | 1400 × 560 | Marquee promo tile |
| `screenshot-1-1280x800.png` | 1280 × 800 | The problem, and the fix |
| `screenshot-2-1280x800.png` | 1280 × 800 | Where the names come from |
| `screenshot-3-1280x800.png` | 1280 × 800 | Zero setup, in three steps |
| `screenshot-4-1280x800.png` | 1280 × 800 | One table, accounts and extensions |
| `screenshot-5-1280x800.png` | 1280 × 800 | Private by design, and the permissions |

Upload the screenshots in that order: the set reads as a sequence.

To regenerate after editing anything in `store/src/`:

```bash
node store/src/render.mjs           # all assets
node store/src/render.mjs shot-3    # just one
```

---

## Search terms worth covering

Already present in the copy above. Listed so they survive a rewrite.

`GA4` · `Google Analytics 4` · `Chrome Web Store analytics` · `extension ID` · `property slug` ·
`developer account` · `rename property` · `Chrome extension developer tools` · `store listing` ·
`installs and uninstalls` · `account switcher` · `display name`
