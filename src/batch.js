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
    compressionInfo: null,
    result: null,
    segments: [],
    status: "pending",
    error: null,
    lastMessage: null,
  };
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
  jobLabel,
  createJob,
  collectAudioFiles,
  statusLabel,
  statusMark,
  sleep,
};
