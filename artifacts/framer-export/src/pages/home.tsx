import { useState } from "react";
import { useStartExport, useGetExportStatus, getGetExportStatusQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Download, AlertCircle, CheckCircle2, ArrowRight, Zap, Terminal } from "lucide-react";

export default function Home() {
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const startExport = useStartExport();

  const { data: exportStatus } = useGetExportStatus(jobId as string, {
    query: {
      enabled: !!jobId,
      queryKey: jobId ? getGetExportStatusQueryKey(jobId) : undefined,
      refetchInterval: (query) => {
        // @ts-ignore
        const status = query.state?.data?.status;
        return (!status || status === "pending" || status === "processing") ? 1500 : false;
      }
    }
  });

  const handleExport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setJobId(null);
    startExport.mutate(
      { data: { url: url.trim() } },
      {
        onSuccess: (res) => {
          setJobId(res.jobId);
        },
      }
    );
  };

  const isPending = startExport.isPending || 
    (exportStatus && (exportStatus.status === "pending" || exportStatus.status === "processing"));

  const isDone = exportStatus?.status === "done";
  const isError = startExport.isError || exportStatus?.status === "error";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8 bg-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/10 blur-[120px] rounded-full" />
      </div>

      <div className="w-full max-w-2xl z-10 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
        
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-3 bg-secondary rounded-xl mb-4 border border-border glow-effect">
            <Terminal className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white">
            Export any Framer site. <br className="hidden sm:block" />
            <span className="text-primary">No watermark.</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-lg mx-auto">
            Take true ownership of your source code. Paste your Framer URL and download a clean, standalone bundle in seconds.
          </p>
        </div>

        {/* Main Action Card */}
        <Card className="border-border bg-card/50 backdrop-blur-xl glow-effect">
          <CardContent className="p-6 sm:p-8">
            <form onSubmit={handleExport} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="url" className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                  Target URL
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://mysite.framer.app"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={!!isPending}
                    required
                    className="flex-1 bg-background/50 border-border text-white font-mono placeholder:text-muted-foreground h-12 text-base"
                    data-testid="input-framer-url"
                  />
                  <Button 
                    type="submit" 
                    size="lg" 
                    disabled={!!isPending || !url.trim()}
                    className="h-12 px-8 font-mono tracking-wide w-full sm:w-auto glow-effect-strong"
                    data-testid="button-start-export"
                  >
                    {startExport.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4 mr-2" />
                    )}
                    INITIATE
                  </Button>
                </div>
              </div>
            </form>

            {/* Status Area */}
            {jobId && (
              <div className="mt-8 pt-8 border-t border-border animate-in fade-in slide-in-from-top-4">
                <div className="flex flex-col items-center text-center space-y-6">
                  
                  {/* Progress indicators */}
                  {!isDone && !isError && (
                    <div className="space-y-4 w-full max-w-sm mx-auto">
                      <div className="flex justify-center mb-2">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                      </div>
                      <div className="h-1 w-full bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary w-full origin-left animate-[pulse_2s_ease-in-out_infinite]" />
                      </div>
                      <p className="font-mono text-sm text-primary tracking-widest uppercase" data-testid="text-status-message">
                        {exportStatus?.message || "Initializing job..."}
                      </p>
                    </div>
                  )}

                  {/* Success State */}
                  {isDone && (
                    <div className="space-y-6 w-full animate-in zoom-in-95 duration-500">
                      <div className="flex justify-center">
                        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center glow-effect-strong">
                          <CheckCircle2 className="w-8 h-8 text-primary" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-bold text-white">Extraction Complete</h3>
                        <p className="text-muted-foreground font-mono text-sm">
                          {exportStatus?.message || "Source code bundled successfully."}
                        </p>
                      </div>
                      <Button
                        size="lg"
                        className="w-full sm:w-auto px-12 h-14 text-lg font-bold tracking-wide glow-effect-strong"
                        asChild
                        data-testid="link-download-zip"
                      >
                        <a href={`/api/export/${jobId}/download`} target="_blank" rel="noopener noreferrer">
                          <Download className="w-5 h-5 mr-3" />
                          DOWNLOAD ZIP
                        </a>
                      </Button>
                    </div>
                  )}

                  {/* Error State */}
                  {isError && (
                    <div className="space-y-4 w-full p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-center animate-in zoom-in-95">
                      <div className="flex justify-center mb-2">
                        <AlertCircle className="w-8 h-8 text-destructive" />
                      </div>
                      <h3 className="text-lg font-bold text-destructive">Extraction Failed</h3>
                      <p className="text-sm font-mono text-destructive/80" data-testid="text-error-message">
                        {exportStatus?.message || startExport.error?.error || "An unknown error occurred during extraction."}
                      </p>
                      <Button
                        variant="outline"
                        className="mt-4 border-destructive/50 text-destructive hover:bg-destructive/20"
                        onClick={() => {
                          setJobId(null);
                          startExport.reset();
                        }}
                        data-testid="button-retry"
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs font-mono text-muted-foreground/50 tracking-widest uppercase">
          SYSTEM_READY_ // AWAITING_INPUT
        </p>
      </div>
    </div>
  );
}
