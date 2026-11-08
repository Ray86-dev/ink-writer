# 0008 · Resultado de M0: vías de IA

**Estado:** aceptada. Modifica la 0003: OpenRouter es la vía principal provisional. La comprobación de ChatGPT queda pendiente y es obligatoria antes de M6.

**Contexto.** M0 debía comprobar si el producto puede apoyarse en «Continue with ChatGPT» y probar también OpenRouter y Ollama. El prototipo está en `prototypes/m0/`. Pruebas del 8 de noviembre de 2026 en Windows 11 con WebView2 y una RTX 3060 Ti de 8 GB.

**Límite de esta prueba.** No se dispuso de una cuenta Plus ni Pro. La inferencia por la vía ChatGPT **no se ha probado**. Que no se haya probado no significa que falle.

Cada resultado indica de dónde sale:
- **Real:** contra el servicio real.
- **Simulado:** contra un servidor simulado, con 115 pruebas automáticas. Comprueba nuestra lógica, no el comportamiento de OpenAI.
- **Documentación:** lo dice la documentación, sin comprobar.

## Vía ChatGPT

| Comprobación | Resultado | Origen |
|---|---|---|
| El endpoint de autorización acepta los parámetros de `SPEC.md` §6 | Sí | Real |
| Registro dinámico: el callback devuelve `client_id` con prefijo `oaiapp` | Sí | Real |
| Registro en un puerto distinto de 1455 | Sí, en el 52666. La documentación solo pone 1455 de ejemplo | Real |
| Plan gratuito | **Bloqueado en la pantalla de permisos de OpenAI** | Real |
| Canje del código con cuenta gratuita | `400 invalid_grant` sin descripción. Causa sin confirmar | Real |
| Reautorizar con el ID emitido tras `invalid_grant` | Vuelve a la pantalla de permisos, donde se bloquea | Real |
| Pulsar «Cancelar» en la pantalla de permisos | **Sin verificar.** La app agotó los 5 minutos sin recibir ningún callback. No se sabe si se pulsó después o si OpenAI no redirige en ese caso | Real |
| Callback `access_denied` | Implementado | Simulado |
| Validar el ID token (RS256, issuer, audience, nonce, expiración) | Implementado. Nunca se ha recibido un token real | Simulado |
| Refresco rotatorio, revocación, cortes de stream, errores 429 y 401 | Implementado | Simulado |
| Listar modelos y reescribir en streaming | **Sin probar** | |
| `text.format` con esquema | **Sin probar.** No está documentado | |
| Función forzada: de primer nivel, en namespace o con `additional_tools` | **Sin probar.** Las formas JSON salen de la referencia general de Responses | |
| Búsqueda web | **Sin probar.** La documentación solo dice que depende del modelo y de la política de la cuenta | |
| Leer el uso restante | **Sin probar.** La documentación no ofrece ninguna API | |

Texto de la pantalla con el plan gratuito: *«Un permiso obligatorio no está disponible. No puedes continuar con esta área de trabajo y este plan.»*, con un botón «Mejorar plan».

Esto matiza la hipótesis de que una cuenta sin el permiso entra con el plan desactivado. La rama sigue documentada, pero en esta prueba el usuario gratuito no llegó a entrar.

El `invalid_grant` ocurrió en el primer intento (petición `08d4b935-1399-47af-afbd-4dd9deeb5a79`). La hipótesis es que se debe al mismo bloqueo por plan, pero el informe de ese intento no guardó el cuerpo del error ni el scope concedido. El prototipo ya los guarda.

Como el usuario puede abandonar en esa pantalla sin que la app reciba nada, M6 debe permitir reintentar o cancelar en todo momento, sin esperar a que se agote el tiempo.

### Uso en una app de escritura

**Sin confirmación expresa.** Ninguna página de la documentación técnica lo aborda ni restringe por caso de uso. Sí dice que está disponible para proyectos open source y personales que se ejecutan en local, lo que encaja con Ink Writer. Dos matices:

- La documentación está orientada a agentes y herramientas de programación.
- El centro de ayuda rechazó la lectura automática (403) y no se ha leído directamente.

**Tampoco está documentado si OpenAI usa estas peticiones para entrenar modelos.** Con manuscritos inéditos es una pregunta importante, y `SPEC.md` §10 promete que el texto solo llega al proveedor elegido. Hay que resolverla antes de ofrecer la vía.

## OpenRouter

Real, con una cuenta sin créditos comprados.

| Comprobación | Resultado |
|---|---|
| OAuth PKCE con `localhost` en un puerto libre y `state` | Funciona |
| Listar modelos | 461 modelos, 387 con `structured_outputs`, 5 de ellos gratuitos |
| Streaming por SSE | Funciona con `nvidia/nemotron-3.5-super-vl:free`. Primer texto en 3 o 4 s |
| Salida estructurada: `response_format` y `require_parameters` | Funciona. Esquema válido y 17 de 17 citas literales en una escena |
| Búsqueda web `openrouter:web_search` en `/api/v1/responses` | Funciona: 2 búsquedas, 6 citas enlazadas, 0,014 $ |
| Búsqueda web `openrouter:web_search` en `/api/v1/chat/completions` | Funciona: 1 búsqueda, 3 citas enlazadas, 0,007 $. Solo se había visto documentada en la otra ruta |

