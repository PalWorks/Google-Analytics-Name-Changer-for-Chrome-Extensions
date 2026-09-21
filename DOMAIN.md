# DOMAIN.md

The vocabulary of this project. Four different identifiers are in play and three of
them are numeric or alphanumeric strings with no labels attached in the UI. Confusing
them is the single most common source of error in this codebase, for humans and agents
alike.

---

## The identifiers

**Table: GA4NC-Identifiers**

| Name in this repo | Format | Example | Where it appears | Used for |
|---|---|---|---|---|
| **Property slug** | exactly 32 chars, alphabet `a` to `p` | `aaomaanggjideicdjgoiohaodklelkjd` | Rendered as the property *name* in the GA4 UI | Key of `mappings`; also the Chrome extension ID |
| **GA4 property ID** | 9 digit integer | `513919695` | URL hash, after `p` | Not used by this extension |
| **GA4 account ID** | 9 digit integer | `375356834` | URL hash after `a`; also rendered under the account name | Key of `accountMappings` |
| **Chrome extension ID** | exactly 32 chars, alphabet `a` to `p` | `aaomaanggjideicdjgoiohaodklelkjd` | Chrome Web Store listing URL | Same string as the property slug |

### The one insight the whole auto naming feature rests on

**For Chrome Web Store developer properties, the GA4 property slug and the Chrome
extension ID are the same string.** Google provisions the GA4 property using the
extension's ID as its name. So the rendered GA4 page already contains enough to
identify the extension, two ways:

1. **GA4's own reports already contain the name.** The "Page title and screen class" report
   lists the store listing pages that were viewed, titled `<Extension Name> - <store name>`.
   This is the primary source: free, no permission, and it works whether or not the extension
   is installed. See [DECISIONS.md](DECISIONS.md) ADR-009.
2. **`chrome.management.get(<slug>)`** returns the extension's name if it is installed
   in this Chrome profile. Local and instant, but only covers this profile.
3. **`https://chromewebstore.google.com/detail/<slug>`** is the public listing URL,
   which the UI offers as a link for anything the first two could not name.

Note the asymmetry: the extension can **link** to (2) but cannot **read** it. Chrome
blocks extension-initiated requests to the Web Store entirely. See
[DECISIONS.md](DECISIONS.md) ADR-004 for the measurements.

### Reading a GA4 URL

```
https://analytics.google.com/analytics/web/?authuser=3#/a375356834p513919695/reports/...
                                                        └────┬────┘└───┬────┘
                                                      account ID   property ID
```

The property **slug** is not in the URL. It only exists in the rendered DOM, which is
why detection has to walk the page rather than parse the address bar.

---

## The two problems this extension solves

### Problem 1: property names are opaque

Google names each shared Chrome Web Store property after the extension ID. A developer
with twenty extensions sees twenty 32 character strings and must cross reference every
one of them by hand.

**Solution:** the user maps slug to a display name; the content script rewrites matching
text nodes as GA4 renders them.

### Problem 2: account labels are identical

Every Chrome Web Store developer account carries the byte identical label
`Chrome Web Store developer properties`. The only thing distinguishing one row from
another is the 9 digit account ID sitting in a nearby text node.

**Solution:** `pairAccountLabels()` finds a label node, walks up to eight ancestor
levels looking for a sibling text node whose trimmed value is a key in `accountMappings`,
and renames the label. The numeric ID is deliberately left in place so it stays visible
beneath the new display name.

This pairing is the most fragile part of the extension, because it depends on an exact
English string that Google controls. That is why the label health heartbeat exists: see
`accountLabelLastMatched` in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Terms used in the code

