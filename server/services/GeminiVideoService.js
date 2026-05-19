import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 45_000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  const message = error?.message || String(error || "Gemini video request failed.");
  const detail = error?.cause?.message || error?.response?.data?.error?.message || "";
  return detail && !message.includes(detail) ? `${message}: ${detail}` : message;
}

function aspectRatioForSize(size = "1280x720") {
  if (size === "720x1280" || size === "1024x1536") return "9:16";
  return "16:9";
}

function resolutionForSize(size = "1280x720") {
  return size === "1920x1080" ? "1080p" : "720p";
}

function candidateVeoModels(model) {
  const preferred = model || "veo-3.1-generate-preview";
  return [
    preferred,
    "veo-3.1-generate-preview",
    "veo-3.1-generate-001",
    "veo-3.1-fast-generate-preview"
  ].filter((item, index, list) => item && list.indexOf(item) === index);
}

export class GeminiVideoService {
  constructor({ apiKey, model = "veo-3.1-generate-preview", logger = console } = {}) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
    this.apiKey = apiKey;
    this.model = model;
    this.logger = logger;
    this.client = new GoogleGenAI({ apiKey });
  }

  async withRetry(label, fn, { attempts = 2, delayMs = 1_500 } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        this.logger.warn?.(`[GeminiVideoService] ${label} attempt ${attempt} failed: ${errorMessage(error)}`);
        if (attempt < attempts) await wait(delayMs * attempt);
      }
    }
    throw new Error(`${label} failed after ${attempts} attempt(s): ${errorMessage(lastError)}`);
  }

  async submitVideoJob({ prompt, file, imageUri, model = this.model, size = "1280x720", seconds = 4 }) {
    const config = {
      numberOfVideos: 1,
      aspectRatio: aspectRatioForSize(size),
      resolution: resolutionForSize(size),
      durationSeconds: Math.min(8, Math.max(4, Number(seconds) || 4)),
      personGeneration: "allow_adult",
      httpOptions: { timeout: DEFAULT_TIMEOUT_MS }
    };

    const params = { model, prompt, config };
    if (file?.buffer) {
      params.image = {
        imageBytes: file.buffer.toString("base64"),
        mimeType: file.mimetype || "image/png"
      };
    } else if (imageUri) {
      if (String(imageUri).startsWith("gs://")) {
        params.image = { gcsUri: imageUri, mimeType: "image/png" };
      } else {
        throw new Error("Gemini Veo image-to-video needs an uploaded image file or a Google Cloud Storage gs:// URI.");
      }
    }

    let operation = null;
    let modelUsed = model;
    let lastError = null;
    for (const candidate of candidateVeoModels(model)) {
      try {
        operation = await this.withRetry(`Gemini Veo submit (${candidate})`, () => (
          this.client.models.generateVideos({ ...params, model: candidate })
        ));
        modelUsed = candidate;
        break;
      } catch (error) {
        lastError = error;
        const message = errorMessage(error).toLowerCase();
        const canTryNext = message.includes("not found") || message.includes("not supported") || message.includes("invalid model") || message.includes("404");
        if (!canTryNext) throw error;
      }
    }

    if (!operation && lastError) throw lastError;

    if (!operation?.name) {
      throw new Error("Gemini Veo accepted the request but did not return an operation id.");
    }

    return {
      operation,
      operationName: operation.name,
      model: modelUsed,
      status: operation.done ? "completed" : "queued",
      progress: operation.done ? 100 : 32
    };
  }

  async checkVideoStatus(operationName) {
    if (!operationName) throw new Error("Gemini operation id is required.");
    const operation = await this.withRetry("Gemini Veo status", () => (
      this.client.operations.getVideosOperation({ operation: { name: operationName } })
    ));

    if (operation?.error) {
      throw new Error(operation.error.message || JSON.stringify(operation.error));
    }

    const generatedVideo = operation?.response?.generatedVideos?.[0]?.video;
    return {
      operation,
      operationName,
      status: operation?.done ? "completed" : "queued",
      progress: operation?.done ? 100 : this.progressFromMetadata(operation?.metadata),
      video: generatedVideo || null
    };
  }

  progressFromMetadata(metadata = {}) {
    const raw = metadata?.progressPercent || metadata?.progress || metadata?.percentComplete;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(95, Math.max(35, parsed));
    return 55;
  }

  async downloadCompletedVideo(video) {
    if (!video) throw new Error("Gemini completed but did not include a generated video.");
    if (video.videoBytes) return Buffer.from(video.videoBytes, "base64");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atelier-gemini-video-"));
    const downloadPath = path.join(tmpDir, `gemini-video-${Date.now()}.mp4`);
    try {
      await this.client.files.download({ file: video, downloadPath });
      return await fs.readFile(downloadPath);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
