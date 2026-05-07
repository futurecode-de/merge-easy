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
import { listUnmergedFiles, findRepoRoot } from './gitHelper';
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

  constructor() {
    // Fire-and-forget async init: subscribe to the vscode.git API for live
    // refresh events. Data fetching happens via git CLI (see getChildren),
    // which doesn't depend on the API being ready.
    void this._subscribeToGit().then(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    void this._subscribeToGit(); // catch newly opened repositories
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
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) { return []; }

    const result: ConflictFile[] = [];
    const seen = new Set<string>();

    // Discover candidate repo roots: walk up from each workspace folder to
    // find the enclosing git repo. Handles the case where the workspace
    // folder is a subdirectory of the repo (typical for sub-package roots
    // or test-fixture workspaces nested inside a parent repo).
    const repoRoots = new Set<string>();
    for (const folder of folders) {
      const root = folder.uri.fsPath;
      // Probe for .git directly first (cheap, no fork).
      try {
        if (fs.existsSync(path.join(root, '.git'))) {
          repoRoots.add(root);
          continue;
        }
      } catch { /* ignore */ }
      // Fall back to `git rev-parse --show-toplevel` from this folder.
      const probed = await findRepoRoot(path.join(root, '.placeholder'));
      if (probed) { repoRoots.add(probed); }
    }
    // Also add any repos the vscode.git API knows about — covers nested
    // repos the user opened explicitly that aren't workspace roots.
    const gitApi = await this._getGitApi();
    if (gitApi) {
      for (const repo of gitApi.repositories) {
        // The git API repo doesn't expose its root directly in v1, but the
        // first mergeChange (when present) gives us the file system. As a
        // conservative supplement we look up the workspace folder containing
        // any of the repo's tracked files. In practice the workspace-folder
        // pass above is enough for the common case.
        const sample = repo.state.mergeChanges[0]?.uri;
        if (sample) {
          const wsFolder = vscode.workspace.getWorkspaceFolder(sample);
          if (wsFolder) { repoRoots.add(wsFolder.uri.fsPath); }
        }
      }
    }

    for (const repoRoot of repoRoots) {
      const unmerged = await listUnmergedFiles(repoRoot);
      for (const fsPath of unmerged) {
        if (seen.has(fsPath)) { continue; }
        seen.add(fsPath);

        let count = 0;
        try {
          const stat = fs.statSync(fsPath);
          if (!stat.isFile()) { continue; }
          count = parseConflicts(fs.readFileSync(fsPath, 'utf8')).hunks.length;
        } catch {
          continue; // file disappeared between status and read
        }

        if (count > 0) {
          result.push({ uri: vscode.Uri.file(fsPath), conflictCount: count });
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
  private async _getGitApi(): Promise<{
    repositories: Array<{
      state: {
        mergeChanges: Array<{ uri: vscode.Uri }>;
        onDidChange: vscode.Event<void>;
      };
    }>;
    onDidOpenRepository: vscode.Event<unknown>;
  } | undefined> {
    const ext = vscode.extensions.getExtension('vscode.git');
    if (!ext) { return undefined; }
    if (!ext.isActive) {
      try { await ext.activate(); } catch { return undefined; }
    }
    try {
      return ext.exports.getAPI(1);
    } catch {
      return undefined;
    }
  }

  private async _subscribeToGit(): Promise<void> {
    const api = await this._getGitApi();
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
