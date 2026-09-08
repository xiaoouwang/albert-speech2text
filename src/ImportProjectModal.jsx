import { useEffect, useId, useRef, useState } from "react";
import { isImportMediaFile, isSrtFile, isVideoFile } from "./batch";

export default function ImportProjectModal({ open, onClose, onImport }) {
  const titleId = useId();
  const srtRef = useRef(null);
  const mediaRef = useRef(null);
  const [title, setTitle] = useState("");
  const [srtFile, setSrtFile] = useState(null);
  const [mediaFile, setMediaFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setSrtFile(null);
      setMediaFile(null);
      setError("");
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!srtFile) {
      setError("Ajoutez un fichier de sous-titres ou de transcript (.srt).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onImport({
        title: title.trim(),
        srtFile,
        mediaFile,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <h2 id={titleId}>Importer un projet existant</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        <p className="modal__lead">
          Déposez un sous-titre ou transcript seul, ou associez-le à un titre et
          à un fichier audio / vidéo pour éditer avec la console de lecture.
        </p>

        <form className="modal__form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="import-title">Titre du projet</label>
            <input
              id="import-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. Entretien du 12 mars"
              disabled={busy}
            />
          </div>

          <div className="field">
            <label htmlFor="import-srt">Sous-titre / transcript (SRT)</label>
            <div className="modal__file-row">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => srtRef.current?.click()}
                disabled={busy}
              >
                Choisir un SRT
              </button>
              <span className="modal__file-name">
                {srtFile ? srtFile.name : "Aucun fichier"}
              </span>
            </div>
            <input
              ref={srtRef}
              id="import-srt"
              type="file"
              accept=".srt,application/x-subrip,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                e.target.value = "";
                if (!file) return;
                if (!isSrtFile(file)) {
                  setError("Le transcript doit être un fichier .srt.");
                  return;
                }
                setError("");
                setSrtFile(file);
                if (!title.trim()) {
                  setTitle(file.name.replace(/\.srt$/i, ""));
                }
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="import-media">
              Audio ou vidéo <em>optionnel</em>
            </label>
            <div className="modal__file-row">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => mediaRef.current?.click()}
                disabled={busy}
              >
                Choisir un média
              </button>
              <span className="modal__file-name">
                {mediaFile
                  ? `${mediaFile.name}${isVideoFile(mediaFile) ? " · vidéo" : " · audio"}`
                  : "Aucun — édition texte seule"}
              </span>
            </div>
            <p className="field__hint">
              MP3, WAV, M4A, MP4, WebM… sert à caler la lecture sur les segments.
            </p>
            <input
              ref={mediaRef}
              id="import-media"
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.aac,.mp4,.webm,.mov"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                e.target.value = "";
                if (!file) return;
                if (!isImportMediaFile(file)) {
                  setError("Format média non reconnu (audio ou vidéo).");
                  return;
                }
                setError("");
                setMediaFile(file);
              }}
            />
            {mediaFile ? (
              <button
                type="button"
                className="modal__clear-media"
                onClick={() => setMediaFile(null)}
                disabled={busy}
              >
                Retirer le média
              </button>
            ) : null}
          </div>

          {error ? <p className="modal__error">{error}</p> : null}

          <div className="modal__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={busy}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !srtFile}
            >
              {busy ? "Import…" : "Ouvrir dans l’éditeur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
