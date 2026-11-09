/**
 * Runs the analysis over a test novel and scores it against `fixtures/README.md`.
 *
 *   npm run eval -- --provider ollama --model gemma4:e2b
 *   npm run eval -- --provider openrouter --model nvidia/nemotron-3.5-super-vl:free
 *
 * OpenRouter only accepts free models here. Each run is recorded in `fixtures/results/`.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AnalysisDeps, analyzeScene, type SceneToAnalyze } from "../src/analysis/pipeline";
import { emptyState } from "../src/analysis/state";
import { createOllamaProvider } from "../src/provider/ollama";
import { createOpenRouterProvider } from "../src/provider/openrouter";
import type { AiProvider, GenerateEvent, GenerateRequest } from "../src/provider/provider";
import { StructuredOutputError } from "../src/provider/structured";
import { readAll } from "../src/provider/transport";
import { withCache } from "./cache";
import {
  assertAllowance,
  assertFreeModel,
  assertNoCost,
  type DailyAllowance,
  estimateRequests,
  SpendingRefused,
} from "./guard";
import { createNodeTransport } from "./node-transport";
import { type Expected, type Score, scoreAnalysis, THRESHOLDS } from "./score";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CACHE = join(import.meta.dirname, ".cache");
const RESULTS = join(ROOT, "fixtures", "results");

/** Where `npm run eval:login` keeps the key: in the user's own folder, never in the repository. */
export const KEY_FILE = join(
  process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"),
  "ink-writer-dev",
  "openrouter-key",
);

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const flag = (name: string) => process.argv.includes(`--${name}`);

async function readAllowance(
  transport: ReturnType<typeof createNodeTransport>,
): Promise<DailyAllowance | null> {
  const response = await transport.send({
    route: "openrouter",
    method: "GET",
    path: "/api/v1/key",
  });
  const body = JSON.parse(await readAll(response.body)) as {
    data?: { free_model_daily_requests?: DailyAllowance };
  };
  return body.data?.free_model_daily_requests ?? null;
}

/** Writes each question and its answer to a file, to see why a run went as it did. */
function withTrace(provider: AiProvider, file: string): AiProvider {
  writeFileSync(file, "");
  return {
    ...provider,
    listModels: () => provider.listModels(),
    async *generate(request: GenerateRequest): AsyncGenerator<GenerateEvent> {
      let text = "";
      for await (const event of provider.generate(request)) {
        if (event.type === "text") {
          text += event.delta;
        }
        // Before the end event, as a reader can stop at that one and never come back here.
        if (event.type === "end") {
          appendFileSync(
            file,
            `=== ${request.structured?.name ?? "text"}\n${request.input}\n--- answer\n${text}\n\n`,
          );
        }
        yield event;
      }
    },
  };
}

interface RunRecord {
  readonly date: string;
  readonly novel: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
  readonly score: Score;
  readonly requests: number;
  readonly seconds: number;
}

function previousRecord(novel: string, provider: string, model: string): RunRecord | null {
  if (!existsSync(RESULTS)) {
    return null;
  }
  const files = readdirSync(RESULTS)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const file of files.reverse()) {
    const record = JSON.parse(readFileSync(join(RESULTS, file), "utf8")) as RunRecord;
    if (record.novel === novel && record.provider === provider && record.model === model) {
      return record;
    }
  }
  return null;
}

function printScore(score: Score, previous: RunRecord | null): void {
  const mark = (ok: boolean) => (ok ? "ok " : "NO ");
  const { mustFlag, falseAlarms, references } = score;
  const row = (ok: boolean, label: string, value: string, before?: string) =>
    console.log(`  ${mark(ok)} ${label}: ${value}${before ? `   (antes: ${before})` : ""}`);
  const old = previous?.score;
  console.log("\nResultado");
  row(
    mustFlag.found.length >= THRESHOLDS.mustFlagAtLeast,
    `Contradicciones detectadas (mínimo ${THRESHOLDS.mustFlagAtLeast})`,
    `${mustFlag.found.length} de ${mustFlag.found.length + mustFlag.missed.length}`,
    old && String(old.mustFlag.found.length),
  );
  if (mustFlag.missed.length > 0) console.log(`       faltan: ${mustFlag.missed.join(", ")}`);
  row(
    falseAlarms.length <= THRESHOLDS.falseAlarmsAtMost,
    `Falsas alarmas (máximo ${THRESHOLDS.falseAlarmsAtMost})`,
    String(falseAlarms.length),
    old && String(old.falseAlarms.length),
  );
  if (falseAlarms.length > 0) console.log(`       ${falseAlarms.join(", ")}`);
  row(
    score.inventedQuotes === 0,
    "Citas inventadas conservadas (máximo 0)",
    String(score.inventedQuotes),
  );
  row(
    !score.twoLuisMerged,
    "Dos personas con un mismo nombre, separadas",
    score.twoLuisMerged ? "fusionadas" : "sí",
  );
  row(
    references.found >= THRESHOLDS.referencesAtLeast,
    `Referencias resueltas (mínimo ${THRESHOLDS.referencesAtLeast})`,
    `${references.found} de ${references.total}`,
    old && String(old.references.found),
  );
  if (references.missed.length > 0) console.log(`       faltan: ${references.missed.join(" | ")}`);
  console.log(`  ·   Citas no literales descartadas: ${score.discardedQuotes}`);
  console.log(`  ·   Otros avisos, no esperados ni prohibidos: ${score.extraIssues}`);
  console.log(score.passed ? "\nSUPERA los umbrales." : "\nNo supera los umbrales.");
}

