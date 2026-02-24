"use client"

import { useState } from "react";
import FileUpload from "@/components/file-upload";
import ProcessedFiles from "@/components/processed-files";

export type ProcessedResult = {
  filename: string;
  preview_image_base64: string;
  class_legend: Record<number, string>;
  height: number;
  width: number;
};

export default function Home() {
  const [processedResults, setProcessedResults] = useState<ProcessedResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  const apiBase =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
      : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const handleProcess = async (files: File[]) => {
    if (!files.length) return;
    setIsProcessing(true);
    setProcessError(null);
    const newResults: ProcessedResult[] = [];
    try {
      for (const file of files) {
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
        newResults.push({
          filename: data.filename,
          preview_image_base64: data.preview_image_base64,
          class_legend: data.class_legend,
          height: data.height,
          width: data.width,
        });
      }
      setProcessedResults((prev) => [...prev, ...newResults]);
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
        </header>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <FileUpload
            onProcess={handleProcess}
            isProcessing={isProcessing}
            processError={processError}
            clearProcessError={() => setProcessError(null)}
          />
          <ProcessedFiles
            processedResults={processedResults}
            onClearResults={() => setProcessedResults([])}
          />
        </div>
      </div>
    </div>
  );
}
