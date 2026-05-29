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
        changedLineRanges: []
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

    const newStart = Number(hunkMatch.groups.newStart);
    const newCount = Number(hunkMatch.groups.newCount ?? '1');

    if (newCount > 0) {
      currentFile.changedLineRanges.push({
        start: newStart,
        end: newStart + newCount - 1
      });
    }
  }

  return files;
}

export function rangesOverlap(a, b) {
  return a.start <= b.end && b.start <= a.end;
}
