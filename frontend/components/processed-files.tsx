"use client"
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ImageIcon, Scan, CheckCircle2, Download } from "lucide-react";
import JSZip from "jszip";
import type { ProcessedResult } from "@/app/page";

type ProcessedFilesProps = {
  processedResults: ProcessedResult[];
  onClearResults?: () => void;
  compactView?: boolean;
};

export default function ProcessedFiles({
  processedResults,
  onClearResults,
  compactView = false,
}: ProcessedFilesProps) {
  const hasResults = processedResults.length > 0;

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
                      className="max-h-[100px] overflow-y-auto rounded-md border bg-muted/30 px-2 py-1.5 font-mono text-xs"
                      role="list"
                    >
                      {processedResults.map((r, i) => (
                        <div
                          key={`${r.filename}-${i}`}
                          className="truncate py-0.5 text-muted-foreground"
                          title={r.filename}
                          role="listitem"
                        >
                          {i + 1}. {r.filename}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Preview thumbnails — download to view full size
                    </p>
                    <div className="grid max-h-[280px] grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-5 md:grid-cols-6">
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
                  </div>
                  {processedResults[0] && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                        Class legend
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(processedResults[0].class_legend).map(([id, label]) => (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="text-xs font-normal"
                          >
                            {id}: {label}
                          </Badge>
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
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(result.class_legend).map(([id, label]) => (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="text-xs font-normal"
                          >
                            {id}: {label}
                          </Badge>
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
