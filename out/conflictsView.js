"use strict";
/**
 * conflictsView.ts
 *
 * TreeDataProvider for the "Merge Conflicts" sidebar view.
 * Lists files with <<<<<<< markers from all repositories in the
 * built-in VSCode Git extension.
 *
 * (c) 2026 FUTURE[code] - Markus Feilen
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConflictsViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const conflictParser_1 = require("./conflictParser");
const i18n_1 = require("./i18n");
class ConflictsViewProvider {
    constructor(_context) {
        this._context = _context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._i18n = (0, i18n_1.getI18n)();
        this._gitWatchers = [];
        this._knownRepos = new WeakSet();
        this._apiSubscribed = false;
        this._subscribeToGit();
    }
    refresh() {
        this._subscribeToGit(); // catch newly opened repositories
        this._onDidChangeTreeData.fire();
    }
    dispose() {
        this._gitWatchers.forEach(d => d.dispose());
        this._gitWatchers.length = 0;
    }
    // ── TreeDataProvider ─────────────────────────────────────────────────────
    getTreeItem(element) {
        const item = new vscode.TreeItem(path.basename(element.uri.fsPath), vscode.TreeItemCollapsibleState.None);
        const folder = vscode.workspace.asRelativePath(path.dirname(element.uri.fsPath));
        item.description = folder === '.' ? '' : folder;
        const countKey = element.conflictCount === 1
            ? 'sidebar.conflictCount' : 'sidebar.conflictCountPlural';
        item.tooltip = `${element.uri.fsPath}\n${(0, i18n_1.ti)(this._i18n, countKey, { count: element.conflictCount })}`;
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
    async getChildren() {
        const gitApi = this._getGitApi();
        if (!gitApi) {
            return [];
        }
        const result = [];
        const seen = new Set();
        for (const repo of gitApi.repositories) {
            // mergeChanges is the canonical list of unmerged files in vscode.git API v1
            const changes = repo.state.mergeChanges;
            for (const c of changes) {
                const fsPath = c.uri.fsPath;
                if (seen.has(fsPath)) {
                    continue;
                }
                seen.add(fsPath);
                let count = 0;
                try {
                    const stat = fs.statSync(fsPath);
                    if (!stat.isFile()) {
                        continue;
                    }
                    const content = fs.readFileSync(fsPath, 'utf8');
                    count = (0, conflictParser_1.parseConflicts)(content).hunks.length;
                }
                catch {
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
    _getGitApi() {
        const ext = vscode.extensions.getExtension('vscode.git');
        if (!ext) {
            return undefined;
        }
        const exports = ext.isActive ? ext.exports : undefined;
        if (!exports) {
            return undefined;
        }
        try {
            return exports.getAPI(1);
        }
        catch {
            return undefined;
        }
    }
    _subscribeToGit() {
        const api = this._getGitApi();
        if (!api) {
            return;
        }
        // Subscribe to each repo's state-change event exactly once.
        for (const repo of api.repositories) {
            if (this._knownRepos.has(repo)) {
                continue;
            }
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
exports.ConflictsViewProvider = ConflictsViewProvider;
//# sourceMappingURL=conflictsView.js.map