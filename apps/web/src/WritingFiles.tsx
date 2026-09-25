import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FileCode2, Image, X, Download } from "lucide-react";
import { PdfReader } from "@litagent/pdf";
import type { ManuscriptDocument } from "@litagent/contracts";
import { api } from "./api";

export function WritingFileTree({ files, folders, selected, mainFile, disabled, collapsedFolders, onCollapsedFoldersChange, onSelect }: {
  files: { path: string; asset?: boolean; dirty?: boolean }[]; folders: string[]; selected: string; mainFile: string; disabled: boolean;
  collapsedFolders: string[]; onCollapsedFoldersChange: (paths: string[]) => void;
  onSelect: (path: string, folder: boolean) => void;
}) {
  const collapsed = new Set(collapsedFolders);
  const directories = new Set(folders);
  for (const file of files) { const parts = file.path.split("/"); while (parts.length > 1) { parts.pop(); directories.add(parts.join("/")); } }
  const nodes = [...directories].map((path) => ({ path, folder: true, asset: false, dirty: false })).concat(files.map((file) => ({ path: file.path, folder: false, asset: !!file.asset, dirty: !!file.dirty })));
  const toggle = (path: string) => { const next = new Set(collapsed); if (!next.delete(path)) next.add(path); onCollapsedFoldersChange([...next]); };
  function children(parent: string, level: number): ReactNode {
    return nodes.filter((node) => node.path.split("/").slice(0, -1).join("/") === parent).sort((a, b) => Number(b.folder) - Number(a.folder) || a.path.localeCompare(b.path)).map((node) => {
      const expanded = !collapsed.has(node.path);
      return <li key={node.path} role="none"><button type="button" role="treeitem" aria-label={node.path} aria-level={level + 1} aria-selected={selected === node.path} {...(node.folder ? { "aria-expanded": expanded } : {})}
        className={selected === node.path ? "active" : ""} style={{ paddingLeft: 6 + level * 14 }} title={node.path} disabled={disabled}
        onClick={() => { onSelect(node.path, node.folder); if (node.folder) toggle(node.path); }}
        onKeyDown={(event) => {
          const buttons = Array.from(event.currentTarget.closest('[role="tree"]')!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'));
          const index = buttons.indexOf(event.currentTarget);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); buttons[Math.min(buttons.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus(); }
          if (event.key === "Home" || event.key === "End") { event.preventDefault(); buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus(); }
          if (event.key === "ArrowRight" && node.folder) { event.preventDefault(); if (!expanded) toggle(node.path); else buttons[index + 1]?.focus(); }
          if (event.key === "ArrowLeft") { event.preventDefault(); if (node.folder && expanded) toggle(node.path); else buttons.find((button) => button.getAttribute("aria-label") === parent)?.focus(); }
        }}>
        {node.folder ? <>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{expanded ? <FolderOpen size={15} /> : <Folder size={15} />}</> : <>{node.asset ? <Image size={15} /> : <FileCode2 size={15} />}</>}
        <span>{node.path.split("/").pop()}</span>{node.path === mainFile && <small className="writing-main-file">main</small>}{node.dirty && <span aria-label="Unsaved" className="writing-dirty-dot" />}
      </button>{node.folder && expanded && <ul role="group">{children(node.path, level + 1)}</ul>}</li>;
    });
  }
  return <ul role="tree" aria-label="Document file tree" className="writing-file-tree">{children("", 0)}</ul>;
}

export function WritingFileTabs({ paths, active, onSelect, onClose }: { paths: string[]; active: string; onSelect: (path: string) => void; onClose: (path: string) => void }) {
  return <div className="writing-file-tabs" role="tablist" aria-label="Open files">{paths.map((path) => <div key={path} className={active === path ? "active" : ""}>
    <button type="button" role="tab" aria-selected={active === path} title={path} onClick={() => onSelect(path)}><FileCode2 size={14} /><span>{path.split("/").pop()}</span></button>
    <button type="button" aria-label={`Close ${path}`} title={`Close ${path}`} onClick={() => onClose(path)}><X size={12} /></button>
  </div>)}</div>;
}

export function WritingAsset({ id, asset }: { id: string; asset: NonNullable<ManuscriptDocument["assets"]>[number] }) {
  const [error, setError] = useState<string | null>(null);
  const url = api.manuscriptAssetUrl(id, asset.path, asset.revision);
  async function download() {
    setError(null);
    try { const response = await fetch(url); if (!response.ok) throw new Error("Could not download asset."); const link = document.createElement("a"); const blob = URL.createObjectURL(await response.blob()); link.href = blob; link.download = asset.path.split("/").pop()!; link.click(); setTimeout(() => URL.revokeObjectURL(blob), 1000); }
    catch (error) { setError(error instanceof Error ? error.message : "Download failed."); }
  }
  return <section className="writing-asset" aria-label={`Asset preview: ${asset.path}`}>
    <header><span>{asset.path}</span><small>{(asset.bytes / 1024).toFixed(1)} KB</small><button type="button" onClick={() => void download()} title="Download asset" aria-label="Download asset"><Download size={16} /></button></header>
    {error && <p className="writing-error" role="alert">{error}</p>}
    {/\.pdf$/i.test(asset.path) ? <PdfReader key={url} source={url} readOnly /> : /\.(png|jpg|jpeg|webp)$/i.test(asset.path) ? <div className="writing-image-preview"><img src={url} alt={asset.path} onError={() => setError("This image could not be decoded.")} /></div> : <div className="writing-empty"><Image size={28} /><h2>{asset.path.split("/").pop()}</h2><button type="button" onClick={() => void download()}><Download size={16} />Download asset</button></div>}
  </section>;
}
