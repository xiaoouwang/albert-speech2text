# Albert Whisper

Interface web pour [Albert API — Transcription audio](https://guides.ia.numerique.gouv.fr/albert-api/guides/audio-transcription).

## Fonctionnalités

- Glisser-déposer de fichiers **MP3** / **WAV**
- Compression automatique côté navigateur si le fichier dépasse **20 Mo** (mono 16 kHz MP3)
- Téléchargement de l’audio (compressé le cas échéant)
- Import d’un **dossier** ou de plusieurs fichiers, liste déroulante, correction fichier par fichier, transcription du lot
- Revue alignée audio ↔ texte avec édition complète des segments (temps, texte, locuteur, découpe / fusion)
- Enregistrement micro (converti en WAV côté navigateur)
- Choix du modèle ASR, de la langue et du format (`json`, `text`, `verbose_json`, `diarized_json`, `srt`, `vtt`)
- Prompt et température optionnels
- Copie / téléchargement du résultat
- Affichage des segments (horodatage / speakers) pour les formats détaillés
- Proxy local Express : la clé API reste sur votre machine
- Déploiement : GitHub Pages + Cloudflare Worker (`albert-speech2text`)

## En ligne

- Site : [https://xiaoouwang.github.io/albert-speech2text/](https://xiaoouwang.github.io/albert-speech2text/)
- API Worker : [https://albert-speech2text.singerxo.workers.dev](https://albert-speech2text.singerxo.workers.dev)

## Démarrage

```bash
cp .env.example .env
# Ajoutez votre clé : ALBERT_API_KEY=...
npm install
npm run dev
```

Ouvrez [http://localhost:5173](http://localhost:5173).

Vous pouvez aussi coller la clé API dans l’interface (stockée dans `localStorage`) si elle n’est pas dans `.env`.

## Production locale

```bash
npm run build
npm start
```

L’app est servie sur [http://localhost:3001](http://localhost:3001).

## Déploiement GitHub Pages + Worker

Le frontend est buildé avec `base: /albert-speech2text/` et `VITE_API_BASE` (voir `.env.production`).  
Le Worker Cloudflare proxy `/api/*` ; la clé est un secret Wrangler (`ALBERT_API_KEY`).

```bash
wrangler deploy
printf '%s' "$ALBERT_API_KEY" | wrangler secret put ALBERT_API_KEY
```

Push sur `main` déclenche le workflow Pages.

## API

| Route | Description |
| --- | --- |
| `GET /api/health` | Santé + présence d’une clé serveur |
| `GET /api/models` | Liste des modèles (filtrés ASR si possible) |
| `POST /api/transcribe` | Proxy vers `POST /v1/audio/transcriptions` |

Header optionnel : `X-Albert-Api-Key` (sinon `ALBERT_API_KEY` du serveur / Worker).
