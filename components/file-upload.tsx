"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ImageUp, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${sizes[i]}`;
}

export default function FileUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  const handlePickFile = () => inputRef.current?.click();

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Upload Satellite Imagery</CardTitle>
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            AI Powered
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload satellite imagery to generate color-coded land use classifications. Supports standard geospatial image formats.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          className={cn(
            "group relative flex min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-background/50 p-6 text-center transition",
            isDragging
              ? "border-primary/70 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary))]"
              : "border-muted-foreground/30 hover:border-primary/60"
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted/60">
            <ImageUp className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {file ? "Image ready for classification" : "Drop satellite imagery here"}
            </p>
            <p className="text-xs text-muted-foreground">
              Supported formats: PNG, JPG, TIFF (max 25MB)
            </p>
          </div>
          <Button variant="secondary" type="button" onClick={handlePickFile}>
            Browse files
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <div className="rounded-lg border bg-muted/40 p-4">
          {file ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size)} • Ready for classification
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={handlePickFile}
                >
                  Replace
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  aria-label="Remove file"
                  onClick={() => setFile(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">No image selected</p>
                <p className="text-xs text-muted-foreground">
                  Upload satellite imagery to begin classification analysis.
                </p>
              </div>
              <Badge variant="outline">Waiting</Badge>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Classification model will generate color-coded results.
          </div>
          <Button disabled={!file} type="button">
            Process
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
