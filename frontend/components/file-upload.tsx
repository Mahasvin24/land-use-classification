"use client"

import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ImageUp, Sparkles, X } from "lucide-react";

const VIRTUALIZE_FILE_LIST_THRESHOLD = 100;

const DEFAULT_MAX_FILES = 500;

type FileUploadProps = {
  /** When both are set, the file list is controlled by the parent (e.g. per-model buckets). */
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  onProcess?: (files: File[]) => void;
  isProcessing?: boolean;
  /** Shown next to the spinner while `isProcessing` is true (e.g. "Processing 2 of 5"). */
  processingStatusLine?: string | null;
  processError?: string | null;
  clearProcessError?: () => void;
  compactView?: boolean;
  maxFiles?: number;
  title?: string;
  description?: string;
  processActionLabel?: string;
  helperText?: string;
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
  files: controlledFiles,
  onFilesChange,
  onProcess,
  isProcessing = false,
  processingStatusLine = null,
  processError = null,
  clearProcessError,
  compactView = false,
  maxFiles = DEFAULT_MAX_FILES,
  title = "Upload Satellite Imagery",
  description = "Upload one or many satellite images to generate color-coded land use classifications.",
  processActionLabel = "Analyze",
  helperText,
}: FileUploadProps) {
  const [internalFiles, setInternalFiles] = useState<File[]>([]);
  const isControlled = controlledFiles !== undefined && onFilesChange !== undefined;
  const files = isControlled ? controlledFiles : internalFiles;
  const setFiles = (next: File[]) => {
    if (isControlled) onFilesChange!(next);
    else setInternalFiles(next);
  };
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileListRef = useRef<HTMLDivElement>(null);

  const useFileListVirtual = compactView && files.length > VIRTUALIZE_FILE_LIST_THRESHOLD;
  const fileListVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => fileListRef.current,
    estimateSize: () => 28,
    overscan: 5,
  });

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected?.length) return;
    const next = Array.from(selected);
    const added = next.length > maxFiles ? next.slice(0, maxFiles) : next;
    setFiles(added);
    e.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files;
    if (!dropped?.length) return;
    const added = Array.from(dropped);
    const combined = [...files, ...added];
    setFiles(combined.length > maxFiles ? combined.slice(0, maxFiles) : combined);
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
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
          <CardTitle className="text-xl">{title}</CardTitle>
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            AI Powered
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {description} Up to {maxFiles} files.
        </p>
        {helperText && (
          <p className="text-xs text-muted-foreground">{helperText}</p>
        )}
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
                  {compactView && (
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      Compact mode
                    </Badge>
                  )}
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
              {compactView ? (
                <div
                  ref={fileListRef}
                  className="max-h-[140px] overflow-y-auto rounded-md border bg-background/60 px-2 py-1.5 font-mono text-xs"
                  role="list"
                >
                  {useFileListVirtual ? (
                    <div
                      style={{
                        height: `${fileListVirtualizer.getTotalSize()}px`,
                        width: "100%",
                        position: "relative",
                      }}
                    >
                      {fileListVirtualizer.getVirtualItems().map((virtualRow) => {
                        const file = files[virtualRow.index];
                        const index = virtualRow.index;
                        return (
                          <div
                            key={`${file.name}-${virtualRow.key}`}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                            className="flex items-center justify-between gap-2 py-0.5"
                            role="listitem"
                          >
                            <span className="min-w-0 flex-1 truncate" title={file.name}>
                              {index + 1}. {file.name}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              type="button"
                              className="h-6 w-6 shrink-0 opacity-70 hover:opacity-100"
                              aria-label={`Remove ${file.name}`}
                              onClick={() => removeFile(index)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {files.map((file, index) => (
                        <div
                          key={`${file.name}-${index}`}
                          className="flex items-center justify-between gap-2"
                          role="listitem"
                        >
                          <span className="min-w-0 flex-1 truncate" title={file.name}>
                            {index + 1}. {file.name}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            type="button"
                            className="h-6 w-6 shrink-0 opacity-70 hover:opacity-100"
                            aria-label={`Remove ${file.name}`}
                            onClick={() => removeFile(index)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
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
              )}
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
            variant="default"
            disabled={files.length === 0 || isProcessing}
            type="button"
            onClick={() => onProcess?.(files)}
            className={cn(
              isProcessing &&
                "max-w-full min-w-0 sm:max-w-md disabled:cursor-wait disabled:opacity-100"
            )}
          >
            {isProcessing ? (
              <>
                <Spinner className="size-4 shrink-0" />
                <span className="min-w-0 truncate text-left font-normal">
                  {processingStatusLine ?? "Processing…"}
                </span>
              </>
            ) : (
              `${processActionLabel}${files.length > 0 ? ` (${files.length} file${files.length !== 1 ? "s" : ""})` : ""}`
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
