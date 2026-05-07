# Merge Easy: Bug Fixes and Sidebar Feature

**Date:** 2026-05-07
**Status:** Approved by user, ready for implementation plan

## Summary

Four changes to the Merge Easy extension:

1. **Bug fix:** Navigation arrows are unusable when a file has only one conflict.
2. **Bug fix:** "Open in Merge Editor" context menu appears on directories and crashes with EISDIR.
3. **Feature:** Toolbar buttons "Accept all LOCAL" and "Accept all REMOTE" in the merge editor.
4. **Feature:** Activity-Bar sidebar that lists all files with merge conflicts; clicking an entry opens the merge editor.

## 1. Bug: Navigation arrows disabled when only one conflict

### Diagnosis

In `media/webview/mergeEditor.js`:

- Lines 559–560 disable the prev/next buttons whenever `activeIndex` is at a boundary. With one conflict, `activeIndex === 0 === hunks.length - 1`, so both buttons are always disabled.
- Lines 155–162 (`navigate()`) early-return when the new index equals the current index, so even keyboard shortcuts (`Alt+↑`/`Alt+↓`) do nothing.

### Fix

- Disable the prev/next buttons only when `state.hunks.length === 0` (no conflicts at all).
- In `navigate()`, when the new index equals the current index but at least one conflict exists, still call `scrollToActive()` so the click/shortcut at minimum scrolls to the (only) conflict.
- With zero conflicts, both behaviors remain inert.

## 2. Bug: "Open in Merge Editor" on directories triggers EISDIR

### Diagnosis

In `package.json`, all three menu contributions (`editor/title`, `editor/context`, `explorer/context`) use `when: "resourceScheme == file"`, which matches both files and folders.

In `src/extension.ts:37`, the command unconditionally calls `fs.readFileSync(fileUri.fsPath, ...)`. Reading a directory throws `EISDIR: illegal operation on a directory`.

### Fix

Two layers of defense:

1. **Menu visibility** — restrict the `explorer/context` contribution with the additional clause `&& !explorerResourceIsFolder`. The other two contexts (editor title, editor context) are inherently file-scoped and don't need a guard.
2. **Runtime guard** — in `extension.ts` before `fs.readFileSync`, call `fs.statSync(fileUri.fsPath).isFile()`. If false, show a localized warning ("Please select a file, not a folder.") and return. This protects against future menu additions and against the command being invoked programmatically.

## 3. Feature: "Accept all LOCAL" / "Accept all REMOTE" buttons

Two new toolbar buttons in the merge editor that resolve every still-unresolved conflict in the current file as LOCAL or REMOTE respectively.

### Layout

Toolbar order in `mergePanel.ts` `_buildHtml()` action-controls group:

```
[← All LOCAL] [All REMOTE →] [⊟ Hide context] [⚡ Non-conflicting] [✓ Apply Merge]
```

The two new buttons are placed first because they are the most aggressive bulk actions; "Apply Merge" stays as the rightmost primary action.

### Behavior

- Iterates `state.hunks`, sends a `resolve` message for each unresolved hunk with `{ kind: 'ours' }` or `{ kind: 'theirs' }`.
- Skips hunks that are already resolved (preserves manual edits and undoable resolution per hunk).
- No confirmation dialog. Each resolution is undoable per-hunk via the existing `↩` button, consistent with how "Non-conflicting" already operates without confirmation.
- Buttons disabled when there are no unresolved conflicts.

### i18n keys

Added to all locale files in `i18n/`:

- `btn.acceptAllLocal` — e.g. "← All LOCAL"
- `btn.acceptAllRemote` — e.g. "All REMOTE →"
- `btn.acceptAllLocal.tooltip` — e.g. "Accept LOCAL for all unresolved conflicts"
- `btn.acceptAllRemote.tooltip` — e.g. "Accept REMOTE for all unresolved conflicts"

## 4. Feature: Activity-Bar sidebar with conflict file list

### User-visible behavior

