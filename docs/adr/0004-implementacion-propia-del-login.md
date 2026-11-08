# 0004 · Implementación propia del login con ChatGPT

**Estado:** aceptada.

**Contexto.** OpenAI publica `sign-in-with-chatgpt-devkit`, con `@siwc/local` y `@siwc/react`. Su README indica que el código de OpenAI está bajo la «Sign-in with ChatGPT DevKit Noncommercial License v1.0». Además, `@siwc/local` se ejecuta en Node.js, que Tauri no incluye.

**Decisión.** Implementar el flujo en Rust a partir de la documentación pública. No copiar ni vendorizar código del DevKit.

**Consecuencias.** Hay más trabajo, pero el proyecto sigue siendo MIT y los tokens quedan fuera del WebView. La marca del botón sigue las directrices de OpenAI.
