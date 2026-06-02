import { Activity, FilePlus2, Loader2, Moon, NotebookPen, Palette, Search, Settings, Sun, Workflow } from "lucide-react";
import type { Project } from "@litagent/contracts";

export type ThemeMode = "light" | "dark" | "color";

export function TopBar({
  projects,
  selectedProjectId,
  searchQuery,
  busy,
  onProjectChange,
  onSearchChange,
  onImport,
  onNewNote,
  onSettings,
  theme,
  onThemeChange
}: {
  projects: Project[];
  selectedProjectId: string | null;
  searchQuery: string;
  busy: boolean;
  theme: ThemeMode;
  onProjectChange: (projectId: string) => void;
  onSearchChange: (query: string) => void;
  onImport: () => void;
  onNewNote: () => void;
  onSettings: () => void;
  onThemeChange: (theme: ThemeMode) => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <Activity size={18} />
        <span>LitAgent</span>
      </div>
      <select
        className="project-switcher"
        value={selectedProjectId ?? ""}
        onChange={(event) => onProjectChange(event.currentTarget.value)}
        aria-label="Project"
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <label className="searchbox">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          placeholder="Search papers, notes, tags, evidence..."
        />
      </label>
      <div className="top-actions">
        {busy ? <Loader2 className="spin muted-icon" size={17} /> : null}
        <button type="button" className="toolbar-button" onClick={onImport} title="Import PDF">
          <FilePlus2 size={17} />
          <span>Import</span>
        </button>
        <button type="button" className="toolbar-button" onClick={onNewNote} title="New note">
          <NotebookPen size={17} />
          <span>New note</span>
        </button>
        <button type="button" className="icon-button" title="Workflow recipes">
          <Workflow size={17} />
        </button>
        <div className="theme-toggle" aria-label="Theme">
          <button type="button" className={theme === "light" ? "active" : ""} onClick={() => onThemeChange("light")} title="Light theme">
            <Sun size={15} />
          </button>
          <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")} title="T3-style dark theme">
            <Moon size={15} />
          </button>
          <button type="button" className={theme === "color" ? "active" : ""} onClick={() => onThemeChange("color")} title="Exact Comfy theme">
            <Palette size={15} />
          </button>
        </div>
        <button type="button" className="icon-button" title="Settings" onClick={onSettings}>
          <Settings size={17} />
        </button>
      </div>
    </header>
  );
}
