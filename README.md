# Google Analytics Name Changer for Chrome Extensions

> Replace unreadable GA4 property slugs and account numbers with human-friendly display names — directly inside [analytics.google.com](https://analytics.google.com), in real time.

---

## The problem

When Google shares GA4 analytics with Chrome Web Store developers, every property appears as an opaque 32-character slug (`egedbdckafdbomehjaihjhbcgmngmlah`) and every account carries the same generic label — "Chrome Web Store developer properties" — differentiated only by a 9-digit ID. Managing more than a handful of extensions means constant cross-referencing to figure out which property belongs to which extension.

## The solution

This extension intercepts GA4's rendered text and swaps those identifiers for names you choose — with no page reload, no changes to your GA4 configuration, and nothing ever leaving your browser.

---

## Features

- **Live text replacement** — slugs and account labels replaced as GA4 renders; works seamlessly across SPA navigation without requiring a page reload
- **Toolbar popup** — left-click the extension icon to view and edit mappings from any tab without leaving your current page
- **GA4 auto-detection** — when you open the popup on a GA4 tab, it reads the current account ID from the URL and scans the DOM for unmapped property slugs, pre-filling rows ready for you to name
- **Full settings page** — a dedicated full-tab settings page for managing all mappings with more room; reachable from the popup header or from `chrome://extensions`
- **Cross-device sync** — mappings stored in `chrome.storage.sync` and synced across your signed-in Chrome profiles automatically
- **Import / Export** — back up or transfer all mappings as a single JSON file
- **Auto-naming** *(optional, off by default)* — a Chrome Web Store property slug is your extension's ID, so any of those extensions installed in your Chrome profile can be named automatically, instantly and entirely offline; you review every suggestion before saving. Anything not installed locally gets a one-click link to its store listing
- **Guided onboarding** — a two-slide welcome modal on first install explains the extension and the auto-naming opt-in; reachable again any time from the popup's **?** button
- **Label health monitoring** — warns inside the popup if the "Chrome Web Store developer properties" label hasn't been matched in 90+ days, signalling that Google may have silently renamed that UI element
- **Zero data collection** — no analytics, no telemetry, no server, and no network requests of any kind

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

### Finding your identifiers

| Identifier | Format | Where to find it |
|---|---|---|
| Account number | 9-digit integer | Left panel of the GA4 account switcher, beneath the account name |
| Property slug | 32 chars, `a` to `p` | Displayed as the property name in the GA4 interface. **This is your extension's Chrome Web Store ID**, which is what makes auto-naming possible. |

Note that the numbers in the URL hash (`#a{accountId}p{propertyId}/…`) are GA4's own account and property IDs. The account ID there is the one you want; the property ID is not the slug and is not used by this extension.

### Auto-naming your extensions

Every Chrome Web Store developer property in GA4 is named after your extension's ID. Auto-naming
uses that: for each slug, it asks Chrome for the name of the extension with that ID.

This is **off by default**. To turn it on, open **Full Settings** and flip
**Auto-name from your installed extensions**. Chrome will ask you to grant the `management`
permission; the extension cannot look anything up until you do.

Once on:

- the popup fills in names automatically for slugs it detects on a GA4 page
- **Fill missing names** in Full Settings names every row that has a slug but no name
- suggestions render in italic until you accept them by saving, so you always review first

**What it covers.** Only extensions installed in the Chrome profile you are using. That is
usually most of your own, but an extension you publish and do not run locally cannot be named
this way. Those rows get a link that opens the public Chrome Web Store listing in a new tab, so
you can read the name and type it.

**What it costs.** Nothing leaves your browser. The lookup is local, so the extension still
makes no network requests at all. The `management` permission is only ever used to call
`chrome.management.get()` and read a name; nothing is installed, enabled, disabled or changed.
Turning the feature off revokes the permission. See [SECURITY.md](SECURITY.md) for the detail.

> **Why not just read the store listing?** Because Chrome will not allow it. Extensions are
> blocked from making requests to `chromewebstore.google.com` entirely, which is a deliberate
> platform protection. [DECISIONS.md](DECISIONS.md) ADR-004 has the measurements.

### Import / Export

Click **Export** to download a JSON backup of all your mappings. Click **Import** to bulk-load from a previously exported file. File format:

```json
{
  "mappings": {
    "egedbdckafdbomehjaihjhbcgmngmlah": "My Extension Name"
  },
  "accountMappings": {
    "376297388": "Main CWS Account"
  }
}
```

---

## Privacy

The extension processes page text locally inside your browser and stores only the display names you type. It has no server, collects nothing, and makes no network requests of any kind, including with auto-naming enabled. If you are signed into Chrome, `chrome.storage.sync` may sync your mappings between your devices via your Google account, subject to [Google's privacy policy](https://policies.google.com/privacy).

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
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate-icons.html     Dev tool — generates icon PNGs via Canvas API (no build step)
└── privacy.html                Hosted privacy policy page
```

### Documentation

| File | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical design, component internals, data flow |
| [AGENTS.md](AGENTS.md) | Contract for AI agents and contributors: hard invariants, conventions, definition of done |
| [DOMAIN.md](DOMAIN.md) | The four identifiers, the two problems, storage keys |
| [DECISIONS.md](DECISIONS.md) | Architecture decision records: what was chosen and what was rejected |
| [PLAYBOOK.md](PLAYBOOK.md) | Setup, manual test checklist, debugging, release, rollback |
| [LIMITATIONS.md](LIMITATIONS.md) | Known constraints, accepted trade-offs, technical debt |
| [SECURITY.md](SECURITY.md) | Threat model, permissions, network behaviour, reporting |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

---

## Development

No build tools are required. The extension runs directly from source — load unpacked and edit files normally.

To regenerate the icon PNGs, open `icons/generate-icons.html` in Chrome and download the three files.

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
