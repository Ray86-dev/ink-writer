# 0017 · Lo que redacta la IA: resúmenes, cambios, preguntas y tareas

**Estado:** aceptada. Segunda parte de M5 y cierre del hito. Añade el paso 4 de `SPEC.md` §5 al canal de la 0011, sin cambiar ninguno de sus prompts.

**Contexto.** La 0016 dejó fuera lo que solo un modelo puede escribir: el resumen de cada ficha, el «qué cambia» de cada capítulo, las pistas de Preguntas y Sugerencias y la tarea de tipo Escribir. Todo ello es texto generado, así que tiene dos riesgos que el resto del análisis no tiene: que invente, y que acabe pareciéndose a escribir la novela.

## Decisión

**Un paso aparte, de una sola petición por escena.** Después de analizar una escena, el modelo recibe su texto y los hechos de las fichas que toca, y devuelve cuatro cosas:

| Qué | Para qué |
|---|---|
| Un cambio | Qué es distinto al final de la escena. Se muestra en la ficha del capítulo |
| Un resumen por ficha | Dos frases como mucho, solo con sus hechos |
| Hasta dos preguntas | Algo que la escena menciona y deja sin definir. Son pistas de tipo Preguntas |
| Hasta una tarea | Desarrollar algo que ya está en la escena. Es una pista de tipo Sugerencias y la tarea Escribir de Siguiente paso |

Está en `packages/core/src/analysis/digest.ts`. Los prompts de extracción, identidades, comparación y ortografía no se han tocado.

**Si este paso falla, el análisis sigue en pie.** La escena ya está analizada y guardada cuando se pide. Una respuesta inservible deja la ficha sin resumen hasta que la escena cambie, y nada más.

**Nunca escribe en el manuscrito ni propone la trama (regla 1).** El prompt pide decir qué desarrollar, nunca cómo debe acabar, y no redactar texto. Lo que devuelve solo se muestra en fichas y en el panel de pistas. «Escribir ahora» lleva al pasaje en modo Escribir y no inserta nada.

**Nada sin origen (regla 3).** Lo que el texto no respalda se descarta antes de guardarlo:

- Una pregunta o una tarea necesita una cita que esté literalmente en la escena.
- Una pregunta tiene que acabar en interrogación, para que no sea una sugerencia de trama disfrazada.
- Un resumen, un cambio o una pregunta no pueden traer un nombre propio que no esté en el texto del que hablan ni entre los nombres que la novela ya conoce. Es una comprobación sencilla: detecta personajes y lugares inventados, no una afirmación falsa sobre uno que existe.

**Lo escrito caduca con el texto.** Cada cosa guarda de qué salió, y solo se muestra mientras eso no cambie:

| Qué | Se muestra mientras… |
|---|---|
| Resumen | La ficha enseña exactamente los pasajes con los que se escribió |
| Cambio | El texto de la escena es el mismo |
| Pregunta o tarea | Su cita sigue en la escena |

Así, borrar un pasaje quita el resumen al momento, sin esperar a la IA. También lo quita fusionar dos fichas o descartar un pasaje: el resumen ya no describe lo que la ficha enseña. Vuelve cuando el análisis toca otra vez esa ficha.

**Una pregunta se reconoce por su pasaje, no por su redacción.** El modelo puede formularla distinto la próxima vez. «No me sirve» sigue valiendo mientras la cita sea la misma.

**Una pregunta se enseña entera.** No tiene los tres pasos de una pista de coherencia: no es un acertijo.

**Con las pistas apagadas no se ve ninguna pregunta ni tarea.** El paso se ejecuta igual, porque los resúmenes son parte de las fichas, que según `SPEC.md` §3.4 se siguen actualizando.

## Evaluación

Con `deepseek-flash` por la API directa, el 15 de noviembre de 2026. Las ejecuciones están en `fixtures/results/`.

