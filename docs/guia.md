# Guía de uso

Ink Writer es una app para escribir novelas. **Tú escribes todo.** La IA lee lo que escribes, lo ordena en fichas, avisa de lo que no encaja, te propone pequeños pasos y busca documentación. Nunca redacta por ti.

Funciona sin conexión. La IA es opcional: sin ella puedes escribir, guardar, ver el historial y exportar.

## Empezar una novela

Al abrir la app ves tus novelas. Para crear una, escribe su título, el idioma en que la vas a escribir y la **época** de la historia, por ejemplo «actualidad» o «años cincuenta». La época sirve para documentar bien: de una novela ambientada en el pasado no se buscan las calles de hoy.

Una novela nueva se abre en su página en blanco. Una que ya tiene texto se abre en el **Inicio**.

## Escribir

El editor es solo el texto. Mientras tecleas, los controles desaparecen. Vuelven al mover el ratón o al pulsar `Esc`.

Hay tres modos:

| Modo | Qué muestra |
|---|---|
| Escribir | Solo el texto |
| Escribir con enlaces | Los nombres que la app ya conoce, subrayados. `Ctrl` o `Cmd` y clic abre su ficha |
| Ver enlaces y pistas | Enlaces, marcas y el panel de pistas. No se puede escribir |

La novela se organiza en capítulos y escenas, en **Capítulos y escenas**. Lo que mandas a la papelera se puede recuperar.

### Guardado

Se guarda solo, a cada cambio. No hay botón de guardar. Si alguna vez no se puede guardar, la app lo dice arriba y no te deja cerrar sin avisarte.

### Historial

Cada escena tiene su **Historial**. Puedes guardar una versión con nombre, comparar una versión con el texto de ahora y recuperarla. Recuperar no borra nada: lo que había queda en el historial.

## Conectar la IA

En **IA** eliges cómo se conecta. Hay tres formas:

| Forma | Qué es | Coste |
|---|---|---|
| Ollama | Un modelo en tu propio equipo. Tu texto no sale de él | Gratis |
| OpenRouter | Modelos en la nube, con tu cuenta | Hay modelos gratuitos y de pago |
| DeepSeek | Modelos en la nube, con tu clave | De pago |

Con un modelo en la nube, el texto de tus escenas se envía a ese servicio para analizarlo. Con Ollama no sale de tu equipo.

Los modelos de pago tienen un **tope diario** de peticiones que pones tú. La app no cambia de un modelo gratuito a uno de pago sin que lo elijas.

## Fichas

Cuando dejas una escena, la IA la lee y anota personajes, lugares y lore. Cada dato lleva el pasaje del que sale, y pulsarlo te lleva a él.

En una ficha puedes:

- Escribir **Mi nota**.
- Corregir el nombre o el tipo.
- **Fusionar** dos fichas que son la misma, o **separar** una que mezcla dos.
- Descartar un dato o la ficha entera.

Lo que corriges tú se conserva aunque el texto se vuelva a analizar.

La pestaña **Nombres** lista todos los nombres propios, para encontrar variantes como «Tomás» y «Thomas».

## Pistas

La app avisa de lo que no encaja: unos ojos que cambian de color, una fecha que no cuadra, una errata. Hay cuatro niveles, y los cambias cuando quieras:

| Nivel | Qué hace |
|---|---|
| Apagadas | Nada: ni tareas, ni marcas, ni búsquedas automáticas. Las fichas se siguen actualizando |
| Si las pido | Solo cuando las pides, de una en una |
| Discretas | Subrayados y un contador |
| Compañera | Una gota de tinta junto al texto te propone la pista |

Las pistas son **graduales**: primero una vaga, luego una que orienta y al final el dato exacto. Pides la siguiente solo si la necesitas.

Las marcas nunca aparecen en los dos modos de escritura.

La única vez que la app cambia tu texto es al corregir una errata, y solo si pulsas **Aplicar**.

## Inicio

Es la pantalla de cada novela:

- **Red de tinta:** tu novela como una red de capítulos, personajes, lugares y lore. Tocar un nodo abre su ficha.
- **Siguiente paso:** una sola tarea pequeña, con el motivo por el que se propone. Siempre puedes decir «Esta no me sirve» u «Hoy solo quiero escribir».
- **Tarjetas:** un resumen de cada parte de la novela, con enlaces.

Si tu equipo no puede dibujar la red, verás solo las tarjetas, que tienen lo mismo.

## Documentación

En **Fichas → Documentación** la app busca información sobre los lugares reales, la época y los temas que añadas, como un oficio o un objeto.

- De cada lugar te pregunta antes si existe, si está basado en uno real o si es inventado. De uno inventado no busca nada.
- Cada resultado lleva su fuente, y pulsarla la abre en tu navegador.
- **A mis notas** guarda un resultado. **Descartar** lo oculta.
- Hay un tope de búsquedas al día, que puedes cambiar.

Las búsquedas van a OpenStreetMap, Open-Meteo y Wikipedia. **Solo se envía el tema.** Nunca tu texto ni el nombre de un personaje.

## Exportar

**Exportar** saca la novela a Word o a Markdown. El archivo lleva solo tu texto: ninguna marca de la app ni de IA.

## Idioma de la aplicación

La app se muestra en español o en inglés, según tu sistema. Puedes cambiarlo en **Ajustes**, en la pantalla de tus novelas. El idioma de cada novela se elige al crearla y es independiente.

## Actualizaciones

En **Ajustes**, en la pantalla de tus novelas, ves la versión que tienes y el botón **Buscar actualizaciones**. Si hay una versión nueva, la app te enseña sus notas y la instala cuando pulsas **Instalar y reiniciar**.

La app no busca actualizaciones por su cuenta, salvo que marques **Buscar al abrir la app**. Buscar consulta GitHub y no envía nada sobre ti ni sobre tus novelas.

### Avisos al instalar

Los instaladores todavía no llevan la firma de Windows ni la de Apple. Al instalar verás un aviso de seguridad:

- **Windows:** «Windows protegió su PC». Pulsa «Más información» y luego «Ejecutar de todas formas».
- **macOS:** la app «no se puede abrir». Ábrela desde Ajustes del Sistema, en Privacidad y seguridad, con «Abrir igualmente».

Puedes comprobar que la descarga es la buena con el archivo `SHA256SUMS.txt` de cada versión.

## Privacidad

- Sin telemetría: la app no envía datos de uso a nadie.
- La app solo se conecta cuando tú lo pides: al usar un modelo en la nube, al buscar documentación y al buscar actualizaciones.
- Tus novelas están en una base de datos en tu equipo.
- Las claves se guardan en el almacén de credenciales del sistema.

## Teclado

Todo se puede hacer con el teclado. `Tab` recorre los controles, `Esc` cierra un panel o un menú y, en el editor, muestra u oculta los controles.
