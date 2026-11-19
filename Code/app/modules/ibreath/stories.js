// stories.js — the optional iBreath "stories" feature: reading the story file.
//
// A story file is a CSV with the columns
//   story_number          (required) — identifies the story in the data
//   story                 (required) — the text shown before a trial
//   randomization_group   (optional) — the experimenter picks one group;
//                                      without the column, all stories count
// Comma-, semicolon- or tab-separated (whatever the header line uses — German
// Excel writes semicolons), quoted fields with "" escapes and line breaks,
// UTF-8 with or without BOM. Column names are matched case-insensitively.
//
// Used by the experimenter window; the scene window gets the chosen group's
// stories with Start (see ibreath.js #assignStories).

export const DEFAULT_STORY_FILE = 'ib_stories/story_randomization.csv';   // relative to app/
export const ALL_STORIES = '__all__';   // group key when the file has no randomization_group column

/** RFC 4180-style CSV → array of rows (arrays of strings). */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim = [',', ';', '\t'].reduce((best, d) =>
    countOutsideQuotes(firstLine, d) > countOutsideQuotes(firstLine, best) ? d : best, ',');

  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i += (c === '\r' && text[i + 1] === '\n') ? 2 : 1;
      continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));   // drop blank lines
}

function countOutsideQuotes(line, ch) {
  let n = 0, quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n++;
  }
  return n;
}

/**
 * Story file text → { ok: true, groups, hasGroupColumn, warnings }
 *                 | { ok: false, error }.
 * `groups`: Map(groupKey → [{ number, text, group }]) in file order, keys
 * sorted naturally ("2" before "10"); ALL_STORIES is the only key without a
 * randomization_group column.
 */
export function parseStoryFile(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { ok: false, error: 'no stories in the file (needs a header row and at least one story)' };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iNum = col('story_number'), iText = col('story'), iGroup = col('randomization_group');
  const missing = [['story_number', iNum], ['story', iText]].filter(([, i]) => i < 0).map(([n]) => n);
  if (missing.length) return { ok: false, error: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')} (found: ${rows[0].join(', ')})` };

  const warnings = [];
  const groups = new Map();
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const number = (r[iNum] ?? '').trim();
    const text = (r[iText] ?? '').trim();
    if (!number || !text) { skipped++; continue; }
    const group = iGroup >= 0 ? (r[iGroup] ?? '').trim() : ALL_STORIES;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ number, text, group: iGroup >= 0 ? group : '' });
  }
  if (skipped) warnings.push(`${skipped} row${skipped > 1 ? 's' : ''} without story_number or story skipped`);
  if (groups.size === 0) return { ok: false, error: 'no usable stories (every row lacks story_number or story)' };

  for (const [g, list] of groups) {
    const seen = new Set(), dup = new Set();
    for (const s of list) (seen.has(s.number) ? dup : seen).add(s.number);
    if (dup.size) warnings.push(`duplicate story_number in ${g === ALL_STORIES ? 'the file' : `group ${g}`}: ${[...dup].join(', ')}`);
  }

  const sorted = new Map([...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
  return { ok: true, groups: sorted, hasGroupColumn: iGroup >= 0, warnings };
}

/** Fisher–Yates shuffle (new array). */
export function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
