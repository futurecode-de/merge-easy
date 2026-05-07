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
  private _getGitApi(): {
    repositories: Array<{
      state: {
        mergeChanges: Array<{ uri: vscode.Uri }>;
        onDidChange: vscode.Event<void>;
      };
    }>;
    onDidOpenRepository: vscode.Event<unknown>;
  } | undefined {
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
