# Hoja de ruta

Cada hito debe cumplir su criterio de salida antes de pasar al siguiente.

## M0 · Prueba de la vía ChatGPT

Lo primero, porque el producto se apoya en ello. Prototipo desechable en Tauri.

- Login «Continue with ChatGPT» en Rust, según `SPEC.md` §6.
- Listar modelos y reescribir una escena en streaming.
- Comprobar: salida estructurada (o función forzada con esquema), búsqueda web y si el uso en una app de escritura está admitido.
- Probar también OpenRouter y Ollama.

**Salida:** informe en `docs/adr/` con qué funciona y qué no. Si la vía ChatGPT falla, OpenRouter pasa a ser la opción principal y se revisa `SPEC.md`.

**Cerrado** con el informe en `docs/adr/0008-resultado-m0-vias-de-ia.md`. OpenRouter y Ollama funcionan. La inferencia por ChatGPT queda sin probar por falta de un plan de pago, y OpenRouter pasa a ser la vía principal provisional.

## M1 · Andamiaje

Monorepo, shell Tauri 2, core TypeScript, integración continua, SQLite con migraciones e interfaz de almacenamiento y de proveedor.

**Salida:** la app arranca en Windows, macOS y Linux. Pruebas en CI.

**Cerrado.** El CI compila la app, ejecuta las pruebas y la arranca en los tres sistemas con una prueba de humo. Decisiones en `docs/adr/0009-andamiaje.md`.

## M2 · Editor y persistencia

TipTap con Yjs por escena, capítulos y escenas, guardado continuo, historial por escena, los tres modos del editor (el enlazado queda para M4) y exportación a DOCX y Markdown limpia de marcas.

**Salida:** ninguna pérdida de texto ante cierre forzado. Tecleo fluido con 150.000 palabras.

**Cerrado.** El CI mata la app real mientras escribe y mide el tecleo en Windows, macOS y Linux. Medidas y límites en `docs/adr/0010-editor-y-guardado-de-la-prosa.md`.

## M3 · Canal de análisis y evaluación

Extracción, resolución de identidades, comparación, cola sin conexión y arnés de evaluación con `fixtures/`.

**Salida:** se alcanzan los umbrales de `fixtures/README.md` con al menos dos modelos.

## M4 · Fichas y enlaces

Fichas de todos los tipos, tarjeta Nombres, fusionar, separar, notas, enlaces en vivo sin IA, navegación bidireccional y `user_overrides`.

**Salida:** borrar un párrafo elimina sus datos. Las correcciones del autor sobreviven al reanálisis.

## M5 · Pistas y tareas

Niveles, interruptores por tipo, pistas graduales, Siguiente paso, cierre automático de pistas y compañera.

**Salida:** con las pistas apagadas no se dispara ninguna tarea, marca ni búsqueda.

## M6 · Conexiones

**Antes de empezar:** ejecutar con una cuenta Plus o Pro la comprobación pendiente de `docs/adr/0008-resultado-m0-vias-de-ia.md`. Su resultado decide si ChatGPT es la vía principal.

«Continue with ChatGPT» definitivo con todos sus errores e interfaz, OpenRouter, Ollama, API keys, topes de uso y borrador en streaming.

**Salida:** cada error de `SPEC.md` §6 tiene su prueba. Nunca se cambia de vía en silencio.

## M7 · Documentación y verificación real

Temas, época, fuentes, caché, tope diario, lugares reales o inventados.

**Salida:** ninguna sugerencia sin fuente. Las pruebas confirman que no sale ni texto ni nombres de personajes.

## M8 · Dashboard Tinta viva

Llevar la demo a la app, conectada a datos reales. Cumplir `DESIGN.md`.

**Salida:** fluido en un portátil modesto, comprobado también en WebKitGTK. Pausa al ocultarse. Alternativa sin WebGL.

## M9 · Primera versión pública

Firma de instaladores, actualizaciones, accesibilidad, inglés y español, documentación, plantillas de contribución.

**Salida:** instalar y escribir sin ver ningún aviso de seguridad.

## Después

- **Sync:** relay cifrado autoalojable.
- **Navegador:** misma interfaz con almacenamiento web.
- Importar DOCX y Markdown.
- Beats y esquema, ediciones multilingües enlazadas, EPUB y PDF de interior.
- Móvil.
