# 0012 · Conexión mínima con Ollama y OpenRouter en M4

**Estado:** aceptada. Cambia el reparto entre M4 y M6 de `ROADMAP.md` y el alcance descrito en la 0011. El límite de «solo modelos gratuitos» lo levantó la [0018](0018-conexiones-sin-chatgpt.md), con topes de gasto.

**Contexto.** La salida de M4 es que borrar un párrafo elimine sus datos y que las correcciones del autor sobrevivan al reanálisis. Eso solo se prueba de verdad si la app analiza, y la conexión con los modelos estaba en M6. Trabajar M4 con datos de prueba dejaría ese criterio sin comprobar en la app real.

## Decisión

**M4 incluye una conexión mínima:**

- Transporte HTTP en Rust para Ollama y OpenRouter, que implementa `AiTransport`. La clave de OpenRouter se queda en Rust (regla 9).
- Un ajuste sencillo para elegir vía y modelo.
- La cola de análisis de la 0011 conectada a la app: al abrir un proyecto, al cerrar una escena y tras una pausa.
- El estado de la cola a la vista, porque estar sin conexión o sin permiso tiene que notarse.

**M6 conserva el resto:** ChatGPT, todos los errores con su interfaz, claves de API de otros proveedores, topes de uso y borrador en streaming.

## Límites hasta M6

**Por OpenRouter, solo modelos gratuitos.** La cola analiza sola y en segundo plano, y los topes de uso no llegan hasta M6, así que un modelo de pago podría gastar sin que el autor lo note. Solo se ofrecen los que OpenRouter declara gratuitos, igual que hace ya el arnés de evaluación. Con el cupo gratuito se analizan unas 9 escenas al día, y el resto espera en la cola. Ollama no tiene ese límite.

**El texto sale del equipo.** Con OpenRouter, cada escena viaja a un tercero, y algunos proveedores de modelos gratuitos pueden guardar lo que reciben. Al empezar M4 hay que comprobar qué dice la política de cada modelo, y la app debe avisar al autor antes de la primera petición. Con Ollama, el texto no sale.

**Nunca se cambia de vía ni de modelo en silencio** (regla 10). Si la vía elegida falla, la escena sigue en cola.

## Consecuencias

- M4 crece y se adelanta trabajo de Rust que estaba en M6, sin reutilizar `prototypes/m0/`.
- La comprobación de ChatGPT sigue siendo obligatoria antes de M6. Su resultado no afecta a esta conexión: va detrás de la misma interfaz de proveedor.
