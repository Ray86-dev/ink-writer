# 0005 · Sincronización por relay cifrado

**Estado:** propuesta. Se implementa después de la primera versión.

**Decisión.** Un relay que reenvía updates Yjs cifrados de extremo a extremo, autoalojable y MIT. El servidor no puede leer el texto.

**Consecuencias.** La clave vive en los dispositivos del usuario y hay que diseñar su recuperación. Si se ofrece un servicio de pago, hay que consultar antes a OpenAI, porque las apps de pago o alojadas no entran en la vía abierta y no está claro cómo se trata un cliente MIT con servicio de pago aparte.
