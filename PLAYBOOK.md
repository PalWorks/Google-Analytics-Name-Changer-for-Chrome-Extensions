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

### Property switching (the ADR-013 race)

Needs one account holding two Chrome Web Store properties, both with store traffic.

- [ ] Open property A, let it name itself, then switch to property B **in the page** (not by
      reloading). Watch `chrome.storage.local.autoMappings` throughout the switch: B must
      never appear holding A's name, not even for one sample
- [ ] After the reports refresh, B holds its own name and A still holds its own
- [ ] Switch back to A and confirm both names are still correct and neither has vanished
- [ ] Seed a deliberately wrong pairing (`autoMappings[slugB] = "<A's name>"`), open A, and
      confirm the wrong entry is evicted and A takes its own name back
- [ ] On a property whose reports never load, confirm nothing is written at all

There is a deterministic fixture for this that needs no Google account: it serves a page with
a fake `accountTree`, a fake page-title report and a scripted delay between the hash changing
and the report refreshing, so the race can be reproduced on demand at any delay.

### Settings table

- [ ] Accounts render as group heads with their properties nested beneath them
- [ ] An account holding no properties shows the "No properties under this account yet" hint
- [ ] Properties with no known account appear in the catch-all group, which sorts last
- [ ] The display-name column lines up exactly between an account row and its property rows
- [ ] The plus on an account row adds a property **inside** that group; the footer's
      **Add property** adds one to the catch-all
- [ ] Deleting an account moves its properties to the catch-all instead of deleting them
- [ ] After **Save Changes**, `sync.mappings` and `sync.accountMappings` are still two flat
      maps — the grouping must never reach storage
- [ ] Clearing `local.propertyAccounts` degrades the table to a flat list with no errors

### Popup to options handoff

- [ ] Type a display name in the popup, click **Full Settings**, and confirm the typed
      value arrives on the options page with the carried-over status message
- [ ] With four or more unmapped slugs detected, confirm **all** of them arrive on the
      options page, including the ones the popup never rendered
- [ ] Wait more than 10 minutes, open the options page directly, and confirm the stale
      handoff is discarded rather than injected

### Name harvesting from GA4 reports

Needs a live Chrome Web Store developer property with some traffic in the selected date range.

- [ ] Open a property's Home view, wait a few seconds, then open the popup: the property row
      is pre-filled with the extension's real name, in italic
- [ ] The account row is pre-filled with a shortened form of that name
- [ ] Open the account switcher (several slugs now visible) and reopen the popup: no new hint
      is recorded, because the report can no longer be attributed to one property
- [ ] `chrome.storage.local.get('nameHints', console.log)` shows the accumulated slug-to-name map
- [ ] Visit a second property, then return: both properties are named from the cache

### Multi-account detection

- [ ] With the account switcher **closed**, only the account in the URL is detected
- [ ] With the switcher **open**, every account listed in it is detected, in order
- [ ] A property ID (9 digits, sitting next to a slug) is never offered as an account

### Cross-tab detection

- [ ] Open the popup from a non-GA4 tab while a GA4 tab is open in the same window: detection
      still runs and the banner reads "(other tab)"
- [ ] With no GA4 tab in the window at all, the cached "Last seen" banner is shown instead

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

### Automatic naming

- [ ] On a wiped profile, open a GA4 property and touch nothing: within ~15 s the property
      slug in the breadcrumb is replaced by the real extension name
- [ ] `chrome.storage.sync.get(null, console.log)` shows **no** mappings; the derived names
      live in `chrome.storage.local.autoMappings`
- [ ] Both surfaces show those rows badged "auto"
- [ ] Typing a different name for the same slug and pressing Save overrides the derived one
      on the GA4 page
- [ ] Turning the toggle off stops new names being derived and existing derived names stop
      being applied, without deleting anything
- [ ] An account holding two properties is **not** given a name derived from either

### Feedback form

- [ ] Submitting with an empty or malformed email is refused with a specific message
- [ ] A message under ten characters is refused
- [ ] "What gets sent with this" lists versions, install type, permission state and counts,
      and contains **no** slugs, account numbers, display names or URLs
- [ ] With `FEEDBACK_ENDPOINT` empty, submitting opens a pre-filled email
- [ ] With an endpoint set, submitting posts JSON and reports success; a failing endpoint
      falls back to the email path rather than losing the message

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
  -x 'icons/generate-icons.html' -x 'googled*.html' -x 'worker/*'
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
