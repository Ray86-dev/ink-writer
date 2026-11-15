# 0015 · Fichas, enlaces y correcciones del autor

**Estado:** aceptada. Cierra M4 junto con la 0014. Cambia `SPEC.md` §4: los datos se sitúan en el texto por su cita literal, no por una posición de Yjs.

**Contexto.** M3 dejó en la base lo que el análisis encuentra: entidades, menciones, hechos, relaciones y avisos, cada uno con su cita. M4 tiene que enseñarlo como fichas, dejar que el autor lo corrija y cumplir dos condiciones: que borrar un párrafo elimine sus datos, y que las correcciones del autor sobrevivan a cualquier reanálisis.

## Decisión

**Las fichas se calculan, no se guardan.** Cada vez que hacen falta se parte de tres cosas: lo que guardó el análisis, las correcciones del autor y el texto de cada escena tal como está ahora. No interviene ningún modelo. Todo esto vive en el core, en `packages/core/src/cards/`.

**Las correcciones del autor se aplican encima y nunca se mezclan con el análisis.** Van a una tabla aparte, `user_overrides` (migración 5), donde el análisis no escribe ni borra. Como se aplican de nuevo cada vez, ningún reanálisis puede deshacerlas (regla 4): no hace falta protegerlas, porque nada las toca. Solo el autor las retira, al deshacer una fusión o una separación.

| Corrección | Qué hace |
|---|---|
| Fusionar | Dos fichas pasan a ser una, con los nombres y pasajes de las dos |
| Separar | Uno de los nombres de una ficha pasa a tener la suya, con los pasajes que lo nombran |
| Mi nota | Una nota propia en la ficha |
| Corregir | El nombre, el tipo o, en un lugar, dentro de qué otro lugar está |
| Descartar | Un pasaje de la ficha, o la ficha entera |

- Se aplican en el orden en que se hicieron.
- Una corrección sobre algo que ahora no está en la novela no cambia nada, y vuelve a valer si reaparece. Lo que el autor dijo de una ficha fusionada llega a la ficha en la que quedó.
- Un pasaje descartado se recuerda por su cita, no por su identificador, que cambia en cada análisis.
- Lo que se guarde y no se entienda se ignora: nunca se adivina.

**Un dato sin cita en el texto no se muestra.** Antes de calcular las fichas se descarta todo aquello cuya cita ya no aparece literalmente en su escena. Es la regla 3 aplicada al momento: al borrar un párrafo, sus datos desaparecen de las fichas sin esperar a que la IA vuelva a leer, también sin conexión. Una contradicción que citaba ese párrafo se cierra sola. Cuando llega el reanálisis, los quita también de la base.

**No hay posiciones de Yjs.** `SPEC.md` §4 preveía un `anchor` por dato y la 0011 lo dejó para M4. No hace falta: la cita es literal, así que el pasaje se encuentra buscándola en la escena. Si el autor cambió ese texto, la cita ya no está y el dato deja de mostrarse, que es justo lo que se quiere. Se evita guardar posiciones que habría que mantener en cada edición.

**Los enlaces en vivo son una decoración del editor.** En «Escribir con enlaces» se subrayan los nombres propios que conocen las fichas, mientras se teclea y sin IA. Nunca cambian el documento (regla 1). Se buscan palabras enteras, el nombre más largo primero y respetando mayúsculas. Las descripciones, como «la doctora», no se enlazan, porque no identifican a nadie fuera de su contexto. Tras cada tecla solo se vuelven a buscar los párrafos que esa tecla tocó, y los demás conservan sus enlaces. En «Escribir» no se subraya nada.

**Navegación en las dos direcciones.**

- Del texto a la ficha: Ctrl o Cmd y clic sobre un nombre mientras se escribe, o un clic en «Ver enlaces y pistas», cuyo panel lista además las fichas de la escena, para llegar con el teclado.
- De la ficha al texto: cada pasaje abre su escena y lo selecciona.
- Entre fichas: relaciones, «Enlazan aquí», capítulos y el índice de nombres.

## Qué fichas hay

| Ficha | Contenido |
|---|---|
| Personaje, lugar, lore | Nombres, «Lo que has escrito» en orden narrativo, relaciones, «Por resolver», «Enlazan aquí», Mi nota y las correcciones |
| Relación | Una por pareja, con cada pasaje que la sostiene |
| Capítulo | Escenas, quién aparece, dónde, cuándo y lo que hay por resolver |
| Nombres | Índice de todos los nombres propios, con su ficha, cuántas veces se usan y el aviso de los que se parecen, con un botón para fusionar |

## Lo que no se ha hecho

Se documenta para no darlo por hecho:

- **El resumen de cada ficha y el «qué cambia» de cada capítulo.** Los redacta la IA y son el paso 4 de `SPEC.md` §5, que no existe todavía. Añadirlo es tocar los prompts, y eso exige pasar la evaluación. Queda para M5, con las pistas y las tareas, que salen del mismo paso.
- **La jerarquía de lugares la pone el autor.** La ficha de un lugar deja elegir dentro de cuál está. El análisis no la deduce.
- **«Por resolver» solo informa.** Las acciones sobre una contradicción son de M5.
- **«Documentación» en la ficha** es de M7, y las tarjetas del Dashboard, de M8.
- **Las correcciones no informan al análisis.** Si el autor fusiona dos fichas, el modelo puede seguir viéndolas como dos, y la fusión se vuelve a aplicar encima. Es correcto, pero el modelo no aprende de ello.
- **Separar usa una regla sencilla:** se lleva los pasajes cuya frase nombra lo separado. Una frase que no nombra a nadie se queda en la ficha de origen.

## Pruebas

- **Core:** cada tipo de ficha, cada corrección, lo que pasa cuando una corrección habla de algo que no está, el orden, y el buscador de nombres con acentos, signos y nombres contenidos en otros.
- **Pantalla, las dos condiciones de salida:**
  - Se borra un párrafo en el editor y sus datos desaparecen de la ficha al momento, sin preguntar a ningún modelo. La contradicción que lo citaba se cierra.
  - Una nota, una fusión y un pasaje descartado siguen ahí después de que la cola vuelva a analizar la escena y de que los datos vuelvan con identificadores nuevos.
- **Prueba de humo:** en la app real, lo analizado se convierte en una ficha con su pasaje, y su nombre queda enlazado en el editor sin cambiar el texto. Se ejecuta en los tres sistemas.

## Sin comprobar

- **Las fichas con el análisis de un modelo real.** Las pruebas usan datos preparados. Un modelo real dará nombres, tipos y frases menos limpios, y eso afectará sobre todo a Separar y a «Enlazan aquí».
- **El aspecto de la pantalla de fichas.** Sigue los tokens de `DESIGN.md`, pero nadie la ha visto todavía.
## Medidas

Con `npm run perf-test`, en la app real, en Windows 11:

| Caso | Resultado |
|---|---|
| Teclear con enlaces, 150.000 palabras en una sola escena y 10.000 nombres enlazados | Mediana de 9 a 11 ms hasta el fotograma, percentil 95 por debajo de 30 ms |
| El mismo caso sin enlaces | Mediana de unos 4 ms |
| Calcular las fichas leyendo 450.000 palabras | 364 ms |

La primera versión rehacía todos los subrayados en cada tecla y tardaba unos 25 ms de mediana en ese caso, que es el peor posible: una novela real reparte el texto en escenas. Calcular las fichas se hace al abrir la novela, al abrir las fichas y al acabar cada pasada del análisis, nunca al teclear.
