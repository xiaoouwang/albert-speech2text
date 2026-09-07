import { useEffect, useMemo, useRef, useState } from "react";
import TranscriptEditor from "./TranscriptEditor";
import {
  collectAudioFiles,
  createJob,
  sleep,
  statusLabel,
  statusMark,
} from "./batch";
import { ensureUnderLimit } from "./compressAudio";
import {
  API_KEY_STORAGE,
  DEFAULT_MODEL,
  LANGUAGES,
  RESPONSE_FORMATS,
  apiFormatForRequest,
  blobToWavFile,
  downloadFile,
  downloadText,
  downloadBlob,
  formatBytes,
  formatTime,
} from "./lib";
import {
  editedResultPayload,
  normalizeSegments,
} from "./transcript";
import { APP_CREDITS } from "./credits";
import { apiUrl } from "./apiBase";
import JSZip from "jszip";
import "./App.css";

function Waveform({ active }) {
  return (
    <div className={`wave ${active ? "wave--active" : ""}`} aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <span key={i} style={{ "--i": i }} />
      ))}
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(API_KEY_STORAGE) || "",
  );
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [models, setModels] = useState([]);
  const [language, setLanguage] = useState("fr");
  const [format, setFormat] = useState("srt");
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [compressProgress, setCompressProgress] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null);
  const [batchLog, setBatchLog] = useState([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const audioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const prepareTokenRef = useRef(0);
  const jobsRef = useRef(jobs);
  const activeJobIdRef = useRef(activeJobId);

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) || null,
    [jobs, activeJobId],
  );

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    activeJobIdRef.current = activeJobId;
  }, [activeJobId]);

  useEffect(() => {
    localStorage.setItem(API_KEY_STORAGE, apiKey);
  }, [apiKey]);

  useEffect(() => {
    return () => {
      jobsRef.current.forEach((job) => {
        if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
      });
      stopRecordingCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function authHeaders() {
    const headers = {};
    if (apiKey.trim()) headers["X-Albert-Api-Key"] = apiKey.trim();
    return headers;
  }

  function patchJob(jobId, patch) {
    setJobs((prev) =>
      prev.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
    );
  }

  function updateActiveSegments(segments) {
    if (!activeJobId) return;
    patchJob(activeJobId, { segments });
  }

  async function loadModels() {
    setError("");
    try {
      const res = await fetch(apiUrl("/api/models"), { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Impossible de charger les modèles");
      const list = data.models?.length ? data.models : data.all || [];
      setModels(list);
      if (list.length && !list.some((m) => m.id === model)) {
        setModel(list[0].id);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  function stopRecordingCleanup() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }

  function appendBatchLog(entry) {
    setBatchLog((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        at: new Date().toLocaleTimeString("fr-FR"),
        ...entry,
      },
    ]);
  }

  function clearJobs() {
    prepareTokenRef.current += 1;
    jobs.forEach((job) => {
      if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
    });
    setJobs([]);
    setActiveJobId(null);
    setCompressProgress(null);
    setBatchProgress(null);
    setBatchLog([]);
    setError("");
    setBusy(false);
  }

  async function prepareJob(job, { token, onProgress } = {}) {
    patchJob(job.id, {
      status: "compressing",
      error: null,
      lastMessage: "Compression en cours…",
    });
    try {
      const outcome = await ensureUnderLimit(job.sourceFile, {
        onProgress: (p) => {
          if (token != null && prepareTokenRef.current !== token) return;
          onProgress?.(p);
        },
      });
      if (token != null && prepareTokenRef.current !== token) return null;

      const latest = jobsRef.current.find((j) => j.id === job.id) || job;
      if (latest.previewUrl) URL.revokeObjectURL(latest.previewUrl);
      const previewUrl = URL.createObjectURL(outcome.file);
      const message = outcome.compressed
        ? `Compressé : ${outcome.originalBytes} → ${outcome.compressedBytes} octets`
        : "Prêt (pas de compression nécessaire)";
      const patch = {
        file: outcome.file,
        previewUrl,
        compressionInfo: outcome.compressed ? outcome : null,
        status: "ready",
        error: null,
        lastMessage: message,
      };
      patchJob(job.id, patch);
      return { ...latest, ...patch };
    } catch (err) {
      if (token != null && prepareTokenRef.current !== token) return null;
      const message = err.message || "Échec de la compression audio.";
      patchJob(job.id, {
        status: "error",
        error: message,
        lastMessage: message,
      });
      return null;
    }
  }

  async function ensureJobReady(job, { token, onProgress } = {}) {
    const latest = jobsRef.current.find((j) => j.id === job.id) || job;
    // Reuse an already prepared file even after a prior transcription error.
    if (latest.file) return latest;
    return prepareJob(latest, { token, onProgress });
  }

  async function ingestFiles(fileList, { replace = true } = {}) {
    const audioFiles = collectAudioFiles(fileList);
    if (!audioFiles.length) {
      setError("Aucun fichier MP3 ou WAV trouvé.");
      return;
    }

    const token = ++prepareTokenRef.current;
    setError("");
    setBusy(true);
    setCompressProgress(null);
    setBatchLog([]);

    if (replace) {
      jobs.forEach((job) => {
        if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
      });
    }

    const created = audioFiles.map((file, index) => createJob(file, index));
    const nextJobs = replace ? created : [...jobs, ...created];
    setJobs(nextJobs);
    setActiveJobId(created[0].id);
    appendBatchLog({
      level: "info",
      label: "Lot",
      message: `${created.length} fichier(s) importé(s) — préparation…`,
    });

    let ok = 0;
    let failed = 0;

    for (let i = 0; i < created.length; i += 1) {
      if (prepareTokenRef.current !== token) return;
      const job = created[i];
      setBatchProgress({
        index: i + 1,
        total: created.length,
        label: job.label,
        phase: "compress",
      });
      setActiveJobId(job.id);
      appendBatchLog({
        level: "info",
        label: job.label,
        message: `(${i + 1}/${created.length}) Compression / préparation…`,
      });

      const ready = await prepareJob(job, {
        token,
        onProgress: (p) => {
          if (prepareTokenRef.current === token) setCompressProgress(p);
        },
      });

      if (prepareTokenRef.current !== token) return;

      if (ready?.file) {
        ok += 1;
        appendBatchLog({
          level: "ok",
          label: job.label,
          message: ready.lastMessage || "Prêt",
        });
      } else {
        failed += 1;
        const latest = jobsRef.current.find((j) => j.id === job.id);
        appendBatchLog({
          level: "error",
          label: job.label,
          message: latest?.error || "Échec de la préparation",
        });
      }
    }

    if (prepareTokenRef.current === token) {
      setBusy(false);
      setCompressProgress(null);
      setBatchProgress(null);
      appendBatchLog({
        level: failed ? "warn" : "ok",
        label: "Lot",
        message: `Préparation terminée : ${ok} prêt(s), ${failed} échec(s)`,
      });
      if (failed) {
        setError(
          `Préparation incomplète : ${failed} fichier(s) en échec. Voir le journal ci-dessous.`,
        );
      }
    }
  }

  async function transcribeJob(job, { silent = false } = {}) {
    try {
      const ready = await ensureJobReady(job);
      if (!ready?.file) {
        const latest = jobsRef.current.find((j) => j.id === job.id);
        const message =
          latest?.error || "Fichier audio indisponible après préparation.";
        patchJob(job.id, {
          status: "error",
          error: message,
          lastMessage: message,
        });
        if (!silent) throw new Error(message);
        return { ok: false, error: message };
      }

      patchJob(ready.id, {
        status: "transcribing",
        error: null,
        result: null,
        segments: [],
        lastMessage: "Appel API Albert…",
      });

      const requestFormat = apiFormatForRequest(format);
      const form = new FormData();
      form.append("file", ready.file);
      form.append("model", model);
      form.append("response_format", requestFormat);
      form.append("temperature", String(temperature));
      if (language) form.append("language", language);
      if (prompt.trim()) form.append("prompt", prompt.trim());

      const res = await fetch(apiUrl("/api/transcribe"), {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });

      let data;
      try {
        data = await res.json();
      } catch {
        const message = `Réponse invalide du serveur (HTTP ${res.status})`;
        patchJob(ready.id, {
          status: "error",
          error: message,
          lastMessage: message,
        });
        if (!silent) throw new Error(message);
        return { ok: false, error: message };
      }

      if (!res.ok) {
        const detail =
          typeof data?.details === "string"
            ? data.details
            : data?.details
              ? JSON.stringify(data.details)
              : "";
        const message = [data.error || `HTTP ${res.status}`, detail]
          .filter(Boolean)
          .join(" — ");
        patchJob(ready.id, {
          status: "error",
          error: message,
          lastMessage: message,
        });
        if (!silent) throw new Error(message);
        return { ok: false, error: message };
      }

      const withFormat = { ...data, format: requestFormat };
      const segments = normalizeSegments(withFormat);
      patchJob(ready.id, {
        result: withFormat,
        segments,
        status: "done",
        error: null,
        lastMessage: `OK — ${segments.length} segment(s)`,
      });
      return { ok: true, result: withFormat, segments };
    } catch (err) {
      const message = err.message || "La transcription a échoué";
      patchJob(job.id, {
        status: "error",
        error: message,
        lastMessage: message,
      });
      if (!silent) throw err;
      return { ok: false, error: message };
    }
  }

  async function transcribeCurrent() {
    if (!activeJob) {
      setError("Ajoutez un fichier audio ou un dossier.");
      return;
    }
    setBusy(true);
    setError("");
    appendBatchLog({
      level: "info",
      label: activeJob.label,
      message: "Transcription démarrée…",
    });
    try {
      const outcome = await transcribeJob(activeJob);
      if (outcome?.ok) {
        appendBatchLog({
          level: "ok",
          label: activeJob.label,
          message: outcome.segments
            ? `Terminé — ${outcome.segments.length} segment(s)`
            : "Terminé",
        });
      } else {
        appendBatchLog({
          level: "error",
          label: activeJob.label,
          message: outcome?.error || "Échec",
        });
        setError(outcome?.error || "Échec de la transcription");
      }
    } catch (err) {
      appendBatchLog({
        level: "error",
        label: activeJob.label,
        message: err.message,
      });
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function transcribeAll() {
    if (!jobs.length) {
      setError("Ajoutez d’abord un dossier ou plusieurs fichiers.");
      return;
    }

    const token = ++prepareTokenRef.current;
    const snapshot = [...jobsRef.current];
    setBusy(true);
    setError("");
    appendBatchLog({
      level: "info",
      label: "Lot",
      message: `Transcription de ${snapshot.length} fichier(s)…`,
    });

    let ok = 0;
    let failed = 0;

    for (let i = 0; i < snapshot.length; i += 1) {
      if (prepareTokenRef.current !== token) return;
      const jobId = snapshot[i].id;
      const job = jobsRef.current.find((j) => j.id === jobId) || snapshot[i];

      setActiveJobId(job.id);
      setBatchProgress({
        index: i + 1,
        total: snapshot.length,
        label: job.label,
        phase: "transcribe",
      });
      appendBatchLog({
        level: "info",
        label: job.label,
        message: `(${i + 1}/${snapshot.length}) Transcription…`,
      });

      const outcome = await transcribeJob(job, { silent: true });
      if (prepareTokenRef.current !== token) return;

      if (outcome?.ok) {
        ok += 1;
        appendBatchLog({
          level: "ok",
          label: job.label,
          message: outcome.segments
            ? `OK — ${outcome.segments.length} segment(s)`
            : "OK",
        });
      } else {
        failed += 1;
        appendBatchLog({
          level: "error",
          label: job.label,
          message: outcome?.error || "Échec de la transcription",
        });
      }

      // Small pause to reduce Albert API rate-limit risk between files.
      if (i < snapshot.length - 1) {
        await sleep(400);
      }
    }

    if (prepareTokenRef.current === token) {
      setBusy(false);
      setBatchProgress(null);
      appendBatchLog({
        level: failed ? "warn" : "ok",
        label: "Lot",
        message: `Terminé : ${ok} réussi(s), ${failed} échec(s) sur ${snapshot.length}`,
      });
      if (failed) {
        setError(
          `Lot terminé avec ${failed} échec(s). Ouvrez le journal et le fichier marqué « ! ».`,
        );
      }
    }
  }

  function onDrop(event) {
    event.preventDefault();
    setDragOver(false);
    if (busy) return;
    const files = event.dataTransfer.files;
    if (files?.length) void ingestFiles(files, { replace: true });
  }

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mime });
          const wavFile = await blobToWavFile(
            blob,
            `enregistrement-${Date.now()}.wav`,
          );
          await ingestFiles([wavFile], { replace: jobs.length === 0 });
        } catch (err) {
          setError(err.message || "Échec de la conversion audio.");
        } finally {
          stopRecordingCleanup();
          setRecording(false);
          setRecordSeconds(0);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setError("Impossible d’accéder au microphone. Vérifiez les permissions du navigateur.");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  function selectJob(jobId) {
    setActiveJobId(jobId);
    setError("");
    const job = jobs.find((j) => j.id === jobId);
    if (job?.error) setError(job.error);
  }

  function goRelative(delta) {
    if (!jobs.length || !activeJobId) return;
    const index = jobs.findIndex((j) => j.id === activeJobId);
    if (index < 0) return;
    const next = jobs[(index + delta + jobs.length) % jobs.length];
    selectJob(next.id);
  }

  function currentExportPayload() {
    if (!activeJob?.result) return null;
    return editedResultPayload(activeJob.result, activeJob.segments, format);
  }

  async function copyResult() {
    const payload = currentExportPayload();
    if (!payload) return;
    await navigator.clipboard.writeText(payload.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function downloadResult() {
    const payload = currentExportPayload();
    if (!payload || !activeJob) return;
    const base = activeJob.originalName.replace(/\.[^.]+$/, "") || "transcription";
    const ext = payload.filename.split(".").pop();
    downloadText(`${base}.${ext}`, payload.body, payload.mime);
  }

  async function downloadAllResults() {
    const exportable = jobs.filter(
      (job) => job.result || (job.segments && job.segments.length),
    );
    if (!exportable.length) {
      setError("Aucune transcription à exporter. Transcrivez d’abord les fichiers.");
      return;
    }

    const zip = new JSZip();
    const usedNames = new Set();

    for (const job of exportable) {
      const payload = editedResultPayload(
        job.result || { format, text: "" },
        job.segments || [],
        format,
      );
      const base = (job.originalName || job.label || "transcription").replace(
        /\.[^.]+$/,
        "",
      );
      const ext = payload.filename.split(".").pop() || "txt";
      let filename = `${base}.${ext}`;
      let n = 2;
      while (usedNames.has(filename)) {
        filename = `${base}-${n}.${ext}`;
        n += 1;
      }
      usedNames.add(filename);
      zip.file(filename, payload.body);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(`transcriptions-${stamp}.zip`, blob);
    appendBatchLog({
      level: "ok",
      label: "Export",
      message: `${exportable.length} transcription(s) exportée(s) en ZIP`,
    });
  }

  function handleDownloadAudio(event) {
    event.stopPropagation();
    if (!activeJob?.file) return;
    downloadFile(activeJob.file);
  }

  const selectedFormatMeta = RESPONSE_FORMATS.find((f) => f.value === format);
  const activeIndex = jobs.findIndex((j) => j.id === activeJobId);
  const doneCount = jobs.filter((j) => j.status === "done").length;
  const exportableCount = jobs.filter(
    (j) => j.result || (j.segments && j.segments.length),
  ).length;
  const compressing =
    busy &&
    (activeJob?.status === "compressing" || batchProgress?.phase === "compress");
  const loading =
    busy &&
    (activeJob?.status === "transcribing" || batchProgress?.phase === "transcribe");

  return (
    <div className="page">
      <div className="atmosphere" aria-hidden="true" />

      <header className="top">
        <div className="brand">
          <p className="brand__mark">{APP_CREDITS.appName}</p>

          <div className="brand__credits">
            <div className="brand__credit-row">
              <p className="brand__credit-line">
                {APP_CREDITS.creditPrefix}{" "}
                <span aria-hidden="true">👨‍💻</span>{" "}
                <a
                  className="brand__credit-link"
                  href={APP_CREDITS.contributor.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {APP_CREDITS.contributor.name}
                </a>
                {" · "}
                {APP_CREDITS.role}
                {" · "}
                <a
                  className="brand__credit-link"
                  href={APP_CREDITS.institution.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {APP_CREDITS.institution.name}
                </a>
              </p>

              <div className="brand__logos" aria-label="Partenaires">
                {APP_CREDITS.logos.map((logo) => (
                  <a
                    key={logo.src}
                    className="brand__logo-card"
                    href={logo.href}
                    target="_blank"
                    rel="noreferrer"
                    title={logo.alt}
                  >
                    <img src={logo.src} alt={logo.alt} />
                  </a>
                ))}
              </div>
            </div>

            <p className="brand__credit-line brand__credit-line--muted">
              <code>{model || APP_CREDITS.defaultModel}</code>
              {" · "}
              <a href={APP_CREDITS.apiUrl} target="_blank" rel="noreferrer">
                {APP_CREDITS.apiName}
              </a>
              {" — "}
              <a href={APP_CREDITS.dinumUrl} target="_blank" rel="noreferrer">
                DINUM
              </a>
              {" / Etalab"}
            </p>
          </div>
        </div>

        <div className="key-box">
          <label htmlFor="api-key">Clé API</label>
          <p className="key-box__hint">
            Demandez votre clé via{" "}
            <a
              href="https://albert.playground.etalab.gouv.fr/"
              target="_blank"
              rel="noreferrer"
            >
              ce lien
            </a>
          </p>
          <div className="key-box__row">
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              placeholder=""
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={loadModels}>
              Modèles
            </button>
          </div>
        </div>
      </header>

      <main className="shell">
        <aside className="sidebar" aria-label="Audio et paramètres">
          <div className="player-dock">
            {activeJob?.previewUrl ? (
              <audio
                ref={audioRef}
                className="preview"
                controls
                src={activeJob.previewUrl}
                key={activeJob.id}
              />
            ) : (
              <p className="player-dock__empty">Lecteur audio — chargez un fichier ou un dossier</p>
            )}
          </div>

          {jobs.length > 0 ? (
            <div className="batch-bar">
              <label htmlFor="batch-select">
                Fichiers ({doneCount}/{jobs.length})
              </label>
              <div className="batch-bar__row">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => goRelative(-1)}
                  disabled={jobs.length < 2 || busy}
                  aria-label="Fichier précédent"
                >
                  ←
                </button>
                <select
                  id="batch-select"
                  value={activeJobId || ""}
                  onChange={(e) => selectJob(e.target.value)}
                  disabled={busy && Boolean(batchProgress)}
                >
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {statusMark(job.status)} {job.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => goRelative(1)}
                  disabled={jobs.length < 2 || busy}
                  aria-label="Fichier suivant"
                >
                  →
                </button>
              </div>
              {activeJob ? (
                <p className="batch-bar__meta">
                  {activeIndex + 1}/{jobs.length} · {statusLabel(activeJob.status)}
                  {activeJob.file ? ` · ${formatBytes(activeJob.file.size)}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          <div
            className={`dropzone ${dragOver ? "dropzone--over" : ""} ${activeJob ? "dropzone--ready" : ""} ${compressing ? "dropzone--busy" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            aria-busy={compressing}
            onClick={() => !busy && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (busy) return;
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              multiple
              hidden
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void ingestFiles(files, { replace: true });
                e.target.value = "";
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              multiple
              webkitdirectory=""
              directory=""
              hidden
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void ingestFiles(files, { replace: true });
                e.target.value = "";
              }}
            />
            <Waveform active={recording || loading || compressing} />
            {compressing || batchProgress ? (
              <div className="dropzone__hint">
                <strong>
                  {batchProgress?.phase === "transcribe"
                    ? "Lot en cours…"
                    : "Préparation…"}
                </strong>
                <span>
                  {batchProgress
                    ? `${batchProgress.index}/${batchProgress.total} · ${batchProgress.label}`
                    : compressProgress?.phase || "Compression"}
                  {compressProgress?.ratio != null
                    ? ` · ${Math.round(compressProgress.ratio * 100)} %`
                    : ""}
                </span>
              </div>
            ) : activeJob ? (
              <div className="dropzone__file">
                <strong title={activeJob.label}>{activeJob.label}</strong>
                <span>
                  {activeJob.file
                    ? formatBytes(activeJob.file.size)
                    : "En attente de compression"}
                </span>
              </div>
            ) : (
              <div className="dropzone__hint">
                <strong>Déposer fichiers / dossier</strong>
                <span>MP3 ou WAV · compression auto &gt; 20 Mo</span>
              </div>
            )}
          </div>

          {activeJob?.compressionInfo?.compressed ? (
            <p className="compress-note">
              {formatBytes(activeJob.compressionInfo.originalBytes)} →{" "}
              {formatBytes(activeJob.compressionInfo.compressedBytes)}
              {activeJob.compressionInfo.bitrate
                ? ` · ${activeJob.compressionInfo.bitrate} kbps`
                : ""}
            </p>
          ) : null}

          <div className="stage__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={busy}
            >
              Fichiers
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
              disabled={busy}
            >
              Dossier
            </button>
            {!recording ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={startRecording}
                disabled={busy}
              >
                Micro
              </button>
            ) : (
              <button type="button" className="btn btn--danger btn--sm" onClick={stopRecording}>
                Stop · {formatTime(recordSeconds)}
              </button>
            )}
            {activeJob?.file && !busy ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={handleDownloadAudio}
              >
                Audio
              </button>
            ) : null}
            {jobs.length ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={(e) => {
                  e.stopPropagation();
                  clearJobs();
                }}
                disabled={busy}
              >
                Vider
              </button>
            ) : null}
          </div>

          <div className="controls">
            <div className="field-row">
              <div className="field">
                <label htmlFor="model">Modèle</label>
                {models.length ? (
                  <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={DEFAULT_MODEL}
                  />
                )}
              </div>
              <div className="field">
                <label htmlFor="language">Langue</label>
                <select
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.value || "auto"} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              className="advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? "Moins d’options" : "Options avancées"}
            </button>

            {showAdvanced ? (
              <div className="advanced">
                <div className="field">
                  <label htmlFor="prompt">Prompt</label>
                  <textarea
                    id="prompt"
                    rows={2}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Noms propres, contexte…"
                  />
                </div>
                <div className="field">
                  <label htmlFor="temperature">
                    Température <em>{temperature}</em>
                  </label>
                  <input
                    id="temperature"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                  />
                </div>
              </div>
            ) : null}

            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !activeJob}
              onClick={transcribeCurrent}
            >
              {loading && !batchProgress
                ? "Transcription…"
                : jobs.length > 1
                  ? "Transcrire ce fichier"
                  : "Transcrire"}
            </button>

            {jobs.length > 1 ? (
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy}
                onClick={transcribeAll}
              >
                {batchProgress?.phase === "transcribe"
                  ? `Lot ${batchProgress.index}/${batchProgress.total}…`
                  : `Transcrire tout (${jobs.length})`}
              </button>
            ) : null}

            {error ? <div className="banner banner--error">{error}</div> : null}

            {activeJob?.error ? (
              <div className="banner banner--error">
                <strong>{activeJob.label}</strong>
                <div>{activeJob.error}</div>
              </div>
            ) : null}

            {batchLog.length ? (
              <div className="batch-log" aria-live="polite">
                <div className="batch-log__head">
                  <span>Journal du lot</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setBatchLog([])}
                    disabled={busy}
                  >
                    Effacer
                  </button>
                </div>
                <ol className="batch-log__list">
                  {batchLog.map((entry) => (
                    <li
                      key={entry.id}
                      className={`batch-log__item batch-log__item--${entry.level}`}
                    >
                      <time>{entry.at}</time>
                      <strong title={entry.label}>{entry.label}</strong>
                      <span>{entry.message}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="result" aria-live="polite">
          <div className="result__head">
            <div>
              <h2>Revue & correction</h2>
              {activeJob?.result ? (
                <div className="credit-card credit-card--run">
                  <p>
                    <span>Modèle</span>
                    <code>{activeJob.result.model || model || APP_CREDITS.defaultModel}</code>
                  </p>
                  <p>
                    <span>Format</span>
                    <strong>{activeJob.result.format || format}</strong>
                  </p>
                  {activeJob.result.usage?.total_tokens != null ? (
                    <p>
                      <span>Usage</span>
                      <strong>
                        {activeJob.result.usage.total_tokens} tokens
                        {activeJob.result.usage.cost != null
                          ? ` · coût ${activeJob.result.usage.cost}`
                          : ""}
                      </strong>
                    </p>
                  ) : null}
                  {jobs.length > 1 ? (
                    <p>
                      <span>Fichier</span>
                      <strong title={activeJob.label}>{activeJob.label}</strong>
                    </p>
                  ) : null}
                  <p>
                    <span>API</span>
                    <strong>
                      {APP_CREDITS.apiName} · {APP_CREDITS.apiOrg}
                    </strong>
                  </p>
                </div>
              ) : (
                <p className="result__meta">
                  {jobs.length > 1
                    ? "Parcourez le lot fichier par fichier pour corriger"
                    : "Audio et texte restent visibles côte à côte"}
                </p>
              )}
            </div>

            <div className="result__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={copyResult}
                disabled={!activeJob?.result}
              >
                {copied ? "Copié" : "Copier"}
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={downloadResult}
                disabled={!activeJob?.result}
              >
                Télécharger
              </button>
              {jobs.length > 1 ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => void downloadAllResults()}
                  disabled={exportableCount === 0}
                  title="Exporter toutes les transcriptions dans un ZIP"
                >
                  Tout exporter ({exportableCount})
                </button>
              ) : null}
            </div>
          </div>

          <div className="format-bar" aria-label="Format API et export">
            <span className="format-bar__label">Format de transcription / export</span>
            <div className="format-grid" role="radiogroup" aria-label="Format">
              {RESPONSE_FORMATS.map((fmt) => (
                <button
                  key={fmt.value}
                  type="button"
                  role="radio"
                  aria-checked={format === fmt.value}
                  className={`format-chip ${format === fmt.value ? "is-active" : ""} ${fmt.value === "diarized_json" ? "format-chip--diarized" : ""}`}
                  onClick={() => setFormat(fmt.value)}
                  title={fmt.hint}
                >
                  <strong>{fmt.label}</strong>
                </button>
              ))}
            </div>
            {selectedFormatMeta ? (
              <p className="format-bar__hint">{selectedFormatMeta.hint}</p>
            ) : null}
          </div>

          {activeJob?.result ? (
            <TranscriptEditor
              key={activeJob.id}
              segments={activeJob.segments}
              onChange={updateActiveSegments}
              audioRef={audioRef}
              hasAudio={Boolean(activeJob.previewUrl)}
            />
          ) : (
            <p className="result__empty">
              {jobs.length > 1
                ? "Choisissez un fichier dans la liste, transcrivez-le (ou lancez le lot), puis corrigez segment par segment."
                : "Importez un fichier ou un dossier, transcrivez, puis éditez texte, horodatages et locuteurs."}
            </p>
          )}
        </section>
      </main>

      <footer className="foot">
        <p className="foot__note">
          {APP_CREDITS.modelFamily} · proxy local{" "}
          <code>POST /v1/audio/transcriptions</code> · clé API locale ·{" "}
          {APP_CREDITS.year}
        </p>
      </footer>
    </div>
  );
}
