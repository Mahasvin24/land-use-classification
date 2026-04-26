"use client"

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ImageIcon, Scan, CheckCircle2, Download, X } from "lucide-react";
import JSZip from "jszip";
import type { ProcessedResult } from "@/app/page";

const VIRTUALIZE_THRESHOLD = 100;
const GRID_COLUMNS = 6;

const CLASS_COLORS: Record<number, string> = {
  0: "#006400", // Forest
  1: "#ffbb22", // Shrubland
  2: "#ffff4c", // Grassland
  3: "#f096ff", // Cropland
  4: "#fa0000", // Built-up
  5: "#b4b4b4", // Bare
  6: "#0064ff", // Water
};
const GENERAL_VEGETATION_COLOR: [number, number, number] = [63, 143, 63];
const GENERAL_VEGETATION_CLASSES = new Set([0, 1, 2]);

type ProcessedFilesProps = {
  processedResults: ProcessedResult[];
  onClearResults?: () => void;
  compactView?: boolean;
  autoDownloadWhenFull?: boolean;
  title?: string;
  description?: string;
  outputFormatLabel?: string;
  /** Copy for the dashed empty state (model-specific, e.g. Oscilla explains one combined output). */
  resultsEmptyHint?: string;
  /** True when the pipeline always returns a single merged result (e.g. Oscilla time series). */
  singleCombinedOutput?: boolean;
  /** Class IDs that should stay highlighted; non-selected classes are grayed out. */
  selectedClassIds?: number[];
  /** When true, forest/shrubland/grassland are rendered with one shared color. */
  generalVegetationActive?: boolean;
};

