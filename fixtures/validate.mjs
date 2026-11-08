// Comprueba que cada cita de expected.json existe literalmente en su escena.
// Uso: node fixtures/validate.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'la-veda');
const manuscript = JSON.parse(readFileSync(join(dir, 'manuscript.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
const scenes = new Map(manuscript.scenes.map((s) => [s.id, s.text]));
const entities = new Set(expected.entities.map((e) => e.id));
const errors = [];

function check(ref, where) {
  const text = scenes.get(ref.scene);
  if (text === undefined) errors.push(`${where}: no existe la escena ${ref.scene}`);
  else if (!text.includes(ref.quote)) errors.push(`${where}: no aparece «${ref.quote}» en ${ref.scene}`);
}
function checkEntity(id, where) {
  if (!entities.has(id)) errors.push(`${where}: entidad desconocida ${id}`);
}

const allNames = manuscript.scenes.map((s) => s.text).join('\n');
expected.entities.forEach((e) => {
  e.names.forEach((n) => { if (!allNames.includes(n)) errors.push(`entidad ${e.id}: nombre ausente «${n}»`); });
  if (e.parent) checkEntity(e.parent, `entidad ${e.id}`);
});
expected.relations.forEach((r, i) => {
  checkEntity(r.from, `relación ${i}`);
  checkEntity(r.to, `relación ${i}`);
  check(r, `relación ${i}`);
});
expected.must_resolve_reference.forEach((r, i) => {
  checkEntity(r.entity, `referencia ${i}`);
  check(r, `referencia ${i}`);
});
[...expected.must_flag, ...expected.must_not_flag].forEach((c) => {
  check(c.a, c.id);
  if (c.b) check(c.b, c.id);
});
const ids = [...expected.must_flag, ...expected.must_not_flag].map((c) => c.id);
if (new Set(ids).size !== ids.length) errors.push('Hay identificadores repetidos');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${manuscript.scenes.length} escenas, ${expected.entities.length} entidades, ${expected.must_flag.length} a señalar, ${expected.must_not_flag.length} a no señalar.`);
