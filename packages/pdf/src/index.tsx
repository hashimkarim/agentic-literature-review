import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import {
  AreaHighlight,
  DrawingHighlight,
  FreetextHighlight,
  PdfHighlighter,
  TextHighlight,
  extractPageTextItems,
  useHighlightContainerContext
} from "react-pdf-highlighter-plus";
import type {
  AreaHighlightStyle,
  DrawingStroke,
  FreetextStyle,
  Highlight,
  LTWHP,
  PdfExtractedPage,
  PdfHighlighterUtils,
  PdfSelection,
  PdfScaleValue,
  PdfTextItem,
  Scaled,
  ScaledPosition,
  ShapeData,
  ShapeStyle,
  ShapeType,
  TextHighlightStyle,
  ViewportHighlight
} from "react-pdf-highlighter-plus";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { OnProgressParameters, PDFDocumentProxy } from "pdfjs-dist";
import { citationPageSearchOrder } from "./citation";
import "pdfjs-dist/web/pdf_viewer.css";
import "react-pdf-highlighter-plus/style/style.css";

export interface PdfHighlightRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

type AnnotationColorKey = "yellow" | "green" | "blue" | "orange" | "pink" | "purple";
type ShapeFillMode = "outline" | "tint" | "solid";

type AnnotationStyleSettings = {
  color: AnnotationColorKey;
  markOpacity: number;
  shapeFillMode: ShapeFillMode;
  shapeOpacity: number;
  strokeWidth: number;
};

export interface PdfHighlight {
  id?: string;
  activationKey?: string | number;
  page: number;
  quote: string;
  color?: AnnotationColorKey;
  rects?: PdfHighlightRect[];
  active?: boolean;
}

export interface PdfReaderProps {
  source: string;
  readOnly?: boolean;
  highlights?: PdfHighlight[];
  annotations?: PdfAnnotation[];
  onAnnotationsChange?: Dispatch<SetStateAction<PdfAnnotation[]>>;
  activeAnnotationId?: string | null;
  activeAnnotationKey?: number;
  fallback?: ReactNode;
}

type LitHighlight = Highlight & {
  litColor: NonNullable<PdfHighlight["color"]>;
  litQuote: string;
  litPage: number;
  litActive: boolean;
  litResolvedFrom: "quote" | "rect" | "page" | "selection";
  litFill?: string;
  litFillMode?: ShapeFillMode;
  litFreetextStyle?: FreetextStyle;
  litShapeStyle?: ShapeStyle;
};
export type PdfAnnotation = LitHighlight;

type AnnotationMode = "idle" | "text" | "area" | "note" | "draw" | ShapeType;

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const MIN_ARROW_HITBOX = 36;
const ARROW_EDITOR_PADDING = 14;
const MIN_SHAPE_SIZE = 20;
const DEFAULT_WORKER_SRC = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const annotationPalette: Array<{ id: AnnotationColorKey; label: string; hex: string; rgb: [number, number, number] }> = [
  { id: "yellow", label: "Yellow", hex: "#ffd666", rgb: [255, 214, 102] },
  { id: "green", label: "Green", hex: "#43b581", rgb: [67, 181, 129] },
  { id: "blue", label: "Blue", hex: "#7289da", rgb: [114, 137, 218] },
  { id: "orange", label: "Orange", hex: "#f59f45", rgb: [245, 159, 69] },
  { id: "pink", label: "Pink", hex: "#ff7aa2", rgb: [255, 122, 162] },
  { id: "purple", label: "Purple", hex: "#b084f5", rgb: [176, 132, 245] }
];

const defaultAnnotationStyle: AnnotationStyleSettings = {
  color: "yellow",
  markOpacity: 0.22,
  shapeFillMode: "outline",
  shapeOpacity: 0.18,
  strokeWidth: 2
};

const textHighlightColorPresets = annotationPalette.map((color) => rgbaFromRgb(color.rgb, defaultAnnotationStyle.markOpacity));
const areaHighlightColorPresets = annotationPalette.map((color) => rgbaFromRgb(color.rgb, 0.16));

const annotationTools: Array<{ mode: Exclude<AnnotationMode, "idle">; label: string; title: string }> = [
  { mode: "text", label: "Highlight text", title: "Select text to create a highlight" },
  { mode: "area", label: "Area", title: "Drag a rectangle over a PDF region" },
  { mode: "note", label: "Note", title: "Click the PDF to place a note" },
  { mode: "draw", label: "Draw", title: "Draw freehand on the PDF" },
  { mode: "rectangle", label: "Rect", title: "Draw a rectangle annotation" },
  { mode: "circle", label: "Circle", title: "Draw a circle annotation" },
  { mode: "arrow", label: "Arrow", title: "Draw an arrow annotation" }
];

export function PdfReader({
  source,
  readOnly = false,
  highlights = [],
  annotations,
  onAnnotationsChange,
  activeAnnotationId: controlledActiveAnnotationId = null,
  activeAnnotationKey: controlledActiveAnnotationKey = 0,
  fallback
}: PdfReaderProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<PdfScaleValue>("page-width");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("idle");
  const [annotationStyle, setAnnotationStyle] = useState<AnnotationStyleSettings>(defaultAnnotationStyle);
  const [internalAnnotations, setInternalAnnotations] = useState<PdfAnnotation[]>([]);
  const [internalActiveAnnotation, setInternalActiveAnnotation] = useState<{ id: string; version: number } | null>(null);
  const annotationsControlled = annotations !== undefined || onAnnotationsChange !== undefined;
  const manualHighlights = annotations ?? internalAnnotations;
  const setManualHighlights = onAnnotationsChange ?? setInternalAnnotations;
  const activeAnnotationId = annotationsControlled ? controlledActiveAnnotationId : internalActiveAnnotation?.id ?? null;
  const activeAnnotationKey = annotationsControlled ? controlledActiveAnnotationKey : internalActiveAnnotation?.version ?? 0;
  const handlePageStateChange = useCallback((page: number, pages: number) => {
    setCurrentPage(page);
    setPageCount(pages);
  }, []);
  const clearAnnotations = useCallback(() => {
    setManualHighlights([]);
    setInternalActiveAnnotation(null);
  }, [setManualHighlights]);
  const deleteAnnotation = useCallback((id: string) => {
    setManualHighlights((current) => current.filter((highlight) => highlight.id !== id));
    setInternalActiveAnnotation((current) => (current?.id === id ? null : current));
  }, [setManualHighlights]);
  useEffect(() => {
    setCurrentPage(1);
    setPageCount(0);
    setScale("page-width");
    setAnnotationMode("idle");
    setManualHighlights([]);
    setInternalActiveAnnotation(null);
  }, [setManualHighlights, source]);

  useEffect(() => {
    const syncPageFromDom = () => {
      const viewer = shellRef.current?.querySelector<HTMLElement>(".PdfHighlighter");
      if (!viewer) return;
      const pageNumbers = Array.from(viewer.querySelectorAll<HTMLElement>(".page[data-page-number]"))
        .map((page) => Number(page.dataset.pageNumber))
        .filter((page) => Number.isFinite(page));
      const nextPageCount = Math.max(...pageNumbers, 0);
      if (nextPageCount <= 0) return;
      const nextPage = getVisiblePageNumberFromContainer(viewer, nextPageCount);
      setPageCount((current) => (current === nextPageCount ? current : nextPageCount));
      setCurrentPage((current) => (current === nextPage ? current : nextPage));
    };

    const interval = window.setInterval(syncPageFromDom, 250);
    syncPageFromDom();
    return () => window.clearInterval(interval);
  }, [source]);

  return (
    <div ref={shellRef} className="pdf-reader-shell">
      <PdfToolbar
        scale={scale}
        setScale={setScale}
        currentPage={currentPage}
        pageCount={pageCount}
      />
      <div className="pdf-reader-main">
        <div className="pdf-reader-viewer">
          <div className="pdf-highlighter-stage">
            <PdfDocumentLoader source={source} fallback={fallback}>
              {(pdfDocument) => (
                <HighlighterSurface
                  pdfDocument={pdfDocument}
                  scale={scale}
                  highlights={highlights}
                  annotationMode={annotationMode}
                  setAnnotationMode={setAnnotationMode}
                  annotationStyle={annotationStyle}
                  manualHighlights={manualHighlights}
                  setManualHighlights={setManualHighlights}
                  activeAnnotationId={activeAnnotationId}
                  activeAnnotationKey={activeAnnotationKey}
                  onDeleteAnnotation={deleteAnnotation}
                  onPageStateChange={handlePageStateChange}
                />
              )}
            </PdfDocumentLoader>
          </div>
          {highlights.length > 0 ? (
            <div className="pdf-highlight-ledger" aria-label="PDF citation highlights">
              {highlights.map((highlight, index) => (
                <button key={`${highlight.id ?? index}-${highlight.page}`} type="button" className={`pdf-highlight pdf-${highlight.color ?? "yellow"}`}>
                  p.{highlight.page} {highlight.quote.slice(0, 96)}
                </button>
              ))}
            </div>
          ) : null}
          {!readOnly && <PdfAnnotationMenu
            annotationMode={annotationMode}
            setAnnotationMode={setAnnotationMode}
            annotationStyle={annotationStyle}
            setAnnotationStyle={setAnnotationStyle}
            annotationCount={manualHighlights.length}
            onClearAnnotations={clearAnnotations}
          />}
        </div>
      </div>
    </div>
  );
}

