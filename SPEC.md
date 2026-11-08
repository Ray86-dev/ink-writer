# Ink Writer · Especificación

Nombre provisional, tomado de la carpeta del proyecto. Licencia MIT.

## 1. Qué es

Una app de escritura de novelas de escritorio, ligera y que funciona sin conexión.

**El autor escribe todo.** La IA lee lo escrito, construye sola la biblia de la historia, vigila la coherencia, propone tareas pequeñas para avanzar y documenta lo que haga falta. Nunca redacta la novela.

Se diferencia de NovelCrafter y de los proyectos abiertos parecidos en estos puntos:
- La IA guía y no genera.
- Funciona sin conexión.
- Se conecta con una cuenta, sin pegar claves: OpenRouter y, cuando se verifique, ChatGPT (ver §6).
- Es MIT.

## 2. Principios

1. **La escritura es del autor.** La IA no inserta prosa. Solo cambia el texto si el autor pulsa una corrección puntual.
2. **Todo dato tiene origen.** Cada dato de una ficha enlaza al pasaje del que sale. Cada dato externo enlaza a su fuente. Sin origen, no se muestra.
3. **Todo está hipervinculado.** Personajes, lugares, capítulos, datos, tareas y contradicciones se enlazan entre sí en las dos direcciones.
4. **El autor manda.** Sus correcciones, fusiones y notas prevalecen y sobreviven a cualquier reanálisis.
5. **La IA no interrumpe.** Mientras se escribe no hay marcas ni avisos, salvo que el autor lo elija.
6. **Sin conexión se puede escribir.** El análisis queda en cola.
7. **Perder texto es el fallo imperdonable.**

## 3. Pantallas

El mockup navegable está en `docs/design/mockup/`. La dirección visual definitiva, en `DESIGN.md` y `docs/design/ink-demo/`.

### 3.1 Dashboard

Pantalla de inicio. Contiene:

- **Red de tinta**: la novela como grafo 3D. Nodos: capítulos, personajes, lugares y lore. Crece al escribir. Tocar un nodo abre su ficha.
- **Siguiente paso**: una sola tarea, grande, con su motivo.
- **Tarjetas**: Capítulos, Personajes, Relaciones, Lugares, Nombres, Lore, Cronología, Verificación de datos, Documentación y Ayuda. Cada una muestra el total, las novedades y enlaces directos.

### 3.2 Fichas

Las crea y actualiza la IA a partir del texto. Tipos: personaje, relación, lugar (con jerarquía ciudad > barrio > calle), nombre, lore y capítulo.

Cada ficha contiene:
- Nombre y variantes.
- Resumen redactado por la IA, apoyado solo en los pasajes.
- **Lo que has escrito**: pasajes en orden narrativo, enlazados al editor.
- Relaciones con su pasaje de origen.
- **Por resolver**: contradicciones abiertas.
- **Enlazan aquí**: fichas que la mencionan.
- **Documentación**: sugerencias externas.
- Acciones del autor: **Mi nota**, **Fusionar** y **Separar**.

La ficha de capítulo añade resumen, quién aparece, dónde, cuándo y qué cambia.

La tarjeta **Nombres** es un índice de todos los nombres propios y sirve para detectar variantes.

### 3.3 Editor

Modo zen: solo el texto. Tres modos que el autor elige:

| Modo | Muestra | Cuándo se actualiza |
|---|---|---|
| Escribir | Solo texto | No aplica |
| Escribir con enlaces | Nombres conocidos subrayados según se teclea; Ctrl/Cmd+clic abre la ficha | Al teclear, en local y sin IA |
| Ver enlaces y pistas | Enlaces activos, marcas y panel de pistas | Tras el último análisis |

Las marcas de la IA nunca aparecen en los dos modos de escritura.

Estructura: capítulos > escenas. Historial por escena con comparar y recuperar.

### 3.4 Pistas

Cuatro niveles, cambiables en todo momento:

| Nivel | Comportamiento |
|---|---|
| Apagadas | Sin tareas, marcas ni búsquedas automáticas. Las fichas se siguen actualizando |
| Si las pido | Una bombilla y nada más |
| Discretas | Subrayados y contador. Por defecto (ver §11) |
| Compañera | Un personaje propio junto al texto, una gota de tinta, propone la pista. No usar Clippy ni ningún personaje con derechos |

