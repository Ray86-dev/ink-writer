# Ink Writer · Specification

_English translation of [SPEC.md](SPEC.md). The Spanish file is the working copy; if the two differ, the Spanish one is right._

Provisional name, taken from the project folder. MIT licence.

## 1. What it is

A desktop app for writing novels. It is lightweight and works offline.

**The author writes everything.** The AI reads what has been written, builds the story bible on its own, watches over consistency, proposes small tasks to move forward and researches whatever is needed. It never drafts the novel.

It differs from NovelCrafter and from similar open projects in these points:
- The AI guides and does not generate.
- It works offline.
- It connects with an account, without pasting keys: OpenRouter. ChatGPT is postponed with no date (see §6).
- It is MIT.

## 2. Principles

1. **The writing belongs to the author.** The AI does not insert prose. It only changes the text if the author clicks a one-off correction.
2. **Every fact has an origin.** Each fact on a sheet links to the passage it comes from. Each external fact links to its source. Without an origin, it is not shown.
3. **Everything is hyperlinked.** Characters, places, chapters, facts, tasks and contradictions link to each other in both directions.
4. **The author is in charge.** The author's corrections, merges and notes take precedence and survive any reanalysis.
5. **The AI does not interrupt.** While writing there are no marks or notices, unless the author chooses otherwise.
6. **You can write offline.** The analysis is queued.
7. **Losing text is the unforgivable failure.**

## 3. Screens

The navigable mockup is in `docs/design/mockup/`. The final visual direction is in `DESIGN.md` and `docs/design/ink-demo/`.

### 3.1 Dashboard

Home screen. It contains:

- **Ink network** (*Red de tinta*): the novel as a 3D graph. Nodes: chapters, characters, places and lore. It grows as you write. Tapping a node opens its sheet. It shows only the main elements of the novel, 16 nodes at most; everything else is in the cards (`docs/adr/0020-dashboard-tinta-viva.md`).
- **Next step** (*Siguiente paso*): a single task, large, with its reason.
- **Cards**: Chapters (*Capítulos*), Characters (*Personajes*), Relationships (*Relaciones*), Places (*Lugares*), Names (*Nombres*), Lore, Timeline (*Cronología*), Fact checking (*Verificación de datos*), Background research (*Documentación*) and Help (*Ayuda*). Each one shows the total, what is new and direct links.

### 3.2 Sheets

The AI creates and updates them from the text. Types: character, relationship, place (with the hierarchy city > neighbourhood > street), name, lore and chapter.

Each sheet contains:
- Name and variants.
- A summary written by the AI, based only on the passages.
- **What you have written** (*Lo que has escrito*): passages in narrative order, linked to the editor.
- Relationships, each with its source passage.
- **To resolve** (*Por resolver*): open contradictions.
- **Links here** (*Enlazan aquí*): sheets that mention it.
- **Background research** (*Documentación*): external suggestions.
- Author actions: **My note** (*Mi nota*), **Merge** (*Fusionar*) and **Split** (*Separar*).

The chapter sheet adds a summary, who appears, where, when and what changes.

The **Names** card is an index of all proper names and is used to detect variants.

### 3.3 Editor

Zen mode: only the text. Three modes that the author chooses:

| Mode | Shows | When it updates |
|---|---|---|
| Write (*Escribir*) | Text only | Not applicable |
| Write with links (*Escribir con enlaces*) | Known names underlined as you type; Ctrl/Cmd+click opens the sheet | On typing, locally and without AI |
| View links and hints (*Ver enlaces y pistas*) | Active links, marks and hints panel | After the last analysis |

The AI's marks never appear in the two writing modes.

Structure: chapters > scenes. History per scene, with compare and restore.

### 3.4 Hints

Four levels, which can be changed at any time:

| Level | Behaviour |
|---|---|
| Off (*Apagadas*) | No tasks, marks or automatic searches. The sheets keep updating |
| On request (*Si las pido*) | A light bulb and nothing else |
| Discreet (*Discretas*) | Underlines and a counter. Default (see §11) |
| Companion (*Compañera*) | An original character next to the text, a drop of ink, proposes the hint. Do not use Clippy or any copyrighted character |

Independent switches per type: Consistency (*Coherencia*), Corrections (*Correcciones*), Questions (*Preguntas*), Suggestions (*Sugerencias*) and Background research (*Documentación*).

