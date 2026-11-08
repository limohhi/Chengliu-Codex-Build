use std::sync::Mutex;
use std::time::Instant;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

const BASE: &str = "https://api.chengliu-api.top/desktop/pairings";
const PORTAL: &str = "https://api.chengliu-api.top/portal/";
const LIFETIME: u64 = 600;
const RESPONSE_LIMIT: usize = 64 * 1024;

#[derive(Default)]
pub struct DesktopPairingState(Mutex<Option<Session>>);
struct Session { verifier: String, device_code: String, started: Instant, exchanging: bool }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
pub struct PairStart { user_code: String, verification_uri: String, interval: u64 }
#[derive(Deserialize)] struct StartResponse { user_code: String, device_code: String, #[serde(default, alias="verification_uri_complete")] verification_uri: Option<String>, interval: Option<u64> }
#[derive(Deserialize)] struct ExchangeResponse { status: String, api_key: Option<String>, group_name: Option<String>, key_id: Option<u64> }
#[derive(Deserialize)] struct ErrorResponse { error: Option<String> }
#[derive(Serialize)] #[serde(rename_all="camelCase")] pub struct PairPoll { status: String }

pub fn challenge(verifier: &str) -> String { URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) }
fn pair_error() -> String { "配对请求失败，请重试。".into() }
fn client() -> Result<reqwest::Client, String> { reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| pair_error()) }
async fn bounded_json<T: for<'de> Deserialize<'de>>(response: reqwest::Response) -> Result<T, String> {
    if response.content_length().is_some_and(|n| n > RESPONSE_LIMIT as u64) { return Err(pair_error()); }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| pair_error())? {
        if chunk.len() > RESPONSE_LIMIT.saturating_sub(bytes.len()) { return Err(pair_error()); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| pair_error())
}

