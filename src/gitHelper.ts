/**
 * gitHelper.ts
 *
 * Thin wrapper around git CLI commands needed by the merge editor.
 * (c) 2026 FUTURE[code] - Markus Feilen
 */

import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitInfo {
  /** Absolute path to the repo root */
  repoRoot: string;
  /** Current branch name */
  currentBranch: string;
  /** Merge head branch/commit (the branch being merged in) */
  mergeHead: string | undefined;
}

/**
 * Detect the git repository root for a given file path.
 */
export async function findRepoRoot(filePath: string): Promise<string | undefined> {
  const dir = path.dirname(filePath);
  try {
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Gather basic git info for a file's repository.
 */
export async function getGitInfo(filePath: string): Promise<GitInfo | undefined> {
  const repoRoot = await findRepoRoot(filePath);
  if (!repoRoot) { return undefined; }

  let currentBranch = 'HEAD';
  let mergeHead: string | undefined;

  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
    currentBranch = stdout.trim();
  } catch { /* ignore */ }

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
    } catch {
      mergeHead = mergeHeadHash.slice(0, 8); // fallback: short hash
    }
  }

  return { repoRoot, currentBranch, mergeHead };
}

/**
 * Mark a file as resolved in git's index (equivalent to `git add <file>`).
 */
export async function markResolved(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await execFileAsync('git', ['-C', dir, 'add', filePath]);
}

/**
 * Check if a file is currently listed as conflicted in git status.
 */
export async function isFileConflicted(filePath: string): Promise<boolean> {
  const dir = path.dirname(filePath);
  try {
    const { stdout } = await execFileAsync('git', [
      '-C', dir,
      'status', '--porcelain', filePath
    ]);
    // Conflicted files have 'U' in either column, or 'AA', 'DD' etc.
    const statusCode = stdout.trim().slice(0, 2);
    return /[UAD][UAD]/.test(statusCode) || statusCode.includes('U');
  } catch {
    return false;
  }
}

/**
 * Get the last commit timestamp (unix epoch) for a specific file on a given ref.
 * Used as a heuristic for the Magic Suggest feature (future).
 */
export async function getLastCommitTime(
  repoRoot: string,
  ref: string,
  relativeFilePath: string
): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C', repoRoot,
      'log', '-1', '--format=%ct', ref, '--', relativeFilePath
    ]);
    const ts = parseInt(stdout.trim(), 10);
    return isNaN(ts) ? undefined : ts;
  } catch {
    return undefined;
  }
}
