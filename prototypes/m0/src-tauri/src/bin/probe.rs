//! Same checks as the GUI, from a terminal. Prints metadata and fixture-based
//! drafts only; it has no command that prints a token.

use std::io::Write;

use m0::chatgpt::{api, auth};
use m0::ctx::Ctx;
use m0::probes::{self, Provider};
use m0::report::ProbeResult;
use m0::{ollama, openrouter};
use serde_json::json;

const USAGE: &str = "\
usage: probe <command>

  status                   selftest
  chatgpt login [port]     chatgpt models      chatgpt logout
  chatgpt run <model>      chatgpt rewrite <model>
  openrouter login         openrouter models [filter]    openrouter key
  openrouter run <model> [--with-search]   (web search is paid)
  openrouter rewrite <model>
  ollama models            ollama run [model]  ollama rewrite <model>
";

fn open_system_browser(url: &str) -> Result<(), String> {
    open::that_detached(url).map_err(|e| e.to_string())
}

fn print_result(r: &ProbeResult) {
    println!(
        "{:<30} {:<9} http={:<5} code={}",
        r.probe,
        serde_json::to_value(r.status).unwrap_or_default().as_str().unwrap_or(""),
        r.http_status.map(|s| s.to_string()).unwrap_or_else(|| "-".into()),
        r.error_code.as_deref().unwrap_or("-"),
    );
}

fn print_login(result: &ProbeResult, path: Option<std::path::PathBuf>) {
    print_result(result);
    println!("{}", serde_json::to_string_pretty(result).unwrap_or_default());
    print_path(path);
}

fn print_path(path: Option<std::path::PathBuf>) {
    match path {
        Some(p) => println!("report: {}", p.display()),
        None => println!("report: not written"),
    }
}

async fn run_rewrite(ctx: &Ctx, provider: Provider, model: &str) -> Result<(), String> {
    let mut show = |d: &str| {
        print!("{d}");
        let _ = std::io::stdout().flush();
    };
    let o = probes::rewrite(ctx, provider, model, &mut show).await?;
    println!("\n---");
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "metrics": o.metrics(),
            "http_status": o.http_status,
            "error": o.error,
            "request_id": o.request_id,
        }))
        .unwrap_or_default()
    );
    Ok(())
}

async fn dispatch(ctx: &Ctx, args: &[&str]) -> Result<(), String> {
    match args {
        ["status"] => {
            let state = ctx.store.state()?;
            let vault = ctx.store.vault()?;
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "data_dir": ctx.store.dir().display().to_string(),
                    "chatgpt_registered": state.chatgpt_client_id.is_some(),
                    "chatgpt_signed_in": vault.chatgpt.is_some(),
                    "chatgpt_plan_enabled": vault.chatgpt.as_ref().is_some_and(|t| auth::scope_grants_plan(&t.scope)),
                    "openrouter_connected": vault.openrouter_key.is_some(),
                }))
                .unwrap_or_default()
            );
        }
        // Uses the real OS credential store, so a failure shows up before
        // anyone goes through a browser sign-in for nothing.
        ["selftest"] => {
            ctx.store.update_vault(|_| {})?;
            ctx.store.vault()?;
            println!("vault ok: {}", ctx.store.dir().display());
        }
        ["chatgpt", "login", rest @ ..] => {
            let port = rest.first().map(|p| p.parse::<u16>()).transpose().map_err(|e| e.to_string())?;
            println!("Abriendo el navegador. Esperando la respuesta (máximo 5 minutos)...");
            let (result, path) = probes::chatgpt_login(ctx, port, open_system_browser).await;
            print_login(&result, path);
        }
        ["chatgpt", "logout"] => {
            auth::sign_out(ctx)
                .await
                .map_err(|e| format!("revocation not confirmed: {:?} {:?}", e.http_status, e.code))?;
            println!("Sesión cerrada y tokens borrados.");
        }
        ["chatgpt", "models"] => {
            let token = auth::access_token(ctx).await.map_err(|e| e.to_string())?;
            let list = api::list_models(ctx, &token)
                .await
                .map_err(|e| format!("{:?} {:?}", e.http_status, e.error))?;
            for m in &list.models {
                println!("{:<30} {}", m.slug, m.display_name);
            }
            println!("({} of {} visible)", list.models.len(), list.total_before_filter);
        }
        ["chatgpt", "run", model] => {
            let (_, path) = probes::run_chatgpt(ctx, model, &mut print_result).await;
            print_path(path);
        }
        ["chatgpt", "rewrite", model] => run_rewrite(ctx, Provider::Chatgpt, model).await?,
        ["openrouter", "login"] => {
            println!("Abriendo el navegador. Esperando la respuesta (máximo 5 minutos)...");
            let (result, path) = probes::openrouter_login(ctx, open_system_browser).await;
            print_login(&result, path);
        }
        ["openrouter", "models", rest @ ..] => {
            let filter = rest.first().copied().unwrap_or("");
            for m in openrouter::list_models(ctx).await? {
                if m.id.contains(filter) {
                    println!(
                        "{:<50} structured={:<5} tools={:<5} in={} out={}",
                        m.id,
                        m.structured_outputs,
                        m.tools,
                        m.price_prompt.as_deref().unwrap_or("-"),
                        m.price_completion.as_deref().unwrap_or("-"),
                    );
                }
            }
        }
        ["openrouter", "key"] => {
            println!(
                "{}",
                serde_json::to_string_pretty(&openrouter::key_status(ctx).await?).unwrap_or_default()
            );
        }
        ["openrouter", "run", model, rest @ ..] => {
            let with_search = rest.contains(&"--with-search");
            let (_, path) = probes::run_openrouter(ctx, model, with_search, &mut print_result).await;
            print_path(path);
        }
        ["openrouter", "rewrite", model] => run_rewrite(ctx, Provider::Openrouter, model).await?,
        ["ollama", "models"] => {
            let s = ollama::server(ctx).await?;
            println!("version: {:?}", s.version);
            for m in s.models {
                println!("{:<40} {:?} {:?}", m.name, m.family, m.quantization);
            }
        }
        ["ollama", "run", rest @ ..] => {
            let (_, path) = probes::run_ollama(ctx, rest.first().copied(), &mut print_result).await;
            print_path(path);
        }
        ["ollama", "rewrite", model] => run_rewrite(ctx, Provider::Ollama, model).await?,
        _ => return Err(USAGE.to_string()),
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let ctx = match Ctx::production() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    if let Err(e) = dispatch(&ctx, &refs).await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
