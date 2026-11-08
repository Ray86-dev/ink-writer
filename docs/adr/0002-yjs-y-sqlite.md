# 0002 · Yjs para la prosa, SQLite para la estructura

**Estado:** aceptada.

**Contexto.** Se quiere sin conexión y sincronización. Grok propuso Turso, pero su resolución por defecto es «gana el último push por fila»: si una escena es una fila, se puede perder prosa.

**Decisión.** Un documento Yjs por escena, con TipTap. SQLite para estructura, fichas y hechos, donde last-write-wins es aceptable.

**Alternativas.** Loro encaja mejor con Rust, pero su ecosistema de editores era menos maduro. Automerge tiene menos integraciones de editor.

**Consecuencias.** Las notas y marcas se anclan con posiciones relativas de Yjs. Hacen falta snapshots por escena.
