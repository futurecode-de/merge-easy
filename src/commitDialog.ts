/**
 * commitDialog.ts
 *
 * A small webview-based dialog for editing a multi-line commit message.
 * Used by the "Commit merge" flow when the user picks "Edit message…"
 * instead of committing with the prepared MERGE_MSG verbatim.
 *
 * (c) 2026 FUTURE[code] - Markus Feilen
 */

import * as vscode from 'vscode';

export interface CommitDialogOptions {
  title: string;
  branchesLabel: string;
  prompt: string;
  prefilled: string;
  okLabel: string;
  cancelLabel: string;
  hintLabel: string;
}

/**
 * Open a webview dialog with a textarea pre-filled with `prefilled`.
 * Resolves with the entered message on commit, or undefined on cancel.
 */
export function showCommitMessageDialog(opts: CommitDialogOptions): Promise<string | undefined> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'mergeEasyCommitDialog',
      opts.title,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: false }
    );

    let resolved = false;
    const finish = (result: string | undefined): void => {
      if (resolved) { return; }
      resolved = true;
      resolve(result);
      panel.dispose();
    };

    panel.webview.html = buildHtml(opts);
    panel.webview.onDidReceiveMessage((msg: { type: string; message?: string }) => {
      if (msg.type === 'commit')      { finish(msg.message ?? ''); }
      else if (msg.type === 'cancel') { finish(undefined); }
    });
    panel.onDidDispose(() => finish(undefined));
  });
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function buildHtml(opts: CommitDialogOptions): string {
  const nonce = getNonce();
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${escHtml(opts.title)}</title>
  <style>
    html, body { height: 100%; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 28px;
      max-width: 720px;
      margin: 0 auto;
      box-sizing: border-box;
    }
    h2 { margin-top: 0; font-size: 1.3em; }
    .branches {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 18px;
    }
    label { display: block; margin-bottom: 6px; }
    textarea {
      width: 100%;
      min-height: 160px;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      padding: 8px 10px;
      resize: vertical;
    }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); border-color: transparent; }
    .hint {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin-top: 10px;
    }
    .buttons {
      margin-top: 18px;
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      border-radius: 2px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <h2>${escHtml(opts.title)}</h2>
  <div class="branches">${escHtml(opts.branchesLabel)}</div>
  <label for="msg">${escHtml(opts.prompt)}</label>
  <textarea id="msg" spellcheck="false">${escHtml(opts.prefilled)}</textarea>
  <div class="hint">${escHtml(opts.hintLabel)}</div>
  <div class="buttons">
    <button class="secondary" id="cancel">${escHtml(opts.cancelLabel)}</button>
    <button id="commit">${escHtml(opts.okLabel)}</button>
  </div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const txt = document.getElementById('msg');
      txt.focus();
      txt.setSelectionRange(0, txt.value.length);
      document.getElementById('commit').addEventListener('click', () => {
        vscode.postMessage({ type: 'commit', message: txt.value });
      });
      document.getElementById('cancel').addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          vscode.postMessage({ type: 'cancel' });
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          vscode.postMessage({ type: 'commit', message: txt.value });
        }
      });
    })();
  </script>
</body>
</html>`;
}
