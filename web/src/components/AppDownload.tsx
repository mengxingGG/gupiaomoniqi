import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { request } from "../api";
import "./download.css";
interface Release { versionName: string; sizeBytes: number; publishedAt: string; sha256: string; releaseNotes: string }
export function AppDownload() {
  const [open,setOpen] = useState(new URLSearchParams(location.search).get("download") === "app");
  const [release,setRelease] = useState<Release | null>(); const [error,setError] = useState(""); const [qr,setQr] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  async function load() { setError(""); setRelease(undefined); try { const result = await request<{release:Release|null}>("/api/android/update?currentVersionCode=0",{},false); setRelease(result.release); } catch { setError("暂时无法读取安装包信息，请稍后重试。"); } }
  useEffect(() => {
    if (!open) return;
    void load(); dialog.current?.focus();
    if (location.protocol === "https:" && !/^(localhost|127\.)/.test(location.hostname)) void QRCode.toDataURL(`${location.origin}/?download=app`, { margin: 2, width: 240 }).then(setQr);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if(event.key === "Tab") {
        const nodes=dialog.current?.querySelectorAll<HTMLElement>('button,a[href]');if(!nodes?.length)return;
        if(event.shiftKey && document.activeElement===nodes[0]){event.preventDefault();nodes[nodes.length-1]!.focus();}
        if(!event.shiftKey && document.activeElement===nodes[nodes.length-1]){event.preventDefault();nodes[0]!.focus();}
      }
    };
    document.addEventListener("keydown",key);return()=>{document.removeEventListener("keydown",key);button.current?.focus();};
  },[open]);
  return <><button className="download-entry" ref={button} onClick={()=>setOpen(true)}>↓ 下载 App</button>{open && <div className="download-overlay" onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}><div className="download-card" role="dialog" aria-modal="true" aria-label="下载四海模拟盘" tabIndex={-1} ref={dialog}><button aria-label="关闭下载" onClick={()=>setOpen(false)}>✕</button><h2>把市场装进口袋</h2><p>四海模拟盘 Android 版<br/>随时看行情，练习交易，与 AI 一起复盘。</p>{error ? <p role="alert">{error}<button onClick={()=>void load()}>重试</button></p> : release === undefined ? <p role="status">正在获取安装包…</p> : !release ? <p>当前尚未发布可下载的安装包。</p> : <><p>版本 {release.versionName} · {(release.sizeBytes / 1048576).toFixed(1)} MB</p>{qr && <><img src={qr} alt="用手机扫描打开下载页面"/><small>用 Android 手机扫码打开此下载页</small></>}<a href={`${base}/api/android/update/apk`} download>下载 Android APK</a><small>Android 8.0 及以上。iPhone 暂无 App，可继续使用 Web。</small><details><summary>版本说明与校验</summary><p>{release.releaseNotes}</p><small>SHA-256：{release.sha256}</small></details></>}</div></div>}</>;
}