type PdfDocumentLoaderState =
  | { status: "loading"; progress: number | null }
  | { status: "loaded"; pdfDocument: PDFDocumentProxy }
  | { status: "error"; error: Error };

function PdfDocumentLoader({
  source,
  fallback,
  children
}: {
  source: string;
  fallback?: ReactNode;
  children: (pdfDocument: PDFDocumentProxy) => ReactNode;
}) {
  const [state, setState] = useState<PdfDocumentLoaderState>({ status: "loading", progress: null });

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;
    let task: ReturnType<typeof getDocument> | null = null;
    const controller = new AbortController();
    setState({ status: "loading", progress: null });
    GlobalWorkerOptions.workerSrc = DEFAULT_WORKER_SRC;

    async function loadPdf() {
      try {
        const response = await fetch(source, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
        const data = await readResponseBytes(response, (progress) => {
          if (!cancelled) setState({ status: "loading", progress });
        });
        if (cancelled) return;

        task = getDocument({ data });
        task.onProgress = (progress: OnProgressParameters) => {
          if (cancelled || !progress.total) return;
          setState({ status: "loading", progress: Math.min(100, Math.round((progress.loaded / progress.total) * 100)) });
        };
        const pdfDocument = await task.promise;
        loadedDocument = pdfDocument;
        if (cancelled) {
          void pdfDocument.destroy();
          return;
        }
        setState({ status: "loaded", pdfDocument });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled && message !== "Worker was destroyed" && message !== "This operation was aborted") {
          setState({ status: "error", error: error instanceof Error ? error : new Error(message) });
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      controller.abort();
      if (task) void task.destroy();
      if (loadedDocument) void loadedDocument.destroy();
    };
  }, [source]);

  if (state.status === "loaded") return children(state.pdfDocument);
  if (state.status === "error") {
    return (
      <div className="pdf-loading pdf-error">
        <strong>Could not load PDF</strong>
        <span>{state.error.message}</span>
      </div>
    );
  }

  return fallback ?? <div className="pdf-loading">Loading PDF{state.progress === null ? "..." : ` ${state.progress}%`}</div>;
}

async function readResponseBytes(response: Response, onProgress: (progress: number) => void): Promise<Uint8Array> {
  const total = Number(response.headers.get("content-length"));
  if (!response.body || !Number.isFinite(total) || total <= 0) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(Math.min(100, Math.round((loaded / total) * 100)));
  }

  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

function PdfToolbar({
  scale,
  setScale,
  currentPage,
  pageCount
}: {
  scale: PdfScaleValue;
  setScale: (scale: PdfScaleValue) => void;
  currentPage: number;
  pageCount: number;
}) {
  const [zoomDraft, setZoomDraft] = useState(formatZoom(scale));

  useEffect(() => setZoomDraft(formatZoom(scale)), [scale]);

  const setNumericZoom = (nextScale: number) => setScale(clamp(nextScale, MIN_ZOOM, MAX_ZOOM));
  const numericScale = typeof scale === "number" ? scale : 1;

  return (
    <div className="pdf-toolbar" aria-label="PDF controls">
      <div className="pdf-toolgroup pdf-zoomgroup" aria-label="Zoom controls">
        <button type="button" className="pdf-toolbtn" title="Zoom out" onClick={() => setNumericZoom(numericScale - ZOOM_STEP)}>
          -
        </button>
        <input
          className="pdf-zoom-input"
          aria-label="Zoom percentage"
          title="Zoom percentage"
          placeholder="Fit"
          value={zoomDraft}
          onFocus={(event) => {
            if (typeof scale !== "number") {
              setZoomDraft("100");
              const input = event.currentTarget;
              window.requestAnimationFrame(() => input.select());
            }
          }}
          onChange={(event) => {
            const digits = event.currentTarget.value.replace(/[^\d]/g, "");
            setZoomDraft(digits);
            if (!digits) return;
            const percentage = clamp(Number(digits), MIN_ZOOM * 100, MAX_ZOOM * 100);
            setScale(percentage / 100);
          }}
          onBlur={() => setZoomDraft(formatZoom(scale))}
        />
        {typeof scale === "number" ? <span className="pdf-zoom-unit">%</span> : null}
        <button type="button" className="pdf-toolbtn" title="Zoom in" onClick={() => setNumericZoom(numericScale + ZOOM_STEP)}>
          +
        </button>
        <button type="button" className={`pdf-toolbtn pdf-fitbtn${scale === "page-width" ? " is-active" : ""}`} onClick={() => setScale("page-width")} title="Fit width">
          Width
        </button>
      </div>
      <span className="pdf-pagecount" title="Current PDF page">
        {currentPage} / {pageCount || "-"}
      </span>
    </div>
  );
}

