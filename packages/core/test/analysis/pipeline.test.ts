import { describe, expect, it } from "vitest";
import {
  type AiProvider,
  type AnalysisDeps,
  type AnalysisState,
  analyzeScene,
  emptyState,
  type GenerateEvent,
  type GenerateRequest,
  liveEntities,
  StructuredOutputError,
  withoutScene,
} from "../../src/index";

type Extracted = {
  entities: { name: string; type: string; aliases: string[] }[];
  facts: {
    entity: string;
    category: string;
    attribute: string;
    value: string;
    quote: string;
    story_time: string | null;
  }[];
  relations: { from: string; to: string; label: string; quote: string }[];
};

const person = (name: string, ...aliases: string[]) => ({ name, type: "person", aliases });

const fact = (entity: string, category: string, value: string, quote: string) => ({
  entity,
  category,
  attribute: "a",
  value,
  quote,
  story_time: null,
});

const NOTHING: Extracted = { entities: [], facts: [], relations: [] };

interface Script {
  /** First reading of each scene, in order. */
  readonly extract?: readonly Extracted[];
  /** Second reading, of the sentences the first left out. */
  readonly missed?: readonly Extracted[];
  readonly identities?: readonly { name: string; entity_id: string | null }[];
  /** Given the question, what the comparison finds. */
  readonly compare?: (input: string) => readonly {
    new_fact: string;
    other_fact: string;
    verdict: string;
    reason: string;
  }[];
  readonly corrections?: readonly { quote: string; fix: string; reason: string }[];
}

/** Answers each step by the schema it asks for, and remembers everything it was asked. */
function fakeModel(script: Script) {
  const asked: GenerateRequest[] = [];
  const extractions = [...(script.extract ?? [])];
  const secondReadings = [...(script.missed ?? [])];
  const provider: AiProvider = {
    id: "fake",
    displayName: "Fake",
    billing: "local",
    listModels: async () => [],
    async *generate(request): AsyncGenerator<GenerateEvent> {
      asked.push(request);
      const answer = () => {
        switch (request.structured?.name) {
          case "scene_extraction":
            return request.input.includes("A first reading found no facts")
              ? (secondReadings.shift() ?? NOTHING)
              : (extractions.shift() ?? NOTHING);
          case "identity_answers":
            return { answers: script.identities ?? [] };
          case "comparison":
            return { findings: script.compare?.(request.input) ?? [] };
          case "proofreading":
            return { corrections: script.corrections ?? [] };
          default:
            throw new Error(`Unexpected request ${request.structured?.name}`);
        }
      };
      yield { type: "text", delta: JSON.stringify(answer()) };
      yield { type: "end", outcome: { status: "completed" } };
    },
  };
  return { provider, asked };
}

function depsFor(script: Script): AnalysisDeps & { asked: GenerateRequest[] } {
  const { provider, asked } = fakeModel(script);
  let next = 0;
  return {
    provider,
    asked,
    model: "m",
    language: "es",
    newId: () => {
      next += 1;
      return `id${next}`;
    },
  };
}

const steps = (asked: readonly GenerateRequest[]) => asked.map((r) => r.structured?.name);

const scene = (id: string, text: string) => ({ id, title: id, text });

const start = emptyState(["s1", "s2", "s3"]);

/** Which scene and quote a comparison's fact tag stands for. */
const tagOf = (input: string, text: string) =>
  input
    .split("\n")
    .find((line) => line.includes(text))
    ?.split(" ")[0] ?? "";

/** The comparison shows whole sentences, so each of these scenes says it in its only sentence. */

