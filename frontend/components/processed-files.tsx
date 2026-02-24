"use client"

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ImageIcon, Scan, CheckCircle2, Download } from "lucide-react";
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

type ProcessedFilesProps = {
  processedResults: ProcessedResult[];
  onClearResults?: () => void;
  compactView?: boolean;
  autoDownloadWhenFull?: boolean;
};

export default function ProcessedFiles({
  processedResults,
  onClearResults,
  compactView = false,
  autoDownloadWhenFull = false,
}: ProcessedFilesProps) {
  const hasResults = processedResults.length > 0;
  const inputListRef = useRef<HTMLDivElement>(null);
  const thumbnailGridRef = useRef<HTMLDivElement>(null);

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

  const handleDownloadAll = async () => {
    const zip = new JSZip();
    processedResults.forEach((result, index) => {
      const baseName = result.filename.replace(/\.(tif|tiff)$/i, "") || `image-${index}`;
      const pngName = `${baseName}-classification.png`;
      zip.file(pngName, result.preview_image_base64, { base64: true });
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
          <CardTitle className="text-xl">Processed output</CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant={hasResults ? "default" : "outline"}
              className="gap-1 shrink-0"
            >
            {hasResults ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Processed
              </>
            ) : (
              <>
                <Scan className="h-3.5 w-3.5" />
                Awaiting upload
              </>
            )}
          </Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Your classified images will appear here after processing.
          {autoDownloadWhenFull && hasResults && (
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
                  onClick={handleDownloadAll}
                  className="gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download all
                </Button>
                {onClearResults && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onClearResults}
                  >
                    Clear all
                  </Button>
                )}
              </div>
            )}
            <div className="space-y-6">
              {compactView ? (
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
                                  <div
                                    key={`${result.filename}-${index}`}
                                    className="flex flex-col items-center gap-0.5 rounded border bg-muted/30 p-1"
                                  >
                                    <img
                                      src={`data:image/png;base64,${result.preview_image_base64}`}
                                      alt={result.filename}
                                      className="h-14 w-full object-contain object-center"
                                    />
                                    <span
                                      className="w-full truncate text-center text-[10px] text-muted-foreground"
                                      title={result.filename}
                                    >
                                      {result.filename}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid max-h-[280px] grid-cols-4 gap-1.5 p-1 sm:grid-cols-5 md:grid-cols-6">
                          {processedResults.map((result, index) => (
                            <div
                              key={`${result.filename}-${index}`}
                              className="flex flex-col items-center gap-0.5 rounded border bg-muted/30 p-1"
                            >
                              <img
                                src={`data:image/png;base64,${result.preview_image_base64}`}
                                alt={result.filename}
                                className="h-14 w-full object-contain object-center"
                              />
                              <span
                                className="w-full truncate text-center text-[10px] text-muted-foreground"
                                title={result.filename}
                              >
                                {result.filename}
                              </span>
                            </div>
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
              ) : (
                processedResults.map((result, index) => (
                  <div
                    key={`${result.filename}-${index}`}
                    className="rounded-xl border bg-muted/30 p-4 space-y-3"
                  >
                    <p className="text-sm font-medium truncate" title={result.filename}>
                      {result.filename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {result.height} × {result.width} px
                    </p>
                    <div className="rounded-lg overflow-hidden border bg-background">
                      <img
                        src={`data:image/png;base64,${result.preview_image_base64}`}
                        alt={`Classification preview: ${result.filename}`}
                        className="w-full h-auto object-contain max-h-[280px]"
                      />
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
                <p className="text-sm font-medium">No processed image yet</p>
                <p className="text-xs text-muted-foreground">
                  Upload one or more images to generate land use classification previews.
                </p>
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
            <p className="text-sm font-medium">GeoTIFF preview</p>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Processing status
            </p>
            <p className="text-sm font-medium">
              {hasResults
                ? `${processedResults.length} file${processedResults.length !== 1 ? "s" : ""} processed`
                : "Waiting for upload"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
