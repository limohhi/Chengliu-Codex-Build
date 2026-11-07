import { LogIn, ArrowRight } from "lucide-react";
const logoUrl = new URL("./assets/codex-plus-logo.png", import.meta.url).href;
import "./ChengliuLoginScreen.css";

const PORTAL_URL = "https://api.chengliu-api.top/portal/";
const CONTINUE_KEY = "chengliu.codexplusplus.entered";

export function shouldShowChengliuLogin(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(CONTINUE_KEY) !== "1";
}

export function markChengliuLoginComplete(storage: Pick<Storage, "setItem">): void {
  storage.setItem(CONTINUE_KEY, "1");
}

export function ChengliuLoginScreen({ onContinue, onLogin }: { onContinue: () => void; onLogin: () => void }) {
  return (
    <main className="tp-page chengliu-login-page">
      <section className="chengliu-login-panel" aria-labelledby="chengliu-login-title">
        <img className="chengliu-login-logo" src={logoUrl} alt="澄流" />
        <h1 id="chengliu-login-title">澄流 Codex++</h1>
        <p>登录澄流平台，管理 API 密钥和账户额度。</p>
        <button className="cx-primary chengliu-login-action" type="button" onClick={onLogin} data-portal-url={PORTAL_URL}>
          <LogIn aria-hidden="true" />
          登录澄流平台
        </button>
        <button className="cx-secondary chengliu-continue-action" type="button" onClick={onContinue}>
          进入 Codex++
          <ArrowRight aria-hidden="true" />
        </button>
        <p className="chengliu-login-note">网页登录不会自动配置桌面 API 密钥；进入后请在供应商设置中填写澄流 Key。</p>
      </section>
    </main>
  );
}