describe("step 1, the rule on quotes (rule 3)", () => {
  it("keeps a literal quote and throws away any other, keeping count", async () => {
    const text = "Marta bajó del autobús.";
    const { state, discardedQuotes } = await analyzeScene(
      start,
      scene("s1", text),
      depsFor({
        extract: [
          {
            entities: [person("Marta")],
            facts: [
              fact("Marta", "action", "bajó", "bajó del autobús"),
              fact("Marta", "action", "subió", "subió al tren"),
              fact("Marta", "action", "sin cita", ""),
            ],
            relations: [{ from: "Marta", to: "Marta", label: "x", quote: "no aparece" }],
          },
        ],
      }),
    );

    expect(state.facts.map((item) => item.quote)).toEqual(["bajó del autobús"]);
    expect(state.relations).toEqual([]);
    expect(discardedQuotes).toEqual(["subió al tren", "", "no aparece"]);
  });

  it("requires the exact characters, accents and capitals included", async () => {
    const { state } = await analyzeScene(
      start,
      scene("s1", "Marta bajó."),
      depsFor({
        extract: [
          {
            entities: [person("Marta")],
            facts: [
              fact("Marta", "action", "v", "marta bajó"),
              fact("Marta", "action", "v", "Marta bajo"),
            ],
            relations: [],
          },
        ],
      }),
    );

    expect(state.facts).toEqual([]);
  });

  it("gives every kept fact a source, with its scene", async () => {
    const { state } = await analyzeScene(
      start,
      scene("s1", "Marta bajó."),
      depsFor({
        extract: [
          {
            entities: [person("Marta")],
            facts: [fact("Marta", "action", "v", "Marta bajó")],
            relations: [],
          },
        ],
      }),
    );

    expect(state.facts[0]).toMatchObject({ sceneId: "s1", quote: "Marta bajó" });
  });

  it("drops a fact about a name that isn't in the scene, and says so", async () => {
    const { state, unplacedFacts } = await analyzeScene(
      start,
      scene("s1", "Marta bajó. Llovía sin parar."),
      depsFor({
        extract: [
          {
            entities: [person("Marta")],
            facts: [fact("Alguien de fuera", "action", "v", "Llovía sin parar")],
            relations: [],
          },
        ],
      }),
    );

    expect(state.facts).toEqual([]);
    expect(unplacedFacts).toEqual(["Llovía sin parar"]);
  });

  it("gives a fact filed under a made-up name to the one person its quote names", async () => {
    const { state, unplacedFacts } = await analyzeScene(
      start,
      scene("s1", "Saludaron a Marta en la plaza."),
      depsFor({
        extract: [
          {
            entities: [person("Marta")],
            facts: [fact("saludo", "other", "v", "Saludaron a Marta")],
            relations: [],
          },
        ],
      }),
    );

    expect(state.facts[0]?.entityId).toBe(state.entities[0]?.id);
    expect(unplacedFacts).toEqual([]);
  });

  it("doesn't guess if its quote names two people, or only part of a word", async () => {
    const { state, unplacedFacts } = await analyzeScene(
      start,
      scene("s1", "Marta y Tomás salieron. Martalena llegó."),
      depsFor({
        extract: [
          {
            entities: [person("Marta"), person("Tomás")],
            facts: [
              fact("salida", "other", "v", "Marta y Tomás salieron"),
              fact("llegada", "other", "v", "Martalena llegó"),
            ],
            relations: [],
          },
        ],
      }),
    );

    expect(state.facts).toEqual([]);
    expect(unplacedFacts).toEqual(["Marta y Tomás salieron", "Martalena llegó"]);
  });

  it("keeps a fact about something the model forgot to list, if the scene names it", async () => {
    // A real answer that used to lose a contradiction: a good fact, but no "veda" in the list.
    const { state, unplacedFacts } = await analyzeScene(
      start,
      scene("s1", "El jueves empezaba la veda."),
      depsFor({
        extract: [
          {
            entities: [],
            facts: [fact("veda", "date_of_event", "jueves", "El jueves empezaba la veda")],
            relations: [],
          },
        ],
      }),
    );

    expect(state.facts).toHaveLength(1);
    expect(state.entities.map((entity) => entity.canonicalName)).toEqual(["veda"]);
    expect(unplacedFacts).toEqual([]);
  });

  it("joins something forgotten to what's already known by that name", async () => {
    const { state: first } = await analyzeScene(
      start,
      scene("s1", "Empieza la veda el martes."),
      depsFor({
        extract: [
          {
            entities: [{ name: "la veda", type: "lore", aliases: [] }],
            facts: [fact("la veda", "date_of_event", "martes", "Empieza la veda el martes")],
            relations: [],
          },
        ],
      }),
    );

    const { state } = await analyzeScene(
      first,
      scene("s2", "El jueves empezaba la veda."),
      depsFor({
        extract: [
          {
            entities: [],
            facts: [fact("veda", "date_of_event", "jueves", "El jueves empezaba la veda")],
            relations: [],
          },
        ],
      }),
    );

    expect(state.entities).toHaveLength(1);
    expect(new Set(state.facts.map((item) => item.entityId)).size).toBe(1);
  });

  it("keeps the whole sentence, as a model may split one into several facts", async () => {
    const text = "Marta salió al amanecer y esa misma tarde estaba en la capital. Fin de todo.";
    const { state } = await analyzeScene(
      start,
      scene("s1", text),
      depsFor({
        extract: [
          {
            entities: [person("Marta")],
            facts: [fact("Marta", "location", "capital", "estaba en la capital")],
            relations: [],
          },
        ],
      }),
    );

    expect(state.facts[0]?.sentence).toBe(
      "Marta salió al amanecer y esa misma tarde estaba en la capital.",
    );
  });

  it("notices a fact stated in a line of dialogue", async () => {
    const text = "Tomás calló.\n\n—Lo vendí.";
    const { state } = await analyzeScene(
      start,
      scene("s1", text),
      depsFor({
        extract: [
          {
            entities: [person("Tomás")],
            facts: [
              fact("Tomás", "action", "calló", "Tomás calló"),
              fact("Tomás", "action", "vendió", "Lo vendí"),
            ],
            relations: [],
          },
        ],
      }),
    );

    expect(state.facts.map((item) => item.inDialogue)).toEqual([false, true]);
  });
});

