// Import environment variables configuration
import "dotenv/config";
// Import Express framework for building the web server
import express from "express";
// Import file system promises for async file operations
import fs from "fs/promises";
// Import Multer for handling file uploads
import multer from "multer";
// Import path utilities for file paths
import path from "path";
// Import utilities for converting file URLs to paths
import { fileURLToPath } from "url";
// Import custom function to analyze MP4 videos
import { analyzeVideoMp4 } from "./lib/analyzeVideo.js";

// Function to check if Google services (Gemini or Vertex AI) are configured
function isGoogleConfigured() {
  // Check for Gemini API key
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  // Check for Vertex AI project and location
  const hasVertex =
    Boolean(process.env.GOOGLE_CLOUD_PROJECT) &&
    Boolean(process.env.GOOGLE_CLOUD_LOCATION);
  // Return true if either is configured
  return hasGeminiKey || hasVertex;
}

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Create an Express application instance
const app = express();
// Determine if running in production mode
const isProd = process.env.NODE_ENV === "production";
// Set the port, defaulting to 3000 in prod or 3001 in dev
const PORT = process.env.PORT || (isProd ? 3000 : 3001);

// Configure Multer for file uploads
const upload = multer({
  // Store files in memory
  storage: multer.memoryStorage(),
  // Set file size limit to 50 MB
  limits: { fileSize: 50 * 1024 * 1024 },
  // Filter to allow only MP4 video files
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "video/mp4" ||
      file.originalname.toLowerCase().endsWith(".mp4");
    if (ok) cb(null, true);
    else cb(new Error("Only MP4 video files are allowed."));
  },
});

// Middleware to parse JSON in request bodies
app.use(express.json());

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "PresentCoach",
    geminiConfigured: isGoogleConfigured(),
  });
});





// Endpoint to serve README documentation
app.get("/api/docs/readme", async (_req, res) => {
  try {
    // Path to the README file
    const readmePath = path.join(__dirname, "docs", "README.md");
    // Read the file content
    const md = await fs.readFile(readmePath, "utf8");
    // Send as Markdown
    res.type("text/markdown; charset=utf-8").send(md);
  } catch {
    // Send 404 if file not found
    res.status(404).type("text/plain").send("Documentation not found.");
  }
});

// Endpoint to analyze uploaded video
app.post(
  "/api/analyze",
  // Middleware to handle file upload with error handling
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
  // Main handler for analysis
  async (req, res) => {
    try {
      // Check if a video file was uploaded
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "Missing video file (field name: video)." });
      }

      // Check if Google services are configured
      if (!isGoogleConfigured()) {
        return res.status(503).json({
          code: "MISSING_GOOGLE_CREDENTIALS",
          error: "Google credentials are not configured on the server.",
        });
      }

      // Analyze the video and get text result
      const text = await analyzeVideoMp4(req.file.buffer);
      // Send the analysis result
      res.json({ text });
    } catch (e) {
      // Log the error
      console.error(e);
      // Extract error message
      const message = e instanceof Error ? e.message : "Analysis failed.";
      // Check if error is due to missing credentials
      const missingCreds =
        message.includes("Configure GEMINI_API_KEY") ||
        message.includes("GEMINI_API_KEY is not set") ||
        message.includes("Vertex AI requires");
      // Set status code based on error type
      const status = missingCreds ? 503 : 500;
      // Send error response
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

// In production, serve static files from dist directory
if (isProd) {
  const dist = path.join(__dirname, "dist");
  app.use(express.static(dist));
  // Catch-all route to serve the main HTML file for SPA
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

// Start the server
app.listen(PORT, () => {
  if (isProd) {
    console.log(`PresentCoach server http://localhost:${PORT}`);
  } else {
    console.log(`PresentCoach API http://localhost:${PORT} (use Vite on :5173 in dev)`);
  }
});
