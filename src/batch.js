function isAudioFile(file) {
  if (!file?.name) return false;
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".mp3") ||
    name.endsWith(".wav") ||
    file.type === "audio/mpeg" ||
    file.type === "audio/mp3" ||
    file.type === "audio/wav" ||
    file.type === "audio/x-wav" ||
    file.type === "audio/wave"
  );
}

function isVideoFile(file) {
  if (!file?.name) return false;
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".mp4") ||
    name.endsWith(".webm") ||
    name.endsWith(".mov") ||
    name.endsWith(".mkv") ||
    name.endsWith(".m4v") ||
    (typeof file.type === "string" && file.type.startsWith("video/"))
  );
}

function isImportMediaFile(file) {
  if (!file?.name) return false;
  if (isAudioFile(file) || isVideoFile(file)) return true;
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".m4a") ||
    name.endsWith(".ogg") ||
    name.endsWith(".aac") ||
    name.endsWith(".flac") ||
    (typeof file.type === "string" && file.type.startsWith("audio/"))
  );
}

function jobLabel(file) {
  return file.webkitRelativePath || file.name;
}

function createJob(file, index = 0) {
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    label: jobLabel(file),
    originalName: file.name,
    sourceFile: file,
    file: null,
    previewUrl: "",
    mediaKind: "audio",
    compressionInfo: null,
    result: null,
    segments: [],
    status: "pending",
    error: null,
    lastMessage: null,
    sourceKind: "audio",
  };
}

function createSrtJob(file, segments, rawText, index = 0) {
  return {
    id: `${Date.now()}-srt-${index}-${Math.random().toString(36).slice(2, 8)}`,
    label: file.name,
    originalName: file.name,
    sourceFile: null,
    file: null,
    previewUrl: "",
    mediaKind: null,
    compressionInfo: null,
    result: { text: rawText, format: "srt" },
    segments,
    status: "done",
    error: null,
    lastMessage: `SRT importé — ${segments.length} segment(s)`,
    sourceKind: "srt",
  };
}

function createImportJob({
  title,
  srtFile,
  mediaFile,
  segments,
  rawText,
  index = 0,
}) {
  const mediaKind = mediaFile
    ? isVideoFile(mediaFile)
      ? "video"
      : "audio"
    : null;
  const previewUrl = mediaFile ? URL.createObjectURL(mediaFile) : "";
  const canTranscribeAudio =
    Boolean(mediaFile) && mediaKind === "audio" && isAudioFile(mediaFile);
  const label =
    (title && title.trim()) ||
    srtFile.name.replace(/\.srt$/i, "") ||
    "Projet importé";

  return {
    id: `${Date.now()}-import-${index}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    originalName: srtFile.name,
    sourceFile: canTranscribeAudio ? mediaFile : null,
    file: canTranscribeAudio ? mediaFile : null,
    previewUrl,
    mediaKind,
    compressionInfo: null,
    result: { text: rawText, format: "srt" },
    segments,
    status: "done",
    error: null,
    lastMessage: mediaFile
      ? `Import — ${segments.length} segment(s) + média`
      : `Import — ${segments.length} segment(s)`,
    sourceKind: "import",
  };
}

function isSrtFile(file) {
  if (!file?.name) return false;
  const name = file.name.toLowerCase();
  return name.endsWith(".srt") || file.type === "application/x-subrip";
}

function collectSrtFiles(fileList) {
  const files = Array.from(fileList || []).filter(isSrtFile);
  files.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return files;
}

function collectAudioFiles(fileList) {
  const files = Array.from(fileList || []).filter(isAudioFile);
  files.sort((a, b) => jobLabel(a).localeCompare(jobLabel(b), "fr"));
  return files;
}

function statusLabel(status) {
  switch (status) {
    case "pending":
      return "en attente";
    case "compressing":
      return "compression";
    case "ready":
      return "prêt";
    case "transcribing":
      return "transcription";
    case "done":
      return "fait";
    case "error":
      return "erreur";
    default:
      return status;
  }
}

function statusMark(status) {
  switch (status) {
    case "done":
      return "✓";
    case "error":
      return "!";
    case "transcribing":
    case "compressing":
      return "…";
    case "ready":
      return "○";
    default:
      return "·";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {
  isAudioFile,
  isVideoFile,
  isImportMediaFile,
  isSrtFile,
  jobLabel,
  createJob,
  createSrtJob,
  createImportJob,
  collectAudioFiles,
  collectSrtFiles,
  statusLabel,
  statusMark,
  sleep,
};
