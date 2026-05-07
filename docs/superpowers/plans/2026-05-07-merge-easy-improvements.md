# Merge Easy: Bug Fixes and Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs (navigation arrows with single conflict; EISDIR on directory context menu) and add two features (bulk-accept toolbar buttons; Activity-Bar sidebar listing files with merge conflicts).

**Architecture:** All work is contained in the existing VSCode-extension codebase. The two bugs are surgical fixes to existing code paths. The bulk-accept buttons reuse the existing per-hunk `resolve` message pipeline. The sidebar is a new `TreeDataProvider` that consumes the built-in VSCode Git extension API (`vscode.git`, `getAPI(1)`) and reuses the existing `intellij-merge.openMergeEditor` command.

**Tech Stack:** TypeScript (strict, ES2020, CommonJS), VSCode Extension API ≥1.74, plain webview JS. No new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-05-07-merge-easy-improvements-design.md](../specs/2026-05-07-merge-easy-improvements-design.md)

**Verification model:** This project has no automated test infrastructure. All verification is manual via the Extension Development Host (`F5` in VSCode). Each task ends with concrete reproducible verification steps. Where pure logic is testable in isolation, the plan calls it out — otherwise rely on the EDH steps. Do not add a test framework as part of this plan; that is a separate decision.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `media/webview/mergeEditor.js` | Modify | Webview UI: fix nav button enable logic + `navigate()` early return; wire two new toolbar buttons |
| `src/mergePanel.ts` | Modify | Add two new buttons to `_buildHtml()` toolbar |
| `package.json` | Modify | Tighten `explorer/context` `when` clause; declare new `viewsContainers`, `views`, `viewsWelcome`, `commands`, `menus`, `activationEvents` |
| `src/extension.ts` | Modify | Runtime `isFile()` guard in `openMergeEditor`; register `ConflictsViewProvider`, `mergeEasy.refreshConflicts`, `mergeEasy.openFileManual` |
| `src/conflictsView.ts` | Create | `ConflictsViewProvider` `TreeDataProvider` — consumes Git API, lists files with `<<<<<<<` markers |
| `i18n/*.json` (8 files) | Modify | New translation keys for toolbar buttons + sidebar strings |
| `test/fixtures/single-conflict.txt` | Create | Fixture with exactly one conflict for verifying Bug 1 |
| `test/fixtures/multi-conflict.txt` | Create | Fixture with three conflicts for verifying bulk-accept |

---

## Task 1: Fix navigation arrows with single conflict (Bug 1)

**Files:**
- Modify: `media/webview/mergeEditor.js:155-162` and `media/webview/mergeEditor.js:559-560`
- Create: `test/fixtures/single-conflict.txt`

**Why this fix is correct:** With one conflict, `activeIndex === 0` and `state.hunks.length - 1 === 0`, so both `<= 0` and `>= length-1` are true and both buttons disable. `navigate()` early-returns when `next === activeIndex`, so even keyboard shortcuts produce no scroll. The fix enables the buttons whenever any conflict exists, and falls through to `scrollToActive()` when there's nothing to navigate to.

- [ ] **Step 1: Create fixture for the single-conflict case**

Create `test/fixtures/single-conflict.txt`:

```
function greet(name) {
  console.log("Hello, " + name);
}

<<<<<<< HEAD
const greeting = "Hi there";
=======
const greeting = "Welcome";
>>>>>>> feature-branch

greet("World");
```

- [ ] **Step 2: Reproduce the bug in EDH (capture the failing behavior)**

Run: open VSCode in the project root, press `F5` to launch Extension Development Host. In the EDH window, open `test/fixtures/single-conflict.txt`. Click the `$(git-merge)` icon in the editor title.

Expected (current buggy behavior): Both `▲` and `▼` buttons in the merge editor toolbar are greyed out. Pressing `Alt+↑` or `Alt+↓` does nothing.

- [ ] **Step 3: Apply the fix in `mergeEditor.js`**

