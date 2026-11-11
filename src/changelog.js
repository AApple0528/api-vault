import changelogMarkdown from '../CHANGELOG.md?raw';
import { findReleaseNotes } from './changelog-parser.js';

export function getLatestReleaseNotes(version) {
  return findReleaseNotes(changelogMarkdown, version);
}
