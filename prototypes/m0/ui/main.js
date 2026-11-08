// No build step: this is a throwaway test bench, not the product's UI.
const { invoke, Channel } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);

function setStatus(el, text, tone) {
  el.textContent = text;
  el.classList.toggle("good", tone === "good");
  el.classList.toggle("bad", tone === "bad");
}

function fillSelect(select, items, value, label) {
  const previous = select.value;
  select.replaceChildren(
    ...items.map((item) => {
      const option = document.createElement("option");
      option.value = value(item);
      option.textContent = label(item);
      return option;
    }),
  );
  if (items.some((item) => value(item) === previous)) select.value = previous;
}

async function refreshChatgpt() {
  const status = await invoke("status");
  const el = $("chatgpt-status");
  $("chatgpt-plan").hidden = !status.chatgpt_plan_enabled;
  if (!status.chatgpt_signed_in) {
    setStatus(el, status.chatgpt_registered ? "Registrada, sin sesión." : "Sin sesión.");
    $("chatgpt-model").replaceChildren();
  } else if (!status.chatgpt_plan_enabled) {
    // Rule 10: this state offers another route, it never switches by itself.
    setStatus(el, "Sesión iniciada, pero sin permiso para usar el plan. Elige otra vía.", "bad");
    $("chatgpt-model").replaceChildren();
  } else {
    setStatus(el, `Sesión iniciada. El token caduca en ${Math.round(status.chatgpt_expires_in_s / 60)} min.`, "good");
    try {
      const models = await invoke("chatgpt_models");
      fillSelect($("chatgpt-model"), models, (m) => m.slug, (m) => m.display_name);
    } catch (e) {
      setStatus(el, `No se pudieron listar los modelos: ${e}`, "bad");
    }
  }
  setStatus(
    $("openrouter-status"),
    status.openrouter_connected ? "Conectado." : "Sin conectar.",
    status.openrouter_connected ? "good" : undefined,
  );
}

async function refreshOpenrouterModels() {
  try {
    const models = await invoke("openrouter_models");
    $("openrouter-models").replaceChildren(
      ...models
        .filter((m) => m.structured_outputs)
        .map((m) => {
          const option = document.createElement("option");
          option.value = m.id;
          option.label = m.name;
          return option;
        }),
    );
  } catch (e) {
    setStatus($("openrouter-status"), `No se pudieron listar los modelos: ${e}`, "bad");
  }
}

async function refreshOllama() {
  const el = $("ollama-status");
  try {
    const server = await invoke("ollama_server");
    fillSelect($("ollama-model"), server.models, (m) => m.name, (m) => m.name);
    setStatus(
      el,
      server.models.length
        ? `Ollama ${server.version ?? ""} con ${server.models.length} modelo(s).`
        : "Ollama responde, pero no tiene modelos descargados.",
      server.models.length ? "good" : undefined,
    );
  } catch {
    $("ollama-model").replaceChildren();
    setStatus(el, "No responde: no está instalado o no está en marcha.");
  }
}

function addResult(r) {
  const row = document.createElement("tr");
  const cells = [r.probe, r.status, r.http_status ?? "", r.error_code ?? "", r.error_param ?? ""];
  for (const value of cells) {
    const td = document.createElement("td");
    td.textContent = value;
    row.append(td);
  }
  row.children[1].className = `s-${r.status}`;
  $("results").append(row);
}

/** Runs an action with its button disabled, and shows any error in `statusEl`. */
async function busy(button, statusEl, action) {
  button.disabled = true;
  try {
    await action();
  } catch (e) {
    setStatus(statusEl, String(e), "bad");
  } finally {
    button.disabled = false;
  }
}

function showLogin(statusEl, { result, report_path: path }) {
  $("results").replaceChildren();
  addResult(result);
  setStatus($("report-path"), path ? `Informe: ${path}` : "No se pudo escribir el informe.");
  if (result.status !== "ok") {
    // The docs' recovery for this exact case: a fresh attempt with the issued ID.
    const retry =
      result.error_code === "invalid_grant" ? " Vuelve a pulsar «Continue with ChatGPT»: se reintenta con el ID ya emitido." : "";
    setStatus(statusEl, `Falló: ${result.error_code ?? ""} ${result.error_message ?? "falta el permiso del plan"}${retry}`, "bad");
  }
}

$("chatgpt-login").addEventListener("click", () => {
  const button = $("chatgpt-login");
  const el = $("chatgpt-status");
  // Not `busy`: the button stays live so an abandoned sign-in can be restarted.
  setStatus(el, "Continúa en el navegador…");
  const raw = $("chatgpt-port").value.trim();
  invoke("chatgpt_login", { port: raw ? Number(raw) : null })
    .then(async (out) => {
      await refreshChatgpt();
      showLogin(el, out);
    })
    .catch((e) => {
      if (!String(e).includes("canceló")) setStatus(el, String(e), "bad");
    });
  button.blur();
});

$("chatgpt-logout").addEventListener("click", () =>
  busy($("chatgpt-logout"), $("chatgpt-status"), async () => {
    await invoke("chatgpt_logout");
    await refreshChatgpt();
  }),
);

$("manage-usage").addEventListener("click", () => invoke("open_manage_usage"));

$("openrouter-login").addEventListener("click", () => {
  const el = $("openrouter-status");
  setStatus(el, "Continúa en el navegador…");
  invoke("openrouter_login")
    .then(async (out) => {
      await refreshChatgpt();
      showLogin(el, out);
    })
    .catch((e) => {
      if (!String(e).includes("canceló")) setStatus(el, String(e), "bad");
    });
});

$("ollama-refresh").addEventListener("click", refreshOllama);

for (const button of document.querySelectorAll("[data-rewrite]")) {
  button.addEventListener("click", () =>
    busy(button, $("draft-result"), async () => {
      const onDelta = new Channel();
      $("draft").textContent = "";
      setStatus($("draft-result"), "Generando…");
      onDelta.onmessage = (text) => $("draft").append(text);
      const summary = await invoke("rewrite", {
        provider: button.dataset.rewrite,
        model: $(button.dataset.modelFrom).value,
        onDelta,
      });
      const ok = summary.terminal === "completed";
      const detail = summary.error ? ` ${summary.error.code ?? ""} ${summary.error.message ?? ""}` : "";
      setStatus(
        $("draft-result"),
        `${summary.terminal}: ${summary.output_chars} caracteres, primer texto a ${summary.first_delta_ms ?? "?"} ms, total ${summary.total_ms} ms.${detail}`,
        ok ? "good" : "bad",
      );
    }),
  );
}

for (const button of document.querySelectorAll("[data-probes]")) {
  button.addEventListener("click", () =>
    busy(button, $("report-path"), async () => {
      const onResult = new Channel();
      $("results").replaceChildren();
      setStatus($("report-path"), "Ejecutando…");
      onResult.onmessage = addResult;
      const path = await invoke("run_probes", {
        provider: button.dataset.probes,
        model: $(button.dataset.modelFrom).value,
        withSearch: button.dataset.probes === "openrouter" && $("openrouter-search").checked,
        onResult,
      });
      setStatus($("report-path"), path ? `Informe: ${path}` : "No se pudo escribir el informe.");
    }),
  );
}

refreshChatgpt();
refreshOpenrouterModels();
refreshOllama();
