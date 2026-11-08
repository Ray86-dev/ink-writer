import type { SqlDriver, SqlRow, SqlValue } from "./driver";
import { type MigrationResult, migrate } from "./migrate";
import {
  type Chapter,
  InvalidInputError,
  type NewProject,
  type Project,
  type Scene,
  type Storage,
} from "./storage";

export interface SqlStorageOptions {
  readonly newId?: () => string;
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

export function createSqlStorage(driver: SqlDriver, options: SqlStorageOptions = {}): Storage {
  const newId = options.newId ?? (() => crypto.randomUUID());

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
        "SELECT * FROM chapters WHERE project_id = ? ORDER BY position, id",
        [projectId],
      );
      return rows.map(toChapter);
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
        "SELECT * FROM scenes WHERE chapter_id = ? ORDER BY position, id",
        [chapterId],
      );
      return rows.map(toScene);
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
