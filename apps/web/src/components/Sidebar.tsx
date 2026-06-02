import { BookOpen, Boxes, GitBranch, Library, Map, NotebookTabs, Upload } from "lucide-react";

export type NavKey = "projects" | "global" | "workflows" | "concept" | "notes" | "exports";

const navItems: Array<{ key: NavKey; label: string; icon: typeof Library }> = [
  { key: "projects", label: "Projects", icon: Boxes },
  { key: "global", label: "Global Library", icon: Library },
  { key: "workflows", label: "Workflows", icon: GitBranch },
  { key: "concept", label: "Concept Map", icon: Map },
  { key: "notes", label: "Notes", icon: NotebookTabs },
  { key: "exports", label: "Exports", icon: Upload }
];

export function Sidebar({
  active,
  projectsCount,
  notesCount,
  onChange
}: {
  active: NavKey;
  projectsCount: number;
  notesCount: number;
  onChange: (key: NavKey) => void;
}) {
  return (
    <nav className="sidebar" aria-label="Primary">
      {navItems.map((item) => {
        const Icon = item.icon;
        const count = item.key === "projects" ? projectsCount : item.key === "notes" ? notesCount : null;
        return (
          <button
            key={item.key}
            type="button"
            className={active === item.key ? "nav-item active" : "nav-item"}
            onClick={() => onChange(item.key)}
          >
            <Icon size={16} />
            <span>{item.label}</span>
            {count !== null ? <b>{count}</b> : null}
          </button>
        );
      })}
      <div className="sidebar-spacer" />
      <div className="sidebar-note">
        <BookOpen size={15} />
        <span>Local-first workspace</span>
      </div>
    </nav>
  );
}
