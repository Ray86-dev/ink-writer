# 0016 · Pistas y Siguiente paso, sin IA nueva

**Estado:** aceptada. Primera parte de M5. Lo que la IA tiene que redactar queda para una segunda parte, con su evaluación.

**Contexto.** M5 pide niveles de pistas, interruptores por tipo, pistas graduales, Siguiente paso, cierre automático y la compañera, con una condición de salida: con las pistas apagadas no se dispara ninguna tarea, marca ni búsqueda. El análisis de M3 ya deja contradicciones, nombres parecidos y erratas con sus citas. Esta parte construye todo lo que se puede construir sobre eso, sin tocar ningún prompt.

## Decisión

**Las pistas se calculan desde las fichas, sin preguntar a ningún modelo.** Cada aviso abierto que el análisis dejó, y que el texto sigue sosteniendo, es una pista. Viven en `packages/core/src/hints/`.

| Aviso del análisis | Tipo de pista |
|---|---|
| Contradicción | Coherencia |
| Nombres parecidos | Coherencia |
| Errata u ortotipografía | Correcciones |

Preguntas, Sugerencias y Documentación tienen su interruptor, pero todavía ninguna pista: las dos primeras necesitan el paso 4 de `SPEC.md` §5 y la tercera es de M7.

**Apagadas significa nada.** Con el nivel Apagadas no hay pistas ni tarea, se calcule lo que se calcule. Mientras no se ha leído lo que eligió el autor, la app se comporta como apagada, para no enseñar durante un instante lo que el autor quitó. Las fichas siguen actualizándose, como pide `SPEC.md` §3.4.

**El nivel decide cómo se enseñan, no cuáles hay.**

| Nivel | En la barra | Al leer |
|---|---|---|
| Apagadas | «Pistas: apagadas» | Nada |
| Si las pido | «Pistas», sin número | Nada. En el panel, una pista cada vez que se pide |
| Discretas | «Pistas» y el contador | Los pasajes subrayados |
| Compañera | «Pistas» y el contador | Subrayados y una gota de tinta que propone la siguiente pista |

Discretas es el nivel por defecto, como propone `SPEC.md` §11.

**Las marcas solo existen en «Ver enlaces y pistas».** En los dos modos de escritura no se subraya nada ni aparece la compañera (regla de `SPEC.md` §3.3). Son una decoración del editor, como los enlaces: no cambian el documento.

**Tres pasos, y el autor pide el siguiente.** Primero una pista vaga («Algo no encaja aquí»), luego una orientada («Compáralo con Capítulo 1 · Escena 2») y al final el motivo con las dos citas. Los textos de los dos primeros pasos son fijos y no los escribe ningún modelo. Una corrección no tiene paso intermedio: de la pista vaga pasa al cambio propuesto.

**Lo que el autor decide se guarda por los pasajes, no por un identificador.** El análisis da identificadores nuevos cada vez, así que la clave de una pista se forma con su tipo y las citas que la sostienen, en cualquier orden. Va a una tabla nueva, `hint_states` (migración 6), donde el análisis no escribe. Así «Es intencionado», «Déjalo así» y hasta dónde se reveló una pista sobreviven a cualquier reanálisis (regla 4).

| Acción | Efecto |
|---|---|
| Lo corrijo yo | Va al pasaje en modo Escribir |
| Es intencionado, Déjalo así | Cierra la pista para siempre |
| Aplicar | Sustituye la cita por la corrección |
| Ahora no | La aparta hasta que se vuelva a abrir la novela |

**«Aplicar» es la única ruta que cambia el manuscrito,** y solo cuando el autor pulsa ese botón sobre esa corrección (regla 1). El botón no aparece hasta que el autor ha visto el cambio exacto. Es un solo paso que se deshace con Ctrl+Z. Si la cita ya no está en el texto, no se cambia nada.

**Cierre automático.** Una pista cuyo texto desaparece deja de existir, porque las fichas ya descartan lo que no tiene cita (0015). Se recalcula al abrir el panel de pistas y al pasar al modo de lectura, además de al abrir la novela y al acabar cada pasada del análisis.

**Siguiente paso: una sola tarea, con su motivo.**

| Tipo | De dónde sale |
|---|---|
| Resolver | Una pista de coherencia abierta |
| Definir | Una ficha que el texto nombra en dos escenas o más sin decir nada de ella |
| Completar | Una escena vacía con escenas escritas después |

Lo que está por resolver va primero. «Esta no me sirve» la descarta para siempre y pasa a la siguiente, sin cerrar la pista de la que salía. «Hoy solo quiero escribir» quita las tareas hasta el día siguiente. Si no hay nada que proponer, no se propone nada: la app no inventa tareas.

## Un fallo de lectura, corregido de paso

Leer el texto de una escena hacía dos consultas: la base compactada y las actualizaciones. Si la escena se compactaba entre las dos, la lectura se quedaba con la base antigua y sin las actualizaciones, es decir, con menos texto del que hay guardado. **No se perdía nada en disco,** pero al reabrir una novela justo después de cerrarla las fichas y las pistas podían salir vacías. Ahora la lectura comprueba la versión y se repite si cambió. Tiene su prueba, y `npm run crash-test` y `npm run close-test` siguen pasando.

## Lo que no se ha hecho

- **El tipo de tarea Escribir,** las pistas de Preguntas y Sugerencias, el resumen de cada ficha y el «qué cambia» de cada capítulo. Todo eso lo redacta la IA: es el paso 4 de `SPEC.md` §5 y exige prompts nuevos con su evaluación. Se hizo después, en la [0017](0017-lo-que-redacta-la-ia.md).
- **Siguiente paso está en el panel de pistas.** `SPEC.md` §3.1 lo pone grande en el Dashboard, que es de M8.
- **«Ahora no» no se guarda:** dura hasta que se vuelve a abrir la novela.
- **Los ajustes de pistas son de toda la app,** no de cada novela.

## Pruebas

- **Core:** qué pistas hay con cada nivel e interruptor, el orden, los tres pasos, el cierre al desaparecer el texto, las decisiones ante un reanálisis que encuentra lo mismo dicho al revés, y cada tipo de tarea.
- **Pantalla, la condición de salida:** con las pistas apagadas no hay tarea, marca, pista ni compañera en ninguno de los tres modos, no se pregunta a ningún modelo, y las fichas siguen ahí.
- **Pantalla, el resto:** cada nivel, las marcas solo al leer, la pista gradual y que se recuerda, cada acción, «Aplicar» cambiando solo ese pasaje y deshaciéndose en un paso, y Siguiente paso con sus dos salidas.

## Sin comprobar

- **El aspecto** del panel, de las marcas y de la compañera. Nadie los ha visto.
- **Las pistas con el análisis de un modelo real.** Las pruebas usan avisos preparados.
- **La búsqueda** que nombra la condición de salida no existe todavía: es de M7, que tendrá que respetar el mismo nivel Apagadas.
