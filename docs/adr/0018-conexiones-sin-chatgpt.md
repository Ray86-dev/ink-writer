# 0018 · M6 sin ChatGPT: modelos de pago con tope y clave propia

**Estado:** aceptada. Cambia la 0008, que hacía obligatoria la comprobación de ChatGPT antes de M6, y levanta el límite de «solo modelos gratuitos» de la 0012 y la 0014.

**Contexto.** M6 pedía «Continue with ChatGPT», lo que faltaba de OpenRouter y Ollama, claves de API, topes de uso y borrador en streaming. La comprobación de ChatGPT necesita un plan Plus o Pro que el autor no tiene y ha decidido no contratar por ahora. El resto no depende de ella, y dos partes ya pesaban: la app solo dejaba usar modelos gratuitos, que dan para unas 7 escenas al día, y el modelo que mejor salió en las evaluaciones no se podía usar desde ella.

## Decisión

**M6 se hace sin ChatGPT.** El autor lo decidió el 15 de noviembre de 2026. OpenRouter sigue siendo la vía principal, ahora sin fecha para dejar de serlo. La vía de ChatGPT no se descarta: queda fuera de la hoja de ruta hasta que se pueda comprobar con un plan de pago, y `prototypes/m0/` se conserva para entonces. Si se retoma, hará falta un ADR nuevo.

**El «borrador en streaming» se queda fuera.** `SPEC.md` solo lo menciona en la vía de ChatGPT, y la app no redacta prosa: no hay nada que mostrar en streaming.

### Pagar exige dos topes que pone el autor

Hasta ahora la app no podía gastar. Ahora puede, y solo así:

- **Sin topes, nada de pago.** Un modelo de pago no se ofrece ni se usa hasta que el autor pone los dos: gasto máximo al día en dólares y peticiones de pago máximas al día. Quitar cualquiera de los dos quita ambos y apaga la elección de pago.
- **Nunca por defecto y nunca en silencio (regla 10).** Los modelos de pago de OpenRouter solo se listan si el autor marca que los quiere, y aparecen señalados como de pago. La app no pasa de un modelo gratuito a uno de pago, ni al revés, por su cuenta.
- **Al llegar a un tope, el análisis se detiene** hasta el día siguiente. Lo pendiente queda en cola.

**Los dos topes se vigilan en sitios distintos, a propósito.**

| Tope | Dónde se vigila | Contra qué protege |
|---|---|---|
| Peticiones de pago al día | En Rust, antes de que salga cada petición | Un fallo de la página que pida sin parar. La página no puede saltárselo |
| Gasto al día | En el core, entre escena y escena | Gastar más de lo que el autor quiere en uso normal |

- El de Rust se guarda en un archivo de la carpeta de datos. Si no se puede leer, cuenta como «nada permitido», nunca como «sin tope». Una petición que no se pueda anotar no sale.
- El gasto se anota en la base (tabla `ai_usage`, migración 8) según llega cada respuesta, así que cerrar la app a mitad del día no pone la cuenta a cero.
- El gasto se comprueba antes de cada escena, no de cada petición: una escena puede pasarse del tope por lo que cuestan sus propias peticiones. El tope de Rust es el que no se rebasa nunca.

**Si no se sabe cuánto costó una respuesta, el análisis se para.** Por OpenRouter el coste lo dice el servicio, y a los modelos de pago se les pide expresamente. Por DeepSeek se calcula con los tokens y la tarifa más alta publicada. Un modelo sin precio conocido no se ofrece.

**Lo que se cobra aparte del modelo sigue rechazado siempre** en Rust: `plugins`, `tools`, `web_search_options` y `models`. La búsqueda web tendrá su propio tope en M7.

### Clave de API propia: DeepSeek

- **Solo DeepSeek por ahora.** Su adaptador ya existía y estaba evaluado. Otros proveedores necesitan su adaptador, su lista de precios y pasar la evaluación: no se añaden a ciegas.
- **La clave se escribe en el panel y pasa una vez por la página,** de camino al shell. No hay otra forma de introducir una clave pegada. El shell la guarda en el almacén seguro del sistema, igual que la de OpenRouter, y ningún comando la devuelve. El campo es de tipo contraseña y se vacía al guardar. Es un matiz de la regla 9: el token no vuelve nunca al WebView, pero entra por él.
- **Tiene su propio aviso,** que hay que aceptar antes de escribir la clave: el texto sale del equipo hacia DeepSeek y es de pago.

### Errores

Cada motivo por el que el análisis se detiene tiene un texto que dice qué hacer, en español y en inglés, y una prueba: clave rechazada, sin saldo, modelo que ya no existe, límite del servicio, servicio caído, sin conexión, topes alcanzados, coste desconocido y modelos de pago desactivados. Un motivo que no se reconoce se muestra tal como lo dijo el servicio.

## Lo que no se ha hecho

- **«Continue with ChatGPT»** y sus errores de `SPEC.md` §6. La condición de salida de M6, «cada error de §6 tiene su prueba», se cumple para las vías que existen, no para esa.
- **Otras claves de API:** OpenAI, Anthropic y demás.
- **Modelo por función.** `SPEC.md` §3.9 lo prevé, y hay un solo modelo para todo el análisis.
- **Los precios de DeepSeek están escritos en el código,** con su fecha. Si cambian, la cuenta se desvía hasta actualizarlos. Como se usa la tarifa más alta, lo normal es que cuente de más.

## Pruebas

- **Rust:** el tope diario, que vuelve a empezar al día siguiente y sobrevive a un reinicio; lo de pago rechazado sin permiso; lo que se cobra aparte rechazado siempre; y cada clave solo hacia su servicio.
- **Core:** qué cuesta dinero, cuánto cuesta una respuesta por cada vía, y el guardián del gasto en la cola, con el tope, el día siguiente y el coste desconocido.
- **Pantalla:** los modelos de pago no aparecen hasta pedirlos y poner los dos topes, el análisis se detiene al llegar al tope sin cambiar de modelo, la clave llega al shell y no queda en la página, y cada error con su texto.
- **Prueba de humo:** en la app real, con un tope de una petición de pago, el shell deja salir la primera y rechaza la segunda.

## Sin comprobar

- **Un modelo de pago real por OpenRouter.** No hay saldo en la cuenta. En particular, no está comprobado que el servicio devuelva el coste de cada respuesta como espera la app. Si no lo hace, el análisis se detiene en la primera respuesta en vez de gastar a ciegas.
- **DeepSeek desde la app.** El adaptador está probado contra el servicio real en las evaluaciones, pero no a través del shell ni con una clave escrita en el panel.
- **El aspecto del panel** con las opciones nuevas.
