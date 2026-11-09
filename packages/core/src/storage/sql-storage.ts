import type { EntityType, FactCategory } from "../analysis/contract";
import type {
  AnalysisState,
  Entity,
  Fact,
  Issue,
  Mention,
  QuoteRef,
  Relation,
} from "../analysis/state";
import type { SqlDriver, SqlRow, SqlStatement, SqlValue } from "./driver";
import { type MigrationResult, migrate } from "./migrate";
import {
  type Chapter,
  InvalidInputError,
  type MoveDirection,
  type NewProject,
  type NewSnapshot,
  type Project,
  type Scene,
  type SnapshotInfo,
  type Storage,
} from "./storage";

export interface SqlStorageOptions {
  readonly newId?: () => string;
  readonly now?: () => number;
}

export interface OpenedStorage {
  readonly storage: Storage;
  readonly migration: MigrationResult;
}

function text(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Column "${column}" should be text`);
  }
  return value;
}

function textOrNull(row: SqlRow, column: string): string | null {
  return row[column] === null ? null : text(row, column);
}

function integer(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number") {
    throw new Error(`Column "${column}" should be a number`);
  }
  return value;
}

function blob(row: SqlRow, column: string): Uint8Array {
  const value = row[column];
  if (!(value instanceof Uint8Array)) {
    throw new Error(`Column "${column}" should be a blob`);
  }
  return value;
}

function required(field: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new InvalidInputError(field);
  }
  return trimmed;
}

const toProject = (row: SqlRow): Project => ({
  id: text(row, "id"),
  title: text(row, "title"),
  language: text(row, "language"),
  era: text(row, "era"),
});

const toChapter = (row: SqlRow): Chapter => ({
  id: text(row, "id"),
  projectId: text(row, "project_id"),
  position: integer(row, "position"),
  title: text(row, "title"),
  eraOverride: textOrNull(row, "era_override"),
});

const toScene = (row: SqlRow): Scene => ({
  id: text(row, "id"),
  chapterId: text(row, "chapter_id"),
  position: integer(row, "position"),
  title: text(row, "title"),
  status: text(row, "status"),
});

const toSnapshotInfo = (row: SqlRow): SnapshotInfo => ({
  id: text(row, "id"),
  sceneId: text(row, "scene_id"),
  createdAt: integer(row, "created_at"),
  label: textOrNull(row, "label"),
  wordCount: integer(row, "word_count"),
});

const toMention = (row: SqlRow): Mention => ({
  sceneId: text(row, "scene_id"),
  entityId: text(row, "entity_id"),
  quote: text(row, "quote"),
});

const toFact = (row: SqlRow): Fact => ({
  id: text(row, "id"),
  sceneId: text(row, "scene_id"),
  entityId: text(row, "entity_id"),
  category: text(row, "category") as FactCategory,
  attribute: text(row, "attribute"),
  value: text(row, "value"),
  quote: text(row, "quote"),
  sentence: text(row, "sentence"),
  storyTime: textOrNull(row, "story_time"),
  inDialogue: integer(row, "in_dialogue") === 1,
});

const toRelation = (row: SqlRow): Relation => ({
  id: text(row, "id"),
  sceneId: text(row, "scene_id"),
  fromEntityId: text(row, "from_entity"),
  toEntityId: text(row, "to_entity"),
  label: text(row, "label"),
  quote: text(row, "quote"),
});

function toIssue(row: SqlRow): Issue {
  const a: QuoteRef = { sceneId: text(row, "scene_a"), quote: text(row, "quote_a") };
  const reason = text(row, "reason");
  const kind = text(row, "kind");
  if (kind === "correction") {
    return { kind, a, fix: text(row, "fix"), reason };
  }
  if (kind !== "contradiction" && kind !== "name_variant") {
    throw new Error(`Unknown issue kind "${kind}"`);
  }
  return { kind, a, b: { sceneId: text(row, "scene_b"), quote: text(row, "quote_b") }, reason };
}

/** The project's scenes that aren't in the trash, by themselves or through their chapter. */
const LIVE_SCENES = `SELECT s.id FROM scenes s JOIN chapters c ON c.id = s.chapter_id
  WHERE c.project_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL`;

/** The columns of a snapshot without its data, which can be large. */
const SNAPSHOT_INFO = "id, scene_id, created_at, label, word_count";

export function createSqlStorage(driver: SqlDriver, options: SqlStorageOptions = {}): Storage {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => Date.now());

  /** One row from a write with `RETURNING`. */
  const insertOne = async <T>(
    sql: string,
    params: readonly SqlValue[],
    map: (row: SqlRow) => T,
  ): Promise<T> => {
    const [row] = await driver.query(sql, params);
    if (row === undefined) {
      throw new Error("The insert returned no row");
    }
    return map(row);
  };

  /** Swaps a row with its neighbour among the rows sharing its parent. */
  const swapWithNeighbour = async (
    table: "chapters" | "scenes",
    parentColumn: "project_id" | "chapter_id",
    id: string,
    direction: MoveDirection,
  ): Promise<void> => {
    const [self] = await driver.query(`SELECT ${parentColumn} FROM ${table} WHERE id = ?`, [id]);
    if (self === undefined) {
      return;
    }
    const rows = await driver.query(
      `SELECT id, position FROM ${table}
       WHERE ${parentColumn} = ? AND deleted_at IS NULL ORDER BY position, id`,
      [text(self, parentColumn)],
    );
    const index = rows.findIndex((row) => row.id === id);
    const a = rows[index];
    const b = rows[direction === "up" ? index - 1 : index + 1];
    if (a === undefined || b === undefined) {
      return;
    }
    await driver.transaction([
      {
        sql: `UPDATE ${table} SET position = ? WHERE id = ?`,
        params: [integer(b, "position"), text(a, "id")],
      },
      {
        sql: `UPDATE ${table} SET position = ? WHERE id = ?`,
        params: [integer(a, "position"), text(b, "id")],
      },
    ]);
  };

  return {
    createProject(project: NewProject) {
      // Inside a promise chain so that invalid input rejects instead of throwing synchronously.
      return Promise.resolve().then(() =>
        insertOne(
          "INSERT INTO projects (id, title, language, era) VALUES (?, ?, ?, ?) RETURNING *",
          [
            newId(),
            required("title", project.title),
            required("language", project.language),
            required("era", project.era),
          ],
          toProject,
        ),
      );
    },

    async listProjects() {
      const rows = await driver.query("SELECT * FROM projects ORDER BY title, id");
      return rows.map(toProject);
    },

    async getProject(id: string) {
      const [row] = await driver.query("SELECT * FROM projects WHERE id = ?", [id]);
      return row === undefined ? null : toProject(row);
    },

    // The position is computed inside the insert, so two calls in a row can't take the same one.
    createChapter(projectId: string, title: string) {
      return Promise.resolve().then(() =>
        insertOne(
          `INSERT INTO chapters (id, project_id, position, title)
           SELECT ?, ?, COALESCE(MAX(position), -1) + 1, ? FROM chapters WHERE project_id = ?
           RETURNING *`,
          [newId(), projectId, required("title", title), projectId],
          toChapter,
        ),
      );
    },

    async listChapters(projectId: string) {
      const rows = await driver.query(
        `SELECT * FROM chapters WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY position, id`,
        [projectId],
      );
      return rows.map(toChapter);
    },

    async renameChapter(id: string, title: string) {
      await driver.execute("UPDATE chapters SET title = ? WHERE id = ?", [
        required("title", title),
        id,
      ]);
    },

    moveChapter: (id, direction) => swapWithNeighbour("chapters", "project_id", id, direction),

    async trashChapter(id: string) {
      await driver.execute("UPDATE chapters SET deleted_at = ? WHERE id = ?", [now(), id]);
    },

    async restoreChapter(id: string) {
      await driver.execute("UPDATE chapters SET deleted_at = NULL WHERE id = ?", [id]);
    },

    createScene(chapterId: string, title: string) {
      return Promise.resolve().then(() =>
        insertOne(
          `INSERT INTO scenes (id, chapter_id, position, title)
           SELECT ?, ?, COALESCE(MAX(position), -1) + 1, ? FROM scenes WHERE chapter_id = ?
           RETURNING *`,
          [newId(), chapterId, required("title", title), chapterId],
          toScene,
        ),
      );
    },

    async listScenes(chapterId: string) {
      const rows = await driver.query(
        `SELECT id, chapter_id, position, title, status FROM scenes
         WHERE chapter_id = ? AND deleted_at IS NULL ORDER BY position, id`,
        [chapterId],
      );
      return rows.map(toScene);
    },

    async renameScene(id: string, title: string) {
      await driver.execute("UPDATE scenes SET title = ? WHERE id = ?", [
        required("title", title),
        id,
      ]);
    },

    moveScene: (id, direction) => swapWithNeighbour("scenes", "chapter_id", id, direction),

    async trashScene(id: string) {
      await driver.execute("UPDATE scenes SET deleted_at = ? WHERE id = ?", [now(), id]);
    },

    async restoreScene(id: string) {
      await driver.execute("UPDATE scenes SET deleted_at = NULL WHERE id = ?", [id]);
    },

    async listTrash(projectId: string) {
      const chapters = await driver.query(
        `SELECT * FROM chapters WHERE project_id = ? AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC, id`,
        [projectId],
      );
      const scenes = await driver.query(
        `SELECT s.id, s.chapter_id, s.position, s.title, s.status FROM scenes s
         JOIN chapters c ON c.id = s.chapter_id
         WHERE c.project_id = ? AND s.deleted_at IS NOT NULL
         ORDER BY s.deleted_at DESC, s.id`,
        [projectId],
      );
      return { chapters: chapters.map(toChapter), scenes: scenes.map(toScene) };
    },

    async appendSceneUpdate(sceneId: string, update: Uint8Array) {
      await driver.execute("INSERT INTO scene_updates (scene_id, update_data) VALUES (?, ?)", [
        sceneId,
        update,
      ]);
    },

    async loadSceneProse(sceneId: string) {
      const [scene] = await driver.query("SELECT ydoc, ydoc_version FROM scenes WHERE id = ?", [
        sceneId,
      ]);
      const rows = await driver.query(
        "SELECT id, update_data FROM scene_updates WHERE scene_id = ? ORDER BY id",
        [sceneId],
      );
      return {
        base: scene === undefined || scene.ydoc === null ? null : blob(scene, "ydoc"),
        baseVersion: scene === undefined ? 0 : integer(scene, "ydoc_version"),
        updates: rows.map((row) => ({ id: integer(row, "id"), data: blob(row, "update_data") })),
      };
    },

    async compactSceneProse(
      sceneId: string,
      base: Uint8Array,
      upToUpdateId: number,
      expectedBaseVersion: number,
    ) {
      const [replaced] = await driver.transaction([
        {
          sql: `UPDATE scenes SET ydoc = ?, ydoc_version = ydoc_version + 1
                WHERE id = ? AND ydoc_version = ?`,
          params: [base, sceneId, expectedBaseVersion],
        },
        {
          // Checks that the update above applied, so a refused base removes nothing from the log.
          sql: `DELETE FROM scene_updates WHERE scene_id = ? AND id <= ?
                AND (SELECT ydoc_version FROM scenes WHERE id = ?) = ?`,
          params: [sceneId, upToUpdateId, sceneId, expectedBaseVersion + 1],
        },
      ]);
      return replaced?.changes === 1;
    },

    createSnapshot(snapshot: NewSnapshot) {
      return insertOne(
        `INSERT INTO scene_snapshots (id, scene_id, created_at, ydoc, label, word_count)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING ${SNAPSHOT_INFO}`,
        [newId(), snapshot.sceneId, now(), snapshot.data, snapshot.label, snapshot.wordCount],
        toSnapshotInfo,
      );
    },

    async listSnapshots(sceneId: string) {
      const rows = await driver.query(
        `SELECT ${SNAPSHOT_INFO} FROM scene_snapshots WHERE scene_id = ?
         ORDER BY created_at DESC, id DESC`,
        [sceneId],
      );
      return rows.map(toSnapshotInfo);
    },

    async loadSnapshot(id: string) {
      const [row] = await driver.query("SELECT ydoc FROM scene_snapshots WHERE id = ?", [id]);
      return row === undefined ? null : blob(row, "ydoc");
    },

    async setSceneContentHash(sceneId: string, hash: string) {
      await driver.execute("UPDATE scenes SET content_hash = ? WHERE id = ?", [hash, sceneId]);
    },

    async listScenesToAnalyze(projectId: string) {
      const rows = await driver.query(
        `SELECT s.id, s.chapter_id, s.position, s.title, s.status FROM scenes s
         JOIN chapters c ON c.id = s.chapter_id
         WHERE c.project_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL
           AND s.content_hash IS NOT NULL AND s.content_hash IS NOT s.analyzed_hash
         ORDER BY c.position, c.id, s.position, s.id`,
        [projectId],
      );
      return rows.map(toScene);
    },

    async loadAnalysis(projectId: string) {
      const order = await driver.query(
        `SELECT s.id FROM scenes s JOIN chapters c ON c.id = s.chapter_id
         WHERE c.project_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL
         ORDER BY c.position, c.id, s.position, s.id`,
        [projectId],
      );
      const entityRows = await driver.query(
        "SELECT id, type, canonical_name FROM entities WHERE project_id = ? ORDER BY rowid",
        [projectId],
      );
      const aliasRows = await driver.query(
        `SELECT a.entity_id, a.alias FROM entity_aliases a JOIN entities e ON e.id = a.entity_id
         WHERE e.project_id = ? ORDER BY a.rowid`,
        [projectId],
      );
      const inLiveScene = `scene_id IN (${LIVE_SCENES})`;
      const mentions = await driver.query(
        `SELECT * FROM mentions WHERE ${inLiveScene} ORDER BY rowid`,
        [projectId],
      );
      const facts = await driver.query(`SELECT * FROM facts WHERE ${inLiveScene} ORDER BY rowid`, [
        projectId,
      ]);
      const relations = await driver.query(
        `SELECT * FROM relations WHERE ${inLiveScene} ORDER BY rowid`,
        [projectId],
      );
      const issues = await driver.query(
        `SELECT * FROM issues WHERE scene_a IN (${LIVE_SCENES})
         AND (scene_b IS NULL OR scene_b IN (${LIVE_SCENES})) ORDER BY rowid`,
        [projectId, projectId],
      );
      const entities: Entity[] = entityRows.map((row) => ({
        id: text(row, "id"),
        type: text(row, "type") as EntityType,
        canonicalName: text(row, "canonical_name"),
        aliases: aliasRows
          .filter((alias) => alias.entity_id === row.id)
          .map((alias) => text(alias, "alias")),
      }));
      return {
        entities,
        mentions: mentions.map(toMention),
        facts: facts.map(toFact),
        relations: relations.map(toRelation),
        issues: issues.map(toIssue),
        sceneOrder: order.map((row) => text(row, "id")),
      };
    },

    async saveSceneAnalysis(
      projectId: string,
      sceneId: string,
      analyzedHash: string,
      state: AnalysisState,
    ) {
      const statements: SqlStatement[] = [];
      for (const entity of state.entities) {
        statements.push({
          sql: `INSERT INTO entities (id, project_id, type, canonical_name) VALUES (?, ?, ?, ?)
                ON CONFLICT (id) DO NOTHING`,
          params: [entity.id, projectId, entity.type, entity.canonicalName],
        });
        for (const alias of entity.aliases) {
          statements.push({
            sql: `INSERT INTO entity_aliases (entity_id, alias, source) VALUES (?, ?, 'analysis')
                  ON CONFLICT DO NOTHING`,
            params: [entity.id, alias],
          });
        }
      }
      statements.push(
        { sql: "DELETE FROM mentions WHERE scene_id = ?", params: [sceneId] },
        { sql: "DELETE FROM facts WHERE scene_id = ?", params: [sceneId] },
        { sql: "DELETE FROM relations WHERE scene_id = ?", params: [sceneId] },
        { sql: "DELETE FROM issues WHERE scene_a = ? OR scene_b = ?", params: [sceneId, sceneId] },
      );
      for (const mention of state.mentions.filter((item) => item.sceneId === sceneId)) {
        statements.push({
          sql: `INSERT INTO mentions (scene_id, entity_id, quote) VALUES (?, ?, ?)
                ON CONFLICT DO NOTHING`,
          params: [sceneId, mention.entityId, mention.quote],
        });
      }
      for (const fact of state.facts.filter((item) => item.sceneId === sceneId)) {
        statements.push({
          sql: `INSERT INTO facts
                (id, scene_id, entity_id, category, attribute, value, quote, sentence, story_time,
                 in_dialogue)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            fact.id,
            sceneId,
            fact.entityId,
            fact.category,
            fact.attribute,
            fact.value,
            fact.quote,
            fact.sentence,
            fact.storyTime,
            fact.inDialogue ? 1 : 0,
          ],
        });
      }
      for (const relation of state.relations.filter((item) => item.sceneId === sceneId)) {
        statements.push({
          sql: `INSERT INTO relations (id, scene_id, from_entity, to_entity, label, quote)
                VALUES (?, ?, ?, ?, ?, ?)`,
          params: [
            relation.id,
            sceneId,
            relation.fromEntityId,
            relation.toEntityId,
            relation.label,
            relation.quote,
          ],
        });
      }
      const citesScene = (issue: Issue) =>
        issue.a.sceneId === sceneId || ("b" in issue && issue.b.sceneId === sceneId);
      for (const issue of state.issues.filter(citesScene)) {
        const b = "b" in issue ? issue.b : null;
        statements.push({
          sql: `INSERT INTO issues (id, kind, scene_a, quote_a, scene_b, quote_b, fix, reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            newId(),
            issue.kind,
            issue.a.sceneId,
            issue.a.quote,
            b?.sceneId ?? null,
            b?.quote ?? null,
            "fix" in issue ? issue.fix : null,
            issue.reason,
          ],
        });
      }
      statements.push({
        sql: "UPDATE scenes SET analyzed_hash = ? WHERE id = ?",
        params: [analyzedHash, sceneId],
      });
      await driver.transaction(statements);
    },
  };
}

/** Migrates first, so that no caller can reach a database on an old schema. */
export async function openSqlStorage(
  driver: SqlDriver,
  options: SqlStorageOptions = {},
): Promise<OpenedStorage> {
  const migration = await migrate(driver);
  return { storage: createSqlStorage(driver, options), migration };
}
