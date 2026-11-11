import type { SourceKindName } from 'newspa-paper';

/**
 * The three skeletons the sources panel inserts for a new source (WP14).
 *
 * They are **JSON text, not form defaults**, because the file is the truth
 * (D-011, D-025) and the config schema is the validator (D-014): what lands in
 * the textarea is what `POST /api/sources` posts and `parseSourceJson` judges,
 * so the skeleton and the poller can never disagree about what a source is.
 *
 * Every skeleton declares the same placeholder id, `new-source`, because the id
 * **is** the filename: the server writes `<id>.json`, so the first thing the
 * reader must edit is the id, and the file appears where the id says it appears.
 * `cadenceMinutes: 20` is stated rather than left to the schema's default for
 * the same reason a skeleton should show the knobs the reader is about to use.
 *
 * `json` carries `itemsPath` and `fields`, and `html` carries `list` and
 * `fields`, because those are the fields the parser needs to find items at all:
 * a skeleton that omitted them would be a source that polls and prints nothing.
 */
export const SOURCE_TEMPLATES: Readonly<Record<SourceKindName, string>> = {
  rss: `{
  "id": "new-source",
  "label": "New source",
  "url": "https://example.test/feed.xml",
  "kind": "rss",
  "cadenceMinutes": 20,
  "weight": 2,
  "section": "New"
}`,
  json: `{
  "id": "new-source",
  "label": "New source",
  "url": "https://example.test/api/items",
  "kind": "json",
  "cadenceMinutes": 20,
  "weight": 2,
  "section": "New",
  "itemsPath": "data.items",
  "fields": {
    "title": "title",
    "link": "url",
    "date": "publishedAt"
  }
}`,
  html: `{
  "id": "new-source",
  "label": "New source",
  "url": "https://example.test/news",
  "kind": "html",
  "cadenceMinutes": 20,
  "weight": 2,
  "section": "New",
  "list": "main article",
  "fields": {
    "title": "h2",
    "link": "a",
    "date": "time"
  },
  "strip": [
    "script",
    "noscript"
  ]
}`,
};
