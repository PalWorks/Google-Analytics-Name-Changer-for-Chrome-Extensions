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

  // ── Popup message handler ──────────────────────────────────────────────────
  // Responds to the popup's request for the current GA4 page context.
  // Returns the account ID from the URL and any unmapped property slugs
  // visible in the DOM, then caches the result for non-GA4-tab sessions.

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action !== 'getGA4Data') return false;

    // Account ID sits in the URL hash as: #a376297388p515458307/...
    // Check window.location.hash first (direct), then fall back to full href.
    // Use a permissive pattern: just 'a' followed by 7+ digits (account IDs are 9 digits).
    const urlForParsing = window.location.hash || window.location.href;
    const accountMatch = urlForParsing.match(/a(\d{7,})/);
    const accountId = accountMatch ? accountMatch[1] : null;

    // Find property slugs visible in the DOM that aren't yet mapped.
    // GA4 property slugs are 20+ character all-lowercase strings.
    const slugs = [];
    const seen = new Set(slugMap.keys());
    const slugWalker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const tag = node.parentElement && node.parentElement.tagName;
          return SKIP_TAGS.has(tag) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let sn;
    while ((sn = slugWalker.nextNode())) {
      const val = sn.nodeValue && sn.nodeValue.trim();
      if (val && /^[a-z]{20,}$/.test(val) && !seen.has(val)) {
        slugs.push(val);
        seen.add(val);
      }
    }

    // Cache detected context so the popup can show it on non-GA4 tabs
    chrome.storage.local.set({ lastGA4Context: { accountId, slugs } });

    sendResponse({ accountId, slugs });
    return true;
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  function init() {
    chrome.storage.sync.get(['mappings', 'accountMappings'], ({ mappings, accountMappings }) => {
      rebuildMap(mappings);
      rebuildAccountMap(accountMappings);
      initObserver();
      if (slugMap.size > 0 || accountMap.size > 0) replaceAll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
