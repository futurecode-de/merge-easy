/**
 * conflictParser.ts
 *
 * Parses a git-conflict-marked file into structured sections:
 *   - ContextSection  : lines unchanged / already resolved (outside markers)
 *   - ConflictSection : a <<<<<<< … >>>>>>> block
 *
 * Supports standard and diff3 (||||||| base) conflict styles.
 *
 * (c) 2026 FUTURE[code] - Markus Feilen
 */

// ─── Public types ──────────────────────────────────────────────────────────

export interface ConflictHunk {
  index: number;
  /** Line index of the <<<<<<< marker in the original file */
  startLine: number;
  /** Line index of the >>>>>>> marker in the original file */
  endLine: number;
  ours:   string[];
  base:   string[] | undefined;  // only with diff3 style
  theirs: string[];
  oursLabel:   string;
  theirsLabel: string;
  resolution:  Resolution | undefined;
  /** True when only one side has content (git auto-resolvable) */
  isNonConflicting: boolean;
  /** Which side has the real change (only set when isNonConflicting) */
  nonConflictingSide: 'ours' | 'theirs' | undefined;
}

export type Resolution =
  | { kind: 'ours' }
  | { kind: 'theirs' }
  | { kind: 'both' }
  | { kind: 'both-reversed' }
  | { kind: 'custom'; text: string };

/** A run of lines that are the same in all three versions */
export interface ContextSection {
  kind: 'context';
  lines: string[];
  /** 1-based line number of the first line in the conflict file */
  fileLineStart: number;
}

/** A conflict block (<<<<<<< … >>>>>>>) */
export interface ConflictSection {
  kind: 'conflict';
  hunkIndex: number;
}

export type FileSection = ContextSection | ConflictSection;

export interface ParsedFile {
  lines:        string[];
  hunks:        ConflictHunk[];
  sections:     FileSection[];
  oursLabel:    string;
  theirsLabel:  string;
  hasBase:      boolean;
}

// ─── Main parser ───────────────────────────────────────────────────────────
export function parseConflicts(content: string): ParsedFile {
  const lines  = content.split('\n');
  const hunks:    ConflictHunk[] = [];
  const sections: FileSection[]  = [];

  let globalOursLabel   = 'LOCAL';
  let globalTheirsLabel = 'REMOTE';

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('<<<<<<<')) {
      // ── Parse conflict hunk ──────────────────────────────────────────────
      const oursLabel  = extractLabel(line, '<<<<<<<');
      const startLine  = i;
      const ours: string[]  = [];
      const base: string[]  = [];
      const theirs: string[]= [];
      let hasBase        = false;
      let theirsLabel    = 'REMOTE';
      let phase: 'ours' | 'base' | 'theirs' = 'ours';

      i++;
      while (i < lines.length) {
        const inner = lines[i];

        if (inner.startsWith('|||||||')) {
          hasBase = true;
          phase   = 'base';
          i++;
          continue;
        }
        if (inner.startsWith('=======')) {
          phase = 'theirs';
          i++;
          continue;
        }
        if (inner.startsWith('>>>>>>>')) {
          theirsLabel = extractLabel(inner, '>>>>>>>');
          break;
        }

        if (phase === 'ours')   { ours.push(inner); }
        else if (phase === 'base')   { base.push(inner); }
        else if (phase === 'theirs') { theirs.push(inner); }

        i++;
      }

      const isNonConflicting =
        (ours.length === 0 && theirs.length > 0) ||
        (theirs.length === 0 && ours.length > 0);
      const nonConflictingSide: ConflictHunk['nonConflictingSide'] =
        isNonConflicting
          ? (ours.length === 0 ? 'theirs' : 'ours')
          : undefined;

      const hunk: ConflictHunk = {
        index: hunks.length,
        startLine,
        endLine: i,
        ours,
        base: hasBase ? base : undefined,
        theirs,
        oursLabel,
        theirsLabel,
        resolution: undefined,
        isNonConflicting,
        nonConflictingSide,
      };

      if (hunks.length === 0) {
        globalOursLabel   = oursLabel;
        globalTheirsLabel = theirsLabel;
      }

      sections.push({ kind: 'conflict', hunkIndex: hunks.length });
      hunks.push(hunk);
    } else {
      // ── Context line – accumulate into the last or a new ContextSection ──
      const last = sections[sections.length - 1];
      if (last && last.kind === 'context') {
        last.lines.push(line);
      } else {
        sections.push({ kind: 'context', lines: [line], fileLineStart: i + 1 });
      }
    }

    i++;
  }

  // Fix fileLineStart for each context section (after we know all positions)
  let fileLine = 1;
  for (const sec of sections) {
    if (sec.kind === 'context') {
      sec.fileLineStart = fileLine;
      fileLine += sec.lines.length;
    } else {
      const h = hunks[sec.hunkIndex];
      fileLine += h.endLine - h.startLine + 1;
    }
  }

  const hasBase = hunks.some(h => h.base !== undefined);

  return { lines, hunks, sections, oursLabel: globalOursLabel, theirsLabel: globalTheirsLabel, hasBase };
}

// ─── Apply resolutions ─────────────────────────────────────────────────────

export function applyResolutions(parsed: ParsedFile): string {
  const result: string[] = [];
  const hunkByStart = new Map(parsed.hunks.map(h => [h.startLine, h]));

  let i = 0;
  while (i < parsed.lines.length) {
    const hunk = hunkByStart.get(i);
    if (hunk) {
      if (!hunk.resolution) {
        for (let j = hunk.startLine; j <= hunk.endLine; j++) { result.push(parsed.lines[j]); }
      } else {
        applyHunk(hunk, result);
      }
      i = hunk.endLine + 1;
    } else {
      result.push(parsed.lines[i]);
      i++;
    }
  }
  return result.join('\n');
}

export function unresolvedCount(p: ParsedFile): number {
  return p.hunks.filter(h => !h.resolution).length;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractLabel(line: string, prefix: string): string {
  return line.slice(prefix.length).trim() || prefix.replace(/[<>]/g, '');
}

function applyHunk(hunk: ConflictHunk, out: string[]): void {
  if (!hunk.resolution) { return; }
  switch (hunk.resolution.kind) {
    case 'ours':          out.push(...hunk.ours);  break;
    case 'theirs':        out.push(...hunk.theirs); break;
    case 'both':          out.push(...hunk.ours, ...hunk.theirs); break;
    case 'both-reversed': out.push(...hunk.theirs, ...hunk.ours); break;
    case 'custom':        out.push(hunk.resolution.text); break;
  }
}
