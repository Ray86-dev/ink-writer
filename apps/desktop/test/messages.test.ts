import { DatabaseTooNewError } from "@ink-writer/core";
import { describe, expect, it } from "vitest";
import { describeStartupError, MESSAGES, pickLocale } from "../src/messages";

describe("pickLocale", () => {
  it.each([
    ["es", "es"],
    ["es-ES", "es"],
    ["ES-mx", "es"],
    ["en-US", "en"],
    ["fr", "en"],
    ["", "en"],
  ])("%s gives %s", (language, expected) => {
    expect(pickLocale(language)).toBe(expected);
  });
});

describe("describeStartupError", () => {
  const messages = MESSAGES.es;

  it("reassures that data from a newer version wasn't touched", () => {
    expect(describeStartupError(new DatabaseTooNewError(9, 1), messages)).toBe(messages.tooNew);
  });

  it("includes the cause of any other failure", () => {
    expect(describeStartupError(new Error("disco lleno"), messages)).toContain("disco lleno");
    // The shell's commands reject with a plain string.
    expect(describeStartupError("disco lleno", messages)).toContain("disco lleno");
  });
});

describe("messages", () => {
  it("has every message in both languages", () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.es).sort());
  });
});
