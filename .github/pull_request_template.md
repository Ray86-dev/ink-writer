## Qué cambia

<!-- Una o dos frases. Si cierra una incidencia: Cierra #123. -->

## Cómo se ha comprobado

<!-- Qué pruebas pasan y qué has mirado a mano. Di también lo que NO has podido comprobar. -->

## Lista

- [ ] `npm run check` y `npm test` pasan.
- [ ] El cambio trae sus pruebas.
- [ ] Si toca el guardado, Yjs o el sync: pasa `npm run crash-test`.
- [ ] Si toca prompts, modelos o el canal de análisis: evaluación de `fixtures/` ejecutada y comparada.
- [ ] Si añade una dependencia: su licencia es compatible con MIT, y `npm run licenses` y `npm run notices` están al día.
- [ ] Si es una decisión de arquitectura: lleva su ADR en `docs/adr/`.
- [ ] Ninguna ruta nueva hace que la IA escriba en el manuscrito, ni envía texto o nombres de personajes en una búsqueda.