In [media/webview/mergeEditor.js:155-162](media/webview/mergeEditor.js#L155-L162) replace `navigate`:

```js
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
```

In [media/webview/mergeEditor.js:559-560](media/webview/mergeEditor.js#L559-L560) replace the two disable lines with:

```js
    elBtnPrev.disabled = state.hunks.length === 0;
    elBtnNext.disabled = state.hunks.length === 0;
```

- [ ] **Step 4: Compile and reload**

Run: `npm run compile`

Then in the EDH window press `Cmd+R` (Mac) / `Ctrl+R` (Linux/Win) to reload the extension host.

- [ ] **Step 5: Verify the fix**

In EDH, open `test/fixtures/single-conflict.txt`, click the merge icon. Verify:

- Both `▲` and `▼` toolbar buttons are **enabled** (clickable, normal appearance).
- Clicking `▼` scrolls the conflict block into view (test by first scrolling away from it, then clicking `▼`).
- Pressing `Alt+↓` does the same.
- With zero conflicts (open any non-conflicted file via the command), both buttons are still disabled.
- Open a file with three conflicts (use `test-conflict.php` or create one) — `▲`/`▼` still navigate between hunks as before; no regression.

- [ ] **Step 6: Commit**

```bash
git add media/webview/mergeEditor.js test/fixtures/single-conflict.txt
git commit -m "fix: navigation arrows usable with single conflict"
```

---

## Task 2: Block "Open in Merge Editor" on directories (Bug 2)

**Files:**
- Modify: `package.json` (menu `when` clause)
- Modify: `src/extension.ts:32-37` (runtime guard)

**Why both layers:** Hiding the menu fixes the discovered case (right-click on folder). Adding `fs.statSync().isFile()` defends against the command being invoked on a folder URI through any other channel (programmatic, future menu additions, recently-renamed folder where the cache is stale).

- [ ] **Step 1: Reproduce the bug in EDH**

Run: `F5` to launch EDH. In the explorer of the EDH workspace, right-click any **folder**. Observe that "Open in Merge Editor" appears in the context menu. Click it.

Expected (current buggy behavior): A red error notification appears: `EISDIR: illegal operation on a directory, read`.

- [ ] **Step 2: Tighten the menu `when` clause in `package.json`**

In [package.json:52-58](package.json#L52-L58) (the `explorer/context` block), replace:

```json
      "explorer/context": [
        {
          "command": "intellij-merge.openMergeEditor",
          "when": "resourceScheme == file",
          "group": "1_modification"
        }
      ]
```

with:

```json
      "explorer/context": [
        {
          "command": "intellij-merge.openMergeEditor",
          "when": "resourceScheme == file && !explorerResourceIsFolder",
          "group": "1_modification"
        }
      ]
```

(The `editor/title` and `editor/context` entries are not changed — those contexts are inherently file-scoped.)

- [ ] **Step 3: Add the runtime guard in `extension.ts`**

In [src/extension.ts:29-47](src/extension.ts#L29-L47), replace the body of the `openMergeEditor` registration with:

```ts
  const openMergeEditor = vscode.commands.registerCommand(
    'intellij-merge.openMergeEditor',
    async (uri?: vscode.Uri) => {
      const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;

      if (!fileUri || fileUri.scheme !== 'file') {
        vscode.window.showWarningMessage('Please open a file first.');
        return;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fileUri.fsPath);
      } catch {
        vscode.window.showWarningMessage(`Cannot access: ${fileUri.fsPath}`);
        return;
      }
      if (!stat.isFile()) {
        vscode.window.showWarningMessage(
          'Please select a file, not a folder.'
        );
        return;
      }

      const content = fs.readFileSync(fileUri.fsPath, 'utf8');
      const parsed  = parseConflicts(content);

      if (parsed.hunks.length === 0) {
        vscode.window.showInformationMessage('No merge conflicts found in this file.');
        return;
      }

      MergePanel.createOrShow(context, fileUri, parsed);
    }
  );
```

- [ ] **Step 4: Compile and reload**

Run: `npm run compile`. Reload EDH (`Cmd+R` / `Ctrl+R`).

- [ ] **Step 5: Verify both layers**

Layer 1 (menu hidden): Right-click a folder in the EDH explorer. Verify "Open in Merge Editor" is **not** in the context menu. Right-click a file — verify it **is** in the menu (regression check).

Layer 2 (runtime guard): In the EDH command palette (`Cmd+Shift+P`), type "Open in Merge Editor". With a folder somehow active or via programmatic invocation, the command should produce the localized warning, not an EISDIR error. Easiest repro: open the developer console (`Help > Toggle Developer Tools` in the EDH window) and run:

```js
vscode.commands.executeCommand('intellij-merge.openMergeEditor', vscode.Uri.file('/Users/fc/dev/fc/merge-easy/src'))
```

Expected: warning notification "Please select a file, not a folder."; no error in console.

- [ ] **Step 6: Commit**

```bash
git add package.json src/extension.ts
git commit -m "fix: block 'Open in Merge Editor' on directories"
```

---

## Task 3: i18n keys for new buttons and sidebar

**Files:**
- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/es.json`, `i18n/fr.json`, `i18n/it.json`, `i18n/pt.json`, `i18n/ja.json`, `i18n/zh-tw.json`

**Why ahead of the feature tasks:** Tasks 4–7 reference these keys. Adding them first means we don't have to interleave i18n edits with code edits.

- [ ] **Step 1: Add keys to `i18n/en.json`**

Add to the JSON object (preserve existing keys, add these alongside them):

```json
  "btn.acceptAllLocal": "← All LOCAL",
  "btn.acceptAllRemote": "All REMOTE →",
  "btn.acceptAllLocal.tooltip": "Accept LOCAL for all unresolved conflicts",
  "btn.acceptAllRemote.tooltip": "Accept REMOTE for all unresolved conflicts",
  "sidebar.viewTitle": "Merge Conflicts",
  "sidebar.empty": "No merge conflicts found.",
  "sidebar.refresh": "Refresh",
  "sidebar.openFileManual": "Open file with markers manually…",
  "sidebar.conflictCount": "{count} conflict",
  "sidebar.conflictCountPlural": "{count} conflicts",
  "warn.notAFile": "Please select a file, not a folder."
```

- [ ] **Step 2: Add German translations to `i18n/de.json`**

```json
  "btn.acceptAllLocal": "← Alle LOCAL",
  "btn.acceptAllRemote": "Alle REMOTE →",
  "btn.acceptAllLocal.tooltip": "LOCAL für alle ungelösten Konflikte übernehmen",
  "btn.acceptAllRemote.tooltip": "REMOTE für alle ungelösten Konflikte übernehmen",
  "sidebar.viewTitle": "Merge-Konflikte",
  "sidebar.empty": "Keine Merge-Konflikte gefunden.",
  "sidebar.refresh": "Aktualisieren",
  "sidebar.openFileManual": "Datei mit Markern manuell öffnen…",
  "sidebar.conflictCount": "{count} Konflikt",
  "sidebar.conflictCountPlural": "{count} Konflikte",
  "warn.notAFile": "Bitte eine Datei auswählen, keinen Ordner."
```

- [ ] **Step 3: Add Spanish translations to `i18n/es.json`**

```json
  "btn.acceptAllLocal": "← Todos LOCAL",
  "btn.acceptAllRemote": "Todos REMOTE →",
  "btn.acceptAllLocal.tooltip": "Aceptar LOCAL en todos los conflictos sin resolver",
  "btn.acceptAllRemote.tooltip": "Aceptar REMOTE en todos los conflictos sin resolver",
  "sidebar.viewTitle": "Conflictos de fusión",
  "sidebar.empty": "No se encontraron conflictos de fusión.",
  "sidebar.refresh": "Actualizar",
  "sidebar.openFileManual": "Abrir archivo con marcadores manualmente…",
  "sidebar.conflictCount": "{count} conflicto",
  "sidebar.conflictCountPlural": "{count} conflictos",
  "warn.notAFile": "Seleccione un archivo, no una carpeta."
```

- [ ] **Step 4: Add French translations to `i18n/fr.json`**

```json
  "btn.acceptAllLocal": "← Tous LOCAL",
  "btn.acceptAllRemote": "Tous REMOTE →",
  "btn.acceptAllLocal.tooltip": "Accepter LOCAL pour tous les conflits non résolus",
  "btn.acceptAllRemote.tooltip": "Accepter REMOTE pour tous les conflits non résolus",
  "sidebar.viewTitle": "Conflits de fusion",
  "sidebar.empty": "Aucun conflit de fusion trouvé.",
  "sidebar.refresh": "Actualiser",
  "sidebar.openFileManual": "Ouvrir un fichier avec marqueurs manuellement…",
  "sidebar.conflictCount": "{count} conflit",
  "sidebar.conflictCountPlural": "{count} conflits",
  "warn.notAFile": "Veuillez sélectionner un fichier, pas un dossier."
```

- [ ] **Step 5: Add Italian translations to `i18n/it.json`**

```json
  "btn.acceptAllLocal": "← Tutti LOCAL",
  "btn.acceptAllRemote": "Tutti REMOTE →",
  "btn.acceptAllLocal.tooltip": "Accetta LOCAL per tutti i conflitti irrisolti",
  "btn.acceptAllRemote.tooltip": "Accetta REMOTE per tutti i conflitti irrisolti",
  "sidebar.viewTitle": "Conflitti di merge",
  "sidebar.empty": "Nessun conflitto di merge trovato.",
  "sidebar.refresh": "Aggiorna",
  "sidebar.openFileManual": "Apri file con marcatori manualmente…",
  "sidebar.conflictCount": "{count} conflitto",
  "sidebar.conflictCountPlural": "{count} conflitti",
  "warn.notAFile": "Seleziona un file, non una cartella."
```

- [ ] **Step 6: Add Portuguese translations to `i18n/pt.json`**

```json
  "btn.acceptAllLocal": "← Todos LOCAL",
  "btn.acceptAllRemote": "Todos REMOTE →",
  "btn.acceptAllLocal.tooltip": "Aceitar LOCAL em todos os conflitos não resolvidos",
  "btn.acceptAllRemote.tooltip": "Aceitar REMOTE em todos os conflitos não resolvidos",
  "sidebar.viewTitle": "Conflitos de merge",
  "sidebar.empty": "Nenhum conflito de merge encontrado.",
  "sidebar.refresh": "Atualizar",
  "sidebar.openFileManual": "Abrir arquivo com marcadores manualmente…",
  "sidebar.conflictCount": "{count} conflito",
  "sidebar.conflictCountPlural": "{count} conflitos",
  "warn.notAFile": "Selecione um arquivo, não uma pasta."
```

- [ ] **Step 7: Add Japanese translations to `i18n/ja.json`**

```json
  "btn.acceptAllLocal": "← すべてLOCAL",
  "btn.acceptAllRemote": "すべてREMOTE →",
  "btn.acceptAllLocal.tooltip": "未解決のすべての競合をLOCALで採用",
  "btn.acceptAllRemote.tooltip": "未解決のすべての競合をREMOTEで採用",
  "sidebar.viewTitle": "マージ競合",
  "sidebar.empty": "マージ競合は見つかりませんでした。",
  "sidebar.refresh": "更新",
  "sidebar.openFileManual": "マーカー付きファイルを手動で開く…",
  "sidebar.conflictCount": "{count} 件の競合",
  "sidebar.conflictCountPlural": "{count} 件の競合",
  "warn.notAFile": "フォルダではなくファイルを選択してください。"
```

- [ ] **Step 8: Add Traditional Chinese translations to `i18n/zh-tw.json`**

```json
  "btn.acceptAllLocal": "← 全部 LOCAL",
  "btn.acceptAllRemote": "全部 REMOTE →",
  "btn.acceptAllLocal.tooltip": "對所有未解決的衝突採用 LOCAL",
  "btn.acceptAllRemote.tooltip": "對所有未解決的衝突採用 REMOTE",
  "sidebar.viewTitle": "合併衝突",
  "sidebar.empty": "找不到合併衝突。",
  "sidebar.refresh": "重新整理",
  "sidebar.openFileManual": "手動開啟含標記的檔案…",
  "sidebar.conflictCount": "{count} 個衝突",
  "sidebar.conflictCountPlural": "{count} 個衝突",
  "warn.notAFile": "請選擇檔案，而非資料夾。"
```

- [ ] **Step 9: Replace the hard-coded English warning in extension.ts (Task 2 left it hard-coded)**

In `src/extension.ts`, replace the literal string `'Please select a file, not a folder.'` with the i18n lookup. Add at the top of `activate()` if not already present, then use:

```ts
vscode.window.showWarningMessage(i18n['warn.notAFile'] ?? 'Please select a file, not a folder.');
```

(`i18n` is already obtained from `getI18n()` at the start of `activate()` — see [src/extension.ts:24](src/extension.ts#L24).)

- [ ] **Step 10: Verify JSON validity**

Run:

```bash
for f in i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f OK" || echo "$f FAIL"; done
```

Expected: all eight lines say `OK`.

- [ ] **Step 11: Commit**

```bash
git add i18n/*.json src/extension.ts
git commit -m "i18n: add keys for bulk accept and sidebar"
```

---

## Task 4: Add "Accept all LOCAL" / "Accept all REMOTE" toolbar buttons

**Files:**
- Modify: `src/mergePanel.ts:300-305` (toolbar HTML)
- Modify: `media/webview/mergeEditor.js` (add DOM refs + click handlers)

**Why no new message type:** Each click iterates `state.hunks` and emits the existing per-hunk `resolve` message. This means each accepted hunk is independently undoable via the existing `↩` button — same UX as `btn-apply-nonconflicting` already provides for non-conflicting hunks.

- [ ] **Step 1: Modify the toolbar HTML in `mergePanel.ts`**

In [src/mergePanel.ts:300-305](src/mergePanel.ts#L300-L305), replace the `<div id="action-controls">` block with:

```ts
      <div id="action-controls">
        <button id="btn-accept-all-local" title="${this._i18n['btn.acceptAllLocal.tooltip'] ?? 'Accept LOCAL for all unresolved conflicts'}">${this._i18n['btn.acceptAllLocal'] ?? '← All LOCAL'}</button>
        <button id="btn-accept-all-remote" title="${this._i18n['btn.acceptAllRemote.tooltip'] ?? 'Accept REMOTE for all unresolved conflicts'}">${this._i18n['btn.acceptAllRemote'] ?? 'All REMOTE →'}</button>
        <button id="btn-toggle-context">${this._i18n['btn.hideContext'] ?? '⊟ Hide context'}</button>
        <button id="btn-apply-nonconflicting">${this._i18n['btn.nonConflicting'] ?? '⚡ Non-conflicting'}</button>
        <button id="btn-apply" class="primary">${this._i18n['btn.applyMerge'] ?? '✓ Apply Merge'}</button>
      </div>
```

- [ ] **Step 2: Add DOM refs in `mergeEditor.js`**

In [media/webview/mergeEditor.js:32-47](media/webview/mergeEditor.js#L32-L47) (the `// ── DOM refs ──` block), add the two new refs after `elBtnNonConf`:

```js
  const elBtnAcceptAllLocal  = $('btn-accept-all-local');
  const elBtnAcceptAllRemote = $('btn-accept-all-remote');
```

- [ ] **Step 3: Add click handlers in `mergeEditor.js`**

In [media/webview/mergeEditor.js:128-135](media/webview/mergeEditor.js#L128-L135), immediately after the `elBtnNonConf.addEventListener(...)` block, add:

```js
  elBtnAcceptAllLocal.addEventListener('click', () => {
    if (!state) { return; }
    state.hunks.forEach((h, i) => {
      if (!h.resolved && h.ours.length > 0) { sendResolve(i, { kind: 'ours' }); }
    });
  });

  elBtnAcceptAllRemote.addEventListener('click', () => {
    if (!state) { return; }
    state.hunks.forEach((h, i) => {
      if (!h.resolved && h.theirs.length > 0) { sendResolve(i, { kind: 'theirs' }); }
    });
  });
```

The `length > 0` guard avoids resolving with an empty side (e.g., theirs-only non-conflicting block resolving as empty `ours` would delete the only available content).

- [ ] **Step 4: Disable buttons when nothing to do**

In [media/webview/mergeEditor.js:559-560](media/webview/mergeEditor.js#L559-L560) (after Task 1's edit), append:

```js
    const anyUnresolved = state.hunks.some(h => !h.resolved);
    elBtnAcceptAllLocal.disabled  = !anyUnresolved;
    elBtnAcceptAllRemote.disabled = !anyUnresolved;
```

- [ ] **Step 5: Compile and reload**

Run: `npm run compile`. Reload EDH.

- [ ] **Step 6: Verify**

In EDH, open `test/fixtures/test-conflict.php`, click the merge icon. Verify:

- Two new buttons "← All LOCAL" and "All REMOTE →" appear at the left of the toolbar action group.
- Clicking "← All LOCAL" resolves every still-unresolved hunk as LOCAL — each one shows the green "✓ LOCAL" badge in the result panel.
- Each resolution is independently undoable via the per-hunk `↩` button.
- Click "All REMOTE →" — every unresolved hunk becomes "✓ REMOTE".
- After all hunks are resolved, both new buttons become disabled.
- Open a file with non-conflicting hunks (one side empty): clicking "All LOCAL" does **not** resolve the theirs-only ones (since `ours.length === 0`); they remain unresolved or are handled by the existing "Non-conflicting" button. Same for the symmetric case.
- Test the navigation regression too: with three hunks, `▲`/`▼` still work (Task 1 regression check).

- [ ] **Step 7: Commit**

```bash
git add src/mergePanel.ts media/webview/mergeEditor.js
git commit -m "feat: bulk accept-all-local / accept-all-remote toolbar buttons"
```

---

## Task 5: Declare Activity-Bar view in `package.json`

**Files:**
- Modify: `package.json`

**Why first:** The view contributions and command IDs need to exist before any TypeScript code can register handlers for them. This task is pure manifest changes.

- [ ] **Step 1: Add the new commands**

In `package.json`, replace the `commands` array with:

```json
    "commands": [
      {
        "command": "intellij-merge.openMergeEditor",
        "title": "%command.openMergeEditor%",
        "icon": "$(git-merge)"
      },
      {
        "command": "mergeEasy.refreshConflicts",
        "title": "Refresh",
        "category": "Merge Easy",
        "icon": "$(refresh)"
      },
      {
        "command": "mergeEasy.openFileManual",
        "title": "Open file with markers manually…",
        "category": "Merge Easy"
      }
    ],
```

- [ ] **Step 2: Add `viewsContainers` and `views`**

In `package.json` `contributes`, add after `commands` (and before `menus`):

```json
    "viewsContainers": {
      "activitybar": [
        {
          "id": "mergeEasy",
          "title": "Merge Easy",
          "icon": "media/icon.svg"
        }
      ]
    },
    "views": {
      "mergeEasy": [
        {
          "id": "mergeEasy.conflictsView",
          "name": "Merge Conflicts"
        }
      ]
    },
    "viewsWelcome": [
      {
        "view": "mergeEasy.conflictsView",
        "contents": "No merge conflicts found.\n[Refresh](command:mergeEasy.refreshConflicts)\n[Open file with markers manually…](command:mergeEasy.openFileManual)"
      }
    ],
```

- [ ] **Step 3: Add menu binding for the refresh icon**

In `package.json` `contributes.menus`, add a new key `view/title` after the existing menu entries:

```json
      "view/title": [
        {
          "command": "mergeEasy.refreshConflicts",
          "when": "view == mergeEasy.conflictsView",
          "group": "navigation"
        }
      ]
```

- [ ] **Step 4: Add activation events**

In `package.json`, replace `"activationEvents": []` with:

```json
  "activationEvents": [
    "onView:mergeEasy.conflictsView",
    "workspaceContains:.git"
  ],
```

- [ ] **Step 5: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && echo OK`

Expected: `OK`

- [ ] **Step 6: Verify the view appears (still empty)**

Run: `npm run compile`. Reload EDH. Look at the EDH window's activity bar (left edge). Expected: a new icon (the `media/icon.svg` rendered) appears. Click it — a sidebar with title "Merge Easy" and a section "Merge Conflicts" appears, currently empty (or showing the welcome view text once the next task is done).

Note: Since no `TreeDataProvider` is registered yet, the view will show the welcome view content (empty state markup we declared).

- [ ] **Step 7: Commit**

```bash
git add package.json
git commit -m "feat: declare Activity-Bar view for merge conflicts"
```

---

## Task 6: Implement `ConflictsViewProvider` (TreeDataProvider)

**Files:**
- Create: `src/conflictsView.ts`

**Why isolated:** The provider has one responsibility — turn the Git extension's `mergeChanges` lists into `TreeItem`s. No DOM, no commands beyond emitting refresh events. Easy to reason about and small enough to hold in context.

- [ ] **Step 1: Create the file with the public types and skeleton**

Create `src/conflictsView.ts`:

```ts
/**
 * conflictsView.ts
 *
 * TreeDataProvider for the "Merge Conflicts" sidebar view.
 * Lists files with <<<<<<< markers from all repositories in the
 * built-in VSCode Git extension.
 *
 * (c) 2026 FUTURE[code] - Markus Feilen
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseConflicts } from './conflictParser';
import { getI18n, ti, I18n } from './i18n';

export interface ConflictFile {
  uri: vscode.Uri;
  conflictCount: number;
}

export class ConflictsViewProvider implements vscode.TreeDataProvider<ConflictFile> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ConflictFile | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _i18n: I18n = getI18n();
  private readonly _gitWatchers: vscode.Disposable[] = [];
  private readonly _knownRepos = new WeakSet<object>();
  private _apiSubscribed = false;

  constructor(private readonly _context: vscode.ExtensionContext) {
    this._subscribeToGit();
  }

  refresh(): void {
    this._subscribeToGit(); // catch newly opened repositories
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._gitWatchers.forEach(d => d.dispose());
    this._gitWatchers.length = 0;
  }

  // ── TreeDataProvider ─────────────────────────────────────────────────────
  getTreeItem(element: ConflictFile): vscode.TreeItem {
    const item = new vscode.TreeItem(
      path.basename(element.uri.fsPath),
      vscode.TreeItemCollapsibleState.None
    );
    const folder = vscode.workspace.asRelativePath(path.dirname(element.uri.fsPath));
    item.description = folder === '.' ? '' : folder;
    const countKey = element.conflictCount === 1
      ? 'sidebar.conflictCount' : 'sidebar.conflictCountPlural';
    item.tooltip = `${element.uri.fsPath}\n${ti(this._i18n, countKey, { count: element.conflictCount })}`;
    item.resourceUri = element.uri;
    item.iconPath = new vscode.ThemeIcon('git-merge');
    item.command = {
      command: 'intellij-merge.openMergeEditor',
      title: 'Open',
      arguments: [element.uri],
    };
    item.contextValue = 'mergeConflictFile';
    return item;
  }

  async getChildren(): Promise<ConflictFile[]> {
    const gitApi = this._getGitApi();
    if (!gitApi) { return []; }

    const result: ConflictFile[] = [];
    const seen = new Set<string>();

    for (const repo of gitApi.repositories) {
      // mergeChanges is the canonical list of unmerged files in vscode.git API v1
      const changes = repo.state.mergeChanges as Array<{ uri: vscode.Uri }>;
      for (const c of changes) {
        const fsPath = c.uri.fsPath;
        if (seen.has(fsPath)) { continue; }
        seen.add(fsPath);

        let count = 0;
        try {
          const stat = fs.statSync(fsPath);
          if (!stat.isFile()) { continue; }
          const content = fs.readFileSync(fsPath, 'utf8');
          count = parseConflicts(content).hunks.length;
        } catch {
          continue; // file disappeared between status and read
        }

        if (count > 0) {
          result.push({ uri: c.uri, conflictCount: count });
        }
      }
    }

    // Sort: by relative folder path, then filename — keeps the list stable.
    result.sort((a, b) => {
      const ra = vscode.workspace.asRelativePath(a.uri.fsPath);
      const rb = vscode.workspace.asRelativePath(b.uri.fsPath);
      return ra.localeCompare(rb);
    });

    return result;
  }

  // ── Git API helpers ──────────────────────────────────────────────────────
  private _getGitApi(): { repositories: Array<{ state: { mergeChanges: Array<{ uri: vscode.Uri }>, onDidChange: vscode.Event<void> } }>, onDidOpenRepository: vscode.Event<unknown> } | undefined {
    const ext = vscode.extensions.getExtension('vscode.git');
    if (!ext) { return undefined; }
    const exports = ext.isActive ? ext.exports : undefined;
    if (!exports) { return undefined; }
    try {
      return exports.getAPI(1);
    } catch {
      return undefined;
    }
  }

  private _subscribeToGit(): void {
    const api = this._getGitApi();
    if (!api) { return; }

    // Subscribe to each repo's state-change event exactly once.
    for (const repo of api.repositories) {
      if (this._knownRepos.has(repo)) { continue; }
      this._knownRepos.add(repo);

      const sub = repo.state.onDidChange(() => this._onDidChangeTreeData.fire());
      this._gitWatchers.push(sub);
    }

    // Subscribe to "new repo opened" exactly once per provider lifetime.
    if (!this._apiSubscribed) {
      this._apiSubscribed = true;
      const sub = api.onDidOpenRepository(() => {
        this._subscribeToGit();
        this._onDidChangeTreeData.fire();
      });
      this._gitWatchers.push(sub);
    }
  }
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npm run compile`

Expected: no TypeScript errors. If `vscode.git` extension types are not present (it isn't published as `@types/vscode-git`), the inline `Array<{ uri: ... }>` type annotation in `_getGitApi` keeps things compiling without needing extra deps.

- [ ] **Step 3: Quick smoke test (compilation only — wiring happens in Task 7)**

Run:

```bash
node -e "require('./out/conflictsView')" 2>&1 | head -5
```

Expected: either silent success or the typical "vscode module not found" error from running outside the extension host. Either is fine — what we're checking is that the file compiles to JS.

Run: `ls -la out/conflictsView.js` to confirm the build output exists.

- [ ] **Step 4: Commit**

```bash
git add src/conflictsView.ts
git commit -m "feat: ConflictsViewProvider TreeDataProvider"
```

---

## Task 7: Wire up the sidebar, refresh, and manual-open commands

**Files:**
- Modify: `src/extension.ts`

**Why this finishes the feature:** The provider exists; the manifest declares the view; this task connects them and registers the two new commands.

- [ ] **Step 1: Import the provider**

Near the top of [src/extension.ts:13-17](src/extension.ts#L13-L17), add:

```ts
import { ConflictsViewProvider } from './conflictsView';
```

- [ ] **Step 2: Instantiate and register the provider**

Inside `activate()`, after the existing `// ── 4. One-time notification ...` block ends and before `// ── Run checks on the file that is already open ...`, add a new block:

```ts
  // ── 5. Activity-Bar sidebar: list of files with merge conflicts ──────────
  const conflictsProvider = new ConflictsViewProvider(context);
  const conflictsTreeView = vscode.window.createTreeView('mergeEasy.conflictsView', {
    treeDataProvider: conflictsProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(conflictsTreeView);
  context.subscriptions.push({ dispose: () => conflictsProvider.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand('mergeEasy.refreshConflicts', () => {
      conflictsProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergeEasy.openFileManual', async () => {
      const picks = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Open in Merge Easy',
      });
      if (!picks || picks.length === 0) { return; }
      await vscode.commands.executeCommand('intellij-merge.openMergeEditor', picks[0]);
    })
  );

  // Refresh the view when files in the workspace change (catches edits that
  // resolve conflicts outside of git's awareness — e.g. saved without `git add`).
  const fsWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  fsWatcher.onDidChange(() => conflictsProvider.refresh());
  fsWatcher.onDidCreate(() => conflictsProvider.refresh());
  fsWatcher.onDidDelete(() => conflictsProvider.refresh());
  context.subscriptions.push(fsWatcher);
```

Note: `createFileSystemWatcher('**/*')` is broad. If perf becomes an issue we can scope it later. For this iteration the cost is minimal because the refresh handler only re-queries Git API state and re-reads the small set of merge-listed files.

- [ ] **Step 3: Compile and reload**

Run: `npm run compile`. Reload EDH.

- [ ] **Step 4: Verify the empty state**

In EDH, with a Git workspace that has **no** active merge conflicts open, click the "Merge Easy" activity-bar icon. Verify:

- Sidebar opens with title "Merge Conflicts".
- Welcome view shows "No merge conflicts found." with two clickable links.
- Clicking "Refresh" produces no error.
- Clicking "Open file with markers manually…" opens a file picker. Pick `test/fixtures/single-conflict.txt` — the merge editor opens.

- [ ] **Step 5: Verify the populated state**

Manually create a real merge conflict in any small Git repo (or use the project itself):

```bash
# In a scratch repo:
git init scratch && cd scratch
echo "line one" > a.txt && git add a.txt && git commit -m initial
git checkout -b branch1 && echo "from branch1" > a.txt && git commit -am b1
git checkout main && echo "from main" > a.txt && git commit -am main
git merge branch1   # produces a conflict
```

Open the `scratch` folder in the EDH window (`File > Open Folder`). Click the Merge Easy activity-bar icon. Verify:

- The view lists `a.txt` with description `.` (root), with `1 conflict` in the tooltip.
- Clicking the entry opens the merge editor for `a.txt`.
- After resolving and running `git add a.txt` in a terminal, the entry disappears from the list within ~1 second (file watcher fires; Git state updates; provider refreshes).
- If auto-refresh fails for any reason, clicking the refresh icon in the view title bar updates the list.

- [ ] **Step 6: Verify multi-repo**

In a multi-root workspace with two Git repos, each with a conflict file, both files appear. Their description shows the relative path so duplicate filenames are distinguishable.

- [ ] **Step 7: Verify the no-Git-extension fallback**

Open a folder that is **not** a Git repository (`/tmp/empty-folder` for instance). The "Merge Easy" sidebar still appears (because `workspaceContains:.git` activation didn't fire, but `onView:mergeEasy.conflictsView` does). Welcome view shows the empty state. No errors in the developer console.

- [ ] **Step 8: Commit**

```bash
git add src/extension.ts
git commit -m "feat: register Merge Easy sidebar and refresh/manual-open commands"
```

---

## Task 8: Final integration verification

**Files:** none modified — this is a checklist task.

The point of this task is to run a single end-to-end pass with a fresh EDH and confirm nothing regressed across the four changes.

- [ ] **Step 1: Fresh build**

```bash
rm -rf out && npm run compile
```

- [ ] **Step 2: Launch EDH and walk through each scenario**

Open VSCode at the project root, press `F5`, then in the EDH:

- [ ] **Bug 1 — single-conflict navigation:** Open `test/fixtures/single-conflict.txt`, click the merge icon, verify ▲/▼ are enabled and `Alt+↑↓` scroll to the (only) conflict.
- [ ] **Bug 2 — directory context menu:** Right-click a folder in the explorer; "Open in Merge Editor" is **not** in the menu. Right-click a file; it **is**.
- [ ] **Feature: bulk accept LOCAL:** Open a file with multiple conflicts; click "← All LOCAL"; every unresolved hunk becomes "✓ LOCAL". Each individual hunk remains undoable.
- [ ] **Feature: bulk accept REMOTE:** Repeat with "All REMOTE →".
- [ ] **Feature: sidebar empty state:** Click the activity-bar Merge Easy icon in a workspace with no conflicts; welcome view appears.
- [ ] **Feature: sidebar populated:** Use the scratch-repo procedure from Task 7 Step 5; entry appears, click opens the merge editor, resolution + git add removes the entry within ~1s.
- [ ] **Feature: sidebar refresh button:** Click the `$(refresh)` icon in the view title bar — no error.
- [ ] **Feature: open-file-manual command:** Click the welcome-view link "Open file with markers manually…", pick a fixture file, merge editor opens.

- [ ] **Step 3: Verify no console errors**

In the EDH, open `Help > Toggle Developer Tools`, switch to the Console tab, and walk through the scenarios above. There should be **no** red error lines from the extension.

- [ ] **Step 4: Build the .vsix and confirm it packages cleanly**

Run: `npm run package`

Expected: `merge-easy-0.2.0.vsix` is produced in the project root. No errors during packaging.

- [ ] **Step 5: Final commit (only if version bump or CHANGELOG was touched)**

Skip if no changes remain. Otherwise:

```bash
git add -A
git commit -m "chore: integration verification pass"
```
