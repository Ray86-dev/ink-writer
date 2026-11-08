# Prototipo M0 · Prueba de las vías de IA

Prototipo **desechable** del hito M0 de `ROADMAP.md`. No forma parte del producto y no se reutiliza en M1: se conserva lo aprendido, que queda en `docs/adr/`.

Comprueba contra los servicios reales:

- «Continue with ChatGPT» en Rust, implementado desde la [documentación pública](https://developers.openai.com/siwc/token-sharing-open-source). No se ha leído ni usado código de `sign-in-with-chatgpt-devkit`.
- Listar modelos y reescribir una escena en streaming.
- Salida estructurada, función forzada con esquema y búsqueda web.
- OpenRouter por OAuth PKCE y Ollama en local.

Toda escena enviada sale de `fixtures/la-veda`, nunca de un manuscrito real. La reescritura solo prueba el streaming y aparece en un panel de solo lectura.

## Requisitos

- Rust estable con MSVC en Windows, Node.js y WebView2.
- Solo se ha probado en Windows.
- Para ChatGPT, una cuenta. La inferencia necesita Plus o Pro. Para OpenRouter, una cuenta. Para Ollama, tenerlo instalado con algún modelo descargado.

## Uso

```sh
cd prototypes/m0
npm install
npm run tauri dev
```

La ventana permite iniciar sesión, elegir modelo, reescribir la escena y ejecutar todas las pruebas de cada vía.

Lo mismo por terminal, sin ventana:

```sh
cd prototypes/m0/src-tauri
cargo run --bin probe -- status
cargo run --bin probe -- chatgpt login
cargo run --bin probe -- chatgpt models
cargo run --bin probe -- chatgpt run <modelo>
cargo run --bin probe -- openrouter login
cargo run --bin probe -- openrouter models openai/
cargo run --bin probe -- openrouter run <modelo>
cargo run --bin probe -- openrouter key
cargo run --bin probe -- ollama run
```

Pruebas automáticas, contra un servidor simulado y sin ninguna cuenta:

```sh
cd prototypes/m0/src-tauri
cargo test --lib
```

## Qué consume

| Vía | Coste de una tanda de pruebas |
|---|---|
| ChatGPT | 9 peticiones cortas que cuentan para el límite del plan. La tanda se detiene si llega al límite |
| OpenRouter | 2 peticiones cortas. Nada con un modelo gratuito. La búsqueda web es opcional y de pago: con `--with-search` son 2 peticiones y al menos 2 búsquedas (unos 0,007 $ cada una con Exa), más los tokens. Un modelo puede buscar varias veces en una petición |
| Ollama | Nada: es local |

## Datos locales

Todo queda en `%LOCALAPPDATA%\ink-writer-m0\`:

| Archivo | Contenido |
|---|---|
| `state.json` | ID de host e ID de cliente emitido. No son secretos |
| `vault.bin` | Tokens y clave de OpenRouter, cifrados con AES-256-GCM |
| `reports/*.json` | Informes: estados HTTP, códigos, eventos, recuentos y tiempos |

La clave de `vault.bin` está en el Administrador de credenciales de Windows, con el nombre `ink-writer-m0`. Los tokens no llegan al WebView.

Los informes no contienen tokens, texto de escenas, salida del modelo ni datos de la cuenta. Las pruebas lo comprueban. Sí contienen las URL de las fuentes citadas en la búsqueda web.

## Desinstalar

1. Pulsa **Cerrar sesión** o ejecuta `probe chatgpt logout`. Esto revoca el token de refresco, pero la app sigue conectada a tu cuenta: quítala también en los ajustes de ChatGPT.
2. Revoca la clave «Ink Writer M0» en los ajustes de OpenRouter.
3. Borra `%LOCALAPPDATA%\ink-writer-m0\` y la credencial `ink-writer-m0`.