function PdfAnnotationMenu({
  annotationMode,
  setAnnotationMode,
  annotationStyle,
  setAnnotationStyle,
  annotationCount,
  onClearAnnotations
}: {
  annotationMode: AnnotationMode;
  setAnnotationMode: (mode: AnnotationMode) => void;
  annotationStyle: AnnotationStyleSettings;
  setAnnotationStyle: Dispatch<SetStateAction<AnnotationStyleSettings>>;
  annotationCount: number;
  onClearAnnotations: () => void;
}) {
  const [open, setOpen] = useState(false);
  const activeTool = annotationTools.find((tool) => tool.mode === annotationMode);
  const chooseMode = (mode: Exclude<AnnotationMode, "idle">) => {
    setAnnotationMode(mode);
    setOpen(false);
  };
  const cancelMode = () => {
    setAnnotationMode("idle");
    setOpen(false);
  };
  const clearAnnotations = () => {
    onClearAnnotations();
    setOpen(false);
  };
  const setColor = (color: AnnotationColorKey) => {
    setAnnotationStyle((current) => ({ ...current, color }));
  };
  const setMarkOpacity = (markOpacity: number) => {
    setAnnotationStyle((current) => ({ ...current, markOpacity }));
  };
  const setShapeFillMode = (shapeFillMode: ShapeFillMode) => {
    setAnnotationStyle((current) => ({
      ...current,
      shapeFillMode,
      shapeOpacity: shapeFillMode === "solid" ? Math.max(current.shapeOpacity, 0.42) : current.shapeOpacity
    }));
  };
  const setShapeOpacity = (shapeOpacity: number) => {
    setAnnotationStyle((current) => ({ ...current, shapeOpacity }));
  };
  const setStrokeWidth = (strokeWidth: number) => {
    setAnnotationStyle((current) => ({ ...current, strokeWidth }));
  };

  return (
    <div className="pdf-annotation-menu">
      {open ? (
        <div className="pdf-annotation-popover" role="menu" aria-label="Annotation tools">
          <div className="pdf-annotation-popover-head">
            <span>{activeTool ? activeTool.label : "Add annotation"}</span>
            {annotationMode !== "idle" ? (
              <button type="button" onClick={cancelMode}>
                Cancel
              </button>
            ) : null}
          </div>
          <div className="pdf-annotation-toolgrid">
            {annotationTools.map((tool) => (
              <button
                key={tool.mode}
                type="button"
                role="menuitemradio"
                aria-checked={annotationMode === tool.mode}
                className={`pdf-annotation-tool${annotationMode === tool.mode ? " is-active" : ""}`}
                title={tool.title}
                onClick={() => chooseMode(tool.mode)}
              >
                <span>{tool.label}</span>
              </button>
            ))}
          </div>
          <div className="pdf-annotation-section">
            <span className="pdf-annotation-section-label">Color</span>
            <div className="pdf-annotation-swatches" aria-label="Annotation color">
              {annotationPalette.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  className={`pdf-annotation-swatch${annotationStyle.color === color.id ? " is-active" : ""}`}
                  style={{ backgroundColor: color.hex }}
                  title={color.label}
                  aria-label={color.label}
                  onClick={() => setColor(color.id)}
                />
              ))}
            </div>
          </div>
          <label className="pdf-annotation-slider">
            <span>Highlight opacity</span>
            <input
              type="range"
              min="8"
              max="45"
              step="1"
              value={Math.round(annotationStyle.markOpacity * 100)}
              onChange={(event) => setMarkOpacity(Number(event.currentTarget.value) / 100)}
            />
            <strong>{Math.round(annotationStyle.markOpacity * 100)}%</strong>
          </label>
          <div className="pdf-annotation-section">
            <span className="pdf-annotation-section-label">Shape fill</span>
            <div className="pdf-annotation-segmented" aria-label="Shape fill mode">
              {[
                { id: "outline", label: "Outline" },
                { id: "tint", label: "Tint" },
                { id: "solid", label: "Solid" }
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={annotationStyle.shapeFillMode === option.id ? "is-active" : ""}
                  onClick={() => setShapeFillMode(option.id as ShapeFillMode)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className={`pdf-annotation-slider${annotationStyle.shapeFillMode === "outline" ? " is-disabled" : ""}`}>
            <span>Fill opacity</span>
            <input
              type="range"
              min="8"
              max="60"
              step="1"
              disabled={annotationStyle.shapeFillMode === "outline"}
              value={Math.round(annotationStyle.shapeOpacity * 100)}
              onChange={(event) => setShapeOpacity(Number(event.currentTarget.value) / 100)}
            />
            <strong>{annotationStyle.shapeFillMode === "outline" ? "0%" : `${Math.round(annotationStyle.shapeOpacity * 100)}%`}</strong>
          </label>
          <div className="pdf-annotation-section">
            <span className="pdf-annotation-section-label">Stroke</span>
            <div className="pdf-annotation-strokes" aria-label="Annotation stroke width">
              {[1, 2, 3, 4].map((width) => (
                <button
                  key={width}
                  type="button"
                  className={annotationStyle.strokeWidth === width ? "is-active" : ""}
                  title={`${width}px stroke`}
                  onClick={() => setStrokeWidth(width)}
                >
                  {width}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="pdf-annotation-clear" disabled={annotationCount === 0} onClick={clearAnnotations}>
            Clear local annotations{annotationCount ? ` (${annotationCount})` : ""}
          </button>
        </div>
      ) : null}
      {activeTool ? <div className="pdf-annotation-active">{activeTool.label}</div> : null}
      <button
        type="button"
        className={`pdf-annotation-fab${open ? " is-open" : ""}${activeTool ? " is-active" : ""}`}
        aria-label={open ? "Close annotation tools" : "Open annotation tools"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "x" : "+"}
      </button>
    </div>
  );
}

function IsolatedReactRoot({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const container = document.createElement("div");
    container.style.height = "100%";
    host.appendChild(container);
    const root = createRoot(container);
    rootRef.current = root;
    return () => {
      rootRef.current = null;
      // A nested root cannot unmount synchronously during its parent's commit.
      // Detach its own container; let React remove its children after the commit.
      container.remove();
      queueMicrotask(() => root.unmount());
    };
  }, []);

  useLayoutEffect(() => {
    rootRef.current?.render(<>{children}</>);
  }, [children]);

  return <div ref={hostRef} className="pdf-isolated-root" />;
}

function pdfDocumentKey(pdfDocument: PDFDocumentProxy): string {
  const fingerprint = pdfDocument.fingerprints.filter((value): value is string => !!value).join(":");
  return fingerprint || `pages-${pdfDocument.numPages}`;
}

function getVisiblePageNumberFromContainer(container: HTMLElement, pageCount: number, fallback = 1): number {
  const containerRect = container.getBoundingClientRect();
  const pages = Array.from(container.querySelectorAll<HTMLElement>(".page[data-page-number]"));
  let bestPage = normalizePageNumber(fallback, pageCount);
  let bestVisibleHeight = 0;

  for (const page of pages) {
    const pageNumber = Number(page.dataset.pageNumber);
    if (!Number.isFinite(pageNumber)) continue;
    const pageRect = page.getBoundingClientRect();
    const visibleHeight = Math.min(pageRect.bottom, containerRect.bottom) - Math.max(pageRect.top, containerRect.top);
    if (visibleHeight > bestVisibleHeight) {
      bestVisibleHeight = visibleHeight;
      bestPage = normalizePageNumber(pageNumber, pageCount);
    }
  }

  return bestPage;
}

function HighlighterSurface({
  pdfDocument,
  scale,
  highlights,
  annotationMode,
  setAnnotationMode,
  annotationStyle,
  manualHighlights,
  setManualHighlights,
  activeAnnotationId,
  activeAnnotationKey,
  onDeleteAnnotation,
  onPageStateChange
}: {
  pdfDocument: PDFDocumentProxy;
  scale: PdfScaleValue;
  highlights: PdfHighlight[];
  annotationMode: AnnotationMode;
  setAnnotationMode: (mode: AnnotationMode) => void;
  annotationStyle: AnnotationStyleSettings;
  manualHighlights: LitHighlight[];
  setManualHighlights: Dispatch<SetStateAction<LitHighlight[]>>;
  activeAnnotationId: string | null;
  activeAnnotationKey: number;
  onDeleteAnnotation: (id: string) => void;
  onPageStateChange: (currentPage: number, pageCount: number) => void;
}) {
  const utilsRef = useRef<PdfHighlighterUtils | null>(null);
  const [utils, setUtils] = useState<PdfHighlighterUtils | null>(null);
  const [resolvedHighlights, setResolvedHighlights] = useState<LitHighlight[]>([]);
  const documentKey = useMemo(() => pdfDocumentKey(pdfDocument), [pdfDocument]);
  const highlightsKey = useMemo(() => serializeHighlights(highlights), [highlights]);
  const renderedHighlights = useMemo(() => [...resolvedHighlights, ...manualHighlights], [manualHighlights, resolvedHighlights]);
  const selectedHexColor = paletteHex(annotationStyle.color);
  const selectedMarkColor = paletteRgba(annotationStyle.color, annotationStyle.markOpacity);
  const selectedAreaColor = paletteRgba(annotationStyle.color, Math.max(0.12, annotationStyle.markOpacity - 0.04));
  const selectedShapeFill = shapeFillColor(annotationStyle);
  const activeHighlight = useMemo(
    () =>
      (activeAnnotationId ? manualHighlights.find((highlight) => highlight.id === activeAnnotationId) : null) ??
      resolvedHighlights.find((highlight) => highlight.litActive) ??
      resolvedHighlights[0] ??
      null,
    [activeAnnotationId, manualHighlights, resolvedHighlights]
  );

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const next: LitHighlight[] = [];
      for (const [index, highlight] of highlights.entries()) {
        const resolved = await resolveHighlight(pdfDocument, highlight, index).catch(() => null);
        if (resolved) next.push(resolved);
      }
      if (!cancelled) setResolvedHighlights(next);
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, highlightsKey]);

  useEffect(() => {
    if (!utils || !activeHighlight) return;
    const frame = window.requestAnimationFrame(() => utils.scrollToHighlight(activeHighlight));
    return () => window.cancelAnimationFrame(frame);
  }, [activeAnnotationKey, activeHighlight?.id, activeHighlight?.litResolvedFrom, utils]);

  useEffect(() => {
    if (!utils) return;
    const viewer = utils.getViewer() as { currentScaleValue: string; currentPageNumber?: number } | null;
    if (!viewer) return;

    const currentPage = viewer.currentPageNumber ?? 1;
    viewer.currentScaleValue = scale.toString();
    const frame = window.requestAnimationFrame(() => onPageStateChange(viewer.currentPageNumber ?? currentPage, pdfDocument.numPages));
    return () => window.cancelAnimationFrame(frame);
  }, [pdfDocument.numPages, onPageStateChange, scale, utils]);

  const updateManualHighlight = useCallback((id: string, updater: (highlight: LitHighlight) => LitHighlight) => {
    setManualHighlights((current) => current.map((highlight) => (highlight.id === id ? updater(highlight) : highlight)));
  }, []);

  const handleSelection = useCallback((selection: PdfSelection) => {
    const pageNumber = selection.position.boundingRect.pageNumber;
    if (selection.type === "area") {
      setManualHighlights((current) => [
        ...current,
        createManualHighlight({
          type: "area",
          position: selection.position,
          text: selection.content.text ?? "Area highlight",
          fill: selectedAreaColor,
          pageNumber
        })
      ]);
      selection.makeGhostHighlight();
      window.setTimeout(() => utilsRef.current?.removeGhostHighlight(), 0);
      setAnnotationMode("idle");
      return;
    }

    if (annotationMode !== "text" || selection.type !== "text") return;
    const text = selection.content.text?.trim();
    if (!text) return;

    setManualHighlights((current) => [
      ...current,
      createManualHighlight({
        type: "text",
        position: selection.position,
        text,
        fill: selectedMarkColor,
        pageNumber
      })
    ]);
    window.getSelection()?.removeAllRanges();
    setAnnotationMode("idle");
  }, [annotationMode, selectedAreaColor, selectedMarkColor, setAnnotationMode, setManualHighlights]);

  const handleFreetextClick = useCallback((position: ScaledPosition) => {
    setManualHighlights((current) => [
      ...current,
      createManualHighlight({
        type: "freetext",
        position,
        text: "Note",
        fill: paletteRgba(annotationStyle.color, 0.28),
        pageNumber: position.boundingRect.pageNumber,
        freetextStyle: {
          color: "#24262d",
          backgroundColor: paletteRgba(annotationStyle.color, 0.72),
          fontSize: "14px",
          fontFamily: "Inter, sans-serif"
        }
      })
    ]);
    setAnnotationMode("idle");
  }, [annotationStyle.color, setAnnotationMode, setManualHighlights]);

  const handleDrawingComplete = useCallback((image: string, position: ScaledPosition, strokes: DrawingStroke[]) => {
    setManualHighlights((current) => [
      ...current,
      createManualHighlight({
        type: "drawing",
        position,
        text: "Drawing",
        fill: paletteRgba(annotationStyle.color, annotationStyle.markOpacity),
        pageNumber: position.boundingRect.pageNumber,
        content: { image, strokes }
      })
    ]);
    setAnnotationMode("idle");
  }, [annotationStyle.color, annotationStyle.markOpacity, setAnnotationMode, setManualHighlights]);

  const handleShapeComplete = useCallback((position: ScaledPosition, shape: ShapeData) => {
    const normalizedShape = normalizeShapePosition(position, shape);
    setManualHighlights((current) => [
      ...current,
      createManualHighlight({
        type: "shape",
        position: normalizedShape.position,
        text: `${shape.shapeType} annotation`,
        fill: selectedShapeFill,
        pageNumber: normalizedShape.position.boundingRect.pageNumber,
        content: {
          shape: {
            ...normalizedShape.shape,
            strokeColor: selectedHexColor,
            strokeWidth: annotationStyle.strokeWidth
          }
        },
        fillMode: annotationStyle.shapeFillMode,
        shapeStyle: {
          strokeColor: selectedHexColor,
          strokeWidth: annotationStyle.strokeWidth
        }
      })
    ]);
    setAnnotationMode("idle");
  }, [annotationStyle.shapeFillMode, annotationStyle.strokeWidth, selectedHexColor, selectedShapeFill, setAnnotationMode, setManualHighlights]);

  return (
    <div className="pdf-highlighter-host">
      <IsolatedReactRoot key={documentKey}>
        <PdfHighlighter
          highlights={renderedHighlights}
          pdfDocument={pdfDocument}
          pdfScaleValue={scale}
          textSelectionColor={annotationMode === "text" ? paletteRgba(annotationStyle.color, Math.min(0.32, annotationStyle.markOpacity + 0.08)) : "transparent"}
          onSelection={handleSelection}
          enableAreaSelection={() => annotationMode === "area"}
          areaSelectionMode={annotationMode === "area"}
          mouseSelectionStyle={{
            background: paletteRgba(annotationStyle.color, Math.max(0.08, annotationStyle.markOpacity - 0.08)),
            border: `1px solid ${selectedHexColor}`
          }}
          enableFreetextCreation={() => annotationMode === "note"}
          onFreetextClick={handleFreetextClick}
          enableDrawingMode={annotationMode === "draw"}
          drawingStrokeColor={selectedHexColor}
          drawingStrokeWidth={annotationStyle.strokeWidth}
          onDrawingComplete={handleDrawingComplete}
          onDrawingCancel={() => setAnnotationMode("idle")}
          enableShapeMode={shapeMode(annotationMode)}
          shapeStrokeColor={selectedHexColor}
          shapeStrokeWidth={annotationStyle.strokeWidth}
          onShapeComplete={handleShapeComplete}
          onShapeCancel={() => setAnnotationMode("idle")}
          utilsRef={(nextUtils) => {
            utilsRef.current = nextUtils;
            setUtils((current) => (current === nextUtils ? current : nextUtils));
          }}
          style={{ backgroundColor: "var(--bg-tertiary)" }}
          theme={{
            mode: "light",
            containerBackgroundColor: "var(--bg-tertiary)",
            scrollbarThumbColor: "var(--accent-primary)",
            scrollbarTrackColor: "var(--bg-secondary)"
          }}
        >
          <AnnotationRenderer
            onUpdate={updateManualHighlight}
            onDelete={onDeleteAnnotation}
          />
        </PdfHighlighter>
      </IsolatedReactRoot>
    </div>
  );
}

function AnnotationRenderer({
  onUpdate,
  onDelete
}: {
  onUpdate: (id: string, updater: (highlight: LitHighlight) => LitHighlight) => void;
  onDelete: (id: string) => void;
}) {
  const { highlight, isScrolledTo, viewportToScaled } = useHighlightContainerContext<LitHighlight>();
  const isManual = highlight.id.startsWith("manual-");
  const updateSingleRect = (rect: LTWHP) => {
    const scaled = viewportToScaled(rect);
    onUpdate(highlight.id, (current) => ({
      ...current,
      position: {
        boundingRect: scaled,
        rects: current.type === "area" || current.type === "freetext" || current.type === "drawing" || current.type === "shape" ? [] : [scaled]
      }
    }));
  };

  if (highlight.type === "area") {
    return (
      <AreaHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        highlightColor={highlight.litFill ?? "rgba(114, 137, 218, 0.18)"}
        copyText={highlight.litQuote}
        colorPresets={areaHighlightColorPresets}
        {...(isManual
          ? {
              onChange: updateSingleRect,
              onDelete: () => onDelete(highlight.id),
              onStyleChange: (style: AreaHighlightStyle) =>
                onUpdate(highlight.id, (current) => ({
                  ...current,
                  ...(style.highlightColor ? { litFill: colorWithOpacity(style.highlightColor, 0.16) } : {})
                }))
            }
          : {})}
      />
    );
  }

  if (highlight.type === "freetext") {
    return (
      <FreetextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        color={highlight.litFreetextStyle?.color ?? "#24262d"}
        backgroundColor={highlight.litFreetextStyle?.backgroundColor ?? "#fff3b0"}
        fontFamily={highlight.litFreetextStyle?.fontFamily ?? "Inter, sans-serif"}
        fontSize={highlight.litFreetextStyle?.fontSize ?? "14px"}
        compact={false}
        {...(isManual
          ? {
              onChange: updateSingleRect,
              onTextChange: (text: string) =>
                onUpdate(highlight.id, (current) => ({
                  ...current,
                  content: { ...(current.content ?? {}), text },
                  litQuote: text
                })),
              onStyleChange: (style: FreetextStyle) =>
                onUpdate(highlight.id, (current) => ({
                  ...current,
                  litFreetextStyle: { ...(current.litFreetextStyle ?? {}), ...style }
                })),
              onDelete: () => onDelete(highlight.id)
            }
          : {})}
      />
    );
  }

  if (highlight.type === "drawing") {
    return (
      <DrawingHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        {...(isManual
          ? {
              onChange: updateSingleRect,
              onStyleChange: (image: string, strokes: DrawingStroke[]) =>
                onUpdate(highlight.id, (current) => ({
                  ...current,
                  content: { ...(current.content ?? {}), image, strokes }
                })),
              onDelete: () => onDelete(highlight.id)
            }
          : {})}
      />
    );
  }

  if (highlight.type === "shape") {
    const shape = highlight.content?.shape;
    if (shape?.shapeType === "arrow") {
      return (
        <ArrowShapeEditor
          highlight={highlight}
          isScrolledTo={isScrolledTo}
          isManual={isManual}
          strokeColor={highlight.litShapeStyle?.strokeColor ?? shape.strokeColor ?? "#7289da"}
          strokeWidth={highlight.litShapeStyle?.strokeWidth ?? shape.strokeWidth ?? 2}
          viewportToScaled={viewportToScaled}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      );
    }

    return (
      <BoxShapeEditor
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        isManual={isManual}
        shapeType={shape?.shapeType === "circle" ? "circle" : "rectangle"}
        fillColor={highlight.litFill ?? "transparent"}
        strokeColor={highlight.litShapeStyle?.strokeColor ?? shape?.strokeColor ?? "#7289da"}
        strokeWidth={highlight.litShapeStyle?.strokeWidth ?? shape?.strokeWidth ?? 2}
        viewportToScaled={viewportToScaled}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    );
  }

  return (
    <TextHighlight
      highlight={highlight}
      isScrolledTo={isScrolledTo}
      highlightColor={highlight.litFill ?? highlightColor(highlight.litColor)}
      copyText={highlight.litQuote}
      colorPresets={textHighlightColorPresets}
        style={{
          borderRadius: 2,
          boxShadow: isScrolledTo ? `inset 0 0 0 1px ${highlightBorderColor(highlight.litColor)}` : undefined
        }}
      {...(isManual
        ? {
            onDelete: () => onDelete(highlight.id),
            onStyleChange: (style: TextHighlightStyle) =>
              onUpdate(highlight.id, (current) => ({
                ...current,
                ...(style.highlightColor ? { litFill: colorWithOpacity(style.highlightColor, defaultAnnotationStyle.markOpacity) } : {})
              }))
          }
        : {})}
    />
  );
}

type ArrowEndpoint = "start" | "end";
type ArrowPoint = { x: number; y: number };
type BoxShapeType = Extract<ShapeType, "rectangle" | "circle">;
type BoxResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const boxResizeHandles: Array<{ id: BoxResizeHandle; label: string }> = [
  { id: "nw", label: "Resize top left" },
  { id: "n", label: "Resize top" },
  { id: "ne", label: "Resize top right" },
  { id: "e", label: "Resize right" },
  { id: "se", label: "Resize bottom right" },
  { id: "s", label: "Resize bottom" },
  { id: "sw", label: "Resize bottom left" },
  { id: "w", label: "Resize left" }
];

function BoxShapeEditor({
  highlight,
  isScrolledTo,
  isManual,
  shapeType,
  fillColor,
  strokeColor,
  strokeWidth,
  viewportToScaled,
  onUpdate,
  onDelete
}: {
  highlight: ViewportHighlight<LitHighlight>;
  isScrolledTo: boolean;
  isManual: boolean;
  shapeType: BoxShapeType;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  viewportToScaled: (rect: LTWHP) => Scaled;
  onUpdate: (id: string, updater: (highlight: LitHighlight) => LitHighlight) => void;
  onDelete: (id: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const rect = highlight.position.boundingRect;

  const commitBox = useCallback((nextRect: LTWHP) => {
    const scaled = viewportToScaled(nextRect);
    onUpdate(highlight.id, (current) => {
      const currentShape = current.content?.shape;
      return {
        ...current,
        position: {
          ...current.position,
          boundingRect: scaled,
          rects: []
        },
        content: {
          ...(current.content ?? {}),
          shape: {
            ...(currentShape ?? { shapeType, strokeColor, strokeWidth }),
            shapeType,
            strokeColor,
            strokeWidth
          }
        },
        litFill: fillColor,
        litShapeStyle: {
          ...(current.litShapeStyle ?? {}),
          strokeColor,
          strokeWidth
        }
      };
    });
  }, [fillColor, highlight.id, onUpdate, shapeType, strokeColor, strokeWidth, viewportToScaled]);

  const startMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isManual || event.button !== 0 || isBoxShapeControl(event.target)) return;
    event.preventDefault();
    event.stopPropagation();

    const pageBounds = getArrowPageBounds(editorRef.current);
    const baseClient = { x: event.clientX, y: event.clientY };
    const baseRect = rect;

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      commitBox(
        clampViewportRectToPage(
          {
            ...baseRect,
            left: baseRect.left + moveEvent.clientX - baseClient.x,
            top: baseRect.top + moveEvent.clientY - baseClient.y
          },
          pageBounds
        )
      );
    };

    attachWindowPointerDrag(handleMove);
  };

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, handle: BoxResizeHandle) => {
    if (!isManual || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const pageBounds = getArrowPageBounds(editorRef.current);
    const baseClient = { x: event.clientX, y: event.clientY };
    const baseRect = rect;

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      commitBox(
        resizeViewportRect(
          baseRect,
          handle,
          moveEvent.clientX - baseClient.x,
          moveEvent.clientY - baseClient.y,
          pageBounds
        )
      );
    };

    attachWindowPointerDrag(handleMove);
  };

  return (
    <div
      ref={editorRef}
      className={`pdf-shape-editor ${shapeType}${isManual ? " is-editable" : ""}${isScrolledTo ? " is-scrolled" : ""}`}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }}
      onPointerDown={startMove}
    >
      <div
        className="pdf-shape-box"
        style={{
          borderColor: strokeColor,
          borderWidth: strokeWidth,
          backgroundColor: fillColor,
          borderRadius: shapeType === "circle" ? 999 : 3
        }}
        aria-hidden="true"
      />
      {isManual ? (
        <>
          {boxResizeHandles.map((handle) => (
            <button
              key={handle.id}
              type="button"
              className={`pdf-shape-handle pdf-shape-control ${handle.id}`}
              aria-label={handle.label}
              title={handle.label}
              onPointerDown={(event) => startResize(event, handle.id)}
            />
          ))}
          <button
            type="button"
            className="pdf-shape-delete pdf-shape-control"
            aria-label="Delete shape annotation"
            title="Delete shape annotation"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(highlight.id);
            }}
          >
            x
          </button>
        </>
      ) : null}
    </div>
  );
}

