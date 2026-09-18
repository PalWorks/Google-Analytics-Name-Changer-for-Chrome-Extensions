'use strict';

(function ga4NameChanger() {

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

      // Leave the raw numeric ID in place so it renders below the display name
      replaced++;
    }

    // Record a heartbeat so the popup can warn if this label stops being found
    // (e.g. Google renames the UI element in a future update).
    if (replaced > 0) {
      chrome.storage.local.set({ accountLabelLastMatched: Date.now() });
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
    pairAccountLabels(document.body);
    walkTree(document.body);
  }

  // ── MutationObserver ───────────────────────────────────────────────────────

  function initObserver() {
    observer = new MutationObserver((mutations) => {
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

  // ── Harvesting extension names from GA4's own reports ──────────────────────
  //
  // GA4's "Page title and screen class" report for a Chrome Web Store developer
  // property lists the store listing pages that were viewed, and the store
  // renders those titles as "<Extension Name> - <localised store name>". So the
  // extension's real name is already on the page, for free, with no lookup:
  //
  //   Gmail Labels and Search Queries as Tabs - Chrome Web Store        60
  //   Gmail Labels and Search Queries as Tabs - Интернет-магазин Chrome  1
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
  let lastHarvestAt = 0;

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

  function extensionNameFromReports(values) {
    const score = nameCandidates(values || visibleTextValues());

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

  /**
   * Harvest a slug-to-name hint for the property currently being viewed.
   *
   * The report belongs to whichever property is selected, so a hint can only be
   * attributed when exactly one property slug is visible. With the account
   * switcher open several are on screen at once, and guessing which one the
   * report belongs to would risk mislabelling a property. In that case we skip
   * rather than guess.
   */
  function harvestNameHint(values) {
    // Best source: GA4's own tree, keyed off the property ID in the URL. This
    // is exact, survives our own replacements, and does not care where GA4
    // renders the slug or whether it renders it at all.
    let slug = slugFromTree();

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

    const name = extensionNameFromReports(values);
    if (!name) return null;

    return { slug, name };
  }

  /**
   * The account this page belongs to, from the URL hash: #a376297388p515458307
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

  function shortenName(name, maxChars = 24) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    const kept = [words[0]];
    for (let i = 1; i < words.length; i++) {
      if ((kept.join(' ') + ' ' + words[i]).length > maxChars) break;
      kept.push(words[i]);
    }
    while (kept.length > 1 && TRAILING_STOPWORDS.has(kept[kept.length - 1].toLowerCase())) {
      kept.pop();
    }
    return kept.join(' ');
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

    // A Chrome Web Store account can hold more than one extension (verified
    // live: one test account holds two). Naming such an account after a single
    // one of its extensions would be wrong, so only do it when GA4's own tree
    // confirms this account holds exactly one property. With no tree available,
    // fall back to requiring that this page shows exactly one property.
    const slugsForAccount = accountToSlugs().get(accountId);
    const soleProperty = slugsForAccount
      ? slugsForAccount.length === 1
      : true;
    const shortName = soleProperty ? shortenName(hint.name) : '';

    chrome.storage.local.get(
      ['nameHints', 'autoMappings', 'autoAccountMappings'],
      (result) => {
        if (chrome.runtime.lastError) return;

        const hints    = result.nameHints || {};
        const autos    = result.autoMappings || {};
        const autoAccs = result.autoAccountMappings || {};

        const nameChanged    = autos[hint.slug] !== hint.name;
        const accountChanged = accountId && shortName && autoAccs[accountId] !== shortName;
        if (!nameChanged && !accountChanged && hints[hint.slug] === hint.name) return;

        hints[hint.slug] = hint.name;
        autos[hint.slug] = hint.name;
        if (accountId && shortName) autoAccs[accountId] = shortName;

        chrome.storage.local.set({
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
    if (!autoNamingEnabled) return;
    const now = Date.now();
    if (now - lastHarvestAt < HARVEST_INTERVAL_MS) return;
    lastHarvestAt = now;
    try {
      persistNameHint(harvestNameHint(visibleTextValues()));
    } catch (err) {
      // Harvesting is opportunistic; never let it break replacement.
    }
  }

  // ── Popup message handler ──────────────────────────────────────────────────
  // Responds to the popup's request for the current GA4 page context: the
  // account IDs and unmapped property slugs visible on the page, plus the
  // account ID from the URL. The result is cached for non-GA4-tab sessions.

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action !== 'getGA4Data') return false;

    // Account ID sits in the URL hash as: #a376297388p515458307/...
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

    // The account in the URL is definite even if the switcher is closed, so
    // make sure it is present and listed first.
    if (accountId && !accounts.some(a => a.id === accountId)) {
      accounts.unshift({ id: accountId, label: null });
    }

    const payload = { accountId, accounts, slugs, hint };

    // Cache detected context so the popup can show it on non-GA4 tabs
    chrome.storage.local.set({ lastGA4Context: payload });

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
