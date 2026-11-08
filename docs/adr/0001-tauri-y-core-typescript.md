# 0001 · Shell Tauri fino y core TypeScript

**Estado:** aceptada.

**Contexto.** Se busca una app ligera y una futura versión de navegador con el mismo código.

**Decisión.** Tauri 2 con Rust solo para archivos, SQLite, OAuth, tokens y HTTP de IA. El dominio va en un core TypeScript.

**Consecuencias.** La ligereza viene de no empaquetar Chromium, sin necesidad de escribir el dominio en Rust. Los comandos Rust no existen en el navegador, de modo que el core depende de interfaces. Cada sistema usa su WebView (WebView2, WKWebView, WebKitGTK), lo que obliga a probar en los tres.