function ArrowShapeEditor({
  highlight,
  isScrolledTo,
  isManual,
  strokeColor,
  strokeWidth,
  viewportToScaled,
  onUpdate,
  onDelete
}: {
  highlight: ViewportHighlight<LitHighlight>;
  isScrolledTo: boolean;
  isManual: boolean;
  strokeColor: string;
  strokeWidth: number;
  viewportToScaled: (rect: LTWHP) => Scaled;
  onUpdate: (id: string, updater: (highlight: LitHighlight) => LitHighlight) => void;
  onDelete: (id: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const rect = highlight.position.boundingRect;
  const shape = highlight.content?.shape;
  const startPoint = normalizeArrowPoint(shape?.startPoint ?? { x: 0, y: 0.5 });
  const endPoint = normalizeArrowPoint(shape?.endPoint ?? { x: 1, y: 0.5 });
  const startLocal = toLocalArrowPoint(rect, startPoint);
  const endLocal = toLocalArrowPoint(rect, endPoint);
  const markerId = useMemo(() => `pdf-arrow-marker-${sanitizeDomId(highlight.id)}`, [highlight.id]);

  const commitArrow = useCallback((nextRect: LTWHP, start: ArrowPoint, end: ArrowPoint) => {
    const nextShape: ShapeData = {
      ...(shape ?? { shapeType: "arrow", strokeColor, strokeWidth }),
      shapeType: "arrow",
      strokeColor,
      strokeWidth,
      startPoint: toRelativeArrowPoint(nextRect, start),
      endPoint: toRelativeArrowPoint(nextRect, end)
    };
    const scaled = viewportToScaled(nextRect);

    onUpdate(highlight.id, (current) => ({
      ...current,
      position: {
        ...current.position,
        boundingRect: scaled,
        rects: []
      },
      content: {
        ...(current.content ?? {}),
        shape: nextShape
      },
      litShapeStyle: {
        ...(current.litShapeStyle ?? {}),
        strokeColor,
        strokeWidth
      }
    }));
  }, [highlight.id, onUpdate, shape, strokeColor, strokeWidth, viewportToScaled]);

  const startBodyDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isManual || event.button !== 0 || isArrowControl(event.target)) return;
    event.preventDefault();
    event.stopPropagation();

    const pageBounds = getArrowPageBounds(editorRef.current);
    const baseClient = { x: event.clientX, y: event.clientY };
    const baseRect = rect;
    const baseStart = { x: baseRect.left + startLocal.x, y: baseRect.top + startLocal.y };
    const baseEnd = { x: baseRect.left + endLocal.x, y: baseRect.top + endLocal.y };

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const requestedRect = {
        ...baseRect,
        left: baseRect.left + moveEvent.clientX - baseClient.x,
        top: baseRect.top + moveEvent.clientY - baseClient.y
      };
      const nextRect = clampViewportRectToPage(requestedRect, pageBounds);
      const appliedDx = nextRect.left - baseRect.left;
      const appliedDy = nextRect.top - baseRect.top;
      commitArrow(
        nextRect,
        { x: baseStart.x + appliedDx, y: baseStart.y + appliedDy },
        { x: baseEnd.x + appliedDx, y: baseEnd.y + appliedDy }
      );
    };

    attachWindowPointerDrag(handleMove);
  };

  const startEndpointDrag = (event: ReactPointerEvent<HTMLButtonElement>, endpoint: ArrowEndpoint) => {
    if (!isManual || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const pageBounds = getArrowPageBounds(editorRef.current);
    const baseClient = { x: event.clientX, y: event.clientY };
    const baseStart = { x: rect.left + startLocal.x, y: rect.top + startLocal.y };
    const baseEnd = { x: rect.left + endLocal.x, y: rect.top + endLocal.y };
    const moving = endpoint === "start" ? baseStart : baseEnd;

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const movedPoint = clampArrowPointToPage(
        {
          x: moving.x + moveEvent.clientX - baseClient.x,
          y: moving.y + moveEvent.clientY - baseClient.y
        },
        pageBounds
      );
      const nextStart = endpoint === "start" ? movedPoint : baseStart;
      const nextEnd = endpoint === "end" ? movedPoint : baseEnd;
      const nextRect = arrowRectFromPoints(nextStart, nextEnd, rect.pageNumber, strokeWidth, pageBounds);
      commitArrow(nextRect, nextStart, nextEnd);
    };

    attachWindowPointerDrag(handleMove);
  };

  return (
    <div
      ref={editorRef}
      className={`pdf-arrow-editor${isManual ? " is-editable" : ""}${isScrolledTo ? " is-scrolled" : ""}`}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }}
      onPointerDown={startBodyDrag}
    >
      <div className="pdf-arrow-frame" aria-hidden="true" />
      <svg className="pdf-arrow-svg" aria-hidden="true" focusable="false" viewBox={`0 0 ${rect.width} ${rect.height}`} preserveAspectRatio="none">
        <defs>
          <marker
            id={markerId}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,4 L0,8 z" fill={strokeColor} />
          </marker>
        </defs>
        <line
          x1={startLocal.x}
          y1={startLocal.y}
          x2={endLocal.x}
          y2={endLocal.y}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          markerEnd={`url(#${markerId})`}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {isManual ? (
        <>
          <button
            type="button"
            className="pdf-arrow-handle pdf-arrow-control start"
            aria-label="Move arrow start"
            title="Move arrow start"
            style={{ left: startLocal.x, top: startLocal.y }}
            onPointerDown={(event) => startEndpointDrag(event, "start")}
          />
          <button
            type="button"
            className="pdf-arrow-handle pdf-arrow-control end"
            aria-label="Move arrow end"
            title="Move arrow end"
            style={{ left: endLocal.x, top: endLocal.y }}
            onPointerDown={(event) => startEndpointDrag(event, "end")}
          />
          <button
            type="button"
            className="pdf-arrow-delete pdf-arrow-control"
            aria-label="Delete arrow annotation"
            title="Delete arrow annotation"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(highlight.id);
            }}
          >
            x
          </button>
        </>
      ) : null}
    </div>
  );
}