Interruptores independientes por tipo: Coherencia, Correcciones, Preguntas, Sugerencias y Documentación.

**Pistas graduales, como en un videojuego:** primero una vaga («algo no encaja aquí»), luego una orientada («mira el capítulo 2») y al final el dato exacto. El autor pide la siguiente solo si la necesita.

Acciones:
- Coherencia: **Lo corrijo yo** (abre el modo de escritura) o **Es intencionado**.
- Corrección puntual: **Aplicar** o **Déjalo así**. Solo erratas y ortotipografía.
- Pregunta o sugerencia: **Escribir ahora** o **No me sirve**.
- Siempre: **Ahora no**.

Si el autor elimina el texto que causaba la pista, la pista se cierra sola.

### 3.5 Tareas (Siguiente paso)

Duración de 5 a 20 minutos. Cuatro tipos: **Definir**, **Escribir**, **Resolver** y **Completar**.

Reglas:
- Salen de lo ya escrito. La app no obliga a planificar antes.
- Toda tarea dice por qué se propone.
- Siempre existen **Esta no me sirve** y **Hoy solo quiero escribir**.

### 3.6 Verificación de datos

Dos funciones en una tarjeta:
- **Coherencia interna**: contradicciones dentro de la novela.
- **Datos reales**: contraste con fuentes citadas.

**Cambio o error:** la IA no decide. Soltera y luego casada es evolución; ojos verdes y luego marrones es un fallo. Ante la duda, pregunta al autor mediante una tarea de Resolver.

### 3.7 Documentación

La IA investiga de forma proactiva sobre **todo**: lugares (calles, clima, cafeterías), oficios, objetos, época y costumbres. Normas en §7.

Las sugerencias se agrupan en la tarjeta Documentación y en cada ficha. Nunca aparecen mientras se escribe. Solo entran en las notas si el autor pulsa **A mis notas**. No se consideran datos de la novela hasta entonces.

Antes de documentar un lugar, se pregunta si existe, si está basado en uno real o si es inventado del todo. Si es inventado, no se busca nada y se pregunta al autor.

### 3.8 Crear proyecto

Pide título, idioma y **época** de la historia (ajustable por capítulo).

### 3.9 Ajustes de IA

Conexión, modelo por función, tope diario de búsquedas y análisis, y estado de uso.

### 3.10 Ayuda

Regular las pistas, por qué la IA no escribe por ti, cómo se crean las fichas.

## 4. Modelo de datos

SQLite local para estructura. Yjs para la prosa. Esquema orientativo:

| Tabla | Campos clave |
|---|---|
| `projects` | id, title, language, era |
| `chapters` | id, project_id, position, title, era_override, deleted_at |
| `scenes` | id, chapter_id, position, title, status, ydoc, ydoc_version, deleted_at, content_hash, analyzed_hash |
| `scene_updates` | id, scene_id, update_data |
| `scene_snapshots` | id, scene_id, created_at, ydoc, label, word_count |
| `entities` | id, project_id, type, canonical_name, status, summary |
| `entity_aliases` | entity_id, alias, source |
| `mentions` | id, scene_id, entity_id, anchor |
| `facts` | id, scene_id, entity_id, attribute, value, quote, anchor, story_time |
| `relations` | id, from_entity, to_entity, label, scene_id, anchor |
| `user_overrides` | id, kind (merge, split, note, correction, dismiss), payload, created_at |
| `issues` | id, kind, category, status, hint_steps, fact_a, fact_b, anchor, resolution |
| `tasks` | id, kind, body, reason, issue_id, status |
| `research_topics` | id, entity_id, term, era, status, searched_at |
| `research_items` | id, topic_id, category, text, source_url, source_title, retrieved_at, status |
| `ai_usage` | day, provider, requests, searches |

Reglas:
- Una escena es un documento Yjs: su base compactada (`ydoc`) más las actualizaciones de `scene_updates`, un registro de solo añadir. Ver `docs/adr/0010-editor-y-guardado-de-la-prosa.md`.
- Las posiciones de `anchor` son posiciones relativas de Yjs, para sobrevivir a las ediciones.
- El reanálisis de una escena **sustituye** sus `mentions`, `facts` y `relations`.
- `user_overrides` nunca se borra por un reanálisis y se aplica después de él.

## 5. Canal de análisis

**Cuándo:** al cerrar una escena o tras una pausa en la escritura, nunca a cada tecla, y solo si cambia `content_hash`.

