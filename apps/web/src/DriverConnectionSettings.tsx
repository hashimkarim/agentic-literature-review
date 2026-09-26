import { useEffect, useState } from "react";
import { CheckCircle2, Plug, RefreshCw, Settings2 } from "lucide-react";
import type { DriverConnection } from "@litagent/contracts";
import { api } from "./api";
import { Select } from "./Select";

export function DriverConnectionSettings({ connection, onRefresh, connectionId, onSaved }: {
  connection: DriverConnection | null; onRefresh: () => Promise<DriverConnection>;
  connectionId?: string | null; onSaved?: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [credential, setCredential] = useState("");
  const [mode, setMode] = useState<"token" | "tokenFile">("tokenFile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!editing) setUrl(connection?.endpoint ?? ""); }, [connection?.endpoint, editing]);
  const open = editing || !connection?.configured;
  async function refresh() { setBusy(true); setError(""); try { await onRefresh(); } catch { setError("Could not refresh the connection. Check that the LitAgent server is running."); } finally { setBusy(false); } }
  async function save() {
    setBusy(true); setError("");
    try {
      const result = await api.saveDriverConnection({ url: url.trim(), ...(credential.trim() ? { [mode]: credential.trim() } : {}) }, connectionId);
      setCredential("");
      if (result.connection.status === "ready") setEditing(false);
      if (onSaved) await onSaved(result.id);
      else await onRefresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save connection."); }
    finally { setBusy(false); }
  }
  return <section className="la-provider driver-connection" aria-label="AgenticDriver connection">
    <div className="phead"><div className="picon"><Plug size={19} /></div><div className="pinfo"><div className="pname">AgenticDriver</div><div className="pstatus">{connection?.endpoint ?? "Not configured"}</div></div>
      <span className={`driver-health ${connection?.status ?? ""}`} role="status">{connection?.status === "ready" && <CheckCircle2 size={14} />}{!connection ? "Checking connection..." : connection.status === "ready" ? "Connected" : connection.status === "error" ? "Unavailable" : "Not connected"}</span>
      <button type="button" title="Edit driver connection" aria-label="Edit driver connection" disabled={busy} onClick={() => setEditing(!editing)}><Settings2 size={16} /></button>
      <button type="button" title="Refresh driver catalog" aria-label="Refresh driver catalog" disabled={busy || !connection?.configured} onClick={() => void refresh()}><RefreshCw size={16} /></button>
    </div>
    <div className="driver-connection-body">
      {open && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>Driver address<input type="url" aria-label="Driver address" placeholder="http://127.0.0.1:7433" value={url} onChange={(event) => setUrl(event.target.value)} required disabled={busy} /></label>
        <label>Credential<Select label="Driver credential type" value={mode} onChange={(value) => { setMode(value as typeof mode); setCredential(""); }} disabled={busy} options={[{ value: "token", label: "Bearer token" }, { value: "tokenFile", label: "Local token file" }]} /></label>
        <label>{mode === "token" ? "Bearer token" : "Token file path"}<input type={mode === "token" ? "password" : "text"} aria-label={mode === "token" ? "Driver bearer token" : "Driver token file path"} autoComplete="off" spellCheck={false} value={credential} onChange={(event) => setCredential(event.target.value)} placeholder={connection?.configured ? "Leave blank to keep the saved credential" : mode === "tokenFile" ? "/absolute/path/to/token" : "Private driver credential"} disabled={busy} /></label>
        <button type="submit" className="la-btn la-btn-primary" disabled={busy || !url.trim() || (!connection?.configured && !credential.trim())}><Plug size={15} />{busy ? "Connecting..." : "Save connection"}</button>
      </form>}
      {connection?.configured && <p role={connection.status === "error" ? "alert" : "status"}>{connection.message}</p>}
      {error && <p className="writing-error" role="alert">{error}</p>}
    </div>
  </section>;
}