| Novela | Contradicciones | Referencias | Cambios | Resúmenes | Preguntas | Tareas | Descartado |
|---|---|---|---|---|---|---|---|
| `la-veda` | 8 de 8, como antes | 2 de 3, como antes | 8 de 8 escenas | 29 | 16 | 8 | Nada |
| `la-feria` (control) | 8 de 8, como antes | 3 de 3, como antes | 8 de 8 escenas | 28 | 15 | 8 | 1 pregunta |

- **Lo que ya se medía no cambia:** los umbrales de la 0011 se cumplen igual que antes en las dos novelas.
- **Lo nuevo no tiene umbral.** Las novelas de prueba no dicen qué resumen o qué pregunta es correcto, así que el evaluador solo cuenta lo que se conserva y lo que se descarta. La calidad la he juzgado leyendo las respuestas, y eso no es una medida.
- **Lo leído es bueno.** Los resúmenes se ciñen a los hechos y cuentan las contradicciones sin elegir («ojos verdes y también marrones»). Varias preguntas son justo las incoherencias plantadas en la novela («¿La veda empieza el martes o el jueves?»).
- **El modelo propone siempre una tarea,** aunque el prompt dice que no proponer ninguna es normal. Con ocho de ocho escenas, algunas son flojas. El interruptor de Sugerencias las quita todas.

**El prompt se afinó solo con `la-veda`.** Hubo un cambio: la primera versión pedía resumir «los hechos» y el modelo los listaba todos, hasta 790 caracteres. Ahora pide dos frases y menos de 300 caracteres. `la-feria` se ejecutó una vez, al final, y no se tocó nada después.

**Dos fallos del filtro, corregidos sin gastar:** rechazaba un identificador seguido del nombre («E1 Marta Rey»), y rechazaba nombres que la novela ya conoce.

### Gasto

El autor autorizó hasta 0,50 $ en total. El evaluador cuenta cada respuesta a la tarifa más alta, así que su cuenta queda por encima de lo cobrado.

| Ejecución | Contado |
|---|---|
| `la-veda`, primera versión del prompt | 0,062 $ |
| `la-veda`, repetición que no aportó nada | 0,061 $ |
| `la-veda`, prompt definitivo | 0,046 $ |
| `la-feria`, una sola vez | 0,096 $ |
| **Total** | **0,265 $** |

**La segunda ejecución fue un error mío.** La caché solo guardaba respuestas completas. Tres peticiones antiguas que el modelo había cortado no estaban guardadas, se volvieron a pedir, respondieron distinto y cambiaron todo lo que venía detrás, de modo que casi nada salió de la caché. Ahora la caché guarda también las respuestas cortadas por el modelo, que son su respuesta a esa pregunta, y una repetición es exacta y no cuesta nada. Los fallos del servicio siguen sin guardarse.

## Coste en uso real

Una petición más por escena: de unas 5,5 a unas 6,5. Con el cupo gratuito de OpenRouter, de unas 9 escenas al día a unas 7.

## Lo que no se ha hecho

- **No está medido con los modelos locales ni con el gratuito de OpenRouter.** Solo con `deepseek-flash`, que es el mejor de los probados. Un modelo pequeño dará resúmenes peores y más descartes, y eso está por ver.
- **Los resúmenes no se comprueban contra los hechos,** solo contra nombres inventados. Un resumen que diga algo falso de un personaje que existe pasa el filtro. El prompt y la temperatura 0 lo hacen poco probable, y la ficha enseña debajo los pasajes para contrastarlo.
- **Una ficha se resume cuando una escena la toca.** Si queda sin resumen por una fusión, no vuelve hasta entonces.
- **Las preguntas no se deduplican entre escenas.**

## Pruebas

- **Core:** qué se conserva y qué se descarta de cada parte, la respuesta vacía, la respuesta mal formada, y cuándo caduca cada cosa.
- **Cola:** el resumen, el cambio y la pregunta llegan a las fichas, y un paso fallido deja el análisis en pie.
- **Pantalla:** una pregunta entera con «Escribir ahora» que no escribe nada, «No me sirve», la tarea Escribir en Siguiente paso, nada de ello con las pistas apagadas, y el resumen que desaparece al borrar un pasaje.