async function resolveHighlight(pdfDocument: PDFDocumentProxy, highlight: PdfHighlight, index: number): Promise<LitHighlight> {
  const requestedPageNumber = normalizePageNumber(highlight.page, pdfDocument.numPages);
  const quoteResolution = highlight.quote.trim()
    ? await resolveQuoteAcrossDocument(pdfDocument, requestedPageNumber, highlight.quote)
    : null;
  const page = quoteResolution?.page ?? await readExtractedPage(pdfDocument, requestedPageNumber);
  const quotePosition = quoteResolution?.position ?? null;
  const rectPosition = quotePosition ?? resolveRectPosition(page, highlight.rects ?? []);
  const position = rectPosition ?? pageTopPosition(page);

  return {
    id: makeHighlightId(highlight, index),
    type: "text",
    content: { text: highlight.quote },
    position,
    litColor: highlight.color ?? "yellow",
    litQuote: highlight.quote,
    litPage: page.pageNumber,
    litActive: Boolean(highlight.active),
    litResolvedFrom: quotePosition ? "quote" : rectPosition ? "rect" : "page"
  };
}

const extractedPageCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PdfExtractedPage>>>();

async function resolveQuoteAcrossDocument(
  pdfDocument: PDFDocumentProxy,
  requestedPage: number,
  quote: string
): Promise<{ page: PdfExtractedPage; position: ScaledPosition } | null> {
  for (const pageNumber of citationPageSearchOrder(requestedPage, pdfDocument.numPages)) {
    const page = await readExtractedPage(pdfDocument, pageNumber);
    const position = resolveQuotePosition(page, quote);
    if (position) return { page, position };
  }
  return null;
}

