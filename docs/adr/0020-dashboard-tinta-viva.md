# 0020 · Dashboard Tinta viva

**Estado:** aceptada. Concreta la 0007 y lo que `DESIGN.md` dejaba abierto sobre el tamaño de la red.

**Contexto.** M8 pedía llevar la demo de `docs/design/ink-demo/` a la app, con datos reales, y cuatro condiciones de salida: fluido en un portátil modesto, comprobado en WebKitGTK, pausa al ocultarse y alternativa sin WebGL. La demo pinta 16 nodos y 24 enlaces fijos, y su coste crece con cada uno. Una novela real tiene más.

## Decisión

### Dónde está

El Dashboard es la pantalla de inicio de una novela: al abrirla se llega a él. Una novela recién creada va directa a su página en blanco, porque aún no hay nada que mostrar. Desde el texto se vuelve con el botón «Inicio».

Tiene tres partes, como la demo:

| Parte | Qué muestra | De dónde sale |
|---|---|---|
| Red de tinta | Capítulos, personajes, lugares y lore, y lo que los une | Las fichas |
| Siguiente paso | Una sola tarea, con su motivo | Las pistas, las mismas del panel |
| Tarjetas | Las diez de `SPEC.md` §3.1, con total, novedades y enlaces | Las fichas y la documentación |

Nada del Dashboard pide nada a un modelo.

### La red muestra solo lo principal

De las tres salidas que apuntaba `DESIGN.md` (agrupar, mostrar solo lo principal o pasar los datos a una textura) se elige la segunda: **16 nodos y 24 enlaces como mucho**, los mismos de la demo, que es con lo que se ha visto ir fluido.

- **Si la novela cabe entera,** sale entera.
- **Si no cabe,** los capítulos se quedan con seis sitios al menos y son los últimos, que es donde escribe el autor. El resto es para las fichas con algo por resolver y, después, las que aparecen en más escenas.
- **Los enlaces,** por este orden hasta llenar el cupo: la línea de capítulos, las relaciones que dice el texto, los lugares dentro de lugares y el primer capítulo en que aparece cada ficha.
- **La pantalla lo dice** cuando la red no lo muestra todo. Lo que no está en la red está en las tarjetas.

La disposición se calcula en el core, sin azar: la misma novela da siempre el mismo dibujo. Los capítulos van en línea y las fichas se colocan alrededor de los suyos.

Un capítulo conserva su tinta negra aunque tenga algo por resolver. El óxido marca la ficha a la que afecta.

### three.js, solo aquí y solo para pintar

- **Carga diferida.** three.js es un trozo aparte de unos 525 kB que solo se pide al abrir el Dashboard, y solo si el WebView tiene WebGL.
- **Lo que no es pintar no depende de three.js.** Dónde está cada nodo, cómo crece la tinta y cuándo se dibuja lo decide un módulo propio, que se prueba sin WebGL.
- **Nada pinta mientras se escribe** (regla 12). Al ir al texto o a una ficha, el Dashboard se desmonta, el bucle se para y el contexto de WebGL se suelta.

### Las cuatro condiciones de salida

| Condición | Cómo se cumple |
|---|---|
| Pausa al ocultarse | El bucle se para si la ventana se oculta o si la red sale de la vista, y sigue al volver |
| Sin WebGL | Se ocultan el lienzo y los nombres de los nodos, y quedan el siguiente paso y las tarjetas. Lo mismo si el shader no compila o si el sistema retira el contexto más tarde |
| Reducir movimiento | Un fotograma quieto, que solo se repinta si algo cambia. Las tarjetas entran sin animación |
| Máquina lenta | Se pinta al 85 % de los píxeles. Si la media pasa de 26 ms por fotograma, baja de 15 en 15 hasta el 45 % |

### Accesibilidad

- Cada nodo es un botón con nombre: qué ficha abre, de qué tipo es y si tiene algo por resolver.
- Todo lo que hay en la red está también en las tarjetas.
- Lo que está por resolver se dice con palabras en la tarjeta Verificación de datos, no solo con el color.

### Novedades

Cada tarjeta marca lo que es nuevo desde la última vez que el autor miró el Dashboard. Se recuerda en el almacenamiento del WebView, por novela. Es una comodidad: si falta, no se marca nada, y la primera vez tampoco.

### Ayuda

La tarjeta Ayuda es la de `SPEC.md` §3.10: lleva a regular las pistas y explica en dos párrafos por qué la IA no escribe por el autor y cómo se crean las fichas. No hay pantalla de ayuda aparte.

## Lo que no se ha hecho

- **La tinta que se retira al cerrar una ficha.** Al tocar un nodo la tinta inunda la pantalla y se abre la ficha, pero la ficha es otra pantalla y al volver la red brota de nuevo.
- **La tarjeta que se convierte en ficha** (View Transitions). El cambio de pantalla es directo.
- **Ampliar la red con zoom** para ver lo que queda fuera.
- **«Datos reales» en Verificación de datos.** Sigue pendiente desde M7: la tarjeta solo cuenta la coherencia interna, y lo dice.
- **La duración de cada tarea** (de 5 a 20 minutos en `SPEC.md` §3.5). Las tareas no la llevan.
- **Las novedades no viajan** con la novela a otro equipo.

## Dependencias

`three` 0.187.0, con licencia MIT. Sus tipos, `@types/three`, solo para compilar.

## Pruebas

- **Core:** qué entra en la red y qué queda fuera en una novela larga, los enlaces, el orden en que llega la tinta y que el dibujo no cambia de una vez a otra.
- **Motor de la red,** con un pintor sustituto: la tinta sale del primer capítulo y llega a todo en unos tres segundos, se para con la ventana oculta, un solo fotograma con movimiento reducido, un nodo nuevo crece sin reiniciar la red, la resolución baja si la máquina no llega y al cerrar se suelta todo.
- **Pantalla:** la novela abre en el Dashboard, las tarjetas y sus totales, el siguiente paso con su motivo, los niveles de pistas, ir al texto y volver, abrir una ficha y volver, la red como botones con nombre, sin WebGL quedan las tarjetas, nada pinta al ir al texto y las novedades.
- **Prueba de humo, en la app real:** three.js carga, el shader compila y se pintan fotogramas. Donde no hay WebGL, la prueba exige que la página lo diga y siga.

## Comprobado

- **En Windows, con WebView2,** el 15 de noviembre de 2026: la app real abre el Dashboard con una novela de muestra y la red se ve como la demo, también en una ventana estrecha, con la red debajo del siguiente paso. En la prueba de humo pintó 50 fotogramas por segundo sin bajar la resolución.

## Sin comprobar

- **Un portátil modesto.** Solo se ha visto en el equipo de desarrollo. La bajada de resolución está probada con un reloj sustituto, no con una máquina lenta de verdad.
- **WebKitGTK y macOS a la vista.** El CI ejecuta la prueba de humo en los tres sistemas y dice en su registro si pintó con WebGL o si se quedó con las tarjetas. Nadie ha mirado la pantalla en Linux ni en macOS.
- **Movimiento reducido** en la app real. Está probado con sustitutos.
- **El consumo de batería** con el Dashboard abierto mucho tiempo.
