# 0009 · Andamiaje: monorepo, SQLite y límites del core

**Estado:** aceptada.

**Contexto.** M1 crea la base de todo lo demás. Las decisiones de aquí son caras de cambiar más adelante, sobre todo dónde vive el esquema y qué puede hacer el WebView.

## Decisión

**Monorepo con npm workspaces.** `packages/core` contiene el dominio y `apps/desktop` el shell Tauri y la página. No hace falta instalar otra herramienta. El core se consume desde su código TypeScript, sin paso de compilación propio.

**El SQL vive en el core.** El esquema, las migraciones y las consultas están en TypeScript. El shell solo ofrece `query`, `execute` y `transaction` sobre la base de la app. Así el mismo código servirá en el navegador con otro controlador, como pide `SPEC.md` §8.

Se descartaron dos alternativas:
- **Un comando de Rust por operación:** llevaría el dominio a Rust, contra la 0001, y obligaría a duplicarlo para el navegador.
- **`tauri-plugin-sql`:** da al WebView una API más amplia de la necesaria y deja menos control sobre la conexión.

**El WebView puede ejecutar SQL, así que la conexión está limitada.** Esta es la contrapartida de lo anterior. La conexión no puede abrir otros archivos (`ATTACH`, `VACUUM INTO`), ni cargar extensiones, ni escribir en las tablas de esquema, y cada llamada admite una sola sentencia. Los tokens nunca se guardan en esta base (regla 9). Un fallo de seguridad en la página podría leer o alterar los datos de la novela, por eso la CSP es estricta y el WebView solo tiene el permiso `core:default`.

**Transacciones por lotes.** El controlador recibe todas las sentencias a la vez, sin `begin` ni `commit` separados. Un fallo de la página no puede dejar una transacción abierta, y dos llamadas no pueden mezclarse. A cambio, no se puede leer en mitad de una transacción. Si M2 lo necesita, habrá que resolverlo en un ADR.

**Migraciones solo hacia delante,** numeradas y con la versión en `PRAGMA user_version`. Cada una se confirma junto con su versión, de modo que un cierre forzado deja la base en la última versión completa. Una base de una versión más nueva se rechaza sin tocarla.

**SQLite incluido con `rusqlite`,** para tener la misma versión en los tres sistemas, con WAL y `synchronous=FULL`. Cada confirmación se sincroniza con el disco. M2 debe medir su coste al teclear.

**Esquema mínimo.** Solo `projects`, `chapters` y `scenes`: cada tabla de `SPEC.md` §4 llega con el hito que la usa. **La prosa aún no se guarda:** M2 decide cómo se almacenan los documentos Yjs. Tampoco hay borrado: las claves foráneas usan `ON DELETE RESTRICT`, y el borrado llegará con el historial que lo hace seguro.

**Interfaz de proveedor.**
- Capacidades por modelo, porque en OpenRouter varían de un modelo a otro (0008).
- Un único evento final por respuesta, y solo `completed` cuenta como éxito.
- Un adaptador rechaza lo que el modelo no puede hacer. Perder en silencio un esquema o una búsqueda daría una respuesta errónea con aspecto de correcta.
- Cada proveedor declara quién paga, y el core no cambia de proveedor por su cuenta (regla 10).
- Las credenciales no aparecen en la interfaz: se quedan en Rust (regla 9).

Los adaptadores reales llegan cuando hacen falta, en M3 y M6. Todos deben pasar la misma batería, `packages/core/test/provider-contract.ts`.

**Prueba de humo.** `--smoke-test` arranca la app real con una base temporal, ejecuta comprobaciones desde la página y termina con el resultado. Es lo que permite afirmar en CI que la app arranca en cada sistema y que la página, el IPC, Rust y SQLite encajan. Necesita un binario con la página incluida: `cargo build` y `cargo test` dejan uno que busca el servidor de desarrollo, por eso `npm run smoke` construye antes de arrancar.

**Licencias en CI.** `npm run licenses` revisa todas las dependencias de todas las plataformas. La MPL-2.0 se acepta solo para los paquetes listados en `scripts/license-policy.mjs`, todos usados sin modificar:
- `selectors`, `cssparser`, `cssparser-macros` y `dtoa-short`: Tauri los usa al compilar.
- `lightningcss`: Vite lo usa al compilar. Nada de ella llega a la app.
- `option-ext`: llega a través de `dirs` y es el único que se enlaza en el binario.

Cualquier otro paquete con esa licencia detiene el CI hasta revisarlo. **En M9,** los binarios deben indicar dónde obtener el código de `option-ext` (0008).

**Sin framework de interfaz por ahora.** M1 no lo necesita. Lo decide M2, junto con TipTap: ver la [0010](0010-editor-y-guardado-de-la-prosa.md).

## Consecuencias

- Las pruebas del core usan `node:sqlite`, experimental en Node 24 y con otra versión de SQLite que `rusqlite`. Las diferencias las cubren las pruebas de Rust y la prueba de humo.
- El identificador `dev.inkwriter.desktop` determina la carpeta de datos del usuario. El nombre es provisional (`SPEC.md` §11): hay que decidirlo antes de M9, porque cambiarlo después obliga a migrar esa carpeta.
- `prototypes/m0/` queda fuera del monorepo y del CI. Se conserva para la comprobación pendiente de la 0008.
- Nada impide abrir dos instancias de la app sobre la misma base. La [0010](0010-editor-y-guardado-de-la-prosa.md) lo resuelve.
