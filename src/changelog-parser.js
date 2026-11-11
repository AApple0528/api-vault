export function parseChangelog(markdown) {
  const releases = [];
  let current = null;

  for (const rawLine of String(markdown || '').split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(v\d+\.\d+\.\d+)(?:\s+-\s+(.*))?$/i);
    if (heading) {
      current = { version: heading[1], date: heading[2] || '', changes: [] };
      releases.push(current);
      continue;
    }
    const change = rawLine.match(/^\s*[-*]\s+(.+)$/);
    if (current && change) current.changes.push(change[1].trim());
  }

  return releases;
}

export function findReleaseNotes(markdown, version) {
  const releases = parseChangelog(markdown);
  return releases.find(release => release.version.toLowerCase() === String(version).toLowerCase()) || releases[0] || null;
}
