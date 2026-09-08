/** Edit this file to update the credits shown in the UI. */
const APP_CREDITS = {
  appName: "Albert Speech-to-text",
  tagline: "Transcription audio · SRT / VTT · Whisper via Albert API",
  creditPrefix: "Interface",
  contributor: {
    name: "Xiaoou Wang",
    href: "https://xiaoouwang.github.io/",
  },
  role: "Ingénieur en Humanités Numériques",
  institution: {
    name: "MSHS Sud-Est",
    href: "https://mshs.univ-cotedazur.fr/",
  },
  apiName: "Albert API",
  apiOrg: "DINUM / Etalab",
  apiUrl: "https://guides.ia.numerique.gouv.fr/albert-api/guides/audio-transcription",
  dinumUrl: "https://www.numerique.gouv.fr/numerique-etat/dinum/",
  defaultModel: "openai/whisper-large-v3",
  modelFamily: "OpenAI Whisper (automatic speech recognition)",
  year: new Date().getFullYear(),
  /** Displayed left → right, each in its own white card (as in the credit mockup). */
  logos: [
    {
      src: `${import.meta.env.BASE_URL}logos/logo_mshs.png?v=2`,
      alt: "Université Côte d'Azur, CNRS, Università di Corsica, MSHS Sud-Est",
      href: "https://mshs.univ-cotedazur.fr/",
    },
    {
      src: `${import.meta.env.BASE_URL}logos/logo_humanum.png?v=2`,
      alt: "Huma-Num IR*",
      href: "https://www.huma-num.fr/",
    },
  ],
};

export { APP_CREDITS };
