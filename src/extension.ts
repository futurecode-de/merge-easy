/**
 * extension.ts
 *
 * VS Code extension entry point.
 * Registers the "Open in Merge Editor" command plus three discovery surfaces:
 *   1. Status-bar button  – always visible when the active file has conflicts
 *   2. CodeLens           – clickable link above the first conflict marker
 *   3. Notification       – one-time banner the first time a conflict file is opened
 *
 * (c) 2026 FUTURE[code] - Markus Feilen
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseConflicts } from './conflictParser';
import { MergePanel } from './mergePanel';
import { getI18n } from './i18n';
import { ConflictsViewProvider } from './conflictsView';

// Track which files we've already shown the one-time notification for
const shownNotifications = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {

  const i18n = getI18n();

  // ── 1. Command: Open in Merge Editor ─────────────────────────────────────
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
          i18n['warn.notAFile'] ?? 'Please select a file, not a folder.'
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
  context.subscriptions.push(openMergeEditor);

  // ── 2. Status-bar button ─────────────────────────────────────────────────
  //    Shows "$(git-merge) N conflicts" with a warning background when a
  //    conflicted file is active.  Click opens the merge editor.
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.command = 'intellij-merge.openMergeEditor';
  context.subscriptions.push(statusBar);

  function updateStatusBar(editor?: vscode.TextEditor): void {
    if (!editor || editor.document.uri.scheme !== 'file') {
      statusBar.hide();
      return;
    }

    const text = editor.document.getText();
    if (!text.includes('<<<<<<<')) {
      statusBar.hide();
      return;
    }

    const parsed = parseConflicts(text);
    if (parsed.hunks.length === 0) {
      statusBar.hide();
      return;
    }

    const n = parsed.hunks.length;
    statusBar.text        = `$(git-merge) ${n} conflict${n !== 1 ? 's' : ''}`;
    statusBar.tooltip     = i18n['btn.applyMerge'] ?? 'Open in Merge Easy';
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBar.show();
  }

  // Update status bar whenever the active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar)
  );
  // Also update when the document content changes (e.g. after resolving in the editor)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      if (vscode.window.activeTextEditor?.document === e.document) {
        updateStatusBar(vscode.window.activeTextEditor);
      }
    })
  );

  // ── 3. CodeLens provider ─────────────────────────────────────────────────
  //    Renders a "$(git-merge) Open in Merge Easy  (N conflicts)" link
  //    directly above the first <<<<<<< line in any conflicted file.
  const codeLensProvider = vscode.languages.registerCodeLensProvider(
    { scheme: 'file' },
    {
      provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const text = document.getText();
        if (!text.includes('<<<<<<<')) { return []; }

        const lines = text.split('\n');
        const firstConflict = lines.findIndex(l => l.startsWith('<<<<<<<'));
        if (firstConflict < 0) { return []; }

        // Count all conflict blocks for the label
        const count = lines.filter(l => l.startsWith('<<<<<<<')).length;

        const range = new vscode.Range(firstConflict, 0, firstConflict, 0);
        return [
          new vscode.CodeLens(range, {
            title:     `$(git-merge)  Open in Merge Easy  ·  ${count} conflict${count !== 1 ? 's' : ''}`,
            command:   'intellij-merge.openMergeEditor',
            arguments: [document.uri],
          }),
        ];
      },
    }
  );
  context.subscriptions.push(codeLensProvider);

  // ── 4. One-time notification when a conflict file is first opened ─────────
  //    Less prominent than before – only fires once per file per session.
  //    Users who prefer keyboard / CodeLens can simply ignore it.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (!editor || editor.document.uri.scheme !== 'file') { return; }

      const key = editor.document.uri.fsPath;
      if (shownNotifications.has(key)) { return; }

      const text = editor.document.getText();
      if (!text.includes('<<<<<<<')) { return; }

      const parsed = parseConflicts(text);
      if (parsed.hunks.length === 0) { return; }

      shownNotifications.add(key);

      const action = await vscode.window.showInformationMessage(
        `⚠️ ${parsed.hunks.length} merge conflict${parsed.hunks.length !== 1 ? 's' : ''} found in ${editor.document.fileName.split('/').pop()}`,
        'Open in Merge Easy',
        'Dismiss'
      );

      if (action === 'Open in Merge Easy') {
        MergePanel.createOrShow(context, editor.document.uri, parsed);
      }
    })
  );

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

  // ── Run checks on the file that is already open at activation time ────────
  updateStatusBar(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  shownNotifications.clear();
}
