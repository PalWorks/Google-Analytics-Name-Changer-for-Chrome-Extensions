'use strict';

(function ga4NameChanger() {

  // ── State ──────────────────────────────────────────────────────────────────

  // Sorted Map<slug, name>: longest slug first to prevent partial-match collisions.
  let slugMap = new Map();

  // Map<accountId, displayName> — used by pairAccountLabels to replace the
  // "Chrome Web Store developer properties" label adjacent to each account ID.
  let accountMap = new Map();

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

  function rebuildMap(rawMappings) {
    slugMap = new Map(
      Object.entries(rawMappings || {})
        .filter(([slug, name]) => slug && name)
        .map(([slug, name]) => [slug.trim(), name.trim()])
        .sort((a, b) => b[0].length - a[0].length) // longest slug first
    );
  }

  function rebuildAccountMap(raw) {
    accountMap = new Map(
      Object.entries(raw || {})
        .filter(([id, name]) => id && name)
        .map(([id, name]) => [id.trim(), name.trim()])
    );
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
    if (area !== 'sync') return;
    // Guard against race: listener is registered before init() completes.
    // If observer hasn't been created yet, init() will call replaceAll() itself.
    if (!observer) return;
    let changed = false;
    if (changes.mappings)        { rebuildMap(changes.mappings.newValue);              changed = true; }
    if (changes.accountMappings) { rebuildAccountMap(changes.accountMappings.newValue); changed = true; }
    if (changed) replaceAll();
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
    for (const val of values) {
      if (SLUG_RE.test(val) && !seen.has(val)) {
        slugs.push(val);
        seen.add(val);
      }
    }
    return slugs;
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
    'collection', 'category', '(not set)', '(other)'
  ]);

  const HARVEST_INTERVAL_MS = 5000;
  let lastHarvestAt = 0;

  function reportTitleRows() {
    const rows = [];
    document.querySelectorAll('table.data-table-hover-card').forEach((table) => {
      const trs = Array.from(table.querySelectorAll('tr'));
      const head = (trs[0] && trs[0].textContent || '').toLowerCase();
      if (!/page title|screen class/.test(head)) return;

      trs.slice(1).forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll('th,td'))
          .map(c => (c.textContent || '').trim())
          .filter(Boolean);
        if (!cells.length) return;
        rows.push({
          title: cells[0],
          views: parseInt((cells[1] || '0').replace(/[^\d]/g, ''), 10) || 0
        });
      });
    });
    return rows;
  }

  function extensionNameFromReports() {
    const score = new Map();

    for (const { title, views } of reportTitleRows()) {
      const cut = title.lastIndexOf(' - ');
      if (cut <= 0) continue;
      const name = title.slice(0, cut).trim();
      if (!name || GENERIC_TITLES.has(name.toLowerCase())) continue;
      // +1 so a listing with zero views in the period still counts
      score.set(name, (score.get(name) || 0) + views + 1);
    }

    let best = null;
    for (const [name, total] of score) {
      if (!best || total > best.total) best = { name, total };
    }
    return best ? best.name : null;
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
    const slugs = Array.from(new Set(values.filter(v => SLUG_RE.test(v))));
    if (slugs.length !== 1) return null;

    const name = extensionNameFromReports();
    if (!name) return null;

    return { slug: slugs[0], name };
  }

  function persistNameHint(hint) {
    if (!hint) return;
    chrome.storage.local.get(['nameHints'], (result) => {
      if (chrome.runtime.lastError) return;
      const hints = result.nameHints || {};
      if (hints[hint.slug] === hint.name) return; // unchanged, skip the write
      hints[hint.slug] = hint.name;
      chrome.storage.local.set({ nameHints: hints });
    });
  }

  /**
   * Called from the debounced batch so hints accumulate as the user browses
   * GA4, without the popup ever being opened. Throttled because the batch runs
   * on every React render burst and this walks the page.
   */
  function maybeHarvest() {
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
    chrome.storage.sync.get(['mappings', 'accountMappings'], ({ mappings, accountMappings }) => {
      rebuildMap(mappings);
      rebuildAccountMap(accountMappings);
      initObserver();
      if (slugMap.size > 0 || accountMap.size > 0) replaceAll();
      // GA4 fills its report widgets asynchronously, so the first harvest has
      // to wait for the data to land rather than running at document_idle.
      setTimeout(maybeHarvest, 2500);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
