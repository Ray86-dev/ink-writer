import { describe, expect, it } from "vitest";
import {
  isEpithet,
  isPartOfName,
  looksLikeVariant,
  nameTokens,
  withoutAccents,
} from "../../src/analysis/names";

describe("nameTokens", () => {
  it.each([
    ["Marta Rey", ["marta", "rey"]],
    ["la tía Remedios", ["remedios"]],
    ["el faro de la Punta", ["faro", "punta"]],
    ["la doctora", ["doctora"]],
    ["su", []],
  ])("%s gives %j", (name, tokens) => {
    expect(nameTokens(name)).toEqual(tokens);
  });
});

describe("isPartOfName", () => {
  it.each([
    ["Marta", "Marta Rey", true],
    ["Marta Rey", "Marta", true],
    ["tía Remedios", "Remedios", true],
    ["faro", "el faro de la Punta", true],
    ["Marta", "Inés Cabrera", false],
    ["Rey", "Reyes", false],
    ["la", "Marta", false],
    ["", "Marta", false],
  ])("%s and %s: %s", (a, b, expected) => {
    expect(isPartOfName(a, b)).toBe(expected);
  });
});

describe("isEpithet", () => {
  it.each([
    ["la doctora", true],
    ["el cartero", true],
    ["Marta", false],
    ["Luis Ferrer", false],
    ["La Punta", false],
  ])("%s: %s", (name, expected) => {
    expect(isEpithet(name)).toBe(expected);
  });
});

describe("looksLikeVariant", () => {
  it.each([
    ["Tomás", "Thomas", true],
    ["Tomas", "Tomás", true],
    ["Marta", "Martha", true],
    ["Puerto Viejo", "Puerto Viego", true],
  ])("flags %s and %s", (a, b, expected) => {
    expect(looksLikeVariant(a, b)).toBe(expected);
  });

  it.each([
    ["Marta", "Marta"],
    ["marta", "Marta"],
    ["Ana", "Eva"],
    ["Luis", "Inés"],
    ["Tomás", "Julián"],
    ["Rey", "Ray"],
  ])("doesn't flag %s and %s", (a, b) => {
    expect(looksLikeVariant(a, b)).toBe(false);
  });
});

describe("withoutAccents", () => {
  it("only takes the accents off", () => {
    expect(withoutAccents("Tomás Núñez")).toBe("Tomas Nunez");
  });
});
