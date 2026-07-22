use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{ipc::Channel, Manager, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    api_key: String,
    base_url: String,
    provider_format: String,
    model: String,
    theme: String,
    max_context_size: usize,
    effort: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: String::new(),
            provider_format: "openai".into(),
            model: "gpt-5-mini".into(),
            theme: "system".into(),
            max_context_size: 128_000,
            effort: "medium".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolActivity {
    name: String,
    detail: Option<String>,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    id: String,
    role: String,
    content: String,
    created_at: String,
    #[serde(default)]
    tools: Vec<ToolActivity>,
    #[serde(default)]
    skills: Vec<String>,
    input_tokens: Option<usize>,
    output_tokens: Option<usize>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    #[serde(default)]
    messages: Vec<Message>,
    #[serde(default)]
    active_skills: Vec<String>,
    #[serde(default)]
    compacted_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Skill {
    name: String,
    description: String,
    body: String,
    enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum ChatEvent {
    ToolStarted {
        name: String,
        detail: Option<String>,
    },
    ToolFinished {
        name: String,
        detail: Option<String>,
        success: bool,
    },
    Skill {
        name: String,
    },
    Subagent {
        id: String,
        task: String,
        status: String,
    },
    Usage {
        input_tokens: usize,
        output_tokens: usize,
    },
    Done {
        message: Message,
    },
    Error {
        message: String,
    },
}

struct AppState {
    data_dir: PathBuf,
    lock: Mutex<()>,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}
fn config_path(state: &AppState) -> PathBuf {
    state.data_dir.join("config.toml")
}
fn sessions_path(state: &AppState) -> PathBuf {
    state.data_dir.join("sessions.json")
}
fn skills_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("skills")
}
fn safe_name(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn load_settings(state: &AppState) -> Result<Settings, String> {
    let path = config_path(state);
    if !path.exists() {
        return Ok(Settings::default());
    }
    toml::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn write_settings(state: &AppState, settings: &Settings) -> Result<(), String> {
    fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
    let value = toml::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(config_path(state), value).map_err(|e| e.to_string())
}

fn load_sessions(state: &AppState) -> Result<Vec<Session>, String> {
    let path = sessions_path(state);
    if !path.exists() {
        return Ok(vec![]);
    }
    serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn write_sessions(state: &AppState, sessions: &[Session]) -> Result<(), String> {
    fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
    fs::write(
        sessions_path(state),
        serde_json::to_string_pretty(sessions).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn parse_skill(raw: &str, folder: &str) -> Skill {
    let mut name = folder.to_string();
    let mut description = "(no description)".to_string();
    let mut body = raw.trim().to_string();
    if let Some(rest) = raw.strip_prefix("---\n") {
        if let Some((front, content)) = rest.split_once("\n---") {
            for line in front.lines() {
                if let Some((key, value)) = line.split_once(':') {
                    match key.trim() {
                        "name" => name = value.trim().into(),
                        "description" => description = value.trim().into(),
                        _ => {}
                    }
                }
            }
            body = content.trim_start_matches('-').trim().to_string();
        }
    }
    Skill {
        name,
        description,
        body,
        enabled: true,
    }
}

fn load_skills(state: &AppState) -> Result<Vec<Skill>, String> {
    let dir = skills_dir(state);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut skills = vec![];
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().join("SKILL.md");
        if path.exists() {
            let folder = entry.file_name().to_string_lossy().into_owned();
            skills.push(parse_skill(
                &fs::read_to_string(path).map_err(|e| e.to_string())?,
                &folder,
            ));
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

fn seed_skills(state: &AppState) -> Result<(), String> {
    let dir = skills_dir(state);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .next()
        .is_none()
    {
        let path = dir.join("calculator");
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        fs::write(path.join("SKILL.md"), "---\nname: calculator\ndescription: Use precise calculation for arithmetic tasks.\n---\n\n# Calculator\n\nUse the calculator tool for non-trivial arithmetic and show the result clearly.\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    load_settings(&state)
}

#[tauri::command]
fn save_settings(settings: Settings, state: State<AppState>) -> Result<Settings, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    write_settings(&state, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn list_sessions(state: State<AppState>) -> Result<Vec<Session>, String> {
    let mut sessions = load_sessions(&state)?;
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

#[tauri::command]
fn create_session(state: State<AppState>) -> Result<Session, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let mut sessions = load_sessions(&state)?;
    let timestamp = now();
    let session = Session {
        id: Uuid::new_v4().to_string(),
        title: "New session".into(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        messages: vec![],
        active_skills: load_skills(&state)?.into_iter().map(|s| s.name).collect(),
        compacted_tokens: 0,
    };
    sessions.push(session.clone());
    write_sessions(&state, &sessions)?;
    Ok(session)
}

#[tauri::command]
fn delete_session(id: String, state: State<AppState>) -> Result<(), String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let mut sessions = load_sessions(&state)?;
    sessions.retain(|s| s.id != id);
    write_sessions(&state, &sessions)
}

#[tauri::command]
fn clear_session(id: String, state: State<AppState>) -> Result<Session, String> {
    mutate_session(&state, &id, |session| {
        session.messages.clear();
        session.compacted_tokens = 0;
        session.title = "New session".into();
    })
}

#[tauri::command]
fn compact_session(id: String, state: State<AppState>) -> Result<Session, String> {
    mutate_session(&state, &id, |session| {
        if session.messages.len() <= 6 {
            return;
        }
        let split = session.messages.len() - 6;
        let old = session.messages.drain(..split).collect::<Vec<_>>();
        let summary = old
            .iter()
            .map(|m| {
                format!(
                    "{}: {}",
                    m.role,
                    m.content.chars().take(240).collect::<String>()
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        session.compacted_tokens += old.iter().map(|m| m.content.len() / 4).sum::<usize>();
        session.messages.insert(
            0,
            Message {
                id: Uuid::new_v4().to_string(),
                role: "assistant".into(),
                content: format!("Compacted context summary:\n\n{}", summary),
                created_at: now(),
                tools: vec![],
                skills: vec![],
                input_tokens: None,
                output_tokens: None,
                error: None,
            },
        );
    })
}

fn mutate_session<F: FnOnce(&mut Session)>(
    state: &AppState,
    id: &str,
    action: F,
) -> Result<Session, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let mut sessions = load_sessions(state)?;
    let session = sessions
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or("Session not found")?;
    action(session);
    session.updated_at = now();
    let result = session.clone();
    write_sessions(state, &sessions)?;
    Ok(result)
}

#[tauri::command]
fn list_skills(state: State<AppState>) -> Result<Vec<Skill>, String> {
    load_skills(&state)
}

#[tauri::command]
fn save_skill(skill: Skill, state: State<AppState>) -> Result<Skill, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let name = safe_name(&skill.name);
    if name.is_empty() {
        return Err("Skill name is required".into());
    }
    let dir = skills_dir(&state).join(&name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let saved = Skill {
        name,
        description: skill.description.trim().to_string(),
        body: skill.body.trim().to_string(),
        enabled: skill.enabled,
    };
    fs::write(
        dir.join("SKILL.md"),
        format!(
            "---\nname: {}\ndescription: {}\n---\n\n{}\n",
            saved.name, saved.description, saved.body
        ),
    )
    .map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
fn delete_skill(name: String, state: State<AppState>) -> Result<(), String> {
    let path = skills_dir(&state).join(safe_name(&name));
    if path.exists() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn toggle_skill(
    session_id: String,
    name: String,
    enabled: bool,
    state: State<AppState>,
) -> Result<Session, String> {
    mutate_session(&state, &session_id, |session| {
        session.active_skills.retain(|s| s != &name);
        if enabled {
            session.active_skills.push(name);
        }
    })
}

#[derive(Clone)]
struct ToolCall {
    id: String,
    name: String,
    arguments: Value,
}
struct ModelAnswer {
    text: String,
    tool_calls: Vec<ToolCall>,
    input_tokens: usize,
    output_tokens: usize,
}

fn tool_definitions(format: &str) -> Vec<Value> {
    let definitions = vec![
        (
            "calculator",
            "Evaluate an arithmetic expression precisely.",
            json!({"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"]}),
        ),
        (
            "current_time",
            "Get the current UTC date and time.",
            json!({"type":"object","properties":{}}),
        ),
        (
            "load_skill",
            "Load full instructions for an enabled skill before using it.",
            json!({"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}),
        ),
        (
            "spawn_subagent",
            "Delegate one focused task to a subagent and return its result.",
            json!({"type":"object","properties":{"task":{"type":"string"}},"required":["task"]}),
        ),
    ];
    definitions.into_iter().map(|(name, description, schema)| if format == "anthropic" { json!({"name":name,"description":description,"input_schema":schema}) } else { json!({"type":"function","function":{"name":name,"description":description,"parameters":schema}}) }).collect()
}

fn system_prompt(skills: &[Skill], active: &[String], effort: &str) -> String {
    let index = skills
        .iter()
        .filter(|s| active.contains(&s.name))
        .map(|s| format!("- {}: {}", s.name, s.description))
        .collect::<Vec<_>>()
        .join("\n");
    format!("You are Dagent, a concise desktop AI agent. Reasoning effort: {effort}. Use calculator for arithmetic, current_time for date/time, spawn_subagent for independently useful focused work, and load_skill before following a relevant skill. Enabled skills:\n{}", if index.is_empty() { "(none)" } else { &index })
}

fn endpoint(settings: &Settings) -> String {
    let base = if settings.base_url.trim().is_empty() {
        if settings.provider_format == "anthropic" {
            "https://api.anthropic.com"
        } else {
            "https://api.openai.com/v1"
        }
    } else {
        settings.base_url.trim_end_matches('/')
    };
    if settings.provider_format == "anthropic" {
        if base.ends_with("/v1/messages") {
            base.into()
        } else if base.ends_with("/v1") {
            format!("{base}/messages")
        } else {
            format!("{base}/v1/messages")
        }
    } else if base.ends_with("/chat/completions") {
        base.into()
    } else {
        format!("{base}/chat/completions")
    }
}

async fn call_model(
    settings: &Settings,
    system: &str,
    messages: &[Value],
    tools: bool,
) -> Result<ModelAnswer, String> {
    if settings.api_key.trim().is_empty() {
        return Err("API key is not configured. Open Settings to add one.".into());
    }
    let client = reqwest::Client::new();
    let mut request = client
        .post(endpoint(settings))
        .header("content-type", "application/json");
    let body = if settings.provider_format == "anthropic" {
        request = request
            .header("x-api-key", &settings.api_key)
            .header("anthropic-version", "2023-06-01");
        let mut body =
            json!({"model":settings.model,"max_tokens":4096,"system":system,"messages":messages});
        if tools {
            body["tools"] = Value::Array(tool_definitions("anthropic"));
        }
        body
    } else {
        request = request.bearer_auth(&settings.api_key);
        let mut all = vec![json!({"role":"system","content":system})];
        all.extend_from_slice(messages);
        let mut body =
            json!({"model":settings.model,"messages":all,"reasoning_effort":settings.effort});
        if tools {
            body["tools"] = Value::Array(tool_definitions("openai"));
        }
        body
    };
    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let value: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(value
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Provider request failed")
            .to_string());
    }
    if settings.provider_format == "anthropic" {
        let blocks = value["content"].as_array().cloned().unwrap_or_default();
        let text = blocks
            .iter()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("");
        let calls = blocks
            .iter()
            .filter(|b| b["type"] == "tool_use")
            .map(|b| ToolCall {
                id: b["id"].as_str().unwrap_or("tool").into(),
                name: b["name"].as_str().unwrap_or("").into(),
                arguments: b["input"].clone(),
            })
            .collect();
        Ok(ModelAnswer {
            text,
            tool_calls: calls,
            input_tokens: value["usage"]["input_tokens"].as_u64().unwrap_or(0) as usize,
            output_tokens: value["usage"]["output_tokens"].as_u64().unwrap_or(0) as usize,
        })
    } else {
        let message = &value["choices"][0]["message"];
        let text = message["content"].as_str().unwrap_or("").to_string();
        let calls = message["tool_calls"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|c| ToolCall {
                id: c["id"].as_str().unwrap_or("tool").into(),
                name: c["function"]["name"].as_str().unwrap_or("").into(),
                arguments: serde_json::from_str(
                    c["function"]["arguments"].as_str().unwrap_or("{}"),
                )
                .unwrap_or(json!({})),
            })
            .collect();
        Ok(ModelAnswer {
            text,
            tool_calls: calls,
            input_tokens: value["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as usize,
            output_tokens: value["usage"]["completion_tokens"].as_u64().unwrap_or(0) as usize,
        })
    }
}

async fn execute_tool(
    call: &ToolCall,
    skills: &[Skill],
    settings: &Settings,
    system: &str,
    channel: &Channel<ChatEvent>,
) -> Result<String, String> {
    match call.name.as_str() {
        "calculator" => {
            let expression = call.arguments["expression"]
                .as_str()
                .ok_or("expression is required")?;
            meval::eval_str(expression)
                .map(|v| v.to_string())
                .map_err(|e| e.to_string())
        }
        "current_time" => Ok(now()),
        "load_skill" => {
            let name = call.arguments["name"].as_str().ok_or("name is required")?;
            let skill = skills
                .iter()
                .find(|s| s.name == name)
                .ok_or("Skill not found or disabled")?;
            channel
                .send(ChatEvent::Skill { name: name.into() })
                .map_err(|e| e.to_string())?;
            Ok(skill.body.clone())
        }
        "spawn_subagent" => {
            let task = call.arguments["task"]
                .as_str()
                .ok_or("task is required")?
                .to_string();
            let id = Uuid::new_v4().to_string();
            channel
                .send(ChatEvent::Subagent {
                    id: id.clone(),
                    task: task.clone(),
                    status: "running".into(),
                })
                .map_err(|e| e.to_string())?;
            let prompt = vec![json!({"role":"user","content":task})];
            let result = call_model(settings, &format!("{system}\nYou are a focused subagent. Complete only the delegated task and return a concise result."), &prompt, false).await;
            channel
                .send(ChatEvent::Subagent {
                    id,
                    task,
                    status: if result.is_ok() {
                        "completed"
                    } else {
                        "failed"
                    }
                    .into(),
                })
                .map_err(|e| e.to_string())?;
            result.map(|r| r.text)
        }
        _ => Err(format!("Unknown tool {}", call.name)),
    }
}

fn conversation_messages(session: &Session, format: &str, max_context: usize) -> Vec<Value> {
    let mut budget = 0usize;
    let mut selected = vec![];
    for message in session.messages.iter().rev() {
        let estimate = message.content.len() / 4 + 8;
        if budget + estimate > max_context {
            break;
        }
        budget += estimate;
        selected.push(message);
    }
    selected.reverse();
    selected
        .into_iter()
        .map(|m| {
            if format == "anthropic" {
                json!({"role":m.role,"content":[{"type":"text","text":m.content}]})
            } else {
                json!({"role":m.role,"content":m.content})
            }
        })
        .collect()
}

#[tauri::command]
async fn chat(
    session_id: String,
    message: String,
    on_event: Channel<ChatEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let settings = load_settings(&state)?;
    let all_skills = load_skills(&state)?;
    let mut sessions = load_sessions(&state)?;
    let index = sessions
        .iter()
        .position(|s| s.id == session_id)
        .ok_or("Session not found")?;
    if sessions[index].messages.is_empty() {
        sessions[index].title = message
            .split_whitespace()
            .take(7)
            .collect::<Vec<_>>()
            .join(" ");
    }
    sessions[index].messages.push(Message {
        id: Uuid::new_v4().to_string(),
        role: "user".into(),
        content: message,
        created_at: now(),
        tools: vec![],
        skills: vec![],
        input_tokens: None,
        output_tokens: None,
        error: None,
    });
    sessions[index].updated_at = now();
    write_sessions(&state, &sessions)?;
    let enabled: Vec<Skill> = all_skills
        .into_iter()
        .filter(|s| sessions[index].active_skills.contains(&s.name))
        .collect();
    let system = system_prompt(&enabled, &sessions[index].active_skills, &settings.effort);
    let mut transcript = conversation_messages(
        &sessions[index],
        &settings.provider_format,
        settings.max_context_size,
    );
    let mut final_text = String::new();
    let mut activities = vec![];
    let mut used_skills = vec![];
    let mut total_in = 0;
    let mut total_out = 0;
    let outcome: Result<(), String> = async {
        for _ in 0..6 {
            let answer = call_model(&settings, &system, &transcript, true).await?; total_in += answer.input_tokens; total_out += answer.output_tokens;
            if answer.tool_calls.is_empty() { final_text.push_str(&answer.text); break; }
            if settings.provider_format == "anthropic" {
                let mut blocks = vec![]; if !answer.text.is_empty() { blocks.push(json!({"type":"text","text":answer.text})); } for call in &answer.tool_calls { blocks.push(json!({"type":"tool_use","id":call.id,"name":call.name,"input":call.arguments})); } transcript.push(json!({"role":"assistant","content":blocks}));
            } else {
                transcript.push(json!({"role":"assistant","content":answer.text,"tool_calls":answer.tool_calls.iter().map(|c| json!({"id":c.id,"type":"function","function":{"name":c.name,"arguments":c.arguments.to_string()}})).collect::<Vec<_>>() }));
            }
            let mut anthropic_results = vec![];
            for call in answer.tool_calls {
                let detail = call.arguments.as_object().and_then(|o| o.values().next()).and_then(Value::as_str).map(|s| s.chars().take(80).collect());
                on_event.send(ChatEvent::ToolStarted { name: call.name.clone(), detail: detail.clone() }).map_err(|e| e.to_string())?;
                if call.name == "load_skill" { if let Some(name) = call.arguments["name"].as_str() { used_skills.push(name.to_string()); } }
                let result = execute_tool(&call, &enabled, &settings, &system, &on_event).await; let success = result.is_ok(); let content = result.unwrap_or_else(|e| format!("Error: {e}"));
                activities.push(ToolActivity { name: call.name.clone(), detail: detail.clone(), status: if success { "completed" } else { "failed" }.into() });
                on_event.send(ChatEvent::ToolFinished { name: call.name.clone(), detail, success }).map_err(|e| e.to_string())?;
                if settings.provider_format == "anthropic" { anthropic_results.push(json!({"type":"tool_result","tool_use_id":call.id,"content":content})); } else { transcript.push(json!({"role":"tool","tool_call_id":call.id,"content":content})); }
            }
            if settings.provider_format == "anthropic" { transcript.push(json!({"role":"user","content":anthropic_results})); }
        }
        Ok(())
    }.await;
    if let Err(error) = outcome {
        let _ = on_event.send(ChatEvent::Error {
            message: error.clone(),
        });
        return Err(error);
    }
    let _ = on_event.send(ChatEvent::Usage {
        input_tokens: total_in,
        output_tokens: total_out,
    });
    used_skills.sort();
    used_skills.dedup();
    let assistant = Message {
        id: Uuid::new_v4().to_string(),
        role: "assistant".into(),
        content: final_text,
        created_at: now(),
        tools: activities,
        skills: used_skills,
        input_tokens: Some(total_in),
        output_tokens: Some(total_out),
        error: None,
    };
    sessions = load_sessions(&state)?;
    let session = sessions
        .iter_mut()
        .find(|s| s.id == session_id)
        .ok_or("Session not found")?;
    session.messages.push(assistant.clone());
    session.updated_at = now();
    write_sessions(&state, &sessions)?;
    on_event
        .send(ChatEvent::Done { message: assistant })
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
            fs::create_dir_all(&data_dir)?;
            let state = AppState {
                data_dir,
                lock: Mutex::new(()),
            };
            seed_skills(&state).map_err(|e| e.to_string())?;
            if !config_path(&state).exists() {
                write_settings(&state, &Settings::default()).map_err(|e| e.to_string())?;
            }
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            list_sessions,
            create_session,
            delete_session,
            clear_session,
            compact_session,
            list_skills,
            save_skill,
            delete_skill,
            toggle_skill,
            chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dagent");
}
