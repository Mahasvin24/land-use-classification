import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ImageIcon, Scan } from "lucide-react";

export default function ProcessedFiles() {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Processed output</CardTitle>
          <Badge variant="outline" className="gap-1">
            <Scan className="h-3.5 w-3.5" />
            Awaiting upload
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Your classified image will appear here after processing.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed bg-muted/30 p-6 text-center">
          <div className="space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border bg-background">
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No processed image yet</p>
              <p className="text-xs text-muted-foreground">
                Upload an image to generate a land use classification preview.
              </p>
            </div>
          </div>
        </div>

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
            <p className="text-sm font-medium">Waiting for upload</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}