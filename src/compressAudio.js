import { Mp3Encoder } from "@breezystack/lamejs";
import { MAX_BYTES, formatBytes } from "./lib";

const TARGET_SAMPLE_RATE = 16000;
const BITRATES_KBPS = [96, 64, 48, 32, 24, 16];
const BLOCK_SIZE = 1152;

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mixToMono(audioBuffer) {
  const { numberOfChannels, length } = audioBuffer;
  if (numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }

  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch += 1) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i];
    }
  }
  const inv = 1 / numberOfChannels;
  for (let i = 0; i < length; i += 1) {
    mono[i] *= inv;
  }
  return mono;
}

function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const newLength = Math.max(1, Math.round(samples.length / ratio));
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const t = srcIndex - i0;
    result[i] = samples[i0] * (1 - t) + samples[i1] * t;
  }
  return result;
}

function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

async function encodeMp3(int16Samples, sampleRate, kbps, onProgress) {
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const parts = [];
  const total = int16Samples.length;

  for (let i = 0; i < total; i += BLOCK_SIZE) {
    const slice = int16Samples.subarray(i, Math.min(i + BLOCK_SIZE, total));
    const buf = encoder.encodeBuffer(slice);
    if (buf.length) parts.push(buf);

    if (i > 0 && i % (BLOCK_SIZE * 40) === 0) {
      onProgress?.(Math.min(0.95, i / total));
      await yieldToUi();
    }
  }

  const end = encoder.flush();
  if (end.length) parts.push(end);
  onProgress?.(1);
  return new Blob(parts, { type: "audio/mpeg" });
}

function compressedFileName(originalName) {
  const base = originalName.replace(/\.[^.]+$/, "") || "audio";
  return `${base}-compressed.mp3`;
}

/**
 * Ensures an audio File is within Albert's 20 Mo limit by decoding in the
 * browser, downmixing to mono 16 kHz, and re-encoding as MP3.
 */
async function ensureUnderLimit(file, { maxBytes = MAX_BYTES, onProgress } = {}) {
  if (!file) {
    throw new Error("Aucun fichier audio.");
  }

  if (file.size <= maxBytes) {
    return {
      file,
      compressed: false,
      originalBytes: file.size,
      compressedBytes: file.size,
    };
  }

  onProgress?.({ phase: "decode", ratio: 0 });

  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    await audioCtx.close().catch(() => {});
    throw new Error(
      "Impossible de décoder ce fichier pour le compresser. Essayez un MP3 ou WAV standard.",
    );
  }
  await audioCtx.close().catch(() => {});

  onProgress?.({ phase: "resample", ratio: 0.05 });
  const mono = mixToMono(audioBuffer);
  const resampled = resampleLinear(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
  const int16 = floatToInt16(resampled);

  let lastBlob = null;
  let usedBitrate = null;

  for (let i = 0; i < BITRATES_KBPS.length; i += 1) {
    const kbps = BITRATES_KBPS[i];
    onProgress?.({
      phase: "encode",
      ratio: 0.1 + (i / BITRATES_KBPS.length) * 0.85,
      bitrate: kbps,
    });

    const blob = await encodeMp3(int16, TARGET_SAMPLE_RATE, kbps, (r) => {
      onProgress?.({
        phase: "encode",
        ratio: 0.1 + ((i + r) / BITRATES_KBPS.length) * 0.85,
        bitrate: kbps,
      });
    });

    lastBlob = blob;
    usedBitrate = kbps;

    if (blob.size <= maxBytes) {
      const next = new File([blob], compressedFileName(file.name), {
        type: "audio/mpeg",
      });
      onProgress?.({ phase: "done", ratio: 1, bitrate: kbps });
      return {
        file: next,
        compressed: true,
        originalBytes: file.size,
        compressedBytes: next.size,
        bitrate: kbps,
        sampleRate: TARGET_SAMPLE_RATE,
      };
    }
  }

  throw new Error(
    `Compression insuffisante : ${formatBytes(file.size)} → ${formatBytes(lastBlob?.size || 0)} à ${usedBitrate} kbps (limite ${formatBytes(maxBytes)}). Découpez l’audio en plusieurs parties.`,
  );
}

export { ensureUnderLimit, TARGET_SAMPLE_RATE };
