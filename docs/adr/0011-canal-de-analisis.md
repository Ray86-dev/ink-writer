# 0011 · Canal de análisis y evaluación

**Estado:** aceptada.

**Contexto.** M3 construye el análisis en el core: extraer, resolver identidades, comparar, revisar la ortotipografía, una cola sin conexión y un arnés que lo mida. Es el mayor riesgo del producto: un aviso falso hace perder la confianza del autor y una contradicción perdida quita valor a la herramienta. Se hizo sin gastar, con Ollama y con modelos gratuitos de OpenRouter.

## Qué se probó antes de decidir

Cada fila es una ejecución real sobre `la-veda` con un modelo pequeño, `gemma4:e2b`. Las cifras son de la métrica de entonces.

| Diseño | Detectadas | Falsas alarmas | Qué falló |
|---|---|---|---|
| Primer prompt, sin razonamiento | 2 de 8 | — | Se pierde en la lista |
| Primer prompt, con razonamiento | 5 de 8 | 0 | Fusiona a los dos Luis y resuelve mal las referencias |
| Lista larga de reglas por escena | 4 de 8 | 2 | Más reglas, más falsas alarmas |
| Grupos pequeños por categoría, con su regla | 5 de 8 | 0 | Depende de que el modelo elija bien la categoría |

Leer cada pregunta y cada respuesta (`--trace`) cambió el diagnóstico. Casi nada de lo que faltaba era incapacidad del modelo:

- Un hecho correcto se descartaba en silencio si el modelo no listaba su entidad.
- Una respuesta con `"F1, F2"` se tiraba porque el código esperaba una sola etiqueta.
- El modelo parte una frase en varios hechos, y cada grupo veía solo un trozo.
- Entierros y fechas se archivan como `action`, y nunca se comparaban con lo que debían.

## Decisiones

### Lo que se puede comprobar leyendo el texto no se le pregunta a un modelo

Da la misma respuesta siempre, con cualquier modelo y sin coste. Los modelos probados fallan justo aquí, por muy claras que sean las instrucciones.

| Comprobación | Cómo |
|---|---|
| Citas (regla 3) | Coincidencia literal. Lo que no aparece se descarta y se cuenta |
| Variantes de un nombre | Palabras con mayúscula del texto contra los nombres conocidos, aunque el modelo las haya unificado |
| Personas distintas con un nombre | «Luis, el cartero» y «Luis Ferrer, el alcalde»: un nombre dentro del otro, cada uno con su descripción. Se separan, y sus hechos también |
| Raya de diálogo | Una regla sobre cada línea |
| Hecho sin entidad listada | Si la escena nombra esa entidad, se crea |
| Hecho archivado bajo un nombre inventado | Si su cita nombra a una sola entidad conocida, es de ella |
| Frases sin datos | Se calculan, y solo esas se preguntan en una segunda lectura |

Separar dos personas que en realidad son una se arregla con un clic en M4. Fusionar dos personas en silencio no se ve.

### Comparar en grupos que no dependen de la categoría

Los hechos se comparan en grupos pequeños, sin releer la novela, y un grupo solo se pregunta si tiene algo nuevo:

1. **Por categoría y persona:** físico, edad, estado civil, familia, trabajo, vida o muerte.
2. **Por categoría entre personas:** fechas, duración de viajes y quién es mayor, que se pueden contar desde cualquiera de los dos lados.
3. **Por palabra compartida en las citas,** sea cual sea la categoría y la persona que eligió el modelo. No cuentan los nombres de personas, las palabras comunes ni las de tiempo. Como mucho, 5 grupos por escena.
4. **Difuntos:** la muerte se reconoce por categoría o por un léxico breve, y se le suma lo que esa persona hace después, aunque esté archivado bajo otra.

El modelo ve la frase completa de cada hecho y no solo la cita, por lo que cada hecho guarda su frase. Un hallazgo necesita al menos un hecho nuevo, y dos hechos de la misma frase no se contradicen entre sí.