async function readExtractedPage(pdfDocument: PDFDocumentProxy, pageNumber: number): Promise<PdfExtractedPage> {
  let documentCache = extractedPageCache.get(pdfDocument);
  if (!documentCache) {
    documentCache = new Map();
    extractedPageCache.set(pdfDocument, documentCache);
  }
  const cached = documentCache.get(pageNumber);
  if (cached) return cached;
  const pending = extractPageTextItems(pdfDocument, {
    pages: [pageNumber],
    columnDetection: "none"
  }).then((pages) => pages[0] ?? {
    pageNumber,
    width: 612,
    height: 792,
    textItems: []
  });
  documentCache.set(pageNumber, pending);
  try {
    return await pending;
  } catch (error) {
    documentCache.delete(pageNumber);
    throw error;
  }
}

function resolveQuotePosition(page: PdfExtractedPage, quote: string): ScaledPosition | null {
  const comparable = buildComparableTextMap(page.textItems);
  const needle = normalizeComparable(quote);
  if (!needle || !comparable.value) return null;

  const match = findComparableMatch(comparable.value, needle);
  if (!match) return null;

  const selectedEntries = comparable.map.slice(match.start, match.end);
  const rects = rectsForComparableEntries(page, selectedEntries);
  if (!rects.length) return null;
  return scaledPositionFromRects(page, rects);
}

