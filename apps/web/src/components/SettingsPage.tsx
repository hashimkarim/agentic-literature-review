import { CheckCircle2, ExternalLink, PlugZap, RefreshCw, Save, Settings, Terminal, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentProvider } from "@litagent/contracts";

export function SettingsPage({
  providers,
  selectedProviderId,
  selectedModel,
  onProviderChange,
  onModelChange,
  onConnectProvider,
  onSaveProvider
}: {
  providers: AgentProvider[];
  selectedProviderId: string;
  selectedModel: string | null;
  onProviderChange: (providerId: string) => void;
  onModelChange: (model: string | null) => void;
  onConnectProvider: (providerId: string) => void;
  onSaveProvider: (
    providerId: string,
    patch: {
      enabled?: boolean;
      command?: string;
      defaultModel?: string | null;
      customModels?: string[];
    }
  ) => void;
}) {
  const selectableProviders = providers.filter((provider) => provider.id !== "local-heuristic");
  const selectedProvider = selectableProviders.find((provider) => provider.id === selectedProviderId) ?? null;
  return (
    <section className="settings-page">
      <header className="settings-header">
        <span>
          <Settings size={18} />
          Provider Settings
        </span>
        <div className="settings-inline-picker">
          <select value={selectedProviderId} onChange={(event) => onProviderChange(event.currentTarget.value)}>
            {selectableProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
          <select value={selectedModel ?? ""} onChange={(event) => onModelChange(event.currentTarget.value || null)} disabled={!selectedProvider}>
            <option value="">CLI default</option>
            {selectedProvider?.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </header>
      <div className="settings-provider-grid">
        {providers.map((provider) => (
          <ProviderSettingsCard
            key={provider.id}
            provider={provider}
            active={provider.id === selectedProviderId}
            onUse={() => onProviderChange(provider.id)}
            onConnect={() => onConnectProvider(provider.id)}
            onSave={(patch) => onSaveProvider(provider.id, patch)}
          />
        ))}
      </div>
    </section>
  );
}

function ProviderSettingsCard({
  provider,
  active,
  onUse,
  onConnect,
  onSave
}: {
  provider: AgentProvider;
  active: boolean;
  onUse: () => void;
  onConnect: () => void;
  onSave: (patch: {
    enabled?: boolean;
    command?: string;
    defaultModel?: string | null;
    customModels?: string[];
  }) => void;
}) {
  const [enabled, setEnabled] = useState(provider.enabled);
  const [command, setCommand] = useState(provider.command);
  const [defaultModel, setDefaultModel] = useState(provider.defaultModel ?? "");
  const [customModelText, setCustomModelText] = useState(provider.customModels.join("\n"));

  useEffect(() => {
    setEnabled(provider.enabled);
    setCommand(provider.command);
    setDefaultModel(provider.defaultModel ?? "");
    setCustomModelText(provider.customModels.join("\n"));
  }, [provider]);

  const customModels = useMemo(
    () =>
      customModelText
        .split(/\r?\n|,/)
        .map((model) => model.trim())
        .filter(Boolean),
    [customModelText]
  );
  const statusClass = provider.installed ? (provider.connected || provider.authStatus === "authenticated" ? "ready" : "installed") : "missing";
  const StatusIcon = provider.installed ? CheckCircle2 : XCircle;

  return (
    <article className={active ? "provider-settings-card active" : "provider-settings-card"}>
      <div className="provider-settings-title">
        <span>
          <StatusIcon size={17} />
          <b>{provider.label}</b>
          <em className={`provider-status ${statusClass}`}>
            {provider.installed ? (provider.connected || provider.authStatus === "authenticated" ? "connected" : "installed") : "missing"}
          </em>
        </span>
        <button type="button" className="small-button" onClick={onUse}>
          Use
        </button>
      </div>
      <div className="provider-settings-meta">
        <span>Version: {provider.version ?? "unknown"}</span>
        <span>Auth: {provider.authStatus}</span>
      </div>
      <label className="settings-check">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />
        Enabled for agentic workflows
      </label>
      <label className="settings-field">
        <span>
          <Terminal size={14} />
          Command
        </span>
        <input value={command} onChange={(event) => setCommand(event.currentTarget.value)} />
      </label>
      <label className="settings-field">
        <span>Default model</span>
        <input value={defaultModel} onChange={(event) => setDefaultModel(event.currentTarget.value)} placeholder="CLI default" />
      </label>
      <label className="settings-field">
        <span>Custom models</span>
        <textarea value={customModelText} onChange={(event) => setCustomModelText(event.currentTarget.value)} placeholder="One model per line" />
      </label>
      <div className="provider-settings-actions">
        <button type="button" className="toolbar-button" onClick={onConnect}>
          <PlugZap size={15} />
          <span>Connect</span>
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() =>
            onSave({
              enabled,
              command,
              defaultModel: defaultModel.trim() || null,
              customModels
            })
          }
        >
          <Save size={15} />
          <span>Save</span>
        </button>
        <button type="button" className="icon-button" onClick={() => onSave({})} title="Refresh">
          <RefreshCw size={15} />
        </button>
      </div>
      <p className="settings-command-hint">
        <ExternalLink size={13} />
        {provider.connectCommand ?? "Use this provider's CLI login command in a terminal."}
      </p>
    </article>
  );
}
