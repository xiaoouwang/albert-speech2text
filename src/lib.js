const LANGUAGES = [
  { value: "", label: "Auto-détection" },
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "it", label: "Italiano" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "ar", label: "العربية" },
  { value: "zh", label: "中文" },
  { value: "ja", label: "日本語" },
  { value: "nl", label: "Nederlands" },
  { value: "pl", label: "Polski" },
  { value: "ru", label: "Русский" },
];

const RESPONSE_FORMATS = [
  {
    value: "srt",
    label: "SRT",
    hint: "Sous-titres SRT avec horodatage — idéal pour corriger en écoutant",
  },
  {
    value: "diarized_json",
    label: "Multi-speaker",
    hint: "Horodatage + reconnaissance des locuteurs (Speaker 1, 2…) pour les réunions à plusieurs voix",
  },
  {
    value: "vtt",
    label: "VTT",
    hint: "Sous-titres WebVTT avec horodatage",
  },
  {
    value: "json",
    label: "JSON",
    hint: "Réponse JSON à l’export ; la revue demande des sous-titres SRT pour l’alignement",
  },
  {
    value: "text",
    label: "Texte",
    hint: "Texte brut uniquement à l’export",
  },
];

/** Formats that include timing — preferred for the review UI. */
const TIMED_API_FORMATS = new Set([
  "diarized_json",
  "srt",
  "vtt",
  "verbose_json",
]);

function apiFormatForRequest(preferredFormat) {
  if (TIMED_API_FORMATS.has(preferredFormat)) return preferredFormat;
  return "srt";
}

const DEFAULT_MODEL = "openai/whisper-large-v3";
const MAX_BYTES = 20 * 1024 * 1024;
const API_KEY_STORAGE = "albert_whisper_api_key";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimePrecise(seconds) {
  if (!Number.isFinite(seconds)) return "0:00.0";
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const whole = Math.floor(s);
  const tenth = Math.round((s - whole) * 10);
  if (tenth === 10) {
    return formatTimePrecise(total + 0.05);
  }
  return `${m}:${String(whole).padStart(2, "0")}.${tenth}`;
}

function parseTimeInput(value) {
  if (typeof value === "number") return value;
  const normalized = String(value || "").trim().replace(",", ".");
  if (!normalized) return 0;
  if (/^\d+(\.\d+)?$/.test(normalized)) return Math.max(0, Number(normalized));
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const [h, m, rest] = parts;
    return Math.max(0, Number(h) * 3600 + Number(m) * 60 + Number(rest));
  }
  if (parts.length === 2) {
    const [m, rest] = parts;
    return Math.max(0, Number(m) * 60 + Number(rest));
  }
  return 0;
}

function createSegment({
  id,
  start = 0,
  end = 0,
  text = "",
  speaker = null,
} = {}) {
  return {
    id: id ?? Date.now(),
    start: Math.max(0, Number(start) || 0),
    end: Math.max(0, Number(end) || 0),
    text: text ?? "",
    speaker: speaker || null,
  };
}

function sortSegmentsByTime(segments) {
  return [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
}

function renumberSegmentIds(segments) {
  return segments.map((seg, index) => ({ ...seg, id: index }));
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i += 1) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

async function blobToWavFile(blob, filename = "recording.wav") {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  const channel = audioBuffer.getChannelData(0);
  const wav = encodeWav(channel, audioBuffer.sampleRate);
  await audioCtx.close();
  return new File([wav], filename, { type: "audio/wav" });
}

function downloadText(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadFile(file) {
  if (!file) return;
  downloadBlob(file.name || "audio.mp3", file);
}

function resultToDownloadable(result) {
  if (!result) return { text: "", filename: "transcription.txt", mime: "text/plain" };
  const format = result.format || "json";

  if (format === "text" || typeof result === "string") {
    const text = typeof result === "string" ? result : result.text || "";
    return { text, filename: "transcription.txt", mime: "text/plain" };
  }
  if (format === "srt") {
    return {
      text: result.text || "",
      filename: "transcription.srt",
      mime: "application/x-subrip",
    };
  }
  if (format === "vtt") {
    return {
      text: result.text || "",
      filename: "transcription.vtt",
      mime: "text/vtt",
    };
  }
  return {
    text: JSON.stringify(result, null, 2),
    filename: "transcription.json",
    mime: "application/json",
  };
}

export {
  LANGUAGES,
  RESPONSE_FORMATS,
  TIMED_API_FORMATS,
  apiFormatForRequest,
  DEFAULT_MODEL,
  MAX_BYTES,
  API_KEY_STORAGE,
  formatBytes,
  formatTime,
  formatTimePrecise,
  parseTimeInput,
  createSegment,
  sortSegmentsByTime,
  renumberSegmentIds,
  blobToWavFile,
  downloadText,
  downloadBlob,
  downloadFile,
  resultToDownloadable,
};
