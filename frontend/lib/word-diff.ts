/**
 * Minimal word-level diff (longest common subsequence), with no dependencies.
 *
 * Privacy policies are a few hundred to a few thousand words, so an O(n·m)
 * table is fast enough. Above MAX_TOKENS the inputs are compared sentence by
 * sentence instead, which keeps memory bounded on very long documents.
 */

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

const MAX_TOKENS = 4000;

function tokenize(text: string, bySentence: boolean): string[] {
  // Keep whitespace as its own token so the output reads exactly like the source.
  return bySentence ? text.split(/(?<=[.!?])(\s+)/) : text.split(/(\s+)/);
}

function lcsDiff(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:], stored in a flat typed array.
  const dp = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j] ? dp[at(i + 1, j + 1)]! + 1 : Math.max(dp[at(i + 1, j)]!, dp[at(i, j + 1)]!);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (dp[at(i + 1, j)]! >= dp[at(i, j + 1)]!) {
      push("removed", a[i]!);
      i++;
    } else {
      push("added", b[j]!);
      j++;
    }
  }
  while (i < n) push("removed", a[i++]!);
  while (j < m) push("added", b[j++]!);
  return out;
}

/**
 * Group a run of edits into one "removed" block followed by one "added" block,
 * so "[-are][+may] [-never][+be]" reads as "[-are never][+may be]". Whitespace
 * between edits joins both sides; whitespace-only edits are shown as plain text.
 */
function group(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  let removed = "";
  let added = "";
  let gap = "";
  const emit = (kind: DiffPart["kind"], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  const flush = () => {
    if (removed.trim()) emit("removed", removed);
    if (added.trim()) emit("added", added);
    else emit("same", added);
    removed = "";
    added = "";
  };
  for (const p of parts) {
    if (p.kind === "same") {
      if (p.text.trim() === "" && (removed || added)) {
        gap += p.text;
        continue;
      }
      flush();
      emit("same", gap + p.text);
      gap = "";
      continue;
    }
    if (gap) {
      removed += gap;
      added += gap;
      gap = "";
    }
    if (p.kind === "removed") removed += p.text;
    else added += p.text;
  }
  flush();
  emit("same", gap);
  return out;
}

export function diffWords(oldText: string, newText: string): DiffPart[] {
  let a = tokenize(oldText, false);
  let b = tokenize(newText, false);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    a = tokenize(oldText, true);
    b = tokenize(newText, true);
  }
  return group(lcsDiff(a, b));
}
