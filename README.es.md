# Ink Writer

[English](README.md) · **Español**

App de escritura de novelas, de escritorio y sin conexión. **Tú escribes todo.** La IA construye las fichas de tu historia, vigila la coherencia, te propone pequeños pasos y documenta lo que necesites.

Estado: versión 0.1.0, sin publicar todavía. Los instaladores no llevan aún la firma de Windows ni la de Apple, así que al instalar sale un aviso de seguridad: ver la [guía](docs/guia.md#avisos-al-instalar).

## Qué hace

- **Escribir** en un editor sin distracciones, con guardado continuo, historial por escena y exportación a Word y Markdown.
- **Fichas** de personajes, lugares y lore, que la IA construye a partir de tu texto. Cada dato enlaza al pasaje del que sale.
- **Pistas** sobre lo que no encaja, graduales y regulables, hasta apagarlas del todo.
- **Documentación** de lugares, época y temas, con OpenStreetMap, Open-Meteo y Wikipedia. Cada resultado con su fuente.
- **Inicio** con la novela como una red de tinta y un siguiente paso.

La IA es opcional y la eliges tú: un modelo local con Ollama, o en la nube con OpenRouter o DeepSeek. Sin telemetría.

Guía de uso: [docs/guia.md](docs/guia.md).

## Empezar

- Producto: [SPEC.md](SPEC.md)
- Plan: [ROADMAP.md](ROADMAP.md)
- Apariencia: [DESIGN.md](DESIGN.md) y la [demo](docs/design/ink-demo/index.html)
- Decisiones: [docs/adr/](docs/adr/)
- Instrucciones para Claude Code y comandos: [CLAUDE.md](CLAUDE.md)
- Contribuir: [CONTRIBUTING.md](CONTRIBUTING.md)
- Publicar una versión: [docs/publicar.md](docs/publicar.md)
- Seguridad: [SECURITY.md](SECURITY.md)

## Desarrollo

Requiere Node 24 y Rust estable, además de las [dependencias de Tauri](https://tauri.app/start/prerequisites/) de cada sistema.

```sh
npm install
npm run dev     # abre la app
npm test        # pruebas de TypeScript y Rust
```

## Licencia

MIT. Ver [LICENSE](LICENSE). Lo que la app incluye de terceros, en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