**Gradual hints, as in a video game:** first a vague one ("something does not fit here"), then a directed one ("look at chapter 2") and finally the exact fact. The author asks for the next one only if they need it.

Actions:
- Consistency: **I'll fix it** (*Lo corrijo yo*), which opens the writing mode, or **It's intentional** (*Es intencionado*).
- One-off correction: **Apply** (*Aplicar*) or **Leave it** (*Déjalo así*). Only typos and orthotypography.
- Question or suggestion: **Write now** (*Escribir ahora*) or **Not useful** (*No me sirve*).
- Always: **Not now** (*Ahora no*).

If the author deletes the text that caused the hint, the hint closes by itself.

### 3.5 Tasks (Next step)

They last 5 to 20 minutes. Four types: **Define** (*Definir*), **Write** (*Escribir*), **Resolve** (*Resolver*) and **Complete** (*Completar*).

Rules:
- They come from what is already written. The app does not force you to plan first.
- Every task says why it is proposed.
- **This one doesn't help** (*Esta no me sirve*) and **Today I just want to write** (*Hoy solo quiero escribir*) are always available.

### 3.6 Fact checking

Two functions in one card:
- **Internal consistency** (*Coherencia interna*): contradictions inside the novel.
- **Real-world facts** (*Datos reales*): checked against cited sources.

**Change or error:** the AI does not decide. Single and then married is evolution; green eyes and then brown is a mistake. When in doubt, it asks the author through a Resolve task.

### 3.7 Background research

The app researches places (streets, climate, cafés), trades, objects, period and customs. Rules in §7. For now it searches on its own for places and the period; trades, objects and customs are added by the author as topics (`docs/adr/0019-documentacion-con-fuentes-abiertas.md`).

Suggestions are grouped in the Background research card and on each sheet. The Dashboard card leads to the Background research tab of the sheets, where the suggestions are. They never appear while writing. They only go into the notes if the author clicks **To my notes** (*A mis notas*). Until then they are not considered facts of the novel.

Before researching a place, the app asks whether it exists, whether it is based on a real one or whether it is entirely invented. If it is invented, nothing is searched and the author is asked.

### 3.8 Create project

It asks for the title, the language and the **period** of the story (adjustable per chapter).

### 3.9 AI settings

Connection, model per function, daily cap on searches and analyses, and usage status.

### 3.10 Help

Adjusting the hints, why the AI does not write for you, how the sheets are created. It is the Help card on the Dashboard.

## 4. Data model

Local SQLite for structure. Yjs for the prose. Indicative schema:

| Table | Key fields |
|---|---|
| `projects` | id, title, language, era |
| `chapters` | id, project_id, position, title, era_override, deleted_at |
| `scenes` | id, chapter_id, position, title, status, ydoc, ydoc_version, deleted_at, content_hash, analyzed_hash |
| `scene_updates` | id, scene_id, update_data |
| `scene_snapshots` | id, scene_id, created_at, ydoc, label, word_count |
| `entities` | id, project_id, type, canonical_name, status, summary |
| `entity_aliases` | entity_id, alias, source |
| `mentions` | scene_id, entity_id, quote |
| `facts` | id, scene_id, entity_id, category, attribute, value, quote, sentence, story_time, in_dialogue |
| `relations` | id, from_entity, to_entity, label, scene_id, quote |
| `user_overrides` | id, project_id, kind (merge, split, note, correction, dismiss), payload, created_at |
| `settings` | key, value |
| `issues` | id, kind, scene_a, quote_a, scene_b, quote_b, fix, reason |
| `hint_states` | project_id, hint_key, step, decision, updated_at |
| `entity_summaries` | entity_id, summary, basis |
| `scene_notes` | scene_id, change, text_hash |
| `scene_prompts` | id, scene_id, kind (question, suggestion), text, quote |
| `research_topics` | id, project_id, kind (place, era, topic), name, reality (real, based, invented), term, place, status, searched_at |
| `research_items` | id, topic_id, category, text, source_url, source_title, retrieved_at, status (suggested, noted, dismissed) |
| `ai_usage` | day, route, requests, cost |

