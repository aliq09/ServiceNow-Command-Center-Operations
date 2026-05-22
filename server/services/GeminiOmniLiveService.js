import { GoogleGenAI } from "@google/genai";

export const GEMINI_LIVE_TEXT_MODEL = "gemini-live-2.5-flash-preview";
export const GEMINI_LIVE_AUDIO_MODEL = "gemini-live-2.5-flash-preview";
export const LIVE_RESPONSE_MODALITIES = new Set(["TEXT", "AUDIO"]);

export function normalizeLiveModality(modality = "TEXT") {
  const normalized = String(modality || "TEXT").toUpperCase();
  return LIVE_RESPONSE_MODALITIES.has(normalized) ? normalized : "TEXT";
}

export function buildLiveSessionConfig({
  model = GEMINI_LIVE_TEXT_MODEL,
  responseModality = "TEXT",
  systemInstruction = "You are a helpful fashion creative studio assistant.",
  mediaResolution = "MEDIA_RESOLUTION_MEDIUM"
} = {}) {
  return {
    model,
    config: {
      responseModalities: [normalizeLiveModality(responseModality)],
      systemInstruction,
      mediaResolution
    }
  };
}

export class GeminiOmniLiveService {
  constructor({ apiKey, enabled = false, logger = console } = {}) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
    this.client = new GoogleGenAI({ apiKey });
    this.enabled = enabled;
    this.logger = logger;
    this.activeSession = null;
    this.lastText = "";
    this.audioChunks = [];
  }

  assertEnabled() {
    if (!this.enabled) {
      const error = new Error("Gemini Live / Omni streaming is prepared, but it is not enabled for this app yet. Set GEMINI_LIVE_ENABLED=true after confirming quota and model access.");
      error.code = "GEMINI_LIVE_PENDING";
      error.status = 503;
      throw error;
    }
  }

  async startSession(config = {}, { onText, onAudio, onError, onClose, onOpen } = {}) {
    this.assertEnabled();
    const sessionConfig = buildLiveSessionConfig(config);

    this.activeSession = await this.client.live.connect({
      model: sessionConfig.model,
      config: sessionConfig.config,
      callbacks: {
        onopen: () => {
          this.logger.info?.(`[Gemini Live] Connected to ${sessionConfig.model}`);
          onOpen?.();
        },
        onmessage: (message) => {
          const parts = message?.serverContent?.modelTurn?.parts || [];
          for (const part of parts) {
            if (part?.text) {
              this.lastText += part.text;
              onText?.(part.text, message);
            }
            if (part?.inlineData?.mimeType?.startsWith("audio/")) {
              this.audioChunks.push(part.inlineData.data);
              onAudio?.(part.inlineData.data, message);
            }
          }
        },
        onerror: (error) => {
          this.logger.error?.("[Gemini Live] Session error", error);
          onError?.(error);
        },
        onclose: (event) => {
          this.logger.info?.("[Gemini Live] Session closed", event?.reason || "");
          this.activeSession = null;
          onClose?.(event);
        }
      }
    });

    return {
      model: sessionConfig.model,
      responseModality: sessionConfig.config.responseModalities[0],
      status: "connected"
    };
  }

  sendText(text, turnComplete = true) {
    if (!this.activeSession) throw new Error("No active Gemini Live session found.");
    this.activeSession.sendClientContent({
      turns: [{ role: "user", parts: [{ text: String(text || "") }] }],
      turnComplete
    });
  }

  sendRealtimeMedia({ mimeType, base64Data } = {}) {
    if (!this.activeSession) throw new Error("No active Gemini Live session found.");
    if (!mimeType || !base64Data) throw new Error("mimeType and base64Data are required for Gemini Live media input.");

    const blob = { mimeType, data: base64Data };
    if (String(mimeType).startsWith("audio/")) {
      this.activeSession.sendRealtimeInput({ audio: blob });
      return;
    }

    if (String(mimeType).startsWith("image/")) {
      this.activeSession.sendRealtimeInput({ media: blob });
      return;
    }

    throw new Error(`Unsupported Gemini Live media type: ${mimeType}`);
  }

  close() {
    if (this.activeSession) {
      this.activeSession.close();
      this.activeSession = null;
    }
  }
}