function resolveRectPosition(page: PdfExtractedPage, rects: PdfHighlightRect[]): ScaledPosition | null {
  const pageRects = rects
    .filter((rect) => rect.page === page.pageNumber && rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      pageNumber: rect.page,
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height
    }));
  if (!pageRects.length) return null;
  return scaledPositionFromRects(page, mergeLineRects(pageRects));
}

function pageTopPosition(page: PdfExtractedPage): ScaledPosition {
  const topRect: LTWHP = {
    pageNumber: page.pageNumber,
    left: 0,
    top: 0,
    width: 1,
    height: 1
  };
  return scaledPositionFromRects(page, [topRect]);
}

type ComparableEntry = {
  itemIndex: number;
  charIndex: number;
};

function buildComparableTextMap(textItems: PdfTextItem[]): { value: string; map: ComparableEntry[] } {
  let value = "";
  const map: ComparableEntry[] = [];

  for (const item of textItems) {
    const chars = Array.from(item.text);
    for (const [charIndex, char] of chars.entries()) {
      const normalized = normalizeChar(char);
      for (const normalizedChar of normalized) {
        if (!/[\p{Letter}\p{Number}]/u.test(normalizedChar)) continue;
        value += normalizedChar;
        map.push({ itemIndex: item.index, charIndex });
      }
    }
  }

  return { value, map };
}

function normalizeComparable(input: string): string {
  let value = "";
  for (const char of Array.from(input)) {
    const normalized = normalizeChar(char);
    for (const normalizedChar of normalized) {
      if (/[\p{Letter}\p{Number}]/u.test(normalizedChar)) value += normalizedChar;
    }
  }
  return value;
}

function normalizeChar(char: string): string {
  return char
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬀ/g, "ff")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase();
}

function findComparableMatch(haystack: string, needle: string): { start: number; end: number } | null {
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };

  const maxProbeLength = Math.min(needle.length, 320);
  for (let probeLength = maxProbeLength; probeLength >= 80; probeLength -= 40) {
    const prefix = needle.slice(0, probeLength);
    const prefixIndex = haystack.indexOf(prefix);
    if (prefixIndex >= 0) {
      return { start: prefixIndex, end: Math.min(prefixIndex + needle.length, haystack.length) };
    }
  }

  return null;
}

function rectsForComparableEntries(page: PdfExtractedPage, entries: ComparableEntry[]): LTWHP[] {
  const byItem = new Map<number, { start: number; end: number }>();
  for (const entry of entries) {
    const range = byItem.get(entry.itemIndex);
    if (range) {
      range.start = Math.min(range.start, entry.charIndex);
      range.end = Math.max(range.end, entry.charIndex + 1);
    } else {
      byItem.set(entry.itemIndex, { start: entry.charIndex, end: entry.charIndex + 1 });
    }
  }

  const rects: LTWHP[] = [];
  const textItemsByIndex = new Map(page.textItems.map((item) => [item.index, item]));
  for (const [itemIndex, range] of byItem) {
    const item = textItemsByIndex.get(itemIndex);
    if (!item || item.rect.width <= 0 || item.rect.height <= 0) continue;

    const charCount = Math.max(Array.from(item.text).length, 1);
    const start = clamp(range.start, 0, charCount);
    const end = clamp(range.end, start + 1, charCount);
    const charWidth = item.rect.width / charCount;

    rects.push({
      pageNumber: page.pageNumber,
      left: item.rect.left + start * charWidth,
      top: item.rect.top,
      width: Math.max((end - start) * charWidth, 1),
      height: item.rect.height
    });
  }

  return mergeLineRects(rects);
}

function mergeLineRects(rects: LTWHP[]): LTWHP[] {
  const sorted = [...rects].sort((a, b) => {
    const topDelta = a.top - b.top;
    if (Math.abs(topDelta) > 2) return topDelta;
    return a.left - b.left;
  });
  const merged: LTWHP[] = [];

  for (const rect of sorted) {
    const current = merged[merged.length - 1];
    if (!current || !sameVisualLine(current, rect) || rect.left - (current.left + current.width) > 14) {
      merged.push({ ...rect });
      continue;
    }

    const right = Math.max(current.left + current.width, rect.left + rect.width);
    const bottom = Math.max(current.top + current.height, rect.top + rect.height);
    current.left = Math.min(current.left, rect.left);
    current.top = Math.min(current.top, rect.top);
    current.width = right - current.left;
    current.height = bottom - current.top;
  }

  return merged;
}

function sameVisualLine(left: LTWHP, right: LTWHP): boolean {
  if (left.pageNumber !== right.pageNumber) return false;
  const leftMiddle = left.top + left.height / 2;
  const rightMiddle = right.top + right.height / 2;
  return Math.abs(leftMiddle - rightMiddle) <= Math.max(left.height, right.height) * 0.55;
}

function scaledPositionFromRects(page: PdfExtractedPage, rects: LTWHP[]): ScaledPosition {
  const boundingRect = boundingRectFor(rects);
  return {
    boundingRect: toScaledRect(page, boundingRect),
    rects: rects.map((rect) => toScaledRect(page, rect))
  };
}

function boundingRectFor(rects: LTWHP[]): LTWHP {
  const pageNumber = rects[0]?.pageNumber ?? 1;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  return {
    pageNumber,
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

function toScaledRect(page: PdfExtractedPage, rect: LTWHP): Scaled {
  return {
    x1: rect.left,
    y1: rect.top,
    x2: rect.left + rect.width,
    y2: rect.top + rect.height,
    width: page.width,
    height: page.height,
    pageNumber: rect.pageNumber
  };
}

function paletteEntry(color: AnnotationColorKey): (typeof annotationPalette)[number] {
  return annotationPalette.find((entry) => entry.id === color) ?? annotationPalette[0]!;
}

function paletteHex(color: AnnotationColorKey): string {
  return paletteEntry(color).hex;
}

function paletteRgba(color: AnnotationColorKey, opacity: number): string {
  return rgbaFromRgb(paletteEntry(color).rgb, opacity);
}

function rgbaFromRgb([red, green, blue]: [number, number, number], opacity: number): string {
  return `rgba(${red}, ${green}, ${blue}, ${clamp(opacity, 0, 1)})`;
}

function shapeFillColor(style: AnnotationStyleSettings): string {
  if (style.shapeFillMode === "outline") return "transparent";
  return paletteRgba(style.color, style.shapeOpacity);
}

function colorWithOpacity(color: string, fallbackOpacity: number): string {
  const hex = parseHexColor(color);
  if (hex) return rgbaFromRgb(hex, fallbackOpacity);

  const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) return rgbaFromRgb([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], fallbackOpacity);

  return color;
}

function parseHexColor(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  const short = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) {
    const red = short[1]!;
    const green = short[2]!;
    const blue = short[3]!;
    return [parseInt(red + red, 16), parseInt(green + green, 16), parseInt(blue + blue, 16)];
  }

  const full = trimmed.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!full) return null;
  return [parseInt(full[1]!, 16), parseInt(full[2]!, 16), parseInt(full[3]!, 16)];
}

function highlightColor(color: PdfHighlight["color"]): string {
  return {
    yellow: "rgba(255, 214, 102, 0.1)",
    green: "rgba(67, 181, 129, 0.1)",
    blue: "rgba(114, 137, 218, 0.1)",
    orange: "rgba(245, 159, 69, 0.1)",
    pink: "rgba(255, 122, 162, 0.1)",
    purple: "rgba(176, 132, 245, 0.1)"
  }[color ?? "yellow"];
}

function highlightBorderColor(color: PdfHighlight["color"]): string {
  return {
    yellow: "rgba(217, 151, 48, 0.5)",
    green: "rgba(67, 181, 129, 0.45)",
    blue: "rgba(114, 137, 218, 0.48)",
    orange: "rgba(245, 159, 69, 0.48)",
    pink: "rgba(255, 122, 162, 0.45)",
    purple: "rgba(176, 132, 245, 0.48)"
  }[color ?? "yellow"];
}