Rules:
- A scene is a Yjs document: its compacted base (`ydoc`) plus the updates in `scene_updates`, an append-only log. See `docs/adr/0010-editor-y-guardado-de-la-prosa.md`.
- Each fact is located in the text by its literal quote. If the quote is no longer in the scene, the fact is not shown. See `docs/adr/0015-fichas-enlaces-y-correcciones-del-autor.md`.
- Reanalysing a scene **replaces** its `mentions`, `facts` and `relations`.
- `user_overrides` is never deleted by a reanalysis and is applied on top of it every time the sheets are computed.
- A research topic is identified by its name in the novel, not by an id from the analysis, so what the author said about a place is not touched by any reanalysis either. A result cannot be saved without the link to its source.
- Hints and tasks are not stored: they are computed from the sheets. What the author decides about each one goes to `hint_states`, keyed by the passages it quotes, and no reanalysis touches it either.

## 5. Analysis pipeline

**When:** on closing a scene or after a pause in writing, never on every keystroke, and only if `content_hash` changes.

**Offline:** the scenes are queued.

**Steps:**
1. **Extract** from the scene the entities, aliases, facts, relations and narrative time, with the literal quote for each fact. A quote that does not appear literally in the scene is discarded.
2. **Resolve identities** against the existing entities, taking into account epithets ("la doctora", the doctor) and the omitted subject of Spanish ("llegó tarde", arrived late).
3. **Compare** the new facts with the record, without rereading the novel, in small groups. Classify as contradiction, evolution or unrelated. How the groups are formed: `docs/adr/0011-canal-de-analisis.md`.
4. **Write,** in a separate request per scene: a summary of each sheet it touches, what changes in the scene, up to two questions and one writing task. Anything with no origin in the text is discarded, and what was written stops being shown when the text it came from changes. See `docs/adr/0017-lo-que-redacta-la-ia.md`. The consistency hints and their three steps are not written by any model: see `docs/adr/0016-pistas-y-siguiente-paso-sin-ia.md`.
5. **Check orthotypography** per scene, including dialogue dashes.

A novel of 80,000 words comes to around 100,000 tokens per pass, which is why analysis is done per scene and the result is stored.

Output contract of step 1 (validate with a schema; if it fails, one repair retry):

```json
{
  "entities": [{ "name": "Marta Rey", "type": "person", "aliases": ["la doctora"] }],
  "facts": [{ "entity": "Marta Rey", "category": "physical", "attribute": "eye_color", "value": "verdes", "quote": "los ojos verdes de su madre", "story_time": null }],
  "relations": [{ "from": "Marta Rey", "to": "Tomás", "label": "hermana de", "quote": "Tomás, su hermano" }]
}
```

`category` is a closed list, in `packages/core/src/analysis/contract.ts`.

Quality is measured with `fixtures/`. No prompt or model change is accepted without running that evaluation.

## 6. AI connection

| Route | Desktop | Browser | How |
|---|---|---|---|
| ChatGPT Plus/Pro | Yes | No | "Continue with ChatGPT" |
| OpenRouter | Yes | Yes | OAuth PKCE; key tied to the user's account |
| Ollama / LM Studio | Yes | No | Local |
| API key (OpenAI, Anthropic, etc.) | Yes | Yes | Advanced option |

**OpenRouter is the main route.** "Continue with ChatGPT" is postponed with no date: its inference could not be tested without a paid plan, and M6 was done without it (`docs/adr/0018-conexiones-sin-chatgpt.md`). What follows about that route is kept as a reference for when it is taken up again.

**Paying requires two daily caps set by the author:** spending and number of requests. Without them no paid model is used, and the app never moves from a free model to a paid one on its own. As an own API key, for now only DeepSeek.

**Claude only by API key or OpenRouter.** Anthropic does not allow offering the Claude.ai login in third-party apps. Do not imitate Claude Code or reuse its credentials.

**A single provider interface** in the core, with declared capabilities (web search, structured output, tools). Each adapter builds its own request.

### ChatGPT route: details confirmed in the OpenAI documentation (November 2026)

Status after M0 in `docs/adr/0008-resultado-m0-vias-de-ia.md`: inference through this route is still untested.

