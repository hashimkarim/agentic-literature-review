import { useEffect, useRef, useState } from "react";
import { Check, Cpu, Monitor, Pencil, Plus, Plug, RefreshCw, Server, Unplug, X } from "lucide-react";
import { registerProviderPanel, type ProviderPanelElement } from "@agenticdriver/sdk/ui";
import type { AgentProvider, DriverConnection, DriverConnections, DriverHostConnection } from "@litagent/contracts";
import { api } from "./api";
import { DriverConnectionSettings } from "./DriverConnectionSettings";
import { useBrowserPreference } from "./browser-preferences";
import "./driver-panel.css";

interface Props {
  theme: string;
  providers: AgentProvider[];
  connection: DriverConnection | null;
  onSync: () => Promise<void>;
  onUpdate: (id: string, patch: Parameters<typeof api.updateProviderSettings>[1]) => Promise<void>;
  onSelect: (provider: string, model: string) => void;
}

export function DriverProviderPanel(props: Props) {
  const [data, setData] = useState<DriverConnections | null>(null);
  const [error, setError] = useState("");
  async function sync() {
    await props.onSync();
    setData(await api.driverConnections());
  }
  useEffect(() => {
    let stale = false;
    void api.driverConnections().then((value) => { if (!stale) { setData(value); setError(""); } })
      .catch(() => { if (!stale) setError("Could not load driver connections."); });
    return () => { stale = true; };
  }, [props.connection?.checkedAt, props.connection?.configured]);
  if (!data) return <p role={error ? "alert" : "status"}>{error || "Loading connections..."}</p>;
  return <DriverConnectionsWorkspace {...props} data={data} onSync={sync} />;
}

