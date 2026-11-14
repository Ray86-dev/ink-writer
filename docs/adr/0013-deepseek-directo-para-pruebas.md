# 0013 · DeepSeek directo, solo para la evaluación

**Estado:** aceptada. Amplía el arnés de la 0011. No cambia las vías de la app, que siguen siendo las de la 0012.

**Contexto.** Los modelos medidos en M3 eran locales o gratuitos, y el cupo gratuito de OpenRouter da para una sola novela al día. Hacía falta un modelo de pago, rápido y barato, para saber hasta dónde llega el canal de análisis con un modelo mejor y para evaluar sin esperar al cupo. El autor pidió la API propia de DeepSeek, no a través de OpenRouter.

## Decisión

**Un adaptador de DeepSeek en el core,** detrás de la misma interfaz de proveedor y con las mismas pruebas de contrato. Lo usa solo `npm run eval`: la app no lo ofrece.

**Gastar exige un tope explícito.** El arnés seguía la regla de no gastar nunca. Ahora:

- Un modelo de pago no arranca sin `--max-cost`.
- Solo se admite un modelo con precio conocido en el código.
- Cada respuesta se cuenta a la tarifa más alta publicada, la de hora punta y sin descuento de caché, así que la cuenta solo puede quedar por encima de la factura.
- Se detiene al llegar al tope, y también si una respuesta no dice cuántos tokens usó.
- Muestra el saldo al empezar y al terminar, para contrastar la cuenta con lo cobrado.
- Lo que está en la caché en disco no se vuelve a pedir.

**La clave queda fuera del repositorio,** en `DEEPSEEK_API_KEY` o en un archivo del perfil del usuario. Ver `fixtures/README.md`.

**El esquema va en las instrucciones.** Esta API garantiza JSON válido, pero no su forma. La respuesta se valida igual que la de los demás modelos.

## Resultado

Con `deepseek-flash`, el 14 de noviembre de 2026, con los prompts definitivos de la 0011 y sin tocarlos:

| Novela | Contradicciones | Referencias | Peticiones | Tiempo | Gasto contado | Bajada del saldo |
|---|---|---|---|---|---|---|
| `la-feria` (control) | 8 de 8 | 3 de 3 | 49 | 357 s | 0,094 $ | 0,03 $ |
| `la-veda` | 8 de 8 | 2 de 3 | 52 | 470 s | 0,122 $ | 0,05 $ |

En las dos: 0 falsas alarmas, 0 citas inventadas y las dos personas con un mismo nombre separadas.

- **Es el primer modelo que detecta todo.** Recupera `o_halla`, `c_edad` y `c_difunto`, las ausencias que se repetían en los demás. Esos límites de la 0011 son de los modelos pequeños, no del diseño del canal.
- **Los epítetos siguen sin resolverse del todo:** en `la-veda` falta «la doctora».
- **La cuenta es prudente.** El saldo bajó 0,08 $ frente a 0,22 $ contados. Las ejecuciones fueron en fin de semana, con tarifa reducida, y el saldo se muestra con dos decimales. El razonamiento no encareció la factura por encima de la cuenta.
- **Es unas tres veces más rápido** que `nemotron` por la vía gratuita: 357 s frente a 987 s en `la-feria`.

Es una ejecución por novela, y la 0011 ya recoge que hay variación entre ejecuciones.

## Consecuencias

- Una novela de prueba cuesta menos de 0,10 $ reales. Sirve para comparar tras cambiar un prompt sin depender del cupo diario.
- Los precios están escritos en el código con su fecha. Si DeepSeek los cambia, hay que actualizarlos antes de volver a gastar.
- Ofrecer DeepSeek al autor sería trabajo de M6, con las claves de API y los topes de uso. Esta decisión no lo adelanta.