- **Eligibility:** open source projects and local apps. Plus and Pro. Paid or hosted apps go through an interest form. Verified: with the free plan, the OpenAI permissions screen does not let you continue, so the app must warn about the requirement before opening the browser.
- **DevKit:** **do not copy code from `sign-in-with-chatgpt-devkit`.** Its README declares it under its own non-commercial licence, incompatible with an MIT project. Implement the flow from the public documentation, in Rust.
- **Authorisation:** `https://auth.openai.com/api/accounts/authorize`, system browser, PKCE S256, new `state` and `nonce` on each attempt.
  - First registration: `client_id=dynamic_agent_client`, `agent_name_hint`, `ext_agent_host_id` (opaque, persistent per installation; `urn:uuid:…` is accepted). The callback returns the issued `client_id` (`oaiapp_…`). Check `state` before anything else and save the ID before the exchange. If it does not arrive, the registration is incomplete.
  - Reauthorisation: the issued `client_id`, the same `ext_agent_host_id`, without `agent_name_hint` and with `id_token_hint` if the last ID token is kept. If the callback brings a different `client_id`, reject it.
  - `redirect_uri`: `http://127.0.0.1:<puerto>/auth/callback`. Only the port varies, also in the registration (verified with a free port). Do not use `localhost`. Open the port before the browser.
  - Scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`.
  - `resource=https://api.openai.com/v1`.
- **Token:** form POST to `https://auth.openai.com/api/accounts/oauth/token`, with the issued `client_id` and the same `redirect_uri` and `resource` as in the authorisation. Validate the ID token (RS256 signature with `/.well-known/jwks.json`, issuer `https://auth.openai.com`, audience equal to the issued `client_id`, nonce, expiry). Check in the token response, not in the callback, that the `chatgpt.tokens.use.direct` scope was granted. Access token of 1 hour; refresh token of 30 days, rotating.
  - Refresh: `grant_type=refresh_token`, issued `client_id`, `resource` and no `scope`, to keep the permission. One refresh at a time, and save all the new values together.
  - Sign out: POST to `https://auth.openai.com/api/accounts/oauth/revoke` with `token`, `token_type_hint=refresh_token` and `client_id`. Keep the `client_id` and the host ID. This does not disconnect the app in ChatGPT: for that, the user must remove it in their account settings.
- **Models:** `GET https://api.openai.com/v1/models`. The response is an object with `models`. Filter `visibility == "list"`, keep the order and use `slug` and `display_name`.
- **Inference:** `POST https://api.openai.com/v1/responses` with `store: false` and `stream: true`.
  - `input` must be an array. Use `instructions` or developer messages. Explicit `system` messages are rejected.
  - **Do not send:** `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation`, `user`.
  - No `previous_response_id` over HTTP: resend the context in `input`.
  - Function tools: in namespaces or in `additional_tools`. Web search: depends on the model and the account policy.
  - Structured output is not documented on this route. Test in milestone M0; alternative: force a function tool with a schema.
- **Success:** only after `response.completed`. Always generate into a draft. Handle `response.failed`, `response.incomplete` and cut-offs separately.

| Error | Recovery |
|---|---|
| 429 `subscription_sharing_usage_limit_exceeded` | Pause, "Manage usage" button to `chatgpt.com/settings/usage`. Do not invent a reset time |
| 503 `subscription_sharing_usage_unavailable` or `subscription_sharing_user_unavailable` | Keep the session, retry with a bounded wait |
| 401 `subscription_sharing_invalid_user` | Credential failure. Ask for login only after a confirmed revocation or a terminal refresh |
| 403 `subscription_sharing_user_not_eligible` | Explain the restriction. Do not repeat the request or go back to OAuth |
| 400 `subscription_sharing_unsupported_capability` | Look at `error.param` and remove what is not supported. Do not repeat the same request |
| 403 `subscription_sharing_route_not_supported` | Method or route error: review the request |
| 403 `chatpass_v2_scope_not_authorized` or `chatpass_v2_invalid_authorization_context` | Review client and permissions. Do not retry or switch billing |
| Before opening the stream: 401, 403 or 503 with `{"detail":…}` | 401: review account and scopes. 403: show the restriction, for example by region. 503: keep credentials and retry with a bounded wait |
| Exchange `invalid_grant` | Discard the code and start another authorisation with the issued `client_id` |
| Callback `access_denied` | Validate `state` and stop, without exchanging any code |
| Refresh `invalid_grant`, `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated` or `refresh_token_reused` | Delete tokens and repeat OAuth with the saved `client_id` |
| `invalid_client` | Configuration error: reauthenticating does not fix it |
| Scope missing in a valid token response | Keep the session, disabled state and choose another route. **Never switch billing silently** |
| Free plan | OpenAI blocks the permission on its screen, before returning to the app. Warn before opening the browser |