function downloadSinglePng(result: ProcessedResult, index: number, imageUrl?: string) {
  const baseName = result.filename.replace(/\.(tif|tiff)$/i, "") || `classification-${index}`;
  const a = document.createElement("a");
  a.href = imageUrl ?? `data:image/png;base64,${result.preview_image_base64}`;
  a.download = `${baseName}-classification.png`;
  a.click();
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return null;
  const value = Number.parseInt(normalized, 16);
  if (Number.isNaN(value)) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function classIdFromRgb(
  r: number,
  g: number,
  b: number,
  colorEntries: Array<[number, [number, number, number]]>
): number | null {
  for (const [classId, [cr, cg, cb]] of colorEntries) {
    if (r === cr && g === cg && b === cb) return classId;
  }
  return null;
}

export default function ProcessedFiles({
  processedResults,
  onClearResults,
  compactView = false,
  autoDownloadWhenFull = false,
  title = "Processed output",
  description = "Your classified images will appear here after processing.",
  outputFormatLabel = "GeoTIFF preview",
  resultsEmptyHint = "Upload one or more images to generate land use classification previews.",
  singleCombinedOutput = false,
  selectedClassIds = [0, 1, 2, 3, 4, 5, 6],
  generalVegetationActive = false,
}: ProcessedFilesProps) {
  const hasResults = processedResults.length > 0;
  const inputListRef = useRef<HTMLDivElement>(null);
  const thumbnailGridRef = useRef<HTMLDivElement>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [filteredPreviewDataUrls, setFilteredPreviewDataUrls] = useState<Record<number, string>>({});
  const activePreview =
    previewIndex !== null ? processedResults[previewIndex] ?? null : null;
  const selectedClassIdsKey = useMemo(
    () => [...selectedClassIds].sort((a, b) => a - b).join(","),
    [selectedClassIds]
  );
  const selectedClassSet = useMemo(() => new Set(selectedClassIds), [selectedClassIds]);
  const classColorEntries = useMemo(
    () =>
      Object.entries(CLASS_COLORS)
        .map(([id, color]) => {
          const rgb = hexToRgb(color);
          if (!rgb) return null;
          return [Number(id), rgb] as [number, [number, number, number]];
        })
        .filter((entry): entry is [number, [number, number, number]] => entry !== null),
    []
  );
  const shouldTransform =
    selectedClassIds.length < classColorEntries.length || generalVegetationActive;
  const previewFilterCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (activePreview === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewIndex(null);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [activePreview]);

  useEffect(() => {
    if (previewIndex !== null && previewIndex >= processedResults.length) {
      setPreviewIndex(null);
    }
  }, [previewIndex, processedResults.length]);

  useEffect(() => {
    let cancelled = false;
    if (!processedResults.length) {
      setFilteredPreviewDataUrls({});
      return;
    }
    if (!shouldTransform) {
      setFilteredPreviewDataUrls({});
      return;
    }

    const buildFilteredDataUrl = async (base64: string): Promise<string> => {
      const cacheKey = `${base64.slice(0, 64)}:${base64.length}:${selectedClassIdsKey}:veg=${generalVegetationActive ? "1" : "0"}`;
      const cached = previewFilterCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Failed to load preview image for filtering"));
      });

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return `data:image/png;base64,${base64}`;

      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const gray: [number, number, number] = [140, 140, 140];

      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha === 0) continue;
        const classId = classIdFromRgb(data[i], data[i + 1], data[i + 2], classColorEntries);
        if (classId === null) continue;
        if (!selectedClassSet.has(classId)) {
          data[i] = gray[0];
          data[i + 1] = gray[1];
          data[i + 2] = gray[2];
        } else if (generalVegetationActive && GENERAL_VEGETATION_CLASSES.has(classId)) {
          data[i] = GENERAL_VEGETATION_COLOR[0];
          data[i + 1] = GENERAL_VEGETATION_COLOR[1];
          data[i + 2] = GENERAL_VEGETATION_COLOR[2];
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      previewFilterCacheRef.current.set(cacheKey, dataUrl);
      return dataUrl;
    };

    const run = async () => {
      const next: Record<number, string> = {};
      await Promise.all(
        processedResults.map(async (result, index) => {
          try {
            next[index] = await buildFilteredDataUrl(result.preview_image_base64);
          } catch {
            next[index] = `data:image/png;base64,${result.preview_image_base64}`;
          }
        })
      );
      if (!cancelled) setFilteredPreviewDataUrls(next);
    };
    run().catch(() => {
      if (!cancelled) setFilteredPreviewDataUrls({});
    });
    return () => {
      cancelled = true;
    };
  }, [
    classColorEntries,
    generalVegetationActive,
    processedResults,
    selectedClassIdsKey,
    selectedClassSet,
    shouldTransform,
  ]);

  const getPreviewSrc = (result: ProcessedResult, index: number) =>
    filteredPreviewDataUrls[index] ?? `data:image/png;base64,${result.preview_image_base64}`;

  const useInputVirtual = compactView && processedResults.length > VIRTUALIZE_THRESHOLD;
  const inputVirtualizer = useVirtualizer({
    count: processedResults.length,
    getScrollElement: () => inputListRef.current,
    estimateSize: () => 20,
    overscan: 5,
  });

  const thumbnailRowCount = Math.ceil(processedResults.length / GRID_COLUMNS);
  const useThumbnailVirtual = compactView && processedResults.length > VIRTUALIZE_THRESHOLD;
  const thumbnailVirtualizer = useVirtualizer({
    count: thumbnailRowCount,
    getScrollElement: () => thumbnailGridRef.current,
    estimateSize: () => 56,
    overscan: 2,
  });

  const handlePrimaryDownload = async () => {
    if (singleCombinedOutput && processedResults.length === 1) {
      downloadSinglePng(processedResults[0], 0, getPreviewSrc(processedResults[0], 0));
      return;
    }
    const zip = new JSZip();
    processedResults.forEach((result, index) => {
      const baseName = result.filename.replace(/\.(tif|tiff)$/i, "") || `image-${index}`;
      const pngName = `${baseName}-classification.png`;
      const dataUrl = getPreviewSrc(result, index);
      const maybeBase64 = dataUrl.split(",")[1] ?? "";
      zip.file(pngName, maybeBase64, { base64: true });
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `land-use-classifications-${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-xl">{title}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant={hasResults ? "default" : "outline"}
              className="gap-1 shrink-0"
            >
            {hasResults ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {singleCombinedOutput ? "Output ready" : "Processed"}
              </>
            ) : (
              <>
                <Scan className="h-3.5 w-3.5" />
                {singleCombinedOutput ? "Awaiting time series" : "Awaiting upload"}
              </>
            )}
          </Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {description}
          {autoDownloadWhenFull && hasResults && !singleCombinedOutput && (
            <span className="ml-1 font-medium">({processedResults.length} in memory)</span>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {hasResults ? (
          <div className="space-y-4">
            {hasResults && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrimaryDownload}
                  className="gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  {singleCombinedOutput ? "Download PNG" : "Download all"}
                </Button>
                {onClearResults && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onClearResults}
                  >
                    {singleCombinedOutput ? "Clear output" : "Clear all"}
                  </Button>
                )}
              </div>
            )}
            <div className="space-y-6">
              {compactView ? (
                singleCombinedOutput && processedResults.length === 1 ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Combined classification
                      </p>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <button
                          type="button"
                          onClick={() => setPreviewIndex(0)}
                          aria-label={`Open larger preview of ${processedResults[0].filename}`}
                          className="group/preview block w-full rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <img
                            src={getPreviewSrc(processedResults[0], 0)}
                            alt={`Classification preview: ${processedResults[0].filename}`}
                            className="mx-auto max-h-[min(320px,50vh)] w-full object-contain transition group-hover/preview:opacity-90"
                          />
                        </button>
                        <p
                          className="mt-2 text-center text-xs font-medium text-foreground truncate"
                          title={processedResults[0].filename}
                        >
                          {processedResults[0].filename}
                        </p>
                        <p className="text-center text-[11px] text-muted-foreground">
                          {processedResults[0].height} × {processedResults[0].width} px
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                        Class legend
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {Object.entries(processedResults[0].class_legend).map(([id, label]) => (
                          <div key={id} className="flex items-center gap-2">
                            <span
                              className="h-3.5 w-3.5 shrink-0 rounded border border-border"
                              style={{ backgroundColor: CLASS_COLORS[Number(id)] ?? "#888" }}
                              aria-hidden
                            />
                            <span className="text-xs text-muted-foreground">
                              {id}: {label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Input files ({processedResults.length})
                      </p>
                      <div
                        ref={inputListRef}
                        className="max-h-[100px] overflow-y-auto rounded-md border bg-muted/30 px-2 py-1.5 font-mono text-xs"
                        role="list"
                      >
                        {useInputVirtual ? (
                          <div
                            style={{
                              height: `${inputVirtualizer.getTotalSize()}px`,
                              width: "100%",
                              position: "relative",
                            }}
                          >
                            {inputVirtualizer.getVirtualItems().map((virtualRow) => {
                              const r = processedResults[virtualRow.index];
                              return (
                                <div
                                  key={`${r.filename}-${virtualRow.key}`}
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    width: "100%",
                                    transform: `translateY(${virtualRow.start}px)`,
                                  }}
                                  className="truncate py-0.5 text-muted-foreground"
                                  title={r.filename}
                                  role="listitem"
                                >
                                  {virtualRow.index + 1}. {r.filename}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          processedResults.map((r, i) => (
                            <div
                              key={`${r.filename}-${i}`}
                              className="truncate py-0.5 text-muted-foreground"
                              title={r.filename}
                              role="listitem"
                            >
                              {i + 1}. {r.filename}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Preview thumbnails — download to view full size
                      </p>
                      <div
                        ref={thumbnailGridRef}
                        className="max-h-[280px] overflow-y-auto rounded-md border bg-muted/30"
                      >
                        {useThumbnailVirtual ? (
                          <div
                            style={{
                              height: `${thumbnailVirtualizer.getTotalSize()}px`,
                              width: "100%",
                              position: "relative",
                            }}
                          >
                            {thumbnailVirtualizer.getVirtualItems().map((virtualRow) => (
                              <div
                                key={virtualRow.key}
                                style={{
                                  position: "absolute",
                                  top: 0,
                                  left: 0,
                                  width: "100%",
                                  transform: `translateY(${virtualRow.start}px)`,
                                }}
                                className="grid grid-cols-4 gap-1.5 px-1 py-0.5 sm:grid-cols-5 md:grid-cols-6"
                              >
                                {Array.from({ length: GRID_COLUMNS }, (_, col) => {
                                  const index = virtualRow.index * GRID_COLUMNS + col;
                                  const result = processedResults[index];
                                  if (!result) return null;
                                  return (
                                    <button
                                      key={`${result.filename}-${index}`}
                                      type="button"
                                      onClick={() => setPreviewIndex(index)}
                                      className="flex flex-col items-center gap-0.5 rounded border bg-muted/30 p-1 text-left transition hover:border-primary/60 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                      aria-label={`Open larger preview of ${result.filename}`}
                                    >
                                      <img
                                        src={getPreviewSrc(result, index)}
                                        alt={result.filename}
                                        className="h-14 w-full object-contain object-center"
                                      />
                                      <span
                                        className="w-full truncate text-center text-[10px] text-muted-foreground"
                                        title={result.filename}
                                      >
                                        {result.filename}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid max-h-[280px] grid-cols-4 gap-1.5 p-1 sm:grid-cols-5 md:grid-cols-6">
                            {processedResults.map((result, index) => (
                              <button
                                key={`${result.filename}-${index}`}
                                type="button"
                                onClick={() => setPreviewIndex(index)}
                                className="flex flex-col items-center gap-0.5 rounded border bg-muted/30 p-1 text-left transition hover:border-primary/60 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                aria-label={`Open larger preview of ${result.filename}`}
                              >
                                <img
                                  src={getPreviewSrc(result, index)}
                                  alt={result.filename}
                                  className="h-14 w-full object-contain object-center"
                                />
                                <span
                                  className="w-full truncate text-center text-[10px] text-muted-foreground"
                                  title={result.filename}
                                >
                                  {result.filename}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {processedResults[0] && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                          Class legend
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {Object.entries(processedResults[0].class_legend).map(([id, label]) => (
                            <div
                              key={id}
                              className="flex items-center gap-2"
                            >
                              <span
                                className="h-3.5 w-3.5 shrink-0 rounded border border-border"
                                style={{ backgroundColor: CLASS_COLORS[Number(id)] ?? "#888" }}
                                aria-hidden
                              />
                              <span className="text-xs text-muted-foreground">
                                {id}: {label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )
              ) : (
                processedResults.map((result, index) => (
                  <div
                    key={`${result.filename}-${index}`}
                    className="rounded-xl border bg-muted/30 p-4 space-y-3"
                  >
                    {singleCombinedOutput && (
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Combined output (single image)
                      </p>
                    )}
                    <p className="text-sm font-medium truncate" title={result.filename}>
                      {result.filename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {result.height} × {result.width} px
                    </p>
                    <div className="rounded-lg overflow-hidden border bg-background">
                      <button
                        type="button"
                        onClick={() => setPreviewIndex(index)}
                        aria-label={`Open larger preview of ${result.filename}`}
                        className="group/preview block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <img
                          src={getPreviewSrc(result, index)}
                          alt={`Classification preview: ${result.filename}`}
                          className={
                            singleCombinedOutput
                              ? "w-full h-auto max-h-[min(400px,55vh)] object-contain transition group-hover/preview:opacity-90"
                              : "w-full h-auto max-h-[280px] object-contain transition group-hover/preview:opacity-90"
                          }
                        />
                      </button>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                        Class legend
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {Object.entries(result.class_legend).map(([id, label]) => (
                          <div
                            key={id}
                            className="flex items-center gap-2"
                          >
                            <span
                              className="h-3.5 w-3.5 shrink-0 rounded border border-border"
                              style={{ backgroundColor: CLASS_COLORS[Number(id)] ?? "#888" }}
                              aria-hidden
                            />
                            <span className="text-xs text-muted-foreground">
                              {id}: {label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed bg-muted/30 p-6 text-center">
            <div className="space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border bg-background">
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {singleCombinedOutput ? "No combined output yet" : "No processed image yet"}
                </p>
                <p className="text-xs text-muted-foreground">{resultsEmptyHint}</p>
              </div>
            </div>
          </div>
        )}

        <Separator />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Output format
            </p>
            <p className="text-sm font-medium">{outputFormatLabel}</p>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Processing status
            </p>
            <p className="text-sm font-medium">
              {hasResults
                ? singleCombinedOutput
                  ? "One combined classification ready"
                  : `${processedResults.length} image${processedResults.length !== 1 ? "s" : ""} processed`
                : singleCombinedOutput
                  ? "Waiting for time series"
                  : "Waiting for upload"}
            </p>
          </div>
        </div>
      </CardContent>
      {activePreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview of ${activePreview.filename}`}
          onClick={() => setPreviewIndex(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-[95vh] w-[95vw] flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <p
                  className="truncate text-sm font-medium"
                  title={activePreview.filename}
                >
                  {activePreview.filename}
                </p>
                <p className="text-xs text-muted-foreground">
                  {activePreview.height} × {activePreview.width} px
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                type="button"
                onClick={() => setPreviewIndex(null)}
                aria-label="Close preview"
                className="h-8 w-8 shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 overflow-hidden bg-muted/30 p-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-1">
              <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-md border bg-background/70 p-2">
                <img
                  src={getPreviewSrc(activePreview, previewIndex ?? 0)}
                  alt={`Classification preview: ${activePreview.filename}`}
                  className="h-full w-full object-contain"
                />
              </div>
              <aside className="min-h-0 overflow-y-auto rounded-md border bg-background p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Class legend
                </p>
                <div className="space-y-2">
                  {Object.entries(activePreview.class_legend).map(([id, label]) => (
                    <div key={id} className="flex items-center gap-2">
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded border border-border"
                        style={{ backgroundColor: CLASS_COLORS[Number(id)] ?? "#888" }}
                        aria-hidden
                      />
                      <span className="text-xs text-muted-foreground">
                        {id}: {label}
                      </span>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
