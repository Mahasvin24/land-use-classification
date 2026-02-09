import FileUpload from "@/components/file-upload";
import ProcessedFiles from "@/components/processed-files";

export default function Home() {
  return (
    <div className="min-h-screen bg-muted/40">
      <div className="container mx-auto px-4 py-10">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Land Use Classification
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Upload imagery and view processed results
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Drag and drop your image, then review the processed output when it is
            ready. This is a UI-only preview of the flow.
          </p>
        </header>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <FileUpload />
          <ProcessedFiles />
        </div>
      </div>
    </div>
  );
}