**Sin conexión:** las escenas quedan en cola.

**Pasos:**
1. **Extraer** de la escena entidades, alias, hechos, relaciones y tiempo narrativo, con la cita literal de cada dato. Una cita que no aparezca literalmente en la escena se descarta.
2. **Resolver identidades** contra las entidades existentes, teniendo en cuenta epítetos («la doctora») y el sujeto omitido del español («llegó tarde»).
3. **Comparar** los hechos nuevos con el registro, sin releer la novela. Clasificar en contradicción, evolución o sin relación.
4. **Generar** resúmenes de ficha, pistas graduales y tareas.
5. **Revisar ortotipografía** por escena, incluidas las rayas de diálogo.

Una novela de 80.000 palabras ronda los 100.000 tokens por pasada, por eso se analiza por escena y se guarda el resultado.

Contrato de salida del paso 1 (validar con esquema; si falla, un reintento de reparación):

```json
{
  "entities": [{ "name": "Marta Rey", "type": "person", "aliases": ["la doctora"] }],
  "facts": [{ "entity": "Marta Rey", "attribute": "eye_color", "value": "verdes", "quote": "los ojos verdes de su madre", "story_time": null }],
  "relations": [{ "from": "Marta Rey", "to": "Tomás", "label": "hermana de", "quote": "Tomás, su hermano" }]
}
```

La calidad se mide con `fixtures/`. Ningún cambio de prompt o modelo se da por bueno sin ejecutar esa evaluación.

## 6. Conexión de IA

| Vía | Escritorio | Navegador | Cómo |
|---|---|---|---|
| ChatGPT Plus/Pro | Sí | No | «Continue with ChatGPT» |
| OpenRouter | Sí | Sí | OAuth PKCE; clave ligada a la cuenta del usuario |
| Ollama / LM Studio | Sí | No | Local |
| Clave de API (OpenAI, Anthropic, etc.) | Sí | Sí | Opción avanzada |

**OpenRouter es la vía principal provisional.** «Continue with ChatGPT» sigue siendo el objetivo, pero su inferencia no se ha podido probar. Antes de M6 hay que hacer la comprobación pendiente de `docs/adr/0008-resultado-m0-vias-de-ia.md`.

**Claude solo por clave de API u OpenRouter.** Anthropic no permite ofrecer el login de Claude.ai en apps de terceros. No imitar a Claude Code ni reutilizar sus credenciales.

**Una interfaz única de proveedor** en el core, con capacidades declaradas (búsqueda web, salida estructurada, herramientas). Cada adaptador construye su propia petición.

### Vía ChatGPT: detalles confirmados en la documentación de OpenAI (noviembre de 2026)

Estado tras M0 en `docs/adr/0008-resultado-m0-vias-de-ia.md`: la inferencia por esta vía sigue sin probarse.

- **Elegibilidad:** proyectos open source y apps locales. Plus y Pro. Las apps de pago o alojadas van por formulario de interés. Comprobado: con el plan gratuito, la pantalla de permisos de OpenAI no deja continuar, así que la app debe avisar del requisito antes de abrir el navegador.
- **DevKit:** **no copiar código de `sign-in-with-chatgpt-devkit`.** Su README lo declara bajo una licencia no comercial propia, incompatible con un proyecto MIT. Implementar el flujo desde la documentación pública, en Rust.
- **Autorización:** `https://auth.openai.com/api/accounts/authorize`, navegador del sistema, PKCE S256, `state` y `nonce` nuevos en cada intento.
  - Primer registro: `client_id=dynamic_agent_client`, `agent_name_hint`, `ext_agent_host_id` (opaco, persistente por instalación; se admite `urn:uuid:…`). El callback devuelve el `client_id` emitido (`oaiapp_…`). Comprobar `state` antes que nada y guardar el ID antes del canje. Si no llega, el registro queda incompleto.
  - Reautorización: el `client_id` emitido, el mismo `ext_agent_host_id`, sin `agent_name_hint` y con `id_token_hint` si se conserva el último ID token. Si el callback trae otro `client_id`, rechazarlo.
  - `redirect_uri`: `http://127.0.0.1:<puerto>/auth/callback`. Solo varía el puerto, también en el registro (comprobado con un puerto libre). No usar `localhost`. Abrir el puerto antes que el navegador.
  - Scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`.
  - `resource=https://api.openai.com/v1`.
