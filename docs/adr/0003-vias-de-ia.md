# 0003 · Vías de conexión de IA

**Estado:** modificada por la [0008](0008-resultado-m0-vias-de-ia.md): OpenRouter es la vía principal provisional hasta verificar ChatGPT.

**Contexto.** El público no sabe qué es una API key. Los créditos incluidos obligarían a pagar inferencia y a pasar los manuscritos por un servidor propio.

**Decisión.**
- Principal en escritorio: «Continue with ChatGPT», abierto a proyectos open source y locales sin client secret.
- OpenRouter por OAuth PKCE, también para navegador.
- Ollama o LM Studio en local.
- Claves de API como opción avanzada.
- Sin créditos incluidos en esta fase.

**Claude.** Anthropic no permite ofrecer el login de Claude.ai en apps de terceros, por lo que solo se admite con clave de API u OpenRouter. Hermes lo consigue enrutando como Claude Code; no se copia, porque pone en riesgo las cuentas de los usuarios.

**Consecuencias.** La vía ChatGPT está en preview: sin `temperature` ni `max_output_tokens`, y con cortes a mitad de respuesta. En Plus, el límite de cinco horas se comparte entre apps. El análisis por escena y la caché son obligatorios.
