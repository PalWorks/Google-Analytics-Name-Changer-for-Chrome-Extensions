# Google Analytics Alias Names

A Manifest V3 Chrome extension that replaces opaque Google Analytics 4 property slugs and numeric account IDs with the human-readable names you choose — directly inside the GA4 interface.

---

## The Problem

When Google shares GA4 analytics properties with Chrome Web Store developers, it uses internal identifiers:

- **Property slugs** — 32-character hex strings like `egedbdckafdbomehjaihjhbcgmngmlah`
- **Account labels** — generic "Chrome Web Store developer properties" with a 9-digit account ID

At a glance, you cannot tell which extension owns which property.

## The Solution

GA4 Name Changer lets you map each identifier to a name you recognise. Changes take effect in real time on the GA4 page — no reload required.

---

## Features

- **Property name mapping** — map 32-char extension slugs (or any GA4 property identifier) to readable names
- **Account label mapping** — replace the generic "Chrome Web Store developer properties" label with the name of the extension that owns each account
- **Persists across sessions** — mappings stored in `chrome.storage.sync` and synced across your Chrome profiles
- **Works with GA4's SPA** — MutationObserver + characterData tracking catches every re-render without page reload
- **Import / Export** — back up or share mappings as JSON
- **Zero data collection** — all processing is local; no data ever leaves your browser

---

## Installation

### From the Chrome Web Store *(recommended)*

*Coming soon.*

### Load unpacked (for development)

1. Clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the repo folder
5. Click the extension icon in the toolbar to open Settings

---

## Usage

1. Click the extension icon in the Chrome toolbar (or right-click → Options)
2. In the **GA4 Account Number** table, add your 9-digit GA4 account IDs and the name you want to see
3. In the **GA4 Property Name** table, add your 32-char extension slugs and the name you want to see
4. Click **Save Changes**
5. Navigate to [analytics.google.com](https://analytics.google.com) — identifiers are replaced immediately

### Finding your identifiers

| Identifier | Where to find it |
|---|---|
| GA4 Account Number | Left panel of the account switcher (9-digit number below the account name) |
| GA4 Property Slug | GA4 URL: `analytics.google.com/…#/a{accountId}p{propertyId}/…` — or the 32-char hex string shown as the property name |

### Import / Export

Use **Export JSON** to download your current mappings. The file format is:

```json
{
  "mappings": {
    "egedbdckafdbomehjaihjhbcgmngmlah": "Favicon Changer"
  },
  "accountMappings": {
    "376297388": "Gmail Labels"
  }
}
```

Use **Import JSON** to restore or bulk-load mappings from a file.

---

## Privacy

This extension collects no data. All text replacement happens locally in your browser. Your mappings are stored in `chrome.storage.sync` — if you are signed into Chrome, Google may sync this data between your devices per [Google's privacy policy](https://policies.google.com/privacy).

See [privacy.html](privacy.html) for the full privacy policy.

---

## Project Structure

```
├── manifest.json          # MV3 manifest
├── background.js          # Service worker: opens Options on icon click
├── content/
│   └── content.js         # Content script: MutationObserver + text replacement
├── options/
│   ├── options.html        # Settings page
│   ├── options.css         # Styles
│   └── options.js          # Settings page logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate-icons.html # Dev tool: generates icon PNGs via Canvas API
└── privacy.html            # Privacy policy (host at a public URL for CWS submission)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the technical design.

---

## Development

No build tools required. The extension runs directly from source.

To regenerate the icon PNGs, open `icons/generate-icons.html` in Chrome and download the three files.

---

## Contributing

Pull requests are welcome. Please keep changes focused and test against a live GA4 account before submitting.

---

## License

MIT