describe("step 1, a second reading of what the first left out", () => {
  const text = "Marta bajó del autobús. El jueves empezaba la veda.";
  const first: Extracted = {
    entities: [person("Marta")],
    facts: [fact("Marta", "action", "bajó", "Marta bajó del autobús")],
    relations: [],
  };

  it("asks about the sentences without facts, and adds what it finds", async () => {
    const deps = depsFor({
      extract: [first],
      missed: [
        {
          entities: [{ name: "la veda", type: "lore", aliases: [] }],
          facts: [fact("la veda", "date_of_event", "el jueves", "El jueves empezaba la veda")],
          relations: [],
        },
      ],
    });

    const { state } = await analyzeScene(start, scene("s1", text), deps);

    expect(deps.asked[1]?.input).toContain("- El jueves empezaba la veda.");
    expect(state.facts.map((item) => item.quote)).toEqual([
      "Marta bajó del autobús",
      "El jueves empezaba la veda",
    ]);
  });

  it("doesn't spend a request if every sentence gave something", async () => {
    const deps = depsFor({
      extract: [
        {
          ...first,
          facts: [...first.facts, fact("Marta", "date_of_event", "x", "El jueves empezaba")],
        },
      ],
    });

    await analyzeScene(start, scene("s1", text), deps);

    expect(steps(deps.asked)).toEqual(["scene_extraction", "proofreading"]);
  });

  it("checks the second reading's quotes too", async () => {
    const { state, discardedQuotes } = await analyzeScene(
      start,
      scene("s1", text),
      depsFor({
        extract: [first],
        missed: [
          {
            entities: [],
            facts: [fact("Marta", "action", "v", "un invento")],
            relations: [],
          },
        ],
      }),
    );

    expect(state.facts).toHaveLength(1);
    expect(discardedQuotes).toEqual(["un invento"]);
  });

  it("joins an entity both readings named, instead of having two", async () => {
    const { state } = await analyzeScene(
      start,
      scene("s1", text),
      depsFor({
        extract: [first],
        missed: [
          {
            entities: [person("Marta", "Marta bajó")],
            facts: [],
            relations: [],
          },
        ],
      }),
    );

    expect(state.entities).toHaveLength(1);
  });
});

describe("step 1, what can be a name", () => {
  it.each(["su hermano", "su tía", "her brother", "la", "de"])("not «%s»", async (alias) => {
    const text = `Tomás y ${alias} hablaron.`;
    const { state } = await analyzeScene(
      start,
      scene("s1", text),
      depsFor({
        extract: [
          {
            entities: [person("Tomás", alias)],
            facts: [fact("Tomás", "action", "habló", "hablaron")],
            relations: [],
          },
        ],
      }),
    );

    expect(state.entities[0]?.aliases).not.toContain(alias);
  });

  it("not one the scene doesn't use", async () => {
    const { state } = await analyzeScene(
      start,
      scene("s1", "Tomás habló largo rato."),
      depsFor({
        extract: [
          {
            entities: [person("Tomás", "el marinero")],
            facts: [fact("Tomás", "action", "habló", "Tomás habló")],
            relations: [],
          },
        ],
      }),
    );

    expect(state.entities[0]?.aliases).not.toContain("el marinero");
  });

  it("not a misspelling, which the author must see instead", async () => {
    const { state } = await analyzeScene(
      start,
      scene("s1", "Tomás habló. Thomas calló allí."),
      depsFor({
        extract: [
          {
            entities: [person("Tomás", "Thomas")],
            facts: [
              fact("Tomás", "action", "habló", "Tomás habló"),
              fact("Tomás", "action", "calló", "Thomas calló allí"),
            ],
            relations: [],
          },
        ],
      }),
    );

    expect(state.entities[0]?.aliases).not.toContain("Thomas");
  });
});

describe("step 1, people the text keeps apart", () => {
  const text = "—Me la dio Luis, el cartero.\n\nLuis Ferrer, el alcalde, entró sin llamar.";

  const luisIn = (state: AnalysisState, quote: string) => {
    const id = state.facts.find((item) => item.quote === quote)?.entityId;
    return state.entities.find((entity) => entity.id === id)?.canonicalName;
  };

  it("separates them when the model folds one into the other, with their facts", async () => {
    const { state } = await analyzeScene(
      start,
      scene("s1", text),
      depsFor({
        extract: [
          {
            entities: [person("Luis Ferrer", "Luis", "el alcalde")],
            facts: [
              fact("Luis Ferrer", "action", "dio", "Me la dio Luis, el cartero"),
              fact("Luis Ferrer", "action", "entró", "entró sin llamar"),
            ],
            relations: [],
          },
        ],
      }),
    );

    const names = state.entities.map((entity) => entity.canonicalName);
    expect(names).toContain("Luis");
    expect(names).toContain("Luis Ferrer");
    expect(luisIn(state, "Me la dio Luis, el cartero")).toBe("Luis");
    expect(luisIn(state, "entró sin llamar")).toBe("Luis Ferrer");
    expect(state.entities.find((e) => e.canonicalName === "Luis")?.aliases).toContain("el cartero");
    expect(state.entities.find((e) => e.canonicalName === "Luis Ferrer")?.aliases).not.toContain(
      "Luis",
    );
  });

  it("also the other way round, if the model used the shorter name", async () => {
    const { state } = await analyzeScene(
      start,
      scene("s1", text),
      depsFor({
        extract: [
          {
            entities: [person("Luis", "el cartero", "Luis Ferrer", "el alcalde")],
            facts: [fact("Luis", "action", "entró", "entró sin llamar")],
            relations: [],
          },
        ],
      }),
    );

    expect(luisIn(state, "entró sin llamar")).toBe("Luis Ferrer");
  });

  it("leaves them alone if the model got it right", async () => {
    const { state } = await analyzeScene(
      start,
      scene("s1", text),
      depsFor({
        extract: [
          {
            entities: [person("Luis", "el cartero"), person("Luis Ferrer", "el alcalde")],
            facts: [
              fact("Luis", "action", "dio", "Me la dio Luis, el cartero"),
              fact("Luis Ferrer", "action", "entró", "entró sin llamar"),
            ],
            relations: [],
          },
        ],
      }),
    );

    expect(state.entities).toHaveLength(2);
    expect(luisIn(state, "Me la dio Luis, el cartero")).toBe("Luis");
  });

  it("doesn't touch anyone else in the scene", async () => {
    const { state } = await analyzeScene(
      start,
      scene("s1", `Marta oyó. ${text}`),
      depsFor({
        extract: [
          {
            entities: [person("Marta"), person("Luis Ferrer", "Luis")],
            facts: [fact("Marta", "action", "oyó", "Marta oyó")],
            relations: [],
          },
        ],
      }),
    );

    expect(luisIn(state, "Marta oyó")).toBe("Marta");
  });
});