### Una corrección debe parecer una errata

Se aplican con un clic (regla 1), así que se comprueba lo que cambia. **En español se compara cómo suena:** la h no suena, b y v son iguales, ll e y también. Por letras, `halla` está igual de cerca de `haya`, que es lo correcto, que de `había`, que cambia el sentido. Por sonido, no. Así se rechazan `Deshizo → Abrió` y `halla → había`, y pasa `Haber si → A ver si`. Se descartan también las que añaden o quitan palabras. En otros idiomas se compara por letras.

Hacerlo con un prompt no funcionó: pedir que el arreglo no cambie de tiempo verbal no mejoró nada y añadió una sugerencia nueva de reescritura.

### Razonamiento activo por defecto

Cuesta tiempo y tokens, pero fue lo que más mejoró al modelo pequeño. `--no-think` permite comparar.

### Los fallos se clasifican por qué hacer con ellos

| Fallo | Ejemplos | Qué hace la cola |
|---|---|---|
| `later` | Sin conexión, límite de peticiones, error del servidor | Se detiene y reintenta sola, esperando cada vez más, hasta una hora |
| `refused` | Clave inválida, sin crédito | Se detiene y no reintenta: solo el autor puede arreglarlo. Nunca cambia de proveedor (regla 10) |
| `bad_answer` | Respuesta inservible tras el reintento | Salta esa escena y sigue. No la repite hasta que cambie el texto |

Si un servidor pide esperar más de un minuto, como con un límite diario, no se espera: la escena sigue en cola.

### La cola vive en la base

Una escena está en cola mientras `content_hash` difiera de `analyzed_hash`. Por eso ni el cierre forzado, ni estar sin conexión, ni un límite pueden perder trabajo: solo retrasarlo.

- `analyzed_hash` describe el texto que se leyó, no el actual. Si el autor escribe mientras el modelo piensa, la escena sigue en cola.
- El resultado de una escena se guarda en una sola transacción. Si falla, siguen los datos anteriores.
- Al abrir un proyecto se recalculan todos los hashes, porque un cierre forzado puede dejar texto guardado con un hash antiguo. El guardado de la prosa no se ha tocado.
- Teclear solo reinicia un temporizador. Se analiza tras una pausa o al cerrar la escena (SPEC §5).
- Una escena vacía no llama a ningún modelo: se borra lo que decía y ya está.
- La papelera oculta los datos de una escena y los avisos que la citan. Al restaurarla vuelven sin reanalizar.

### Las entidades no se borran al reanalizar

Una entidad sin escenas que la respalden deja de ofrecerse al modelo, pero se queda. Si su nombre vuelve, recupera su identificador, y es lo que permitirá que `user_overrides` sobreviva en M4 (regla 4). El análisis solo puede añadir alias: nunca renombra una entidad ya guardada.

### Alcance

M3 es el core y el arnés. **La app todavía no analiza nada:** el transporte en Rust y los ajustes de conexión son de M6, las fichas y `user_overrides` de M4, y las pistas de M5. Los datos guardan la cita y no el `anchor` de Yjs de SPEC §4: lo añadirá la migración de M4, cuando haya que situarlos en el editor.

## El arnés

`npm run eval`. Ver `fixtures/README.md`.

- **Sin gastar, por construcción.** Por OpenRouter solo acepta modelos que OpenRouter declare gratuitos, se detiene en la primera respuesta con coste y no empieza si el cupo no alcanza.
- **Caché en disco.** El cupo gratuito es de 50 peticiones al día, así que una pregunta sin cambios no se repite. Con `--cache-only` es imposible gastar cupo al volver a puntuar. Se añadió tras gastar peticiones por error al repuntuar.
- **Fuera del CI,** porque depende de la red y de modelos reales.

## Evaluar sin engañarse

Tras afinar con `la-veda`, varios ejemplos de los prompts casi copiaban sus frases. Al sustituirlos por otros, `gemma4:e2b` bajó de 7 a 3 de 8 con la misma novela, antes de corregir los fallos de programación que esa bajada ayudó a encontrar. Por eso:

