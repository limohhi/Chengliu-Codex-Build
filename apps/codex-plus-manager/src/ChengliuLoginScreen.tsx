import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, Link2, LoaderCircle, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import "./ChengliuLoginScreen.css";

const logoUrl = new URL("./assets/codex-plus-logo.png", import.meta.url).href;
const PORTAL_URL = "https://api.chengliu-api.top/portal/";
const CONTINUE_KEY = "chengliu.codexplusplus.entered";
type Start = { userCode: string; verificationUri: string; interval: number };
type Poll = { status: "waiting" | "connected" | "expired"; groupName?: string };
export function shouldShowChengliuLogin(storage: Pick<Storage, "getItem">): boolean { return storage.getItem(CONTINUE_KEY) !== "1"; }
export function markChengliuLoginComplete(storage: Pick<Storage, "setItem">): void { storage.setItem(CONTINUE_KEY, "1"); }

export function ChengliuLoginScreen({ onContinue }: { onContinue: () => void; onLogin?: () => void }) {
  const [pair, setPair] = useState<Start | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "waiting" | "connected" | "expired" | "error">("idle");
  const [error, setError] = useState("");
  const cancel = async () => { try { await invoke("desktop_pair_cancel"); } catch { /* process may be closing */ } setPair(null); setStatus("idle"); };
  const start = async () => { setStatus("starting"); setError(""); try { const p = await invoke<Start>("desktop_pair_start"); setPair(p); setStatus("waiting"); } catch { setStatus("error"); setError("无法开始配对，请稍后重试。"); } };
  useEffect(() => {
    if (status !== "waiting" || !pair) return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await invoke<Poll>("desktop_pair_poll");
        if (stopped) return;
        if (result.status === "connected") { setStatus("connected"); try { markChengliuLoginComplete(window.localStorage); } catch { /* restricted storage */ } onContinue(); return; }
        if (result.status === "expired") { setStatus("expired"); return; }
      } catch { if (!stopped) { setStatus("error"); setError("配对状态查询失败，请重试。"); } return; }
      if (!stopped) window.setTimeout(poll, Math.max(1, Math.min(10, pair.interval)) * 1000);
    };
    const timer = window.setTimeout(poll, Math.max(1, Math.min(10, pair.interval)) * 1000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [status, pair]);
  const complete = () => { try { markChengliuLoginComplete(window.localStorage); } catch { /* restricted storage */ } onContinue(); };
  return <main className="tp-page chengliu-login-page"><section className="chengliu-login-panel" aria-labelledby="chengliu-login-title">
    <img className="chengliu-login-logo" src={logoUrl} alt="澄流" /><h1 id="chengliu-login-title">澄流 Codex++</h1>
    <p>{status === "waiting" ? "请在浏览器中完成验证，桌面端正在等待确认。" : status === "connected" ? "桌面 API 密钥已安全保存。" : "连接澄流账户，为桌面端安全配置 API 密钥。"}</p>
    {pair && status !== "connected" ? <><div className="chengliu-pair-code" aria-label="配对码">{pair.userCode}</div>
      <button className="cx-primary chengliu-login-action" type="button" onClick={() => void invoke("open_external_url", { url: pair.verificationUri }).catch(() => { window.open(PORTAL_URL, "_blank", "noopener,noreferrer"); })}><ExternalLink aria-hidden="true"/>打开验证页面</button>
      <button className="cx-secondary chengliu-continue-action" type="button" onClick={() => void cancel()}><X aria-hidden="true"/>取消配对</button>
      <span className="chengliu-waiting"><LoaderCircle aria-hidden="true"/>等待验证</span></> : null}
    {status === "connected" ? <button className="cx-primary chengliu-login-action" type="button" onClick={complete}>进入 Codex++<ArrowRight aria-hidden="true"/></button> : null}
    {status === "expired" || status === "error" ? <p role="alert">{error || "配对已过期，请重新开始。"}</p> : null}
    {status !== "waiting" && status !== "connected" && <button className="cx-primary chengliu-login-action" type="button" disabled={status === "starting"} onClick={() => void start()}><Link2 aria-hidden="true"/>{status === "starting" ? "正在准备…" : "连接澄流账户"}</button>}
    {status === "idle" ? <p className="chengliu-login-note">网页授权后，桌面端才会安全接收 API 密钥并写入本机设置；密钥不会传入界面。</p> : null}
  </section></main>;
}
