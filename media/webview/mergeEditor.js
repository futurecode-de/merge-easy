/**
 * mergeEditor.js
 * Full-file view: line numbers, word-level diff, SVG ribbon connectors,
 * scroll-sync, editable RESULT panel.
 *
 * (c) 2026 FUTURE[code] - Markus Feilen
 */
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // ── i18n ───────────────────────────────────────────────────────────────────
  let T = {}; // populated from state.i18n on first message
  /** Look up a translation key; fall back to the key itself */
  function t(key) { return T[key] || key; }
  /** Look up with {placeholder} substitution */
  function tf(key, vars) {
    let s = T[key] || key;
    if (vars) { Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); }); }
    return s;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let state         = null;
  let activeIndex   = 0;
  let editingIndex  = null;
  let detectedLang  = 'plaintext';
  let showContext   = true;
  const editBuffer  = new Map();

  // Bulk-accept lock: derived from the current state — if every resolved hunk
  // shares the same kind ('ours' or 'theirs'), the file is effectively in a
  // bulk-LOCAL or bulk-REMOTE state regardless of how it got there (button
  // click, Alt-arrow per hunk, or any combination). The opposite bulk button
  // is disabled and "Undo bulk" reverts every hunk of that kind in one click.
  function deriveBulkState() {
    if (!state) { return { kind: null, indices: new Set() }; }
    const resolved = state.hunks
      .map((h, i) => ({ h, i }))
      .filter(x => x.h.resolved);
    if (resolved.length === 0) { return { kind: null, indices: new Set() }; }
    const firstKind = resolved[0].h.resolutionKind;
    const sameKind  = resolved.every(x => x.h.resolutionKind === firstKind);
    if (sameKind && (firstKind === 'ours' || firstKind === 'theirs')) {
      return { kind: firstKind, indices: new Set(resolved.map(x => x.i)) };
    }
    return { kind: null, indices: new Set() };
  }

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $  = id => document.getElementById(id);
  const elFileName    = $('file-name');
  const elBadge       = $('conflict-badge');
  const elNavLabel    = $('nav-label');
  const elBtnPrev     = $('btn-prev');
  const elBtnNext     = $('btn-next');
  const elBtnNonConf  = $('btn-apply-nonconflicting');
  const elBtnAcceptAllLocal  = $('btn-accept-all-local');
  const elBtnAcceptAllRemote = $('btn-accept-all-remote');
  const elBtnUndoBulk        = $('btn-undo-bulk');
  const elBtnApply    = $('btn-apply');
  const elBtnToggle   = $('btn-toggle-context');
  const elLabelOurs   = $('label-ours');
  const elLabelTheirs = $('label-theirs');
  const elResultStatus= $('result-status');
  const elOurs        = $('content-ours');
  const elResult      = $('content-result');
  const elTheirs      = $('content-theirs');

  // ── Scroll-sync (anchor-based) ────────────────────────────────────────────
  //
  // Instead of locking all panels to the same scroll percentage (which
  // distorts ribbons when panels have different heights), we pick the
  // conflict block nearest to the scrolling panel's vertical midpoint as
  // an "anchor" and position every other panel so that the same anchor
  // block sits at the same viewport-Y.  This keeps ribbons straight for
  // whatever conflict is currently centred on screen.
  //
  let scrollLock = false;

  function syncScrollFrom(src) {
    if (scrollLock) { return; }
    scrollLock = true;

    const panels   = [elOurs, elResult, elTheirs];
    const srcRect  = src.getBoundingClientRect();
    const midY     = srcRect.height / 2;

    // Find the conflict block whose centre is closest to this panel's midpoint
    let anchorEl = null, anchorIdx = -1, anchorDist = Infinity;
    if (state) {
      state.hunks.forEach((_, idx) => {
        const b = src.querySelector(`.conflict-block[data-index="${idx}"]`);
        if (!b) { return; }
        const br   = b.getBoundingClientRect();
        const dist = Math.abs((br.top + br.bottom) / 2 - srcRect.top - midY);
        if (dist < anchorDist) { anchorDist = dist; anchorEl = b; anchorIdx = idx; }
      });
    }

    if (anchorEl) {
      // Viewport-Y of the anchor block's top edge inside the source panel
      const anchorViewTop = anchorEl.getBoundingClientRect().top - srcRect.top;

      panels.forEach(p => {
        if (p === src) { return; }
        const target = p.querySelector(`.conflict-block[data-index="${anchorIdx}"]`);
        if (!target) { return; }
        const pr = p.getBoundingClientRect();
        // Absolute offset of target block inside its scroll container
        const targetDocTop = target.getBoundingClientRect().top - pr.top + p.scrollTop;
        p.scrollTop = Math.max(0, targetDocTop - anchorViewTop);
      });
    } else {
      // No conflict blocks on screen – fall back to percentage sync
      const pct = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
      panels.forEach(p => {
        if (p === src) { return; }
        p.scrollTop = pct * Math.max(1, p.scrollHeight - p.clientHeight);
      });
    }

    requestAnimationFrame(() => {
      scrollLock = false;
      drawConnectors();
    });
  }

  [elOurs, elResult, elTheirs].forEach(panel => {
    panel.addEventListener('scroll', () => syncScrollFrom(panel), { passive: true });
  });

  // Redraw ribbons whenever the panels are resized — covers cases where
  // drawConnectors's render+scroll triggers don't fire: the welcome tab
  // closing, the side bar being toggled, the splitter being dragged, etc.
  if (typeof ResizeObserver !== 'undefined') {
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      if (resizeRaf) { return; }
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        drawConnectors();
      });
    });
    [document.getElementById('panels-container'), elOurs, elResult, elTheirs]
      .filter(Boolean)
      .forEach(node => ro.observe(node));
  }
  // Window resize as a fallback for hosts without ResizeObserver and for
  // outer layout shifts (e.g. window itself resized).
  window.addEventListener('resize', () => requestAnimationFrame(drawConnectors), { passive: true });

  // ── Messages ───────────────────────────────────────────────────────────────
  window.addEventListener('message', ({ data }) => {
    if (data.type !== 'init' && data.type !== 'fileUpdated') { return; }
    state = data.payload;
    T = state.i18n || {};
    detectedLang = langFromFilename(state.fileName);
    if (activeIndex >= state.hunks.length) {
      activeIndex = Math.max(0, state.hunks.length - 1);
    }
    render();
  });

  // ── Toolbar ────────────────────────────────────────────────────────────────
  elBtnPrev.addEventListener('click', () => navigate(-1));
  elBtnNext.addEventListener('click', () => navigate(+1));

  elBtnNonConf.addEventListener('click', () => {
    if (!state) { return; }
    state.hunks.forEach((h, i) => {
      if (h.resolved) { return; }
      if (h.ours.length === 0 && h.theirs.length > 0) { sendResolve(i, { kind: 'theirs' }); }
      else if (h.theirs.length === 0 && h.ours.length > 0) { sendResolve(i, { kind: 'ours' }); }
    });
  });

  elBtnAcceptAllLocal.addEventListener('click', () => {
    if (!state) { return; }
    const updates = [];
    state.hunks.forEach((h, i) => {
      if (!h.resolved && h.ours.length > 0) {
        updates.push({ hunkIndex: i, resolution: { kind: 'ours' } });
      }
    });
    if (updates.length > 0) { sendResolveBulk(updates); }
  });

  elBtnAcceptAllRemote.addEventListener('click', () => {
    if (!state) { return; }
    const updates = [];
    state.hunks.forEach((h, i) => {
      if (!h.resolved && h.theirs.length > 0) {
        updates.push({ hunkIndex: i, resolution: { kind: 'theirs' } });
      }
    });
    if (updates.length > 0) { sendResolveBulk(updates); }
  });

  elBtnUndoBulk.addEventListener('click', () => {
    if (!state) { return; }
    const { indices } = deriveBulkState();
    if (indices.size === 0) { return; }
    sendResolveBulk([...indices].map(i => ({ hunkIndex: i, resolution: null })));
  });

  elBtnApply.addEventListener('click', () => vscode.postMessage({ type: 'applyAndSave' }));

  elBtnToggle.addEventListener('click', () => {
    showContext = !showContext;
    elBtnToggle.textContent = showContext ? t('btn.hideContext') : t('btn.showContext');
    document.getElementById('panels-container').classList.toggle('hide-context', !showContext);
    requestAnimationFrame(drawConnectors);
  });

  document.addEventListener('keydown', e => {
    if (e.target && e.target.isContentEditable) { return; }
    if (!e.altKey) { return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); navigate(-1); }
    if (e.key === 'ArrowDown')  { e.preventDefault(); navigate(+1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); sendResolve(activeIndex, { kind: 'ours' }); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); sendResolve(activeIndex, { kind: 'theirs' }); }
  });

  function navigate(dir) {
    if (!state || !state.hunks.length) { return; }
    const next = Math.max(0, Math.min(state.hunks.length - 1, activeIndex + dir));
    if (next !== activeIndex) {
      activeIndex = next;
      render();
    }
    // Scroll to the (possibly unchanged) active block so single-conflict files
    // still respond to next/prev with a visible jump.
    scrollToActive();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORD-LEVEL DIFF
  // ═══════════════════════════════════════════════════════════════════════════

  /** Escape HTML special characters */
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Syntax-highlight a single line of code using the detected language.
   * Falls back to plain escHtml when hljs is unavailable or the language
   * is unknown/plaintext.
   */
  function hljsLine(text) {
    if (typeof hljs === 'undefined' || detectedLang === 'plaintext') {
      return escHtml(text);
    }
    try {
      return hljs.highlight(text, { language: detectedLang }).value;
    } catch (_) {
      return escHtml(text);
    }
  }

  /**
   * Tokenize a string into word-tokens and separator-tokens so that every
   * character is represented exactly once.
   */
  function tokenize(str) {
    return str.split(/(\w+)/).filter(t => t.length > 0);
  }

  /**
   * Myers / LCS diff on arbitrary arrays.
   * Returns [{op:'equal'|'delete'|'insert', val}]
   * Caps at 300 items per side to stay responsive.
   */
  function lcsOps(a, b) {
    const m = a.length, n = b.length;
    if (m === 0 && n === 0) { return []; }

    // Fallback for very large inputs
    if (m > 300 || n > 300) {
      return [
        ...a.map(v => ({ op: 'delete', val: v })),
        ...b.map(v => ({ op: 'insert', val: v })),
      ];
    }

    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && a[i] === b[j]) {
        ops.push({ op: 'equal',  val: a[i] }); i++; j++;
      } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
        ops.push({ op: 'insert', val: b[j] }); j++;
      } else {
        ops.push({ op: 'delete', val: a[i] }); i++;
      }
    }
    return ops;
  }

  /**
   * Build HTML for a single line with changed tokens wrapped in
   * <span class="word-changed">…</span>.
   * `line` is the line being rendered; `otherLine` is the counterpart
   * on the opposite side.
   */
  function buildWordDiffHtml(line, otherLine) {
    if (!otherLine || line === otherLine) { return escHtml(line); }

    const tokA = tokenize(line);
    const tokB = tokenize(otherLine);
    const ops  = lcsOps(tokA, tokB);

    let html = '';
    for (const op of ops) {
      if (op.op === 'equal') {
        html += escHtml(op.val);
      } else if (op.op === 'delete') {
        // token present in this side (line), absent/changed on other side → highlight
        html += `<span class="word-changed">${escHtml(op.val)}</span>`;
      }
      // 'insert' tokens belong to the other side; they don't appear in 'line'
    }
    return html;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALIGNED ROW DIFF  (phantom-line model)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * LCS-based line alignment.  Returns rows of type:
   *   'equal'       – identical on both sides
   *   'replace'     – both sides have a line, content differs  (modification)
   *   'ours-only'   – line in LOCAL only  (REMOTE deleted it)
   *   'theirs-only' – line in REMOTE only (LOCAL deleted it)
   *
   * Consecutive delete+insert runs are paired as 'replace'; left-over
   * unpaired lines become 'ours-only' / 'theirs-only'.
   */
  function computeAlignedRows(oursLines, theirsLines) {
    const rawOps = lcsOps(oursLines, theirsLines);
    const rows   = [];
    let i = 0;
    while (i < rawOps.length) {
      if (rawOps[i].op === 'equal') {
        rows.push({ type: 'equal', ours: rawOps[i].val, theirs: rawOps[i].val });
        i++;
      } else {
        const dels = [], ins = [];
        while (i < rawOps.length && rawOps[i].op === 'delete') { dels.push(rawOps[i++].val); }
        while (i < rawOps.length && rawOps[i].op === 'insert') { ins.push(rawOps[i++].val); }
        const pairCount = Math.min(dels.length, ins.length);
        for (let p = 0; p < pairCount; p++) {
          rows.push({ type: 'replace',    ours: dels[p], theirs: ins[p] });
        }
        for (let p = pairCount; p < dels.length; p++) {
          rows.push({ type: 'ours-only',  ours: dels[p] });
        }
        for (let p = pairCount; p < ins.length; p++) {
          rows.push({ type: 'theirs-only', theirs: ins[p] });
        }
      }
    }
    return rows;
  }

  /** Helper: append a code-line div with innerHTML */
  function addCodeLine(container, cls, html) {
    const d = el('div', 'code-line ' + cls);
    d.innerHTML = html;
    container.appendChild(d);
  }

  /**
   * Build the LOCAL or REMOTE panel from aligned rows.
   * Real lines show word-diff highlights; absent lines show a thin phantom marker.
   */
  function buildAlignedPanel(rows, startLine, panelSide) {
    const wrap   = el('div', 'code-with-gutter');
    const gutter = el('div', 'line-gutter');
    const cont   = el('div', 'code-lines-container');
    const isOurs = panelSide === 'ours';
    let gut = '', ln = startLine;

    for (const row of rows) {
      if (row.type === 'equal') {
        addCodeLine(cont, 'line-equal', hljsLine(row.ours));
        gut += (ln++) + '\n';
      } else if (row.type === 'replace') {
        const line  = isOurs ? row.ours   : row.theirs;
        const other = isOurs ? row.theirs : row.ours;
        addCodeLine(cont, 'line-modified', buildWordDiffHtml(line, other));
        gut += (ln++) + '\n';
      } else if (row.type === 'ours-only') {
        if (isOurs) {
          // This panel has the line, no counterpart on the other side
          addCodeLine(cont, 'line-modified', `<span class="word-changed">${hljsLine(row.ours)}</span>`);
          gut += (ln++) + '\n';
        }
        // Absent side: nothing rendered (no phantom line)
      } else { // theirs-only
        if (!isOurs) {
          addCodeLine(cont, 'line-modified', `<span class="word-changed">${hljsLine(row.theirs)}</span>`);
          gut += (ln++) + '\n';
        }
        // Absent side: nothing rendered (no phantom line)
      }
    }

    gutter.textContent = gut.trimEnd();
    wrap.appendChild(gutter);
    wrap.appendChild(cont);
    return wrap;
  }

  /**
   * Build the RESULT center panel for an unresolved true conflict.
   *
   * Row-level colouring — these classes never overlap:
   *   equal       → neutral/dim
   *   replace     → LOCAL line (blue) immediately followed by REMOTE line (green)
   *   ours-only   → red  (REMOTE deleted this LOCAL line)
   *   theirs-only → red  (LOCAL deleted this REMOTE line)
   */
  function buildResultCenterPanel(rows, startLine) {
    const wrap   = el('div', 'code-with-gutter');
    const gutter = el('div', 'line-gutter');
    const cont   = el('div', 'code-lines-container');
    let gut = '', ln = startLine;

    for (const row of rows) {
      if (row.type === 'equal') {
        // Unchanged on both sides → neutral/dim + syntax highlight
        addCodeLine(cont, 'line-equal', hljsLine(row.ours));
        gut += (ln++) + '\n';

      } else if (row.type === 'replace') {
        // KOLLISION – word-diff shows what changed; no hljs (would conflict with word-changed spans)
        addCodeLine(cont, 'line-result-conflict line-result-conflict-ours',
          buildWordDiffHtml(row.ours, row.theirs));
        gut += (ln++) + '\n';
        addCodeLine(cont, 'line-result-conflict line-result-conflict-theirs',
          buildWordDiffHtml(row.theirs, row.ours));
        gut += '\u00a0\n';

      } else if (row.type === 'ours-only') {
        // LOCAL addition → BLUE + syntax highlight
        addCodeLine(cont, 'line-result-ours', hljsLine(row.ours));
        gut += (ln++) + '\n';

      } else { // theirs-only
        // Will be DELETED from result → RED + syntax highlight
        addCodeLine(cont, 'line-result-deleted', hljsLine(row.theirs));
        gut += '\u00a0\n';
      }
    }

    gutter.textContent = gut.trimEnd();
    wrap.appendChild(gutter);
    wrap.appendChild(cont);
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SVG RIBBON CONNECTORS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Draw bezier-trapezoid ribbons connecting corresponding conflict blocks
   * across the three panels.  Called after every render and scroll event.
   */
  function drawConnectors() {
    const svg = $('connector-svg');
    if (!svg || !state) { return; }

    svg.innerHTML = '';

    const panelsEl = $('panels-container');
    const cRect    = panelsEl.getBoundingClientRect();

    state.hunks.forEach((hunk, i) => {
      const oursBlock   = elOurs.querySelector(`.conflict-block[data-index="${i}"]`);
      const resultBlock = elResult.querySelector(`.conflict-block[data-index="${i}"]`);
      const theirsBlock = elTheirs.querySelector(`.conflict-block[data-index="${i}"]`);

      const active  = i === activeIndex;
      const baseOpa = active ? 0.48 : 0.28;

      // Deletion metadata stored on resultBlock during renderConflict
      const hasOursOnly   = resultBlock ? resultBlock.dataset.hasOursOnly   === 'true' : false;
      const hasTheirsOnly = resultBlock ? resultBlock.dataset.hasTheirsOnly === 'true' : false;

      // ── Left ribbon: LOCAL → RESULT ──────────────────────────────────────
      if (oursBlock && resultBlock && hunk.ours.length > 0) {
        const r1 = oursBlock.getBoundingClientRect();
        const r2 = resultBlock.getBoundingClientRect();
        if (hunk.isNonConflicting && hunk.nonConflictingSide === 'ours') {
          appendRibbon(svg, cRect, r1.right, r1.top, r1.bottom,
                                   r2.left,  r2.top, r2.bottom, '#43698D', baseOpa);
        } else if (!hunk.isNonConflicting) {
          // Purple for unresolved conflict, green for resolved
          const color = hunk.resolved ? '#2a7a2a' : '#7a4a9a';
          appendRibbon(svg, cRect, r1.right, r1.top, r1.bottom,
                                   r2.left,  r2.top, r2.bottom, color, baseOpa);
          // Thin dashed red line: LOCAL deleted some REMOTE lines (theirs-only → red in center)
          if (!hunk.resolved && hasTheirsOnly) {
            const midY = (r2.top + r2.bottom) / 2;
            appendDeletionLine(svg, cRect, r1.right, midY, r2.left, midY, '#B63B50');
          }
        }
        // theirs-only non-conflicting → ours block neutral, no ribbon
      }

      // ── Right ribbon: RESULT → REMOTE ────────────────────────────────────
      if (resultBlock && theirsBlock && hunk.theirs.length > 0) {
        const r2 = resultBlock.getBoundingClientRect();
        const r3 = theirsBlock.getBoundingClientRect();
        if (hunk.isNonConflicting && hunk.nonConflictingSide === 'theirs') {
          appendRibbon(svg, cRect, r2.right, r2.top, r2.bottom,
                                   r3.left,  r3.top, r3.bottom, '#447152', baseOpa);
        } else if (!hunk.isNonConflicting) {
          const color = hunk.resolved ? '#2a7a2a' : '#7a4a9a';
          appendRibbon(svg, cRect, r2.right, r2.top, r2.bottom,
                                   r3.left,  r3.top, r3.bottom, color, baseOpa);
          // Thin dashed red line: REMOTE deleted some LOCAL lines (theirs-only → red in center)
          if (!hunk.resolved && hasOursOnly) {
            const midY = (r2.top + r2.bottom) / 2;
            appendDeletionLine(svg, cRect, r2.right, midY, r3.left, midY, '#B63B50');
          }
        }
        // ours-only non-conflicting → theirs block neutral, no ribbon
      }
    });
  }

  /**
   * Create and append one bezier-trapezoid ribbon path to the SVG.
   * All coordinates are in viewport space; this function converts them
   * to container-relative space.
   */
  function appendRibbon(svg, cRect, x1, y1t, y1b, x2, y2t, y2b, color, opacity) {
    // Container-relative coords
    const rx1  = x1  - cRect.left;
    const ry1t = y1t - cRect.top;
    const ry1b = y1b - cRect.top;
    const rx2  = x2  - cRect.left;
    const ry2t = y2t - cRect.top;
    const ry2b = y2b - cRect.top;

    // Skip entirely off-screen ribbons
    const visTop = 0, visBot = cRect.height;
    if (ry1b < visTop && ry2b < visTop) { return; }
    if (ry1t > visBot && ry2t > visBot) { return; }

    const cx = (rx2 - rx1) * 0.55; // control-point x offset (slight S-curve)

    const d = [
      `M${rx1},${ry1t}`,
      `C${rx1 + cx},${ry1t} ${rx2 - cx},${ry2t} ${rx2},${ry2t}`,
      `L${rx2},${ry2b}`,
      `C${rx2 - cx},${ry2b} ${rx1 + cx},${ry1b} ${rx1},${ry1b}`,
      'Z',
    ].join(' ');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', color);
    path.setAttribute('fill-opacity', String(opacity));
    svg.appendChild(path);
  }

  /**
   * Draw a thin dashed bezier line (no fill) to indicate which side deleted
   * the lines that appear as red blocks in the RESULT panel.
   */
  function appendDeletionLine(svg, cRect, x1, y1, x2, y2, color) {
    const rx1 = x1 - cRect.left;
    const ry1 = y1 - cRect.top;
    const rx2 = x2 - cRect.left;
    const ry2 = y2 - cRect.top;

    if (ry1 < 0 && ry2 < 0) { return; }
    if (ry1 > cRect.height && ry2 > cRect.height) { return; }

    const cx = (rx2 - rx1) * 0.55;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${rx1},${ry1} C${rx1+cx},${ry1} ${rx2-cx},${ry2} ${rx2},${ry2}`);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-dasharray', '5,3');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-opacity', '0.75');
    svg.appendChild(path);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  function render() {
    if (!state) { return; }
    if (editingIndex !== null) { return; }

    // Header
    elFileName.textContent    = state.fileName;
    elLabelOurs.textContent   = state.oursLabel   || 'LOCAL';
    elLabelTheirs.textContent = state.theirsLabel || 'REMOTE';

    const unresolved = state.hunks.filter(h => !h.resolved).length;
    elBadge.textContent = unresolved === 0
      ? t('badge.allResolved')
      : `${unresolved} / ${state.totalConflicts} conflict${unresolved !== 1 ? 's' : ''}`;
    elBadge.className = 'badge ' + (unresolved === 0 ? 'ok' : 'warn');
    elResultStatus.textContent = unresolved === 0
      ? t('status.readyToApply')
      : tf('status.unresolved', { count: unresolved }) || `${unresolved} unresolved`;

    elNavLabel.textContent = state.hunks.length
      ? `${activeIndex + 1} / ${state.hunks.length}` : '–';
    elBtnPrev.disabled = state.hunks.length === 0;
    elBtnNext.disabled = state.hunks.length === 0;

    const anyUnresolved = state.hunks.some(h => !h.resolved);
    const { kind: bulkKind } = deriveBulkState();
    elBtnAcceptAllLocal.disabled  = !anyUnresolved || bulkKind === 'theirs';
    elBtnAcceptAllRemote.disabled = !anyUnresolved || bulkKind === 'ours';
    elBtnUndoBulk.hidden = bulkKind === null;

    elOurs.innerHTML   = '';
    elResult.innerHTML = '';
    elTheirs.innerHTML = '';

    // Line number counters (per panel)
    let lineOurs = 1, lineResult = 1, lineTheirs = 1;

    for (const section of state.sections) {
      if (section.kind === 'context') {
        renderContext(section, lineOurs, lineResult, lineTheirs);
        const n = section.lines.length;
        lineOurs   += n;
        lineResult += n;
        lineTheirs += n;
      } else {
        const hunk = state.hunks[section.hunkIndex];
        renderConflict(hunk, section.hunkIndex, lineOurs, lineResult, lineTheirs);
        lineOurs   += hunk.ours.length;
        lineTheirs += hunk.theirs.length;
        lineResult += resolvedLines(hunk).length;
      }
    }

    requestAnimationFrame(() => {
      applyHighlighting();
      drawConnectors();
    });
  }

  // ── Context section ────────────────────────────────────────────────────────
  function renderContext(section, lineOurs, lineResult, lineTheirs) {
    const code = section.lines.join('\n');

    elOurs.appendChild(
      makeSection('context-section', makeCodeWithNumbers(code, lineOurs,   'ctx-code highlightable'))
    );
    elResult.appendChild(
      makeSection('context-section', makeCodeWithNumbers(code, lineResult, 'ctx-code highlightable'))
    );
    elTheirs.appendChild(
      makeSection('context-section', makeCodeWithNumbers(code, lineTheirs, 'ctx-code highlightable'))
    );
  }

  // ── Conflict section ───────────────────────────────────────────────────────
  function renderConflict(hunk, i, lineOurs, lineResult, lineTheirs) {
    const active  = i === activeIndex;
    const nonConf = hunk.isNonConflicting;
    const side    = hunk.nonConflictingSide; // 'ours' | 'theirs' | undefined

    const oursClass   = nonConf && side === 'theirs' ? 'nc-neutral'  : 'nc-ours';
    const theirsClass = nonConf && side === 'ours'   ? 'nc-neutral'  : 'nc-theirs';
    const resultClass = nonConf
      ? (side === 'ours' ? 'nc-result-ours' : 'nc-result-theirs')
      : (hunk.resolved ? 'nc-result-resolved' : 'nc-result-conflict');

    // Should we render word diff?  Only when both sides have content and
    // this is a true conflict (non-conflicting blocks already differ entirely).
    const useWordDiff = !nonConf && hunk.ours.length > 0 && hunk.theirs.length > 0;
    // Pre-compute aligned rows once; reused across all three panels.
    const rows = useWordDiff ? computeAlignedRows(hunk.ours, hunk.theirs) : null;

    // ── LOCAL panel ───────────────────────────────────────────────────────
    const oursWrap = el('div',
      `conflict-block ${oursClass}${active ? ' active' : ''}${hunk.resolved ? ' resolved' : ''}`);
    oursWrap.dataset.index = i;
    oursWrap.addEventListener('click', () => { activeIndex = i; render(); });

    if (useWordDiff) {
      oursWrap.appendChild(buildAlignedPanel(rows, lineOurs, 'ours'));
    } else if (hunk.ours.length > 0) {
      oursWrap.appendChild(makeCodeWithNumbers(hunk.ours.join('\n'), lineOurs, 'ours-code highlightable'));
    } else {
      oursWrap.appendChild(emptyPlaceholder());
    }

    const oursActions = el('div', 'block-actions right-actions');
    if (!hunk.resolved) {
      if (hunk.ours.length > 0) {
        oursActions.appendChild(arrowBtn('→', 'btn-accept-ours', t('btn.acceptLocal'), () => sendResolve(i, { kind: 'ours' })));
        if (hunk.theirs.length > 0) {
          oursActions.appendChild(arrowBtn('⇉', 'btn-both', t('btn.bothLocalFirst'), () => sendResolve(i, { kind: 'both' })));
        }
      }
    } else {
      oursActions.appendChild(undoBtn(i));
    }
    oursWrap.appendChild(oursActions);
    elOurs.appendChild(oursWrap);

    // ── RESULT panel ──────────────────────────────────────────────────────
    const resultWrap = el('div',
      `conflict-block ${resultClass}${active ? ' active' : ''}`);
    resultWrap.dataset.index = i;
    resultWrap.addEventListener('click', () => { activeIndex = i; render(); });

    if (!hunk.resolved) {
      if (useWordDiff) {
        // Row-level colouring: blue=LOCAL changes, green=REMOTE changes, red=deletions.
        // Store flags so drawConnectors can draw thin deletion-side ribbon lines.
        resultWrap.dataset.hasOursOnly   = String(rows.some(r => r.type === 'ours-only'));
        resultWrap.dataset.hasTheirsOnly = String(rows.some(r => r.type === 'theirs-only'));
        resultWrap.appendChild(buildResultCenterPanel(rows, lineResult));
      } else {
        if (hunk.ours.length > 0) {
          const oursSection = el('div', 'result-preview-ours-section');
          oursSection.appendChild(makeCodeWithNumbers(hunk.ours.join('\n'), lineResult, 'ctx-code'));
          resultWrap.appendChild(oursSection);
          if (hunk.theirs.length > 0) { resultWrap.appendChild(divider(t('divider'))); }
        }
        if (hunk.theirs.length > 0) {
          const sl = hunk.ours.length > 0 ? lineResult + hunk.ours.length : lineResult;
          const theirsSection = el('div', 'result-preview-theirs-section');
          theirsSection.appendChild(makeCodeWithNumbers(hunk.theirs.join('\n'), sl, 'ctx-code'));
          resultWrap.appendChild(theirsSection);
        }
        if (hunk.ours.length === 0 && hunk.theirs.length === 0) {
          resultWrap.appendChild(emptyPlaceholder());
        }
      }
    } else {
      // Editable resolved content
      const lines = resolvedLines(hunk);
      const text  = editBuffer.has(i) ? editBuffer.get(i) : lines.join('\n');
      const preWrap = el('div', 'result-edit-wrap');
      const pre = el('pre', 'code-block result-editable highlightable');
      pre.contentEditable = 'true';
      pre.spellcheck      = false;
      pre.dataset.index   = i;
      pre.textContent     = text || '';
      pre.addEventListener('focus', e => {
        e.stopPropagation();
        editingIndex = i;
        activeIndex  = i;
        pre.textContent = pre.textContent; // strip any spans
      });
      pre.addEventListener('input', () => { editBuffer.set(i, pre.textContent || ''); });
      pre.addEventListener('blur', () => {
        const t = editBuffer.get(i) ?? pre.textContent ?? '';
        editBuffer.delete(i);
        editingIndex = null;
        sendResolve(i, { kind: 'custom', text: t });
      });
      pre.addEventListener('click', e => e.stopPropagation());
      const badge = el('div', 'result-badge');
      badge.textContent = labelFor(hunk.resolutionKind);
      const hint = el('div', 'edit-hint');
      hint.textContent = t('editHint') || 'Click to edit';
      preWrap.appendChild(pre);
      resultWrap.appendChild(preWrap);
      resultWrap.appendChild(badge);
      resultWrap.appendChild(hint);
      // Focus the editable when clicking anywhere on the resolved result block
      resultWrap.addEventListener('click', e => {
        if (e.target === resultWrap || e.target === badge || e.target === hint) {
          pre.focus();
          // Place cursor at end
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(pre);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    }
    elResult.appendChild(resultWrap);

    // ── REMOTE panel ──────────────────────────────────────────────────────
    const theirsWrap = el('div',
      `conflict-block ${theirsClass}${active ? ' active' : ''}${hunk.resolved ? ' resolved' : ''}`);
    theirsWrap.dataset.index = i;
    theirsWrap.addEventListener('click', () => { activeIndex = i; render(); });

    const theirsActions = el('div', 'block-actions left-actions');
    if (!hunk.resolved) {
      if (hunk.theirs.length > 0) {
        if (hunk.ours.length > 0) {
          theirsActions.appendChild(arrowBtn('⇇', 'btn-both', t('btn.bothRemoteFirst'), () => sendResolve(i, { kind: 'both-reversed' })));
        }
        theirsActions.appendChild(arrowBtn('←', 'btn-accept-theirs', t('btn.acceptRemote'), () => sendResolve(i, { kind: 'theirs' })));
      }
    } else {
      theirsActions.appendChild(undoBtn(i));
    }
    theirsWrap.appendChild(theirsActions);

    if (useWordDiff) {
      theirsWrap.appendChild(buildAlignedPanel(rows, lineTheirs, 'theirs'));
    } else if (hunk.theirs.length > 0) {
      theirsWrap.appendChild(makeCodeWithNumbers(hunk.theirs.join('\n'), lineTheirs, 'theirs-code highlightable'));
    } else {
      theirsWrap.appendChild(emptyPlaceholder());
    }

    elTheirs.appendChild(theirsWrap);
  }

  // ── Code + line numbers (plain, for context + RESULT preview) ─────────────
  function makeCodeWithNumbers(code, startLine, codeClass) {
    const wrap = el('div', 'code-with-gutter');

    const lineCount = (code.match(/\n/g) || []).length + 1;
    const gutter    = el('div', 'line-gutter');
    let   nums = '';
    for (let n = startLine; n < startLine + lineCount; n++) { nums += n + '\n'; }
    gutter.textContent = nums.slice(0, -1);

    const pre = el('pre', 'code-block ' + (codeClass || ''));
    pre.textContent = code || '';

    wrap.appendChild(gutter);
    wrap.appendChild(pre);
    return wrap;
  }

  function makeSection(cls, child) {
    const sec = el('div', cls);
    sec.appendChild(child);
    return sec;
  }

  function divider(label) {
    const d = el('div', 'conflict-divider');
    d.textContent = label || '';
    return d;
  }

  function emptyPlaceholder() {
    const d = el('div', 'empty-placeholder');
    d.textContent = t('empty');
    return d;
  }

  // ── Syntax highlighting (context sections only) ────────────────────────────
  function applyHighlighting() {
    if (typeof hljs === 'undefined') { return; }
    document.querySelectorAll('pre.highlightable').forEach(pre => {
      delete pre.dataset.highlighted;
      pre.className = pre.className.replace(/\blanguage-\S+/g, '').trim();
      pre.classList.add('language-' + detectedLang);
      try { hljs.highlightElement(pre); } catch (_) { /* ignore */ }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) { e.className = cls.trim(); }
    return e;
  }

  function arrowBtn(symbol, cls, title, onClick) {
    const btn = el('button', 'arrow-btn ' + cls);
    btn.textContent = symbol;
    btn.title = title;
    btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    return btn;
  }

  function undoBtn(i) {
    const btn = el('button', 'arrow-btn btn-undo');
    btn.textContent = '↩';
    btn.title = t('btn.undo');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      editBuffer.delete(i);
      sendResolve(i, null);
    });
    return btn;
  }

  function resolvedLines(hunk) {
    if (!hunk.resolved) { return hunk.ours.length ? hunk.ours : hunk.theirs; }
    if (hunk.resolutionKind === 'custom') { return (hunk.resolutionText || '').split('\n'); }
    switch (hunk.resolutionKind) {
      case 'ours':          return hunk.ours;
      case 'theirs':        return hunk.theirs;
      case 'both':          return [...hunk.ours, ...hunk.theirs];
      case 'both-reversed': return [...hunk.theirs, ...hunk.ours];
      default:              return hunk.ours;
    }
  }

  function labelFor(kind) {
    const map = {
      ours:           t('resolution.local'),
      theirs:         t('resolution.remote'),
      both:           t('resolution.both'),
      'both-reversed':t('resolution.bothReversed'),
      custom:         t('resolution.custom'),
    };
    return map[kind] || '✓';
  }

  function sendResolve(index, resolution) {
    vscode.postMessage({ type: 'resolve', hunkIndex: index, resolution });
  }

  function sendResolveBulk(updates) {
    vscode.postMessage({ type: 'resolveBulk', updates });
  }

  function scrollToActive() {
    const first = elOurs.querySelector('.conflict-block.active');
    if (!first) { return; }
    first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    requestAnimationFrame(drawConnectors);
  }

  function langFromFilename(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    return {
      php:'php', js:'javascript', ts:'typescript', jsx:'javascript',
      tsx:'typescript', py:'python', java:'java', css:'css', html:'xml',
      xml:'xml', json:'json', sh:'bash', bash:'bash', sql:'sql', go:'go',
      rb:'ruby', rs:'rust', yml:'yaml', yaml:'yaml', md:'markdown',
    }[ext] || 'plaintext';
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  vscode.postMessage({ type: 'ready' });
})();