#[tauri::command]
pub async fn desktop_pair_start(state: State<'_, DesktopPairingState>) -> Result<PairStart, String> {
    let verifier = format!("{}{}{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let response = client()?.post(format!("{BASE}/start"))
        .json(&serde_json::json!({"code_challenge": challenge(&verifier), "code_challenge_method":"S256"}))
        .send().await.map_err(|_| pair_error())?;
    let data: StartResponse = bounded_json(response).await?;
    if data.device_code.is_empty() || data.user_code.is_empty() { return Err(pair_error()); }
    let interval = data.interval.unwrap_or(5).clamp(1, 10);
    let uri = data.verification_uri.filter(|u| u.starts_with("https://api.chengliu-api.top/")).unwrap_or_else(|| PORTAL.into());
    *state.0.lock().map_err(|_| pair_error())? = Some(Session { verifier, device_code: data.device_code, started: Instant::now(), exchanging:false });
    Ok(PairStart { user_code: data.user_code, verification_uri: uri, interval })
}
#[tauri::command]
pub fn desktop_pair_cancel(state: State<'_, DesktopPairingState>) { if let Ok(mut slot) = state.0.lock() { *slot = None; } }

#[tauri::command]
pub async fn desktop_pair_poll(state: State<'_, DesktopPairingState>) -> Result<PairPoll, String> {
    let (device_code, verifier) = {
        let mut slot = state.0.lock().map_err(|_| pair_error())?;
        let s = slot.as_mut().ok_or("没有正在进行的配对。")?;
        if s.started.elapsed().as_secs() >= LIFETIME { *slot=None; return Ok(PairPoll{status:"expired".into()}); }
        if s.exchanging { return Ok(PairPoll{status:"waiting".into()}); }
        s.exchanging=true;
        (s.device_code.clone(),s.verifier.clone())
    };
    let session_device_code = device_code.clone();
    let result = async {
        let response=client()?.post(format!("{BASE}/exchange"))
            .json(&serde_json::json!({"device_code":device_code,"code_verifier":verifier}))
            .send().await.map_err(|_|pair_error())?;
        if response.status() == reqwest::StatusCode::ACCEPTED {
            let pending: ExchangeResponse = bounded_json(response).await?;
            if pending.status != "pending" { return Err(pair_error()); }
            return Ok(pending);
        }
        if !response.status().is_success() {
            let body: ErrorResponse = bounded_json(response).await?;
            return Err(match body.error.as_deref() { Some("revoked") => "配对已撤销，请重新开始。".to_owned(), Some("expired") => "配对已过期，请重新开始。".to_owned(), _ => pair_error() });
        }
        bounded_json::<ExchangeResponse>(response).await
    }.await;
    let data = match result { Ok(data)=>data, Err(e)=>{ if let Ok(mut slot)=state.0.lock(){if let Some(s)=slot.as_mut(){s.exchanging=false;}} return Err(e); } };
    match data.status.as_str() {
        "pending" => { if let Ok(mut slot)=state.0.lock(){if let Some(s)=slot.as_mut(){s.exchanging=false;}} Ok(PairPoll{status:"waiting".into()}) }
        "expired" | "denied" => { if let Ok(mut slot)=state.0.lock(){*slot=None;} Ok(PairPoll{status:"expired".into()}) }
        "complete" => {
            let (Some(key),Some(group),Some(key_id))=(data.api_key,data.group_name,data.key_id) else { if let Ok(mut slot)=state.0.lock(){*slot=None;} return Err(pair_error()); };
            let still_current = state.0.lock().ok().and_then(|slot| slot.as_ref().map(|s| s.device_code == session_device_code)).unwrap_or(false);
            if !still_current {
                let _ = client()?.post(format!("{BASE}/revoke")).json(&serde_json::json!({"api_key":key,"key_id":key_id})).send().await;
                return Ok(PairPoll{status:"expired".into()});
            }
            if let Ok(mut slot)=state.0.lock(){*slot=None;}
            let rollback_key = key.clone();
            let installed = tauri::async_runtime::spawn_blocking(move || install_key(&key,&group,key_id)).await.map_err(|_|pair_error())?;
            if let Err(error) = installed {
                let _ = client()?.post(format!("{BASE}/revoke")).json(&serde_json::json!({"api_key":rollback_key,"key_id":key_id})).send().await;
                return Err(error);
            }
            Ok(PairPoll{status:"connected".into()})
        }
        _ => { if let Ok(mut slot)=state.0.lock(){*slot=None;} Err(pair_error()) }
    }
}

fn install_key(key:&str, group:&str, key_id:u64)->Result<(),String>{
    let key_id = format!("pairing-{key_id}");
    use codex_plus_core::settings::{RelayApiKey,SettingsStore,RelayMode};
    let _guard=super::commands::pairing_relay_mutex().lock().map_err(|_|pair_error())?;
    let store=SettingsStore::default(); let mut settings=store.load().map_err(|_|pair_error())?;
    let revision=settings.settings_revision.clone(); let current=store.revision().map_err(|_|pair_error())?;
    if current!=revision{return Err("设置已在其他位置更新，请重新配对。".into());}
    let profile=settings.relay_profiles.iter_mut().find(|p|p.relay_mode==RelayMode::PureApi && p.name=="澄流平台" && p.base_url=="https://api.chengliu-api.top/v1").ok_or("未找到澄流平台 PureApi 配置。")?;
    profile.api_keys.retain(|entry|entry.id!=key_id);
    profile.api_keys.push(RelayApiKey{id:key_id.to_owned(),name:group.to_owned(),api_key:key.to_owned()});
    profile.active_api_key_id=key_id.to_owned(); profile.api_key=key.to_owned();
    settings.active_relay_id=profile.id.clone();
    settings.settings_revision=revision;
    let settings=super::commands::normalize_settings_before_save(settings);
    store.save_versioned(&settings).map_err(|_|"设置已更新或写入失败，请重新配对。".to_owned())?; Ok(())
}
#[cfg(test)] mod tests { use super::*; #[test] fn pkce_s256_is_url_safe_and_stable(){assert_eq!(challenge("abc"),"ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");assert!(!challenge("abc").contains('='));} #[test] fn endpoints_are_fixed_https(){assert_eq!(BASE,"https://api.chengliu-api.top/desktop/pairings");assert!(PORTAL.starts_with("https://"));} #[test] fn serialized_status_has_no_credentials(){let value=serde_json::to_value(PairPoll{status:"waiting".into()}).unwrap();assert_eq!(value,"{\"status\":\"waiting\"}");} }
