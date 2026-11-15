# 0014 · La conexión mínima en la app

**Estado:** aceptada. Cómo se ha hecho la conexión mínima que decidió la 0012: el transporte, la clave, el ajuste y la cola.

**Contexto.** Los adaptadores del core hablan con los modelos a través de `AiTransport`. En la evaluación lo implementa Node. En la app tiene que hacerlo el shell, porque la CSP impide a la página abrir conexiones y porque las claves no pueden llegar al WebView (regla 9).

## Decisión

**Dos comandos: `ai_send` y `ai_cancel`.** La página indica vía, método, ruta y cuerpo. El shell añade la credencial, envía la petición y devuelve la respuesta por un canal de Tauri, a trozos y en orden: cabecera, trozos, y un único final, que es `end` o `error`. Todo va por el canal, también los fallos, porque el resultado del comando puede adelantar a los últimos trozos.

**Los trozos viajan en base64.** Un trozo puede acabar en mitad de un carácter, y es la página quien los une.

**El shell solo acepta las peticiones que la app hace.** Es una lista cerrada:

| Vía | Peticiones |
|---|---|
| Ollama | `GET /api/tags`, `POST /api/chat` |
| OpenRouter | `GET /api/v1/models`, `GET /api/v1/key`, `POST /api/v1/chat/completions` |

**Por OpenRouter, el shell rechaza lo que pueda costar dinero:** un modelo que no acabe en `:free`, y los campos `plugins`, `tools`, `web_search_options` y `models`. Es el límite de la 0012 aplicado donde la página no puede saltárselo. El core sigue comprobando además el precio declarado, porque el sufijo por sí solo no lo garantiza. M6 lo abrió junto con los topes de uso: ver la [0018](0018-conexiones-sin-chatgpt.md).

**La clave solo se envía a su servicio.** Nunca a Ollama. No se siguen redirecciones, que podrían llevar el manuscrito a otro sitio.

**Cancelar es explícito.** La página da un identificador a cada petición y lo usa para cancelarla, al abortar o si deja de leer la respuesta.

**Sin tope de tiempo total.** Hay 10 s para conectar y 10 minutos entre trozo y trozo, porque un modelo local puede tardar minutos en cargar.

**En un modo de prueba, la app nunca alcanza los servicios reales.** Las dos vías apuntan a donde diga `--test-ai`, y si no se indica, a una dirección donde no escucha nadie.

## La clave de OpenRouter

**Se obtiene entrando por el navegador,** como pide `SPEC.md` §6: PKCE con S256 y un `state` nuevo en cada intento. El shell abre un puerto en `127.0.0.1` antes que el navegador, espera el regreso y canjea el código. Es la misma secuencia que ya usa `npm run eval:login`, escrita de nuevo en Rust, sin tomar nada de `prototypes/m0/`.

- **Solo cuenta la respuesta de este intento.** Una petición a otra ruta, sin código o con otro `state` se rechaza y la espera sigue.
- **El navegador dice la verdad.** La página de «listo» se sirve después del canje, no antes.
- **Se puede cancelar en todo momento,** y a los 5 minutos se abandona. Un intento nuevo cancela el anterior. Lo pedía la 0008.

**Se guarda en el almacén seguro del sistema,** con `keyring`. Si no hay ninguno, como en un Linux sin servicio de secretos, va a un archivo en la carpeta de datos que solo su dueño puede leer, con escritura atómica. Nunca en la base de datos, que la página puede consultar.

**Ningún comando devuelve la clave.** La página solo puede preguntar si hay conexión, iniciarla, cancelarla y quitarla. Quitarla la olvida en este equipo, pero no la borra de la cuenta de OpenRouter.

**En un modo de prueba** la clave vive en memoria y no se puede iniciar sesión, para no tocar las credenciales reales ni abrir un navegador.

## Dependencias

