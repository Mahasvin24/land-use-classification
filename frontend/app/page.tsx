"use client"

import { useEffect, useMemo, useState } from "react";
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
const classFilterOptions = [
  { id: "5", label: "Bare", color: "#b4b4b4" },
  { id: "6", label: "Water", color: "#0064ff" },
  { id: "4", label: "Built-up", color: "#fa0000" },
  { id: "3", label: "Cropland", color: "#f096ff" },
  { id: "0", label: "Forest", color: "#006400" },
  { id: "1", label: "Shrubland", color: "#ffbb22" },
  { id: "2", label: "Grassland", color: "#ffff4c" },
] as const;
const vegetationClassIds = ["0", "1", "2"] as const;
type ModelOption = (typeof modelOptions)[number];
type ModelConfig = {
  maxFiles: number;
  showLargeScaleControls: boolean;
  uploadCardTitle: string;
  uploadDescription: string;
  uploadHelperText?: string;
  resultsCardTitle: string;
  resultsDescription: string;
  /** Shown in the results panel when there is nothing to display yet. */
  resultsEmptyHint: string;
  outputFormatLabel: string;
  processActionLabel: string;
};

const modelConfig: Record<ModelOption, ModelConfig> = {
  "Terrae v2.3": {
    maxFiles: 500,
    showLargeScaleControls: true,
    uploadCardTitle: "Upload Satellite Imagery",
    uploadDescription: "Many GeoTIFFs → color-coded land cover per image.",
    resultsCardTitle: "Terrae v2.3 output",
    resultsDescription: "Previews show here after each run finishes.",
    resultsEmptyHint: "Add GeoTIFFs, then Analyze.",
    outputFormatLabel: "GeoTIFF preview",
    processActionLabel: "Analyze",
  },
  "Oscilla v1.7": {
    maxFiles: 250,
    showLargeScaleControls: false,
    uploadCardTitle: "Land Classification Across Time",
    uploadDescription: "Same place, several dates → one merged land-cover map.",
    uploadHelperText:
      "Requires 3 or more images with file names starting with YYYY_MM_DD.",
    resultsCardTitle: "Oscilla v1.7 output",
    resultsDescription: "Single combined preview from your dated stack.",
    resultsEmptyHint: "Add ≥3 dated GeoTIFFs for one site, then Analyze.",
    outputFormatLabel: "One merged PNG",
    processActionLabel: "Analyze",
  },
};

