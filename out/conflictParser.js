"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseConflicts = parseConflicts;
exports.applyResolutions = applyResolutions;
exports.unresolvedCount = unresolvedCount;
// ─── Main parser ───────────────────────────────────────────────────────────
function parseConflicts(content) {
    const lines = content.split('\n');
    const hunks = [];
    const sections = [];
    let globalOursLabel = 'LOCAL';
    let globalTheirsLabel = 'REMOTE';
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith('<<<<<<<')) {
            // ── Parse conflict hunk ──────────────────────────────────────────────
            const oursLabel = extractLabel(line, '<<<<<<<');
            const startLine = i;
            const ours = [];
            const base = [];
            const theirs = [];
            let hasBase = false;
            let theirsLabel = 'REMOTE';
            let phase = 'ours';
            i++;
            while (i < lines.length) {
                const inner = lines[i];
                if (inner.startsWith('|||||||')) {
                    hasBase = true;
                    phase = 'base';
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
                if (phase === 'ours') {
                    ours.push(inner);
                }
                else if (phase === 'base') {
                    base.push(inner);
                }
                else if (phase === 'theirs') {
                    theirs.push(inner);
                }
                i++;
            }
            const isNonConflicting = (ours.length === 0 && theirs.length > 0) ||
                (theirs.length === 0 && ours.length > 0);
            const nonConflictingSide = isNonConflicting
                ? (ours.length === 0 ? 'theirs' : 'ours')
                : undefined;
            const hunk = {
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
                globalOursLabel = oursLabel;
                globalTheirsLabel = theirsLabel;
            }
            sections.push({ kind: 'conflict', hunkIndex: hunks.length });
            hunks.push(hunk);
        }
        else {
            // ── Context line – accumulate into the last or a new ContextSection ──
            const last = sections[sections.length - 1];
            if (last && last.kind === 'context') {
                last.lines.push(line);
            }
            else {
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
        }
        else {
            const h = hunks[sec.hunkIndex];
            fileLine += h.endLine - h.startLine + 1;
        }
    }
    const hasBase = hunks.some(h => h.base !== undefined);
    return { lines, hunks, sections, oursLabel: globalOursLabel, theirsLabel: globalTheirsLabel, hasBase };
}
// ─── Apply resolutions ─────────────────────────────────────────────────────
function applyResolutions(parsed) {
    const result = [];
    const hunkByStart = new Map(parsed.hunks.map(h => [h.startLine, h]));
    let i = 0;
    while (i < parsed.lines.length) {
        const hunk = hunkByStart.get(i);
        if (hunk) {
            if (!hunk.resolution) {
                for (let j = hunk.startLine; j <= hunk.endLine; j++) {
                    result.push(parsed.lines[j]);
                }
            }
            else {
                applyHunk(hunk, result);
            }
            i = hunk.endLine + 1;
        }
        else {
            result.push(parsed.lines[i]);
            i++;
        }
    }
    return result.join('\n');
}
function unresolvedCount(p) {
    return p.hunks.filter(h => !h.resolution).length;
}
// ─── Helpers ───────────────────────────────────────────────────────────────
function extractLabel(line, prefix) {
    return line.slice(prefix.length).trim() || prefix.replace(/[<>]/g, '');
}
function applyHunk(hunk, out) {
    if (!hunk.resolution) {
        return;
    }
    switch (hunk.resolution.kind) {
        case 'ours':
            out.push(...hunk.ours);
            break;
        case 'theirs':
            out.push(...hunk.theirs);
            break;
        case 'both':
            out.push(...hunk.ours, ...hunk.theirs);
            break;
        case 'both-reversed':
            out.push(...hunk.theirs, ...hunk.ours);
            break;
        case 'custom':
            out.push(hunk.resolution.text);
            break;
    }
}
//# sourceMappingURL=conflictParser.js.map