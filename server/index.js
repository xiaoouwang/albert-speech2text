import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const ALBERT_BASE_URL =
  process.env.ALBERT_BASE_URL || "https://albert.api.etalab.gouv.fr/v1";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter(_req, file, cb) {
    const name = (file.originalname || "").toLowerCase();
    const ok =
      name.endsWith(".mp3") ||
      name.endsWith(".wav") ||
      file.mimetype === "audio/mpeg" ||
      file.mimetype === "audio/mp3" ||
      file.mimetype === "audio/wav" ||
      file.mimetype === "audio/x-wav" ||
      file.mimetype === "audio/wave";
    cb(ok ? null : new Error("Only mp3 and wav files are supported (max 20 MB)."), ok);
  },
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function resolveApiKey(req) {
  const header = req.headers["x-albert-api-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return process.env.ALBERT_API_KEY || "";
}

function createClient(apiKey) {
  return new OpenAI({
    baseURL: ALBERT_BASE_URL,
    apiKey,
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasServerKey: Boolean(process.env.ALBERT_API_KEY),
    baseUrl: ALBERT_BASE_URL,
  });
});

app.get("/api/models", async (req, res) => {
  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(401).json({
      error:
        "Missing API key. Set ALBERT_API_KEY in .env or provide it in the UI.",
    });
  }

  try {
    const client = createClient(apiKey);
    const models = await client.models.list();
    const asr = (models.data || []).filter((m) => {
      const type = m.type || m.owned_by || "";
      const id = String(m.id || "").toLowerCase();
      return (
        String(type).includes("automatic-speech-recognition") ||
        id.includes("whisper") ||
        id.includes("speech") ||
        id.includes("asr")
      );
    });

    res.json({
      models: asr.length ? asr : models.data || [],
      all: models.data || [],
    });
  } catch (err) {
    const status = err?.status || 500;
    res.status(status).json({
      error: err?.message || "Failed to list models",
      details: err?.error || undefined,
    });
  }
});

app.post("/api/transcribe", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "File too large. Maximum size is 20 MB."
          : err.message || "Upload failed";
      return res.status(400).json({ error: message });
    }

    const apiKey = resolveApiKey(req);
    if (!apiKey) {
      return res.status(401).json({
        error:
          "Missing API key. Set ALBERT_API_KEY in .env or provide it in the UI.",
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required." });
    }

    const model = (req.body.model || "openai/whisper-large-v3").trim();
    const language = (req.body.language || "").trim() || undefined;
    const prompt = (req.body.prompt || "").trim() || undefined;
    const response_format = (req.body.response_format || "json").trim();
    const temperatureRaw = req.body.temperature;
    const temperature =
      temperatureRaw === undefined || temperatureRaw === ""
        ? undefined
        : Number(temperatureRaw);

    try {
      const client = createClient(apiKey);
      const file = await OpenAI.toFile(
        req.file.buffer,
        req.file.originalname || "audio.wav",
        { type: req.file.mimetype || "application/octet-stream" },
      );

      const params = {
        model,
        file,
        response_format,
      };
      if (language) params.language = language;
      if (prompt) params.prompt = prompt;
      if (Number.isFinite(temperature)) params.temperature = temperature;

      const result = await client.audio.transcriptions.create(params);

      if (typeof result === "string") {
        return res.json({ text: result, format: response_format });
      }

      res.json({ ...result, format: response_format });
    } catch (error) {
      const status = error?.status || 500;
      const apiMessage =
        error?.error?.message ||
        error?.message ||
        "Transcription failed";
      const detail =
        error?.error && typeof error.error === "object"
          ? error.error
          : undefined;
      res.status(status).json({
        error: apiMessage,
        details: detail,
        status,
      });
    }
  });
});

const isProd = process.env.NODE_ENV === "production";
if (isProd) {
  const dist = path.join(__dirname, "..", "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Albert Whisper server listening on http://localhost:${PORT}`);
});
