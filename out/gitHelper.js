"use strict";
/**
 * gitHelper.ts
 *
 * Thin wrapper around git CLI commands needed by the merge editor.
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
exports.findRepoRoot = findRepoRoot;
exports.getGitInfo = getGitInfo;
exports.markResolved = markResolved;
exports.commitMerge = commitMerge;
exports.commitMergeWithMessage = commitMergeWithMessage;
exports.listUnmergedFiles = listUnmergedFiles;
exports.isFileConflicted = isFileConflicted;
exports.getLastCommitTime = getLastCommitTime;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * Detect the git repository root for a given file path.
 */
async function findRepoRoot(filePath) {
    const dir = path.dirname(filePath);
    try {
        const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
        return stdout.trim();
    }
    catch {
        return undefined;
    }
}
/**
 * Gather basic git info for a file's repository.
 */
async function getGitInfo(filePath) {
    const repoRoot = await findRepoRoot(filePath);
    if (!repoRoot) {
        return undefined;
    }
    let currentBranch = 'HEAD';
    let mergeHead;
    try {
        const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
        currentBranch = stdout.trim();
    }
    catch { /* ignore */ }
    // Read MERGE_HEAD to get the incoming branch name
    const mergeHeadFile = path.join(repoRoot, '.git', 'MERGE_HEAD');
    if (fs.existsSync(mergeHeadFile)) {
        const mergeHeadHash = fs.readFileSync(mergeHeadFile, 'utf8').trim();
        // Try to resolve to a branch name
        try {
            const { stdout } = await execFileAsync('git', [
                '-C', repoRoot,
                'name-rev', '--name-only', mergeHeadHash
            ]);
            mergeHead = stdout.trim().replace(/~\d+$/, ''); // strip trailing ~1 etc.
        }
        catch {
            mergeHead = mergeHeadHash.slice(0, 8); // fallback: short hash
        }
    }
    return { repoRoot, currentBranch, mergeHead };
}
/**
 * Mark a file as resolved in git's index (equivalent to `git add <file>`).
 */
async function markResolved(filePath) {
    const dir = path.dirname(filePath);
    await execFileAsync('git', ['-C', dir, 'add', filePath]);
}
/**
 * Finalize a merge using the message git already prepared in MERGE_MSG.
 * Throws if the commit fails (e.g. pre-commit hook rejects, or the merge
 * was concurrently aborted between the caller's check and this call).
 */
async function commitMerge(repoRoot) {
    await execFileAsync('git', ['-C', repoRoot, 'commit', '--no-edit']);
}
/**
 * Finalize a merge with a custom one-line commit message.
 */
async function commitMergeWithMessage(repoRoot, message) {
    await execFileAsync('git', ['-C', repoRoot, 'commit', '-m', message]);
}
/**
 * List absolute paths of files in a git repo that are currently in a merge
 * conflict state (any of UU/AA/DD/AU/UA/DU/UD status codes from `git status`).
 * Returns an empty array on any failure — caller decides how to handle.
 */
async function listUnmergedFiles(repoRoot) {
    try {
        const { stdout } = await execFileAsync('git', [
            '-C', repoRoot,
            'status', '--porcelain=v1', '-z',
        ]);
        const conflictCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
        const result = [];
        // -z output: each entry is "XY <path>\0" (renames have an extra NUL-separated origin we ignore).
        const entries = stdout.split('\0').filter(e => e.length > 0);
        for (const entry of entries) {
            if (entry.length < 4) {
                continue;
            }
            const code = entry.substring(0, 2);
            const relPath = entry.substring(3);
            if (conflictCodes.has(code)) {
                result.push(path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath));
            }
        }
        return result;
    }
    catch {
        return [];
    }
}
/**
 * Check if a file is currently listed as conflicted in git status.
 */
async function isFileConflicted(filePath) {
    const dir = path.dirname(filePath);
    try {
        const { stdout } = await execFileAsync('git', [
            '-C', dir,
            'status', '--porcelain', filePath
        ]);
        // Conflicted files have 'U' in either column, or 'AA', 'DD' etc.
        const statusCode = stdout.trim().slice(0, 2);
        return /[UAD][UAD]/.test(statusCode) || statusCode.includes('U');
    }
    catch {
        return false;
    }
}
/**
 * Get the last commit timestamp (unix epoch) for a specific file on a given ref.
 * Used as a heuristic for the Magic Suggest feature (future).
 */
async function getLastCommitTime(repoRoot, ref, relativeFilePath) {
    try {
        const { stdout } = await execFileAsync('git', [
            '-C', repoRoot,
            'log', '-1', '--format=%ct', ref, '--', relativeFilePath
        ]);
        const ts = parseInt(stdout.trim(), 10);
        return isNaN(ts) ? undefined : ts;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=gitHelper.js.map