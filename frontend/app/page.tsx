"use client"

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

const modelOptions = ["Terrae v2.3", "Oscilla v1.7"] as const;
type ModelOption = (typeof modelOptions)[number];
type ModelConfig = {
  maxFiles: number;
  showLargeScaleControls: boolean;
  uploadCardTitle: string;
  uploadDescription: string;
  uploadHelperText?: string;
  resultsCardTitle: string;
  resultsDescription: string;
  outputFormatLabel: string;
  processActionLabel: string;
};

const modelConfig: Record<ModelOption, ModelConfig> = {
  "Terrae v2.3": {
    maxFiles: 500,
    showLargeScaleControls: true,
    uploadCardTitle: "Upload Satellite Imagery",
    uploadDescription:
      "Upload one or many satellite images to generate Terrae v2.3 color-coded land use classifications.",
    resultsCardTitle: "Terrae v2.3 output",
    resultsDescription: "Your Terrae v2.3 classified images will appear here after processing.",
    outputFormatLabel: "GeoTIFF preview",
    processActionLabel: "Process with Terrae v2.3",
  },
  "Oscilla v1.7": {
    maxFiles: 250,
    showLargeScaleControls: false,
    uploadCardTitle: "Upload One Area Across Time",
    uploadDescription:
      "Upload imagery of the same location from different time periods. Oscilla v1.7 analyzes land cover changes over time and produces one combined classified land cover result.",
    uploadHelperText:
      "Requires at least 3 images. Each filename must start with YYYY_MM_DD (e.g. 2023_05_14.tif). GeoTIFFs must have either 4 bands (B3, B4, B8, B11) or 5 bands (B2, B3, B4, B8, B11).",
    resultsCardTitle: "Oscilla v1.7 time-series output",
    resultsDescription:
      "Oscilla v1.7 will process one area across multiple time periods and generate a single classified land cover image here.",
    outputFormatLabel: "Single classified image (time-series)",
    processActionLabel: "Analyze",
  },
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
  const [selectedModel, setSelectedModel] = useState<ModelOption>("Terrae v2.3");
  const maxResultsInMemory = 500;
  const [batchSize, setBatchSize] = useState(100);
  const [concurrency, setConcurrency] = useState(1);
  const activeModelConfig = modelConfig[selectedModel];

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

  useEffect(() => {
    setProcessedResults([]);
    setProcessError(null);
    if (!modelConfig[selectedModel].showLargeScaleControls) {
      setAutoDownloadWhenFull(false);
    }
  }, [selectedModel]);

  const apiBase =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
      : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const processOneFile = async (file: File): Promise<ProcessedResult | null> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", selectedModel);
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

  const processOscillaBatch = async (files: File[]): Promise<void> => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file);
    });
    const res = await fetch(`${apiBase}/predict_oscilla`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Request failed: ${res.status}`);
    }
    const data = await res.json();
    const result: ProcessedResult = {
      filename: data.filename,
      preview_image_base64: data.preview_image_base64,
      class_legend: data.class_legend,
      height: data.height,
      width: data.width,
    };
    setProcessedResults([result]);
  };

  const handleProcess = async (files: File[]) => {
    if (!files.length) return;
    setIsProcessing(true);
    setProcessError(null);

    if (selectedModel === "Oscilla v1.7") {
      try {
        if (files.length < 3) {
          throw new Error(
            "Oscilla needs at least 3 dated images to fit an annual harmonic. Add more files and try again."
          );
        }
        const dateRe = /^\d{4}_\d{2}_\d{2}/;
        const badFile = files.find((f) => !dateRe.test(f.name));
        if (badFile) {
          throw new Error(
            `Filename "${badFile.name}" must start with YYYY_MM_DD (e.g. 2023_05_14.tif) so Oscilla can fit the annual harmonic.`
          );
        }
        await processOscillaBatch(files);
      } catch (e) {
        setProcessError(e instanceof Error ? e.message : "Processing failed");
      } finally {
        setIsProcessing(false);
      }
      return;
    }

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
            throw e;
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
            setProcessError(e instanceof Error ? e.message : "Processing failed");
          }
          await processNext();
        };
        await Promise.all(Array.from({ length: concurrencyLimit }, () => processNext()));
      }
    } catch (e) {
      setProcessError(e instanceof Error ? e.message : "Processing failed");
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
          <div className="flex flex-wrap items-start gap-6 pt-2">
            <div className="flex min-w-0 items-stretch gap-6">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Model
                </p>
                <ToggleGroup
                  type="single"
                  value={selectedModel}
                  onValueChange={(value) => {
                    if (value) setSelectedModel(value as ModelOption);
                  }}
                  aria-label="Model selection"
                  className="overflow-hidden rounded-md"
                >
                  {modelOptions.map((model) => (
                    <ToggleGroupItem
                      key={model}
                      value={model}
                      className="rounded-none border-0 first:rounded-l-md first:border-r last:rounded-r-md"
                    >
                      {model}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="w-px shrink-0 self-stretch bg-border" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Settings
              </p>
              <div className="flex min-h-8 flex-wrap items-center gap-6">
                <div className="flex min-h-8 items-center gap-3">
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
                {activeModelConfig.showLargeScaleControls && (
                  <div className="flex min-h-8 flex-wrap items-center gap-4 border-l border-border pl-6">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Large-scale
                    </span>
                    <div className="flex min-h-8 items-center gap-2">
                      <label htmlFor="auto-download-toggle" className="text-sm font-medium text-muted-foreground cursor-pointer select-none whitespace-nowrap">
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
                      <div className="flex min-h-8 items-center gap-2">
                        <label htmlFor="batch-size-input" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                          Batch size
                        </label>
                        <input
                          id="batch-size-input"
                          type="number"
                          min={1}
                          max={500}
                          step={25}
                          value={batchSize}
                          onChange={(e) => setBatchSize(Math.max(1, Math.min(500, Number(e.target.value) || 100)))}
                          className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
                        />
                      </div>
                    )}
                    <div className="flex min-h-8 items-center gap-2">
                      <label htmlFor="concurrency-input" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
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
                )}
              </div>
            </div>
          </div>
        </header>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <FileUpload
            onProcess={handleProcess}
            isProcessing={isProcessing}
            processError={processError}
            clearProcessError={() => setProcessError(null)}
            compactView={compactView}
            maxFiles={autoDownloadWhenFull ? 10_000 : activeModelConfig.maxFiles}
            title={activeModelConfig.uploadCardTitle}
            description={activeModelConfig.uploadDescription}
            processActionLabel={activeModelConfig.processActionLabel}
            helperText={activeModelConfig.uploadHelperText}
          />
          <ProcessedFiles
            processedResults={processedResults}
            compactView={compactView}
            onClearResults={() => setProcessedResults([])}
            autoDownloadWhenFull={autoDownloadWhenFull}
            title={activeModelConfig.resultsCardTitle}
            description={activeModelConfig.resultsDescription}
            outputFormatLabel={activeModelConfig.outputFormatLabel}
          />
        </div>
      </div>
    </div>
  );
}
