"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ImageUp, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";

const MAX_FILES = 500;

type FileUploadProps = {
  onProcess?: (files: File[]) => void;
  isProcessing?: boolean;
  processError?: string | null;
  clearProcessError?: () => void;
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${sizes[i]}`;
}

export default function FileUpload({
  onProcess,
  isProcessing = false,
  processError = null,
  clearProcessError,
}: FileUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected?.length) return;
    const next = Array.from(selected);
    const added = next.length > MAX_FILES ? next.slice(0, MAX_FILES) : next;
    setFiles(added);
    e.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files;
    if (!dropped?.length) return;
    const added = Array.from(dropped);
    setFiles((prev) => {
      const combined = [...prev, ...added];
      return combined.length > MAX_FILES ? combined.slice(0, MAX_FILES) : combined;
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setFiles([]);
    inputRef.current?.value && (inputRef.current.value = "");
  };

  const handlePickFiles = () => inputRef.current?.click();

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
          Upload one or many satellite images to generate color-coded land use
          classifications. Up to {MAX_FILES} files.
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
              {files.length === 0
                ? "Drop satellite imagery here"
                : files.length === 1
                  ? "1 image ready for classification"
                  : `${files.length} images ready for classification`}
            </p>
            <p className="text-xs text-muted-foreground">
              Select or drop many files at once.
            </p>
          </div>
          <Button variant="secondary" type="button" onClick={handlePickFiles}>
            Browse files
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.tif,.tiff"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
          {files.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {files.length} file{files.length !== 1 ? "s" : ""} selected
                  {totalBytes > 0 && (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      • {formatBytes(totalBytes)} total
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={handlePickFiles}
                  >
                    Add more
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={clearAll}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Clear all
                  </Button>
                </div>
              </div>
              <div
                className="max-h-[220px] overflow-y-auto rounded-md border bg-background/60 pr-1 space-y-0.5"
                role="list"
              >
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-muted/60 group/item"
                    role="listitem"
                  >
                    <span
                      className="min-w-0 flex-1 truncate text-sm"
                      title={file.name}
                    >
                      {file.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      type="button"
                      className="h-7 w-7 shrink-0 opacity-70 hover:opacity-100 group-hover/item:opacity-100"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeFile(index)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">No images selected</p>
                <p className="text-xs text-muted-foreground">
                  Select or drop multiple satellite images to begin classification.
                </p>
              </div>
              <Badge variant="outline">Waiting</Badge>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Your data is encrypted and never stored.
          </div>
          {processError && (
            <p className="text-sm text-destructive mr-2" role="alert">
              {processError}
              {clearProcessError && (
                <button
                  type="button"
                  onClick={clearProcessError}
                  className="ml-1 underline"
                >
                  Dismiss
                </button>
              )}
            </p>
          )}
          <Button
            disabled={files.length === 0 || isProcessing}
            type="button"
            onClick={() => onProcess?.(files)}
          >
            {isProcessing
              ? "Processing…"
              : `Process ${files.length > 0 ? `(${files.length} file${files.length !== 1 ? "s" : ""})` : ""}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
