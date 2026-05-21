import { GoogleGenAI } from "@google/genai";

export const GEMINI_OMNI_MODEL = "gemini-omni-flash";

export function isGeminiOmniModel(model = "") {
  return String(model || "").toLowerCase().includes("omni");
}

export function buildOmniPayload({ prompt, files = [], imageUris = [], sourceVideoUri = "", voiceReferenceUri = "", size = "1280x720", seconds = 10 } = {}) {
  const media = [];
  const imageParts = files
    .filter((file) => String(file?.mimetype || "").startsWith("image/"))
    .slice(0, 5)
    .map((file) => ({
      inlineData: {
        data: file.buffer.toString("base64"),
        mimeType: file.mimetype || "image/png"
      }
    }));

  media.push(...imageParts);
  media.push(...imageUris.slice(0, 5).map((uri) => ({ fileData: { fileUri: uri, mimeType: "image/png" } })));
  if (sourceVideoUri) media.push({ fileData: { fileUri: sourceVideoUri, mimeType: "video/mp4" } });
  if (voiceReferenceUri) media.push({ fileData: { fileUri: voiceReferenceUri, mimeType: "audio/mpeg" } });

  return {
    prompt: String(prompt || "").trim(),
    contents: [{ text: String(prompt || "").trim() }, ...media],
    config: {
      aspectRatio: size === "720x1280" ? "9:16" : "16:9",
      durationSeconds: Math.min(10, Math.max(4, Number(seconds) || 10))
    },
    inputSummary: {
      imageCount: imageParts.length + imageUris.length,
      hasSourceVideo: Boolean(sourceVideoUri),
      hasVoiceReference: Boolean(voiceReferenceUri)
    }
  };
}

export class GeminiOmniProvider {
  constructor({ apiKey, model = GEMINI_OMNI_MODEL, enabled = false, logger = console } = {}) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
    this.enabled = enabled;
    this.logger = logger;
  }

  async submitOmniVideoJob(payload) {
    const omniPayload = buildOmniPayload(payload);
    if (!omniPayload.prompt) throw new Error("A prompt is required for Gemini Omni video work.");

    if (!this.enabled) {
      const error = new Error("Gemini Omni Flash developer video API is not enabled in this app yet. The Omni-ready payload was prepared, but no provider call was made.");
      error.code = "GEMINI_OMNI_PENDING";
      error.status = 503;
      error.payloadSummary = omniPayload.inputSummary;
      throw error;
    }

    // The public developer API is not available in this environment yet. This call shape is
    // isolated here so the future migration is a service-only change when Google enables it.
    const operation = await this.client.models.generateVideos({
      model: this.model,
      contents: omniPayload.contents,
      config: omniPayload.config
    });

    if (!operation?.name) throw new Error("Gemini Omni did not return an operation id.");
    return {
      operation,
      operationName: operation.name,
      model: this.model,
      status: operation.done ? "completed" : "queued",
      progress: operation.done ? 100 : 30,
      payloadSummary: omniPayload.inputSummary
    };
  }
}
