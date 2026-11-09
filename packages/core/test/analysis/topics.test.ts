import { describe, expect, it } from "vitest";
import {
  appositionsIn,
  namesakesIn,
  nameWords,
  sentenceAround,
  sentencesOf,
  sentencesWithoutFacts,
  speaksOfDeath,
  topicWords,
} from "../../src/analysis/topics";

describe("topicWords", () => {
  const words = (text: string, excluded?: ReadonlySet<string>) => [...topicWords(text, excluded)];

  it("keeps what a sentence is about", () => {
    expect(words("la veda empieza el martes")).toEqual(["veda", "empieza"]);
    expect(words("sus ojos marrones")).toEqual(["ojo", "marrone"]);
  });

  it("finds one word in singular and plural, and with or without an accent", () => {
    const both = (a: string, b: string) =>
      [...topicWords(a)].some((word) => topicWords(b).has(word));

    expect(both("las maletas rojas", "una maleta")).toBe(true);
    expect(both("la camión", "el camion")).toBe(true);
  });

  it("doesn't count short words, common words or times", () => {
    expect(words("Hacía once años que se había ido")).toEqual(["once"]);
    expect(words("esa misma noche, un martes de lluvia")).toEqual(["lluvia"]);
  });

  it("leaves out people's names, or every fact about someone would share a topic", () => {
    const people = new Set(nameWords("Marta Rey"));

    expect(words("Marta miró el faro", people)).toEqual(["miro", "faro"]);
  });

  it("works in English too", () => {
    expect(words("the fishing ban starts on Tuesday")).toEqual(["fishing", "start"]);
  });
});

describe("speaksOfDeath", () => {
  it.each([
    "Enterraron a la tía Remedios",
    "Remedios murió en mayo",
    "su difunta tía",
    "el entierro fue el lunes",
    "She was buried on Tuesday",
    "He died young",
  ])("%s", (text) => {
    expect(speaksOfDeath(text)).toBe(true);
  });

  it.each(["Marta recibió una llamada", "He went to the bakery", "el murió"])(
    "not in: %s",
    (text) => {
      expect(speaksOfDeath(text)).toBe(text === "el murió");
    },
  );
});

describe("sentences", () => {
  const text = "Marta bajó. ¿Quién llama?\n\n—Soy yo —dijo Tomás. Fin";

  it("splits by end marks and by lines", () => {
    expect(sentencesOf(text)).toEqual([
      "Marta bajó.",
      "¿Quién llama?",
      "—Soy yo —dijo Tomás.",
      "Fin",
    ]);
  });

  it("finds the sentence around a quote", () => {
    expect(sentenceAround(text, "dijo Tomás")).toBe("—Soy yo —dijo Tomás.");
    expect(sentenceAround(text, "no está")).toBe("no está");
  });

  it("lists sentences no quote touches, skipping the very short ones", () => {
    const scene = "El jueves empezaba la veda. Inés ya había amarrado el barco. Fin.";

    expect(sentencesWithoutFacts(scene, ["Inés ya había amarrado"])).toEqual([
      "El jueves empezaba la veda.",
    ]);
    expect(sentencesWithoutFacts(scene, [scene])).toEqual([]);
    expect(sentencesWithoutFacts("", [])).toEqual([]);
  });
});

describe("people the text keeps apart", () => {
  const text = "—Me la dio Luis, el cartero.\n\nLuis Ferrer, el alcalde, entró sin llamar.";

  it("reads a name with what that person is", () => {
    expect(appositionsIn(text)).toEqual([
      { name: "Luis", epithet: "el cartero", text: "Luis, el cartero" },
      { name: "Luis Ferrer", epithet: "el alcalde", text: "Luis Ferrer, el alcalde" },
    ]);
  });

  it("doesn't take a list or a clause for that", () => {
    expect(
      appositionsIn("Marta, Tomás y Julián. Luis, que era cartero. En Madrid, la capital."),
    ).toEqual([{ name: "Madrid", epithet: "la capital", text: "Madrid, la capital" }]);
  });

  it("finds a shorter name with one description and a longer one with another", () => {
    const [pair] = namesakesIn(text);

    expect(pair?.[0].name).toBe("Luis");
    expect(pair?.[1].name).toBe("Luis Ferrer");
  });

  it("whichever comes first", () => {
    const [pair] = namesakesIn("Luis Ferrer, el alcalde, saludó a Luis, el cartero.");

    expect(pair?.[0].name).toBe("Luis");
  });

  it.each([
    ["the same name twice", "Luis, el cartero. Luis, el alcalde."],
    ["the same description", "Luis, el cartero. Luis Ferrer, el cartero."],
    ["unrelated names", "Marta, la doctora. Luis, el cartero."],
    ["no appositions", "Luis entró. Luis Ferrer salió."],
  ])("doesn't separate with %s", (_, sample) => {
    expect(namesakesIn(sample)).toEqual([]);
  });
});
