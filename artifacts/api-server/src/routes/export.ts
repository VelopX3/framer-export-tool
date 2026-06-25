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

// ── "Made in Framer" badge selectors ─────────────────────────────────────────
const FRAMER_BADGE_SELECTORS = [
  // Official badge container ID (most reliable)
  '#__framer-badge-container',
  '[id*="framer-badge"]',

  // Class-based patterns
  '[class*="framer-badge"]',
  '[class*="FramerBadge"]',
  '[class*="__framer-badge"]',
  '.framer-badge',
  '#framer-badge',

  // Inline-style and asset-based patterns
  'div[style*="framer.com/badge"]',
  'img[src*="framer.com/badge"]',

  // Any anchor that links back to Framer branding
  'a[href="https://framer.com"]',
  'a[href*="framer.com"][target="_blank"]',

  // Generic data attribute
  '[data-framer-badge]',
];

// ── "Edit Content" / On-page editing UI selectors ────────────────────────────
// The Edit Content button and pencil icon are injected by Framer's CMS scripts.
// These selectors target every known variant of that UI element.
const FRAMER_EDIT_SELECTORS = [
  // Common IDs used by Framer's on-page editor overlay
  '#framer-edit-overlay',
  '#__framer-edit-container',
  '#framer-cms-edit',
  '[id*="framer-edit"]',
  '[id*="framer-cms"]',

  // Class-based patterns for the edit button/panel
  '[class*="framer-edit"]',
  '[class*="FramerEdit"]',
  '[class*="framer-cms"]',
  '[class*="FramerCms"]',
  '[class*="edit-content"]',
  '[class*="EditContent"]',

  // Data attributes emitted by Framer's CMS editing mode
  '[data-framer-cms]',
  '[data-framer-edit]',
  '[data-framer-on-page-edit]',

  // Framer publishes a floating toolbar for editors
  '[class*="framer-toolbar"]',
  '[id*="framer-toolbar"]',
];

// ── Script URL patterns whose removal kills dynamic injection ─────────────────
// When these scripts are removed from the HTML, the Edit Content button and
// badge can never be re-injected at runtime — belt-and-suspenders approach.
const FRAMER_SCRIPT_PATTERNS = [
  'framer.com/badge',
  'framer.com/cms',
  'framer.com/edit',
  'framer-badge',
  'framer-cms',
  'framerusercontent.com/badge',
  // The on-page editor script
  '__framer__cms',
  'on-page-edit',
];

// ── CSS kill-switch injected into exported HTML ───────────────────────────────
// Handles any element Cheerio's static parse might miss that gets rendered
// dynamically from inline scripts or shadow DOM.
const WATERMARK_CSS_KILLSWITCH = `
/* ── Framer watermark & edit-UI removal ── */
#__framer-badge-container,
[id*="framer-badge"],
[class*="framer-badge"],
[class*="FramerBadge"],
[class*="__framer-badge"],
.framer-badge,
#framer-badge,
[data-framer-badge],
div[style*="framer.com/badge"],
img[src*="framer.com/badge"],
a[href="https://framer.com"],
#framer-edit-overlay,
#__framer-edit-container,
#framer-cms-edit,
[id*="framer-edit"],
[id*="framer-cms"],
[class*="framer-edit"],
[class*="FramerEdit"],
[class*="framer-cms"],
[class*="FramerCms"],
[class*="edit-content"],
[class*="EditContent"],
[data-framer-cms],
[data-framer-edit],
[data-framer-on-page-edit],
[class*="framer-toolbar"],
[id*="framer-toolbar"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  width: 0 !important;
  height: 0 !important;
  overflow: hidden !important;
}
`;

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

    // ── 1. Remove "Made in Framer" badge DOM elements ──────────────────────
    for (const sel of FRAMER_BADGE_SELECTORS) {
      $(sel).remove();
    }

    // ── 2. Remove "Edit Content" / on-page editor DOM elements ─────────────
    for (const sel of FRAMER_EDIT_SELECTORS) {
      $(sel).remove();
    }

    // ── 3. Text-content sweep: remove any element whose visible text is
    //       "Made in Framer" or "Edit Content" (covers obfuscated class names)
    $("a, div, span, button, p").each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      if (
        text === "made in framer" ||
        text === "edit content" ||
        text === "edit" ||
        text === "made with framer"
      ) {
        $(el).remove();
      }
    });

    // ── 4. Strip Framer CMS / badge / editing scripts ──────────────────────
    //       Without these scripts the Edit Content button can never be injected
    $("script").each((_, el) => {
      const src = $(el).attr("src") || "";
      const inline = $(el).html() || "";
      const shouldRemove = FRAMER_SCRIPT_PATTERNS.some(
        (p) => src.includes(p) || inline.includes(p)
      );
      if (shouldRemove) $(el).remove();
    });

    // ── 5. Inject CSS kill-switch into <head> ──────────────────────────────
    //       Belt-and-suspenders: hides anything dynamically rendered after load
    $("head").append(`<style id="__no-framer-watermark">${WATERMARK_CSS_KILLSWITCH}</style>`);

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

    const downloads = Array.from(resourceUrls).slice(0, 200);
    job.message = `Downloading ${downloads.length} assets...`;

    const archive = archiver("zip", { zlib: { level: 6 } });

    // Set up the zip promise BEFORE appending or finalizing so no event is missed
    const zipPromise = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);
    });

    archive.append(modifiedHtml, { name: "index.html" });

    await Promise.allSettled(
      downloads.map(async (url) => {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(10000),
            headers: { "User-Agent": "Mozilla/5.0 (compatible; FramerExporter/1.0)" },
          });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            let entryName = new URL(url).pathname.replace(/^\//, "");
            if (!entryName || entryName.endsWith("/")) entryName = (entryName || "") + "index.html";
            archive.append(buf, { name: entryName });
          }
        } catch {
          // skip failed assets silently
        }
      })
    );

    await archive.finalize();
    job.zipBuffer = await zipPromise;
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