function emptyByModel<T>(value: T): Record<ModelOption, T> {
  return { "Terrae v2.3": value, "Oscilla v1.7": value };
}

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
  const [processedResultsByModel, setProcessedResultsByModel] = useState<
    Record<ModelOption, ProcessedResult[]>
  >(() => emptyByModel([]));
  const [isProcessingByModel, setIsProcessingByModel] = useState<Record<ModelOption, boolean>>(
    () => emptyByModel(false)
  );
  const [processingStatusLineByModel, setProcessingStatusLineByModel] = useState<
    Record<ModelOption, string | null>
  >(() => emptyByModel(null));
  const [processErrorByModel, setProcessErrorByModel] = useState<Record<ModelOption, string | null>>(
    () => emptyByModel(null)
  );
  const [compactView, setCompactView] = useState(false);
  const [autoDownloadWhenFull, setAutoDownloadWhenFull] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelOption>("Terrae v2.3");
  const [pendingFilesByModel, setPendingFilesByModel] = useState<Record<ModelOption, File[]>>({
    "Terrae v2.3": [],
    "Oscilla v1.7": [],
  });
  const maxResultsInMemory = 500;
  const [batchSize, setBatchSize] = useState(100);
  const [concurrency, setConcurrency] = useState(1);
  const [activeClassFilters, setActiveClassFilters] = useState<Record<string, boolean>>({
    "0": true,
    "1": true,
    "2": true,
    "3": true,
    "4": true,
    "5": true,
    "6": true,
    veg: false,
  });
  const activeModelConfig = modelConfig[selectedModel];
  const selectedClassIds = useMemo(() => {
    const selected = new Set<number>();
    Object.entries(activeClassFilters).forEach(([key, enabled]) => {
      if (!enabled) return;
      if (key === "veg") {
        [0, 1, 2].forEach((id) => selected.add(id));
        return;
      }
      const parsed = Number(key);
      if (!Number.isNaN(parsed)) selected.add(parsed);
    });
    return Array.from(selected).sort((a, b) => a - b);
  }, [activeClassFilters]);

  const setFilter = (id: string, checked: boolean) => {
    setActiveClassFilters((prev) => {
      const next = { ...prev };

      if (id === "veg") {
        next.veg = checked;
        if (checked) {
          vegetationClassIds.forEach((vegId) => {
            next[vegId] = false;
          });
        } else {
          vegetationClassIds.forEach((vegId) => {
            next[vegId] = true;
          });
        }
        return next;
      }

      next[id] = checked;
      if (checked && vegetationClassIds.includes(id as (typeof vegetationClassIds)[number])) {
        next.veg = false;
      }
      return next;
    });
  };

  const CACHE_KEY_RESULTS_V2 = "luc_processed_results_by_model_v1";
  const CACHE_KEY_RESULTS_LEGACY = "luc_processed_results_v1";
  const CACHE_KEY_COMPACT = "luc_compact_view_v1";
  const CACHE_MAX_RESULTS = 100;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v2 = window.localStorage.getItem(CACHE_KEY_RESULTS_V2);
      if (v2) {
        const parsed = JSON.parse(v2) as Record<string, unknown>;
        const terrae = parsed["Terrae v2.3"];
        const oscilla = parsed["Oscilla v1.7"];
        setProcessedResultsByModel({
          "Terrae v2.3": Array.isArray(terrae) ? (terrae as ProcessedResult[]) : [],
          "Oscilla v1.7": Array.isArray(oscilla) ? (oscilla as ProcessedResult[]) : [],
        });
      } else {
        const legacy = window.localStorage.getItem(CACHE_KEY_RESULTS_LEGACY);
        if (legacy) {
          const parsed = JSON.parse(legacy) as ProcessedResult[];
          if (Array.isArray(parsed)) {
            setProcessedResultsByModel({ "Terrae v2.3": parsed, "Oscilla v1.7": [] });
          }
        }
      }
      const cachedCompact = window.localStorage.getItem(CACHE_KEY_COMPACT);
      if (cachedCompact != null) setCompactView(cachedCompact === "true");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (autoDownloadWhenFull || processedResultsByModel["Terrae v2.3"].length > CACHE_MAX_RESULTS)
      return;
    try {
      window.localStorage.setItem(CACHE_KEY_RESULTS_V2, JSON.stringify(processedResultsByModel));
    } catch {
      // ignore quota
    }
  }, [autoDownloadWhenFull, processedResultsByModel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CACHE_KEY_COMPACT, String(compactView));
    } catch {
      // ignore
    }
  }, [compactView]);

  useEffect(() => {
    if (!modelConfig[selectedModel].showLargeScaleControls) {
      setAutoDownloadWhenFull(false);
    }
  }, [selectedModel]);

  const apiBase =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
      : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const processOneFile = async (
    file: File,
    model: ModelOption
  ): Promise<ProcessedResult | null> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", model);
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
    setProcessedResultsByModel((prev) => ({ ...prev, "Oscilla v1.7": [result] }));
  };

  const handleProcess = async (files: File[]) => {
    if (!files.length) return;
    const model = selectedModel;
    setIsProcessingByModel((p) => ({ ...p, [model]: true }));
    setProcessErrorByModel((p) => ({ ...p, [model]: null }));

    if (model === "Oscilla v1.7") {
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
        setProcessingStatusLineByModel((p) => ({ ...p, [model]: "Processing 1 of 1" }));
        await processOscillaBatch(files);
      } catch (e) {
        setProcessErrorByModel((p) => ({
          ...p,
          [model]: e instanceof Error ? e.message : "Processing failed",
        }));
      } finally {
        setProcessingStatusLineByModel((p) => ({ ...p, [model]: null }));
        setIsProcessingByModel((p) => ({ ...p, [model]: false }));
      }
      return;
    }

    const concurrencyLimit = Math.max(1, Math.min(5, concurrency));
    const snapAuto = autoDownloadWhenFull;
    const snapBatch = batchSize;
    try {
      if (concurrencyLimit === 1) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setProcessingStatusLineByModel((p) => ({
            ...p,
            [model]: `Processing ${i + 1} of ${files.length}`,
          }));
          try {
            const nextResult = await processOneFile(file, model);
            if (nextResult) {
              setProcessedResultsByModel((prev) => {
                const bucket = prev[model];
                if (snapAuto && bucket.length >= maxResultsInMemory && snapBatch > 0) {
                  const toZip = bucket.slice(0, snapBatch);
                  downloadResultsAsZip(toZip, `land-use-classifications-batch-${Date.now()}`).catch(() => {});
                  return {
                    ...prev,
                    [model]: [...bucket.slice(snapBatch), nextResult],
                  };
                }
                return { ...prev, [model]: [...bucket, nextResult] };
              });
            }
          } catch (e) {
            throw e;
          }
        }
      } else {
        let nextIndex = 0;
        let finished = 0;
        setProcessingStatusLineByModel((p) => ({
          ...p,
          [model]: `Processing 0 of ${files.length}`,
        }));
        const processNext = async (): Promise<void> => {
          const i = nextIndex++;
          if (i >= files.length) return;
          const file = files[i];
          try {
            const nextResult = await processOneFile(file, model);
            if (nextResult) {
              setProcessedResultsByModel((prev) => {
                const bucket = prev[model];
                if (snapAuto && bucket.length >= maxResultsInMemory && snapBatch > 0) {
                  const toZip = bucket.slice(0, snapBatch);
                  downloadResultsAsZip(toZip, `land-use-classifications-batch-${Date.now()}`).catch(() => {});
                  return {
                    ...prev,
                    [model]: [...bucket.slice(snapBatch), nextResult],
                  };
                }
                return { ...prev, [model]: [...bucket, nextResult] };
              });
            }
          } catch (e) {
            setProcessErrorByModel((p) => ({
              ...p,
              [model]: e instanceof Error ? e.message : "Processing failed",
            }));
          } finally {
            finished += 1;
            setProcessingStatusLineByModel((p) => ({
              ...p,
              [model]: `Processing ${finished} of ${files.length}`,
            }));
          }
          await processNext();
        };
        await Promise.all(Array.from({ length: concurrencyLimit }, () => processNext()));
      }
    } catch (e) {
      setProcessErrorByModel((p) => ({
        ...p,
        [model]: e instanceof Error ? e.message : "Processing failed",
      }));
    } finally {
      setProcessingStatusLineByModel((p) => ({ ...p, [model]: null }));
      setIsProcessingByModel((p) => ({ ...p, [model]: false }));
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
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Classifications
              </p>
              <div className="flex min-h-8 flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={activeClassFilters.veg}
                    onCheckedChange={(checked) => setFilter("veg", checked)}
                    aria-label="Toggle general vegetation"
                  />
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-border/70"
                    style={{ backgroundColor: "#3f8f3f" }}
                    aria-hidden
                  />
                  <span className="select-none whitespace-nowrap font-medium">General vegetation</span>
                </label>
                <span className="mx-1 h-5 w-px bg-border/70" aria-hidden />
                {classFilterOptions.map((option) => {
                  const isChecked = activeClassFilters[option.id];
                  const isVegSpecificClass = vegetationClassIds.includes(
                    option.id as (typeof vegetationClassIds)[number]
                  );
                  const isDisabled = Boolean(activeClassFilters.veg && isVegSpecificClass);
                  return (
                    <label
                      key={option.id}
                      className={`flex items-center gap-2 px-2.5 py-1 text-xs transition ${
                        isDisabled
                          ? "cursor-not-allowed text-muted-foreground/40"
                          : isChecked
                            ? "cursor-pointer rounded-sm border border-black/40 bg-muted/8 text-foreground"
                          : "cursor-pointer text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isDisabled}
                        onChange={(e) => setFilter(option.id, e.target.checked)}
                        className="h-3.5 w-3.5 rounded border border-border/70 bg-transparent accent-primary"
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full border border-border/70"
                        style={{ backgroundColor: option.color }}
                        aria-hidden
                      />
                      <span className="select-none whitespace-nowrap">{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </header>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <FileUpload
            files={pendingFilesByModel[selectedModel]}
            onFilesChange={(next) =>
              setPendingFilesByModel((prev) => ({ ...prev, [selectedModel]: next }))
            }
            onProcess={handleProcess}
            isProcessing={isProcessingByModel[selectedModel]}
            processingStatusLine={processingStatusLineByModel[selectedModel]}
            processError={processErrorByModel[selectedModel]}
            clearProcessError={() =>
              setProcessErrorByModel((p) => ({ ...p, [selectedModel]: null }))
            }
            compactView={compactView}
            maxFiles={autoDownloadWhenFull ? 10_000 : activeModelConfig.maxFiles}
            title={activeModelConfig.uploadCardTitle}
            description={activeModelConfig.uploadDescription}
            processActionLabel={activeModelConfig.processActionLabel}
            helperText={activeModelConfig.uploadHelperText}
          />
          <ProcessedFiles
            processedResults={processedResultsByModel[selectedModel]}
            compactView={compactView}
            onClearResults={() =>
              setProcessedResultsByModel((p) => ({ ...p, [selectedModel]: [] }))
            }
            autoDownloadWhenFull={autoDownloadWhenFull}
            title={activeModelConfig.resultsCardTitle}
            description={activeModelConfig.resultsDescription}
            outputFormatLabel={activeModelConfig.outputFormatLabel}
            resultsEmptyHint={activeModelConfig.resultsEmptyHint}
            singleCombinedOutput={selectedModel === "Oscilla v1.7"}
            selectedClassIds={selectedClassIds}
            generalVegetationActive={activeClassFilters.veg}
          />
        </div>
      </div>
    </div>
  );
}
