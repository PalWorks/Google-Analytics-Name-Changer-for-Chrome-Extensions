# Google Analytics (GA4) Name Changer for Chrome Extension Developers

> Replace unreadable GA4 property slugs and account numbers with human-friendly display names — directly inside [analytics.google.com](https://analytics.google.com), in real time.

---

## The problem

When Google shares GA4 analytics with Chrome Web Store developers, every property appears as an opaque 32-character slug (`aaomaanggjideicdjgoiohaodklelkjd`) and every account carries the same generic label — "Chrome Web Store developer properties" — differentiated only by a 9-digit ID. Managing more than a handful of extensions means constant cross-referencing to figure out which property belongs to which extension.

## The solution

This extension intercepts GA4's rendered text and swaps those identifiers for names you choose — with no page reload, no changes to your GA4 configuration, and nothing ever leaving your browser.

---

## Features

- **Works immediately, with no refresh** — a Google Analytics tab that was already open when you installed or updated the extension is adopted on the spot. Chrome does not inject content scripts into pages that were already loaded, so without this those tabs would sit showing raw IDs until you happened to reload them
- **Name the properties you have never opened** — a name is read from each property's own report, so a property you have not visited cannot be named. One button on the settings page visits them for you: it opens a single background tab, walks it through each unnamed property, and closes it when done. Roughly ten seconds each, it never takes focus, and you can stop it at any point
- **Live text replacement** — slugs and account labels replaced as GA4 renders; works seamlessly across SPA navigation without requiring a page reload
- **Toolbar popup** — left-click the extension icon to view and edit mappings from any tab without leaving your current page
- **GA4 auto-detection** — open the popup and it scans the GA4 page for unmapped property slugs and for **every account** in the account switcher, not just the one you are viewing, pre-filling rows ready to name. Works even when GA4 is in another tab in the same window
- **Full settings page** — a dedicated full-tab settings page for managing all mappings with more room; reachable from the popup header or from `chrome://extensions`
- **Cross-device sync** — mappings stored in `chrome.storage.sync` and synced across your signed-in Chrome profiles automatically
- **Import / Export** — back up or transfer all mappings as a single JSON file
- **Automatic naming, no setup** — open a GA4 property and it names itself. The real extension name is read straight out of GA4's own reports and applied on the spot, with no save step and no network request. Anything you type overrides it. Extensions installed in your profile can also be named from Chrome itself (optional, off by default). Anything neither source covers gets a one-click link to its store listing. Every suggestion is reviewed before saving, and none of it touches the network
- **Guided onboarding** — a three-slide welcome modal on first install: what the extension does, the one thing you have to do (open each property once, with a looping demo showing slugs turning into names), and the auto-naming opt-in; reachable again any time from the popup's **?** button
- **Label health monitoring** — warns inside the popup if the "Chrome Web Store developer properties" label hasn't been matched in 90+ days, signalling that Google may have silently renamed that UI element
- **One settings table** — accounts and the extensions they hold in a single grouped view, paired automatically from Google Analytics' own account tree
- **Feedback form** — report a problem from the settings page, with installation details attached so support can reproduce it
- **Two permissions, both narrow** — `storage` to save your names, and `scripting` so a Google Analytics tab that was already open when you installed or updated the extension starts working without a refresh. `scripting` is bounded by the single host permission for `analytics.google.com`, so it can reach nothing else. `management` is optional and off by default
- **Zero data collection** — no analytics, no telemetry and no tracking. Nothing about your Google Analytics data is ever transmitted. The only request the extension ever makes is sending a support message you type and submit yourself in the feedback form

---

## Installation

### Chrome Web Store *(recommended)*

*Coming soon.*

### Load unpacked (development)

1. Clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repository root
5. Pin the extension via the puzzle-piece icon in the toolbar

---

## Usage

### Quick path — popup

Click the extension icon in the Chrome toolbar. If the active tab is a GA4 page, the popup auto-detects your current account ID and any unmapped property slugs and pre-populates them with the slug already filled in — type a display name and click **Save**.

If you are not on a GA4 tab, the popup shows the last detected GA4 context so you can still review or edit existing mappings.

### Full settings page

Click **Full Settings** in the popup header, or right-click the extension icon → **Options**.

Everything lives in one table. Each account is a group head, and the extensions it holds are
listed beneath it:

```
ACCOUNT NUMBER / PROPERTY SLUG        DISPLAY NAME
241067359                             Quick Screenshot                    +
  └ aaomaanggjideicdjgoiohaodklelkjd  Quick Screenshot…      auto
  └ gdkmpfibhnoacledjjmpgnbpaikchbkm  Bulk Bookmark Cleaner          auto
NOT LINKED TO AN ACCOUNT
    nhhpkdpejegfbcgajapklajkhfnecnkk  Price History Tracker      auto
```

The pairing comes from Google Analytics itself, so properties file themselves under the right
account the first time you open them. Anything not filed yet sits at the bottom and works
exactly the same. Removing an account keeps the properties under it — they are separate
mappings.

Rows marked `auto` were worked out by the extension. Edit any of them and press **Save
Changes** to make that name permanently yours.

### Finding your identifiers

| Identifier | Format | Where to find it |
|---|---|---|
| Account number | 9-digit integer | Left panel of the GA4 account switcher, beneath the account name |
| Property slug | 32 chars, `a` to `p` | Displayed as the property name in the GA4 interface. **This is your extension's Chrome Web Store ID**, which is what makes auto-naming possible. |

Note that the numbers in the URL hash (`#a{accountId}p{propertyId}/…`) are GA4's own account and property IDs. The account ID there is the one you want; the property ID is not the slug and is not used by this extension.

### Auto-naming your extensions

There are three sources, tried in order. The first two are automatic and cost nothing.

**1. GA4's own reports (automatic, no setup).** A Chrome Web Store developer property's
"Page title and screen class" report lists the store listing pages that were viewed, and the
store titles them `<Extension Name> - Chrome Web Store`. So your extension's real name is
already on the page:

```
Bulk Bookmark Cleaner and Sorter - Chrome Web Store        60 views
Bulk Bookmark Cleaner and Sorter - Интернет-магазин Chrome  1
Chrome Web Store - Extensions                                      0   ← generic, ignored
```

The extension reads that, strips the store suffix in whatever language it appears, and
remembers the name against that property slug. Just open a property in GA4 and it names
itself. Names accumulate as you browse, so visiting a property once is enough.

It only records a name when a single property is on screen. With the account switcher open
several are visible at once and there is no reliable way to tell which one the report belongs
to, so it skips rather than risk mislabelling.

**2. Your installed extensions (optional, off by default).** Turn on
**Auto-name from your installed extensions** in Full Settings and Chrome will ask for the
`management` permission. After that, any slug matching an extension installed in your profile
is named from Chrome directly. Used only to call `chrome.management.get()` and read a name;
nothing is installed, enabled, disabled or changed, and turning the feature off revokes the
permission.

**3. The store listing link (manual).** Anything the first two could not name shows a link on
its row that opens the public Chrome Web Store listing in a new tab, so you can read the name
and type it.

**Accounts are named too.** An account holding one extension takes that extension's name,
shortened. An account holding several has no single right name, so it gets a draft built from
all of them:

```
241067359   Tab Session Saver + Dark Mode
```

Extensions in that account that have not been named yet are counted rather than guessed at, so
a half-known account reads `Dark Mode Everywhere Page Grid + 1 more` and is rewritten as the rest are
learned. Every draft is marked `auto` and is yours to rewrite.

Nothing leaves your browser in any of this. Naming and replacement make no network request at all.

> **Why not just read the store listing directly?** Because Chrome will not allow it.
> Extensions are blocked from making requests to `chromewebstore.google.com`, which is a
> deliberate platform protection. [DECISIONS.md](DECISIONS.md) ADR-004 has the measurements.

### Import / Export

Click **Export** to download a JSON backup of all your mappings. Click **Import** to bulk-load from a previously exported file. File format:

```json
{
  "mappings": {
    "aaomaanggjideicdjgoiohaodklelkjd": "My Extension Name"
  },
  "accountMappings": {
    "268430912": "Main CWS Account"
  }
}
```

---

## Privacy

The extension processes page text locally inside your browser and stores only the display names you type. It has no analytics and no telemetry, and nothing about your Google Analytics data is ever transmitted, including with auto-naming enabled.

The one exception is the feedback form on the settings page: when you fill it in and press send, the name, email, message and the installation details shown to you on that same page are posted to a relay that forwards them by email, so your report can be answered. It sends nothing unless you submit it, the diagnostics contain no slugs, names, account numbers or URLs, and if the relay is unreachable the form falls back to your own mail client. See [privacy.html](privacy.html) and [DECISIONS.md](DECISIONS.md) ADR-016.

If you are signed into Chrome, `chrome.storage.sync` may sync your mappings between your devices via your Google account, subject to [Google's privacy policy](https://policies.google.com/privacy).

Full policy: [palworks.github.io/…/privacy.html](https://palworks.github.io/Google-Analytics-Name-Changer-for-Chrome-Extensions/privacy.html)

---

## Project structure

```
├── manifest.json               MV3 manifest
├── background.js               Service worker — local name resolution, first-run onboarding
├── content/
│   └── content.js              Content script — MutationObserver + text replacement engine
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js                Toolbar popup — GA4 auto-detection and quick mapping editor
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js              Full-tab settings page + welcome modal
├── index.html                  Public listing site (GitHub Pages, served from `main`)
├── robots.txt                  Crawler policy, search and AI bots named explicitly
├── sitemap.xml
├── llms.txt                    Plain-text summary for language models
├── llms-full.txt               Full documentation as one plain-text file
├── site/
│   ├── og-image.png            Social preview, 1200x630
│   └── src/                    Renders it. Not shipped
├── icons/
│   ├── icon16.png              Toolbar. Drawn at its own level of detail
│   ├── icon32.png
│   ├── icon48.png
│   ├── icon128.png             Store listing
│   └── src/icon.mjs            Renders every size from one definition. Not shipped
└── privacy.html                Hosted privacy policy page
```

### Documentation

| File | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical design, component internals, data flow |
| [AGENTS.md](AGENTS.md) | Contract for AI agents and contributors: hard invariants, conventions, definition of done |
| [store/LISTING.md](store/LISTING.md) | Chrome Web Store listing copy, permission justifications and privacy declarations, plus the promo tiles and screenshots in `store/assets/` |
| [index.html](index.html) | The public listing site at [palworks.github.io](https://palworks.github.io/Google-Analytics-Name-Changer-for-Chrome-Extensions/), with its structured data, `robots.txt`, `sitemap.xml` and `llms.txt` |
| [DOMAIN.md](DOMAIN.md) | The four identifiers, the two problems, storage keys |
| [DECISIONS.md](DECISIONS.md) | Architecture decision records: what was chosen and what was rejected |
| [PLAYBOOK.md](PLAYBOOK.md) | Setup, manual test checklist, debugging, release, rollback |
| [LIMITATIONS.md](LIMITATIONS.md) | Known constraints, accepted trade-offs, technical debt |
| [SECURITY.md](SECURITY.md) | Threat model, permissions, network behaviour, reporting |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

---

## Development

No build tools are required. The extension runs directly from source — load unpacked and edit files normally.

To regenerate the icon PNGs after editing `icons/src/icon.mjs`:

```bash
node icons/src/icon.mjs
```

The 16px icon is drawn with fewer, fatter segments than the larger sizes rather than
being scaled down from them, because detail that survives at 128px turns to mush in
the toolbar. Keep that split if you redraw it.

To regenerate the listing site's social preview after editing `site/src/og.html`:

```bash
node site/src/render.mjs
```

The site itself is hand-written `index.html` at the repo root with inline CSS and no
JavaScript. GitHub Pages serves it from `main`, so a change is live once it is merged
there. `robots.txt`, `sitemap.xml`, `llms.txt` and `llms-full.txt` sit beside it and
state facts about the shipped source; keep them true.

---

## Contributing

Pull requests are welcome. Keep changes focused and test against a live GA4 account before submitting.

Read [AGENTS.md](AGENTS.md) first: it lists the invariants that will break silently if violated, and it applies to human contributors as much as to AI agents. The mutation loop prevention and node-tracking invariants in `content/content.js` are non-obvious and are explained in [ARCHITECTURE.md](ARCHITECTURE.md). There is no automated test suite, so work the manual checklist in [PLAYBOOK.md](PLAYBOOK.md).

---

## Support

Open an issue on [GitHub](https://github.com/PalWorks/Google-Analytics-Name-Changer-for-Chrome-Extensions/issues) or email [support@palworks.ai](mailto:support@palworks.ai).

---

## License

MIT