async function main(): Promise<void> {
  const providerName = option("provider");
  const model = option("model");
  if ((providerName !== "ollama" && providerName !== "openrouter") || model === undefined) {
    console.error(
      "Uso: npm run eval -- --provider ollama|openrouter --model <modelo> [--novel <novela>] [--no-think] [--verbose] [--cache-only] [--trace <archivo>]",
    );
    process.exit(2);
  }
  const verbose = flag("verbose");

  const novel = option("novel") ?? "la-veda";
  const dir = join(ROOT, "fixtures", novel);
  const manuscript = JSON.parse(readFileSync(join(dir, "manuscript.json"), "utf8")) as {
    language: string;
    scenes: SceneToAnalyze[];
  };
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Expected;

  const key =
    providerName === "openrouter" && existsSync(KEY_FILE)
      ? readFileSync(KEY_FILE, "utf8").trim()
      : null;
  if (providerName === "openrouter" && key === null) {
    console.error("No hay clave de OpenRouter. Ejecuta: npm run eval:login");
    process.exit(2);
  }
  const transport = createNodeTransport(key);
  const base: AiProvider =
    providerName === "ollama"
      ? createOllamaProvider(transport)
      : createOpenRouterProvider(transport);

  if (providerName === "openrouter") {
    assertFreeModel(await base.listModels(), model);
    const allowance = await readAllowance(transport);
    if (allowance !== null) {
      console.log(`Peticiones gratuitas hoy: ${allowance.used} de ${allowance.limit}`);
    }
    if (!flag("resume") && !flag("cache-only")) {
      assertAllowance(allowance, estimateRequests(manuscript.scenes.length));
    }
  }

  const cached = flag("no-cache") ? base : withCache(base, CACHE, flag("cache-only"));
  const traceFile = option("trace");
  const provider = traceFile === undefined ? cached : withTrace(cached, traceFile);
  const reasoning = flag("no-think") ? "off" : "default";
  let requests = 0;
  const deps: AnalysisDeps = {
    provider,
    model,
    language: manuscript.language,
    reasoning,
    onStep: () => {
      requests += 1;
    },
    onUsage: assertNoCost,
    // Numbered, so that the same run makes the same prompts, and the cache can find them.
    newId: (() => {
      let next = 0;
      return () => {
        next += 1;
        return `e${next}`;
      };
    })(),
  };

  const started = performance.now();
  let state = emptyState(manuscript.scenes.map((scene) => scene.id));
  let discarded = 0;
  let unplaced = 0;
  for (const scene of manuscript.scenes) {
    const stepStart = performance.now();
    const result = await analyzeScene(state, scene, deps);
    state = result.state;
    discarded += result.discardedQuotes.length;
    console.log(
      `${scene.id}: ${state.facts.filter((fact) => fact.sceneId === scene.id).length} hechos, ${((performance.now() - stepStart) / 1000).toFixed(1)} s`,
    );
    unplaced += result.unplacedFacts.length;
    for (const quote of result.discardedQuotes) {
      if (verbose) console.log(`    descartada: «${quote}»`);
    }
    for (const quote of result.unplacedFacts) {
      if (verbose) console.log(`    sin dueño: «${quote}»`);
    }
  }

  if (verbose) {
    console.log("\nEntidades");
    for (const entity of state.entities) {
      console.log(`  ${entity.canonicalName} [${entity.type}] ${entity.aliases.join(", ")}`);
    }
    console.log("\nHechos");
    for (const fact of state.facts) {
      const name = state.entities.find((entity) => entity.id === fact.entityId)?.canonicalName;
      console.log(
        `  ${fact.sceneId} ${name} [${fact.category}] ${fact.attribute}: ${fact.value} | «${fact.quote}»`,
      );
    }
    console.log("\nAvisos");
    for (const issue of state.issues) {
      const b = "b" in issue ? ` <> ${issue.b.sceneId} «${issue.b.quote}»` : "";
      console.log(`  ${issue.kind}: ${issue.a.sceneId} «${issue.a.quote}»${b} — ${issue.reason}`);
    }
  }

  const texts = new Map(manuscript.scenes.map((scene) => [scene.id, scene.text]));
  const score = scoreAnalysis(state, expected, texts, discarded);
  const previous = previousRecord(novel, providerName, model);
  printScore(score, previous);
  console.log(`  Hechos descartados por no poder asignarse a nadie: ${unplaced}`);

  const seconds = Math.round((performance.now() - started) / 1000);
  const stats =
    "stats" in cached ? (cached as { stats: { hits: number; misses: number } }).stats : null;
  console.log(
    `\n${requests} pasos, ${stats ? `${stats.misses} peticiones reales y ${stats.hits} de la caché` : "sin caché"}, ${seconds} s`,
  );

  if (!flag("no-record")) {
    const date = new Date().toISOString();
    const record: RunRecord = {
      date,
      novel,
      provider: providerName,
      model,
      reasoning,
      score,
      requests: stats?.misses ?? requests,
      seconds,
    };
    mkdirSync(RESULTS, { recursive: true });
    const name = `${date.replace(/[:.]/g, "-")}-${novel}-${providerName}-${model.replace(/[^a-zA-Z0-9.-]/g, "_")}.json`;
    writeFileSync(join(RESULTS, name), `${JSON.stringify(record, null, 2)}\n`);
  }
  process.exitCode = score.passed ? 0 : 1;
}

main().catch((error: unknown) => {
  if (error instanceof SpendingRefused) {
    console.error(`Detenido para no gastar: ${error.message}`);
  } else if (error instanceof StructuredOutputError) {
    // A daily limit or a question not in the cache. What was answered stays cached for next time.
    console.error(`Detenido: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 3;
});