function makeHighlightId(highlight: PdfHighlight, index: number): string {
  return [
    highlight.id ?? `citation-${index}`,
    highlight.activationKey ?? "stable",
    highlight.page,
    highlight.quote.slice(0, 32)
  ].join(":");
}

function createManualHighlight({
  type,
  position,
  text,
  fill,
  fillMode,
  pageNumber,
  content,
  freetextStyle,
  shapeStyle
}: {
  type: NonNullable<Highlight["type"]>;
  position: ScaledPosition;
  text: string;
  fill: string;
  fillMode?: ShapeFillMode;
  pageNumber: number;
  content?: Highlight["content"];
  freetextStyle?: FreetextStyle;
  shapeStyle?: ShapeStyle;
}): LitHighlight {
  return {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    content: {
      text,
      ...(content ?? {})
    },
    position,
    litColor: "yellow",
    litQuote: text,
    litPage: pageNumber,
    litActive: false,
    litResolvedFrom: "selection",
    litFill: fill,
    ...(fillMode ? { litFillMode: fillMode } : {}),
    ...(freetextStyle ? { litFreetextStyle: freetextStyle } : {}),
    ...(shapeStyle ? { litShapeStyle: shapeStyle } : {})
  };
}

function normalizeShapePosition(position: ScaledPosition, shape: ShapeData): { position: ScaledPosition; shape: ShapeData } {
  if (shape.shapeType !== "arrow") return { position, shape };

  const rect = position.boundingRect;
  const width = rect.x2 - rect.x1;
  const height = rect.y2 - rect.y1;
  const nextWidth = Math.max(width, MIN_ARROW_HITBOX);
  const nextHeight = Math.max(height, MIN_ARROW_HITBOX);
  if (nextWidth === width && nextHeight === height) return { position, shape };

  const startPoint = shape.startPoint ?? { x: 0, y: 0.5 };
  const endPoint = shape.endPoint ?? { x: 1, y: 0.5 };
  const startX = rect.x1 + width * startPoint.x;
  const startY = rect.y1 + height * startPoint.y;
  const endX = rect.x1 + width * endPoint.x;
  const endY = rect.y1 + height * endPoint.y;
  const centerX = rect.x1 + width / 2;
  const centerY = rect.y1 + height / 2;
  const x1 = clamp(centerX - nextWidth / 2, 0, Math.max(rect.width - nextWidth, 0));
  const y1 = clamp(centerY - nextHeight / 2, 0, Math.max(rect.height - nextHeight, 0));
  const nextRect: Scaled = {
    ...rect,
    x1,
    y1,
    x2: x1 + nextWidth,
    y2: y1 + nextHeight
  };

  return {
    position: {
      ...position,
      boundingRect: nextRect,
      rects: []
    },
    shape: {
      ...shape,
      startPoint: {
        x: clamp((startX - x1) / nextWidth, 0, 1),
        y: clamp((startY - y1) / nextHeight, 0, 1)
      },
      endPoint: {
        x: clamp((endX - x1) / nextWidth, 0, 1),
        y: clamp((endY - y1) / nextHeight, 0, 1)
      }
    }
  };
}

function normalizeArrowPoint(point: ArrowPoint): ArrowPoint {
  return {
    x: clamp(point.x, 0, 1),
    y: clamp(point.y, 0, 1)
  };
}

function toLocalArrowPoint(rect: LTWHP, point: ArrowPoint): ArrowPoint {
  return {
    x: rect.width * point.x,
    y: rect.height * point.y
  };
}

function toRelativeArrowPoint(rect: LTWHP, point: ArrowPoint): ArrowPoint {
  return {
    x: rect.width ? clamp((point.x - rect.left) / rect.width, 0, 1) : 0,
    y: rect.height ? clamp((point.y - rect.top) / rect.height, 0, 1) : 0
  };
}

function arrowRectFromPoints(
  start: ArrowPoint,
  end: ArrowPoint,
  pageNumber: number,
  strokeWidth: number,
  pageBounds: ArrowPageBounds | null
): LTWHP {
  const padding = Math.max(ARROW_EDITOR_PADDING, strokeWidth + 8);
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = Math.max(maxX - minX + padding * 2, MIN_ARROW_HITBOX);
  const height = Math.max(maxY - minY + padding * 2, MIN_ARROW_HITBOX);

  return clampViewportRectToPage(
    {
      left: centerX - width / 2,
      top: centerY - height / 2,
      width,
      height,
      pageNumber
    },
    pageBounds
  );
}

type ArrowPageBounds = { width: number; height: number };

function getArrowPageBounds(element: HTMLElement | null): ArrowPageBounds | null {
  const page = element?.closest(".page");
  if (!(page instanceof HTMLElement)) return null;
  const bounds = page.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  return { width: bounds.width, height: bounds.height };
}

function clampViewportRectToPage(rect: LTWHP, pageBounds: ArrowPageBounds | null): LTWHP {
  if (!pageBounds) return rect;
  const width = Math.min(rect.width, pageBounds.width);
  const height = Math.min(rect.height, pageBounds.height);
  return {
    ...rect,
    left: clamp(rect.left, 0, Math.max(pageBounds.width - width, 0)),
    top: clamp(rect.top, 0, Math.max(pageBounds.height - height, 0)),
    width,
    height
  };
}

function clampArrowPointToPage(point: ArrowPoint, pageBounds: ArrowPageBounds | null): ArrowPoint {
  if (!pageBounds) return point;
  return {
    x: clamp(point.x, 0, pageBounds.width),
    y: clamp(point.y, 0, pageBounds.height)
  };
}

function resizeViewportRect(
  rect: LTWHP,
  handle: BoxResizeHandle,
  deltaX: number,
  deltaY: number,
  pageBounds: ArrowPageBounds | null
): LTWHP {
  let left = rect.left;
  let top = rect.top;
  let right = rect.left + rect.width;
  let bottom = rect.top + rect.height;

  if (handle.includes("w")) left += deltaX;
  if (handle.includes("e")) right += deltaX;
  if (handle.includes("n")) top += deltaY;
  if (handle.includes("s")) bottom += deltaY;

  if (right - left < MIN_SHAPE_SIZE) {
    if (handle.includes("w")) left = right - MIN_SHAPE_SIZE;
    else right = left + MIN_SHAPE_SIZE;
  }

  if (bottom - top < MIN_SHAPE_SIZE) {
    if (handle.includes("n")) top = bottom - MIN_SHAPE_SIZE;
    else bottom = top + MIN_SHAPE_SIZE;
  }

  return clampViewportRectToPage(
    {
      pageNumber: rect.pageNumber,
      left,
      top,
      width: right - left,
      height: bottom - top
    },
    pageBounds
  );
}

function isArrowControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".pdf-arrow-control"));
}

function isBoxShapeControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".pdf-shape-control"));
}

function attachWindowPointerDrag(onMove: (event: PointerEvent) => void) {
  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", cleanup, { once: true });
  window.addEventListener("pointercancel", cleanup, { once: true });
}

function sanitizeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function shapeMode(mode: AnnotationMode): ShapeType | null {
  return mode === "rectangle" || mode === "circle" || mode === "arrow" ? mode : null;
}

function serializeHighlights(highlights: PdfHighlight[]): string {
  return JSON.stringify(
    highlights.map((highlight) => ({
      id: highlight.id,
      activationKey: highlight.activationKey,
      page: highlight.page,
      quote: highlight.quote,
      color: highlight.color,
      active: highlight.active,
      rects: highlight.rects
    }))
  );
}

function normalizePageNumber(page: number, pageCount: number): number {
  return Math.max(1, Math.min(page || 1, Math.max(pageCount, 1)));
}

function formatZoom(scale: PdfScaleValue): string {
  return typeof scale === "number" ? String(Math.round(scale * 100)) : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function PdfUnavailable({ title }: { title: string }) {
  return (
    <div className="pdf-unavailable">
      <strong>{title}</strong>
      <span>No PDF is attached to this paper yet.</span>
    </div>
  );
}
