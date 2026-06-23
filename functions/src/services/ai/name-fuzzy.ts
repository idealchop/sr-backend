/**
 * Lightweight fuzzy helpers (replaces legacy Fuse.js usage for small tenant lists).
 */

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/** Similarity ratio 0 = identical, 1 = very different */
export function nameDissimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na.length && !nb.length) return 0;
  const d = levenshtein(na, nb);
  const denom = Math.max(na.length, nb.length, 1);
  return d / denom;
}

export function nameSimilarityPercent(a: string, b: string): number {
  return Math.round((1 - nameDissimilarity(a, b)) * 100);
}

export function namesAreDuplicateLike(
  a: string,
  b: string,
  maxRatio = 0.22,
): boolean {
  return nameDissimilarity(a, b) < maxRatio;
}
