# 0021 · Distribución: instaladores, firma y actualizaciones

**Estado:** aceptada en lo hecho. La firma en Windows, la cuenta de Apple y las actualizaciones esperan una decisión del autor.

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

## Pendiente de una decisión del autor

### Firma en Windows

Sin firma, SmartScreen avisa al instalar. Opciones, con lo que se sabía al escribir esto y que hay que confirmar:

| Opción | Coste | Pega |
|---|---|---|
| SignPath Foundation | Gratis para proyectos de código abierto | Hay que solicitarlo y que lo aprueben. El certificado va a nombre de la fundación |
| Azure Trusted Signing | Unos 10 $ al mes | No está disponible para particulares de todos los países |
| Certificado OV de una autoridad | De 200 a 400 $ al año | Va en un dispositivo físico, difícil de usar desde el CI. SmartScreen sigue avisando hasta que el certificado gana reputación |
| Sin firma | Nada | El aviso se queda |

### Firma en macOS

Solo hay una vía: el Apple Developer Program, 99 $ al año. El flujo ya lee sus secretos y firma y notariza si están. **No se ha probado,** porque no hay cuenta.

### Actualizaciones

No hay nada hecho. Lo que hay que decidir:

- **Cuándo se busca.** Buscar al arrancar es una conexión a GitHub que el autor no ha pedido, en una app que promete funcionar sin conexión y sin telemetría. La propuesta es buscar solo cuando el autor lo pulse, con una opción, apagada al principio, para buscar al arrancar.
- **Quién guarda la clave.** Las actualizaciones de Tauri van firmadas con una clave propia, distinta de la firma del sistema. Quien tenga la clave privada puede publicar una actualización que todas las instalaciones aceptarán. Tiene que guardarla el autor.
- **Depende de la firma.** En macOS una actualización sin firmar no arranca, y en Windows vuelve a mostrar el aviso.

### Versión, nombre e identificador

La app sigue en la versión `0.0.0`, con nombre provisional y con el identificador `dev.inkwriter.desktop`. El identificador decide la carpeta de los datos: cambiarlo después de publicar deja atrás las novelas de quien ya la usa. Hay que fijar los tres antes de la primera etiqueta.

## Comprobado

- El instalador de Windows se construye en el equipo de desarrollo: 5,4 MB en modo de depuración, sin firmar.

## Sin comprobar

- **Instalar.** Nadie ha ejecutado el instalador ni ha abierto la app instalada.
- **El flujo de publicación.** No se ha lanzado: no hay ninguna etiqueta.
- **Los instaladores de macOS y Linux.** No se han construido.
- **La firma y la notarización de macOS.** Los nombres de los secretos son los de la documentación de Tauri.
- **Un lector de pantalla.** El repaso de accesibilidad es por pruebas y por código, no con NVDA ni VoiceOver.
