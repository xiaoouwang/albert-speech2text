import { formatTime } from "./lib";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function secondsToSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function secondsToVttTime(seconds) {
  return secondsToSrtTime(seconds).replace(",", ".");
}

function parseClock(value) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const [h, m, rest] = parts;
    return Number(h) * 3600 + Number(m) * 60 + Number(rest);
  }
  if (parts.length === 2) {
    const [m, rest] = parts;
    return Number(m) * 60 + Number(rest);
  }
  return Number(normalized) || 0;
}

function parseSrt(text) {
  const blocks = text.replace(/\r/g, "").trim().split(/\n\s*\n/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->")) || "";
    const match = timeLine.match(/(.+?)\s*-->\s*(.+)/);
    if (!match) continue;
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    segments.push({
      id: segments.length,
      start: parseClock(match[1]),
      end: parseClock(match[2]),
      text: textLines.join("\n").trim(),
      speaker: null,
    });
  }
  return segments;
}

function parseVtt(text) {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/^WEBVTT[^\n]*\n+/i, "")
    .trim();
  return parseSrt(cleaned);
}

function normalizeSegments(result) {
  if (!result) return [];

  const candidates = [
    result.segments,
    result.utterances,
    result.chunks,
    result?.transcription?.segments,
  ].find((list) => Array.isArray(list) && list.length);

  if (candidates) {
    return candidates.map((seg, index) => ({
      id: seg.id ?? index,
      start: Number(seg.start ?? seg.start_time ?? seg.timestamp?.[0]) || 0,
      end:
        Number(seg.end ?? seg.end_time ?? seg.timestamp?.[1]) ||
        Number(seg.start ?? seg.start_time ?? seg.timestamp?.[0]) ||
        0,
      text: String(seg.text ?? seg.transcript ?? "").trim(),
      speaker: seg.speaker ?? seg.speaker_id ?? null,
    }));
  }

  const format = result.format || "json";
  const raw = typeof result === "string" ? result : result.text || "";

  if (format === "srt" && raw) return parseSrt(raw);
  if (format === "vtt" && raw) return parseVtt(raw);

  if (raw) {
    return [
      {
        id: 0,
        start: 0,
        end: 0,
        text: String(raw).trim(),
        speaker: null,
      },
    ];
  }

  return [];
}

function segmentsHaveTiming(segments) {
  return segments.some((s) => s.end > s.start || s.start > 0);
}

function findActiveSegmentIndex(segments, time) {
  if (!segments.length) return -1;
  let fallback = -1;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (time >= seg.start && time < Math.max(seg.end, seg.start + 0.05)) {
      return i;
    }
    if (time >= seg.start) fallback = i;
  }
  return fallback;
}

function joinSegmentText(segments) {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function segmentsToSrt(segments) {
  return segments
    .map((seg, i) => {
      const end = seg.end > seg.start ? seg.end : seg.start + 1;
      return `${i + 1}\n${secondsToSrtTime(seg.start)} --> ${secondsToSrtTime(end)}\n${seg.text.trim()}\n`;
    })
    .join("\n");
}

function segmentsToVtt(segments) {
  const body = segments
    .map((seg) => {
      const end = seg.end > seg.start ? seg.end : seg.start + 1;
      return `${secondsToVttTime(seg.start)} --> ${secondsToVttTime(end)}\n${seg.text.trim()}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

function editedResultPayload(result, segments, exportFormat) {
  const format = exportFormat || result?.format || "json";
  const text = joinSegmentText(segments);

  if (format === "text") {
    return { text, filename: "transcription-corrigee.txt", mime: "text/plain", body: text };
  }
  if (format === "srt") {
    const body = segmentsToSrt(segments);
    return { text: body, filename: "transcription-corrigee.srt", mime: "application/x-subrip", body };
  }
  if (format === "vtt") {
    const body = segmentsToVtt(segments);
    return { text: body, filename: "transcription-corrigee.vtt", mime: "text/vtt", body };
  }

  const payload = {
    ...(result && typeof result === "object" ? result : {}),
    format,
    text,
    segments: segments.map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text,
      ...(s.speaker ? { speaker: s.speaker } : {}),
    })),
  };
  const body = JSON.stringify(payload, null, 2);
  return {
    text: body,
    filename: "transcription-corrigee.json",
    mime: "application/json",
    body,
  };
}

export {
  normalizeSegments,
  segmentsHaveTiming,
  findActiveSegmentIndex,
  joinSegmentText,
  editedResultPayload,
  formatTime,
};
