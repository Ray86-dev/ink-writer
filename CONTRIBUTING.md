# Contribuir a Ink Writer

Gracias por querer ayudar. Ink Writer es una app para escribir novelas en la que **el autor escribe todo** y la IA solo guía, vigila la coherencia y documenta.

## Antes de empezar

- **Qué hace la app:** `SPEC.md`.
- **Qué toca ahora:** `ROADMAP.md`.
- **Por qué está hecha así:** `docs/adr/`. Una decisión de ahí no se reabre sin un ADR nuevo.
- **Las doce reglas que no se negocian:** `CLAUDE.md`. Las que más afectan a un cambio:
  - La IA nunca escribe en el manuscrito.
  - Nunca se pierde texto.
  - Todo dato lleva su origen.
  - Sin telemetría. Las búsquedas envían solo el tema.
  - Solo dependencias compatibles con MIT.

Para un cambio grande, abre antes una propuesta y lo hablamos. Te ahorra trabajo si no encaja.

## Preparar el entorno

Necesitas Node 24, Rust estable y las [dependencias de Tauri](https://tauri.app/start/prerequisites/) de tu sistema.

```sh
npm install
npm run dev
```

## Antes de abrir un PR

| Comando | Cuándo |
|---|---|
| `npm run check` | Siempre |
| `npm test` | Siempre |
| `npm run smoke` | Si tocas el shell en Rust o cómo encajan las capas |
| `npm run crash-test` | Si tocas el guardado o Yjs |
| `npm run licenses` y `npm run notices` | Si añades o cambias una dependencia |

Los demás comandos están en `CLAUDE.md`.

## Cómo trabajamos

- **Cambios pequeños,** cada uno con sus pruebas.
- **La documentación va en español.** El código y sus comentarios, en inglés.
- **Di lo que no has comprobado.** Un PR que avisa de lo que falta vale más que uno que lo calla.
- **Textos de la interfaz:** todos en `apps/desktop/src/messages.ts`, en español e inglés a la vez.
- **No pegues texto de una novela real** en una incidencia, una prueba o un PR. Usa el material de `fixtures/`.

## Licencia

Lo que aportes se publica con la licencia MIT del proyecto.
