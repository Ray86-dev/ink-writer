# Evaluación del análisis

El mayor riesgo del producto es la calidad de las fichas y de la detección de contradicciones. Estas novelas breves permiten medirla.

`npm run fixtures` comprueba que el material es coherente: toda cita existe literalmente en su escena.

## Cómo se evalúa

```
npm run eval -- --provider ollama --model gemma4:latest
npm run eval -- --provider ollama --model gemma4:latest --novel la-feria
npm run eval:login
npm run eval -- --provider openrouter --model nvidia/nemotron-3.5-super-vl:free
npm run eval -- --provider deepseek --model deepseek-flash --max-cost 0.50
```

| Opción | Qué hace |
|---|---|
| `--novel` | Qué novela evaluar. Por defecto, `la-veda` |
| `--max-cost` | Tope de gasto en dólares. Obligatorio en un modelo de pago |
| `--verbose` | Muestra entidades, hechos y avisos |
| `--digest` | Muestra lo que redacta la IA de cada escena y lo que se descarta |
| `--no-digest` | No pide ese paso: solo el análisis |
| `--trace <archivo>` | Guarda cada pregunta y cada respuesta |
| `--cache-only` | Vuelve a puntuar con lo guardado. Si falta una respuesta, falla en vez de preguntar |
| `--no-cache` | Pregunta todo de nuevo |
| `--no-record` | No registra la ejecución |
| `--no-think` | Pide al modelo que no razone antes de responder |
| `--resume` | Continúa aunque el cupo del día no alcance para una ejecución completa |

**Sin gastar.** Por OpenRouter solo acepta modelos que OpenRouter declare gratuitos, se detiene en la primera respuesta con coste y no empieza si el cupo diario no alcanza. Nunca pide búsqueda web, que se cobra incluso con modelos gratuitos.

**Con DeepSeek sí se gasta.** La API directa cobra por tokens y necesita saldo, así que el evaluador exige `--max-cost`. Cuenta cada respuesta a la tarifa más alta publicada, se detiene al llegar al tope y también si una respuesta no dice cuánto usó. Muestra además el saldo al empezar y al terminar, para contrastarlo. Lo que ya está en la caché no se paga.

**Repetir es gratis y exacto.** La caché guarda las respuestas completas y también las que el modelo cortó, porque esa es su respuesta a esa pregunta. Con `--cache-only`, una ejecución ya hecha se repite idéntica sin ninguna petición. Los fallos del servicio no se guardan.

**Lo que redacta la IA no tiene umbral.** Después de analizar cada escena se pide un resumen de cada ficha, qué cambia en la escena, preguntas y una tarea de escritura. El evaluador cuenta lo que se conserva y lo que se descarta por no tener origen en el texto, pero no puede decir si un resumen es bueno: eso hay que leerlo con `--digest`. Ver `docs/adr/0017-lo-que-redacta-la-ia.md`.

La clave se lee de `DEEPSEEK_API_KEY` o de `%LOCALAPPDATA%\ink-writer-dev\deepseek-key`. Para guardarla sin que aparezca en pantalla ni en el historial, cópiala y ejecuta en PowerShell:

```
Get-Clipboard | Set-Content "$env:LOCALAPPDATA\ink-writer-dev\deepseek-key" -NoNewline
```

Esta API solo garantiza JSON válido, no su forma: el esquema va en las instrucciones y la respuesta se valida igual que con los demás modelos.

**Registro.** Cada ejecución se guarda en `fixtures/results/`, y al terminar se compara con la anterior del mismo modelo y novela.

## Las dos novelas

- **`la-veda`** es la de trabajo: se puede mirar cada fallo y afinar el canal con ella.
- **`la-feria`** es la de control: tiene los mismos tipos de caso, escritos de otra forma. **No se afinan los prompts mirando sus resultados**, porque dejaría de decir nada sobre texto que el canal no ha visto. Si revela un fallo de programación, se puede corregir diciendo que se corrigió.

Los prompts no deben usar como ejemplo frases de ninguna de las dos.

## Qué cubre `la-veda`

| Caso | Dónde |
|---|---|
| Contradicción de un rasgo físico | `c_ojos` |
| Contradicción de fecha | `c_veda` |
| Variante de un nombre | `c_nombre` |
| Tiempo de viaje imposible | `c_viaje` |
| Parentesco incoherente | `c_edad_hermanos` |
| Una difunta que reaparece | `c_difunta` |
| Errata y raya de diálogo | `o_halla`, `o_raya` |
| Evolución, no error | `n_estado_civil` |
| Recuerdo con otra edad | `n_edad_tiempo` |
| Un personaje miente | `n_mentira` |
| Dos personas con el mismo nombre | `n_dos_luis` |
| Sujeto omitido, epíteto, pronombre | `must_resolve_reference` |

`la-feria` cubre lo mismo con otras formas. Por ejemplo, al difunto se lo llevan «al cementerio» sin que se nombre la muerte, y los dos Ramones no se presentan con la misma construcción.

## Umbrales

| Métrica | Umbral |
|---|---|
| Contradicciones de `must_flag` detectadas | Al menos 6 de 8 |
| Falsas alarmas sobre `must_not_flag` | Como máximo 1 de 4 |
| Citas inventadas (no literales) | 0 |
| Los dos Luis fusionados | No |
| Referencias de `must_resolve_reference` correctas | Al menos 2 de 3 |

Registrar cada ejecución con modelo, vía y fecha. Si un cambio empeora una métrica, no se integra sin justificarlo.

Los umbrales no puntúan los avisos que no están ni entre los esperados ni entre los prohibidos, aunque molesten al autor. La evaluación los cuenta como «otros avisos»: hay que mirarlos también.

Conviene ampliar el material con un fixture largo, en inglés y con pasado histórico.
