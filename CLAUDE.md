# Ink Writer

App de escritura de novelas, de escritorio, sin conexión y MIT. El autor escribe; la IA guía, vigila la coherencia y documenta.

## Dónde está cada cosa

- `SPEC.md`: qué hace la app. Fuente de verdad del producto.
- `ROADMAP.md`: hitos en orden y criterios de salida. Trabaja hito a hito.
- `DESIGN.md`: apariencia y movimiento.
- `docs/adr/`: decisiones técnicas y su porqué. No las reabras sin un ADR nuevo.
- `docs/design/ink-demo/`: demo real del Dashboard. Ábrela para ver el objetivo visual.
- `docs/design/mockup/`: comportamiento de pantallas, referencia de lógica.
- `fixtures/`: novela de prueba y resultado esperado del análisis.
- `packages/core/`: dominio en TypeScript, sin dependencias de Tauri ni de Node.
- `apps/desktop/`: la página y, en `src-tauri/`, el shell en Rust.
- `prototypes/m0/`: prototipo desechable. Se conserva hasta la comprobación pendiente de `docs/adr/0008-resultado-m0-vias-de-ia.md`. No reutilices su código.

## Reglas innegociables

1. **La IA nunca escribe en el manuscrito.** Ninguna ruta de código inserta texto generado salvo una corrección puntual que el autor pulse.
2. **Nunca perder texto.** Cualquier cambio en guardado, Yjs o sync lleva pruebas de cierre forzado y de conflicto.
3. **Todo dato con origen.** Las citas se comprueban literalmente contra la escena. Los datos externos, con fuente enlazada; sin fuente, no se muestran.
4. **Lo del autor prevalece.** `user_overrides` sobrevive a todo reanálisis.
5. **Privacidad.** Sin telemetría. Las búsquedas envían solo el tema, nunca el texto ni los nombres de personajes.
6. **Nada de OAuth de Claude.** Claude solo con clave de API u OpenRouter. No imitar ni reutilizar credenciales de Claude Code.
7. **No copiar código de `sign-in-with-chatgpt-devkit`.** Tiene licencia no comercial. Implementa desde la documentación pública, detallada en `SPEC.md` §6.
8. **Solo dependencias compatibles con MIT.** Revisa la licencia antes de añadir una.
9. **Los tokens no llegan al WebView.** Viven en la capa Rust.
10. **Nunca cambiar de facturación en silencio.**
11. **Las exportaciones no llevan marcas** de la herramienta ni de IA.
12. **El 3D no estorba.** Sin WebGL activo mientras se escribe. Respeta reducir movimiento y ten alternativa sin WebGL.

## Arquitectura

- **Shell Tauri 2 en Rust, fino:** archivos, SQLite, OAuth, tokens y HTTP de IA.
- **Core en TypeScript**, compartido con la futura web: dominio, análisis, pistas, enlaces. Interfaces de almacenamiento y de proveedor de IA.
- **Editor:** TipTap con Yjs, un documento por escena.
- **Nunca last-write-wins sobre prosa.**

## Forma de trabajar

- Antes de un hito, lee su sección en `ROADMAP.md` y las partes de `SPEC.md` que cita. Si algo no cuadra, pregunta.
- Haz cambios pequeños y deja pruebas con cada uno.
- Si tocas prompts, modelos o el canal de análisis, ejecuta la evaluación de `fixtures/` y compara con la anterior.
- Si tomas una decisión de arquitectura, escribe un ADR.
- La documentación del repositorio va en español. El código y los comentarios, en inglés.

## Comandos

Desde la raíz, con Node 24 y Rust estable:

| Comando | Qué hace |
|---|---|
| `npm install` | Instala las dependencias |
| `npm run dev` | Abre la app en modo desarrollo |
| `npm run check` | Formato, lint y tipos de TypeScript |
| `npm run check:rust` | `rustfmt` y `clippy` |
| `npm test` | Todas las pruebas. Por separado: `npm run test:ts` y `npm run test:rust` |
| `npm run build:debug` y `npm run smoke` | Construye la app real, la arranca con una base temporal y comprueba que todas las capas encajan |
| `npm run licenses` | Revisa las licencias de todas las dependencias (regla 8) |
| `npm run fixtures` | Valida el material de `fixtures/` |

La evaluación del análisis aún no existe: llega en M3. Hasta entonces, `npm run fixtures` solo comprueba que el material es coherente.

CI en `.github/workflows/ci.yml`: compila, prueba y arranca la app en Windows, macOS y Linux.

Al añadir una migración, crea una nueva en `packages/core/src/storage/migrations.ts`. Nunca edites una ya publicada.