- **Token:** POST con formulario a `https://auth.openai.com/api/accounts/oauth/token`, con el `client_id` emitido y el mismo `redirect_uri` y `resource` que en la autorización. Validar el ID token (firma RS256 con `/.well-known/jwks.json`, issuer `https://auth.openai.com`, audience igual al `client_id` emitido, nonce, expiración). Comprobar en la respuesta del token, no en el callback, que el scope `chatgpt.tokens.use.direct` se concedió. Access token de 1 hora; refresh de 30 días, rotatorio.
  - Refresh: `grant_type=refresh_token`, `client_id` emitido, `resource` y sin `scope`, para conservar el permiso. Un refresh a la vez, y guardar juntos todos los valores nuevos.
  - Cerrar sesión: POST a `https://auth.openai.com/api/accounts/oauth/revoke` con `token`, `token_type_hint=refresh_token` y `client_id`. Conservar el `client_id` y el ID de host. Esto no desconecta la app en ChatGPT: para eso, el usuario debe quitarla en los ajustes de su cuenta.
- **Modelos:** `GET https://api.openai.com/v1/models`. La respuesta es un objeto con `models`. Filtrar `visibility == "list"`, conservar el orden y usar `slug` y `display_name`.
- **Inferencia:** `POST https://api.openai.com/v1/responses` con `store: false` y `stream: true`.
  - `input` debe ser un array. Usar `instructions` o mensajes developer. Los mensajes `system` explícitos se rechazan.
  - **No enviar:** `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation`, `user`.
  - Sin `previous_response_id` por HTTP: reenviar el contexto en `input`.
  - Herramientas de función: en namespaces o en `additional_tools`. Búsqueda web: según modelo y política de la cuenta.
  - La salida estructurada no está documentada en esta vía. Probar en el hito M0; alternativa: forzar una herramienta de función con esquema.
- **Éxito:** solo tras `response.completed`. Generar siempre en un borrador. Tratar aparte `response.failed`, `response.incomplete` y los cortes.

| Error | Recuperación |
|---|---|
| 429 `subscription_sharing_usage_limit_exceeded` | Pausar, botón «Manage usage» a `chatgpt.com/settings/usage`. No inventar hora de reinicio |
| 503 `subscription_sharing_usage_unavailable` o `subscription_sharing_user_unavailable` | Mantener la sesión, reintentar con espera acotada |
| 401 `subscription_sharing_invalid_user` | Fallo de credencial. Pedir login solo tras revocación confirmada o refresh terminal |
| 403 `subscription_sharing_user_not_eligible` | Explicar la restricción. No repetir la petición ni volver a OAuth |
| 400 `subscription_sharing_unsupported_capability` | Mirar `error.param` y quitar lo no admitido. No repetir la misma petición |
| 403 `subscription_sharing_route_not_supported` | Error de método o ruta: revisar la petición |
| 403 `chatpass_v2_scope_not_authorized` o `chatpass_v2_invalid_authorization_context` | Revisar cliente y permisos. No reintentar ni cambiar de facturación |
| Antes de abrir el stream: 401, 403 o 503 con `{"detail":…}` | 401: revisar cuenta y scopes. 403: mostrar la restricción, por ejemplo de región. 503: mantener credenciales y reintentar con espera acotada |
| Canje `invalid_grant` | Descartar el código y empezar otra autorización con el `client_id` emitido |
| Callback `access_denied` | Validar `state` y parar, sin canjear ningún código |
| Refresh `invalid_grant`, `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated` o `refresh_token_reused` | Borrar tokens y repetir OAuth con el `client_id` guardado |
| `invalid_client` | Error de configuración: reautenticar no lo arregla |
| Sin el scope en una respuesta de token válida | Conservar la sesión, estado desactivado y elegir otra vía. **Nunca cambiar de facturación en silencio** |
| Plan gratuito | OpenAI bloquea el permiso en su pantalla, antes de volver a la app. Avisar antes de abrir el navegador |

- **Interfaz:** botón «Continue with ChatGPT» con la marca aprobada, modal de bienvenida la primera vez, «Using ChatGPT plan» junto al selector de modelo con «Manage usage». Guardar estado HTTP, código e ID de petición para soporte.
- **Sin confirmar:** la documentación no dice expresamente si una app de escritura está incluida, aunque no restringe por caso de uso. Tampoco hay API documentada para leer el uso restante, ni se documenta si OpenAI usa estas peticiones para entrenar modelos. Esto último hay que resolverlo antes de ofrecer la vía, por §10.

