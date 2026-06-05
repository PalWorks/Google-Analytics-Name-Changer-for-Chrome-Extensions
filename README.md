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
- **Label health monitoring** — warns inside the popup if the "Chrome Web Store developer properties" label hasn't been matched in 90+ days, signalling that Google may have silently renamed that UI element
- **Zero data collection** — all text processing is local; the extension makes no network requests after installation

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
| Property slug | 32-char lowercase string | Displayed as the property name in the GA4 interface; also embedded in the URL hash as `#a{accountId}p{propertyId}/…` |

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

The extension processes page text locally inside your browser and stores only the display names you type. No data is ever sent to any external server. If you are signed into Chrome, `chrome.storage.sync` may sync your mappings between your devices via your Google account, subject to [Google's privacy policy](https://policies.google.com/privacy).

Full policy: [palworks.github.io/…/privacy.html](https://palworks.github.io/Google-Analytics-Name-Changer-for-Chrome-Extensions/privacy.html)

---

## Project structure

```
├── manifest.json               MV3 manifest
├── content/
│   └── content.js              Content script — MutationObserver + text replacement engine
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js                Toolbar popup — GA4 auto-detection and quick mapping editor
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js              Full-tab settings page
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate-icons.html     Dev tool — generates icon PNGs via Canvas API (no build step)
└── privacy.html                Hosted privacy policy page
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the technical design.

---

## Development

No build tools are required. The extension runs directly from source — load unpacked and edit files normally.

To regenerate the icon PNGs, open `icons/generate-icons.html` in Chrome and download the three files.

---

## Contributing

Pull requests are welcome. Keep changes focused and test against a live GA4 account before submitting. Please check `ARCHITECTURE.md` for context on the content script design before modifying `content/content.js` — the mutation loop prevention and node-tracking invariants are non-obvious.

---

## Support

Open an issue on [GitHub](https://github.com/PalWorks/Google-Analytics-Name-Changer-for-Chrome-Extensions/issues) or email [support@palworks.ai](mailto:support@palworks.ai).

---

## License

MIT
