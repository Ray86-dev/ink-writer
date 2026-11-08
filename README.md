# Ink Writer

App de escritura de novelas, de escritorio y sin conexión. **Tú escribes todo.** La IA construye las fichas de tu historia, vigila la coherencia, te propone pequeños pasos y documenta lo que necesites.

Estado: en desarrollo, todavía sin editor. Nombre provisional.

## Empezar

- Producto: [SPEC.md](SPEC.md)
- Plan: [ROADMAP.md](ROADMAP.md)
- Apariencia: [DESIGN.md](DESIGN.md) y la [demo](docs/design/ink-demo/index.html)
- Decisiones: [docs/adr/](docs/adr/)
- Instrucciones para Claude Code y comandos: [CLAUDE.md](CLAUDE.md)

## Desarrollo

Requiere Node 24 y Rust estable, además de las [dependencias de Tauri](https://tauri.app/start/prerequisites/) de cada sistema.

```sh
npm install
npm run dev     # abre la app
npm test        # pruebas de TypeScript y Rust
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
