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

### Account labels

- [ ] An account holding one extension is labelled with that extension's name, shortened
- [ ] An account holding two, both named, reads `A + B` and fits in GA4's breadcrumb
- [ ] An account holding two with only one named reads `A + 1 more`, and becomes `A + B`
      after the second property is opened
- [ ] Each name in a two-extension label keeps **at least two words**: no label contains a
      bare `Google`, `Tab` or other single word standing in for an extension
- [ ] An account holding **three or more** reads `A B C + N more`, one name at three words or
      more, never three fragments
- [ ] A name containing a separator dash (`OpenFullPage - Capture Screen`) never leaves the
      hyphen dangling at the cut
- [ ] The label stays near 38 characters, and runs over only where the word floor requires it
- [ ] Editing a label and pressing **Save Changes** makes it stick, and the `auto` badge goes

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

Three slides: what it does, open each property once, the auto-naming opt-in.

- [ ] Installing fresh opens the options page with the modal on slide 1
- [ ] Next, Back, the dots, Escape, the close button, and an overlay click all behave
- [ ] Three dots, and the third is active on the last slide
- [ ] Slide 2's demo loops: each row's slug fades to a name with an "auto" badge, in sequence
- [ ] With `prefers-reduced-motion: reduce` forced in devtools, slide 2 shows the names
      statically rather than animating
- [ ] Dismissing it and reloading the options page does not show it again
- [ ] The popup's **?** button reopens it on demand
- [ ] "Turn on auto-naming" on the **last** slide requests the permission, then fills names
- [ ] The popup's auto-naming link (`#autoname`) lands on that last slide, not slide 2
- [ ] Setting `chrome.storage.sync.set({welcomeSeenVersion: 1})` and reloading the options
      page re-shows the modal. Bump `WELCOME_VERSION` whenever a slide is added or rewritten,
      or existing users never see the change

### Adopting tabs that were already open

- [ ] Open a GA4 property, then reload the extension from `chrome://extensions` **without**
      touching the GA4 tab. Names still work there, and no refresh was needed
- [ ] The same after an update (bump `version` in the manifest and reload): the tab keeps
      working, and the page does not end up with two observers fighting over the same text

### Visiting unopened properties

- [ ] On a profile GA4 has never spoken to, the button is **present** and reads "Open GA4 and
      name all properties" (regression: it used to be hidden, leaving a new user no way in)
- [ ] Pressing it there opens Analytics in the background, reads the property list from it,
      and then walks the unnamed ones. Allow about 13 seconds before the first visit
- [ ] Signed into more than one Google account, with no GA4 tab open: it still reaches the
      right identity, because the base URL comes from `local.ga4Base`. Clear that key and it
      should fail honestly rather than silently reading another account's property list
- [ ] With every known property named, the button is hidden
- [ ] With unnamed properties known to GA4, it appears and states the count
- [ ] Pressing it opens exactly one background tab; focus never leaves the settings page
- [ ] Rows appear as names land, and an edit typed in another row is not lost
- [ ] Pressing Stop mid-run halts it, closes the tab, and reports how many were named
- [ ] The tab is closed at the end in every case, including Stop and an error
- [ ] A property with no store-listing views times out after 30 s and is reported as such,
      rather than silently skipped
- [ ] Signed into more than one Google account: the properties are read from the same account
      as the GA4 tab already open, not a different one (this is the `authuser` case)

### Toolbar, progress and results

- [ ] The two action buttons are stacked in one fixed-width column at the right of the card
- [ ] A long result does **not** narrow the switch descriptions beside it: measure
      `.toolbar-hint` width before and after, it must not change
- [ ] While **Visit and name the rest** runs, its label reads `Visiting 2 of 7…`, its icon
      spins, it is not dimmed, and **Stop** appears beneath it
- [ ] While **Fill missing names** runs, its label reads `Checking 3…` and the other button
      is disabled
- [ ] A result appears as a toast in the bottom-right corner and fades by itself; an error
      stays visibly longer than a success
- [ ] With nothing to do, **Visit and name the rest** is gone from the page, not showing
      `0 more` (regression: `hidden` loses to the `display` on the button class)
- [ ] With `prefers-reduced-motion: reduce`, the spinner does not spin and the toast does not
      animate in

### Unnamed properties

- [ ] A property Google Analytics knows about that nothing has named appears in the settings
      table, in its own account's group, with an empty display name and no `auto` badge
- [ ] Typing a name into it and pressing Save keeps it
- [ ] It is the same set of properties the popup lists

### Save and unsaved changes

- [ ] **Save Changes** appears above the table as well as in the footer, and both save
- [ ] "Unsaved changes" appears beside both Save buttons on the first edit, and clears on save
- [ ] In the popup the pill is **absent** when it opens on a GA4 page with detected rows, and
      appears as soon as anything is typed, deleted or added
- [ ] Saving from the top button clears the pill in both places

### Fill missing names

- [ ] With an empty table, the button is greyed out and its tooltip says why
- [ ] Typing an extension ID into a blank row enables it without a page reload
- [ ] Filling the last empty name greys it out again
- [ ] Deleting the only named row's name enables it again

