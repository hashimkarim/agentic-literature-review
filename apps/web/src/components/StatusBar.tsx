import { Database, FolderGit2, GitBranch, HardDrive, Link2 } from "lucide-react";
import type { Project } from "@litagent/contracts";

import type { AppStatus, PaperEntry } from "../api";

export function StatusBar({
  status,
  project,
  selectedPaper
}: {
  status: AppStatus | null;
  project: Project | null;
  selectedPaper: PaperEntry | null;
}) {
  return (
    <footer className="statusbar">
      <span>
        <FolderGit2 size={15} />
        {project?.name ?? "Global Library"}
      </span>
      <span>
        <Database size={15} />
        {status?.papers ?? 0} papers
      </span>
      <span>
        <GitBranch size={15} />
        Git: {status?.git.branch ?? "main"} {status?.git.clean ? "clean" : "changes"}
      </span>
      <span className={status?.git.lfsAvailable ? "ok" : "warn"}>
        <Link2 size={15} />
        Git LFS {status?.git.lfsAvailable ? "ready" : "missing"}
      </span>
      <span>
        <HardDrive size={15} />
        {selectedPaper?.paper.filePaths.markdown ? "Indexed Markdown" : "Markdown pending"}
      </span>
    </footer>
  );
}
