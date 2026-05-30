const DIFF_FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(?<oldStart>\d+)(?:,(?<oldCount>\d+))? \+(?<newStart>\d+)(?:,(?<newCount>\d+))? @@/;

export function parseUnifiedDiff(diffText) {
  const files = [];
  let currentFile = null;

  for (const line of diffText.split('\n')) {
    const fileMatch = line.match(DIFF_FILE_HEADER);

    if (fileMatch) {
      currentFile = {
        oldPath: fileMatch[1],
        newPath: fileMatch[2],
        changedLineRanges: [],
        oldChangedLineRanges: [],
        newChangedLineRanges: []
      };
      files.push(currentFile);
      continue;
    }

    if (!currentFile) {
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER);
    if (!hunkMatch) {
      continue;
    }

    const oldStart = Number(hunkMatch.groups.oldStart);
    const oldCount = Number(hunkMatch.groups.oldCount ?? '1');
    const newStart = Number(hunkMatch.groups.newStart);
    const newCount = Number(hunkMatch.groups.newCount ?? '1');

    if (oldCount > 0) {
      currentFile.oldChangedLineRanges.push({
        start: oldStart,
        end: oldStart + oldCount - 1
      });
    }

    if (newCount > 0) {
      const range = {
        start: newStart,
        end: newStart + newCount - 1
      };

      currentFile.changedLineRanges.push(range);
      currentFile.newChangedLineRanges.push(range);
    }
  }

  return files;
}

export function rangesOverlap(a, b) {
  return a.start <= b.end && b.start <= a.end;
}
