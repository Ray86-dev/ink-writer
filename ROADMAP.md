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

**Cerrado.** `gemma4:latest`, `nemotron-3.5-super` y `gemma4:e2b` alcanzan los umbrales en `la-veda`. En la novela de control, `la-feria`, `gemma4:latest` y `nemotron-3.5-super` también, y `gemma4:e2b` no. Es el core y el arnés: la app aún no analiza. Resultados, decisiones y límites en `docs/adr/0011-canal-de-analisis.md`.

## M4 · Fichas y enlaces

Conexión mínima con Ollama y OpenRouter, para que la app analice de verdad (`docs/adr/0012-conexion-minima-en-m4.md`). Fichas de todos los tipos, tarjeta Nombres, fusionar, separar, notas, enlaces en vivo sin IA, navegación bidireccional y `user_overrides`.

**Salida:** borrar un párrafo elimina sus datos. Las correcciones del autor sobreviven al reanálisis.

**Cerrado.** La app analiza con el modelo que elige el autor, por Ollama o por OpenRouter, y las dos condiciones de salida tienen su prueba de pantalla. Quedan fuera el resumen de cada ficha y el «qué cambia» de cada capítulo, que redacta la IA y pasan a M5. El autor probó a mano el login de OpenRouter. Falta un análisis con un modelo real en la app. Decisiones y límites en `docs/adr/0014-conexion-minima-en-la-app.md` y `docs/adr/0015-fichas-enlaces-y-correcciones-del-autor.md`.

## M5 · Pistas y tareas

Niveles, interruptores por tipo, pistas graduales, Siguiente paso, cierre automático de pistas y compañera. También el resumen de cada ficha y el «qué cambia» de cada capítulo, que quedaron fuera de M4 porque salen del mismo paso del análisis.

**Salida:** con las pistas apagadas no se dispara ninguna tarea, marca ni búsqueda.

**Cerrado.** Con las pistas apagadas no hay tarea, marca, pista ni compañera en ningún modo, con su prueba de pantalla; la búsqueda es de M7 y tendrá que respetar lo mismo. Las pistas de coherencia y correcciones salen de lo que el análisis ya detecta, sin IA nueva. El resumen de cada ficha, el «qué cambia», las preguntas y la tarea de escritura los redacta un paso nuevo del análisis, evaluado con `deepseek-flash` en las dos novelas sin que cambie lo que ya se medía. Ese paso no tiene umbral y solo se ha medido con ese modelo. Siguiente paso vive en el panel de pistas hasta que exista el Dashboard. Decisiones y límites en `docs/adr/0016-pistas-y-siguiente-paso-sin-ia.md` y `docs/adr/0017-lo-que-redacta-la-ia.md`.

## M6 · Conexiones

**Antes de empezar:** ejecutar con una cuenta Plus o Pro la comprobación pendiente de `docs/adr/0008-resultado-m0-vias-de-ia.md`. Su resultado decide si ChatGPT es la vía principal.

«Continue with ChatGPT» definitivo con todos sus errores e interfaz, lo que falte de OpenRouter y Ollama tras la conexión mínima de M4, API keys, topes de uso y borrador en streaming.

**Salida:** cada error de `SPEC.md` §6 tiene su prueba. Nunca se cambia de vía en silencio.

**Cerrado sin ChatGPT,** por decisión del autor: la comprobación necesita un plan de pago que no hay. Hecho: modelos de pago de OpenRouter y DeepSeek con clave propia, siempre con dos topes diarios que pone el autor, y un texto con su prueba para cada error de las vías que existen. Fuera: «Continue with ChatGPT» con sus errores, otras claves de API y el borrador en streaming. Sin comprobar con un modelo de pago real. Decisiones y límites en `docs/adr/0018-conexiones-sin-chatgpt.md`.

## M7 · Documentación y verificación real

Temas, época, fuentes, caché, tope diario, lugares reales o inventados.

**Salida:** ninguna sugerencia sin fuente. Las pruebas confirman que no sale ni texto ni nombres de personajes.

**Cerrado, sin la búsqueda web del modelo.** Se documenta con cuatro servicios públicos y gratuitos: OpenStreetMap para situar lugares y ver sus calles y locales, Open-Meteo para el clima y Wikipedia para lo demás. Un lugar no se busca hasta que el autor dice si existe, y uno inventado no se busca nunca. Lo encontrado se guarda con su fuente y solo se ve en las fichas. El tope diario lo vigila Rust. Fuera: la tarjeta del Dashboard, que llega en M8, los temas propuestos por la app para oficios y objetos, y contrastar los datos de la novela con las fuentes. La app no ha hecho ninguna búsqueda real: las consultas a los servicios se comprobaron a mano. Decisiones y límites en `docs/adr/0019-documentacion-con-fuentes-abiertas.md`.

## M8 · Dashboard Tinta viva

Llevar la demo a la app, conectada a datos reales. Cumplir `DESIGN.md`.

**Salida:** fluido en un portátil modesto, comprobado también en WebKitGTK. Pausa al ocultarse. Alternativa sin WebGL.

**Hecho, con dos condiciones de salida a medias.** El Dashboard es la pantalla de inicio de cada novela: la red de tinta, un siguiente paso y las diez tarjetas, todo con datos reales. La red muestra 16 nodos como mucho, los principales, y el resto está en las tarjetas. Se para al ocultarse, y sin WebGL quedan las tarjetas. Lo que falta por ver: solo se ha mirado en Windows, en el equipo de desarrollo. No se ha probado en un portátil modesto, y en WebKitGTK solo lo ejecuta la prueba de humo del CI. Fuera: la tinta que se retira al cerrar una ficha, la tarjeta que se convierte en ficha y el zoom. Decisiones y límites en `docs/adr/0020-dashboard-tinta-viva.md`.

## M9 · Primera versión pública

Firma de instaladores, actualizaciones, accesibilidad, inglés y español, documentación, plantillas de contribución.

**Salida:** instalar y escribir sin ver ningún aviso de seguridad.

**En curso. La condición de salida no se cumple todavía.** Hecho: instaladores para los tres sistemas, el flujo que los construye y los deja en un borrador, los avisos de licencias de terceros, el idioma de la app a elegir, un repaso de accesibilidad, la guía de uso y las plantillas de contribución. Falta lo que depende de una decisión del autor: la firma en Windows, la cuenta de Apple para firmar en macOS, y las actualizaciones. Sin firma, quien instala ve un aviso. Nadie ha instalado aún la app. Decisiones y pendientes en `docs/adr/0021-distribucion.md`.

## Después

- **Sync:** relay cifrado autoalojable.
- **Navegador:** misma interfaz con almacenamiento web.
- Importar DOCX y Markdown.
- Beats y esquema, ediciones multilingües enlazadas, EPUB y PDF de interior.
- Móvil.