- **Los prompts no usan frases de las novelas de prueba.**
- **`la-feria` es una novela de control:** mismos tipos de caso, escritos de otra forma, y no se afina mirándola.
- **La métrica se endureció** al ver que premiaba de más. «La doctora» contaba como resuelta aunque se la asignaran a otra persona, y una corrección contaba como detectada con un arreglo equivocado. También se corrigió en sentido contrario: una cita que acababa en punto contaba como fallo estando bien.

Después de ver `la-feria` se corrigieron dos cosas, ambas de código y no de prompts: los hallazgos sin ningún hecho nuevo, que se vieron en ella, y el filtro de erratas, que se vio en las dos y se comprobó con su `Haber si`. Un retoque del prompt de ortografía se revirtió porque no aportaba nada en `la-veda`. No se tocó el léxico de la muerte, aunque habría recuperado un caso, y por eso esa novela sigue diciendo algo.

## Resultado

Con los prompts definitivos. Las ejecuciones están en `fixtures/results/`.

| Modelo | Vía | `la-veda` | `la-feria` (control) |
|---|---|---|---|
| `gemma4:latest` | Ollama | **Supera:** 6 de 8 | **Supera:** 6 de 8 |
| `nvidia/nemotron-3.5-super-vl:free` | OpenRouter | **Supera:** 7 de 8 | Pendiente, por el cupo diario |
| `gemma4:e2b` | Ollama | **Supera:** 6 de 8 | **No supera:** 3 de 8 y 1 de 3 referencias |

Salvo donde se indica, todas dan 2 de 3 referencias. En todas: 0 falsas alarmas, 0 citas inventadas y las dos personas con un mismo nombre separadas.

**Se cumple el criterio de salida de M3:** tres modelos alcanzan los umbrales en `la-veda`.

Tres matices:

- **Hay variación entre ejecuciones,** aun con temperatura 0. `gemma4:latest` dio 7 de 8 y 6 de 8 con la misma novela, sin ningún cambio. Ese 6 está justo en el umbral.
- **Un modelo muy pequeño no basta:** `gemma4:e2b` pasa con la novela de trabajo y falla con la de control. La vía local necesita al menos un modelo del tamaño de `gemma4:latest`, de 6,6 GB.
- **Las ausencias se repiten entre modelos:** `o_halla` en `la-veda`, y `c_edad` y `c_difunto` en `la-feria`. No son errores al azar, sino los límites que se describen a continuación.

## Lo que sigue sin resolver

Se documenta para no darlo por bueno por haber pasado los umbrales:

- **Epítetos.** Ningún modelo resuelve de forma fiable «la doctora» o «la maestra». Es el paso 2 de SPEC §5, y el umbral se cumple solo porque admite un fallo de tres.
- **`halla leído`.** Todos los modelos ven el error y proponen `había leído`, que es incorrecto. El filtro impide que llegue al autor, así que la errata se pierde. Es preferible a un arreglo malo a un clic, pero sigue sin detectarse.
- **Avisos espurios y razones absurdas.** Los umbrales no los puntúan. `gemma4:latest` llegó a justificar un conflicto real de edades con que «Marta no puede ser un hermano». M5 debería tratar la razón como una ayuda y no como una afirmación.
- **Casos sin palabra en común.** «Su hermana pequeña» y «le llevaba diez años» dependen de que el modelo elija la categoría. El léxico de la muerte tampoco cubre un entierro contado sin nombrarla.
- **Novelas largas sin medir.** Estas tienen 8 escenas. No se sabe cómo se comportan los grupos por palabra con miles de hechos: el recorte a 12 por grupo podría dejar fuera justo el hecho que importa. Hace falta el fixture largo que pide `fixtures/README.md`, también para medir el inglés.
- **Coste.** Son unas 5,5 peticiones por escena. Con el cupo gratuito de OpenRouter dan para unas 9 escenas al día. Ollama no tiene ese límite.
