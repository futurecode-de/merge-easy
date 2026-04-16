"use strict";
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const conflictParser_1 = require("./conflictParser");
const mergePanel_1 = require("./mergePanel");
const i18n_1 = require("./i18n");
// Track which files we've already shown the one-time notification for
const shownNotifications = new Set();
function activate(context) {
    const i18n = (0, i18n_1.getI18n)();
    // ── 1. Command: Open in Merge Editor ─────────────────────────────────────
    const openMergeEditor = vscode.commands.registerCommand('intellij-merge.openMergeEditor', async (uri) => {
        const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!fileUri || fileUri.scheme !== 'file') {
            vscode.window.showWarningMessage('Please open a file first.');
            return;
        }
        const content = fs.readFileSync(fileUri.fsPath, 'utf8');
        const parsed = (0, conflictParser_1.parseConflicts)(content);
        if (parsed.hunks.length === 0) {
            vscode.window.showInformationMessage('No merge conflicts found in this file.');
            return;
        }
        mergePanel_1.MergePanel.createOrShow(context, fileUri, parsed);
    });
    context.subscriptions.push(openMergeEditor);
    // ── 2. Status-bar button ─────────────────────────────────────────────────
    //    Shows "$(git-merge) N conflicts" with a warning background when a
    //    conflicted file is active.  Click opens the merge editor.
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = 'intellij-merge.openMergeEditor';
    context.subscriptions.push(statusBar);
    function updateStatusBar(editor) {
        if (!editor || editor.document.uri.scheme !== 'file') {
            statusBar.hide();
            return;
        }
        const text = editor.document.getText();
        if (!text.includes('<<<<<<<')) {
            statusBar.hide();
            return;
        }
        const parsed = (0, conflictParser_1.parseConflicts)(text);
        if (parsed.hunks.length === 0) {
            statusBar.hide();
            return;
        }
        const n = parsed.hunks.length;
        statusBar.text = `$(git-merge) ${n} conflict${n !== 1 ? 's' : ''}`;
        statusBar.tooltip = i18n['btn.applyMerge'] ?? 'Open in Merge Easy';
        statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBar.show();
    }
    // Update status bar whenever the active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
    // Also update when the document content changes (e.g. after resolving in the editor)
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
        if (vscode.window.activeTextEditor?.document === e.document) {
            updateStatusBar(vscode.window.activeTextEditor);
        }
    }));
    // ── 3. CodeLens provider ─────────────────────────────────────────────────
    //    Renders a "$(git-merge) Open in Merge Easy  (N conflicts)" link
    //    directly above the first <<<<<<< line in any conflicted file.
    const codeLensProvider = vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
        provideCodeLenses(document) {
            const text = document.getText();
            if (!text.includes('<<<<<<<')) {
                return [];
            }
            const lines = text.split('\n');
            const firstConflict = lines.findIndex(l => l.startsWith('<<<<<<<'));
            if (firstConflict < 0) {
                return [];
            }
            // Count all conflict blocks for the label
            const count = lines.filter(l => l.startsWith('<<<<<<<')).length;
            const range = new vscode.Range(firstConflict, 0, firstConflict, 0);
            return [
                new vscode.CodeLens(range, {
                    title: `$(git-merge)  Open in Merge Easy  ·  ${count} conflict${count !== 1 ? 's' : ''}`,
                    command: 'intellij-merge.openMergeEditor',
                    arguments: [document.uri],
                }),
            ];
        },
    });
    context.subscriptions.push(codeLensProvider);
    // ── 4. One-time notification when a conflict file is first opened ─────────
    //    Less prominent than before – only fires once per file per session.
    //    Users who prefer keyboard / CodeLens can simply ignore it.
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (!editor || editor.document.uri.scheme !== 'file') {
            return;
        }
        const key = editor.document.uri.fsPath;
        if (shownNotifications.has(key)) {
            return;
        }
        const text = editor.document.getText();
        if (!text.includes('<<<<<<<')) {
            return;
        }
        const parsed = (0, conflictParser_1.parseConflicts)(text);
        if (parsed.hunks.length === 0) {
            return;
        }
        shownNotifications.add(key);
        const action = await vscode.window.showInformationMessage(`⚠️ ${parsed.hunks.length} merge conflict${parsed.hunks.length !== 1 ? 's' : ''} found in ${editor.document.fileName.split('/').pop()}`, 'Open in Merge Easy', 'Dismiss');
        if (action === 'Open in Merge Easy') {
            mergePanel_1.MergePanel.createOrShow(context, editor.document.uri, parsed);
        }
    }));
    // ── Run checks on the file that is already open at activation time ────────
    updateStatusBar(vscode.window.activeTextEditor);
}
function deactivate() {
    shownNotifications.clear();
}
//# sourceMappingURL=extension.js.map