import { readScene } from "../export/manuscript";
import { plainText } from "../prose/text";
import { StructuredOutputError } from "../provider/structured";
import type { Storage } from "../storage/storage";
import { type AnalysisDeps, analyzeScene } from "./pipeline";
import { withoutScene } from "./state";

/**
 * Analyses what changed, when the author stops, and only then (SPEC §5). Its state lives in the
 * database: a scene is queued for as long as its text differs from the text last analysed, so that
 * being offline, a rate limit, or closing the app can only delay the work, never lose it.
 */

export type QueueStatus =
  /** Everything that could be analysed was. */
  | "done"
  /** Offline or rate limited. The rest stays queued and is tried again by itself. */
  | "waiting"
  /** Refused, as with a bad key or no credit. It stays queued, and only the author can sort it out. */
  | "blocked"
  | "cancelled";

export interface QueueRun {
  readonly status: QueueStatus;
  readonly analyzed: readonly string[];
  /** The model's answer for these wasn't usable. They aren't tried again until their text changes. */
  readonly skipped: readonly string[];
  /** Scenes still queued, not counting the skipped ones. */
  readonly pending: number;
  readonly message: string | null;
}

export interface AnalysisQueueOptions {
  readonly storage: Storage;
  readonly projectId: string;
  /** The provider and model the author chose. The queue never picks another one (rule 10). */
  readonly analysis: Omit<AnalysisDeps, "signal">;
  /** How long without typing counts as a pause. */
  readonly pauseMs?: number;
  /** The first wait before trying again after `waiting`. It doubles each time, up to an hour. */
  readonly retryMs?: number;
  readonly onRun?: (run: QueueRun) => void;
  /** Something other than the model went wrong, as a failing database. */
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_PAUSE_MS = 60_000;
const DEFAULT_RETRY_MS = 5 * 60_000;
const LONGEST_RETRY_MS = 60 * 60_000;

export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class AnalysisQueue {
  private readonly changed = new Set<string>();
  /** Scene and hash pairs the model couldn't answer for. In memory: restarting the app retries them. */
  private readonly unusable = new Set<string>();
  /** Until the first run has looked at every scene: a crash can leave saved text with an old hash. */
  private checkedAll = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<QueueRun> | null = null;
  private following: Promise<void> | null = null;
  private controller = new AbortController();
  private runAgain = false;
  private stopped = false;
  private retryMs: number;

  constructor(private readonly options: AnalysisQueueOptions) {
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  }

  /** Called as the author writes. It only restarts a timer, so typing never reaches a model. */
  sceneEdited(sceneId: string): void {
    this.changed.add(sceneId);
    this.resetRetry();
    this.schedule(this.options.pauseMs ?? DEFAULT_PAUSE_MS);
  }

  sceneClosed(sceneId: string): void {
    this.changed.add(sceneId);
    this.resetRetry();
    this.schedule(0);
  }

  /** On opening a project, to pick up whatever is still queued from last time. */
  start(): void {
    this.schedule(0);
  }

  /** Resolves once whatever a timer started is over, including what's decided to do next. */
  async settled(): Promise<void> {
    await this.following;
  }

  /** Cancels what's in progress. A scene cut short stays queued, with its old data untouched. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimer();
    this.controller.abort();
    await this.running?.catch(() => {});
  }

  /** Runs now, or joins the run in progress. */
  run(): Promise<QueueRun> {
    if (this.running !== null) {
      return this.running;
    }
    this.clearTimer();
    this.controller = new AbortController();
    this.running = this.work(this.controller.signal).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private resetRetry(): void {
    this.retryMs = this.options.retryMs ?? DEFAULT_RETRY_MS;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    if (this.running !== null) {
      this.runAgain = true;
      return;
    }
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.following = this.runAndFollowUp();
    }, delayMs);
  }

  private async runAndFollowUp(): Promise<void> {
    try {
      const run = await this.run();
      this.options.onRun?.(run);
      if (this.runAgain) {
        this.runAgain = false;
        this.schedule(this.options.pauseMs ?? DEFAULT_PAUSE_MS);
      } else if (run.status === "waiting") {
        this.schedule(this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, LONGEST_RETRY_MS);
      } else if (run.status === "done") {
        this.resetRetry();
      }
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private async sceneText(sceneId: string): Promise<string> {
    return plainText(await readScene(this.options.storage, sceneId));
  }

  /** Brings the stored hashes up to date, reading only the scenes that may have changed. */
  private async refreshHashes(): Promise<void> {
    const { storage, projectId } = this.options;
    let sceneIds = [...this.changed];
    this.changed.clear();
    if (!this.checkedAll) {
      const chapters = await storage.listChapters(projectId);
      const lists = await Promise.all(chapters.map((chapter) => storage.listScenes(chapter.id)));
      sceneIds = lists.flat().map((scene) => scene.id);
    }
    for (const sceneId of sceneIds) {
      await storage.setSceneContentHash(sceneId, await hashText(await this.sceneText(sceneId)));
    }
    this.checkedAll = true;
  }

  private async work(signal: AbortSignal): Promise<QueueRun> {
    const { storage, projectId, analysis } = this.options;
    await this.refreshHashes();

    const analyzed: string[] = [];
    const skipped: string[] = [];
    let status: QueueStatus = "done";
    let message: string | null = null;

    for (const scene of await storage.listScenesToAnalyze(projectId)) {
      if (signal.aborted) {
        status = "cancelled";
        break;
      }
      const text = await this.sceneText(scene.id);
      const hash = await hashText(text);
      await storage.setSceneContentHash(scene.id, hash);
      const pair = `${scene.id}:${hash}`;
      if (this.unusable.has(pair)) {
        skipped.push(scene.id);
        continue;
      }
      const current = await storage.loadAnalysis(projectId);

      // An empty scene has nothing to ask about, and whatever it used to say is gone.
      if (text.trim() === "") {
        await storage.saveSceneAnalysis(projectId, scene.id, hash, withoutScene(current, scene.id));
        analyzed.push(scene.id);
        continue;
      }

      try {
        const { state } = await analyzeScene(
          current,
          { id: scene.id, title: scene.title, text },
          { ...analysis, signal },
        );
        await storage.saveSceneAnalysis(projectId, scene.id, hash, state);
        analyzed.push(scene.id);
      } catch (error) {
        if (!(error instanceof StructuredOutputError)) {
          throw error;
        }
        if (error.failure === "bad_answer") {
          this.unusable.add(pair);
          skipped.push(scene.id);
          continue;
        }
        message = error.message;
        if (signal.aborted) {
          status = "cancelled";
        } else {
          status = error.failure === "refused" ? "blocked" : "waiting";
        }
        break;
      }
    }

    const left = await storage.listScenesToAnalyze(projectId);
    return {
      status,
      analyzed,
      skipped,
      pending: left.filter((scene) => !skipped.includes(scene.id)).length,
      message,
    };
  }
}
