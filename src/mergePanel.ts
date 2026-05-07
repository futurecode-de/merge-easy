/**
 * mergePanel.ts
 *
 * Manages the WebviewPanel that shows the IntelliJ-style merge editor.
 * Handles bidirectional communication between extension host and webview.
 *
 * (c) 2026 FUTURE[code] - Markus Feilen
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ParsedFile, parseConflicts, applyResolutions, Resolution, FileSection } from './conflictParser';
import { getGitInfo, markResolved } from './gitHelper';
import { getI18n, ti, I18n } from './i18n';

// Messages sent FROM the extension TO the webview
type ExtensionMessage =
  | { type: 'init'; payload: InitPayload }
  | { type: 'fileUpdated'; payload: InitPayload };

// Messages sent FROM the webview TO the extension
type WebviewMessage =
  | { type: 'resolve'; hunkIndex: number; resolution: Resolution | null }
  | { type: 'resolveBulk'; updates: Array<{ hunkIndex: number; resolution: Resolution | null }> }
  | { type: 'applyAndSave' }
  | { type: 'ready' };

interface InitPayload {
  filePath: string;
  fileName: string;
  oursLabel: string;
  theirsLabel: string;
  hasBase: boolean;
  hunks: SerializedHunk[];
  sections: SerializedSection[];
  totalConflicts: number;
  i18n: I18n;
}

interface SerializedHunk {
  index: number;
  ours:   string[];
  base:   string[] | undefined;
  theirs: string[];
  oursLabel:   string;
  theirsLabel: string;
  resolved:       boolean;
  resolutionKind: string | undefined;
  resolutionText: string | undefined;
  isNonConflicting:    boolean;
  nonConflictingSide: string | undefined;
}

type SerializedSection =
  | { kind: 'context';  lines: string[]; fileLineStart: number }
  | { kind: 'conflict'; hunkIndex: number };

export class MergePanel {
  public static currentPanel: MergePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _fileUri: vscode.Uri;
  private _parsed: ParsedFile;
  private _i18n: I18n = getI18n();
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    parsed: ParsedFile
  ): MergePanel {
    const column = vscode.ViewColumn.Beside;

    // Reuse existing panel if possible
    if (MergePanel.currentPanel) {
      MergePanel.currentPanel._panel.reveal(column);
      MergePanel.currentPanel._update(fileUri, parsed);
      return MergePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'intellijMergeEditor',
      `Merge: ${path.basename(fileUri.fsPath)}`,
      column,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media', 'webview'),
          vscode.Uri.joinPath(context.extensionUri, 'media', 'vendor'),
        ],
        retainContextWhenHidden: true,
      }
    );

    MergePanel.currentPanel = new MergePanel(panel, context, fileUri, parsed);
    return MergePanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    parsed: ParsedFile
  ) {
    this._panel = panel;
    this._context = context;
    this._fileUri = fileUri;
    this._parsed = parsed;

    // Set initial HTML
    this._panel.webview.html = this._buildHtml();

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this._handleWebviewMessage(msg),
      null,
      this._disposables
    );

    // Clean up on close
    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

    // Send initial data once the webview signals it's ready
    // (handled in _handleWebviewMessage for 'ready')
  }

  private _update(fileUri: vscode.Uri, parsed: ParsedFile): void {
    this._fileUri = fileUri;
    this._parsed = parsed;
    this._panel.title = `Merge: ${path.basename(fileUri.fsPath)}`;
    this._panel.webview.postMessage({
      type: 'fileUpdated',
      payload: this._buildPayload(),
    } satisfies ExtensionMessage);
  }

  private async _handleWebviewMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        // Webview is ready – send initial data
        await this._enrichLabelsFromGit();
        this._panel.webview.postMessage({
          type: 'init',
          payload: this._buildPayload(),
        } satisfies ExtensionMessage);
        break;
      }

      case 'resolve': {
        const hunk = this._parsed.hunks[msg.hunkIndex];
        if (hunk) {
          hunk.resolution = msg.resolution ?? undefined;
        }
        // Echo back updated state so the webview can refresh the result panel
        this._panel.webview.postMessage({
          type: 'fileUpdated',
          payload: this._buildPayload(),
        } satisfies ExtensionMessage);
        break;
      }

      case 'resolveBulk': {
        // Apply every update first, then echo a single fileUpdated. This
        // avoids a race where the webview's bulk-state pruner sees partial
        // updates and drops indices that are about to be resolved.
        for (const u of msg.updates) {
          const hunk = this._parsed.hunks[u.hunkIndex];
          if (hunk) { hunk.resolution = u.resolution ?? undefined; }
        }
        this._panel.webview.postMessage({
          type: 'fileUpdated',
          payload: this._buildPayload(),
        } satisfies ExtensionMessage);
        break;
      }

      case 'applyAndSave': {
        await this._applyAndSave();
        break;
      }
    }
  }

  private async _applyAndSave(): Promise<void> {
    const unresolved = this._parsed.hunks.filter(h => h.resolution === undefined).length;

    const i = this._i18n;
    if (unresolved > 0) {
      const answer = await vscode.window.showWarningMessage(
        ti(i, 'warn.unresolved', { count: unresolved }),
        ti(i, 'warn.saveAnyway'),
        ti(i, 'warn.cancel')
      );
      if (answer !== ti(i, 'warn.saveAnyway')) { return; }
    }

    const result = applyResolutions(this._parsed);
    fs.writeFileSync(this._fileUri.fsPath, result, 'utf8');

    if (unresolved === 0) {
      // Mark as resolved in git
      try {
        await markResolved(this._fileUri.fsPath);
        vscode.window.showInformationMessage(
          ti(i, 'info.mergeDone', { file: path.basename(this._fileUri.fsPath) })
        );
      } catch {
        vscode.window.showInformationMessage(ti(i, 'info.savedNoGit'));
      }
    } else {
      vscode.window.showInformationMessage(ti(i, 'info.savedWithConflicts', { count: unresolved }));
    }

    // Re-parse the saved file to reflect the new state
    const newContent = fs.readFileSync(this._fileUri.fsPath, 'utf8');
    this._parsed = parseConflicts(newContent);
    this._panel.webview.postMessage({
      type: 'fileUpdated',
      payload: this._buildPayload(),
    } satisfies ExtensionMessage);
  }

  /** Try to get real branch names from git to use as panel labels */
  private async _enrichLabelsFromGit(): Promise<void> {
    try {
      const info = await getGitInfo(this._fileUri.fsPath);
      if (!info) { return; }

      // Only override if the parsed labels are generic (HEAD / MERGE_HEAD)
      if (this._parsed.oursLabel === 'HEAD' && info.currentBranch) {
        this._parsed.oursLabel = info.currentBranch;
      }
      if (
        (this._parsed.theirsLabel === 'MERGE_HEAD' || this._parsed.theirsLabel === 'REMOTE') &&
        info.mergeHead
      ) {
        this._parsed.theirsLabel = info.mergeHead;
      }
    } catch { /* non-critical */ }
  }

  private _buildPayload(): InitPayload {
    return {
      filePath: this._fileUri.fsPath,
      fileName: path.basename(this._fileUri.fsPath),
      oursLabel:  this._parsed.oursLabel,
      theirsLabel: this._parsed.theirsLabel,
      hasBase: this._parsed.hasBase,
      totalConflicts: this._parsed.hunks.length,
      i18n: this._i18n,
      hunks: this._parsed.hunks.map(h => ({
        index:       h.index,
        ours:        h.ours,
        base:        h.base,
        theirs:      h.theirs,
        oursLabel:   h.oursLabel,
        theirsLabel: h.theirsLabel,
        resolved:         h.resolution !== undefined,
        resolutionKind:   h.resolution?.kind,
        resolutionText:   h.resolution?.kind === 'custom' ? h.resolution.text : undefined,
        isNonConflicting:   h.isNonConflicting,
        nonConflictingSide: h.nonConflictingSide,
      })),
      sections: this._parsed.sections.map(s =>
        s.kind === 'context'
          ? { kind: 'context' as const, lines: s.lines, fileLineStart: s.fileLineStart }
          : { kind: 'conflict' as const, hunkIndex: s.hunkIndex }
      ),
    };
  }

  private _buildHtml(): string {
    const webview = this._panel.webview;
    const webviewUri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'webview', file));
    const vendorUri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'vendor', file));

    const stylesUri   = webviewUri('styles.css');
    const hljsCssUri  = vendorUri('highlight.css');
    const hljsUri     = vendorUri('highlight.min.js');
    const scriptUri   = webviewUri('mergeEditor.js');

    // Nonce for CSP
    const nonce = getNonce();

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${hljsCssUri}">
  <link rel="stylesheet" href="${stylesUri}">
  <title>Merge Editor</title>
