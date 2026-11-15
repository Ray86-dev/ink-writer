# 0021 · Distribución: instaladores, firma y actualizaciones

**Estado:** aceptada. Se publica sin firma del sistema por decisión del autor, así que la condición de salida de M9 queda sin cumplir.

**Contexto.** M9 pide instaladores firmados, actualizaciones, accesibilidad, inglés y español, documentación y plantillas de contribución, con una condición de salida: instalar y escribir sin ver ningún aviso de seguridad. Firmar cuesta dinero y exige una identidad verificada, y actualizar sola la app es una conexión que el autor no ha pedido.

## Decisión

### Instaladores

| Sistema | Formato | Notas |
|---|---|---|
| Windows | NSIS (`-setup.exe`) | Se instala para el usuario actual, sin pedir permisos de administrador. En español e inglés |
| macOS | `.dmg` | |
| Linux | AppImage y `.deb` | |

- Cada instalador incluye `LICENSE` y `THIRD-PARTY-NOTICES.md`.
- **`THIRD-PARTY-NOTICES.md`** lista lo que va dentro de la app, con su licencia y un enlace a su código. Lo piden la MPL-2.0 de cinco dependencias de Rust y la OFL de las dos tipografías. Lo genera `npm run notices` y el CI falla si no está al día.

### Publicar

Un flujo de GitHub Actions construye los tres instaladores al subir una etiqueta `v*` y los deja en un **borrador** con sus sumas SHA-256. Publicar el borrador es un paso manual. El flujo comprueba que la etiqueta coincide con la versión de la app y avisa de cada instalador que sale sin firmar. Pasos en `docs/publicar.md`.

### Idioma

La app sigue el idioma del sistema, y el autor puede fijar español o inglés en la pantalla de sus novelas. Se guarda en la base, con los demás ajustes.

### Accesibilidad

Repaso hecho sobre `SPEC.md` §10:

| Punto | Estado |
|---|---|
| Contraste AA de los colores de `DESIGN.md` | Comprobado por una prueba sobre `docs/design/tokens.css` |
| Teclado | El diálogo de cierre toma el foco y lo de detrás queda inactivo. El menú Exportar se cierra con `Esc` y devuelve el foco. El resto ya se podía recorrer |
| Reducir movimiento y alternativa sin WebGL | Hechos en M8 |
| Nombres accesibles | Las pruebas de pantalla buscan los controles por su papel y su nombre, así que uno sin nombre las rompe |

### Actualizaciones

El autor decidió el 15 de noviembre de 2026 que **la app solo busca una versión nueva cuando él lo pulsa.**

- **Dónde:** en Ajustes, en la pantalla de las novelas, donde no hay ningún texto abierto. Muestra la versión instalada y el botón «Buscar actualizaciones».
- **Buscar al abrir la app** es una casilla, apagada al principio. Con ella puesta, la app consulta al arrancar y solo dice algo si hay versión nueva: sin conexión no molesta.
- **Qué sale:** una petición a GitHub para leer `latest.json` de la última versión publicada. No lleva nada del autor ni de sus novelas.
- **Nada se instala solo.** El autor ve la versión y sus notas y pulsa «Instalar y reiniciar». Si algo falla, la app lo explica y enlaza a la página de versiones.
- **La dirección y la clave pública van en la configuración de la app.** La página solo puede pedir «busca» e «instala»: no elige de dónde ni qué.
- **Cada actualización va firmada** con una clave propia del proyecto, distinta de la firma del sistema. La app rechaza un instalador sin esa firma, así que el flujo solo anuncia los que la llevan.
- **Usa `tauri-plugin-updater`,** con licencia MIT o Apache-2.0, y el mismo TLS del sistema que el resto del shell.

**La clave privada la guarda el autor.** Se generó en su equipo, fuera del repositorio. Quien la tenga puede publicar una actualización que todas las instalaciones aceptarán. Si se pierde, las instalaciones existentes no podrán actualizarse solas nunca más: habría que cambiar la clave pública y pedir a cada persona que reinstale a mano.

### Sin firma del sistema, por decisión del autor

El autor decidió el 15 de noviembre de 2026 publicar **sin firma en Windows y en macOS por ahora.** Consecuencia: **la condición de salida de M9 no se cumple.** Quien instale verá el aviso de SmartScreen en Windows y el de Gatekeeper en macOS.

El flujo ya firma y notariza en macOS si encuentra los secretos de una cuenta de Apple, sin tocar código. Para Windows habría que elegir proveedor. Lo que se sabía al escribir esto, por confirmar:

| Sistema | Opción | Coste | Pega |
|---|---|---|---|
| Windows | SignPath Foundation | Gratis para código abierto | Hay que solicitarlo y que lo aprueben |
| Windows | Azure Trusted Signing | Unos 10 $ al mes | No está disponible para particulares de todos los países |
| Windows | Certificado OV | De 200 a 400 $ al año | Dispositivo físico, difícil desde el CI |
| macOS | Apple Developer Program | 99 $ al año | Es la única vía |

### Versión, nombre e identificador

El autor los dio por definitivos el 15 de noviembre de 2026: «Ink Writer», `dev.inkwriter.desktop` y primera versión `0.1.0`. **El identificador ya no se cambia:** decide la carpeta de los datos, y cambiarlo dejaría atrás las novelas de quien ya use la app.

## Comprobado

- El instalador de Windows se construye en el equipo de desarrollo: 5,7 MB en modo de depuración.
- Con la clave del proyecto, el instalador sale con su firma de actualización y `latest.json` se genera con la dirección que tendrá en GitHub.
- En la prueba de humo, la app real pregunta por una versión nueva a un servidor sustituto, lee la versión y sus notas, y se niega a instalar nada en una prueba.

## Sin comprobar

- **Instalar.** Nadie ha ejecutado el instalador ni ha abierto la app instalada.
- **Una actualización de verdad.** Descargar, verificar la firma, instalar y reiniciar no se ha hecho nunca: hacen falta dos versiones publicadas. Es lo primero que hay que probar al publicar la segunda.
- **Actualizar sin firma del sistema.** No se sabe si en macOS una actualización sin firmar llega a arrancar, ni si en Windows vuelve a salir el aviso.
- **El flujo de publicación.** No se ha lanzado: no hay ninguna etiqueta.
- **Los instaladores de macOS y Linux.** No se han construido.
- **La firma y la notarización de macOS.** Los nombres de los secretos son los de la documentación de Tauri.
- **macOS con procesador Intel.** El flujo construye solo para Apple Silicon.
- **Un lector de pantalla.** El repaso de accesibilidad es por pruebas y por código, no con NVDA ni VoiceOver.