function DriverConnectionsWorkspace(props: Props & { data: DriverConnections }) {
  const { data } = props;
  const [selected, setSelected] = useBrowserPreference(`litagent:driver:v1:${data.client.id}:connection`, "", (value) => {
    if (typeof value !== "string") throw new Error("Invalid connection selection"); return value;
  });
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [device, setDevice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const active = selected === "new" ? undefined : data.connections.find((entry) => entry.id === selected) ?? data.connections[0];
  useEffect(() => { setEditing(false); setError(""); }, [active?.id]);
  async function rename() {
    if (!active) return;
    setSaving(true); setError("");
    try { await api.renameDriverConnection(active.id, { label, deviceName: device }); await props.onSync(); setEditing(false); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not rename connection."); }
    finally { setSaving(false); }
  }
  return <div className="driver-settings-workspace">
    <header className="driver-connections-heading">
      <div><h2>Driver connections</h2><span><Server size={14} />LitAgent server: {data.client.deviceName}</span></div>
      <button className="la-btn la-btn-ghost" onClick={() => setSelected("new")}><Plus size={16} />Add connection</button>
    </header>
    <div className="driver-connections-list" aria-label="Driver connections">
      {data.connections.map((entry) => <button key={entry.id} type="button" aria-pressed={active?.id === entry.id}
        className="driver-host-choice" onClick={() => setSelected(entry.id)}>
        <Monitor size={17} /><span><strong>{entry.label}</strong><small>{entry.deviceName}</small><small className="mono">{entry.endpoint}</small></span>
        <span className={`driver-health ${entry.status}`}>{entry.status === "ready" ? "Connected" : "Unavailable"}</span>
      </button>)}
    </div>
    {active && <div className="driver-connection-title"><h3>{active.label}</h3><button className="la-btn la-btn-ghost" title="Edit connection and device names" aria-label="Edit connection and device names" onClick={() => {
      setLabel(active.label); setDevice(active.deviceName); setEditing(!editing);
    }}><Pencil size={14} /></button></div>}
    {editing && active && <form className="driver-label-form" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
      <label>Connection name<input value={label} maxLength={100} required disabled={saving} onChange={(event) => setLabel(event.target.value)} /></label>
      <label>Device name<input value={device} maxLength={100} required disabled={saving} onChange={(event) => setDevice(event.target.value)} /></label>
      <button className="la-btn la-btn-primary" disabled={saving || !label.trim() || !device.trim()}><Check size={15} />Save names</button>
      <button type="button" className="la-btn la-btn-ghost" title="Cancel rename" aria-label="Cancel rename" disabled={saving} onClick={() => setEditing(false)}><X size={15} /></button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <ConnectedDriverPanel key={active?.id ?? "new"} {...props} host={active ?? null} onConnected={setSelected} />
  </div>;
}

function ConnectedDriverPanel(props: Props & { host: DriverHostConnection | null; onConnected: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<ProviderPanelElement | null>(null);
  const current = useRef(props);
  current.current = props;
  const [selection, setSelection] = useState<{ provider: string; model: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const previousLabel = useRef(`${props.host?.label}:${props.host?.deviceName}`);
  const instances = props.providers.filter((provider) => provider.driver?.connectionId === props.host?.id && props.host);
  const offline = props.host?.status === "error";

  useEffect(() => {
    registerProviderPanel();
    const element = document.createElement("agenticdriver-providers") as ProviderPanelElement;
    element.className = "driver-shared-panel";
    element.setAttribute("theme", current.current.theme);
    const style = new CSSStyleSheet();
    style.replaceSync("*{letter-spacing:0!important}.shell,.provider,.group,.notice,.setup-card{border-radius:6px}.top h2{font-size:18px}.empty h3{font-size:22px}");
    element.transport = async (request) => {
      try {
        const result = await api.driverPanel(request, current.current.host?.id ?? "new");
        if (request.action === "connect") {
          const state = result as { connection?: { id: string } };
          if (state.connection) current.current.onConnected(state.connection.id);
        }
        if (request.action === "disconnect") current.current.onConnected("new");
        return result;
      }
      finally { await current.current.onSync(); }
    };
    const select = (event: Event) => {
      const value: unknown = (event as CustomEvent).detail;
      if (!value || typeof value !== "object" || !("provider" in value) || !("model" in value) ||
        typeof value.provider !== "string" || typeof value.model !== "string") return;
      const provider = current.current.providers.find((entry) => entry.driver?.connectionId === current.current.host?.id && entry.driver?.instanceId === value.provider);
      if (!provider) return;
      setSelection({ provider: provider.id, model: value.model });
      setError(""); setNotice("");
    };
    element.addEventListener("agenticdriver:model-selected", select);
    panel.current = element;
    container.current?.append(element);
    // The SDK installs its stylesheet in connectedCallback; append ours afterward.
    if (element.shadowRoot) element.shadowRoot.adoptedStyleSheets = [...element.shadowRoot.adoptedStyleSheets, style];
    return () => { element.removeEventListener("agenticdriver:model-selected", select); element.remove(); panel.current = null; };
  }, []);

  useEffect(() => { panel.current?.setAttribute("theme", props.theme); }, [props.theme]);
  useEffect(() => {
    const value = `${props.host?.label}:${props.host?.deviceName}`;
    if (previousLabel.current !== value) { previousLabel.current = value; void panel.current?.refresh(); }
  }, [props.host?.label, props.host?.deviceName]);
  useEffect(() => { setSelection(null); setNotice(""); }, [props.host?.id]);

  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : "Could not save the provider selection."); }
    finally { setBusy(false); }
  }

  async function useSelection() {
    if (!selection) return;
    const provider = instances.find((entry) => entry.id === selection.provider);
    if (!provider?.driver?.available || (provider.driver.restrictedModels && !provider.models.includes(selection.model)))
      throw new Error("This connection does not permit that model for LitAgent. Refresh the host catalog.");
    await props.onUpdate(provider.id, { defaultModel: selection.model,
      ...(!provider.driver.restrictedModels ? { customModels: [...new Set([...provider.customModels, selection.model])] } : {}),
    });
    props.onSelect(provider.id, selection.model);
    setNotice(provider.enabled ? "Default model saved." : "Default model saved. Provider is still disabled in LitAgent.");
    setSelection(null);
  }

  return <div className="driver-settings-workspace">
    {offline && <section className="driver-offline" role="alert">
      <strong>Driver unavailable</strong><p>{props.host?.message}</p>
      <div><button className="la-btn la-btn-ghost" disabled={busy} onClick={() => void perform(async () => { await panel.current?.refresh(); })}><RefreshCw size={15} />Retry connection</button>
        <button className="la-btn la-btn-ghost" disabled={busy} onClick={() => void perform(async () => {
          await api.driverPanel({ action: "disconnect" }, props.host!.id); props.onConnected("new"); await props.onSync();
        })}><Unplug size={15} />Disconnect locally</button></div>
    </section>}
    <div key="shared-panel" ref={container} hidden={offline} aria-label="AgenticDriver provider settings" />
    {selection && <div className="driver-selection" role="region" aria-label="Selected model">
      <Cpu size={16} /><div><strong>{selection.model}</strong><span>{instances.find((entry) => entry.id === selection.provider)?.label ?? selection.provider}</span></div>
      <button className="la-btn la-btn-primary" disabled={busy} onClick={() => void perform(useSelection)}><Check size={15} />Use in LitAgent</button>
    </div>}
    <section className="driver-app-access" aria-label="Enabled in LitAgent">
      <h2><Plug size={17} />Enabled in LitAgent</h2>
      {instances.length === 0 && <p>No executable provider instances granted to this connection.</p>}
      {instances.map((provider) => {
        const denied = !provider.driver?.available || (provider.driver.restrictedModels && provider.models.length === 0);
        return <div className="driver-app-row" key={provider.id}>
          <label><input type="checkbox" aria-label={`Enable ${provider.driver?.instanceId} in LitAgent`} checked={provider.enabled}
            disabled={busy || (!provider.enabled && denied)} onChange={(event) => {
              const enabled = event.currentTarget.checked;
              void perform(() => props.onUpdate(provider.id, { enabled, connected: enabled }));
            }} /><span>{provider.label.replace(/ \(AgenticDriver\)$/, "")}</span></label>
          <code>{provider.defaultModel ?? "No model selected"}</code>
          <span className="driver-app-state">{denied ? "Unavailable" : provider.enabled ? "Enabled" : "Disabled"}</span>
        </div>;
      })}
      {error && <p role="alert" className="writing-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
    <details className="driver-manual-connection">
      <summary>Existing host address and credential</summary>
      <DriverConnectionSettings connection={props.host} connectionId={props.host?.id ?? null} onSaved={async (id) => {
        props.onConnected(id); await props.onSync(); await panel.current?.refresh();
      }} onRefresh={async () => {
        await panel.current?.refresh();
        const result = await api.driverConnections();
        return result.connections.find((entry) => entry.id === props.host?.id) ?? { configured: false, status: "unconfigured", endpoint: null, code: "NOT_CONFIGURED", message: "Connect a driver.", checkedAt: null, refreshing: false };
      }} />
    </details>
  </div>;
}
