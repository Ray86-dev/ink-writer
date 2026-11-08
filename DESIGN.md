# Diseño · Tinta viva

Referencia ejecutable: abre `docs/design/ink-demo/index.html`. Su código está en `docs/design/ink-demo/src/`.

## Idea

La novela es tinta suspendida en agua. Lo que escribes se expande y conecta. Fondo claro, tinta oscura y pigmentos que significan algo.

El espectáculo vive en el **Dashboard**. El **editor** es silencioso.

## Tokens

En `docs/design/tokens.css`.

| Token | Valor | Uso |
|---|---|---|
| `--paper` | `#F6F6F2` | Fondo |
| `--sheet` | `#FFFFFF` | Tarjetas y fichas |
| `--ink` | `#12141C` | Texto y tinta |
| `--ink-2` | `#4C5462` | Texto secundario |
| `--line` | `#DADCD6` | Bordes |
| `--link` | `#1B46C8` | Hipervínculos |
| `--rust` | `#A8430A` | Por resolver y pistas |
| `--rust-wash` | `#FCEBD9` | Fondo de pistas |

Pigmentos de la red: capítulos, tinta negra `#12141C`; personajes, azul `#1A2A86`; lugares, verde azulado `#0F5C60`; lore, ciruela `#4B2A5E`; contradicción abierta, óxido `#B4490B`.

## Tipografía

- **Literata** para prosa y titulares. Variable y pensada para leer en pantalla.
- **Instrument Sans** para interfaz.
- Ambas con licencia OFL, **incluidas en la app**, porque debe funcionar sin conexión.

El hipervínculo es un motivo visual: azul y subrayado fino. En modo zen, color del texto y subrayado tenue.

## Movimiento

| Momento | Efecto | Técnica |
|---|---|---|
| Abrir el proyecto | La tinta brota del capítulo 1 y recorre la red | three.js, shader |
| Escena nueva | Nodo y enlaces nuevos se expanden | three.js, shader |
| Pasar por un nodo | Se oscurece y se atenúa lo no relacionado | three.js, shader |
| Abrir una ficha | La tinta inunda desde el nodo y se retira | three.js, y `<dialog>` |
| Tarjetas | Entrada escalonada, ligera elevación | CSS |
| Cambios de pantalla | La tarjeta se convierte en ficha | View Transitions o Motion |
| Editor | Nada mientras se teclea | Sin WebGL |

Curva principal: `cubic-bezier(.2,.8,.2,1)`. Duraciones de 200 a 600 ms. La revelación inicial, unos 3 segundos y sin bloquear la interacción.

## Reglas de three.js

Implementación: three.js proyecta los nodos en 3D y un shader de pantalla completa pinta la tinta con deformación de dominio. Las etiquetas son botones DOM.

- Cargar three.js **de forma diferida y solo en el Dashboard**.
- **Pausar** al ocultar la ventana o al salir del área visible.
- Renderizar a resolución reducida, porque la tinta es suave. Bajarla más si caen los fotogramas.
- **Reducir movimiento:** un fotograma estático.
- **Sin WebGL:** se ocultan el lienzo y las etiquetas, y quedan las tarjetas.
- El coste de los uniformes crece con cada nodo y enlace. La demo admite 16 nodos y 24 enlaces. Una novela real tiene más, así que en M8 hay que agrupar por tipo o capítulo, mostrar solo los nodos principales y ampliar con zoom, o pasar los datos a una textura.
- Comprobar pronto en WebKitGTK (Linux), donde WebGL es menos fiable, y en un portátil modesto.

## Accesibilidad

- Cada nodo es un botón con nombre accesible.
- Todo lo que hay en la red existe también en las tarjetas.
- Contraste AA. Objetivos táctiles de 44 px, salvo enlaces dentro de un texto.
- Los pigmentos no son la única señal: las contradicciones también se indican con texto.

## Compañera

Una gota de tinta con dos ojos, en modo de pistas Compañera. Es propia: no usar Clippy ni ningún personaje con derechos.

## Editor

Columna centrada de unos 660 px, Literata a 20 px e interlineado 1,7. Sin barras visibles mientras se escribe. Los paneles aparecen solo en Ver enlaces y pistas.
