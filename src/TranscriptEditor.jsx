import { useEffect, useRef, useState } from "react";
import {
  findActiveSegmentIndex,
  segmentsHaveTiming,
} from "./transcript";
import {
  createSegment,
  formatTimePrecise,
  parseTimeInput,
  renumberSegmentIds,
} from "./lib";

const NUDGE_SMALL = 0.1;
const NUDGE_LARGE = 1;

function clampEnd(start, end) {
  if (!Number.isFinite(end) || end < start) return start;
  return end;
}

function TimeMark({
  label,
  seconds,
  onCommit,
  onUsePlayhead,
  onSeek,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatTimePrecise(seconds));
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(formatTimePrecise(seconds));
  }, [seconds, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commitDraft() {
    const next = Math.max(0, parseTimeInput(draft));
    setEditing(false);
    setDraft(formatTimePrecise(next));
    onCommit(next);
    onSeek?.(next);
  }

  function nudge(delta, event) {
    event?.preventDefault();
    event?.stopPropagation();
    const step = event?.shiftKey ? NUDGE_LARGE : NUDGE_SMALL;
    const next = Math.max(0, Number((seconds + delta * step).toFixed(3)));
    onCommit(next);
    onSeek?.(next);
  }

  return (
    <div className="time-mark" title={`${label} — clic pour éditer précisément · Shift+flèche = ±1 s`}>
      <span className="time-mark__label">{label}</span>
      <div className="time-mark__controls">
        <button
          type="button"
          className="time-mark__nudge"
          onClick={(e) => nudge(-1, e)}
          aria-label={`${label} −0,1 s`}
        >
          ‹
        </button>
        {editing ? (
          <input
            ref={inputRef}
            className="time-mark__input"
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDraft();
              if (e.key === "Escape") {
                setDraft(formatTimePrecise(seconds));
                setEditing(false);
              }
              if (e.key === "ArrowLeft" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                nudge(-1, e);
              }
              if (e.key === "ArrowRight" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                nudge(1, e);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="time-mark__value"
            onClick={() => {
              onSeek?.(seconds);
              setEditing(true);
            }}
          >
            {formatTimePrecise(seconds)}
          </button>
        )}
        <button
          type="button"
          className="time-mark__nudge"
          onClick={(e) => nudge(1, e)}
          aria-label={`${label} +0,1 s`}
        >
          ›
        </button>
        {onUsePlayhead ? (
          <button
            type="button"
            className="time-mark__head"
            onClick={() => {
              onUsePlayhead();
            }}
            title="Le timestamp actuel"
          >
            ⊙
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function TranscriptEditor({
  segments,
  onChange,
  audioRef,
  hasAudio,
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [expandedIndex, setExpandedIndex] = useState(null);
  const listRef = useRef(null);
  const timed = segmentsHaveTiming(segments) || segments.length > 0;

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !segments.length) return undefined;

    const sync = () => {
      const idx = findActiveSegmentIndex(segments, audio.currentTime || 0);
      setActiveIndex(idx);
    };

    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("seeked", sync);
    audio.addEventListener("play", sync);
    sync();

    return () => {
      audio.removeEventListener("timeupdate", sync);
      audio.removeEventListener("seeked", sync);
      audio.removeEventListener("play", sync);
    };
  }, [audioRef, segments]);

  useEffect(() => {
    if (activeIndex < 0 || expandedIndex != null) return;
    const node = listRef.current?.querySelector(`[data-seg="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, expandedIndex]);

  function playhead() {
    return audioRef?.current?.currentTime ?? 0;
  }

  function seekAudio(time, { play = false } = {}) {
    const audio = audioRef?.current;
    if (!audio || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, time);
    if (play) void audio.play().catch(() => {});
  }

  function seekTo(index, { play = true } = {}) {
    const seg = segments[index];
    if (!seg) return;
    seekAudio(seg.start, { play });
    setActiveIndex(index);
  }

  function commit(next) {
    onChange(renumberSegmentIds(next));
  }

  function updateSegment(index, patch, { seekToTime } = {}) {
    const next = segments.map((seg, i) => {
      if (i !== index) return seg;
      const merged = { ...seg, ...patch };
      merged.start = Math.max(0, Number(merged.start) || 0);
      merged.end = clampEnd(merged.start, Number(merged.end) || 0);
      return merged;
    });
    commit(next);
    if (seekToTime != null) seekAudio(seekToTime, { play: false });
  }

  function addSegment({ afterIndex = segments.length - 1, atPlayhead = false } = {}) {
    const t = atPlayhead ? playhead() : null;
    let start;
    let end;

    if (t != null && Number.isFinite(t)) {
      start = Math.max(0, t);
      end = start + 2;
    } else if (afterIndex >= 0 && segments[afterIndex]) {
      const prev = segments[afterIndex];
      const following = segments[afterIndex + 1];
      start = prev.end || prev.start || 0;
      if (following && following.start > start) {
        end = Math.min(following.start, start + 2);
      } else {
        end = start + 2;
      }
    } else {
      start = 0;
      end = 2;
    }

    const seg = createSegment({
      id: Date.now(),
      start,
      end,
      text: "",
      speaker: null,
    });

    const insertAt = Math.min(Math.max(afterIndex + 1, 0), segments.length);
    const next = [
      ...segments.slice(0, insertAt),
      seg,
      ...segments.slice(insertAt),
    ];
    commit(next);
    setExpandedIndex(insertAt);
    setActiveIndex(insertAt);
    seekAudio(start, { play: false });
  }

  function deleteSegment(index) {
    const next = segments.filter((_, i) => i !== index);
    commit(next);
    setExpandedIndex((current) => {
      if (current == null) return null;
      if (current === index) return null;
      if (current > index) return current - 1;
      return current;
    });
  }

  function moveSegment(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= segments.length) return;
    const next = [...segments];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    commit(next);
    setExpandedIndex(target);
    setActiveIndex(target);
  }

  function mergeWithNext(index) {
    if (index >= segments.length - 1) return;
    const a = segments[index];
    const b = segments[index + 1];
    const merged = createSegment({
      id: a.id,
      start: a.start,
      end: Math.max(a.end, b.end),
      text: [a.text, b.text].map((t) => t.trim()).filter(Boolean).join(" "),
      speaker: a.speaker || b.speaker,
    });
    const next = [
      ...segments.slice(0, index),
      merged,
      ...segments.slice(index + 2),
    ];
    commit(next);
    setExpandedIndex(index);
  }

  function splitAtPlayhead(index) {
    const seg = segments[index];
    if (!seg) return;
    const t = playhead();
    if (t <= seg.start + 0.05 || t >= (seg.end || seg.start + 0.05) - 0.05) {
      return;
    }
    const ratio =
      seg.end > seg.start ? (t - seg.start) / (seg.end - seg.start) : 0.5;
    const cut = Math.max(1, Math.floor(seg.text.length * ratio));
    const left = createSegment({
      ...seg,
      end: t,
      text: seg.text.slice(0, cut).trim(),
    });
    const right = createSegment({
      id: Date.now(),
      start: t,
      end: seg.end > t ? seg.end : t + 1,
      text: seg.text.slice(cut).trim(),
      speaker: seg.speaker,
    });
    const next = [
      ...segments.slice(0, index),
      left,
      right,
      ...segments.slice(index + 1),
    ];
    commit(next);
    setExpandedIndex(index + 1);
    seekAudio(t, { play: false });
  }

  if (!segments.length) {
    return (
      <div className="review">
        <p className="result__empty">
          Aucun segment. Importez un SRT, ajoutez-en un manuellement, ou lancez
          une transcription avec horodatage.
        </p>
        <div className="review__toolbar">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => addSegment({ afterIndex: -1, atPlayhead: hasAudio })}
          >
            + Nouveau segment
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="review">
      <div className="review__toolbar">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() =>
            addSegment({
              afterIndex: activeIndex >= 0 ? activeIndex : segments.length - 1,
              atPlayhead: true,
            })
          }
        >
          + À la tête de lecture
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => addSegment({ afterIndex: segments.length - 1 })}
        >
          + À la fin
        </button>
        <span className="review__toolbar-hint">
          {timed
            ? "Add = segment suivant · ‹ › = ±0,1 s (Shift = ±1 s) · clic temps = édition précise"
            : "Ajoutez des horodatages pour caler l’audio"}
        </span>
      </div>

      {!hasAudio ? (
        <p className="banner banner--error">
          Chargez un fichier audio pour caler les timestamps sur la lecture.
        </p>
      ) : null}

      <ol className="review__list" ref={listRef}>
        {segments.map((seg, index) => {
          const isActive = index === activeIndex;
          const isExpanded = expandedIndex === index;
          return (
            <li
              key={`${seg.id}-${index}`}
              data-seg={index}
              className={`review__item ${isActive ? "is-active" : ""} ${isExpanded ? "is-expanded" : ""}`}
            >
              <div className="review__meta">
                <div className="review__times">
                  <TimeMark
                    label="Début"
                    seconds={seg.start}
                    onSeek={(t) => seekAudio(t)}
                    onCommit={(start) =>
                      updateSegment(
                        index,
                        {
                          start,
                          end: Math.max(start, seg.end),
                        },
                        { seekToTime: start },
                      )
                    }
                    onUsePlayhead={() => {
                      const t = playhead();
                      updateSegment(
                        index,
                        { start: t, end: Math.max(t, seg.end) },
                        { seekToTime: t },
                      );
                    }}
                  />
                  <TimeMark
                    label="Fin"
                    seconds={seg.end}
                    onSeek={(t) => seekAudio(t)}
                    onCommit={(end) =>
                      updateSegment(
                        index,
                        { end: Math.max(end, seg.start) },
                        { seekToTime: Math.max(end, seg.start) },
                      )
                    }
                    onUsePlayhead={() => {
                      const t = Math.max(playhead(), seg.start);
                      updateSegment(index, { end: t }, { seekToTime: t });
                    }}
                  />
                </div>
                {seg.speaker ? <span className="speaker">{seg.speaker}</span> : null}
                <div className="review__meta-actions">
                  <button
                    type="button"
                    className="review__edit-btn"
                    onClick={() =>
                      addSegment({ afterIndex: index, atPlayhead: false })
                    }
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="review__edit-btn"
                    onClick={() => {
                      seekTo(index, { play: false });
                      setExpandedIndex(isExpanded ? null : index);
                    }}
                  >
                    {isExpanded ? "Réduire" : "Edit"}
                  </button>
                </div>
              </div>

              {isExpanded ? (
                <div className="review__editor">
                  <label className="review__speaker-field">
                    Locuteur
                    <input
                      type="text"
                      value={seg.speaker || ""}
                      placeholder="ex. Speaker 1"
                      onChange={(e) =>
                        updateSegment(index, {
                          speaker: e.target.value.trim() || null,
                        })
                      }
                    />
                  </label>

                  <textarea
                    className="review__edit"
                    value={seg.text}
                    rows={Math.min(8, Math.max(3, seg.text.split("\n").length + 1))}
                    autoFocus
                    placeholder="Texte du segment…"
                    onChange={(e) => updateSegment(index, { text: e.target.value })}
                  />

                  <div className="review__ops">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => splitAtPlayhead(index)}
                      disabled={!hasAudio}
                      title="Découper au temps actuel du lecteur"
                    >
                      Découper
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => mergeWithNext(index)}
                      disabled={index >= segments.length - 1}
                    >
                      Fusionner ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => moveSegment(index, -1)}
                      disabled={index === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => moveSegment(index, 1)}
                      disabled={index === segments.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => deleteSegment(index)}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="review__text"
                  onClick={() => seekTo(index)}
                  onDoubleClick={() => {
                    seekTo(index, { play: false });
                    setExpandedIndex(index);
                  }}
                >
                  {seg.text || (
                    <em className="review__placeholder">
                      Segment vide — Add pour en créer un autre, Edit pour écrire
                    </em>
                  )}
                </button>
              )}

              <button
                type="button"
                className="review__insert"
                onClick={() => addSegment({ afterIndex: index })}
                title="Insérer un segment après celui-ci"
              >
                + Add text after
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
