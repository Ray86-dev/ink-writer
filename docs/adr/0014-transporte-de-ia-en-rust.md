# 0014 · Transporte de IA en Rust

**Estado:** aceptada. Primer paso de la conexión mínima de la 0012.

**Contexto.** Los adaptadores del core hablan con los modelos a través de `AiTransport`. En la evaluación lo implementa Node. En la app tiene que hacerlo el shell, porque la CSP impide a la página abrir conexiones y porque las claves no pueden llegar al WebView (regla 9).

## Decisión

**Dos comandos: `ai_send` y `ai_cancel`.** La página indica vía, método, ruta y cuerpo. El shell añade la credencial, envía la petición y devuelve la respuesta por un canal de Tauri, a trozos y en orden: cabecera, trozos, y un único final, que es `end` o `error`. Todo va por el canal, también los fallos, porque el resultado del comando puede adelantar a los últimos trozos.

**Los trozos viajan en base64.** Un trozo puede acabar en mitad de un carácter, y es la página quien los une.

**El shell solo acepta las peticiones que la app hace.** Es una lista cerrada:

| Vía | Peticiones |
|---|---|
| Ollama | `GET /api/tags`, `POST /api/chat` |
| OpenRouter | `GET /api/v1/models`, `GET /api/v1/key`, `POST /api/v1/chat/completions` |

**Por OpenRouter, el shell rechaza lo que pueda costar dinero:** un modelo que no acabe en `:free`, y los campos `plugins`, `tools`, `web_search_options` y `models`. Es el límite de la 0012 aplicado donde la página no puede saltárselo. El core sigue comprobando además el precio declarado, porque el sufijo por sí solo no lo garantiza. M6 abrirá esto junto con los topes de uso.

**La clave solo se envía a su servicio.** Nunca a Ollama. No se siguen redirecciones, que podrían llevar el manuscrito a otro sitio.

**Cancelar es explícito.** La página da un identificador a cada petición y lo usa para cancelarla, al abortar o si deja de leer la respuesta.

**Sin tope de tiempo total.** Hay 10 s para conectar y 10 minutos entre trozo y trozo, porque un modelo local puede tardar minutos en cargar.

**En un modo de prueba, la app nunca alcanza los servicios reales.** Las dos vías apuntan a donde diga `--test-ai`, y si no se indica, a una dirección donde no escucha nadie.

## Dependencias

`reqwest` con `native-tls`, `tokio` y `futures-util`, todas MIT o Apache-2.0. Se usa el TLS del sistema: no añade licencias nuevas a `npm run licenses`, y en Linux necesita `libssl-dev`, que el CI ya instala.

## Pruebas

- **Rust:** contra un servidor local. Lista cerrada, modelo de pago rechazado antes de salir, respuesta a trozos con un carácter partido, error del servicio, redirección, servicio inalcanzable, respuesta cortada y destino de la clave.
- **Página:** orden de los eventos, cancelación en cada momento y lectura abandonada.
- **Prueba de humo:** en la app real, un adaptador lista modelos y recibe una respuesta de un servidor simulado, y el shell rechaza un modelo de pago. Se ejecuta en los tres sistemas.

## Pendiente en M4

- La clave de OpenRouter: el login y el almacén seguro. Hasta entonces esa vía va sin credencial.
- El ajuste de vía y modelo, la cola conectada a la app y su estado a la vista.
- El aviso de que el texto sale del equipo, antes de la primera petición por OpenRouter.
