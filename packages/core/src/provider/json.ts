/** Reading what a service answered, without trusting its shape. */

export type Json = Record<string, unknown>;

export function asObject(value: unknown): Json {
  return typeof value === "object" && value !== null ? (value as Json) : {};
}

export function parseJson(text: string): Json | null {
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}