`reqwest` con `native-tls`, `tokio`, `futures-util`, `keyring`, `sha2`, `getrandom`, `url` y `open`, todas MIT o Apache-2.0. Se usa el TLS del sistema: no añade excepciones a `npm run licenses`, y en Linux necesita `libssl-dev`, que el CI ya instala.

## Pruebas

- **Rust:** contra un servidor local. Lista cerrada, modelo de pago rechazado antes de salir, respuesta a trozos con un carácter partido, error del servicio, redirección, servicio inalcanzable, respuesta cortada y destino de la clave.
- **Página:** orden de los eventos, cancelación en cada momento y lectura abandonada.
- **Prueba de humo:** en la app real, un adaptador lista modelos y recibe una respuesta de un servidor simulado, y el shell rechaza un modelo de pago. Se ejecuta en los tres sistemas.
- **Login:** contra un servidor local que hace de OpenRouter y un cliente que hace de navegador. Canje correcto, respuestas ajenas rechazadas, canje denegado y espera sin respuesta.
- **Almacén:** el del sistema se prueba a mano, porque escribe en las credenciales reales de quien lo ejecuta: `cargo test --lib system_store -- --ignored`. Comprobado en Windows 11.

- **Pantalla:** el panel de IA y la cola, con modelos simulados. Nada se analiza sin elegir modelo, solo se pregunta al elegido, cada estado se ve, y el aviso precede a la conexión.
- **Prueba de humo, de punta a punta:** la app real lee la escena guardada, la envía por el shell y guarda el dato con su cita.

## El ajuste y la cola

**La elección del autor se guarda en la base,** en una tabla `settings` nueva (migración 4): vía y modelo. Nunca una credencial. Es de toda la app, no de cada novela.

**Sin elección no se analiza nada.** La app no trae ningún modelo por defecto ni cambia a otro si el elegido falla (regla 10). Lo que se guardó y no se entiende cuenta como no haber elegido.

**Solo se ofrecen modelos que sirven:** los que siguen un esquema y, por OpenRouter, los gratuitos.

**El aviso de OpenRouter va antes de conectar.** Dice que el texto sale del equipo y que algunos proveedores gratuitos pueden guardarlo o usarlo para entrenar. Se acepta una vez y queda anotado. Sin esa aceptación, la cola no arranca por OpenRouter aunque la elección esté guardada. El aviso sigue a la vista después.

**La cola de la 0011, conectada:** arranca al abrir la novela, se entera de cada cambio al teclear y de cada escena que se deja, una vez guardada. Su estado se ve en la barra, junto a los demás controles, y con detalle en el panel. Como el resto de la barra, desaparece mientras se escribe.

**Dos correcciones en la cola,** que la app sacó a la luz:

- Abrir una escena cuenta como un cambio en ella, y eso retrasaba hasta la siguiente pausa el análisis de la escena recién cerrada. Ahora un cambio no aplaza una pasada que ya toca.
- Una escena cerrada mientras se analizaba otra esperaba una pausa entera. Ahora va justo después.

No cambian los prompts ni lo que se pregunta al modelo, así que la evaluación de `fixtures/` no se ve afectada.

**Comprobado a mano por el autor** el 15 de noviembre de 2026, en Windows 11: el login contra OpenRouter real desde la app, de principio a fin.

## Sin comprobar todavía

- **Un análisis en la app con un modelo real,** por Ollama o por OpenRouter. El canal se midió en M3 con el arnés, y aquí solo se ha probado el recorrido con respuestas simuladas.
- **El almacén del sistema en macOS y Linux.**
- **El aspecto del panel.** Las pruebas comprueban lo que dice y lo que hace, no cómo se ve.
- **La política de datos de cada modelo gratuito,** que pedía la 0012. El aviso es general y no distingue entre modelos.

## El resto de M4

Las fichas, los enlaces y las correcciones del autor están en la [0015](0015-fichas-enlaces-y-correcciones-del-autor.md).
