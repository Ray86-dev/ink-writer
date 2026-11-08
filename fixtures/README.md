# Evaluación del análisis

El mayor riesgo del producto es la calidad de las fichas y de la detección de contradicciones. Esta novela breve permite medirla.

`node fixtures/validate.mjs` comprueba que el material es coherente: toda cita existe literalmente en su escena.

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

## Umbrales iniciales

Son una propuesta que debe calibrarse en M3 con resultados reales.

| Métrica | Umbral |
|---|---|
| Contradicciones de `must_flag` detectadas | Al menos 6 de 8 |
| Falsas alarmas sobre `must_not_flag` | Como máximo 1 de 4 |
| Citas inventadas (no literales) | 0 |
| Los dos Luis fusionados | No |
| Referencias de `must_resolve_reference` correctas | Al menos 2 de 3 |

Registrar cada ejecución con modelo, vía y fecha. Si un cambio empeora una métrica, no se integra sin justificarlo.

Conviene ampliar el material con un segundo fixture largo, en inglés y con pasado histórico.