Lo aprendido:

- **La búsqueda se cobra sin saldo previo.** Con 0 $ de crédito no hubo error 402 y la clave registró 0,021 $. Los topes de gasto deben controlarse en la app.
- **Un modelo puede buscar varias veces en una petición.** El coste es por búsqueda, no por petición, así que hay que limitarlo.
- **El razonamiento consume el presupuesto de salida.** Con `max_tokens: 1500` la extracción terminó en `length` sin escribir nada; al subirlo a 4000 usó 2608 tokens de razonamiento antes de responder. También retrasa la respuesta: el JSON llegó de golpe a los 26 s.
- **Los modelos gratuitos no son fiables.** De los 4 probados solo funcionó uno: dos dieron 429 del proveedor y otro un 400 y un corte por `length`.

Queda sin probar un modelo de pago. Tampoco se ha revisado la política de datos de cada proveedor de OpenRouter, que hay que tratar en M6: `SPEC.md` §10 impide enviar manuscritos a quien los registre sin que el autor lo sepa.

## Ollama

Real, con Ollama 0.40.15 y `gemma4:e2b` (4,6 GB).

| Comprobación | Resultado |
|---|---|
| Detectar si el servidor no responde | Funciona |
| Listar modelos y streaming NDJSON | Funciona |
| Salida estructurada con `format` y esquema | Funciona. Esquema válido y 9 de 9 citas literales en una escena, en 7 s |
| Búsqueda web | No aplica: `SPEC.md` §7 usa las API directamente |

Lo aprendido:

- **Carga del modelo:** 104 s la primera vez tras descargarlo y unos 7 s después.
- **Razonamiento oculto:** por defecto genera de 2000 a 2800 caracteres de razonamiento por unos 430 de respuesta, y no llega texto hasta que termina. Con `think: false`, una reescritura baja de 12 s a 0,6 s. El adaptador debe controlarlo y la interfaz, mostrar que está pensando. Queda por medir en M3 cómo afecta a la calidad.

Las citas literales de esta sección y la anterior corresponden a una sola escena. Muestran que el contrato de §5 se puede cumplir, no su calidad, que se mide en M3.

## Aspectos técnicos

- **Almacén seguro.** El Administrador de credenciales de Windows limita cada secreto a 2560 bytes. Se probó guardar allí solo una clave de 32 bytes y cifrar los tokens con AES-256-GCM en un archivo de escritura atómica: funciona en real y evita guardar a medias un refresh rotado. El tamaño real de los tokens sigue sin conocerse.
- **Tokens y WebView.** Ningún comando devuelve un token, y el WebView solo tiene el permiso `core:default`.
- **Licencias.** De 350 dependencias, 345 son permisivas y 5 son MPL-2.0, todas a través de Tauri o de `dirs`: `selectors`, `cssparser`, `cssparser-macros` y `dtoa-short`, solo al compilar, y `option-ext`, enlazada en el binario. La MPL-2.0 es copyleft por archivo y permite usarlas sin modificar en un proyecto MIT, pero hay que indicar dónde obtener su código al distribuir binarios. Conviene confirmar en M1 que esto cumple la regla 8.

## Decisión

Aceptada el 8 de noviembre de 2026. Por ahora no se contrata ningún plan de pago para esta comprobación.

1. **OpenRouter es la vía principal provisional y la de desarrollo.** Es la única nube comprobada de extremo a extremo y cubre salida estructurada y búsqueda web. Ollama queda confirmada como vía local.
2. **«Continue with ChatGPT» sigue siendo el objetivo, sin verificar.** No se descarta, porque nada indica que falle con un plan de pago. Antes de empezar M6 hay que ejecutar la comprobación pendiente.
3. **Avisar antes de abrir el navegador** de que esta vía requiere Plus o Pro, para no dejar al usuario gratuito ante una pantalla sin salida.
4. **El core no da por hecho ninguna forma de salida estructurada.** Cada adaptador declara la suya: `response_format`, `format` o la que se confirme en ChatGPT.

### Comprobación pendiente

Con una cuenta Plus o Pro, unos minutos y 9 peticiones cortas:

```sh
cd prototypes/m0/src-tauri
cargo run --bin probe -- chatgpt login
cargo run --bin probe -- chatgpt models
cargo run --bin probe -- chatgpt run <modelo>
```

El informe queda en `%LOCALAPPDATA%\ink-writer-m0\reports\` y no contiene tokens, textos ni datos de la cuenta. Hay que completar con él la tabla de la vía ChatGPT. Por eso `prototypes/m0/` se conserva hasta entonces.

Si la salida estructurada falla y la función forzada también, o si la búsqueda web no devuelve citas, esta vía no sirve para el análisis o la documentación tal como los define `SPEC.md`, y OpenRouter pasa a ser la opción principal definitiva, como prevé `ROADMAP.md`.

**Consecuencias.** La propuesta de valor «sin pegar claves» se mantiene, porque OpenRouter también entra por OAuth, pero exige créditos para usar modelos fiables. Sigue sin haber una vía en la nube fiable y sin coste para quien no paga: para esa persona, la opción es Ollama, con hardware suficiente. Esto afecta a `SPEC.md` §1, que promete conectarse con la cuenta de ChatGPT como rasgo diferencial.
