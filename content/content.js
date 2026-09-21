'use strict';

(function ga4NameChanger() {

  // A content script is not injected into pages that were already open when the
  // extension was installed, updated or reloaded. background.js injects it into
  // those tabs itself so the user never has to refresh (ADR-017).
  //
  // That injection can land next to a copy left over from a previous version of
  // the extension, whose chrome.* context is dead but whose MutationObserver is
  // still running against this page. The new copy tells the old one to stand
  // down before starting. The call is guarded because an orphaned copy's
  // teardown may itself throw.
  if (globalThis.__GA4NC__ && typeof globalThis.__GA4NC__.teardown === 'function') {
    try { globalThis.__GA4NC__.teardown(); } catch (err) { /* orphan; ignore */ }
  }

  // ── State ──────────────────────────────────────────────────────────────────

  // Sorted Map<slug, name>: longest slug first to prevent partial-match collisions.
  // Built by merging auto-derived names under the user's own mappings, so a name
  // the user typed always wins over one the extension worked out for itself.
  let slugMap = new Map();

  // Map<accountId, displayName> — used by pairAccountLabels to replace the
  // "Chrome Web Store developer properties" label adjacent to each account ID.
  let accountMap = new Map();

  // Raw sources behind the two maps above.
  let userMappings = {};        // sync.mappings           — typed by the user
  let userAccountMappings = {}; // sync.accountMappings    — typed by the user
  let autoMappings = {};        // local.autoMappings      — derived from GA4's reports
  let autoAccountMappings = {}; // local.autoAccountMappings
  let autoNamingEnabled = true; // local.autoNamingEnabled — default on

  // The property slug this page is showing. Recorded before replacement, because
  // once a slug is replaced by its display name it is no longer in the DOM to
  // be found, and harvesting still needs to know which property it is looking at.
  let currentSlug = null;

  // Text nodes we have already processed. WeakSet auto-GCs detached nodes.
  let processedNodes = new WeakSet();

  // Text nodes whose last write was made by US — used to ignore our own
  // characterData mutations and avoid an infinite replacement loop.
  let ourWrittenNodes = new WeakSet();

  let observer = null;
  let debounceTimer = null;
  const pendingRoots = new Set();

  // Tags whose text content must never be touched
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'IFRAME', 'INPUT', 'SELECT', 'OPTION', 'BUTTON']);

  // ── Map helpers ────────────────────────────────────────────────────────────

  function cleanEntries(raw) {
    return Object.entries(raw || {})
      .filter(([key, name]) => key && name)
      .map(([key, name]) => [String(key).trim(), String(name).trim()]);
  }

  /**
   * Rebuild both maps from their sources. Auto-derived names are laid down
   * first and the user's own mappings on top, so editing a name in settings
   * silently overrides whatever the extension derived for that slug.
   */
  function rebuildMaps() {
    const slugs = new Map([
      ...(autoNamingEnabled ? cleanEntries(autoMappings) : []),
      ...cleanEntries(userMappings)
    ]);
    slugMap = new Map([...slugs].sort((a, b) => b[0].length - a[0].length));

    accountMap = new Map([
      ...(autoNamingEnabled ? cleanEntries(autoAccountMappings) : []),
      ...cleanEntries(userAccountMappings)
    ]);
  }

  // ── Storage, for a script that may outlive its extension ───────────────────
  //
  // A content script keeps running after the extension that injected it is
  // reloaded, updated or disabled. Its DOM half is fine; every chrome.* call
  // throws "Extension context invalidated" synchronously from then on. The
  // dangerous shape is a write inside a read's callback, because the callback
  // can be the thing that outlives the context, and a throw there is uncaught:
  // it lands in the user's extension error log saying nothing useful.
  //
  // Reading `chrome.runtime.lastError` throws in the same state, so the
  // callback body is wrapped too, not just the call.

  function localGet(keys, cb) {
    try {
      chrome.storage.local.get(keys, (result) => {
        try { cb(result || {}); } catch (err) { /* orphaned mid-callback */ }
      });
    } catch (err) { /* orphaned before the call */ }
  }

  function localSet(items) {
    try { chrome.storage.local.set(items); } catch (err) { /* orphaned */ }
  }

  // ── Toolbar badge ──────────────────────────────────────────────────────────
  //
  // The page itself gives no sign the extension is alive: a name we substituted
  // looks exactly like a name Google rendered, so "working" and "not installed"
  // are indistinguishable on screen. The toolbar badge is the one place we can
  // say so, and it costs no permission — `chrome.action` is addressed from the
  // service worker, which owns it.
  //
  // What is counted is distinct identifiers, not text nodes: GA4 prints the same
  // slug in the breadcrumb, the switcher and several report rows, and "17" would
  // say nothing useful about a page holding three extensions.

  const applied = new Set();
  let badgeReported = -1;
  let badgeTimer = null;
  let badgeProperty;   // the property the current count belongs to

  function noteApplied(key) {
    if (applied.has(key)) return;
    applied.add(key);
    scheduleBadgeReport();
  }

  // Coalesced: a single GA4 render fires the observer many times, and each pass
  // would otherwise wake the service worker for a number it already has.
  function scheduleBadgeReport() {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(reportBadge, 400);
  }

  /**
   * A property switch is a hash change, not a page load, so nothing else clears
   * the count: without this the badge still read "1" while the user stared at
   * the raw slug of a property that has no name. Once per property, because
   * clearing repeatedly during the switch would drop names already counted:
   * `processedNodes` will not offer those nodes a second time unless GA4
   * rewrites them.
   */
  function resetBadgeForView(propertyId) {
    if (propertyId === badgeProperty) return;
    badgeProperty = propertyId;
    applied.clear();
    badgeReported = -1;
    scheduleBadgeReport();
  }

  function reportBadge() {
    if (applied.size === badgeReported) return;
    badgeReported = applied.size;
    try {
      chrome.runtime.sendMessage(
        { action: 'namesApplied', count: badgeReported },
        () => { void chrome.runtime.lastError; }
      );
    } catch (err) {
      // Orphaned content script: the extension was reloaded under us, so the
      // DOM half still runs but chrome.* is gone. Nothing to report to.
    }
  }

  // ── Text-node replacement ──────────────────────────────────────────────────

  function replaceInNode(node) {
    if (processedNodes.has(node)) return;

    // Mark before touching so that if anything throws we don't retry forever
    processedNodes.add(node);

    const original = node.nodeValue;
    if (!original || !original.trim()) return;

    let text = original;
    for (const [slug, name] of slugMap) {
      if (text.includes(slug)) {
        // Replace ALL occurrences of this slug in the text node
        text = text.split(slug).join(name);
        noteApplied(slug);
      }
    }

    if (text !== original) {
      // Remember which property this page is showing, before its slug stops
      // being visible. harvestNameHint falls back to this.
      for (const slug of slugMap.keys()) {
        if (original.trim() === slug) { currentSlug = slug; break; }
      }

      // Tag this node before writing so the resulting characterData mutation
      // is identified as ours and skipped by the observer (loop prevention).
      ourWrittenNodes.add(node);
      node.nodeValue = text;
    }
  }

  // ── Tree walker ────────────────────────────────────────────────────────────

  function walkTree(root) {
    if (!root) return;

    // If called with a text node, walk from its parent instead
    const startNode = root.nodeType === Node.TEXT_NODE
      ? (root.parentElement || document.body)
      : root;

    if (!startNode || !startNode.nodeType) return;

    const walker = document.createTreeWalker(
      startNode,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const tag = node.parentElement && node.parentElement.tagName;
          if (tag && SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    // Collect first, then replace — avoids modifying the tree mid-walk
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(replaceInNode);
  }

  // ── Account-label compound pass ───────────────────────────────────────────
  // GA4 labels every CWS developer account as "Chrome Web Store developer
  // properties" — same text for all accounts, differentiated only by the
  // numeric account ID in a sibling text node. This pass finds that pair in
  // the DOM and replaces the generic label with the user's chosen display name.
  // The raw numeric ID is left in place so it remains visible below the label.

  const ACCOUNT_LABEL = 'Chrome Web Store developer properties';

  function pairAccountLabels(root) {
    if (accountMap.size === 0) return;
    const startNode = (root && root.nodeType) ? root : document.body;

    const walker = document.createTreeWalker(
      startNode,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const tag = node.parentElement && node.parentElement.tagName;
          if (tag && SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const labels = [];
    let n;
    while ((n = walker.nextNode())) {
      if (!processedNodes.has(n) && n.nodeValue && n.nodeValue.includes(ACCOUNT_LABEL)) {
        labels.push(n);
      }
    }

    let replaced = 0;
    for (const labelNode of labels) {
      const match = findAccountIdNear(labelNode, 8);
      if (!match) continue;

      // Replace the generic label with the extension/account display name
      processedNodes.add(labelNode);
      ourWrittenNodes.add(labelNode);
      labelNode.nodeValue = labelNode.nodeValue.replace(ACCOUNT_LABEL, match.name);
      noteApplied('account:' + match.name);

      // Leave the raw numeric ID in place so it renders below the display name
      replaced++;
    }

    // Record a heartbeat so the popup can warn if this label stops being found
    // (e.g. Google renames the UI element in a future update).
    if (replaced > 0) {
      localSet({ accountLabelLastMatched: Date.now() });
    }
  }

  function findAccountIdNear(labelNode, maxDepth) {
    let ancestor = labelNode.parentElement;
    for (let d = 0; d < maxDepth && ancestor; d++) {
      const found = firstAccountIdIn(ancestor, labelNode);
      if (found) return found;
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  function firstAccountIdIn(container, excludeNode) {
    const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement && node.parentElement.tagName;
        return SKIP_TAGS.has(tag) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = w.nextNode())) {
      if (node === excludeNode) continue;
      const val = node.nodeValue && node.nodeValue.trim();
      if (val && accountMap.has(val)) return { node, name: accountMap.get(val) };
    }
    return null;
  }

  // ── Debounced batch processing ─────────────────────────────────────────────

  function scheduleBatch(roots) {
    roots.forEach((r) => pendingRoots.add(r));
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const batch = Array.from(pendingRoots);
      pendingRoots.clear();
      batch.forEach(root => {
        pairAccountLabels(root);
        walkTree(root);
      });
      maybeHarvest();
    }, 80);
  }

  // ── Full-page re-run (called on init and storage change) ──────────────────

  function replaceAll() {
    // Cancel any pending batch — replaceAll is a full-page pass, making pending
    // partial roots redundant and wasteful.
    clearTimeout(debounceTimer);
    pendingRoots.clear();
    processedNodes = new WeakSet();
    ourWrittenNodes = new WeakSet();

    // A full pass recounts from scratch, so a mapping the user deleted stops
    // being counted. -1 forces the next report through even if it lands on the
    // same number the badge already shows. Claiming the current property here
    // matters: without it the first observer callback of the page reads as a
    // property switch and wipes a count that has already been earned.
    applied.clear();
    badgeReported = -1;
    badgeProperty = currentPropertyId();

    pairAccountLabels(document.body);
    walkTree(document.body);
    scheduleBadgeReport();
  }

  // ── MutationObserver ───────────────────────────────────────────────────────

  function initObserver() {
    observer = new MutationObserver((mutations) => {
      // A single-page property switch shows up here first. Seeing it late is how
      // the previous property's reports get attributed to the new one.
      noticePropertySwitch();

      // Harvesting is independent of the mapping state: a user with no mappings
      // yet is exactly who benefits most from name hints. Throttled internally.
      maybeHarvest();

      if (slugMap.size === 0 && accountMap.size === 0) return;

      const roots = new Set();
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const node = mutation.target;
          if (ourWrittenNodes.has(node)) {
            // Our own write — consume the tag and ignore to prevent loop
            ourWrittenNodes.delete(node);
          } else {
            // GA4 updated a text node directly (React reusing cached nodes,
            // async data fill, SPA re-render). Un-mark so we re-process it.
            processedNodes.delete(node);
            if (node.parentElement) roots.add(node.parentElement);
          }
        } else {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              roots.add(node);
            } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
              roots.add(node.parentElement);
            }
          }
        }
      }

      if (roots.size > 0) scheduleBatch(Array.from(roots));
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true   // catch GA4 updating text nodes in-place (SPA nav, async data)
    });
  }

  // ── Storage change listener ────────────────────────────────────────────────

  chrome.storage.onChanged.addListener((changes, area) => {
    // Guard against race: listener is registered before init() completes.
    // If observer hasn't been created yet, init() will call replaceAll() itself.
    if (!observer) return;

    let changed = false;
    if (area === 'sync') {
      if (changes.mappings)        { userMappings        = changes.mappings.newValue        || {}; changed = true; }
      if (changes.accountMappings) { userAccountMappings = changes.accountMappings.newValue || {}; changed = true; }
    } else if (area === 'local') {
      // Auto-derived names apply themselves through this branch, with no save
      if (changes.autoMappings)        { autoMappings        = changes.autoMappings.newValue        || {}; changed = true; }
      if (changes.autoAccountMappings) { autoAccountMappings = changes.autoAccountMappings.newValue || {}; changed = true; }
      if (changes.autoNamingEnabled)   { autoNamingEnabled   = changes.autoNamingEnabled.newValue !== false; changed = true; }
    }

    if (!changed) return;
    rebuildMaps();
    replaceAll();
  });

  // ── Page scanning ──────────────────────────────────────────────────────────

  const SLUG_RE       = /^[a-z]{20,}$/;   // a property slug rendered as the property name
  const NUMERIC_ID_RE = /^\d{8,12}$/;     // a GA4 account or property ID
  const MAX_ACCOUNTS  = 10;

  /**
   * Every visible text node on the page, in document order, trimmed and with
   * blanks dropped. Both scans below work off this one walk rather than
   * repeating the traversal.
   */
  function visibleTextValues() {
    const walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const tag = node.parentElement && node.parentElement.tagName;
          return SKIP_TAGS.has(tag) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const values = [];
    let node;
    while ((node = walker.nextNode())) {
      const val = node.nodeValue && node.nodeValue.trim();
      if (val) values.push(val);
    }
    return values;
  }

  /**
   * Account IDs visible anywhere on the page, not just the one in the URL.
   *
   * The GA4 account switcher renders every account as a name followed by its
   * 9-digit ID, which is the only way to see accounts other than the one
   * currently open. Properties render in exactly the same shape, so a numeric
   * ID is only treated as an account when the label immediately preceding it
   * is NOT a property slug.
   *
   * Returns [{ id, label }] so the popup can show which account each ID is.
   */
  function collectAccounts(values) {
    const accounts = [];
    const seen = new Set();

    // Authoritative: every account GA4 knows about, switcher open or not.
    const tree = parseAccountTree();
    if (tree) {
      for (const account of tree) {
        if (seen.has(account.accountId)) continue;
        seen.add(account.accountId);
        accounts.push({ id: account.accountId, label: account.accountName || null });
      }
    }

    for (let i = 0; i < values.length; i++) {
      const val = values[i];
      if (!NUMERIC_ID_RE.test(val) || seen.has(val)) continue;

      // Nearest preceding non-numeric text is the row's label
      let label = null;
      for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
        if (!NUMERIC_ID_RE.test(values[j])) { label = values[j]; break; }
      }

      // No label, or the label is a property slug, means this is a property ID
      if (!label || SLUG_RE.test(label)) continue;

      seen.add(val);
      accounts.push({ id: val, label });
      if (accounts.length >= MAX_ACCOUNTS) break;
    }
    return accounts;
  }

  function collectSlugs(values) {
    const slugs = [];
    const seen = new Set(slugMap.keys());

    // GA4's tree lists every property across every account, so the popup can
    // offer them all without the user opening the account switcher.
    for (const val of allSlugsFromTree().concat(values)) {
      if (SLUG_RE.test(val) && !seen.has(val)) {
        slugs.push(val);
        seen.add(val);
      }
    }
    return slugs;
  }

  // ── GA4's own account tree ─────────────────────────────────────────────────
  //
  // GA4 ships the full account/property tree inline on every page, as the text
  // of a <script> block: `window.preload = JSON.parse('...')`. A content script
  // cannot read the page's JS variables, but it can read that script element's
  // text, which gives every account ID, property ID and property slug, plus the
  // exact account-to-property pairing, with no UI interaction at all.
  //
  // This is the authoritative source. It is also GA4 internals, so it can change
  // without notice; every caller falls back to scanning rendered text.

  function decodeJsStringLiteral(literal) {
    return literal.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (full, esc) => {
      if (esc[0] === 'x' || esc[0] === 'u') {
        return String.fromCharCode(parseInt(esc.slice(1), 16));
      }
      if (esc === 'n') return '\n';
      if (esc === 't') return '\t';
      return esc; // covers \\ -> \ , \' -> ' , \/ -> /
    });
  }

  /**
   * [{ accountId, accountName, properties: [{ propertyId, slug }] }] or null.
   */
  function parseAccountTree() {
    let raw = null;
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      if (text.includes('accountTree') && text.includes('JSON.parse')) { raw = text; break; }
    }
    if (!raw) return null;

    const literal = raw.match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
    if (!literal) return null;

    let tree;
    try {
      tree = JSON.parse(decodeJsStringLiteral(literal[1]));
    } catch (err) {
      return null;
    }

    const accounts = tree && tree.accountTree && tree.accountTree.accounts;
    if (!Array.isArray(accounts)) return null;

    return accounts.map(a => ({
      accountId: String(a.id || ''),
      accountName: String(a.name || ''),
      properties: (Array.isArray(a.properties) ? a.properties : []).map(p => ({
        propertyId: String(p.id || ''),
        slug: String(p.name || '')
      }))
    })).filter(a => a.accountId);
  }

  /**
   * The slug of the property this page is showing, taken from GA4's own tree.
   *
   * The URL carries the numeric property ID (#/a<account>p<property>/...), and
   * the tree maps that to the slug. This is far more reliable than looking for
   * the slug in rendered text, which depends on where GA4 chooses to draw it
   * and disappears entirely once we have replaced it with a display name.
   */
  function slugFromTree() {
    const source = window.location.hash || window.location.href;
    const m = source.match(/a\d{7,}p(\d{6,})/);
    if (!m) return null;

    const propertyId = m[1];
    const tree = parseAccountTree();
    if (!tree) return null;

    for (const account of tree) {
      for (const property of account.properties) {
        if (property.propertyId === propertyId && SLUG_RE.test(property.slug)) {
          return property.slug;
        }
      }
    }
    return null;
  }

  /** Every property slug GA4 knows about, across all accounts. */
  function allSlugsFromTree() {
    const tree = parseAccountTree();
    if (!tree) return [];
    const out = [];
    for (const account of tree) {
      for (const property of account.properties) {
        if (SLUG_RE.test(property.slug)) out.push(property.slug);
      }
    }
    return out;
  }

  /** accountId -> its property slugs, from the tree. Empty map if unavailable. */
  function accountToSlugs() {
    const map = new Map();
    const tree = parseAccountTree();
    if (!tree) return map;
    for (const a of tree) {
      map.set(a.accountId, a.properties.map(p => p.slug).filter(Boolean));
    }
    return map;
  }

  /**
   * Record one property against its account.
   *
   * The tree above is the bulk source, but it is not complete: GA4 preloads a
   * capped set of accounts, measured at 18 on a live profile holding more, and
   * an account outside that set never appears in it. The URL, by contrast, names
   * the account and property of whatever the user is actually looking at, every
   * time. So every property the user visits is filed from the URL, and the tree
   * fills in the rest for free.
   */
  function persistPropertyAccount(slug, accountId, propertyId) {
    if (!slug || !accountId || !SLUG_RE.test(slug)) return;

    localGet(['propertyAccounts', 'propertyIds'], (result) => {
      const known = result.propertyAccounts || {};
      const ids   = result.propertyIds || {};

      const pairChanged = known[slug] !== accountId;
      const idChanged   = !!propertyId && ids[slug] !== propertyId;
      if (!pairChanged && !idChanged) return;

      if (pairChanged) known[slug] = accountId;
      if (idChanged)   ids[slug]   = propertyId;

      const write = {};
      if (pairChanged) write.propertyAccounts = known;
      if (idChanged)   write.propertyIds = ids;
      localSet(write);
    });
  }

  /**
   * Remember the base URL of a Google Analytics page the user actually opened.
   *
   * Everything except the hash, which is origin + path + query, and the query
   * is the point: it carries `authuser`. A user signed into several Google
   * accounts is looking at one specific identity, and Analytics opened without
   * that parameter loads a different one. Measured on a live profile: the same
   * property URL opened without it landed on the other identity's Analytics,
   * whose inlined account tree held 18 accounts and not one Chrome Web Store
   * property. With it: 5 accounts and all 8 extensions.
   *
   * The settings page needs this when it has to open Analytics with no GA4 tab
   * already open, which is exactly the cold start "Open GA4 and name all
   * properties" performs. Local only, never transmitted, no hash so no account
   * or property id is kept here (they have their own keys).
   */
  function persistGa4Base() {
    const base = window.location.origin + window.location.pathname + window.location.search;
    localGet(['ga4Base'], (result) => {
      if (result.ga4Base === base) return;
      localSet({ ga4Base: base });
    });
  }

  /**
   * Mirror which account each property belongs to into local storage.
   *
   * The two name maps are deliberately flat (slug -> name, accountId -> name)
   * because that is all the replacement engine needs. The settings page shows
   * both in one table grouped by account, and nothing in the extension knows
   * that pairing: only GA4's own inline tree does. So it is recorded here, as
   * a plain slug -> accountId map, whenever a GA4 page is open.
   *
   * Merged, never replaced: one page's tree only carries the accounts that page
   * can see, and dropping the rest on every navigation would make the settings
   * table regroup itself at random.
   *
   * This is structure, not a name, so it is recorded even when automatic naming
   * is switched off. It stays in `local` (derived, per-device) and is never
   * sent anywhere.
   */
  function persistAccountTree() {
    const pairs = accountToSlugs();
    if (pairs.size === 0) return;

    // slug -> numeric property id, from the same tree. The settings page needs
    // it to build a GA4 URL for a property the user has not visited, which is
    // what "name my remaining properties" navigates to (ADR-018).
    const idBySlug = new Map();
    const tree = parseAccountTree() || [];
    for (const account of tree) {
      for (const property of account.properties) {
        if (SLUG_RE.test(property.slug) && property.propertyId) {
          idBySlug.set(property.slug, property.propertyId);
        }
      }
    }

    localGet(['propertyAccounts', 'propertyIds'], (result) => {
      const known = result.propertyAccounts || {};
      const ids   = result.propertyIds || {};
      let changed = false;
      let idsChanged = false;

      for (const [slug, propertyId] of idBySlug) {
        if (ids[slug] === propertyId) continue;
        ids[slug] = propertyId;
        idsChanged = true;
      }

      for (const [accountId, slugs] of pairs) {
        if (!accountId) continue;
        for (const slug of slugs) {
          if (!SLUG_RE.test(slug) || known[slug] === accountId) continue;
          known[slug] = accountId;
          changed = true;
        }
      }

      const write = {};
      if (changed)    write.propertyAccounts = known;
      if (idsChanged) write.propertyIds = ids;
      if (changed || idsChanged) localSet(write);
    });
  }

  // ── Harvesting extension names from GA4's own reports ──────────────────────
  //
  // GA4's "Page title and screen class" report for a Chrome Web Store developer
  // property lists the store listing pages that were viewed, and the store
  // renders those titles as "<Extension Name> - <localised store name>". So the
  // extension's real name is already on the page, for free, with no lookup:
  //
  //   Bulk Bookmark Cleaner and Sorter - Chrome Web Store              60
  //   Bulk Bookmark Cleaner and Sorter - Интернет-магазин Chrome         1
  //   Chrome Web Store - Extensions                                      0   <- generic
  //
  // Splitting on the LAST " - " strips the store suffix in any language while
  // preserving a name that itself contains " - ". Generic store pages are
  // dropped by name, and the remaining candidates are ranked by view count.

  // Prefixes that are store furniture rather than an extension name
  const GENERIC_TITLES = new Set([
    'chrome web store', 'extensions', 'themes', 'apps', 'search results',
    'collection', 'category', 'home', '(not set)', '(other)', 'chrome',
    'google', 'analytics'
  ]);

  const HARVEST_INTERVAL_MS = 5000;

  // While the reports for a newly selected property have not settled yet, look
  // more often: settling costs two passes, and 10 seconds of a stale or missing
  // name is far too long to wait on an ordinary property switch.
  const SETTLE_INTERVAL_MS = 1200;

  // Before that, there is a slower wait for GA4 to render the report at all.
  // Measured on a live account: the page is interactive long before the
  // "Views by page title" card has any rows in it.
  const AWAIT_REPORTS_INTERVAL_MS = 2500;
  const AWAIT_REPORTS_MAX_MS      = 90000;

  let lastHarvestAt = 0;

  // ── Settle tracking ────────────────────────────────────────────────────────
  //
  // Google Analytics is a single-page app. Switching property rewrites the URL
  // immediately but refetches the report widgets asynchronously, so for a second
  // or so the page shows the NEW property in its URL and the OLD property's data
  // in its reports. Harvesting in that window pairs the new property's slug with
  // the previous extension's name and writes that pairing to storage, where it
  // sticks: the breadcrumb then shows the wrong extension until something
  // happens to overwrite it. This was reported from live use.
  //
  // So after an in-page switch a name is attributed only once the reports have
  // BOTH changed from what they showed before the switch AND then held still for
  // a pass. "Held still" alone is not enough: reports that have not started
  // refreshing yet also hold still, which is precisely the stale case. Requiring
  // a change proves the refresh actually happened.
  //
  // That requirement applies only to an in-page switch. A full page load cannot
  // be showing a previous property's data, so there is nothing to change from
  // and the reports are trusted as soon as they stop moving.
  //
  // If they never settle, nothing is recorded, which is the correct outcome: an
  // unnamed property beats a wrongly named one.
  let settleProperty    = null;   // the property the fingerprint below belongs to
  let settleFingerprint = null;   // what its reports looked like on the last pass
  let settleBaseline    = null;   // what they showed at the switch; null on a fresh load
  let settleConfirmed   = false;  // changed then held still: safe to attribute
  let settleAttempts    = 0;
  let settleTimer       = null;

  // True while the page shows no candidate names at all, which means GA4 has
  // not rendered the report yet rather than that it has settled on nothing.
  let awaitingReports   = true;
  let settleStartedAt   = Date.now();

  // Settling needs at least two passes, and passes are normally driven by the
  // MutationObserver. A page that has finished rendering stops mutating, so
  // waiting for the next mutation can mean waiting forever: the first pass after
  // a switch would record the fingerprint and nothing would ever confirm it.
  // While unsettled, drive the next pass from here instead.
  const SETTLE_MAX_ATTEMPTS = 15;   // settling passes, once there is something to settle

  function scheduleSettleCheck() {
    if (settleConfirmed || !autoNamingEnabled) return;

    if (awaitingReports) {
      // Still waiting for GA4 to draw the report. Slower cadence, longer budget.
      if (Date.now() - settleStartedAt > AWAIT_REPORTS_MAX_MS) return;
    } else if (settleAttempts >= SETTLE_MAX_ATTEMPTS) {
      return;
    }

    clearTimeout(settleTimer);
    settleTimer = setTimeout(
      maybeHarvest,
      awaitingReports ? AWAIT_REPORTS_INTERVAL_MS : SETTLE_INTERVAL_MS
    );
  }

  /**
   * Notice a property switch immediately, whatever the harvest throttle says.
   *
   * Once a property has settled the throttle drops to 5 seconds, which is fine
   * for harvesting but far too slow for noticing that the user has moved to a
   * different property: until the switch is seen, `settleConfirmed` stays true
   * and the next pass would happily attribute the old property's reports.
   */
  function noticePropertySwitch() {
    const propertyId = currentPropertyId();
    resetBadgeForView(propertyId);
    if (propertyId === settleProperty || settleProperty === null) return;
    settleConfirmed = false;
    settleAttempts  = 0;
    settleStartedAt = Date.now();
    lastHarvestAt   = 0;      // let the next pass run at once
    scheduleSettleCheck();
  }

  /** The property ID in the URL: #/a<account>p<property>/… */
  function currentPropertyId() {
    const source = window.location.hash || window.location.href;
    const m = source.match(/a\d{7,}p(\d{6,})/);
    return m ? m[1] : null;
  }

  /** A cheap, order-independent signature of the candidate names on screen. */
  function fingerprintCandidates(score) {
    return Array.from(score.entries())
      .map(([name, total]) => `${name}\u0000${total}`)
      .sort()
      .join('\u0001');
  }

  /**
   * Is this the tail of a Chrome Web Store page title?
   *
   * The store titles listing pages "<Extension Name> - <store name>", and the
   * store's name is localised: "Chrome Web Store", "Интернет-магазин Chrome",
   * "Chrome ウェブストア", "Chrome 線上應用程式商店". Every variant seen contains
   * the word "Chrome", which is what makes this testable without a list of
   * translations.
   *
   * It also cleanly rejects the store's own furniture pages, because
   * "Chrome Web Store - Extensions" has a tail of "Extensions", which does not
   * mention Chrome, so the row is dropped rather than yielding a bogus name.
   */
  function looksLikeStoreSuffix(tail) {
    return /chrome/i.test(tail) && tail.length <= 40;
  }

  /**
   * Split "<name> - <store>" on the LAST " - ", which strips the store suffix
   * in any language while preserving a name that itself contains " - ".
   * Returns the name, or null if this is not a store listing title.
   */
  function nameFromStoreTitle(title) {
    if (typeof title !== 'string') return null;
    const cut = title.lastIndexOf(' - ');
    if (cut <= 0) return null;

    const name = title.slice(0, cut).trim();
    const tail = title.slice(cut + 3).trim();
    if (!name || !looksLikeStoreSuffix(tail)) return null;
    if (GENERIC_TITLES.has(name.toLowerCase())) return null;
    if (name.length > 120) return null;
    return name;
  }

  /**
   * Weighted candidate names, gathered by two independent strategies so that a
   * change to GA4's home page layout degrades the result rather than breaking it.
   *
   * Strategy A: any report table whose header mentions a page-title dimension.
   *   Rows there carry view counts, which make a strong weight.
   *
   * Strategy B: every visible text node on the page that looks like a store
   *   listing title, wherever it appears. This needs no table, no header text
   *   and no particular widget, so it still works if the "Views by page title"
   *   card is absent, renamed, replaced, or joined by other charts.
   *
   * Both feed one score, so a name found by both wins over a name found by one.
   */
  function nameCandidates(values) {
    const score = new Map();
    const bump = (name, weight) => {
      if (!name) return;
      score.set(name, (score.get(name) || 0) + weight);
    };

    // Strategy A — page-title report tables, weighted by views
    document.querySelectorAll('table').forEach((table) => {
      const trs = Array.from(table.querySelectorAll('tr'));
      if (!trs.length) return;
      const head = (trs[0].textContent || '').toLowerCase();
      if (!/page title|screen class|screen name|page path/.test(head)) return;

      trs.slice(1).forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll('th,td'))
          .map(c => (c.textContent || '').trim())
          .filter(Boolean);
        if (!cells.length) return;
        const views = parseInt((cells[1] || '0').replace(/[^\d]/g, ''), 10) || 0;
        // +2 so a zero-view listing still outranks a bare text sighting
        bump(nameFromStoreTitle(cells[0]), views + 2);
      });
    });

    // Strategy B — any store-listing-shaped text anywhere on the page
    for (const value of values) {
      bump(nameFromStoreTitle(value), 1);
    }

    return score;
  }

  function bestCandidate(score) {
    let best = null;
    let runnerUp = 0;
    for (const [name, total] of score) {
      if (!best || total > best.total) { runnerUp = best ? best.total : 0; best = { name, total }; }
      else if (total > runnerUp) runnerUp = total;
    }
    if (!best) return null;

    // Two different extensions scoring equally means this page is showing more
    // than one listing, so there is no single answer. Refuse rather than guess.
    if (runnerUp === best.total) return null;

    return best.name;
  }

  function extensionNameFromReports(values) {
    return bestCandidate(nameCandidates(values || visibleTextValues()));
  }

  /**
   * Harvest a slug-to-name hint for the property currently being viewed.
   *
   * The report belongs to whichever property is selected, so a hint can only be
   * attributed when exactly one property slug is visible. With the account
   * switcher open several are on screen at once, and guessing which one the
   * report belongs to would risk mislabelling a property. In that case we skip
   * rather than guess.
   *
   * It must also wait for the reports to catch up with the URL after a property
   * switch — see the settle tracking above.
   */
  function harvestNameHint(values) {
    const propertyId = currentPropertyId();
    const score = nameCandidates(values);
    const fingerprint = fingerprintCandidates(score);

    if (propertyId !== settleProperty) {
      // The property just changed. Whatever is on screen right now may still
      // belong to the property we came from, so record it and attribute nothing
      // on this pass.
      // Only an in-page switch can be showing the previous property's reports.
      settleBaseline    = settleProperty === null ? null : fingerprint;
      settleProperty    = propertyId;
      settleFingerprint = fingerprint;
      settleConfirmed   = false;
      settleAttempts    = 0;
      awaitingReports   = score.size === 0;
      settleStartedAt   = Date.now();

      // The slug recorded while replacing text belongs to the OLD property.
      // Keeping it would let the fallback below attribute this property's
      // reports to the previous one.
      currentSlug = null;
      return null;
    }

    if (!settleConfirmed) {
      // Nothing on screen to name yet. This is GA4 still loading the report,
      // not a settled answer of "no name", and calling it settled would end the
      // polling and leave the first name waiting on an unrelated mutation.
      // Measured before this guard: over 20 seconds to the first name.
      if (score.size === 0) { awaitingReports = true; return null; }
      awaitingReports = false;

      settleAttempts++;

      // Unchanged since the switch: the refetch has not landed yet, so what is
      // on screen still belongs to the property we came from.
      if (settleBaseline !== null && fingerprint === settleBaseline) return null;

      if (fingerprint !== settleFingerprint) {
        settleFingerprint = fingerprint;   // still refreshing
        return null;
      }
      settleConfirmed = true;              // changed, then held still
    }

    // Best source: GA4's own tree, keyed off the property ID in the URL. This
    // is exact, survives our own replacements, and does not care where GA4
    // renders the slug or whether it renders it at all.
    let slug = slugFromTree();

    // Whether the slug came from that authoritative pairing or from a fallback.
    // Only an exact slug is allowed to take a name away from another property.
    const exact = !!slug;

    if (!slug) {
      // Fallbacks, in order: exactly one slug still visible as text, then the
      // property we recorded while replacing its slug earlier. Either way it
      // must resolve to exactly one property, or we cannot say which one the
      // report describes and must not guess.
      const visible = Array.from(new Set(values.filter(v => SLUG_RE.test(v))));
      if (visible.length === 1) slug = visible[0];
      else if (visible.length === 0 && currentSlug) slug = currentSlug;
    }
    if (!slug) return null;

    const name = bestCandidate(score);
    if (!name) return null;

    return { slug, name, exact };
  }

  /**
   * The account this page belongs to, from the URL hash: #a241067359p515458307
   * This is the only account visible unless the switcher panel is open.
   */
  function currentAccountId() {
    const source = window.location.hash || window.location.href;
    const m = source.match(/a(\d{7,})/);
    return m ? m[1] : null;
  }

  /**
   * A short form of an extension name, for use as an account display name.
   * Kept in step with the same function in popup.js.
   */
  const TRAILING_STOPWORDS = new Set([
    'and', 'or', 'the', 'a', 'an', 'as', 'of', 'for', 'to', 'in', 'on', 'with', 'by', 'my', 'your'
  ]);

  /**
   * @param {number} maxChars  soft cap: the last word that fits is the last kept
   * @param {number} minWords  hard floor: this many words survive the cap, because
   *                           one word is rarely the extension. "Google Analytics
   *                           Name Changer for Chrome Extensions" cut to a single
   *                           word is "Google", which reads as somebody else's
   *                           product rather than as ours.
   */
  function shortenName(name, maxChars = 24, minWords = 1) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    const kept = [words[0]];
    for (let i = 1; i < words.length; i++) {
      if ((kept.join(' ') + ' ' + words[i]).length > maxChars && kept.length >= minWords) break;
      kept.push(words[i]);
    }
    const dangling = () => TRAILING_STOPWORDS.has(kept[kept.length - 1].toLowerCase());
    // Never end on a connector word: drop it while we can spare it, otherwise
    // take the next word instead, so the floor is met without reading as a cut.
    while (kept.length > Math.max(1, minWords) && dangling()) kept.pop();
    while (dangling() && words.length > kept.length) kept.push(words[kept.length]);
    return kept.join(' ');
  }

  // How long a combined account label may run. An account label sits in GA4's
  // breadcrumb next to the property name, so it has to stay short.
  const COMBINED_MAX_CHARS = 38;

  /**
   * Punctuation inside an extension name is noise once the name is cut down to
   * a couple of words, and a separator dash is worse than noise: cutting
   * "OpenFullPage - Capture Screen" mid-phrase leaves a hyphen dangling.
   */
  function tidyForCombining(name) {
    return String(name)
      .replace(/\s+[-\u2013\u2014]+\s+/g, ' ')   // "OpenFullPage - Capture" -> "OpenFullPage Capture"
      .replace(/[,:;|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Build one account label out of the extensions the account holds.
   *
   * One extension: its name, shortened, as before. Two: both, each cut harder
   * and joined with " + ", so the account reads "Tab Session Saver + Dark Mode
   * Everywhere" rather than sitting blank. Three or more: the first name and a
   * count, "Tab Session Saver Pro + 2 more".
   *
   * Extensions we have not named yet are counted, not guessed at, so an account
   * we only half know says "… + 1 more" instead of quietly labelling itself
   * after the single extension we happen to have seen. The label is rewritten
   * as the remaining names are learned.
   */
  function combineAccountName(names, unknown) {
    const known = names.filter(Boolean);
    if (known.length === 0) return '';

    const total = known.length + (unknown || 0);
    if (total === 1) return shortenName(known[0]);

    // Two extensions: both names, each at least two words. Three or more: the
    // first name at three words and a count for the rest, because three names
    // cut to nine characters each is a label nobody can read. The word floor
    // wins over COMBINED_MAX_CHARS when the two disagree.
    const minWords = total >= 3 ? 3 : 2;
    const shown = known.slice(0, total >= 3 ? 1 : 2);
    const rest  = total - shown.length;
    const more  = rest > 0 ? `${rest} more` : '';

    const slots  = shown.length + (rest > 0 ? 1 : 0);
    const budget = COMBINED_MAX_CHARS - 3 * (slots - 1) - more.length;
    const per    = Math.max(9, Math.floor(budget / shown.length));

    const parts = shown.map(n => shortenName(tidyForCombining(n), per, minWords)).filter(Boolean);
    if (rest > 0) parts.push(more);
    return parts.join(' + ');
  }

  /**
   * Every property slug this account holds: GA4's own tree when it lists the
   * account, otherwise everything we have filed under it. The tree is exact but
   * capped, so the filed pairs are what cover the rest (ADR-014).
   */
  function slugsOfAccount(accountId, pairs) {
    const fromTree = accountToSlugs().get(accountId);
    if (fromTree && fromTree.length > 0) return fromTree;
    return Object.keys(pairs || {}).filter(slug => pairs[slug] === accountId);
  }

  function accountLabelFor(accountId, autos, pairs) {
    const slugs = slugsOfAccount(accountId, pairs);
    if (slugs.length === 0) return '';

    const names = [];
    let unknown = 0;
    for (const slug of slugs) {
      const name = userMappings[slug] || autos[slug];
      if (name) names.push(name); else unknown++;
    }
    return combineAccountName(names, unknown);
  }

  /**
   * Record a derived name and apply it immediately.
   *
   * This is what removes the manual Save step: the name goes straight into
   * `autoMappings`, the storage listener picks the change up, and the page is
   * re-rendered with the real name. The user's own `mappings` are never written
   * to, so anything they typed keeps winning and nothing they own is clobbered.
   *
   * The account is named at the same time, from the same extension, but only
   * when this page shows exactly one property. A Chrome Web Store developer
   * account holds one extension, so that pairing is sound; with the account
   * switcher open it is not, and harvestNameHint has already bailed out.
   */
  function persistNameHint(hint) {
    if (!hint) return;

    const accountId = currentAccountId();

    // File this property under the account in the URL. Both come from the same
    // settled read, so the pairing is exact.
    persistPropertyAccount(hint.slug, accountId, currentPropertyId());

    localGet(
      ['nameHints', 'autoMappings', 'autoAccountMappings', 'propertyAccounts'],
      (result) => {

        const hints    = result.nameHints || {};
        const autos    = result.autoMappings || {};
        const autoAccs = result.autoAccountMappings || {};

        // One extension, one name. The same name under a second slug means one
        // of the two was read while GA4 still had the previous property's
        // reports on screen. Two Chrome Web Store extensions with byte-identical
        // names are not a real case, so this is always a stale read.
        //
        // Which one is stale depends on how confident THIS read is. A slug taken
        // from GA4's own account tree is exact: the reports settled and the URL
        // says this property owns the name, so the other claim is the stale one
        // and is evicted. Anything less certain yields instead, and leaves the
        // existing claim alone.
        //
        // The eviction matters: without it, one bad pairing written before this
        // check existed would permanently lock the rightful property out of its
        // own name.
        const claimants = Object.keys(autos)
          .filter(slug => slug !== hint.slug && autos[slug] === hint.name);

        if (claimants.length > 0) {
          if (!hint.exact) return;
          claimants.forEach((slug) => {
            delete autos[slug];
            if (hints[slug] === hint.name) delete hints[slug];
          });
        }

        const nameChanged = autos[hint.slug] !== hint.name || claimants.length > 0;
        const hintChanged = hints[hint.slug] !== hint.name;

        // Written first, so the account label below sees this property's name
        // alongside its siblings rather than one read behind.
        hints[hint.slug] = hint.name;
        autos[hint.slug] = hint.name;

        // A Chrome Web Store account can hold more than one extension (verified
        // live: two accounts here hold two and three). There is no single right
        // name for such an account, so it gets a draft built from all of them,
        // badged "auto" and editable like any other.
        const pairs = result.propertyAccounts || {};
        if (accountId) {
          // The pairing for this very property may not have reached storage
          // yet, so add it here rather than waiting a round.
          pairs[hint.slug] = accountId;
        }
        const label = accountId ? accountLabelFor(accountId, autos, pairs) : '';
        const accountChanged = !!label && autoAccs[accountId] !== label;

        if (!nameChanged && !accountChanged && !hintChanged) return;
        if (accountChanged) autoAccs[accountId] = label;

        localSet({
          nameHints: hints,
          autoMappings: autos,
          autoAccountMappings: autoAccs
        });
      }
    );
  }

  /**
   * Called from the debounced batch so hints accumulate as the user browses
   * GA4, without the popup ever being opened. Throttled because the batch runs
   * on every React render burst and this walks the page.
   */
  function maybeHarvest() {
    const now = Date.now();
    const interval = settleConfirmed  ? HARVEST_INTERVAL_MS
                   : awaitingReports  ? AWAIT_REPORTS_INTERVAL_MS
                   : SETTLE_INTERVAL_MS;

    // Throttled, but still reschedule. This function is called both by the timer
    // below and by the MutationObserver; if a throttled observer call returned
    // without rearming, an observer call landing just before the timer would
    // swallow the pass AND kill the chain, leaving the property unnamed forever.
    if (now - lastHarvestAt < interval) { scheduleSettleCheck(); return; }

    lastHarvestAt = now;
    try {
      // Grouping data rather than a name, so it is recorded either way: the
      // settings table groups the user's own mappings by account too. The tree
      // is exact but incomplete, so the property in the URL is filed directly
      // as well — that covers properties whose name can never be derived.
      persistAccountTree();
      persistPropertyAccount(slugFromTree(), currentAccountId(), currentPropertyId());
      if (!autoNamingEnabled) return;
      persistNameHint(harvestNameHint(visibleTextValues()));
    } catch (err) {
      // Harvesting is opportunistic; never let it break replacement.
    } finally {
      scheduleSettleCheck();
    }
  }

  // ── Popup message handler ──────────────────────────────────────────────────
  // Responds to the popup's request for the current GA4 page context: the
  // account IDs and unmapped property slugs visible on the page, plus the
  // account ID from the URL. The result is cached for non-GA4-tab sessions.

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Liveness probe. background.js asks before injecting, so a tab that
    // already has a working copy is never given a second one.
    if (msg.action === 'ping') { sendResponse({ ok: true }); return false; }

    if (msg.action !== 'getGA4Data') return false;

    // Account ID sits in the URL hash as: #a241067359p515458307/...
    // Check window.location.hash first (direct), then fall back to full href.
    // Use a permissive pattern: just 'a' followed by 7+ digits (account IDs are 9 digits).
    const urlForParsing = window.location.hash || window.location.href;
    const accountMatch = urlForParsing.match(/a(\d{7,})/);
    const accountId = accountMatch ? accountMatch[1] : null;

    const values   = visibleTextValues();
    const slugs    = collectSlugs(values);
    const accounts = collectAccounts(values);

    // Name for the property currently on screen, read out of GA4's own reports
    const hint = harvestNameHint(values);
    persistNameHint(hint);
    persistAccountTree();

    // The account in the URL is definite even if the switcher is closed, so
    // make sure it is present and listed first.
    if (accountId && !accounts.some(a => a.id === accountId)) {
      accounts.unshift({ id: accountId, label: null });
    }

    const payload = { accountId, accounts, slugs, hint };

    // Cache detected context so the popup can show it on non-GA4 tabs
    localSet({ lastGA4Context: payload });

    sendResponse(payload);
    return true;
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  function init() {
    chrome.storage.sync.get(['mappings', 'accountMappings'], (sync) => {
      userMappings        = (!chrome.runtime.lastError && sync.mappings)        || {};
      userAccountMappings = (!chrome.runtime.lastError && sync.accountMappings) || {};

      chrome.storage.local.get(
        ['autoMappings', 'autoAccountMappings', 'autoNamingEnabled'],
        (local) => {
          if (!chrome.runtime.lastError) {
            autoMappings        = local.autoMappings        || {};
            autoAccountMappings = local.autoAccountMappings || {};
            autoNamingEnabled   = local.autoNamingEnabled !== false; // default on
          }

          rebuildMaps();
          persistGa4Base();
          initObserver();
          if (slugMap.size > 0 || accountMap.size > 0) replaceAll();

          // GA4 fills its report widgets asynchronously, so the first harvest
          // has to wait for the data to land rather than running at
          // document_idle. Names derived here apply themselves immediately.
          setTimeout(maybeHarvest, 2500);
        }
      );
    });
  }

  /**
   * Stop this copy touching the page. Called by a newer copy that has just been
   * injected over the top of this one; see the takeover guard at the top.
   *
   * Only DOM-side work is undone, because that is the part that keeps running
   * in an orphaned copy. Its chrome.* listeners are already dead, and calling
   * removeListener on an invalidated context throws.
   */
  globalThis.__GA4NC__ = {
    teardown() {
      if (observer) { observer.disconnect(); observer = null; }
      clearTimeout(debounceTimer);
      clearTimeout(settleTimer);
      clearTimeout(badgeTimer);
      debounceTimer = null;
      settleTimer = null;
      badgeTimer = null;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
