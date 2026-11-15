# 0019 · Documentación con fuentes abiertas y sin búsqueda del modelo

**Estado:** aceptada. Cambia la 0006: lo que no es un lugar se busca en Wikipedia, no con la búsqueda web del modelo.

**Contexto.** M7 pedía temas, época, fuentes, caché, tope diario y distinguir lugares reales de inventados, con dos condiciones de salida: ninguna sugerencia sin fuente, y que no salga ni texto ni nombres de personajes. La 0006 preveía la búsqueda web del modelo para oficios, historia y ambiente. Esa búsqueda es de pago por OpenRouter, incluso con modelos gratuitos, y no se puede probar: no hay saldo. DeepSeek no la ofrece y un modelo local tampoco.

## Decisión

**Cuatro servicios públicos, gratuitos y sin clave.** Ninguno pasa por un modelo.

| Qué se busca | Servicio | Qué se envía |
|---|---|---|
| Dónde está un lugar real | Nominatim, de OpenStreetMap | El nombre que escribe el autor |
| Calles y locales cercanos | Overpass, de OpenStreetMap | Un punto del mapa |
| Clima | Open-Meteo, archivo histórico | Un punto del mapa y cinco años |
| Todo lo demás: lugares, oficios, objetos, época | Wikipedia, en el idioma del proyecto | El tema |

**La búsqueda web del modelo queda fuera.** `plugins`, `tools` y `web_search_options` siguen rechazados en Rust. Si algún día se añade, necesitará su propio tope de gasto y un ADR.

### Qué se busca y cuándo

- **Un lugar no se busca hasta que el autor dice si existe.** Tres respuestas: existe, está basado en uno real o es inventado. Si es inventado no se busca nada, nunca. Si es real, el autor escribe su nombre y elige cuál es entre los que conoce el mapa.
- **La época,** si no es el presente, se busca como un tema más.
- **Los demás temas los añade el autor:** un oficio, un objeto, una costumbre. El análisis no produce temas de este tipo, así que la app no los propone.
- **Una vez por tema.** Lo encontrado se guarda en la base y se lee sin conexión. Solo se repite si el autor pulsa «Buscar de nuevo».
- **Nunca mientras se escribe.** Se busca al abrir las fichas, y lo encontrado solo se ve allí: en la pestaña Documentación y en la ficha de cada lugar.
- **Con las pistas apagadas, o sin el tipo Documentación,** la app no busca nada por su cuenta. Solo busca cuando el autor pulsa «Buscar ahora».

### Época

OpenStreetMap solo conoce el presente. La época del proyecto es texto libre, así que la app solo la da por presente si lo dice con claridad: palabras como «actualidad» u «hoy», o un año de los últimos cinco. Todo lo demás, incluida una época que no sabe leer, se trata como pasado, y entonces no se consultan calles ni locales. Equivocarse hacia el pasado deja al autor sin unas calles; equivocarse hacia el presente le daría cafeterías que no existían.

El clima sí se da en cualquier época, y dice de qué años es la media.

### Privacidad (regla 5)

Lo que sale de la app se limita en tres sitios:

| Dónde | Qué impide |
|---|---|
| El core, al guardar un tema y otra vez al buscarlo | Un término que contenga el nombre o un alias de un personaje, como palabras completas y sin distinguir acentos ni mayúsculas. También uno de más de 80 caracteres u 8 palabras |
| La página no envía direcciones | Solo dice el tipo de búsqueda y da un término o un punto. No hay forma de pedir una dirección cualquiera |
| Rust construye la dirección | Rechaza un término largo o con saltos de línea, un idioma que no sea un código, y cualquier servicio que no sea uno de los cuatro. No sigue redirecciones ni envía credenciales |

El segundo control en el core, al buscar, cubre un caso concreto: un tema guardado cuyo nombre recibe después un personaje.

**Consecuencia asumida:** un lugar real que comparte nombre con un personaje no se puede buscar. Con un personaje llamado Santiago, «Santiago de Compostela» se rechaza. Se prefiere eso a que salga un nombre.

### Sin fuente no se muestra (regla 3)