| Term | Meaning |
|---|---|
| **mapping** | One slug to display name pair. Property mappings live in `mappings`, account mappings in `accountMappings`. |
| **detection** | The popup asking the content script what is currently on the GA4 page: the account ID from the URL hash, plus unmapped slugs found in the DOM. |
| **handoff** | `chrome.storage.local.pendingDetection`. Carries popup rows, including detected slugs the popup's three row cap never rendered, to the options page. TTL 10 minutes, consumed once. |
| **resolution / auto naming** | Turning an extension ID into that extension's name via `chrome.management.get()` in `background.js`. Opt in, off by default, entirely local. |
| **unresolved** | A valid extension ID that is not installed in this profile, so it could not be named automatically. Its row reveals a link to the public store listing. |
| **settle** | The state a property's report widgets reach once they have changed since the last property switch and then held still for a pass. Names are attributed only after settling, because GA4 changes the URL ~4s before it refreshes the reports. See ADR-013. |
| **account label draft** | The name given to an account holding more than one extension. Two: both names cut down and joined with `+`, two words minimum each. Three or more: the first name at three words minimum, then a count. Kept near 38 characters, though the word floor wins where the two disagree. Extensions not yet named are counted into that same `+ N more`, never guessed at. Badged `auto`; editing and saving promotes it. |
| **account group** | How the settings table is drawn: an account row with the properties it holds nested beneath it. Purely presentational. Storage stays two flat maps, and the pairing that drives the grouping lives separately in `propertyAccounts`. |
| **auto mapping** | A name the extension worked out for itself, held in `autoMappings` and applied to the page immediately. Always overridden by a mapping the user typed. Shown badged "auto"; editing and saving promotes it into the user's own `mappings`. |
| **account tree** | `window.preload` on every GA4 page, a script block carrying every account ID, property ID and property slug with exact pairing. The authoritative source for structure. |
| **name hint** | An extension name read out of GA4's own "Page title and screen class" report, where store listing titles appear as `<Extension Name> - <store name>`. Free, needs no permission, and works for extensions that are not installed. Stored in `nameHints`. |
| **suggested name** | A display name produced by resolution rather than typed by the user. Rendered italic and accent coloured until edited or saved. |
| **label health heartbeat** | `chrome.storage.local.accountLabelLastMatched`. Timestamp of the last successful account label replacement. Stale for 90+ days means Google probably renamed the label. |

---

## Storage keys

**Table: GA4NC-StorageKeys**

| Key | Area | Type | Written by | Purpose |
|---|---|---|---|---|
| `mappings` | sync | `{ [slug]: name }` | popup, options | Property slug to display name |
| `accountMappings` | sync | `{ [accountId]: name }` | popup, options | Account ID to display name |
| `autoResolveNames` | sync | `boolean` | options | Auto naming opt in. Absent or false means off. |
| `welcomeSeenVersion` | sync | `number` | options | Onboarding already shown for this version |
| `lastGA4Context` | local | `{ accountId, slugs }` | content script | Popup fallback when the active tab is not GA4 |
| `accountLabelLastMatched` | local | `number` (ms) | content script | Label health heartbeat |
| `pendingDetection` | local | `{ ts, accountId, properties, accounts }` | popup | Popup to options handoff |
| `nameHints` | local | `{ [slug]: name }` | content script | Names harvested from GA4 reports; accumulates as the user browses |
| `autoMappings` | local | `{ [slug]: name }` | content script | Derived property names, applied without a save. Merged **under** `mappings`. |
| `autoAccountMappings` | local | `{ [accountId]: name }` | content script | Derived account names, likewise merged under `accountMappings` |
| `autoNamingEnabled` | local | `boolean` | options | On-page automatic naming. Absent or true means on. |
| `propertyAccounts` | local | `{ [slug]: accountId }` | content script | Account each property belongs to, from GA4's inline tree and from the URL. Groups the settings table; never used for replacement. |
| `ga4Base` | local | `string` | content script | The origin, path and **query** of a GA4 page the user opened, with no hash. It exists for the query: `authuser`. Opening Analytics without it loads a different Google identity, whose account tree holds none of these properties (measured: 18 accounts and 0 Chrome Web Store properties without it, 5 and 8 with it). The settings page needs it to open Analytics when no GA4 tab is open. Never transmitted. |
| `propertyIds` | local | `{ [slug]: propertyId }` | content script | GA4's **numeric** id for each property, from the same tree. With `propertyAccounts` it is enough to build a GA4 URL for a property the user has never opened, which is what "Visit and name the rest" navigates to (ADR-018). Never used for replacement. |

Sync keys count against `chrome.storage.sync.QUOTA_BYTES_PER_ITEM` (8192 bytes per
item). Both mapping objects are size checked before every save. Local keys are not
synced and never leave the device.