- **Interface:** "Continue with ChatGPT" button with the approved branding, welcome modal the first time, "Using ChatGPT plan" next to the model selector with "Manage usage". Save the HTTP status, code and request ID for support.
- **Unconfirmed:** the documentation does not say expressly whether a writing app is included, although it does not restrict by use case. There is also no documented API to read the remaining usage, and it is not documented whether OpenAI uses these requests to train models. This last point must be resolved before offering the route, because of §10.

The tokens live in the Rust layer and never reach the WebView. Use the operating system's secure store or, if there is none, a file readable only by the owner, with atomic writes. On Windows, each secret in the store allows 2560 bytes: M0 stores only a key there and encrypts the tokens in a file.

### OpenRouter

Send to `https://openrouter.ai/auth` with `callback_url`, `code_challenge` (S256) and `state`. Exchange at `POST https://openrouter.ai/api/v1/auth/keys`. Localhost on any port.

Web search is paid by the user, also with free models: about $0.007 per search with Exa, and one request can make several. OpenRouter may accept it without credit, so the spending cap is enforced in the app and a 402 error is never relied on.

With structured output, send `provider.require_parameters` so the schema is not lost silently, and leave a token margin: reasoning consumes them before answering.

## 7. Research

| Data | Source | Condition |
|---|---|---|
| Where a real place is | OpenStreetMap via Nominatim | One query per second at most; identifying User-Agent; store the result. Attribution to OpenStreetMap |
| Streets, cafés, present-day places | OpenStreetMap via Overpass | In automated use, about 100 queries and 10 MB per day per public instance; identifying User-Agent; wait 30 s after 429/406. Attribution to OpenStreetMap |
| Climate | Open-Meteo | Free only for non-commercial use, fewer than 10,000 calls per day, CC BY 4.0 |
| Trades, history, atmosphere | Wikipedia, in the project's language | CC BY-SA 4.0, with a link to the article. The model's web search is left out: it is paid and could not be tested |

Non-negotiable rules:
- The topic is searched, **never a character's name or the author's text**. A term that contains a character's name is rejected, even if it is a real place.
- Each suggestion carries a linked source. **Without a source, it is not shown.**
- The period is taken into account. OpenStreetMap only gives the present: if the story is not clearly set in the present, streets and venues are not queried.
- Once per new topic, with the result stored so it can be consulted offline.
- Adjustable daily cap, 60 searches by default, enforced in Rust.
- With hints off or the Background research type disabled, a search only happens if the author clicks **Search now** (*Buscar ahora*).

No search goes through a model: the app calls these services directly, whatever the AI connection, and also with none.

## 8. Sync and browser

- **Sync:** relay of **end-to-end encrypted** Yjs updates, self-hostable. The server cannot read the text.
- **Browser:** same core and same interface, with a different storage implementation. The ChatGPT login is not available, because it requires a callback on 127.0.0.1.
- Design the storage and provider interfaces from the start so that this is possible.

## 9. Import and export

- **Export:** DOCX and Markdown in the first version; EPUB and interior PDF later.
- **Exported files carry no mark of the tool or of AI**, neither in the content nor in the metadata.
- **Import DOCX and Markdown:** after the first version.

## 10. Non-functional requirements

Initial targets, to be calibrated:

| Area | Target |
|---|---|
| Typing | No perceptible lag with 150,000 words |
| Saving | Continuous; no loss on forced close |
| Privacy | No telemetry. The manuscript only leaves towards the chosen provider or, encrypted, towards sync |
| Accessibility | Full keyboard support, WCAG 2.1 AA, respect for reduced motion, alternative without WebGL |
| Languages | Interface in Spanish and English from the start; analysis and hints in the project's language |
| Distribution | Signed installers on Windows and macOS. Budget for signing |

## 11. Open decisions

| Decision | Current proposal |
|---|---|
| Default hint level | Discreet |
| Free or paid sync | Self-hosted and free. If it is charged for, consult OpenAI first: it does not clarify whether an MIT client with a paid service stays on the free route |
| Scope of the first release | Desktop only; sync and browser later |
| Final name | Ink Writer is provisional |
| Open source relay | Same repository, MIT |
