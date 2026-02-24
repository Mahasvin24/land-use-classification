"use client"

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ImageIcon, Scan, CheckCircle2 } from "lucide-react";
import type { ProcessedResult } from "@/app/page";

type ProcessedFilesProps = {
  processedResults: ProcessedResult[];
  onClearResults?: () => void;
};

export default function ProcessedFiles({
  processedResults,
  onClearResults,
}: ProcessedFilesProps) {
  const hasResults = processedResults.length > 0;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Processed output</CardTitle>
          <Badge
            variant={hasResults ? "default" : "outline"}
            className="gap-1"
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
        <p className="text-sm text-muted-foreground">
          Your classified images will appear here after processing.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {hasResults ? (
          <div className="space-y-4">
            {onClearResults && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClearResults}
                >
                  Clear all
                </Button>
              </div>
            )}
            <div className="space-y-6">
              {processedResults.map((result, index) => (
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
              ))}
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
