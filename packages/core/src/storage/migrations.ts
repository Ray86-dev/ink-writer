import type { Migration } from "./migrate";

/**
 * SPEC §4 is a guide, so each table arrives with the milestone that first uses it. Prose isn't here
 * yet: M2 decides how Yjs documents are stored.
 *
 * `ON DELETE RESTRICT` throughout: removing a chapter must never take its scenes with it silently.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "project_structure",
    statements: [
      `CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        language TEXT NOT NULL,
        era TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        era_override TEXT
      ) STRICT`,
      "CREATE INDEX chapters_by_project ON chapters (project_id, position)",
      `CREATE TABLE scenes (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL REFERENCES chapters (id) ON DELETE RESTRICT,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
      ) STRICT`,
      "CREATE INDEX scenes_by_chapter ON scenes (chapter_id, position)",
    ],
  },
  {
    version: 2,
    name: "prose_and_history",
    // See docs/adr/0010: prose is append-only, and nothing is ever overwritten in place.
    statements: [
      "ALTER TABLE chapters ADD COLUMN deleted_at INTEGER",
      "ALTER TABLE scenes ADD COLUMN deleted_at INTEGER",
      "ALTER TABLE scenes ADD COLUMN ydoc BLOB",
      "ALTER TABLE scenes ADD COLUMN ydoc_version INTEGER NOT NULL DEFAULT 0",
      // AUTOINCREMENT: an ID is never reused, so compaction's upper bound stays meaningful.
      `CREATE TABLE scene_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE RESTRICT,
        update_data BLOB NOT NULL
      ) STRICT`,
      "CREATE INDEX scene_updates_by_scene ON scene_updates (scene_id, id)",
      `CREATE TABLE scene_snapshots (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE RESTRICT,
        created_at INTEGER NOT NULL,
        ydoc BLOB NOT NULL,
        label TEXT,
        word_count INTEGER NOT NULL
      ) STRICT`,
      "CREATE INDEX scene_snapshots_by_scene ON scene_snapshots (scene_id, created_at)",
    ],
  },
  {
    version: 3,
    name: "analysis",
    // See docs/adr/0011. Quotes rather than Yjs anchors for now: M4 is what needs to place them.
    statements: [
      "ALTER TABLE scenes ADD COLUMN content_hash TEXT",
      "ALTER TABLE scenes ADD COLUMN analyzed_hash TEXT",
      `CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
        type TEXT NOT NULL,
        canonical_name TEXT NOT NULL
      ) STRICT`,
      "CREATE INDEX entities_by_project ON entities (project_id)",
      `CREATE TABLE entity_aliases (
        entity_id TEXT NOT NULL REFERENCES entities (id) ON DELETE RESTRICT,
        alias TEXT NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (entity_id, alias)
      ) STRICT`,
      `CREATE TABLE mentions (
        scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE RESTRICT,
        entity_id TEXT NOT NULL REFERENCES entities (id) ON DELETE RESTRICT,
        quote TEXT NOT NULL,
        PRIMARY KEY (scene_id, entity_id, quote)
      ) STRICT`,
      `CREATE TABLE facts (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE RESTRICT,
        entity_id TEXT NOT NULL REFERENCES entities (id) ON DELETE RESTRICT,
        category TEXT NOT NULL,
        attribute TEXT NOT NULL,
        value TEXT NOT NULL,
        quote TEXT NOT NULL,
        sentence TEXT NOT NULL,
        story_time TEXT,
        in_dialogue INTEGER NOT NULL CHECK (in_dialogue IN (0, 1))
      ) STRICT`,
      "CREATE INDEX facts_by_scene ON facts (scene_id)",
      `CREATE TABLE relations (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE RESTRICT,
        from_entity TEXT NOT NULL REFERENCES entities (id) ON DELETE RESTRICT,
        to_entity TEXT NOT NULL REFERENCES entities (id) ON DELETE RESTRICT,
        label TEXT NOT NULL,
        quote TEXT NOT NULL
      ) STRICT`,
      "CREATE INDEX relations_by_scene ON relations (scene_id)",
      `CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        scene_a TEXT NOT NULL REFERENCES scenes (id) ON DELETE RESTRICT,
        quote_a TEXT NOT NULL,
        scene_b TEXT REFERENCES scenes (id) ON DELETE RESTRICT,
        quote_b TEXT,
        fix TEXT,
        reason TEXT NOT NULL
      ) STRICT`,
      "CREATE INDEX issues_by_scene_a ON issues (scene_a)",
      "CREATE INDEX issues_by_scene_b ON issues (scene_b)",
    ],
  },
];