describe("step 2, identities", () => {
  const known: AnalysisState = {
    ...start,
    entities: [
      { id: "marta", type: "person", canonicalName: "Marta Rey", aliases: ["Marta"] },
      { id: "ines", type: "person", canonicalName: "Inés Cabrera", aliases: [] },
      { id: "cartero", type: "person", canonicalName: "Luis", aliases: ["el cartero"] },
      { id: "alcalde", type: "person", canonicalName: "Luis Ferrer", aliases: ["el alcalde"] },
    ],
    mentions: [
      { sceneId: "s1", entityId: "marta", quote: "Marta" },
      { sceneId: "s1", entityId: "ines", quote: "Inés Cabrera" },
    ],
  };

  const about = (name: string, quote: string) => ({
    entities: [person(name)],
    facts: [fact(name, "action", "v", quote)],
    relations: [],
  });

  it("settles an exact name without asking the model", async () => {
    const deps = depsFor({ extract: [about("Marta", "Marta salió")] });

    const { state } = await analyzeScene(known, scene("s2", "Marta salió."), deps);

    expect(state.facts[0]?.entityId).toBe("marta");
    expect(state.entities).toHaveLength(known.entities.length);
    expect(steps(deps.asked)).not.toContain("identity_answers");
  });

  it("settles part of a name without asking the model", async () => {
    const deps = depsFor({ extract: [about("Inés", "Inés salió")] });

    const { state } = await analyzeScene(known, scene("s2", "Inés salió."), deps);

    expect(state.facts[0]?.entityId).toBe("ines");
    expect(state.entities.find((e) => e.id === "ines")?.aliases).toContain("Inés");
  });

  it("asks the model about an epithet, and follows what it says", async () => {
    const deps = depsFor({
      extract: [about("la doctora", "la doctora salió")],
      identities: [{ name: "la doctora", entity_id: "marta" }],
    });

    const { state } = await analyzeScene(known, scene("s2", "Luego la doctora salió."), deps);

    expect(state.facts[0]?.entityId).toBe("marta");
    expect(state.entities.find((e) => e.id === "marta")?.aliases).toContain("la doctora");
  });

  it("creates someone new when the model isn't sure", async () => {
    const { state } = await analyzeScene(
      known,
      scene("s2", "Luego la doctora salió."),
      depsFor({
        extract: [about("la doctora", "la doctora salió")],
        identities: [{ name: "la doctora", entity_id: null }],
      }),
    );

    expect(state.entities).toHaveLength(known.entities.length + 1);
  });

  it("ignores an answer naming an entity that doesn't exist", async () => {
    const { state } = await analyzeScene(
      known,
      scene("s2", "Luego la doctora salió."),
      depsFor({
        extract: [about("la doctora", "la doctora salió")],
        identities: [{ name: "la doctora", entity_id: "inventado" }],
      }),
    );

    expect(state.entities.map((e) => e.id)).not.toContain("inventado");
    expect(state.entities).toHaveLength(known.entities.length + 1);
  });

  it("doesn't take a known name for someone else in the next scene", async () => {
    const { state } = await analyzeScene(
      known,
      scene("s2", "Luis Ferrer firmó."),
      depsFor({ extract: [about("Luis Ferrer", "Luis Ferrer firmó")] }),
    );

    expect(state.facts[0]?.entityId).toBe("alcalde");
  });

  it("never tells the model about someone no scene supports any more", async () => {
    const deps = depsFor({ extract: [about("Marta", "Marta salió")] });

    await analyzeScene(known, scene("s2", "Marta salió."), deps);

    expect(deps.asked[0]?.input).toContain("Marta Rey");
    expect(deps.asked[0]?.input).not.toContain("Luis Ferrer");
  });

  it("keeps the id of a name that comes back, so that notes on it would survive (rule 4)", async () => {
    expect(liveEntities(known).map((e) => e.id)).not.toContain("alcalde");

    const { state } = await analyzeScene(
      known,
      scene("s2", "Luis Ferrer firmó."),
      depsFor({ extract: [about("Luis Ferrer", "Luis Ferrer firmó")] }),
    );

    expect(state.entities.find((e) => e.canonicalName === "Luis Ferrer")?.id).toBe("alcalde");
  });
});