- Lo que un servicio devuelve sin enlace se descarta al leerlo.
- La base no admite un resultado sin enlace `http` o `https` ni sin título de fuente.
- Al mostrar, se vuelve a comprobar que el enlace se puede seguir.
- Cada resultado muestra su fuente, y pulsarla la abre en el navegador del autor. El shell solo abre direcciones web.

### Tope diario

- Lo vigila Rust, antes de que salga cada búsqueda, igual que el de peticiones de pago de la 0018. La página no puede saltárselo.
- **60 búsquedas al día por defecto,** regulable en la pestaña Documentación. Con cero no se busca nada. Un lugar real gasta cuatro: situarlo, artículos, clima y alrededores.
- Si el archivo del tope no se puede leer, no se busca nada. El valor por defecto es solo para cuando no hay archivo.
- Tras un «demasiadas peticiones» (429 o 406) de un servicio, Rust no vuelve a llamarlo en 30 segundos.
- Al llegar al tope, lo pendiente se queda en cola y la pantalla lo dice.

### Notas del autor

Lo encontrado es una sugerencia. Con «A mis notas» queda marcado como nota del autor y se conserva aunque cambie la respuesta sobre el lugar o se repita la búsqueda. «Descartar» lo oculta y no se vuelve a ofrecer. Nada de esto entra en el análisis ni en el manuscrito.

## Lo que no se ha hecho

- **La tarjeta Documentación del Dashboard.** No hay Dashboard hasta M8. Mientras, vive en las fichas.
- **Temas propuestos por la app** para oficios y objetos. Haría falta que el análisis los extrajera, y eso es tocar prompts y volver a evaluar.
- **Época por capítulo.** `era_override` existe en la base, pero no hay dónde escribirlo: se usa la época del proyecto.
- **«Datos reales» de la verificación** (`SPEC.md` §3.6): contrastar lo que dice la novela con las fuentes. Aquí solo se documenta; no se compara.
- **Las notas tomadas no aparecen en la nota de la ficha.** Se ven en la documentación del lugar o del tema.
- **Elegir otra instancia de Overpass** o de Nominatim.

## Licencias de los datos

OpenStreetMap es ODbL, Open-Meteo CC BY 4.0 y Wikipedia CC BY-SA 4.0. La pantalla lo dice y cada resultado enlaza a su origen. Open-Meteo es gratuito solo sin fines comerciales: si la app llega a cobrar por algo, hay que revisarlo. No se añade ninguna dependencia.

## Pruebas

- **Rust:** cada búsqueda va a su servicio y lleva solo el término o el punto; un pasaje no es un término; el idioma no puede nombrar otro sitio; no se envía credencial ni se sigue una redirección; la pausa tras un 429; y el tope de búsquedas con su valor por defecto.
- **Core:** el filtro de términos; la lectura de cada servicio, que descarta lo que no tiene fuente; la época; y el recorrido entero con un transporte que anota todo lo que sale, donde se comprueba que no aparece ningún nombre de personaje ni ninguna palabra del texto.
- **Pantalla:** se pregunta por el lugar antes de buscar, un lugar inventado no se busca, con las pistas apagadas solo se busca al pulsar, nada se busca mientras se escribe, el tope y cada fuente con su enlace.
- **Prueba de humo:** en la app real, una búsqueda con eñe y tilde llega intacta, un pasaje se rechaza sin gastar del tope y la búsqueda que pasa del tope no sale.

## Comprobado con los servicios reales

El 15 de noviembre de 2026 se hizo una consulta a cada servicio, con «Lavapiés, Madrid» y «relojero», y la app lee bien lo que devolvieron. Fue a mano, con `curl`.

## Sin comprobar

- **La app contra los servicios reales.** Las pruebas usan sustitutos. Lo que construye Rust coincide con las consultas hechas a mano, pero la app no ha hecho ninguna.
- **El `User-Agent`.** La app se identifica como `ink-writer/` y su versión. Nominatim y Wikipedia piden además una forma de contacto, y no la lleva.
- **El aspecto de la pantalla.**
- **Otros idiomas** que no sean español e inglés: los artículos salen en el idioma del proyecto, pero los nombres de los locales y el texto del clima solo están en esos dos.
