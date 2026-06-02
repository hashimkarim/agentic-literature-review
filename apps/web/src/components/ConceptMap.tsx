import cytoscape, { type ElementDefinition } from "cytoscape";
import { useEffect, useMemo, useRef } from "react";
import type { Project } from "@litagent/contracts";

import type { PaperEntry } from "../api";

export function ConceptMap({
  project,
  papers,
  selectedPaperId,
  onSelectPaper
}: {
  project: Project | null;
  papers: PaperEntry[];
  selectedPaperId: string | null;
  onSelectPaper: (paperId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elements = useMemo<ElementDefinition[]>(() => {
    const nodes: ElementDefinition[] = [
      { data: { id: "project", label: project?.name ?? "Global Library", kind: "project" } }
    ];
    const edges: ElementDefinition[] = [];
    const tagIds = new Set<string>();

    for (const entry of papers) {
      nodes.push({
        data: { id: entry.paper.id, label: entry.paper.title, kind: "paper" },
        classes: entry.paper.id === selectedPaperId ? "selected" : ""
      });
      edges.push({ data: { id: `project-${entry.paper.id}`, source: "project", target: entry.paper.id, label: "contains" } });
      for (const tag of [...entry.paper.tags, ...(entry.link?.projectTags ?? [])].slice(0, 4)) {
        const tagId = `tag:${tag}`;
        if (!tagIds.has(tagId)) {
          tagIds.add(tagId);
          nodes.push({ data: { id: tagId, label: tag, kind: "tag" } });
        }
        edges.push({
          data: { id: `${entry.paper.id}-${tagId}`, source: entry.paper.id, target: tagId, label: "tagged" }
        });
      }
    }
    return [...nodes, ...edges];
  }, [papers, project?.name, selectedPaperId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "background-color": "#ffffff",
            "border-color": "#9aa8b6",
            "border-width": "1px",
            color: "#1d2733",
            "font-size": "10px",
            "text-wrap": "wrap",
            "text-max-width": "120px",
            width: "34px",
            height: "34px"
          }
        },
        {
          selector: 'node[kind = "project"]',
          style: {
            "background-color": "#2563eb",
            color: "#17202a",
            width: "46px",
            height: "46px"
          }
        },
        {
          selector: 'node[kind = "tag"]',
          style: {
            "background-color": "#e8f6ef",
            "border-color": "#16845b",
            width: "28px",
            height: "28px"
          }
        },
        {
          selector: "node.selected",
          style: {
            "border-color": "#2563eb",
            "border-width": "3px"
          }
        },
        {
          selector: "edge",
          style: {
            width: "1px",
            "line-color": "#c8d1db",
            "target-arrow-color": "#c8d1db",
            "curve-style": "bezier",
            opacity: 0.8
          }
        }
      ],
      layout: {
        name: "cose",
        animate: false,
        fit: true,
        padding: 48
      }
    });
    cy.on("tap", "node", (event) => {
      const id = event.target.id();
      if (papers.some((entry) => entry.paper.id === id)) onSelectPaper(id);
    });
    return () => cy.destroy();
  }, [elements, onSelectPaper, papers]);

  return (
    <section className="concept-map-panel">
      <div className="reader-title">
        <div>
          <h1>Concept Map</h1>
          <span>Project, paper, and tag neighborhoods</span>
        </div>
      </div>
      <div className="concept-map" ref={containerRef} />
    </section>
  );
}