</head>
<body>
  <div id="app">

    <!-- ── Toolbar ── -->
    <div id="toolbar">
      <div id="file-info">
        <span id="file-name">${this._i18n['loading'] ?? 'Loading\u2026'}</span>
        <span id="conflict-badge"></span>
      </div>
      <div id="nav-controls">
        <button id="btn-prev" title="Previous conflict (Alt+↑)">&#9650;</button>
        <span id="nav-label">–</span>
        <button id="btn-next" title="Next conflict (Alt+↓)">&#9660;</button>
      </div>
      <div id="action-controls">
        <button id="btn-accept-all-local" title="${this._i18n['btn.acceptAllLocal.tooltip'] ?? 'Accept LOCAL for all unresolved conflicts'}">${this._i18n['btn.acceptAllLocal'] ?? 'All LOCAL \u2192'}</button>
        <button id="btn-accept-all-remote" title="${this._i18n['btn.acceptAllRemote.tooltip'] ?? 'Accept REMOTE for all unresolved conflicts'}">${this._i18n['btn.acceptAllRemote'] ?? '\u2190 All REMOTE'}</button>
        <button id="btn-undo-bulk" hidden title="${this._i18n['btn.undoBulk.tooltip'] ?? 'Undo bulk accept'}">${this._i18n['btn.undoBulk'] ?? '\u21a9 Undo bulk'}</button>
        <button id="btn-toggle-context">${this._i18n['btn.hideContext'] ?? '\u229f Hide context'}</button>
        <button id="btn-apply-nonconflicting">${this._i18n['btn.nonConflicting'] ?? '\u26a1 Non-conflicting'}</button>
        <button id="btn-apply" class="primary">${this._i18n['btn.applyMerge'] ?? '\u2713 Apply Merge'}</button>
      </div>
      <span class="keyboard-hints">${this._i18n['hints.keyboard'] ?? 'Alt+\u2190 LOCAL \u00b7 Alt+\u2192 REMOTE \u00b7 Alt+\u2191\u2193 navigate'}</span>
    </div>

    <!-- ── Three-panel layout: LOCAL | RESULT | REMOTE ── -->
    <div id="panels-container">

      <!-- LOCAL (blue) -->
      <div class="col-ours">
        <div class="col-header ours-header">
          <span class="panel-label" id="label-ours">LOCAL</span>
          <span class="panel-sub" id="label-ours-sub">${this._i18n['panel.local.sub'] ?? 'Your changes'}</span>
        </div>
        <div class="col-content" id="content-ours"></div>
      </div>

      <!-- RESULT (center) -->
      <div class="col-result">
        <div class="col-header result-header">
          <span class="panel-label">RESULT</span>
          <span class="panel-sub" id="result-status"></span>
        </div>
        <div class="col-content" id="content-result"></div>
      </div>

      <!-- REMOTE (green) -->
      <div class="col-theirs">
        <div class="col-header theirs-header">
          <span class="panel-label" id="label-theirs">REMOTE</span>
          <span class="panel-sub" id="label-theirs-sub">${this._i18n['panel.remote.sub'] ?? 'Incoming changes'}</span>
        </div>
        <div class="col-content" id="content-theirs"></div>
      </div>

      <!-- SVG overlay for connector ribbons (pointer-events:none so clicks pass through) -->
      <svg id="connector-svg"
           xmlns="http://www.w3.org/2000/svg"
           style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:5;">
      </svg>

    </div>
  </div>

  <script nonce="${nonce}" src="${hljsUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _dispose(): void {
    MergePanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
    this._disposables = [];
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
