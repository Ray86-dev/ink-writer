# 0010 · Editor con React y guardado de la prosa

**Estado:** aceptada.

**Contexto.** M2 guarda por primera vez el texto del autor, donde perderlo es el fallo imperdonable (regla 2). La 0009 dejó abiertos el framework de interfaz y qué ocurre con dos instancias de la app.

## Framework: React 19

Sin Next ni otro framework encima. Comparativa medida con el mismo editor de TipTap y Yjs, sin comprimir:

| Opción | Framework solo | Con el editor |
|---|---|---|
| Sin framework | 0 | 485 KB |
| Svelte 5 | 24 KB | 508 KB |
| Vue 3 | 62 KB | 550 KB |
| React 19 | 213 KB | 718 KB |

React pesa más, pero se carga del disco y no por red, y la ligereza de la app viene de no incluir un navegador. A cambio aporta integración oficial con TipTap, herramientas de accesibilidad y la mayor comunidad posible de colaboradores, y el autor ya lo conoce. **El editor queda fuera del ciclo de renderizado de React,** para que teclear no redibuje nada.

## Registro de solo añadir

Cada transacción de Yjs se añade como una fila nueva de `scene_updates`. **La prosa nunca se sobrescribe:** una escena es su base compactada (`scenes.ydoc`) más sus actualizaciones.

Es lo que hace seguro al sistema, porque aplicar una actualización de Yjs dos veces no tiene efecto y el orden no importa. Un cierre forzado deja, como mucho, algo sin aplicar, nunca algo destruido. Dos escritores se combinan en vez de pisarse, sin last-write-wins.

**Sin temporizador de guardado.** Cada cambio sale al instante. Si hay una escritura en curso, los siguientes se acumulan y salen juntos al terminar. Así un disco lento no bloquea ni acumula escrituras, y la ventana de pérdida es solo lo que aún no ha llegado a confirmarse.

**Qué significa «ninguna pérdida».** Lo confirmado por la base sobrevive a cualquier cierre forzado. Lo tecleado en los milisegundos anteriores al cierre puede no haber llegado a confirmarse: esa ventana existe en cualquier sistema, y se mide en `npm run crash-test`.

**Si falla una escritura,** el cambio sigue en memoria, se reintenta con espera creciente y la app lo avisa aunque esté en modo zen. No se descarta nada.

**Compactación.** Sustituye la base y borra las filas ya incluidas, en una sola transacción y solo hasta el último ID leído. Las escrituras que llegan mientras tanto quedan intactas. Antes de confirmar, comprueba que el resultado reproduce el mismo texto.

El riesgo está en que dos compactaciones se solapen: la más antigua podría confirmar la última y sustituir la base por una sin lo que la otra ya había incorporado y borrado del registro. Por eso solo corre una a la vez en cada sesión, y la transacción comprueba `scenes.ydoc_version`: una base construida a partir de una lectura antigua se rechaza sin cambiar nada.

## Historial

Una versión (`scene_snapshots`) guarda el estado completo de la escena. Se crean al cerrarla, cada 10 minutos de edición, a petición del autor y antes de recuperar otra.

**Recuperar es una edición más:** primero se guarda una versión del estado actual, y luego el contenido se sustituye a través del editor. Se puede deshacer y no se reescribe el pasado. Por ahora no se borran versiones antiguas. Hay que revisar el espacio que ocupan con uso real.

## Borrado

Mover capítulos o escenas a la papelera solo los marca, y pueden recuperarse. Todavía no existe el borrado definitivo.

## Una sola instancia

Dos ventanas sobre la misma escena mostrarían textos distintos, aunque Yjs los combinara al guardar. Defensa en dos capas:

1. **`tauri-plugin-single-instance`:** al abrir la app de nuevo, se enfoca la ventana existente.
2. **`PRAGMA locking_mode = EXCLUSIVE`:** si otro proceso consiguiera arrancar, no podría escribir y la app avisaría. El sistema operativo libera el bloqueo cuando el proceso muere, de modo que un cierre forzado no deja la base bloqueada.

Se descarta bloquear por escena, porque un cierre forzado dejaría bloqueos huérfanos. Si algún día se quieren dos escenas a la vez, se mostrarán en la misma ventana.

## Exportación

El manuscrito se exporta desde lo ya guardado, con capítulos como títulos y escenas separadas por un marcador.

**El DOCX se escribe a mano,** con `fflate` para el ZIP y sin librería de DOCX. Las librerías añaden metadatos de autoría y de generador que luego habría que limpiar, y un archivo sin `docProps` no tiene nada que limpiar (regla 11). Las pruebas abren el resultado con un lector independiente.

**Guardar el archivo lo hace Rust.** El diálogo nativo lo abre el shell, y la página no puede elegir por sí sola dónde escribir.

## Medidas

Con la app real, en el CI de cada sistema y el 8 de noviembre de 2026. Son máquinas virtuales compartidas, así que importa el orden de magnitud y no el número exacto.

| | Windows | macOS | Linux |
|---|---|---|---|
| Cierres forzados | 8 | 8 | 8 |
| Escrituras confirmadas | 714 | 4.269 | 1.152 |
| Texto perdido, desordenado o repetido | Nada | Nada | Nada |
| De escrito a confirmado en disco, normalmente | 13 ms | 2 ms | 12 ms |
| De escrito a confirmado en disco, peor caso | 41 ms | 480 ms | 240 ms |
| Teclear con 150.000 palabras: mediana y peor caso | 4 y 110 ms | 13 y 26 ms | 5 y 24 ms |
| Lo mismo, tras 20.000 ediciones dispersas | 5 y 7 ms | 19 y 30 ms | 7 y 22 ms |
| Una escena normal de 500 palabras | 1 y 7 ms | 5 y 16 ms | 4 y 21 ms |

En un equipo de desarrollo con Windows y SSD, 15 cierres forzados y 2131 escrituras confirmadas tampoco perdieron nada. De lo escrito a lo confirmado en disco pasaron unos 7 ms, y como mucho 21 ms en una tanda posterior.

**Lo que estas medidas no dicen:**
- Las pulsaciones pasan por las transacciones del editor, no por el teclado del sistema. El autor probó a escribir en Windows sin notar problemas, pero falta un uso prolongado.
- Matar el proceso no equivale a un corte de luz. `synchronous=FULL` está pensado para eso, pero no se ha probado.
- El DOCX se ha comprobado con `mammoth` y LibreOffice, no con Word.
- La interfaz solo se ha visto en Windows. En macOS y Linux se ha ejecutado, pero nadie la ha mirado.

## Consecuencias

- Cada pulsación hace una escritura con `synchronous=FULL`, lo que multiplica las sincronizaciones con el disco. Es asumible porque las escrituras se agrupan y no bloquean el teclado.
- Por ahora, una escena solo se reordena dentro de su capítulo. Moverla a otro queda pendiente.
- `scene_updates` crece hasta la siguiente compactación, que ocurre al cerrar la escena o tras muchas actualizaciones.
- Solo habrá una ventana de la app.
- Las anclas de M4 son posiciones relativas de Yjs: recuperar una versión sustituye el texto, y las anclas de lo sustituido se pierden. M4 debe tratarlo.