### Finishing a run

- [ ] The button counts down while it waits: "Visiting 1 of 2… 18s"
- [ ] A run that named something reloads the page, and the result message is still on screen
      afterwards
- [ ] The URL after that reload has **no** `#cycle` on it, and no second run starts
- [ ] With an unsaved edit on the page, the run does **not** reload, and says "Save your
      changes to see the updated account names"
- [ ] A run that named nothing does not reload
- [ ] The footer shows "Unsaved changes" as soon as anything is edited, and it goes on Save

### Surviving a reload

- [ ] Open the settings page from the popup's naming button and close the tab without
      clicking anything on it: no "blocked beforeunload" entry appears in
      `chrome://extensions`
- [ ] Type a name, then close the tab: the unsaved-changes prompt **does** appear
- [ ] Clear the error list, reload the extension from `chrome://extensions` with a Google
      Analytics tab open, wait ten seconds: the list stays empty
- [ ] Reload the extension while a naming run is going: the run stops and says the extension
      was updated, rather than hanging or failing silently

### Toolbar badge

- [ ] On a property that has a name, the toolbar icon carries a count and the tooltip reads
      "N names applied on this page"
- [ ] Switching to a property with **no** name clears the badge rather than leaving the
      previous property's count on screen
- [ ] Switching back brings the count back
- [ ] Navigating the tab away from Google Analytics clears the badge and restores the default
      tooltip
- [ ] A second tab on a different property carries its own count, independent of the first
- [ ] `chrome://extensions` shows no new permission

### Popup naming actions

- [ ] With a row that has no name, **Fill missing names** appears in the popup
- [ ] Pressing it fills what it can, reporting `Checking N…` on the button while it runs
- [ ] With auto-naming off, pressing it opens the settings page at the opt-in slide rather
      than failing quietly (a popup cannot request a permission: crbug.com/952645)
- [ ] With properties GA4 knows about but has never named, **Visit and name N more** appears
      and carries the count
- [ ] Pressing it opens the settings page and the run starts there by itself
- [ ] With nothing for either to do, the strip is absent, not empty

### Feedback relay

- [ ] Submitting the form shows "Thanks. Your feedback has been sent." and clears the fields
- [ ] The mail arrives from `GA4NameChanger.Support@palworks.ai` at `support@palworks.ai`
- [ ] "What gets sent with this" lists counts and versions only: no slugs, names, account
      numbers or URLs
- [ ] With the endpoint unreachable, the form falls back to opening the mail client

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

The package is written to `build/`, inside the repository, so the artefact sits beside the
source it came from. `build/` is gitignored and excluded from the package, so it can neither
be committed nor end up inside itself.

```bash
mkdir -p build
rm -f build/ga4-name-changer-v<version>.zip
zip -r build/ga4-name-changer-v<version>.zip . \
  -x '*.git*' -x '*.md' -x '.crxignore' -x '.nojekyll' -x 'build/*' \
  -x 'icons/src/*' -x 'icons/icon512.png' -x 'googled*.html' \
  -x 'worker/*' -x 'store/*' -x 'site/*' \
  -x 'index.html' -x 'robots.txt' -x 'sitemap.xml' -x 'llms*.txt'
```

7. Verify the zip: it must contain `manifest.json` at the root, and no `.md` files,
   no `.git`, no `store/`, no `icons/src/`, and none of the listing-site files
   (`index.html`, `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, `site/`).
   The zip should hold 19 files. `LICENSE` is included deliberately: MIT requires the notice to travel with copies.
8. Upload at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).
   Listing copy, permission justifications and privacy declarations are in
   [store/LISTING.md](store/LISTING.md); the promo tiles and screenshots are in `store/assets/`,
   already at the sizes the store requires. Regenerate them with `node store/src/render.mjs`
   after changing anything in `store/src/`. Confirm `store/` is absent from the uploaded zip.
9. Because the extension declares the optional `management` permission, the store listing
   must justify it, and reviewers scrutinise this one. Say plainly: requested only when the
   user enables auto naming; used solely to call `chrome.management.get()` and read the
   `name` of extensions already installed, so Chrome Web Store properties in Google
   Analytics can be labelled; never used to enable, disable or uninstall anything.
10. Tag the release and publish it on GitHub, with the same zip attached so anyone can
    verify that the published package matches the tagged source:

```bash
git tag -a v<version> -m "v<version>"
git push origin v<version>
gh release create v<version> build/ga4-name-changer-v<version>.zip \
  --title "v<version>" --notes-file <notes>
```

11. After the store review completes, note the review turnaround in this file if it differed
    materially from previous submissions. It is the only record of what to expect next time.

---

## Rollback

There is no server to roll back. If a released version is broken:

1. In the developer dashboard, revert to the previous package and publish it.
2. Chrome Web Store review takes hours to days, so a bad release is not instantly
   recoverable. This is the reason step 5 above uses a fresh profile.
3. If the break is data related, remember that mappings live in `chrome.storage.sync`
   and survive a version downgrade. Never ship a migration that rewrites those keys
   destructively.
