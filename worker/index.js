/**
 * Cloudflare Worker — Albert audio transcription proxy (GitHub Pages CORS).
 *
 * Optional secret ALBERT_API_KEY is used when the client does not send a key.
 * Health never advertises whether a server key is configured.
 * Vars: ALBERT_BASE_URL
 */

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Albert-Api-Key",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/api/health" && request.method === "GET") {
        return json({
          ok: true,
          hasServerKey: false,
          baseUrl: env.ALBERT_BASE_URL,
        });
      }

      if (path === "/api/models" && request.method === "GET") {
        return handleModels(request, env);
      }

      if (path === "/api/transcribe" && request.method === "POST") {
        return handleTranscribe(request, env);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: String(error?.message || error) }, 500);
    }
  },
};

function resolveApiKey(request, env) {
  const header = request.headers.get("X-Albert-Api-Key");
  if (header?.trim()) return header.trim();
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return env.ALBERT_API_KEY || "";
}

async function handleModels(request, env) {
  const apiKey = resolveApiKey(request, env);
  if (!apiKey) {
    return json(
      {
        error: "Missing API key. Provide it in the UI.",
      },
      401,
    );
  }

  const upstream = await fetch(`${env.ALBERT_BASE_URL}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return json(
      {
        error: payload?.error?.message || payload?.detail || "Failed to list models",
        details: payload?.error || payload,
      },
      upstream.status,
    );
  }

  const all = payload.data || [];
  const asr = all.filter((m) => {
    const type = m.type || m.owned_by || "";
    const id = String(m.id || "").toLowerCase();
    return (
      String(type).includes("automatic-speech-recognition") ||
      id.includes("whisper") ||
      id.includes("speech") ||
      id.includes("asr")
    );
  });

  return json({
    models: asr.length ? asr : all,
    all,
  });
}

async function handleTranscribe(request, env) {
  const apiKey = resolveApiKey(request, env);
  if (!apiKey) {
    return json(
      {
        error: "Missing API key. Provide it in the UI.",
      },
      401,
    );
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: "Expected multipart/form-data upload." }, 400);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid multipart body." }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return json({ error: "Audio file is required." }, 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return json({ error: "File too large. Maximum size is 20 MB." }, 400);
  }

  const model = String(form.get("model") || "openai/whisper-large-v3").trim();
  const language = String(form.get("language") || "").trim();
  const prompt = String(form.get("prompt") || "").trim();
  const response_format = String(form.get("response_format") || "json").trim();
  const temperatureRaw = form.get("temperature");
  const temperature =
    temperatureRaw === null || temperatureRaw === ""
      ? undefined
      : Number(temperatureRaw);

  const outbound = new FormData();
  outbound.append("file", file, file.name || "audio.wav");
  outbound.append("model", model);
  outbound.append("response_format", response_format);
  if (language) outbound.append("language", language);
  if (prompt) outbound.append("prompt", prompt);
  if (Number.isFinite(temperature)) {
    outbound.append("temperature", String(temperature));
  }

  const upstream = await fetch(`${env.ALBERT_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    body: outbound,
  });

  const rawText = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    if (!upstream.ok) {
      return json(
        { error: rawText || `Transcription failed (HTTP ${upstream.status})` },
        upstream.status,
      );
    }
    return json({ text: rawText, format: response_format });
  }

  if (!upstream.ok) {
    return json(
      {
        error:
          payload?.error?.message ||
          payload?.detail ||
          `Transcription failed (HTTP ${upstream.status})`,
        details: payload?.error || payload,
        status: upstream.status,
      },
      upstream.status,
    );
  }

  if (typeof payload === "string") {
    return json({ text: payload, format: response_format });
  }

  return json({ ...payload, format: response_format });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
