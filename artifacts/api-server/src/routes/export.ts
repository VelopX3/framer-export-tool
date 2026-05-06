import { Router, Request, Response } from "express";
import archiver from "archiver";
import * as cheerio from "cheerio";
import crypto from "crypto";
import { StartExportBody, GetExportStatusParams } from "@workspace/api-zod";

const router = Router();

type JobStatus = "pending" | "processing" | "done" | "error";

interface Job {
  jobId: string;
  status: JobStatus;
  message: string;
  zipBuffer?: Buffer;
  createdAt: number;
}

const jobs = new Map<string, Job>();

const FRAMER_BADGE_SELECTORS = [
  '[class*="framer-badge"]',
  '[class*="FramerBadge"]',
  '[id*="framer-badge"]',
  '[data-framer-badge]',
  'a[href*="framer.com"][target="_blank"]',
  '.framer-badge',
  '#framer-badge',
  '[class*="__framer-badge"]',
  'div[style*="framer.com/badge"]',
  'img[src*="framer.com/badge"]',
  'a[href="https://framer.com"]',
];

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FramerExporter/1.0)",
      },
    });
    return res as unknown as Response;
  } finally {
    clearTimeout(id);
  }
}

function resolveUrl(base: string, relative: string): string | null {
  try {
    return new URL(relative, base).toString();
  } catch {
    return null;
  }
}

async function processExport(job: Job, siteUrl: string) {
  job.status = "processing";
  job.message = "Fetching site...";

  try {
    const baseUrl = new URL(siteUrl);
    const origin = baseUrl.origin;

    const htmlRes = await fetchWithTimeout(siteUrl);
    if (!htmlRes.ok) {
      throw new Error(`Failed to fetch site: HTTP ${htmlRes.status}`);
    }
    const htmlText = await (htmlRes as unknown as globalThis.Response).text();

    const $ = cheerio.load(htmlText);

    for (const sel of FRAMER_BADGE_SELECTORS) {
      $(sel).remove();
    }

    $("script, link, img, source").each((_, el) => {
      const tag = $(el);
      const src = tag.attr("src") || tag.attr("href");
      if (src && !src.startsWith("data:") && !src.startsWith("javascript:")) {
        const abs = resolveUrl(siteUrl, src);
        if (abs && abs.startsWith(origin)) {
          const localPath = abs.replace(origin, "");
          if (tag.attr("src") !== undefined) tag.attr("src", "." + localPath);
          else if (tag.attr("href") !== undefined) tag.attr("href", "." + localPath);
        }
      }
    });

    $("style").each((_, el) => {
      const content = $(el).html() || "";
      const updated = content.replace(
        /url\(['"]?((?!data:)[^'")]+)['"]?\)/g,
        (match, urlVal) => {
          const abs = resolveUrl(siteUrl, urlVal);
          if (abs && abs.startsWith(origin)) {
            const local = "." + abs.replace(origin, "");
            return `url('${local}')`;
          }
          return match;
        }
      );
      $(el).html(updated);
    });

    const modifiedHtml = $.html();

    const resourceUrls = new Set<string>();
    $("[src], [href]").each((_, el) => {
      const val = $(el).attr("src") || $(el).attr("href");
      if (val && val.startsWith(".")) {
        const abs = resolveUrl(siteUrl, val.replace(/^\./, ""));
        if (abs && abs.startsWith(origin)) resourceUrls.add(abs);
      }
    });

    job.message = `Downloading ${resourceUrls.size} assets...`;

    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));

    archive.append(modifiedHtml, { name: "index.html" });

    const downloads = Array.from(resourceUrls).slice(0, 200);
    await Promise.allSettled(
      downloads.map(async (url) => {
        try {
          const res = await fetchWithTimeout(url, 10000);
          if (res.ok) {
            const buf = Buffer.from(await (res as unknown as globalThis.Response).arrayBuffer());
            let path = new URL(url).pathname.replace(/^\//, "");
            if (!path || path.endsWith("/")) path = (path || "") + "index.html";
            archive.append(buf, { name: path });
          }
        } catch {
        }
      })
    );

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
    });

    job.zipBuffer = Buffer.concat(chunks);
    job.status = "done";
    job.message = "Export complete";
  } catch (err: unknown) {
    job.status = "error";
    job.message = err instanceof Error ? err.message : "Unknown error";
  }
}

router.post("/start", (req: Request, res: Response) => {
  const parse = StartExportBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { url } = parse.data;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    res.status(400).json({ error: "Invalid URL. Please provide a full URL including https://" });
    return;
  }

  const jobId = crypto.randomUUID();
  const job: Job = {
    jobId,
    status: "pending",
    message: "Job queued",
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);

  void processExport(job, url);

  res.json({ jobId, message: "Export started" });
});

router.get("/:jobId/status", (req: Request, res: Response) => {
  const parse = GetExportStatusParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const job = jobs.get(parse.data.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const downloadUrl = job.status === "done" ? `/api/export/${job.jobId}/download` : undefined;

  res.json({
    jobId: job.jobId,
    status: job.status,
    message: job.message,
    ...(downloadUrl ? { downloadUrl } : {}),
  });
});

router.get("/:jobId/download", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "done" || !job.zipBuffer) {
    res.status(400).json({ error: "Export not ready" });
    return;
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="framer-export.zip"`);
  res.send(job.zipBuffer);
});

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 10 * 60 * 1000);

export default router;
