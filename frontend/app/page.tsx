"use client"

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import FileUpload from "@/components/file-upload";
import ProcessedFiles from "@/components/processed-files";
import JSZip from "jszip";

export type ProcessedResult = {
  filename: string;
  preview_image_base64: string;
  class_legend: Record<number, string>;
  height: number;
  width: number;
};

async function downloadResultsAsZip(
  results: ProcessedResult[],
  filenamePrefix: string
): Promise<void> {
  if (!results.length) return;
  const zip = new JSZip();
  results.forEach((result, index) => {
    const baseName = result.filename.replace(/\.(tif|tiff)$/i, "") || `image-${index}`;
    zip.file(`${baseName}-classification.png`, result.preview_image_base64, { base64: true });
  });
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [processedResults, setProcessedResults] = useState<ProcessedResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [compactView, setCompactView] = useState(false);
  const [autoDownloadWhenFull, setAutoDownloadWhenFull] = useState(false);
  const maxResultsInMemory = 500;
  const [batchSize, setBatchSize] = useState(100);
  const [continueOnError, setContinueOnError] = useState(false);
  const [failedFiles, setFailedFiles] = useState<{ filename: string; error: string }[]>([]);
  const [concurrency, setConcurrency] = useState(1);

  const CACHE_KEY_RESULTS = "luc_processed_results_v1";
  const CACHE_KEY_COMPACT = "luc_compact_view_v1";
  const CACHE_MAX_RESULTS = 100;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = window.localStorage.getItem(CACHE_KEY_RESULTS);
      if (cached) {
        const parsed = JSON.parse(cached) as ProcessedResult[];
        if (Array.isArray(parsed)) setProcessedResults(parsed);
      }
      const cachedCompact = window.localStorage.getItem(CACHE_KEY_COMPACT);
      if (cachedCompact != null) setCompactView(cachedCompact === "true");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (autoDownloadWhenFull || processedResults.length > CACHE_MAX_RESULTS) return;
    try {
      window.localStorage.setItem(CACHE_KEY_RESULTS, JSON.stringify(processedResults));
    } catch {
      // ignore quota
    }
  }, [autoDownloadWhenFull, processedResults]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CACHE_KEY_COMPACT, String(compactView));
    } catch {
      // ignore
    }
  }, [compactView]);

  const apiBase =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
      : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const processOneFile = async (file: File): Promise<ProcessedResult | null> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${apiBase}/predict`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Request failed: ${res.status}`);
    }
    const data = await res.json();
    return {
      filename: data.filename,
      preview_image_base64: data.preview_image_base64,
      class_legend: data.class_legend,
      height: data.height,
      width: data.width,
    };
  };

  const handleProcess = async (files: File[]) => {
    if (!files.length) return;
    setIsProcessing(true);
    setProcessError(null);
    setFailedFiles([]);
    const concurrencyLimit = Math.max(1, Math.min(5, concurrency));
    try {
      if (concurrencyLimit === 1) {
        for (const file of files) {
          try {
            const nextResult = await processOneFile(file);
            if (nextResult) {
              setProcessedResults((prev) => {
                if (autoDownloadWhenFull && prev.length >= maxResultsInMemory && batchSize > 0) {
                  const toZip = prev.slice(0, batchSize);
                  downloadResultsAsZip(toZip, `land-use-classifications-batch-${Date.now()}`).catch(() => {});
                  return [...prev.slice(batchSize), nextResult];
                }
                return [...prev, nextResult];
              });
            }
          } catch (e) {
            if (continueOnError) {
              setFailedFiles((f) => [...f, { filename: file.name, error: e instanceof Error ? e.message : "Processing failed" }]);
            } else {
              throw e;
            }
          }
        }
      } else {
        let nextIndex = 0;
        const processNext = async (): Promise<void> => {
          const i = nextIndex++;
          if (i >= files.length) return;
          const file = files[i];
          try {
            const nextResult = await processOneFile(file);
            if (nextResult) {
              setProcessedResults((prev) => {
                if (autoDownloadWhenFull && prev.length >= maxResultsInMemory && batchSize > 0) {
                  const toZip = prev.slice(0, batchSize);
                  downloadResultsAsZip(toZip, `land-use-classifications-batch-${Date.now()}`).catch(() => {});
                  return [...prev.slice(batchSize), nextResult];
                }
                return [...prev, nextResult];
              });
            }
          } catch (e) {
            if (continueOnError) {
              setFailedFiles((f) => [...f, { filename: file.name, error: e instanceof Error ? e.message : "Processing failed" }]);
            } else {
              setProcessError(e instanceof Error ? e.message : "Processing failed");
            }
          }
          await processNext();
        };
        await Promise.all(Array.from({ length: concurrencyLimit }, () => processNext()));
      }
    } catch (e) {
      if (!continueOnError) {
        setProcessError(e instanceof Error ? e.message : "Processing failed");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="container mx-auto px-4 py-10">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            UCSB Data Science Project Series &apos;26
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Land Use Classification for Environmental Science Research
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Upload satellite imagery for automated land use classification. Our model processes your images and returns color-coded classifications layered on top of the original image, enabling easy and quick analysis of land cover patterns for research applications.
          </p>
        </header>
        <div className="mb-4 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <label
              htmlFor="compact-view-toggle"
              className="text-sm font-medium text-muted-foreground cursor-pointer select-none"
            >
              Compact view
            </label>
            <Switch
              id="compact-view-toggle"
              checked={compactView}
              onCheckedChange={setCompactView}
              aria-label="Toggle compact view for input and output"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 border-l border-border pl-4">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Large-scale
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="auto-download-toggle" className="text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                Auto-download when full
              </label>
              <Switch
                id="auto-download-toggle"
                checked={autoDownloadWhenFull}
                onCheckedChange={setAutoDownloadWhenFull}
                aria-label="Auto-download batch when memory cap reached"
              />
            </div>
            {autoDownloadWhenFull && (
              <>
                <div className="flex items-center gap-2">
                  <label htmlFor="batch-size-input" className="text-sm text-muted-foreground whitespace-nowrap">
                    Batch size
                  </label>
                  <input
                    id="batch-size-input"
                    type="number"
                    min={25}
                    max={500}
                    step={25}
                    value={batchSize}
                    onChange={(e) => setBatchSize(Math.max(25, Math.min(500, Number(e.target.value) || 100)))}
                    className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
              </>
            )}
            <div className="flex items-center gap-2">
              <label htmlFor="continue-on-error-toggle" className="text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                Continue on error
              </label>
              <Switch
                id="continue-on-error-toggle"
                checked={continueOnError}
                onCheckedChange={setContinueOnError}
                aria-label="Continue processing when a file fails"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="concurrency-input" className="text-sm text-muted-foreground whitespace-nowrap">
                Concurrent
              </label>
              <select
                id="concurrency-input"
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {failedFiles.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              {failedFiles.length} file{failedFiles.length !== 1 ? "s" : ""} failed
            </p>
            <ul className="mt-1 max-h-24 overflow-y-auto list-disc list-inside text-muted-foreground">
              {failedFiles.map((f, i) => (
                <li key={`${f.filename}-${i}`} title={f.error}>
                  {f.filename}: {f.error}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setFailedFiles([])}
              className="mt-2 text-xs underline text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <FileUpload
            onProcess={handleProcess}
            isProcessing={isProcessing}
            processError={processError}
            clearProcessError={() => setProcessError(null)}
            compactView={compactView}
            maxFiles={autoDownloadWhenFull ? 10_000 : 500}
          />
          <ProcessedFiles
            processedResults={processedResults}
            compactView={compactView}
            onClearResults={() => setProcessedResults([])}
            autoDownloadWhenFull={autoDownloadWhenFull}
          />
        </div>
      </div>
    </div>
  );
}
