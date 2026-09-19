# Security Policy

## Reporting a vulnerability

Email **support@palworks.ai** with the details. Please do not open a public GitHub
issue for a security report.

Include what you can: the affected version, reproduction steps, and what an attacker
would gain. You will get an acknowledgement within a few days. Fixes ship as a Chrome
Web Store update, which takes as long as store review takes.

## Supported versions

Only the current Chrome Web Store release is supported. Chrome auto updates
extensions, so there are no maintained older branches.

---

## Security design

### Attack surface

The extension runs a content script on `https://analytics.google.com/*`. That page is
hostile input in the sense that matters here: its DOM contents are read and rewritten.
The relevant guarantees are:

* **Text in, text out.** The content script only ever reads `node.nodeValue` and writes
  `node.nodeValue`. It never evaluates page content, never inserts markup, and never
  reads page JavaScript state.
* **Name harvesting reads only rendered report text.** It walks the same text nodes the
  replacement engine already walks, extracts extension names from titles Google itself
  rendered, and stores them locally. No request is made and nothing is sent anywhere.
* **No `innerHTML` with dynamic data.** `innerHTML` appears only with module scope SVG
  string constants that contain no interpolation. Everything user supplied reaches the
  DOM through `.value`, `.textContent`, or `.nodeValue`.
* **No remote code.** All JavaScript is in the package. No CDN, no `eval`, no
  `new Function`, no dynamic import. Enforced by
  `content_security_policy: script-src 'self'; object-src 'self'`.
* **No message handler accepts code or selectors.** The content script answers exactly
  one action, `getGA4Data`, and takes no parameters from the caller. The service worker
  answers exactly one action, `resolveNames`, and filters its input against
  `/^[a-p]{32}$/` before anything reaches `chrome.management`.

### Permissions

| Permission | Type | Why |
|---|---|---|
| `storage` | required | Persist mappings and settings |
| `scripting` | required | Inject the content script into GA4 tabs that were already open at install or update, so they need no refresh (ADR-017). Bounded by the host permission below, so it reaches no site the extension could not already reach |
| `https://analytics.google.com/*` | required host | Inject the replacement content script |
| `management` | **optional** | Read the names of locally installed extensions, only while auto naming is on |

`tabs` is deliberately **not** requested. The popup calls `chrome.tabs.query` but reads
only `tab.id`, never `url` or `title`, which does not require the permission.

**On `management`.** It is requested only when the user turns auto naming on, and released
with `chrome.permissions.remove()` when they turn it off. The extension calls exactly one
method from that API, `chrome.management.get(id)`, and reads exactly one field from the
result, `name`. It never calls `setEnabled`, `uninstall`, `launchApp`, or `getAll`. The
permission's warning string is broader than what is exercised, which is why it is optional
rather than required, and why the onboarding states plainly that nothing is installed,
enabled, disabled or changed.

### Network behaviour

**The extension makes no network request in the course of its own work.** Not by default,
not when auto naming is on, not ever. Replacement, name derivation and storage are entirely
local. No page in the package references a remote resource, and there is no
`XMLHttpRequest` and no `WebSocket` anywhere in the source.

There is exactly one `fetch`, in `options/options.js`, and it runs only when the user fills
in the feedback form and presses send. It is described under Feedback form below. Nothing
about the user's analytics is in it, and it never fires on its own.

Auto naming resolves names locally through `chrome.management`, so no identifier leaves the
device. This is partly a design preference and partly forced: Chrome blocks extensions from
requesting the Chrome Web Store at all, which is documented with measurements in
[DECISIONS.md](DECISIONS.md) ADR-004.

The one outbound action available to the user is explicit and visible: clicking the listing
link on an unresolved row calls `chrome.tabs.create()` to open that extension's public Chrome
Web Store page in a normal tab. That is an ordinary navigation the user initiates and can see,
not a background request, and it carries nothing beyond the extension ID already in the URL.

### Feedback form

The options page can send feedback. This is the extension's only outbound request, and it
is user-initiated: it fires on form submission and at no other time.

The form posts name, email, the message and installation diagnostics as JSON to the relay at
`https://ga4nc-feedback.sunmooncal.workers.dev/feedback`, which validates the request and
forwards it by email through Resend. Diagnostics deliberately exclude everything about the
user's analytics: no property slugs, no account numbers, no display names, no URLs, no
browsing information. Only counts, versions and flags, and the page renders the exact block
on screen before the user sends it.

Properties of the relay, all verifiable in `worker/feedback-worker.js`:

* It rejects any request whose `Origin` is not a `chrome-extension://` origin, so a web page
  cannot use it as an open mail relay.
* It rejects any method other than `POST`, bodies over 16 KB, malformed JSON, an invalid
  email address, and messages under ten characters.
* It escapes every field before it reaches the HTML email body.
* It stores nothing. There is no database, no log of message contents and no retention.
* It caps the diagnostics table at 40 entries and each field at 4000 characters.

No host permission is needed for this. The relay returns an
`Access-Control-Allow-Origin` echoing the extension's own origin, so the request satisfies
CORS on its own. Adding a host permission would widen the store's permission list for no
gain.

If the relay is unreachable or returns an error, the form falls back to composing a
`mailto:` and handing it to the user's own mail client, so the feature degrades to sending
nothing from the extension at all.

The Resend API key is never in the extension. It is a Worker secret. See
[DECISIONS.md](DECISIONS.md) ADR-011 and ADR-016.

### Data handling

* No analytics, no telemetry, no crash reporting and no remote logging. Nothing is sent in
  the background, and nothing about the user's Google Analytics data is ever transmitted.
* The only server involved is the feedback relay, which is reached only on form submission
  and holds nothing.
* Mappings live in `chrome.storage.sync`, which Chrome may replicate to the user's other
  signed in devices through their Google account. That path is Google's, and subject to
  Google's privacy policy. The developer of this extension has no access to it.
* Operational state (detection cache, handoff, heartbeat, preferences) lives in
  `chrome.storage.local` and never leaves the device.
* Uninstalling the extension removes all of it.

See [privacy.html](privacy.html) for the user facing policy.

---

## For contributors

Changes that require a security review before merging:

* Any new `permissions`, `optional_permissions`, or `host_permissions` entry
* Any network request at all. The extension currently makes none, and that is a property
  worth defending rather than a default to erode.
* Any new use of `innerHTML`, or any interpolation into an existing one
* Any new message action, or any handler that accepts data from its caller
* Any relaxation of the content security policy

The invariants these protect are listed in [AGENTS.md](AGENTS.md).
