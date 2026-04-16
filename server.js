import "dotenv/config";
import express from "express";
import fs from "fs/promises";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeVideoMp4 } from "./lib/analyzeVideo.js";

function isGoogleConfigured() {
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  const hasVertex =
    Boolean(process.env.GOOGLE_CLOUD_PROJECT) &&
    Boolean(process.env.GOOGLE_CLOUD_LOCATION);
  return hasGeminiKey || hasVertex;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || (isProd ? 3000 : 3001);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "video/mp4" ||
      file.originalname.toLowerCase().endsWith(".mp4");
    if (ok) cb(null, true);
    else cb(new Error("Only MP4 video files are allowed."));
  },
});

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "PresentCoach",
    geminiConfigured: isGoogleConfigured(),
  });
});

app.get("/api/docs/readme", async (_req, res) => {
  try {
    const readmePath = path.join(__dirname, "docs", "README.md");
    const md = await fs.readFile(readmePath, "utf8");
    res.type("text/markdown; charset=utf-8").send(md);
  } catch {
    res.status(404).type("text/plain").send("Documentation not found.");
  }
});

app.post(
  "/api/analyze",
  (req, res, next) => {
    upload.single("video")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "Video file too large (max 50 MB)." });
        }
        return res.status(400).json({ error: err.message || "Upload failed." });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "Missing video file (field name: video)." });
      }

      if (!isGoogleConfigured()) {
        return res.status(503).json({
          code: "MISSING_GOOGLE_CREDENTIALS",
          error: "Google credentials are not configured on the server.",
        });
      }

      const text = await analyzeVideoMp4(req.file.buffer);
      res.json({ text });
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : "Analysis failed.";
      const missingCreds =
        message.includes("Configure GEMINI_API_KEY") ||
        message.includes("GEMINI_API_KEY is not set") ||
        message.includes("Vertex AI requires");
      const status = missingCreds ? 503 : 500;
      res.status(status).json(
        missingCreds
          ? {
              code: "MISSING_GOOGLE_CREDENTIALS",
              error: message,
            }
          : { error: message }
      );
    }
  }
);

if (isProd) {
  const dist = path.join(__dirname, "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.listen(PORT, () => {
  if (isProd) {
    console.log(`PresentCoach server http://localhost:${PORT}`);
  } else {
    console.log(`PresentCoach API http://localhost:${PORT} (use Vite on :5173 in dev)`);
  }
});
