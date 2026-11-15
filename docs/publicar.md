# Publicar una versión

El flujo `.github/workflows/release.yml` construye los instaladores y los deja en un **borrador** de publicación. Nada se publica solo: lo publica una persona después de mirarlo.

## Pasos

1. **Sube la versión** en `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` y los `package.json`. Fusiona ese cambio en `main`.
2. **Crea la etiqueta** con la misma versión y súbela: `git tag v0.1.0` y `git push origin v0.1.0`. El flujo falla si la etiqueta y la versión no coinciden.
3. **Espera al flujo.** Construye en Windows, macOS y Linux, comprueba licencias y avisos, y crea el borrador con los instaladores y sus sumas SHA-256.
4. **Mira el resumen del flujo.** Dice de cada sistema si el instalador va firmado.
5. **Prueba cada instalador** en un equipo limpio: instalar, abrir, escribir, cerrar y volver a abrir.
6. **Escribe las notas** de la versión y publica el borrador.

Para ensayar sin publicar nada, lanza el flujo a mano desde la pestaña Actions: construye los instaladores y los deja como artefactos, sin crear borrador.

## Firma

Sin firma, quien instala ve un aviso de seguridad: SmartScreen en Windows y Gatekeeper en macOS.

| Sistema | Estado | Qué hace falta |
|---|---|---|
| macOS | Preparado, sin probar | Cuenta del Apple Developer Program y estos secretos en el repositorio: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` y `APPLE_TEAM_ID` |
| Windows | Sin hacer | Elegir un proveedor de firma. Ver `docs/adr/0021-distribucion.md` |
| Linux | No aplica | AppImage y `.deb` no muestran aviso |

## Licencias

El instalador incluye `LICENSE` y `THIRD-PARTY-NOTICES.md`. Este último se genera con `npm run notices`, y el CI falla si no está al día.