Los tokens viven en la capa Rust y nunca llegan al WebView. Usar el almacén seguro del sistema operativo o, si no existe, archivo solo legible por el propietario, con escritura atómica. En Windows, cada secreto del almacén admite 2560 bytes: M0 guarda ahí solo una clave y cifra los tokens en un archivo.

### OpenRouter

Enviar a `https://openrouter.ai/auth` con `callback_url`, `code_challenge` (S256) y `state`. Canjear en `POST https://openrouter.ai/api/v1/auth/keys`. Localhost en cualquier puerto.

La búsqueda web la paga el usuario, también con modelos gratuitos: unos 0,007 $ por búsqueda con Exa, y una petición puede hacer varias. OpenRouter puede aceptarla sin saldo, así que el tope de gasto se controla en la app y nunca se confía en un error 402.

Con salida estructurada, enviar `provider.require_parameters` para no perder el esquema en silencio, y dejar margen de tokens: el razonamiento los consume antes de responder.

## 7. Investigación

| Dato | Fuente | Condición |
|---|---|---|
| Calles, cafeterías, lugares actuales | OpenStreetMap vía Overpass | En uso automatizado, unas 100 consultas y 10 MB al día por instancia pública; User-Agent identificativo; esperar 30 s tras 429/406. Atribución a OpenStreetMap |
| Clima | Open-Meteo | Gratis solo sin fines comerciales, menos de 10.000 llamadas al día, CC BY 4.0 |
| Oficios, historia, ambiente | Búsqueda web del modelo | Con citas |

Normas innegociables:
- Se busca el tema, **nunca el nombre de un personaje ni el texto del autor**.
- Cada sugerencia lleva fuente enlazada. **Sin fuente, no se muestra.**
- Se tiene en cuenta la época. OpenStreetMap solo da lo actual: si la historia transcurre en el pasado, usar solo fuentes históricas.
- Una vez por tema nuevo, con resultado guardado para consultar sin conexión.
- Tope diario regulable.
- Con pistas apagadas o el tipo Documentación desactivado, solo se busca si el autor pulsa **Buscar ahora**.

Un modelo local no busca por sí solo: en ese caso, usar estas APIs directamente.

## 8. Sincronización y navegador

- **Sync:** relay de updates Yjs **cifrados de extremo a extremo**, autoalojable. El servidor no puede leer el texto.
- **Navegador:** mismo core y misma interfaz, con otra implementación de almacenamiento. El login de ChatGPT no está disponible, porque exige callback en 127.0.0.1.
- Diseñar desde el inicio las interfaces de almacenamiento y de proveedor para que esto sea posible.

## 9. Importar y exportar

- **Exportar:** DOCX y Markdown en la primera versión; EPUB y PDF de interior después.
- **Los archivos exportados no llevan ninguna marca de la herramienta ni de IA**, ni en el contenido ni en los metadatos.
- **Importar DOCX y Markdown:** después de la primera versión.

## 10. Requisitos no funcionales

Objetivos iniciales, a calibrar:

| Área | Objetivo |
|---|---|
| Tecleo | Sin retardo perceptible con 150.000 palabras |
| Guardado | Continuo; ninguna pérdida ante cierre forzado |
| Privacidad | Sin telemetría. El manuscrito solo sale hacia el proveedor elegido o, cifrado, hacia el sync |
| Accesibilidad | Teclado completo, WCAG 2.1 AA, respeto a reducir movimiento, alternativa sin WebGL |
| Idiomas | Interfaz en español e inglés desde el inicio; análisis y pistas en el idioma del proyecto |
| Distribución | Instaladores firmados en Windows y macOS. Presupuestar la firma |

## 11. Decisiones abiertas

| Decisión | Propuesta actual |
|---|---|
| Nivel de pistas por defecto | Discretas |
| Sync gratuito o de pago | Autoalojado y gratuito. Si se cobra, consultar antes a OpenAI: no aclara si un cliente MIT con servicio de pago sigue en la vía libre |
| Alcance de la primera entrega | Solo escritorio; sync y navegador después |
| Nombre definitivo | Ink Writer es provisional |
| Código abierto del relay | Mismo repositorio, MIT |