describe("step 3, comparison", () => {
  const eyes = (color: string, quote: string): Extracted => ({
    entities: [person("Marta")],
    facts: [fact("Marta", "physical", color, quote)],
    relations: [],
  });

  async function twoScenes(
    first: Extracted,
    second: Extracted,
    compare: Script["compare"],
    texts: readonly [string, string],
  ) {
    const deps = depsFor({ extract: [first, second], ...(compare ? { compare } : {}) });
    const one = await analyzeScene(start, scene("s1", texts[0]), deps);
    const before = deps.asked.length;
    const two = await analyzeScene(one.state, scene("s2", texts[1]), deps);
    return { state: two.state, asked: deps.asked.slice(before) };
  }

  const contradiction = (input: string, a: string, b: string) => [
    {
      new_fact: tagOf(input, b),
      other_fact: tagOf(input, a),
      verdict: "contradiction",
      reason: "No pueden ser ciertas las dos.",
    },
  ];

  it("reports a contradiction between scenes, citing both", async () => {
    const { state } = await twoScenes(
      eyes("verdes", "ojos verdes"),
      eyes("marrones", "ojos marrones"),
      (input) => contradiction(input, "ojos verdes", "ojos marrones"),
      ["Tenía los ojos verdes.", "Tenía los ojos marrones."],
    );

    expect(state.issues).toEqual([
      {
        kind: "contradiction",
        a: { sceneId: "s1", quote: "ojos verdes" },
        b: { sceneId: "s2", quote: "ojos marrones" },
        reason: "No pueden ser ciertas las dos.",
      },
    ]);
  });

  it("marks only what's new, and says which scene each fact is from", async () => {
    const { asked } = await twoScenes(
      eyes("verdes", "ojos verdes"),
      eyes("marrones", "ojos marrones"),
      () => [],
      ["Tenía los ojos verdes.", "Tenía los ojos marrones."],
    );
    const question = asked.find((r) => r.structured?.name === "comparison")?.input ?? "";

    expect(question).toMatch(/scene 1 .*ojos verdes\."$/m);
    expect(question).toMatch(/scene 2 .*ojos marrones\." NEW$/m);
  });

  it("tells apart an evolution, which isn't an error", async () => {
    const { state } = await twoScenes(
      eyes("verdes", "ojos verdes"),
      eyes("marrones", "ojos marrones"),
      (input) => [
        {
          new_fact: tagOf(input, "ojos marrones"),
          other_fact: tagOf(input, "ojos verdes"),
          verdict: "evolution",
          reason: "Cambió.",
        },
      ],
      ["Tenía los ojos verdes.", "Tenía los ojos marrones."],
    );

    expect(state.issues).toEqual([]);
  });

  it("understands one finding naming two facts at once, as some models answer", async () => {
    const { state } = await twoScenes(
      {
        entities: [person("Marta")],
        facts: [
          fact("Marta", "physical", "verdes", "ojos verdes"),
          fact("Marta", "physical", "verdes", "verdes como su madre"),
        ],
        relations: [],
      },
      eyes("marrones", "ojos marrones"),
      (input) => [
        {
          new_fact: tagOf(input, "ojos marrones"),
          other_fact: `${tagOf(input, "ojos verdes")}, ${tagOf(input, "verdes como su madre")}`,
          verdict: "contradiction",
          reason: "r",
        },
      ],
      ["Los ojos verdes. Eran verdes como su madre.", "Tenía los ojos marrones."],
    );

    expect(state.issues.filter((issue) => issue.kind === "contradiction")).toHaveLength(2);
  });

  it("ignores a finding between two old facts, already weighed when they were new", async () => {
    const deps = depsFor({
      extract: [
        eyes("verdes", "ojos verdes"),
        eyes("marrones", "ojos marrones"),
        eyes("azules", "ojos azules"),
      ],
      compare: (input) =>
        input.includes("ojos azules") ? contradiction(input, "ojos verdes", "ojos marrones") : [],
    });
    const one = await analyzeScene(start, scene("s1", "Los ojos verdes."), deps);
    const two = await analyzeScene(one.state, scene("s2", "Los ojos marrones."), deps);

    const { state } = await analyzeScene(two.state, scene("s3", "Los ojos azules."), deps);

    expect(state.issues).toEqual([]);
  });

  it("doesn't take two readings of one sentence for a contradiction", async () => {
    const deps = depsFor({
      extract: [
        {
          entities: [person("Marta")],
          facts: [
            fact("Marta", "physical", "marrones", "ojos marrones"),
            fact("Marta", "physical", "oscuros", "más oscuros"),
          ],
          relations: [],
        },
      ],
      compare: (input) => contradiction(input, "más oscuros", "ojos marrones"),
    });
    const text = "Sus ojos marrones eran más oscuros aquel día.";

    const { state } = await analyzeScene(start, scene("s1", text), deps);

    expect(state.issues).toEqual([]);
  });

  it("ignores a finding about facts that weren't in the question", async () => {
    const { state } = await twoScenes(
      eyes("verdes", "ojos verdes"),
      eyes("marrones", "ojos marrones"),
      () => [
        { new_fact: "F99", other_fact: "F1", verdict: "contradiction", reason: "r" },
        { new_fact: "F1", other_fact: "F1", verdict: "contradiction", reason: "r" },
      ],
      ["Tenía los ojos verdes.", "Tenía los ojos marrones."],
    );

    expect(state.issues).toEqual([]);
  });

  it("shows the model the whole sentence of each fact", async () => {
    const { asked } = await twoScenes(
      {
        entities: [person("Marta")],
        facts: [fact("Marta", "travel_time", "una semana", "una semana de camino")],
        relations: [],
      },
      {
        entities: [person("Marta")],
        facts: [fact("Marta", "travel_time", "la capital", "estaba en la capital")],
        relations: [],
      },
      () => [],
      ["Hasta allí hay una semana de camino.", "Salió al amanecer y estaba en la capital."],
    );
    const question = asked.find((r) => r.structured?.name === "comparison")?.input ?? "";

    expect(question).toContain("Salió al amanecer y estaba en la capital.");
  });

  it("reports one conflict once, even if found through two facts of one sentence", async () => {
    const { state } = await twoScenes(
      {
        entities: [person("Marta")],
        facts: [
          fact("Marta", "physical", "verdes", "ojos verdes"),
          fact("Marta", "physical", "iguales", "lo único igual"),
        ],
        relations: [],
      },
      eyes("marrones", "ojos marrones"),
      (input) => [
        ...contradiction(input, "lo único igual", "ojos marrones"),
        ...contradiction(input, "ojos verdes", "ojos marrones"),
      ],
      ["Tenía ojos verdes, lo único igual.", "Tenía los ojos marrones."],
    );

    expect(state.issues.filter((issue) => issue.kind === "contradiction")).toHaveLength(1);
  });

  it("reports one pair once, even if two groups find it", async () => {
    const { state } = await twoScenes(
      eyes("verdes", "ojos verdes"),
      {
        entities: [person("Marta")],
        facts: [
          fact("Marta", "physical", "marrones", "ojos marrones"),
          fact("Marta", "action", "miró", "miró sus ojos marrones"),
        ],
        relations: [],
      },
      (input) =>
        input.includes("ojos verdes") && input.includes("ojos marrones")
          ? contradiction(input, "ojos verdes", "ojos marrones")
          : [],
      ["Tenía los ojos verdes.", "Se miró: miró sus ojos marrones."],
    );

    expect(state.issues.filter((issue) => issue.kind === "contradiction")).toHaveLength(1);
  });

  it("doesn't ask when nothing could be compared", async () => {
    const { asked } = await twoScenes(
      eyes("verdes", "ojos verdes"),
      {
        entities: [person("Tomás")],
        facts: [fact("Tomás", "action", "pescó", "Tomás pescó")],
        relations: [],
      },
      () => {
        throw new Error("It shouldn't ask");
      },
      ["Tenía los ojos verdes.", "Tomás pescó hasta tarde."],
    );

    expect(steps(asked)).not.toContain("comparison");
  });

  it("doesn't compare a trait of one person with another person's", async () => {
    const { asked } = await twoScenes(
      eyes("verdes", "tenía altura"),
      {
        entities: [person("Tomás")],
        facts: [fact("Tomás", "physical", "bajo", "medía poco")],
        relations: [],
      },
      () => [],
      ["Marta tenía altura.", "Tomás medía poco."],
    );

    expect(steps(asked)).not.toContain("comparison");
  });

  describe("by shared words, whatever category the model chose", () => {
    const dates: readonly [Extracted, Extracted] = [
      {
        entities: [person("Tomás")],
        facts: [fact("Tomás", "action", "dijo", "la veda empieza el martes")],
        relations: [],
      },
      {
        entities: [{ name: "la veda", type: "lore", aliases: [] }],
        facts: [fact("la veda", "date_of_event", "jueves", "El jueves empezaba la veda")],
        relations: [],
      },
    ];

    it("sets two dates of one event side by side", async () => {
      const { state } = await twoScenes(
        dates[0],
        dates[1],
        (input) => contradiction(input, "la veda empieza el martes", "El jueves empezaba la veda"),
        ["Tomás avisó: la veda empieza el martes.", "El jueves empezaba la veda."],
      );

      expect(state.issues.map((issue) => issue.kind)).toEqual(["contradiction"]);
    });

    it("doesn't count people's names as a shared topic", async () => {
      const { asked } = await twoScenes(
        {
          entities: [person("Marta")],
          facts: [fact("Marta", "action", "pescó", "Marta pescó")],
          relations: [],
        },
        {
          entities: [person("Marta")],
          facts: [fact("Marta", "action", "leyó", "Marta leyó")],
          relations: [],
        },
        () => [],
        ["Marta pescó mucho rato.", "Marta leyó mucho rato."],
      );

      expect(steps(asked)).not.toContain("comparison");
    });

    it("doesn't ask about one sentence split into several facts", async () => {
      const deps = depsFor({
        extract: [
          {
            entities: [person("Marta")],
            facts: [
              fact("Marta", "action", "bajó", "bajó del autobús rojo"),
              fact("Marta", "possession", "autobús", "del autobús"),
            ],
            relations: [],
          },
        ],
      });

      await analyzeScene(start, scene("s1", "Marta bajó del autobús rojo."), deps);

      expect(steps(deps.asked)).not.toContain("comparison");
    });
  });

  describe("the dead acting", () => {
    const text = "Enterraron a la tía Remedios un martes. La tía Remedios llamó a Marta.";

    it("finds it even if the burial and the call are filed as mere actions", async () => {
      const deps = depsFor({
        extract: [
          {
            entities: [person("Remedios"), person("Marta")],
            facts: [
              fact("Remedios", "action", "enterrada", "Enterraron a la tía Remedios"),
              fact("Remedios", "action", "llamó", "La tía Remedios llamó"),
            ],
            relations: [],
          },
        ],
        compare: (input) =>
          contradiction(input, "Enterraron a la tía Remedios", "La tía Remedios llamó"),
      });

      const { state } = await analyzeScene(start, scene("s1", text), deps);

      expect(state.issues.filter((issue) => issue.kind === "contradiction")).toHaveLength(1);
    });

    it("finds it even if the later deed is filed under someone else", async () => {
      const deps = depsFor({
        extract: [
          {
            entities: [person("Remedios", "la tía Remedios"), person("Marta")],
            facts: [
              fact("Remedios", "alive_or_dead", "enterrada", "Enterraron a la tía Remedios"),
              fact("Marta", "action", "recibió", "La tía Remedios llamó a Marta"),
            ],
            relations: [],
          },
        ],
        compare: (input) => {
          expect(input).toContain("La tía Remedios llamó a Marta");
          return [];
        },
      });

      await analyzeScene(
        start,
        scene("s1", "Enterraron a la tía Remedios. La tía Remedios llamó a Marta."),
        deps,
      );

      expect(steps(deps.asked)).toContain("comparison");
    });

    it("isn't asked about someone merely mentioned with death nearby", async () => {
      const deps = depsFor({
        extract: [
          {
            entities: [person("Marta")],
            facts: [fact("Marta", "action", "leyó", "Marta leyó")],
            relations: [],
          },
        ],
      });

      await analyzeScene(start, scene("s1", "Marta leyó en la mesa."), deps);

      expect(steps(deps.asked)).not.toContain("comparison");
    });
  });
});

describe("names that look misspelled", () => {
  const first: Extracted = {
    entities: [person("Tomás")],
    facts: [fact("Tomás", "action", "pescó", "Tomás pescó")],
    relations: [],
  };

  async function withSecondScene(second: Extracted, text: string) {
    const deps = depsFor({ extract: [first, second] });
    const one = await analyzeScene(start, scene("s1", "Tomás pescó."), deps);
    return (await analyzeScene(one.state, scene("s2", text), deps)).state;
  }

  const variants = (state: AnalysisState) =>
    state.issues.filter((issue) => issue.kind === "name_variant");

  it("flags one the model took for a new person, without merging them", async () => {
    const state = await withSecondScene(
      {
        entities: [person("Thomas")],
        facts: [fact("Thomas", "action", "leyó", "Thomas leyó")],
        relations: [],
      },
      "Thomas leyó la carta.",
    );

    expect(variants(state)).toEqual([
      expect.objectContaining({
        a: { sceneId: "s1", quote: "Tomás" },
        b: { sceneId: "s2", quote: "Thomas" },
      }),
    ]);
  });

  it("flags it from the text even if the model quietly took it for the same person", async () => {
    const state = await withSecondScene(
      {
        entities: [person("Tomás")],
        facts: [fact("Tomás", "action", "leyó", "Thomas leyó")],
        relations: [],
      },
      "Thomas leyó la carta.",
    );

    expect(variants(state)).toHaveLength(1);
  });

  it("flags it once, when both checks find it", async () => {
    const state = await withSecondScene(
      {
        entities: [person("Thomas")],
        facts: [fact("Thomas", "action", "leyó", "Thomas leyó")],
        relations: [],
      },
      "Thomas leyó la carta.",
    );

    expect(variants(state)).toHaveLength(1);
  });

  it("doesn't flag a known name, nor one nothing like it", async () => {
    const state = await withSecondScene(
      {
        entities: [person("Tomás"), person("Julián")],
        facts: [fact("Julián", "action", "leyó", "Julián leyó")],
        relations: [],
      },
      "Tomás y Julián leyó la carta.",
    );

    expect(variants(state)).toEqual([]);
  });
});

describe("step 5, proofreading", () => {
  const text = "Cuando halla leído la carta, ya no habrá vuelta atrás.";
  const corrections = (...list: readonly { quote: string; fix: string; reason: string }[]) =>
    analyzeScene(start, scene("s1", text), depsFor({ corrections: list }));

  const fixes = (state: AnalysisState) =>
    state.issues.flatMap((issue) => (issue.kind === "correction" ? [issue] : []));

  it("keeps a small, literal correction", async () => {
    const { state } = await corrections({
      quote: "halla leído",
      fix: "haya leído",
      reason: "Es del verbo haber.",
    });

    expect(fixes(state)).toEqual([
      {
        kind: "correction",
        a: { sceneId: "s1", quote: "halla leído" },
        fix: "haya leído",
        reason: "Es del verbo haber.",
      },
    ]);
  });

  it.each([
    [
      "a rewrite of the author's sentence (rule 1)",
      text,
      "Tras leer la carta supo que no volvería.",
    ],
    ["a quote that isn't in the scene", "hayas leído", "hayas leídos"],
    ["a change that changes nothing", "halla leído", "halla leído"],
    ["an empty quote", "", "algo"],
  ])("throws away %s", async (_, quote, fix) => {
    const { state } = await corrections({ quote, fix, reason: "r" });

    expect(fixes(state)).toEqual([]);
  });

  it.each([
    ["a mistyped word", "Cuando halla leído", "Cuando haya leído"],
    ["just the mistyped word, with nothing around it", "halla", "haya"],
    ["a word with another spelling", "la carta que echo", "la carta que hecho"],
    ["two words that sound like one", "Haber si viene", "A ver si viene"],
    ["only an accent", "Sabia que vendría", "Sabía que vendría"],
    ["only capitals", "en puerto de mar", "en Puerto de mar"],
  ])("accepts %s", async (_, quote, fix) => {
    const { state } = await analyzeScene(
      start,
      scene("s1", `${quote} aquella tarde de lluvia.`),
      depsFor({ corrections: [{ quote, fix, reason: "r" }] }),
    );

    expect(fixes(state)).toHaveLength(1);
  });

  it.each([
    ["another word (rule 1)", "Cerró la puerta del patio", "Abrió la puerta del patio"],
    ["another tense, which changes the meaning", "Cuando halla leído", "Cuando había leído"],
    ["a word added to the author's sentence", "fue a casa de Ana", "fue a su casa de Ana"],
    ["a word taken from the author's sentence", "fue a su casa de Ana", "fue a casa de Ana"],
  ])("throws away %s, however small", async (_, quote, fix) => {
    const { state } = await analyzeScene(
      start,
      scene("s1", `${quote} aquella tarde de lluvia.`),
      depsFor({ corrections: [{ quote, fix, reason: "r" }] }),
    );

    expect(fixes(state)).toEqual([]);
  });

  it("finds a hyphen opening a line of dialogue with no model at all", async () => {
    const deps = depsFor({});

    const { state } = await analyzeScene(
      start,
      scene("s1", "Tomás habló.\n\n- Nunca pensé verte, dijo.\n\n—Bien —dijo ella."),
      deps,
    );

    expect(fixes(state)).toEqual([
      expect.objectContaining({
        a: { sceneId: "s1", quote: "- Nunca pensé verte" },
        fix: "—Nunca pensé verte",
      }),
    ]);
  });
});

describe("reanalysing a scene", () => {
  const first: Extracted = {
    entities: [person("Marta")],
    facts: [fact("Marta", "physical", "verdes", "ojos verdes")],
    relations: [],
  };
  const second: Extracted = {
    entities: [person("Marta")],
    facts: [fact("Marta", "physical", "marrones", "ojos marrones")],
    relations: [],
  };

  async function analysed() {
    const deps = depsFor({
      extract: [first, second],
      compare: (input) => [
        {
          new_fact: tagOf(input, "ojos marrones"),
          other_fact: tagOf(input, "ojos verdes"),
          verdict: "contradiction",
          reason: "r",
        },
      ],
    });
    const one = await analyzeScene(start, scene("s1", "Los ojos verdes."), deps);
    const two = await analyzeScene(one.state, scene("s2", "Los ojos marrones."), deps);
    return two.state;
  }

  it("takes out what the old text said, and the issues citing it", async () => {
    const state = await analysed();
    expect(state.issues).toHaveLength(1);

    const after = withoutScene(state, "s2");

    expect(after.facts.map((item) => item.quote)).toEqual(["ojos verdes"]);
    expect(after.mentions.every((mention) => mention.sceneId === "s1")).toBe(true);
    expect(after.issues).toEqual([]);
  });

  it("replaces a scene's facts, so that a fixed contradiction goes away", async () => {
    const state = await analysed();

    const { state: fixed } = await analyzeScene(
      state,
      scene("s2", "Los ojos verdes, otra vez."),
      depsFor({
        extract: [
          {
            entities: [person("Marta")],
            facts: [fact("Marta", "physical", "verdes", "ojos verdes")],
            relations: [],
          },
        ],
      }),
    );

    expect(fixed.facts.filter((item) => item.sceneId === "s2").map((item) => item.quote)).toEqual([
      "ojos verdes",
    ]);
    expect(fixed.issues).toEqual([]);
  });

  it("can compare an earlier scene with a later one", async () => {
    const state = await analysed();
    const deps = depsFor({
      extract: [first],
      compare: (input) => {
        expect(input).toMatch(/scene 1 .*ojos verdes\." NEW$/m);
        expect(input).toMatch(/scene 2 .*ojos marrones\."$/m);
        return [
          {
            new_fact: tagOf(input, "ojos verdes"),
            other_fact: tagOf(input, "ojos marrones"),
            verdict: "contradiction",
            reason: "r",
          },
        ];
      },
    });

    const { state: after } = await analyzeScene(state, scene("s1", "Los ojos verdes."), deps);

    expect(after.issues).toHaveLength(1);
  });

  it("leaves the state as it was if the model can't be reached", async () => {
    const state = await analysed();
    const offline: AiProvider = {
      id: "fake",
      displayName: "Fake",
      billing: "local",
      listModels: async () => [],
      async *generate(): AsyncGenerator<GenerateEvent> {
        yield { type: "end", outcome: { status: "interrupted", message: "offline" } };
      },
    };

    await expect(
      analyzeScene(state, scene("s2", "Otro texto."), {
        provider: offline,
        model: "m",
        language: "es",
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(state.facts).toHaveLength(2);
    expect(state.issues).toHaveLength(1);
  });
});

describe("every request", () => {
  it("is deterministic, and asks for the schema of its step", async () => {
    const deps = depsFor({
      extract: [
        {
          entities: [person("Marta")],
          facts: [fact("Marta", "action", "bajó", "Marta bajó")],
          relations: [],
        },
      ],
    });

    await analyzeScene(start, scene("s1", "Marta bajó."), deps);

    expect(deps.asked.length).toBeGreaterThan(0);
    for (const request of deps.asked) {
      expect(request.temperature).toBe(0);
      expect(request.model).toBe("m");
      expect(request.structured?.schema).toBeTypeOf("object");
    }
  });

  it("never asks for a web search, which is paid and sends more than a topic (rule 5)", async () => {
    const deps = depsFor({});

    await analyzeScene(start, scene("s1", "Marta bajó del autobús."), deps);

    for (const request of deps.asked) {
      expect(request.webSearch).toBeUndefined();
    }
  });

  it("passes on what the caller set, reasoning and cancelling included", async () => {
    const controller = new AbortController();
    const deps = { ...depsFor({}), reasoning: "off" as const, signal: controller.signal };

    await analyzeScene(start, scene("s1", "Marta bajó del autobús."), deps);

    expect(deps.asked[0]?.reasoning).toBe("off");
    expect(deps.asked[0]?.signal).toBe(controller.signal);
  });
});
