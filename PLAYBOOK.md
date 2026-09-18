# PLAYBOOK.md

Operational procedures. There is no automated test suite, so the manual checks below
are the only verification this project has. Treat them as required, not optional.

---

## Local setup

```bash
git clone https://github.com/PalWorks/Google-Analytics-Name-Changer-for-Chrome-Extensions.git
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked**, select the repository root
4. Pin the extension from the puzzle piece menu

There is nothing to install and nothing to build. Editing a file and clicking the
reload arrow on the extension card is the entire edit loop.

**What needs a reload after an edit:**

| Changed | Action |
|---|---|
| `content/content.js` | Reload the extension, then reload the GA4 tab |
| `background.js` | Reload the extension. Use the "service worker" link on the card to inspect it. |
| `popup/*`, `options/*` | Just reopen the popup or options tab |
| `manifest.json` | Reload the extension. Permission changes may require removing and re-adding it. |

---

## Manual test checklist

Run the sections relevant to what you changed. Anything touching
`content/content.js` needs a live Google Analytics account with Chrome Web Store
developer properties shared to it. There is no way to test the replacement engine
without one.

### Replacement engine

- [ ] A mapped property slug is replaced everywhere it appears on the GA4 page
- [ ] The replacement survives SPA navigation with no page reload
- [ ] The replacement applies to the account switcher list, not just the header
- [ ] An account label is replaced and the numeric account ID is still visible below it
- [ ] Saving a new mapping updates an already open GA4 tab live
- [ ] Deleting a mapping restores the original text after a page reload
- [ ] The GA4 page stays responsive: no CPU spin, no growing memory (see loop check below)

### Mutation loop check

This catches a broken `ourWrittenNodes` guard, which is the most damaging regression
possible in this codebase.

1. Open a GA4 page with at least one mapping active
2. Open DevTools on that tab, Performance panel, record for 10 seconds while idle
3. CPU must be near flat. A sawtooth or a solid block of scripting means the
   replacement is re-triggering itself.

### Popup

- [ ] Opening on a GA4 tab shows the green detection banner with the account ID
- [ ] Unmapped slugs appear pre-filled, up to three, with the green accent stripe
- [ ] A fourth unmapped slug produces the overflow note
- [ ] Opening on a non GA4 tab shows the cached "Last seen" banner instead
- [ ] Typing in a row clears its detected highlight
- [ ] Save persists, and an open GA4 tab updates live

### Popup to options handoff

- [ ] Type a display name in the popup, click **Full Settings**, and confirm the typed
      value arrives on the options page with the carried-over status message
- [ ] With four or more unmapped slugs detected, confirm **all** of them arrive on the
      options page, including the ones the popup never rendered
- [ ] Wait more than 10 minutes, open the options page directly, and confirm the stale
      handoff is discarded rather than injected

### Auto naming

- [ ] Default state on a fresh profile is off, and `chrome://extensions` shows no
      "management" permission
- [ ] With it off, the popup offers "Turn on"; clicking opens the options page opt in slide
- [ ] Accepting the Chrome permission prompt turns the toggle on
- [ ] Declining the prompt leaves the toggle off and shows the declined message
- [ ] **Fill missing names** names every row whose ID is an extension installed in this profile
- [ ] A valid ID that is **not** installed here stays empty and reveals its listing link
- [ ] Clicking that link opens the correct Chrome Web Store listing in a new tab
- [ ] Suggested names render italic and accented; editing one clears that styling
- [ ] Turning the toggle off removes the management permission in `chrome://extensions`
- [ ] Revoking the permission manually from `chrome://extensions`, then reloading the
      options page, shows the toggle back off rather than stuck on
- [ ] Disconnecting the network changes nothing: resolution is entirely local

### Welcome modal

- [ ] Installing fresh opens the options page with the modal on slide 1
- [ ] Next, Back, the dots, Escape, the close button, and an overlay click all behave
- [ ] Dismissing it and reloading the options page does not show it again
- [ ] The popup's **?** button reopens it on demand
- [ ] "Turn on auto-naming" on slide 2 requests the permission, then fills names

### Import and export

- [ ] Export downloads a JSON file with both `mappings` and `accountMappings`
- [ ] Re-importing that file restores the same rows
- [ ] A malformed file, a non object `mappings`, and a file over 512 KB each produce a
      specific error and change nothing

---

## Adding a feature

1. Read [AGENTS.md](AGENTS.md) invariants and [DOMAIN.md](DOMAIN.md) vocabulary.
2. If it touches identifiers, confirm which of the four you actually mean.
3. If it needs a new permission, write the ADR in [DECISIONS.md](DECISIONS.md) **before**
   writing the code, and update `privacy.html`, `SECURITY.md` and `README.md` in the same
   change. If it needs a network request, stop and read invariant 4 in
   [AGENTS.md](AGENTS.md) first.
4. Implement. Match the surrounding style; do not introduce a dependency.
5. `node --check` every file you touched.
6. Work the relevant checklist sections above.
7. Update `CHANGELOG.md` and, if you found a new constraint, [LIMITATIONS.md](LIMITATIONS.md).

---

## Debugging

| Symptom | First thing to check |
|---|---|
| Replacement does not happen at all | Is the content script listed under the GA4 tab in DevTools Sources? Is `mappings` populated in `chrome.storage.sync`? |
| Replacement works on load, then stops after navigating | The `characterData` branch of the observer, or `processedNodes` not being un-marked |
| GA4 tab pegs a CPU core | `ourWrittenNodes` guard broken. See the loop check above. |
| Account label not replaced, slugs fine | Google may have changed the label string. Check `ACCOUNT_LABEL` against the live DOM, and the popup's staleness warning. |
| Auto naming silently returns nothing | Inspect the service worker console. Check `reason` in the response: `disabled`, `no-permission` and `no-valid-ids` are distinct causes. `reason: 'ok'` with everything in `unresolved` simply means none of those extensions are installed in this profile. |
| Service worker appears dead | MV3 workers idle out. Clicking the card's "service worker" link wakes it. This is normal, not a bug. |

Inspect stored state from any extension page console:

```js
chrome.storage.sync.get(null, console.log);
chrome.storage.local.get(null, console.log);
```

---

## Release

1. Confirm the working tree is clean and on `main`.
2. Bump `version` in `manifest.json`. Semver.
3. Add a dated `CHANGELOG.md` section for that version.
4. Confirm `README.md` and `privacy.html` still describe the shipped behaviour,
   especially the permission list and the network behaviour.
5. Run the full manual checklist against a fresh profile, not your dev profile. A
   fresh profile is the only way to exercise first install and the default off state.
6. Build the upload package. `.crxignore` lists what must not ship:

```bash
zip -r ../ga4-name-changer-<version>.zip . \
  -x '*.git*' -x '*.md' -x '.crxignore' \
  -x 'icons/generate-icons.html' -x 'googled*.html'
```

7. Verify the zip: it must contain `manifest.json` at the root, and no `.md` files,
   no `.git`, and no icon generator.
8. Upload at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).
9. Because the extension declares the optional `management` permission, the store listing
   must justify it, and reviewers scrutinise this one. Say plainly: requested only when the
   user enables auto naming; used solely to call `chrome.management.get()` and read the
   `name` of extensions already installed, so Chrome Web Store properties in Google
   Analytics can be labelled; never used to enable, disable or uninstall anything.
10. Tag the release: `git tag v<version> && git push --tags`.

---

## Rollback

There is no server to roll back. If a released version is broken:

1. In the developer dashboard, revert to the previous package and publish it.
2. Chrome Web Store review takes hours to days, so a bad release is not instantly
   recoverable. This is the reason step 5 above uses a fresh profile.
3. If the break is data related, remember that mappings live in `chrome.storage.sync`
   and survive a version downgrade. Never ship a migration that rewrites those keys
   destructively.