- New icon in the Activity Bar (Git-merge glyph) labeled "Merge Easy".
- Clicking the icon reveals a sidebar view titled "Merge Conflicts" with a flat list of files that currently have unresolved merge conflicts.
- Each entry shows: filename (label) · workspace-relative folder path (description) · conflict count (badge).
- Clicking an entry opens the merge editor for that file in the main editor area (the existing `MergePanel.createOrShow` flow).
- View has a `Refresh` action button in its title bar (icon: `$(refresh)`).
- Welcome view (when list is empty): "No merge conflicts found." with two links: "Refresh" and "Open file with markers manually…" (the latter opens a file-picker that calls `openMergeEditor` on the chosen file).

### Architecture

**View registration** (`package.json`):

- New `viewsContainers.activitybar` entry: `{ id: "mergeEasy", title: "Merge Easy", icon: "media/icon.svg" }`.
- New `views.mergeEasy` entry: `{ id: "mergeEasy.conflictsView", name: "Merge Conflicts" }`.
- New `viewsWelcome` entry for the empty state.
- New commands: `mergeEasy.refreshConflicts`, `mergeEasy.openFileManual`.
- Menu contributions to bind the refresh icon to the view title.
- `activationEvents`: add `"onView:mergeEasy.conflictsView"` and `"workspaceContains:.git"` so the extension activates as soon as a Git workspace opens.

**TreeDataProvider** — new file `src/conflictsView.ts`:

- Class `ConflictsViewProvider implements vscode.TreeDataProvider<ConflictItem>`.
- `getChildren()` queries the built-in Git extension via `vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1)`.
- For each repository in `gitApi.repositories`, reads `repo.state.mergeChanges` to enumerate unmerged files.
- For each unmerged file, reads its content and runs `parseConflicts()` from `src/conflictParser.ts` to obtain the conflict count. Files where parsing yields zero hunks (e.g. delete/modify conflicts that have no `<<<<<<<` markers) are skipped — the merge editor can't help with those anyway.
- `_onDidChangeTreeData` event fires when:
  - `repo.state.onDidChange` fires (subscribed once per repository, with re-subscription when the repository list changes).
  - The user clicks the refresh button.
  - A file watcher on workspace files fires for any listed file (so resolving conflicts in a non-Git editor still updates the badge).

**File-open flow:**

`ConflictItem.command` is set to `intellij-merge.openMergeEditor` with the file URI as argument. This reuses the existing command path — no new opening logic.

### Edge cases

- **No Git extension available:** Welcome view shows the empty state. Refresh is a no-op.
- **No workspace folder:** Same as above — empty state.
- **Multi-root workspace:** All repositories' merge changes are flattened into one list. Description shows workspace-relative folder path so duplicate filenames across repos are distinguishable.
- **File deleted while listed:** The next refresh removes it. If the user clicks before the refresh, the existing command's `fs.readFileSync` already throws — we add a try/catch and a friendly message in the command (covered by the runtime guard in section 2).

## Out of scope

- Workspace-wide scan for `<<<<<<<` markers in non-Git files. (Considered and explicitly rejected — Git status is the single source of truth.)
- Hierarchical tree view of conflicts. (Considered and rejected — flat list is adequate at typical merge sizes.)
- Confirmation dialogs for bulk-accept actions. (Existing per-hunk undo is sufficient.)
- Workspace-wide bulk accept across multiple files. (Per-file is enough for this iteration.)
- Listing files that Git considers unmerged but contain no conflict markers (delete/modify, rename conflicts). The merge editor can't resolve them; VSCode's built-in source-control view already surfaces them.

## Files changed

- `package.json` — menu `when` clause fix, new view contributions, new commands, new activationEvents.
- `src/extension.ts` — runtime `isFile()` guard, register new commands, instantiate `ConflictsViewProvider`.
- `src/mergePanel.ts` — two new toolbar buttons, new `WebviewMessage` cases for bulk-accept (or handle entirely in webview by emitting per-hunk `resolve` messages — to be decided in plan).
- `src/conflictsView.ts` — new file, the TreeDataProvider.
- `media/webview/mergeEditor.js` — fix navigation button enable/disable logic, fix `navigate()` early-return, wire two new toolbar buttons.
- `i18n/*.json` and `package.nls.*.json` — new translation keys.
