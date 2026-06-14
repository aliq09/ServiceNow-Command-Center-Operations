import express from "express";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import multer from "multer";
import OpenAI from "openai";
import path from "node:path";
import "dotenv/config";
import { buildLiveSessionConfig, GeminiOmniLiveService, normalizeLiveModality } from "./services/GeminiOmniLiveService.js";
import { GeminiOmniProvider, isGeminiOmniModel } from "./services/GeminiOmniProvider.js";
import { GeminiVideoService } from "./services/GeminiVideoService.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const port = process.env.PORT || 8790;
const imageModel = "gpt-image-2";
const measurementModel = process.env.OPENAI_MEASUREMENT_MODEL || "gpt-5.2";
const xaiMeasurementModel = process.env.XAI_MEASUREMENT_MODEL || "grok-4.20-0309-reasoning";
const xaiImageModel = process.env.XAI_IMAGE_MODEL || "grok-imagine-image";
const xaiVideoModel = process.env.XAI_VIDEO_MODEL || "grok-imagine-video";
const xaiAgentModel = process.env.XAI_AGENT_MODEL || "grok-4.20-0309-non-reasoning";
const geminiMeasurementModel = process.env.GEMINI_MEASUREMENT_MODEL || "gemini-2.5-flash";
const geminiImageModel = process.env.GEMINI_IMAGE_MODEL || "imagen-3.0-generate-002";
const geminiEditModel = process.env.GEMINI_EDIT_MODEL || "gemini-2.5-flash-image";
const geminiVideoModel = process.env.GEMINI_VIDEO_MODEL || "veo-3.1-generate-preview";
const orchestrationModel = process.env.OPENAI_ORCHESTRATION_MODEL || "gpt-5.2";
const minimalStylingMaxAttempts = 2;
const minimalStylingCostEstimate = 0.02;
const swimwearFitMaxAttempts = 2;
const swimwearFitCostEstimate = 0.07;
const MONTHLY_BUDGET_USD = Number(process.env.MONTHLY_BUDGET_USD || 5);
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);
const MEASUREMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const measurementCache = new Map();
const XAI_PRICING = {
  "grok-4.20-0309-reasoning": { input: 0.00125, output: 0.0025 },
  "grok-4.20-0309-non-reasoning": { input: 0.00125, output: 0.0025 },
  "grok-4.20-multi-agent-0309": { input: 0.00125, output: 0.0025 },
  "grok-imagine-image-pro": { per_image: 0.07 },
  "grok-imagine-image": { per_image: 0.02 },
  "grok-imagine-video": { per_video: 0.25 },
  measurement: { fixed: 0.0035 },
  agent: { input: 0.00125, output: 0.0025 }
};
const GEMINI_PRICING = {
  [geminiMeasurementModel]: { input: Number(process.env.GEMINI_MEASUREMENT_INPUT_PER_M || 0.3), output: Number(process.env.GEMINI_MEASUREMENT_OUTPUT_PER_M || 2.5) },
  [geminiImageModel]: { per_image: Number(process.env.GEMINI_IMAGEN_COST || 0.04) },
  [geminiEditModel]: { per_image: Number(process.env.GEMINI_NANO_BANANA_EDIT_COST || 0.039) },
  [geminiVideoModel]: { per_second: Number(process.env.GEMINI_VEO_COST_PER_SECOND || 0.4) },
  image_generation: { per_image: Number(process.env.GEMINI_IMAGEN_COST || 0.04) },
  image_edit: { per_image: Number(process.env.GEMINI_NANO_BANANA_EDIT_COST || 0.039) },
  video_generation: { per_second: Number(process.env.GEMINI_VEO_COST_PER_SECOND || 0.4) },
  measurement: { fixed: Number(process.env.GEMINI_MEASUREMENT_COST || 0.0035) }
};
const measurementRates = {
  inputPerMillion: 1.75,
  cachedInputPerMillion: 0.175,
  outputPerMillion: 14
};
const outputRoot = path.join(process.cwd(), "outputs");
const assistantHistory = new Map();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/outputs", express.static(outputRoot));

const getOpenAI = () => {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const getXAI = () => {
  if (!process.env.XAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
};

const getGeminiKey = () => process.env.GEMINI_API_KEY || "";
const getOpenAIAdminKey = () => process.env.OPENAI_ADMIN_API_KEY || "";

function getGeminiVideoService(model = geminiVideoModel) {
  return new GeminiVideoService({
    apiKey: getGeminiKey(),
    model: model || geminiVideoModel,
    logger: console
  });
}

function getGeminiOmniProvider(model = "gemini-omni-flash") {
  return new GeminiOmniProvider({
    apiKey: getGeminiKey(),
    model,
    enabled: process.env.GEMINI_OMNI_ENABLED === "true",
    logger: console
  });
}

function getGeminiOmniLiveService() {
  return new GeminiOmniLiveService({
    apiKey: getGeminiKey(),
    enabled: process.env.GEMINI_LIVE_ENABLED === "true",
    logger: console
  });
}

const GROK_MEASUREMENT_SYSTEM_PROMPT = `
You are Grok Measurement Expert, a world-class fashion and anthropometric vision AI.
Analyze the uploaded image of a person for fashion fit estimation.

Extract the following measurements in CENTIMETERS. Return ONLY valid JSON.
Do not include markdown. Do not claim medical or tailoring-grade certainty.
If scale is unclear, infer plausible fashion-fit measurements and lower the relevant confidence scores.

Fields: bust_cm, underbust_cm, waist_cm, hips_cm, inseam_cm, height_cm, shoulders_cm, arm_length_cm, thigh_cm, calf_cm

Output schema:
{
  "measurements": {
    "bust_cm": number,
    "underbust_cm": number,
    "waist_cm": number,
    "hips_cm": number,
    "inseam_cm": number,
    "height_cm": number,
    "shoulders_cm": number,
    "arm_length_cm": number,
    "thigh_cm": number,
    "calf_cm": number
  },
  "confidence": {
    "bust_cm": number,
    "underbust_cm": number,
    "waist_cm": number,
    "hips_cm": number,
    "inseam_cm": number,
    "height_cm": number,
    "shoulders_cm": number,
    "arm_length_cm": number,
    "thigh_cm": number,
    "calf_cm": number
  },
  "notes": ["string1", "string2"]
}
`;

const GROK_USER_PROMPT = "Please measure this model as accurately as possible for fashion fit review. Prioritize visible body contours, posture, camera perspective, and garment fit. Return centimeters and per-field confidence from 0 to 100.";

app.get("/api/health", async (_req, res) => {
  try {
    res.json({
      ok: true,
      hasApiKey: Boolean(process.env.OPENAI_API_KEY),
      hasXaiKey: Boolean(process.env.XAI_API_KEY),
      imageModel,
      measurementModel,
      xaiMeasurementModel,
      xaiImageModel,
      xaiVideoModel,
      xaiAgentModel,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      geminiMeasurementModel,
      geminiImageModel,
      geminiEditModel,
      geminiVideoModel,
      monthlyBudgetUsd: MONTHLY_BUDGET_USD,
      budget: await getBudgetStatus("image", xaiImageModel),
      cwd: process.cwd()
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Health check failed." });
  }
});

app.get("/api/commerce/context", async (req, res) => {
  try {
    const category = String(req.query.category || "bra").toLowerCase();
    const size = String(req.query.size || "");
    const [rates, weather] = await Promise.all([
      fetchCurrencyRates(),
      fetchUkWeatherContext()
    ]);
    const priceBoard = buildRetailPriceBoard(category, size, rates);
    res.json({
      status: "live",
      baseCurrency: "GBP",
      generatedAt: new Date().toISOString(),
      size,
      category,
      rates,
      weather,
      trends: buildSeasonalTrendFeed(category, weather),
      priceBoard,
      note: "Retailer prices are guide ranges until product-feed APIs are connected. Currency rates and weather are refreshed live when available."
    });
  } catch (error) {
    res.json({
      status: "fallback",
      baseCurrency: "GBP",
      generatedAt: new Date().toISOString(),
      size: String(req.query.size || ""),
      category: String(req.query.category || "bra"),
      rates: fallbackCurrencyRates(),
      weather: fallbackWeatherContext(),
      trends: buildSeasonalTrendFeed(String(req.query.category || "bra"), fallbackWeatherContext()),
      priceBoard: buildRetailPriceBoard(String(req.query.category || "bra"), String(req.query.size || ""), fallbackCurrencyRates()),
      note: error.message || "Live commerce context unavailable. Showing fallback price guide."
    });
  }
});

app.get("/api/history/:id", (req, res) => {
  const item = assistantHistory.get(req.params.id);
  if (!item) {
    res.status(404).json({ error: "History item was not found." });
    return;
  }
  res.json(item);
});

app.post("/api/assistant/route", upload.single("reference"), async (req, res) => {
  const openai = getOpenAI();
  if (!openai) {
    res.status(202).json({
      status: "ready_for_api_key",
      message: "Set OPENAI_API_KEY to use OpenAI orchestration."
    });
    return;
  }

  const {
    message = "",
    currentMode = "measure",
    execute = "true",
    context = "{}",
    quality = "high",
    size = "auto",
    seconds = "8"
  } = req.body || {};

  if (!message.trim()) {
    res.status(400).json({ error: "A prompt or instruction is required." });
    return;
  }

  const parsedContext = safeJsonParse(context, {});
  const imageMetadata = req.file ? {
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size
  } : null;

  try {
    const plan = await createAssistantPlan(openai, {
      message,
      currentMode,
      context: parsedContext,
      imageMetadata,
      hasImage: Boolean(req.file)
    });

    const shouldExecute = String(execute) !== "false" && plan.execute !== false;
    const execution = shouldExecute
      ? await executeAssistantPlan(plan, { file: req.file, quality, size, seconds })
      : { status: "planned", message: "No execution was required for this route.", saved: [] };

    const id = cryptoRandomId("route");
    const record = {
      id,
      createdAt: new Date().toISOString(),
      status: execution.status || "completed",
      plan,
      execution
    };
    assistantHistory.set(id, record);
    res.json(record);
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Assistant orchestration failed." });
  }
});

const OPENAI_ORCHESTRATION_SYSTEM_PROMPT = `
You are the OpenAI orchestration brain for a fashion AI workspace. You do not directly execute every task.
Your job is to understand the user's natural-language intent, inspect available image metadata, refine prompts, and route the request to the best execution tool.

Available execution providers and tools:
- OpenAI image generation: best for general image creation, prompt-driven visuals, and OpenAI-native output.
- OpenAI measurement analysis: use when the user asks for measurements, fit analysis, UK sizing, or body/garment estimate.
- OpenAI video generation: use for Sora-style text-to-video work when OpenAI is selected or when a highly controlled video job is requested.
- Grok image analysis: use as an alternative vision analyzer when the user asks for Grok or comparison.
- Grok image generation/editing: use for Grok Imagine generation, image edits, restyling, and image-to-image workflows.
- Grok video generation: use for Grok Imagine image-to-video and fast creative video exploration.
- Gemini Imagen 3: use as a third image generation provider when the user selects Gemini or wants Google image generation.
- Gemini Nano Banana: use for Gemini image editing/restyling when the user selects Gemini for edits.
- Gemini Veo 3.1: use for Gemini image-to-video generation and long-running video jobs when Gemini is selected.
- Internal tools: prompt_refinement, suggest_next_step, export/history.

Return only valid JSON. Do not include markdown.
Schema:
{
  "intent": "image_generate|image_edit|image_enhance|image_consistency|image_to_video|style_transfer|measurement_analysis|prompt_refinement|suggest_next_step",
  "mode": "measure|image|edit|video|agent",
  "recommended_provider": "openai|xai|gemini|internal",
  "recommended_model": "model id",
  "recommended_action": "analyze_image|generate_image|edit_image|generate_video|refine_prompt|suggest_next_step",
  "tool_route": "openai.measurement|openai.image.generate|openai.video.generate|xai.measurement|xai.image.generate|xai.image.edit|xai.video.generate|gemini.measurement|gemini.image.generate|gemini.image.edit|gemini.video.generate|internal.prompt",
  "execute": true,
  "prompt_improvements": "improved prompt or empty string",
  "user_visible_explanation": "short reason in plain English",
  "next_actions": ["short action 1", "short action 2"],
  "confidence": "low|medium|high"
}

Routing rules:
- If the user asks to edit/restyle/enhance an existing uploaded image, choose xai.image.edit unless they explicitly ask for OpenAI.
- If the user asks for measurements or UK sizes, choose openai.measurement by default.
- If the user asks to create a new image from text, choose openai.image.generate by default unless they ask for Grok.
- If the user asks image-to-video or animate this image, choose xai.video.generate if an image is attached; otherwise choose openai.video.generate for text-to-video.
- If the UI/user selected Gemini, keep the route on Gemini: gemini.image.generate for images, gemini.image.edit for edits, gemini.video.generate for image-to-video, gemini.measurement for vision analysis.
- If the request is vague, choose internal.prompt and execute false.
- Preserve subject identity, face, body proportions, and garment details only as a prompt instruction; never claim exact biometric accuracy.
`;

app.post("/api/measure-image", upload.single("reference"), async (req, res) => {
  const openai = getOpenAI();
  const xai = getXAI();
  const { provider = "xai", model } = req.body || {};

  if (!req.file) {
    res.status(400).json({ error: "A reference image is required." });
    return;
  }

  if (provider === "gemini") {
    if (!getGeminiKey()) {
      res.status(202).json({
        status: "ready_for_gemini_key",
        message: "Set GEMINI_API_KEY to estimate measurements with Gemini.",
        request: { provider: "gemini", model: model || geminiMeasurementModel }
      });
      return;
    }
    try {
      res.json(await executeMeasurementTool("gemini", req.file, model));
    } catch (error) {
      res.status(statusForError(error)).json({ error: error.message || "Gemini measurement failed." });
    }
    return;
  }

  if (provider === "xai") {
    if (!xai) {
      res.status(202).json({
        status: "ready_for_xai_key",
        message: "Set XAI_API_KEY to estimate measurements with Grok image analysis.",
        request: { provider: "xai", model: model || xaiMeasurementModel }
      });
      return;
    }

    const resolvedModel = model || xaiMeasurementModel;
    const cacheKey = imageCacheKey("xai", resolvedModel, req.file);
    const cached = getCachedMeasurement(cacheKey);
    if (cached) {
      res.json({
        ...cached,
        cached: true,
        costUsd: 0,
        costPreviewUsd: 0,
        budget: await getBudgetStatus("measurement", resolvedModel),
        message: "Measurement returned from the 24-hour cache. No paid Grok call was made."
      });
      return;
    }

    const imageBase64 = req.file.buffer.toString("base64");

    try {
      const budgetGuard = await enforceMonthlyBudget("measurement", resolvedModel);
      const response = await xai.chat.completions.create({
        model: resolvedModel,
        messages: [
          { role: "system", content: GROK_MEASUREMENT_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: GROK_USER_PROMPT },
              { type: "image_url", image_url: { url: `data:${req.file.mimetype};base64,${imageBase64}` } }
            ]
          }
        ],
        temperature: 0,
        max_tokens: 800
      });

      const raw = parseJsonObject(response.choices?.[0]?.message?.content || "");
      const measurement = normalizeGrokMeasurementResult(raw);
      const usage = buildMeasurementUsageReport(response.usage, "xai", resolvedModel);
      await appendUsageEvent({
        type: "measurement",
        provider: "xai",
        model: resolvedModel,
        status: "completed",
        costUsd: usage.costUsd,
        estimatedCostUsd: usage.costUsd,
        providerResponse: "Grok measurement completed."
      });
      const result = {
        status: "completed",
        provider: "xai",
        model: resolvedModel,
        measurement,
        recommendations: getClothingSizeRecommendations(measurement),
        costUsd: usage.costUsd,
        costPreviewUsd: budgetGuard.estimatedCostUsd,
        budget: await getBudgetStatus("measurement", resolvedModel),
        usage
      };
      setCachedMeasurement(cacheKey, result);
      res.json(result);
    } catch (error) {
      res.status(statusForError(error)).json({ error: error.message || "Grok measurement estimation failed." });
    }
    return;
  }

  if (!openai) {
    res.status(202).json({
      status: "ready_for_api_key",
      message: "Set OPENAI_API_KEY to estimate measurements with OpenAI vision.",
      request: { provider: "openai", model: model || measurementModel }
    });
    return;
  }

  const imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

  try {
    const budgetGuard = await enforceMonthlyBudget("measurement", model || measurementModel);
    const response = await openai.responses.create({
      model: model || measurementModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Estimate fashion fitting measurements from this image for a measurement app. " +
                "This is not for medical use and must be labelled approximate. " +
                "Use visual proportions only; if exact scale is unavailable, infer a plausible fashion-model estimate. " +
                "Return only valid JSON with this shape: " +
                "{\"confidence\":\"low|medium|high\",\"notes\":\"short note\",\"heightCm\":number,\"shoulderCm\":number,\"bustCm\":number,\"underbustCm\":number,\"waistCm\":number,\"hipCm\":number,\"inseamCm\":number}."
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "high"
            }
          ]
        }
      ]
    });

    const measurement = parseMeasurementJson(extractOutputText(response));
    res.json({
      status: "completed",
      provider: "openai",
      model: model || measurementModel,
      measurement,
      costPreviewUsd: budgetGuard.estimatedCostUsd,
      budget: await getBudgetStatus("measurement", model || measurementModel),
      usage: buildMeasurementUsageReport(response.usage, "openai", model || measurementModel)
    });
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Measurement estimation failed." });
  }
});

function parseMeasurementJson(text) {
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("Measurement response was not valid JSON.");
  }
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}

function normalizeGrokMeasurementResult(result = {}) {
  const m = result.measurements || result;
  const confidence = result.confidence || {};
  const mapped = {
    heightCm: cleanMeasurementNumber(m.height_cm ?? m.heightCm, 172),
    shoulderCm: cleanMeasurementNumber(m.shoulders_cm ?? m.shoulderCm, 41),
    bustCm: cleanMeasurementNumber(m.bust_cm ?? m.bustCm, 88),
    underbustCm: cleanMeasurementNumber(m.underbust_cm ?? m.underbustCm, 76),
    waistCm: cleanMeasurementNumber(m.waist_cm ?? m.waistCm, 68),
    hipCm: cleanMeasurementNumber(m.hips_cm ?? m.hipCm, 96),
    inseamCm: cleanMeasurementNumber(m.inseam_cm ?? m.inseamCm, 80),
    armLengthCm: cleanMeasurementNumber(m.arm_length_cm ?? m.armLengthCm, 58),
    thighCm: cleanMeasurementNumber(m.thigh_cm ?? m.thighCm, 55),
    calfCm: cleanMeasurementNumber(m.calf_cm ?? m.calfCm, 36)
  };
  const confidenceByField = {
    heightCm: cleanConfidence(confidence.height_cm ?? confidence.heightCm),
    shoulderCm: cleanConfidence(confidence.shoulders_cm ?? confidence.shoulderCm),
    bustCm: cleanConfidence(confidence.bust_cm ?? confidence.bustCm),
    underbustCm: cleanConfidence(confidence.underbust_cm ?? confidence.underbustCm),
    waistCm: cleanConfidence(confidence.waist_cm ?? confidence.waistCm),
    hipCm: cleanConfidence(confidence.hips_cm ?? confidence.hipCm),
    inseamCm: cleanConfidence(confidence.inseam_cm ?? confidence.inseamCm),
    armLengthCm: cleanConfidence(confidence.arm_length_cm ?? confidence.armLengthCm),
    thighCm: cleanConfidence(confidence.thigh_cm ?? confidence.thighCm),
    calfCm: cleanConfidence(confidence.calf_cm ?? confidence.calfCm)
  };
  const averageConfidence = Math.round(Object.values(confidenceByField).reduce((sum, value) => sum + value, 0) / Object.values(confidenceByField).length);
  return {
    ...mapped,
    confidence: averageConfidence >= 75 ? "high" : averageConfidence >= 55 ? "medium" : "low",
    confidenceScore: averageConfidence,
    confidenceByField,
    notes: Array.isArray(result.notes) ? result.notes.join(" ") : result.notes || "Grok/xAI vision produced this approximate fashion fit estimate."
  };
}

function cleanMeasurementNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.round(number);
}

function cleanConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 55;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function getClothingSizeRecommendations(m) {
  const values = m.measurements || m;
  const waist_cm = values.waist_cm ?? values.waistCm;
  const hips_cm = values.hips_cm ?? values.hipCm;
  const bust_cm = values.bust_cm ?? values.bustCm;
  const height_cm = values.height_cm ?? values.heightCm;
  return {
    US: determineUSSize(waist_cm, hips_cm, bust_cm),
    UK: determineUKSize(waist_cm, hips_cm, bust_cm),
    EU: determineEUSize(waist_cm, hips_cm, bust_cm),
    heightCategory: height_cm >= 170 ? "Tall" : height_cm >= 160 ? "Regular" : "Petite",
    fitNotes: `Waist ${waist_cm}cm + hips ${hips_cm}cm suggests ${describeBodyBalance(waist_cm, hips_cm, bust_cm)} proportions.`
  };
}

function determineUKSize(waistCm, hipCm, bustCm) {
  return Math.max(sizeFromBustCm(bustCm), sizeFromWaistCm(waistCm), sizeFromHipCm(hipCm));
}

function determineUSSize(waistCm, hipCm, bustCm) {
  return Math.max(0, determineUKSize(waistCm, hipCm, bustCm) - 4);
}

function determineEUSize(waistCm, hipCm, bustCm) {
  return determineUKSize(waistCm, hipCm, bustCm) + 28;
}

function sizeFromBustCm(cm) {
  if (cm < 82) return 6;
  if (cm < 87) return 8;
  if (cm < 92) return 10;
  if (cm < 97) return 12;
  if (cm < 102) return 14;
  return 16;
}

function sizeFromWaistCm(cm) {
  if (cm < 64) return 6;
  if (cm < 69) return 8;
  if (cm < 74) return 10;
  if (cm < 79) return 12;
  if (cm < 84) return 14;
  return 16;
}

function sizeFromHipCm(cm) {
  if (cm < 88) return 6;
  if (cm < 93) return 8;
  if (cm < 98) return 10;
  if (cm < 103) return 12;
  if (cm < 108) return 14;
  return 16;
}

function describeBodyBalance(waistCm, hipCm, bustCm) {
  if (hipCm - waistCm >= 24 && Math.abs(hipCm - bustCm) <= 8) return "hourglass-balanced";
  if (hipCm > bustCm + 8) return "hip-forward";
  if (bustCm > hipCm + 8) return "bust-forward";
  return "balanced";
}

function parseAgentJson(text) {
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    return {
      reply: text || "I could not parse the agent response, but the request reached Grok.",
      action: "none",
      prompt: "",
      steps: [],
      confidence: "low"
    };
  }
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}

function extractOutputText(response = {}) {
  if (response.output_text) return response.output_text;
  if (Array.isArray(response.candidates)) {
    return response.candidates
      .flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => part.text || "")
      .filter(Boolean)
      .join("\n");
  }
  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function buildMeasurementUsageReport(usage = {}, provider = "openai", model = measurementModel) {
  if (provider === "xai") {
    const costUsd = calculateAccurateCost("xai", model, usage, model === xaiMeasurementModel ? "measurement" : "agent");
    return {
      provider,
      model,
      inputTokens: usage.input_tokens || usage.prompt_tokens || 0,
      cachedTokens: usage.input_tokens_details?.cached_tokens || 0,
      outputTokens: usage.output_tokens || usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || ((usage.input_tokens || usage.prompt_tokens || 0) + (usage.output_tokens || usage.completion_tokens || 0)),
      costUsd,
      rates: XAI_PRICING[model] || null,
      pricingSource: "local_xai_pricing_map"
    };
  }
  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  const cachedTokens = usage.input_tokens_details?.cached_tokens || 0;
  const billableInputTokens = Math.max(0, inputTokens - cachedTokens);
  const inputCost = (billableInputTokens / 1_000_000) * measurementRates.inputPerMillion;
  const cachedCost = (cachedTokens / 1_000_000) * measurementRates.cachedInputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * measurementRates.outputPerMillion;

  return {
    provider,
    model,
    inputTokens,
    cachedTokens,
    outputTokens,
    totalTokens: usage.total_tokens || inputTokens + outputTokens,
    costUsd: Number((inputCost + cachedCost + outputCost).toFixed(6)),
    rates: measurementRates
  };
}

function calculateGrokCost(model, usage = {}, units = {}) {
  if (units.images) return calculateAccurateCost("xai", model, usage, "image_generation") * units.images;
  if (units.videos) return calculateAccurateCost("xai", model, usage, "video_generation") * units.videos;
  return calculateAccurateCost("xai", model, usage);
}

function calculateAccurateCost(provider, model, usage = {}, type = "") {
  if (provider === "gemini" || provider === "google") return calculateGeminiCost(model, usage, type);
  if (provider !== "grok" && provider !== "xai") return Number(usage.cost || usage.costUsd || 0);

  const pricing = XAI_PRICING[model] || XAI_PRICING[type];
  if (!pricing) return 0.01;

  if (pricing.per_image) return Number(pricing.per_image.toFixed(6));
  if (pricing.per_video) return Number(pricing.per_video.toFixed(6));
  if (pricing.fixed) return Number(pricing.fixed.toFixed(6));

  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  const inputCost = (inputTokens / 1_000_000) * (pricing.input || 0);
  const outputCost = (outputTokens / 1_000_000) * (pricing.output || 0);
  return Number((inputCost + outputCost).toFixed(6));
}

function calculateGeminiCost(model, usage = {}, type = "") {
  const pricing = GEMINI_PRICING[model] || GEMINI_PRICING[type];
  if (!pricing) return 0.01;
  const outputCount = Number(usage.output_count || usage.outputCount || usage.images || 1);
  const seconds = Number(usage.seconds || usage.duration || 8);
  if (pricing.per_image) return Number((pricing.per_image * outputCount).toFixed(6));
  if (pricing.per_second) return Number((pricing.per_second * seconds).toFixed(6));
  if (pricing.fixed) return Number(pricing.fixed.toFixed(6));
  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  const inputCost = (inputTokens / 1_000_000) * (pricing.input || 0);
  const outputCost = (outputTokens / 1_000_000) * (pricing.output || 0);
  return Number((inputCost + outputCost).toFixed(6));
}

function estimateActionCost(type = "image", model = "") {
  const normalized = String(type || "").toLowerCase();
  if (String(model || "").startsWith("veo")) return calculateGeminiCost(model || geminiVideoModel, { seconds: 4 }, "video_generation");
  if (String(model || "").startsWith("imagen")) return calculateGeminiCost(model || geminiImageModel, { output_count: 1 }, "image_generation");
  if (String(model || "").includes("flash-image")) return calculateGeminiCost(model || geminiEditModel, { output_count: 1 }, "image_edit");
  if (normalized.includes("video")) return XAI_PRICING[xaiVideoModel]?.per_video || 0.25;
  if (normalized.includes("edit") || normalized.includes("image")) {
    const resolvedModel = model || xaiImageModel;
    return XAI_PRICING[resolvedModel]?.per_image || XAI_PRICING[xaiImageModel]?.per_image || 0.02;
  }
  if (normalized.includes("measurement") || normalized.includes("analyze")) return XAI_PRICING.measurement.fixed;
  if (normalized.includes("agent")) return 0.0035;
  return 0.02;
}

async function getBudgetSpendThisMonth() {
  const manifest = await buildRecentAssetIndex();
  const totals = buildBillingTotals(manifest);
  return Number(totals.totalSpend || 0);
}

async function getBudgetStatus(type = "image", model = "") {
  const spent = await getBudgetSpendThisMonth();
  const estimated = estimateActionCost(type, model);
  const remaining = Math.max(0, MONTHLY_BUDGET_USD - spent);
  return {
    month: CURRENT_MONTH,
    monthlyBudgetUsd: MONTHLY_BUDGET_USD,
    spentThisMonthUsd: Number(spent.toFixed(6)),
    remainingUsd: Number(remaining.toFixed(6)),
    percentUsed: MONTHLY_BUDGET_USD > 0 ? Math.min(100, Number(((spent / MONTHLY_BUDGET_USD) * 100).toFixed(2))) : 100,
    estimatedActionCostUsd: Number(estimated.toFixed(6)),
    canRunAction: spent + estimated <= MONTHLY_BUDGET_USD,
    videoDisabled: spent + estimateActionCost("video", xaiVideoModel) > MONTHLY_BUDGET_USD,
    warning: remaining <= 0.5
  };
}

async function enforceMonthlyBudget(type = "image", model = "") {
  const status = await getBudgetStatus(type, model);
  if (!status.canRunAction) {
    throw new Error(`Monthly budget of $${MONTHLY_BUDGET_USD.toFixed(2)} reached. Current spend: $${status.spentThisMonthUsd.toFixed(2)}. Action blocked.`);
  }
  return {
    estimatedCostUsd: status.estimatedActionCostUsd,
    budget: status
  };
}

function imageCacheKey(provider, model, file) {
  const hash = createHash("sha256").update(file.buffer).digest("hex");
  return `${provider}:${model}:${hash}`;
}

function getCachedMeasurement(key) {
  const cached = measurementCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > MEASUREMENT_CACHE_TTL_MS) {
    measurementCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedMeasurement(key, value) {
  measurementCache.set(key, { createdAt: Date.now(), value });
}

async function fetchOpenAIOfficialBilling({ days = 30 } = {}) {
  const apiKey = getOpenAIAdminKey();
  if (!apiKey) {
    return {
      status: "unavailable",
      source: "openai_costs_api",
      message: "OPENAI_ADMIN_API_KEY is not configured.",
      totalCostUsd: null,
      buckets: []
    };
  }

  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - Math.max(1, Number(days || 30)) * 24 * 60 * 60;
  const url = new URL("https://api.openai.com/v1/organization/costs");
  url.searchParams.set("start_time", String(startTime));
  url.searchParams.set("end_time", String(endTime));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "180");

  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    if (process.env.OPENAI_ORG_ID) headers["OpenAI-Organization"] = process.env.OPENAI_ORG_ID;
    if (process.env.OPENAI_PROJECT_ID) headers["OpenAI-Project"] = process.env.OPENAI_PROJECT_ID;

    const response = await fetch(url, { headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "error",
        source: "openai_costs_api",
        message: payload?.error?.message || `OpenAI Costs API returned ${response.status}.`,
        totalCostUsd: null,
        buckets: []
      };
    }

    const buckets = normalizeOpenAICostBuckets(payload);
    const totalCostUsd = Number(buckets.reduce((sum, bucket) => sum + Number(bucket.costUsd || 0), 0).toFixed(6));
    return {
      status: "completed",
      source: "openai_costs_api",
      generatedAt: new Date().toISOString(),
      period: { startTime, endTime, days },
      totalCostUsd,
      currency: "usd",
      buckets
    };
  } catch (error) {
    return {
      status: "error",
      source: "openai_costs_api",
      message: error.message || "OpenAI official billing request failed.",
      totalCostUsd: null,
      buckets: []
    };
  }
}

function normalizeOpenAICostBuckets(payload = {}) {
  const buckets = Array.isArray(payload.data) ? payload.data : [];
  return buckets.map((bucket) => {
    const results = Array.isArray(bucket.results) ? bucket.results : [];
    const costUsd = results.reduce((sum, item) => sum + extractOpenAICostAmount(item), 0);
    return {
      startTime: bucket.start_time,
      endTime: bucket.end_time,
      label: bucket.start_time ? new Date(bucket.start_time * 1000).toISOString().slice(5, 10) : "",
      costUsd: Number(costUsd.toFixed(6)),
      resultCount: results.length
    };
  });
}

function extractOpenAICostAmount(item = {}) {
  const amount = item.amount;
  if (typeof amount === "number") return amount;
  if (amount && typeof amount.value === "number") return amount.value;
  if (amount && typeof amount.amount === "number") return amount.amount;
  if (typeof item.cost === "number") return item.cost;
  return 0;
}

function attachCostToSaved(saved = [], costUsd = 0, metadata = {}) {
  if (!saved.length) return saved;
  const perAssetCost = Number((Number(costUsd || 0) / saved.length).toFixed(6));
  return saved.map((item) => ({ ...item, costUsd: perAssetCost, estimatedCostUsd: perAssetCost, ...metadata }));
}

async function appendUsageEvent(event) {
  await appendManifest([{ ...event, type: event.type || "usage", createdAt: new Date().toISOString() }]);
}

async function createAssistantPlan(openai, payload) {
  const response = await openai.responses.create({
    model: orchestrationModel,
    input: [
      { role: "system", content: OPENAI_ORCHESTRATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              user_message: payload.message,
              current_mode: payload.currentMode,
              has_uploaded_image: payload.hasImage,
              image_metadata: payload.imageMetadata,
              app_context: payload.context,
              available_models: {
                openai: {
                  measurement: measurementModel,
                  image: imageModel,
                  video: ["sora-2", "sora-2-pro"],
                  orchestration: orchestrationModel
                },
                xai: {
                  measurement: xaiMeasurementModel,
                  image: [xaiImageModel, "grok-imagine-image"],
                  video: xaiVideoModel
                },
                gemini: {
                  measurement: geminiMeasurementModel,
                  image: geminiImageModel,
                  edit: geminiEditModel,
                  video: geminiVideoModel
                }
              }
            })
          }
        ]
      }
    ]
  });

  return normalizeAssistantPlan(parseJsonObject(extractOutputText(response)));
}

function normalizeAssistantPlan(raw = {}) {
  const allowedIntents = new Set([
    "image_generate",
    "image_edit",
    "image_enhance",
    "image_consistency",
    "image_to_video",
    "style_transfer",
    "measurement_analysis",
    "prompt_refinement",
    "suggest_next_step"
  ]);
  const action = raw.recommended_action || "suggest_next_step";
  const route = raw.tool_route || routeForAction(action, raw.recommended_provider);
  return {
    intent: allowedIntents.has(raw.intent) ? raw.intent : "suggest_next_step",
    mode: ["measure", "image", "edit", "video", "agent"].includes(raw.mode) ? raw.mode : modeForRoute(route),
    recommended_provider: ["openai", "xai", "gemini", "internal"].includes(raw.recommended_provider) ? raw.recommended_provider : providerForRoute(route),
    recommended_model: raw.recommended_model || modelForRoute(route),
    recommended_action: action,
    tool_route: route,
    execute: raw.execute !== false,
    prompt_improvements: raw.prompt_improvements || "",
    user_visible_explanation: raw.user_visible_explanation || "OpenAI selected the next workflow step from your prompt and current asset context.",
    next_actions: Array.isArray(raw.next_actions) ? raw.next_actions.slice(0, 4) : ["Review result", "Refine prompt", "Continue workflow"],
    confidence: ["low", "medium", "high"].includes(raw.confidence) ? raw.confidence : "medium"
  };
}

async function executeAssistantPlan(plan, options) {
  const prompt = plan.prompt_improvements || "";
  if (plan.tool_route === "internal.prompt" || plan.recommended_action === "refine_prompt" || plan.recommended_action === "suggest_next_step") {
    return { status: "planned", provider: "internal", model: "router", message: "OpenAI returned a prompt/workflow plan.", saved: [] };
  }

  if (plan.tool_route === "openai.measurement" || plan.tool_route === "xai.measurement" || plan.tool_route === "gemini.measurement") {
    if (!options.file) throw new Error("A reference image is required for measurement analysis.");
    return executeMeasurementTool(providerForRoute(plan.tool_route), options.file, plan.recommended_model);
  }

  if (plan.tool_route === "openai.image.generate" || plan.tool_route === "xai.image.generate" || plan.tool_route === "gemini.image.generate") {
    if (!prompt) throw new Error("The assistant did not return a generation prompt.");
    return executeImageGenerationTool(providerForRoute(plan.tool_route), prompt, {
      model: plan.recommended_model,
      quality: options.quality,
      size: options.size
    });
  }

  if (plan.tool_route === "xai.image.edit" || plan.tool_route === "gemini.image.edit") {
    if (!options.file) throw new Error("A reference image is required for image editing.");
    if (!prompt) throw new Error("The assistant did not return an edit prompt.");
    return executeImageEditTool(providerForRoute(plan.tool_route), options.file, prompt, {
      model: plan.recommended_model || (plan.tool_route.startsWith("gemini") ? geminiEditModel : xaiImageModel),
      quality: options.quality,
      size: options.size
    });
  }

  if (plan.tool_route === "openai.video.generate" || plan.tool_route === "xai.video.generate" || plan.tool_route === "gemini.video.generate") {
    if (!prompt) throw new Error("The assistant did not return a video prompt.");
    return executeVideoTool(providerForRoute(plan.tool_route), prompt, {
      file: options.file,
      model: plan.recommended_model,
      size: options.size,
      seconds: options.seconds
    });
  }

  return { status: "planned", provider: "internal", model: "router", message: "No executable tool was selected.", saved: [] };
}

async function executeMeasurementTool(provider, file, model) {
  if (provider === "gemini") {
    validateImageUpload(file);
    if (!getGeminiKey()) throw new Error("Set GEMINI_API_KEY to use Gemini vision measurement.");
    const resolvedModel = model || geminiMeasurementModel;
    const cacheKey = imageCacheKey(provider, resolvedModel, file);
    const cached = getCachedMeasurement(cacheKey);
    if (cached) {
      return {
        ...cached,
        cached: true,
        costUsd: 0,
        costPreviewUsd: 0,
        budget: await getBudgetStatus("measurement", resolvedModel),
        message: "Gemini measurement returned from the 24-hour cache. No paid model call was made."
      };
    }
    const budgetGuard = await enforceMonthlyBudget("measurement", resolvedModel);
    const data = await geminiGenerateContent({
      model: resolvedModel,
      parts: [
        { text: "Estimate fashion fitting measurements. Return only JSON: {\"confidence\":\"low|medium|high\",\"notes\":\"short note\",\"heightCm\":number,\"shoulderCm\":number,\"bustCm\":number,\"underbustCm\":number,\"waistCm\":number,\"hipCm\":number,\"inseamCm\":number}." },
        { inline_data: { mime_type: file.mimetype, data: file.buffer.toString("base64") } }
      ]
    });
    const usage = {
      provider: "gemini",
      model: resolvedModel,
      costUsd: calculateAccurateCost("gemini", resolvedModel, data.usageMetadata || {}, "measurement"),
      pricingSource: "local_gemini_pricing_map"
    };
    const result = {
      status: "completed",
      provider: "gemini",
      model: resolvedModel,
      measurement: parseMeasurementJson(extractOutputText(data)),
      costPreviewUsd: budgetGuard.estimatedCostUsd,
      costUsd: usage.costUsd,
      budget: await getBudgetStatus("measurement", resolvedModel),
      usage,
      saved: []
    };
    setCachedMeasurement(cacheKey, result);
    await appendUsageEvent({ type: "measurement", provider: "gemini", model: resolvedModel, status: "completed", costUsd: usage.costUsd, estimatedCostUsd: usage.costUsd, providerResponse: "Gemini measurement completed." });
    return result;
  }

  const client = provider === "xai" ? getXAI() : getOpenAI();
  if (!client) throw new Error(provider === "xai" ? "Set XAI_API_KEY to use Grok measurement." : "Set OPENAI_API_KEY to use OpenAI measurement.");
  const resolvedModel = model || (provider === "xai" ? xaiMeasurementModel : measurementModel);
  const cacheKey = imageCacheKey(provider, resolvedModel, file);
  const cached = getCachedMeasurement(cacheKey);
  if (cached) {
    return {
      ...cached,
      cached: true,
      costUsd: 0,
      costPreviewUsd: 0,
      budget: await getBudgetStatus("measurement", resolvedModel),
      message: "Measurement returned from the 24-hour cache. No paid model call was made."
    };
  }
  const budgetGuard = await enforceMonthlyBudget("measurement", resolvedModel);
  if (provider === "xai") {
    const imageBase64 = file.buffer.toString("base64");
    const response = await client.chat.completions.create({
      model: resolvedModel,
      messages: [
        { role: "system", content: GROK_MEASUREMENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: GROK_USER_PROMPT },
            { type: "image_url", image_url: { url: `data:${file.mimetype};base64,${imageBase64}` } }
          ]
        }
      ],
      temperature: 0,
      max_tokens: 800
    });
    const measurement = normalizeGrokMeasurementResult(parseJsonObject(response.choices?.[0]?.message?.content || ""));
    const usage = buildMeasurementUsageReport(response.usage, provider, resolvedModel);
    await appendUsageEvent({
      type: "measurement",
      provider,
      model: resolvedModel,
      status: "completed",
      costUsd: usage.costUsd,
      estimatedCostUsd: usage.costUsd,
      providerResponse: "Grok measurement completed."
    });
    const result = {
      status: "completed",
      provider,
      model: resolvedModel,
      measurement,
      recommendations: getClothingSizeRecommendations(measurement),
      costUsd: usage.costUsd,
      costPreviewUsd: budgetGuard.estimatedCostUsd,
      budget: await getBudgetStatus("measurement", resolvedModel),
      usage,
      saved: []
    };
    setCachedMeasurement(cacheKey, result);
    return result;
  }
  const imageUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  const response = await client.responses.create({
    model: resolvedModel,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "Estimate fashion fitting measurements. Return only JSON: {\"confidence\":\"low|medium|high\",\"notes\":\"short note\",\"heightCm\":number,\"shoulderCm\":number,\"bustCm\":number,\"underbustCm\":number,\"waistCm\":number,\"hipCm\":number,\"inseamCm\":number}." },
        { type: "input_image", image_url: imageUrl, detail: "high" }
      ]
    }]
  });
  const result = {
    status: "completed",
    provider,
    model: resolvedModel,
    measurement: parseMeasurementJson(extractOutputText(response)),
    costPreviewUsd: budgetGuard.estimatedCostUsd,
    budget: await getBudgetStatus("measurement", resolvedModel),
    usage: buildMeasurementUsageReport(response.usage, provider, resolvedModel),
    saved: []
  };
  setCachedMeasurement(cacheKey, result);
  return result;
}

async function executeImageGenerationTool(provider, prompt, { model, quality = "auto", size = "auto" }) {
  const resolvedModel = model || (provider === "gemini" ? geminiImageModel : provider === "xai" ? xaiImageModel : imageModel);
  const budgetGuard = await enforceMonthlyBudget("image", resolvedModel);
  if (provider === "gemini") {
    if (!getGeminiKey()) throw new Error("Set GEMINI_API_KEY to generate images with Gemini Imagen.");
    const image = await geminiGenerateImage({ prompt, model: resolvedModel, size });
    const outputCount = extractMediaAssets(image).length || 1;
    const costUsd = calculateAccurateCost("gemini", resolvedModel, { output_count: outputCount }, "image_generation");
    const saved = attachCostToSaved(
      await saveMediaOutputs(image, "images", "gemini-generated", { provider: "gemini", model: resolvedModel, costUsd, estimatedCostUsd: costUsd, status: "completed", jobType: "image_generation" }),
      costUsd,
      { provider: "gemini", model: resolvedModel, status: "completed", jobType: "image_generation" }
    );
    return { status: "completed", provider: "gemini", model: resolvedModel, saved, image, costUsd, costPreviewUsd: budgetGuard.estimatedCostUsd, budget: await getBudgetStatus("image", resolvedModel), usage: { provider: "gemini", model: resolvedModel, costUsd, pricingSource: "local_gemini_pricing_map" } };
  }
  if (provider === "xai") {
    if (!process.env.XAI_API_KEY) throw new Error("Set XAI_API_KEY to generate images with Grok/xAI.");
    const response = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: resolvedModel, prompt, n: 1, aspect_ratio: mapSizeToAspectRatio(size), resolution: quality === "high" ? "2k" : "1k" })
    });
    const image = await response.json();
    if (!response.ok) throw new Error(image.error?.message || "xAI image generation failed.");
    const outputCount = Array.isArray(image.data) ? image.data.length || 1 : 1;
    const costUsd = Number((calculateAccurateCost("xai", resolvedModel, image.usage || {}, "image_generation") * outputCount).toFixed(6));
    const saved = attachCostToSaved(
      await saveMediaOutputs(image, "images", "xai-generated", { provider: "xai", model: resolvedModel, costUsd, estimatedCostUsd: costUsd, status: "completed", jobType: "image_generation" }),
      costUsd,
      { provider: "xai", model: resolvedModel, status: "completed", jobType: "image_generation" }
    );
    return { status: "completed", provider: "xai", model: resolvedModel, saved, image, costUsd, costPreviewUsd: budgetGuard.estimatedCostUsd, budget: await getBudgetStatus("image", resolvedModel), usage: { provider: "xai", model: resolvedModel, costUsd, pricingSource: "local_xai_pricing_map" } };
  }

  const openai = getOpenAI();
  if (!openai) throw new Error("Set OPENAI_API_KEY to generate images with OpenAI.");
  const image = await openai.images.generate({ model: resolvedModel, prompt, quality, size, n: 1 });
  return {
    status: "completed",
    provider: "openai",
    model: resolvedModel,
    saved: await saveMediaOutputs(image, "images", "openai-generated", { provider: "openai", model: resolvedModel, status: "completed", jobType: "image_generation" }),
    image,
    costPreviewUsd: budgetGuard.estimatedCostUsd,
    budget: await getBudgetStatus("image", resolvedModel)
  };
}

async function executeImageEditTool(provider, file, prompt, { model, quality = "high", size = "auto" }) {
  if (provider === "gemini") return executeGeminiImageEditTool(file, prompt, { model: model || geminiEditModel, quality, size });
  return executeXaiImageEditTool(file, prompt, { model: model || xaiImageModel, quality, size });
}

async function executeXaiImageEditTool(file, prompt, { model = xaiImageModel, quality = "high", size = "auto" }) {
  validateImageUpload(file);
  validatePrompt(prompt, "Edit prompt");
  if (!process.env.XAI_API_KEY) throw new Error("Set XAI_API_KEY to edit images with Grok Imagine.");
  const budgetGuard = await enforceMonthlyBudget("image_edit", model);
  const response = await fetch("https://api.x.ai/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      image: { url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}` },
      n: 1,
      aspect_ratio: mapSizeToAspectRatio(size),
      resolution: quality === "high" ? "2k" : "1k"
    })
  });
  const edit = await response.json();
  if (!response.ok) throw new Error(edit.error?.message || "xAI image edit failed.");
  const outputCount = Array.isArray(edit.data) ? edit.data.length || 1 : 1;
  const costUsd = Number((calculateAccurateCost("xai", model, edit.usage || {}, "image_edit") * outputCount).toFixed(6));
  const saved = attachCostToSaved(
    await saveMediaOutputs(edit, "images", "xai-edited", { provider: "xai", model, costUsd, estimatedCostUsd: costUsd, status: "completed", jobType: "image_edit" }),
    costUsd,
    { provider: "xai", model, status: "completed", jobType: "image_edit" }
  );
  return { status: "completed", provider: "xai", model, saved, edit, costUsd, costPreviewUsd: budgetGuard.estimatedCostUsd, budget: await getBudgetStatus("image_edit", model), usage: { provider: "xai", model, costUsd, pricingSource: "local_xai_pricing_map" } };
}

async function executeGeminiImageEditTool(file, prompt, { model = geminiEditModel, quality = "high", size = "auto" }) {
  validateImageUpload(file);
  validatePrompt(prompt, "Edit prompt");
  if (!getGeminiKey()) throw new Error("Set GEMINI_API_KEY to edit images with Gemini Nano Banana.");
  const budgetGuard = await enforceMonthlyBudget("image_edit", model);
  const edit = await geminiGenerateContent({
    model,
    parts: [
      { text: `${prompt}\n\nReturn one edited fashion image. Preserve the subject identity, pose, and realistic proportions unless the user explicitly asks otherwise.` },
      { inline_data: { mime_type: file.mimetype, data: file.buffer.toString("base64") } }
    ],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
  });
  const outputCount = extractMediaAssets(edit).length || 1;
  const costUsd = calculateAccurateCost("gemini", model, { output_count: outputCount }, "image_edit");
  const saved = attachCostToSaved(
    await saveMediaOutputs(edit, "images", "gemini-edited", { provider: "gemini", model, costUsd, estimatedCostUsd: costUsd, status: "completed", jobType: "image_edit" }),
    costUsd,
    { provider: "gemini", model, status: "completed", jobType: "image_edit" }
  );
  if (!saved.length) throw new Error("Gemini image edit completed but did not return an image file.");
  return { status: "completed", provider: "gemini", model, saved, edit, costUsd, costPreviewUsd: budgetGuard.estimatedCostUsd, budget: await getBudgetStatus("image_edit", model), usage: { provider: "gemini", model, costUsd, pricingSource: "local_gemini_pricing_map" } };
}

async function executeVideoTool(provider, prompt, { file, model, size = "1280x720", seconds = "8" }) {
  const resolvedModel = model || (provider === "gemini" ? geminiVideoModel : provider === "xai" ? xaiVideoModel : "sora-2");
  const budgetGuard = await enforceMonthlyBudget("video", resolvedModel);
  if (provider === "gemini") {
    if (!getGeminiKey()) throw new Error("Set GEMINI_API_KEY to start Gemini Veo video jobs.");
    if (isGeminiOmniModel(resolvedModel)) {
      const requestedSeconds = Math.min(10, Math.max(4, Number(seconds) || 10));
      const omni = getGeminiOmniProvider(resolvedModel);
      try {
        const submission = await omni.submitOmniVideoJob({ prompt, files: file ? [file] : [], model: resolvedModel, size, seconds: requestedSeconds });
        const job = buildVideoJob("gemini", submission.model || resolvedModel, { ...submission, seconds: requestedSeconds });
        await appendVideoJobEvent({
          provider: "gemini",
          model: submission.model || resolvedModel,
          status: "queued",
          job,
          costUsd: 0,
          seconds: requestedSeconds,
          message: "Gemini Omni Flash video job accepted. The app will poll and save the result when Google returns the MP4."
        });
        return {
          status: "queued",
          provider: "gemini",
          model: submission.model || resolvedModel,
          saved: [],
          video: { ...submission, seconds: requestedSeconds, omniReady: true },
          job,
          costUsd: 0,
          costPreviewUsd: 0,
          budget: await getBudgetStatus("video", resolvedModel),
          usage: { provider: "gemini", model: submission.model || resolvedModel, costUsd: 0, estimatedCostUsd: 0, units: { seconds: requestedSeconds }, pricingSource: "pending_gemini_omni_pricing" },
          message: "Gemini Omni Flash video job queued."
        };
      } catch (error) {
        await appendUsageEvent({
          type: "video_generation",
          provider: "gemini",
          model: resolvedModel,
          status: "blocked",
          costUsd: 0,
          estimatedCostUsd: 0,
          units: { seconds: requestedSeconds },
          providerResponse: error.message || "Gemini Omni Flash is not available yet."
        });
        throw error;
      }
    }
    const requestedSeconds = Math.min(8, Math.max(4, Number(seconds) || 4));
    const costUsd = calculateAccurateCost("gemini", resolvedModel, { seconds: requestedSeconds }, "video_generation");
    const service = getGeminiVideoService(resolvedModel);
    const submission = await service.submitVideoJob({ prompt, file, model: resolvedModel, size, seconds: requestedSeconds });
    const modelUsed = submission.model || resolvedModel;
    const job = buildVideoJob("gemini", modelUsed, { ...submission, seconds: requestedSeconds });
    const saved = submission.status === "completed"
      ? await saveGeminiCompletedVideo({ operationName: submission.operationName, operation: submission.operation, model: modelUsed, seconds: requestedSeconds, costUsd })
      : [];
    const status = saved.length ? "completed" : "queued";
    if (status !== "completed") {
      await appendVideoJobEvent({
        provider: "gemini",
        model: modelUsed,
        status,
        job,
        costUsd,
        seconds: requestedSeconds,
        message: `Gemini Veo operation ${submission.operationName} is rendering. The app will poll and save the MP4 when ready.`
      });
    }
    return {
      status,
      provider: "gemini",
      model: modelUsed,
      saved,
      video: { ...submission, seconds: requestedSeconds },
      job,
      costUsd: status === "completed" ? costUsd : 0,
      costPreviewUsd: budgetGuard.estimatedCostUsd,
      budget: await getBudgetStatus("video", modelUsed),
      usage: { provider: "gemini", model: modelUsed, costUsd: status === "completed" ? costUsd : 0, estimatedCostUsd: costUsd, units: { seconds: requestedSeconds }, pricingSource: "local_gemini_pricing_map" },
      message: status === "completed" ? "Gemini Veo video completed and saved locally." : "Gemini Veo video job queued. Rendering continues in the background."
    };
  }
  if (provider === "xai") {
    if (!process.env.XAI_API_KEY) throw new Error("Set XAI_API_KEY to start Grok/xAI video jobs.");
    const body = { model: resolvedModel, prompt, duration: Math.min(15, Math.max(1, Number(seconds) || 8)), aspect_ratio: mapSizeToAspectRatio(size), resolution: "720p" };
    if (file) body.reference_images = [{ url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}` }];
    const response = await fetch("https://api.x.ai/v1/videos/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const video = await response.json();
    if (!response.ok) throw new Error(video.error?.message || "xAI video generation failed.");
    const costUsd = calculateAccurateCost("xai", resolvedModel, video.usage || {}, "video_generation");
    const status = extractMediaAssets(video).length ? "completed" : "queued";
    const saved = attachCostToSaved(
      await saveMediaOutputs(video, "videos", "xai-video", { provider: "xai", model: resolvedModel, costUsd, estimatedCostUsd: costUsd, status, jobType: "video_generation" }),
      costUsd,
      { provider: "xai", model: resolvedModel, status, jobType: "video_generation" }
    );
    if (!saved.length) {
      await appendVideoJobEvent({
        provider: "xai",
        model: resolvedModel,
        status,
        job: buildVideoJob("xai", resolvedModel, video),
        costUsd,
        message: "Grok video request accepted; final media URL not returned yet."
      });
    }
    return { status, provider: "xai", model: resolvedModel, saved, video, job: buildVideoJob("xai", resolvedModel, video), costUsd, costPreviewUsd: budgetGuard.estimatedCostUsd, budget: await getBudgetStatus("video", resolvedModel), usage: { provider: "xai", model: resolvedModel, costUsd, pricingSource: "local_xai_pricing_map" } };
  }

  const openai = getOpenAI();
  if (!openai) throw new Error("Set OPENAI_API_KEY to start Sora video jobs.");
  const createParams = {
    model: resolvedModel,
    prompt,
    size: normalizeOpenAIVideoSize(size),
    seconds: normalizeOpenAIVideoSeconds(seconds)
  };
  if (file) {
    createParams.input_reference = { image_url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}` };
  }
  const video = await openai.videos.create(createParams);
  const costUsd = estimateActionCost("video", resolvedModel);
  const ready = video.status === "completed";
  const saved = ready ? await saveOpenAIVideoContent(video.id, resolvedModel, costUsd) : [];
  const status = saved.length ? "completed" : video.status || "queued";
  if (!saved.length) {
    await appendVideoJobEvent({
      provider: "openai",
      model: resolvedModel,
      status,
      job: buildVideoJob("openai", resolvedModel, video),
      costUsd,
      message: `OpenAI Sora job ${video.id || "accepted"} is ${status}.`
    });
  }
  return {
    status,
    provider: "openai",
    model: resolvedModel,
    saved,
    video,
    job: buildVideoJob("openai", resolvedModel, video),
    costUsd,
    costPreviewUsd: budgetGuard.estimatedCostUsd,
    budget: await getBudgetStatus("video", resolvedModel),
    usage: { provider: "openai", model: resolvedModel, costUsd, pricingSource: "local_video_estimate" }
  };
}

function normalizeOpenAIVideoSize(size = "1280x720") {
  if (size === "720x1280" || size === "1280x720") return size;
  if (size === "1920x1080" || size === "1536x1024") return "1792x1024";
  if (size === "1024x1536") return "1024x1792";
  return "1280x720";
}

function normalizeOpenAIVideoSeconds(seconds = "8") {
  const value = String(seconds);
  return ["4", "8", "12"].includes(value) ? value : "8";
}

function buildVideoJob(provider, model, payload = {}) {
  const providerJobId = payload.id || payload.video_id || payload.request_id || payload.requestId || payload.name || payload.operationName || payload.operation?.name || "";
  if (!providerJobId) return null;
  const seconds = Number(payload.seconds || payload.durationSeconds || payload.duration || 0);
  const secondsParam = seconds ? `&seconds=${encodeURIComponent(seconds)}` : "";
  return {
    provider,
    model,
    providerJobId,
    status: payload.status || (payload.done ? "completed" : "queued"),
    progress: payload.progress ?? null,
    seconds: seconds || null,
    pollUrl: `/api/video-job-status?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model || "")}&id=${encodeURIComponent(providerJobId)}${secondsParam}`
  };
}

async function appendVideoJobEvent({ provider, model, status, job, costUsd, message, seconds }) {
  await appendUsageEvent({
    type: "video_generation",
    provider,
    model,
    status,
    costUsd: status === "completed" ? costUsd : 0,
    estimatedCostUsd: costUsd,
    units: seconds ? { seconds } : undefined,
    providerJobId: job?.providerJobId || "",
    pollUrl: job?.pollUrl || "",
    providerResponse: message
  });
}

async function saveOpenAIVideoContent(videoId, model, costUsd = 0) {
  if (!videoId) return [];
  const openai = getOpenAI();
  if (!openai) throw new Error("Set OPENAI_API_KEY to download Sora video output.");
  const response = await openai.videos.downloadContent(videoId, { variant: "video" });
  const bytes = Buffer.from(await response.arrayBuffer());
  return attachCostToSaved(
    await saveRawMediaOutput(bytes, "videos", "openai-video", "mp4", { provider: "openai", model, costUsd, estimatedCostUsd: costUsd, status: "completed", jobType: "video_generation", providerJobId: videoId }),
    costUsd,
    { provider: "openai", model, status: "completed", jobType: "video_generation", providerJobId: videoId }
  );
}

async function saveGeminiCompletedVideo({ operationName, operation, model, seconds = 4, costUsd = 0 }) {
  const video = operation?.response?.generatedVideos?.[0]?.video;
  const service = getGeminiVideoService(model);
  const bytes = await service.downloadCompletedVideo(video);
  const saved = attachCostToSaved(
    await saveRawMediaOutput(bytes, "videos", "gemini-video", "mp4", {
      provider: "gemini",
      model,
      costUsd,
      estimatedCostUsd: costUsd,
      status: "completed",
      jobType: "video_generation",
      providerJobId: operationName,
      usage: { seconds }
    }),
    costUsd,
    { provider: "gemini", model, status: "completed", jobType: "video_generation", providerJobId: operationName, usage: { seconds } }
  );
  await appendUsageEvent({
    type: "video_generation",
    provider: "gemini",
    model,
    status: "completed",
    costUsd,
    estimatedCostUsd: costUsd,
    units: { seconds },
    providerJobId: operationName,
    providerResponse: "Gemini Veo completed. MP4 downloaded and saved locally."
  });
  return saved;
}

async function pollVideoProviderJob({ provider, model, id, seconds }) {
  if (!provider || !id) throw new Error("Provider and video job id are required.");
  const resolvedModel = model || (provider === "gemini" ? geminiVideoModel : provider === "xai" ? xaiVideoModel : "sora-2");
  const requestedSeconds = Math.min(8, Math.max(4, Number(seconds) || 4));
  const costUsd = provider === "gemini"
    ? calculateAccurateCost("gemini", resolvedModel, { seconds: requestedSeconds }, "video_generation")
    : estimateActionCost("video", resolvedModel);
  const existingSaved = await findSavedVideoForJob(id);
  if (existingSaved.length) {
    return {
      status: "completed",
      provider,
      model: resolvedModel,
      saved: existingSaved,
      video: { status: "completed", providerJobId: id },
      job: buildVideoJob(provider, resolvedModel, { id, status: "completed", progress: 100 }),
      costUsd
    };
  }

  if (provider === "openai") {
    const openai = getOpenAI();
    if (!openai) throw new Error("Set OPENAI_API_KEY to check Sora video jobs.");
    const video = await openai.videos.retrieve(id);
    if (video.status === "failed") throw new Error(video.error?.message || "OpenAI Sora video job failed.");
    const saved = video.status === "completed" ? await saveOpenAIVideoContent(id, resolvedModel, costUsd) : [];
    return { status: saved.length ? "completed" : video.status || "queued", provider, model: resolvedModel, saved, video, job: buildVideoJob(provider, resolvedModel, video), costUsd };
  }

  if (provider === "gemini") {
    if (!getGeminiKey()) throw new Error("Set GEMINI_API_KEY to check Gemini Veo jobs.");
    const service = getGeminiVideoService(resolvedModel);
    const result = await service.checkVideoStatus(id);
    const saved = result.status === "completed"
      ? await saveGeminiCompletedVideo({ operationName: id, operation: result.operation, model: resolvedModel, seconds: requestedSeconds, costUsd })
      : [];
    return {
      status: saved.length ? "completed" : result.status,
      provider,
      model: resolvedModel,
      saved,
      video: { ...result.operation, providerJobId: id, progress: result.progress, seconds: requestedSeconds },
      job: buildVideoJob(provider, resolvedModel, { ...result.operation, operationName: id, progress: result.progress, seconds: requestedSeconds }),
      costUsd: saved.length ? costUsd : 0,
      estimatedCostUsd: costUsd
    };
  }

  if (provider === "xai") {
    const video = await pollXaiVideoJob(id);
    const status = extractMediaAssets(video).length ? "completed" : video.status || "queued";
    const saved = status === "completed"
      ? attachCostToSaved(
          await saveMediaOutputs(video, "videos", "xai-video", { provider: "xai", model: resolvedModel, costUsd, estimatedCostUsd: costUsd, status, jobType: "video_generation", providerJobId: id }),
          costUsd,
          { provider: "xai", model: resolvedModel, status, jobType: "video_generation", providerJobId: id }
        )
      : [];
    return { status: saved.length ? "completed" : status, provider, model: resolvedModel, saved, video, job: buildVideoJob(provider, resolvedModel, { ...video, id }), costUsd };
  }

  throw new Error(`Unsupported video provider: ${provider}`);
}

async function findSavedVideoForJob(providerJobId) {
  const manifest = await readOutputManifest();
  return manifest
    .filter((item) => item.providerJobId === providerJobId && (item.type === "videos" || String(item.jobType || "").includes("video")))
    .map(repairManifestAsset);
}

function parseJsonObject(text) {
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) throw new Error("OpenAI orchestration response was not valid JSON.");
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function validatePrompt(prompt, label = "Prompt") {
  if (!String(prompt || "").trim()) throw new Error(`${label} is required.`);
  if (String(prompt).trim().length < 8) throw new Error(`${label} needs a little more detail before routing.`);
}

function validateImageUpload(file) {
  if (!file) throw new Error("A reference image is required.");
  if (!file.mimetype?.startsWith("image/")) throw new Error("The reference file must be an image.");
  if (file.size > 25 * 1024 * 1024) throw new Error("The reference image must be under 25 MB.");
}

async function geminiFetch(pathname, body, { method = "POST" } = {}) {
  const key = getGeminiKey();
  if (!key) throw new Error("Set GEMINI_API_KEY to use Google Gemini.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", "X-goog-api-key": key },
    body: method === "GET" ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Gemini API request failed with ${response.status}.`);
  return payload;
}

async function geminiGenerateContent({ model, parts, generationConfig = {} }) {
  return geminiFetch(`models/${model}:generateContent`, {
    contents: [{ role: "user", parts }],
    generationConfig
  });
}

async function geminiGenerateImage({ prompt, model = geminiImageModel, size = "auto" }) {
  return geminiFetch(`models/${model}:predict`, {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: mapSizeToAspectRatio(size) }
  });
}

async function geminiGenerateVideo({ prompt, file, model = geminiVideoModel, size = "1280x720", seconds = "8" }) {
  const instance = { prompt };
  if (file) {
    instance.image = {
      bytesBase64Encoded: file.buffer.toString("base64"),
      mimeType: file.mimetype
    };
  }
  const operation = await geminiFetch(`models/${model}:predictLongRunning`, {
    instances: [instance],
    parameters: {
      aspectRatio: mapSizeToAspectRatio(size),
      durationSeconds: Math.min(8, Math.max(4, Number(seconds) || 8)),
      sampleCount: 1
    }
  });
  const operationName = operation.name;
  const finalOperation = operationName ? await pollGeminiOperation(operationName, 3, 4500) : operation;
  return { ...finalOperation, operationName, initialOperation: operation };
}

async function pollGeminiOperation(operationName, attempts = 3, delayMs = 4500) {
  let current = null;
  for (let index = 0; index < attempts; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    current = await getGeminiOperation(operationName);
    if (current.done) return current;
  }
  return current || { name: operationName, done: false };
}

async function getGeminiOperation(operationName) {
  return geminiFetch(String(operationName).replace(/^\/?v1beta\//, ""), null, { method: "GET" });
}

async function pollXaiVideoJob(jobId) {
  if (!process.env.XAI_API_KEY) throw new Error("Set XAI_API_KEY to check Grok video jobs.");
  const candidates = [
    `https://api.x.ai/v1/videos/generations/${encodeURIComponent(jobId)}`,
    `https://api.x.ai/v1/videos/${encodeURIComponent(jobId)}`
  ];
  let lastMessage = "";
  for (const url of candidates) {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    lastMessage = payload?.error?.message || `Grok video status request failed with ${response.status}.`;
  }
  throw new Error(lastMessage || "Grok video status is unavailable for this job.");
}

function providerAvailable(provider) {
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (provider === "xai") return Boolean(process.env.XAI_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

function fallbackProviders(primary, kind = "image") {
  if (kind === "video_generation") return [primary].filter(providerAvailable);
  const all = kind === "edit" ? ["gemini", "xai"] : ["gemini", "xai", "openai"];
  return [primary, ...all.filter((provider) => provider !== primary)].filter(providerAvailable);
}

async function executeWithProviderFallback(kind, primaryProvider, runner) {
  const attempts = [];
  for (const provider of fallbackProviders(primaryProvider, kind)) {
    try {
      const result = await runner(provider);
      return {
        ...result,
        fallback: provider !== primaryProvider ? { from: primaryProvider, to: provider, attempts } : undefined
      };
    } catch (error) {
      attempts.push({ provider, message: error.message || "Provider failed." });
      await appendUsageEvent({
        type: kind,
        provider,
        model: "",
        status: "failed",
        costUsd: 0,
        estimatedCostUsd: 0,
        providerResponse: error.message || "Provider failed before returning output."
      });
    }
  }
  throw new Error(attempts.map((item) => `${item.provider}: ${item.message}`).join(" | ") || "No configured provider is available.");
}

function statusForError(error, fallback = 500) {
  if (Number(error?.status)) return Number(error.status);
  return /Monthly budget/i.test(error?.message || "") ? 402 : fallback;
}

function cryptoRandomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function routeForAction(action, provider = "openai") {
  if (action === "analyze_image") return provider === "gemini" ? "gemini.measurement" : provider === "xai" ? "xai.measurement" : "openai.measurement";
  if (action === "generate_image") return provider === "gemini" ? "gemini.image.generate" : provider === "xai" ? "xai.image.generate" : "openai.image.generate";
  if (action === "edit_image") return provider === "gemini" ? "gemini.image.edit" : "xai.image.edit";
  if (action === "generate_video") return provider === "gemini" ? "gemini.video.generate" : provider === "xai" ? "xai.video.generate" : "openai.video.generate";
  return "internal.prompt";
}

function providerForRoute(route) {
  if (route?.startsWith("xai.")) return "xai";
  if (route?.startsWith("gemini.")) return "gemini";
  if (route?.startsWith("openai.")) return "openai";
  return "internal";
}

function modeForRoute(route) {
  if (route?.includes("measurement")) return "measure";
  if (route?.includes("image.edit")) return "edit";
  if (route?.includes("video")) return "video";
  if (route?.includes("image.generate")) return "image";
  return "agent";
}

function modelForRoute(route) {
  if (route === "xai.measurement") return xaiMeasurementModel;
  if (route === "xai.image.generate" || route === "xai.image.edit") return xaiImageModel;
  if (route === "xai.video.generate") return xaiVideoModel;
  if (route === "gemini.measurement") return geminiMeasurementModel;
  if (route === "gemini.image.generate") return geminiImageModel;
  if (route === "gemini.image.edit") return geminiEditModel;
  if (route === "gemini.video.generate") return geminiVideoModel;
  if (route === "openai.image.generate") return imageModel;
  if (route === "openai.video.generate") return "sora-2";
  if (route === "openai.measurement") return measurementModel;
  return "router";
}

app.post("/api/generate-image", upload.array("references", 8), async (req, res) => {
  const openai = getOpenAI();
  const { prompt, quality = "auto", size = "auto", provider = "openai", model } = req.body || {};

  if (!prompt) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }

  if (provider === "gemini") {
    if (!process.env.GEMINI_API_KEY) {
      if (fallbackProviders("gemini", "image_generation").length) {
        try {
          res.json(await executeWithProviderFallback("image_generation", "gemini", (nextProvider) => executeImageGenerationTool(nextProvider, prompt, { model: nextProvider === "gemini" ? model : undefined, quality, size })));
        } catch (error) {
          res.status(statusForError(error)).json({ error: error.message || "Image generation fallback failed." });
        }
        return;
      }
      res.status(202).json({
        status: "ready_for_gemini_key",
        message: "Set GEMINI_API_KEY to generate images with Gemini Imagen.",
        request: { provider: "gemini", model: model || geminiImageModel, quality, size, referenceCount: req.files?.length || 0 }
      });
      return;
    }

    try {
      res.json(await executeWithProviderFallback("image_generation", "gemini", (nextProvider) => executeImageGenerationTool(nextProvider, prompt, { model: nextProvider === "gemini" ? model : undefined, quality, size })));
    } catch (error) {
      res.status(statusForError(error)).json({ error: error.message || "Gemini image generation failed." });
    }
    return;
  }

  if (provider === "xai") {
    if (!process.env.XAI_API_KEY) {
      if (fallbackProviders("xai", "image_generation").length) {
        try {
          res.json(await executeWithProviderFallback("image_generation", "xai", (nextProvider) => executeImageGenerationTool(nextProvider, prompt, { model: nextProvider === "xai" ? model : undefined, quality, size })));
        } catch (error) {
          res.status(statusForError(error)).json({ error: error.message || "Image generation fallback failed." });
        }
        return;
      }
      res.status(202).json({
        status: "ready_for_xai_key",
        message: "Set XAI_API_KEY to generate images with Grok/xAI.",
        request: { provider: "xai", model: model || xaiImageModel, quality, size, referenceCount: req.files?.length || 0 }
      });
      return;
    }

    try {
      res.json(await executeWithProviderFallback("image_generation", "xai", (nextProvider) => executeImageGenerationTool(nextProvider, prompt, { model: nextProvider === "xai" ? model : undefined, quality, size })));
    } catch (error) {
      res.status(statusForError(error)).json({ error: error.message || "xAI image generation failed." });
    }
    return;
  }

  if (!openai) {
    res.status(202).json({
      status: "ready_for_api_key",
      message: "Set OPENAI_API_KEY to generate images with OpenAI.",
      request: { provider: "openai", model: model || imageModel, quality, size, referenceCount: req.files?.length || 0 }
    });
    return;
  }

  try {
    res.json(await executeWithProviderFallback("image_generation", "openai", (nextProvider) => executeImageGenerationTool(nextProvider, prompt, { model: nextProvider === "openai" ? model : undefined, quality, size })));
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Image generation failed." });
  }
});

app.post("/api/edit-image", upload.single("reference"), async (req, res) => {
  const { prompt, provider = "xai", model, quality = "high", size = "auto" } = req.body || {};
  const resolvedModel = model || (provider === "gemini" ? geminiEditModel : xaiImageModel);

  try {
    validatePrompt(prompt, "Edit prompt");
    validateImageUpload(req.file);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    if (fallbackProviders("gemini", "edit").length) {
      try {
        res.json(await executeWithProviderFallback("edit", "gemini", (nextProvider) => executeImageEditTool(nextProvider, req.file, prompt, { model: nextProvider === "gemini" ? resolvedModel : undefined, quality, size })));
      } catch (error) {
        res.status(statusForError(error)).json({ error: error.message || "Image edit fallback failed." });
      }
      return;
    }
    res.status(202).json({
      status: "ready_for_gemini_key",
      message: "Set GEMINI_API_KEY to edit images with Gemini Nano Banana.",
      request: { provider: "gemini", model: resolvedModel, quality, size }
    });
    return;
  }

  if (provider !== "gemini" && !process.env.XAI_API_KEY) {
    if (fallbackProviders("xai", "edit").length) {
      try {
        res.json(await executeWithProviderFallback("edit", "xai", (nextProvider) => executeImageEditTool(nextProvider, req.file, prompt, { model: nextProvider === "xai" ? resolvedModel : undefined, quality, size })));
      } catch (error) {
        res.status(statusForError(error)).json({ error: error.message || "Image edit fallback failed." });
      }
      return;
    }
    res.status(202).json({
      status: "ready_for_xai_key",
      message: "Set XAI_API_KEY to edit images with Grok Imagine.",
      request: { provider: "xai", model: resolvedModel, quality, size }
    });
    return;
  }

  try {
    res.json(await executeWithProviderFallback("edit", provider, (nextProvider) => executeImageEditTool(nextProvider, req.file, prompt, { model: nextProvider === provider ? resolvedModel : undefined, quality, size })));
  } catch (error) {
    const status = /required|must be|detail/i.test(error.message || "") ? 400 : 500;
    res.status(status).json({ error: error.message || "xAI image edit failed." });
  }
});

app.post("/api/grok-agent-chat", upload.single("reference"), async (req, res) => {
  const { message, context = "", model = xaiAgentModel } = req.body || {};

  if (!message) {
    res.status(400).json({ error: "Message is required." });
    return;
  }

  if (!process.env.XAI_API_KEY) {
    res.status(202).json({
      status: "ready_for_xai_key",
      message: "Set XAI_API_KEY to chat with the Grok Agent.",
      request: { provider: "xai", model }
    });
    return;
  }

  const content = [
    {
      type: "input_text",
      text:
        "You are Grok Agent inside a fashion measurement, image editing, image generation, and image-to-video app. " +
        `${req.file ? "The user has attached an image in this request; do not ask them to upload another image unless a different angle is genuinely needed. " : "No image is attached to this request. "} ` +
        "Help the user plan creative actions, storyboard scenes, refine prompts, and decide the next operation. " +
        "If the user asks to create/edit/generate/animate, suggest one exact next app action. " +
        "Return only valid JSON with this shape: " +
        "{\"reply\":\"friendly concise answer\",\"action\":\"none|measure|edit_image|generate_image|generate_video\",\"prompt\":\"prompt to use if action is not none\",\"steps\":[\"short step 1\",\"short step 2\"],\"confidence\":\"low|medium|high\"}. " +
        `Current app context: ${context || "No extra context."} User message: ${message}`
    }
  ];

  if (req.file) {
    content.push({
      type: "input_image",
      image_url: `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`
    });
  }

  try {
    const budgetGuard = await enforceMonthlyBudget("agent", model);
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: "You are a practical Grok Imagine creative agent. Reply in JSON only."
          },
          {
            role: "user",
            content
          }
        ]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Grok Agent chat failed.");

    const agent = parseAgentJson(extractOutputText(data));
    const usage = buildMeasurementUsageReport(data.usage, "xai", model);
    await appendUsageEvent({
      type: "agent",
      provider: "xai",
      model,
      status: "completed",
      costUsd: usage.costUsd,
      estimatedCostUsd: usage.costUsd,
      providerResponse: "Grok Agent chat completed."
    });
    res.json({
      status: "completed",
      provider: "xai",
      model,
      agent,
      costUsd: usage.costUsd,
      costPreviewUsd: budgetGuard.estimatedCostUsd,
      budget: await getBudgetStatus("agent", model),
      usage
    });
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Grok Agent chat failed." });
  }
});

/*
    const response = await xai.responses.create({
      model,
      input: [
        {
          role: "system",
          content: "You are a practical Grok Imagine creative agent. Reply in JSON only."
        },
        {
          role: "user",
          content
        }
      ]
    });

    const agent = parseAgentJson(extractOutputText(response));
    res.json({
      status: "completed",
      provider: "xai",
      model,
      agent,
      usage: buildMeasurementUsageReport(response.usage, "xai", model)
    });
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Grok Agent chat failed." });
  }
});
*/

app.post("/api/generate-video", upload.single("reference"), async (req, res) => {
  const openai = getOpenAI();
  const { prompt, quality = "standard", size = "1280x720", seconds = "8", provider = "openai", model } = req.body || {};
  const resolvedModel = model || (provider === "gemini" ? geminiVideoModel : provider === "xai" ? xaiVideoModel : quality === "pro" ? "sora-2-pro" : "sora-2");

  if (!prompt) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }

  if (provider === "gemini") {
    if (!process.env.GEMINI_API_KEY) {
      if (fallbackProviders("gemini", "video_generation").length) {
        try {
          res.json(await executeWithProviderFallback("video_generation", "gemini", (nextProvider) => executeVideoTool(nextProvider, prompt, { file: req.file, model: nextProvider === "gemini" ? resolvedModel : undefined, size, seconds })));
        } catch (error) {
          res.status(statusForError(error)).json({ error: error.message || "Video generation fallback failed." });
        }
        return;
      }
      res.status(202).json({
        status: "ready_for_gemini_key",
        message: "Set GEMINI_API_KEY to start Gemini Veo jobs.",
        request: { provider: "gemini", model: resolvedModel, size, seconds, hasReference: Boolean(req.file) }
      });
      return;
    }

    try {
      res.json(await executeWithProviderFallback("video_generation", "gemini", (nextProvider) => executeVideoTool(nextProvider, prompt, { file: req.file, model: nextProvider === "gemini" ? resolvedModel : undefined, size, seconds })));
    } catch (error) {
      res.status(statusForError(error)).json({ error: error.message || "Gemini video generation failed." });
    }
    return;
  }

  if (provider === "xai") {
    if (!process.env.XAI_API_KEY) {
      if (fallbackProviders("xai", "video_generation").length) {
        try {
          res.json(await executeWithProviderFallback("video_generation", "xai", (nextProvider) => executeVideoTool(nextProvider, prompt, { file: req.file, model: nextProvider === "xai" ? resolvedModel : undefined, size, seconds })));
        } catch (error) {
          res.status(statusForError(error)).json({ error: error.message || "Video generation fallback failed." });
        }
        return;
      }
      res.status(202).json({
        status: "ready_for_xai_key",
        message: "Set XAI_API_KEY to start Grok/xAI video jobs.",
        request: { provider: "xai", model: resolvedModel, size, seconds, hasReference: Boolean(req.file) }
      });
      return;
    }

    try {
      res.json(await executeWithProviderFallback("video_generation", "xai", (nextProvider) => executeVideoTool(nextProvider, prompt, { file: req.file, model: nextProvider === "xai" ? resolvedModel : undefined, size, seconds })));
    } catch (error) {
      res.status(statusForError(error)).json({ error: error.message || "xAI video generation failed." });
    }
    return;
  }

  if (!openai) {
    res.status(202).json({
      status: "ready_for_api_key",
      message: "Set OPENAI_API_KEY to start Sora video render jobs.",
      request: { provider: "openai", model: resolvedModel, size, seconds, hasReference: Boolean(req.file) }
    });
    return;
  }

  try {
    res.json(await executeWithProviderFallback("video_generation", "openai", (nextProvider) => executeVideoTool(nextProvider, prompt, { file: req.file, model: nextProvider === "openai" ? resolvedModel : undefined, size, seconds })));
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Video generation failed." });
  }
});

app.post("/api/generate/image", upload.array("references", 8), async (req, res) => {
  const { prompt, provider = "openai", model, quality = "auto", size = "auto" } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });
  try {
    const result = await executeImageGenerationTool(provider, prompt, { model, quality, size });
    res.json(result);
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Image generation failed." });
  }
});

app.post("/api/edit/image", upload.single("reference"), async (req, res) => {
  const { prompt, provider = "xai", model, quality = "high", size = "auto" } = req.body || {};
  try {
    res.json(await executeImageEditTool(provider, req.file, prompt, { model: model || (provider === "gemini" ? geminiEditModel : xaiImageModel), quality, size }));
  } catch (error) {
    const status = /required|must be|detail/i.test(error.message || "") ? 400 : 500;
    res.status(status).json({ error: error.message || "Image edit failed." });
  }
});

app.post("/api/minimal-styling", upload.single("reference"), async (req, res) => {
  const { model = xaiImageModel, quality = "high", size = "auto", userNote = "" } = req.body || {};
  const requestId = cryptoRandomId("minimal-styling");
  const provider = "xai";
  const startedAt = new Date().toISOString();
  const events = [];

  if (!req.file) {
    res.status(400).json({ error: "A reference image is required for Minimal Styling." });
    return;
  }

  if (!getOpenAI()) {
    res.status(202).json({
      status: "ready_for_api_key",
      requestId,
      message: "Set OPENAI_API_KEY so OpenAI can review and prepare a safe Minimal Styling prompt."
    });
    return;
  }

  if (!process.env.XAI_API_KEY) {
    res.status(202).json({
      status: "ready_for_xai_key",
      requestId,
      message: "Set XAI_API_KEY to run Minimal Styling with Grok/xAI.",
      request: { provider, model, quality, size }
    });
    return;
  }

  try {
    events.push(buildMinimalStylingEvent(requestId, "request", "accepted", {
      provider,
      model,
      promptVariant: "planner",
      providerResponse: "Request accepted. OpenAI safety planner is preparing compliant prompts.",
      estimatedCostUsd: 0
    }));

    const plan = await createMinimalStylingPlan({ file: req.file, userNote });
    events.push(buildMinimalStylingEvent(requestId, "planner", plan.allowed ? "allowed" : "blocked", {
      provider: "openai",
      model: orchestrationModel,
      promptVariant: "policy_planner",
      providerResponse: plan.userMessage,
      rejectionReason: plan.allowed ? "" : plan.blockReason,
      estimatedCostUsd: 0
    }));

    if (!plan.allowed) {
      await persistMinimalStylingLog(events, { requestId, finalStatus: "blocked", startedAt });
      res.json({
        status: "blocked",
        requestId,
        provider,
        model,
        finalOutcome: "blocked",
        message: plan.userMessage,
        rejectionReason: plan.blockReason,
        attempts: [],
        saved: [],
        plan,
        events
      });
      return;
    }

    const prompts = [plan.primaryPrompt, plan.fallbackPrompt].filter(Boolean).slice(0, minimalStylingMaxAttempts);
    const attempts = [];

    for (const [index, prompt] of prompts.entries()) {
      const attemptNumber = index + 1;
      const promptVariant = attemptNumber === 1 ? "primary" : "fallback";
      events.push(buildMinimalStylingEvent(requestId, "attempt", "sent", {
        provider,
        model,
        promptVariant,
        prompt,
        providerResponse: `Attempt ${attemptNumber} sent to Grok image edit.`,
        estimatedCostUsd: minimalStylingCostEstimate
      }));

      try {
        const result = await executeXaiImageEditTool(req.file, prompt, { model, quality, size });
        const attemptCost = result.costUsd || calculateAccurateCost("xai", result.model || model, {}, "image_edit");
        attempts.push({
          attempt: attemptNumber,
          promptVariant,
          status: "succeeded",
          prompt,
          providerMessage: "Grok returned edited media.",
          costUsd: attemptCost,
          saved: result.saved || []
        });
        events.push(buildMinimalStylingEvent(requestId, "attempt", "succeeded", {
          provider,
          model: result.model || model,
          promptVariant,
          prompt,
          providerResponse: "Grok returned edited media.",
          estimatedCostUsd: attemptCost,
          costUsd: attemptCost
        }));
        await persistMinimalStylingLog(events, { requestId, finalStatus: "generated", startedAt });
        res.json({
          status: "completed",
          requestId,
          provider,
          model: result.model || model,
          finalOutcome: "generated",
          message: "Minimal Styling completed and saved locally.",
          costUsd: attemptCost,
          attempts,
          saved: result.saved || [],
          plan,
          events
        });
        return;
      } catch (error) {
        const providerMessage = error.message || "Grok rejected or failed the styling request.";
        const rejected = isProviderRejection(providerMessage);
        attempts.push({
          attempt: attemptNumber,
          promptVariant,
          status: rejected ? "rejected" : "failed",
          prompt,
          providerMessage,
          rejectionReason: rejected ? providerMessage : ""
        });
        events.push(buildMinimalStylingEvent(requestId, "attempt", rejected ? "rejected" : "failed", {
          provider,
          model,
          promptVariant,
          prompt,
          providerResponse: providerMessage,
          rejectionReason: rejected ? providerMessage : "",
          estimatedCostUsd: minimalStylingCostEstimate
        }));
      }
    }

    await persistMinimalStylingLog(events, { requestId, finalStatus: "stopped", startedAt });
    res.status(422).json({
      status: "stopped",
      requestId,
      provider,
      model,
      finalOutcome: "stopped",
      message: "Minimal Styling stopped after two compliant attempts. No further retries were made to control usage.",
      attempts,
      saved: [],
      plan,
      events
    });
  } catch (error) {
    const message = error.message || "Minimal Styling failed.";
    events.push(buildMinimalStylingEvent(requestId, "request", "failed", {
      provider,
      model,
      promptVariant: "system",
      providerResponse: message,
      rejectionReason: isProviderRejection(message) ? message : "",
      estimatedCostUsd: 0
    }));
    await persistMinimalStylingLog(events, { requestId, finalStatus: "failed", startedAt });
    res.status(statusForError(error)).json({
      status: "failed",
      requestId,
      provider,
      model,
      finalOutcome: "failed",
      message,
      attempts: [],
      saved: [],
      events
    });
  }
});

app.post("/api/generate/video", upload.single("reference"), async (req, res) => {
  const { prompt, provider = "openai", model, size = "1280x720", seconds = "8" } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });
  try {
    res.json(await executeVideoTool(provider, prompt, { file: req.file, model, size, seconds }));
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Video generation failed." });
  }
});

app.post("/api/swimwear-fit", upload.single("reference"), async (req, res) => {
  const { model = "grok-imagine-image-pro", quality = "high", size = "auto", userPrompt = "" } = req.body || {};
  const requestId = cryptoRandomId("swimwear-fit");
  const provider = "xai";
  const startedAt = new Date().toISOString();
  const events = [];

  if (!req.file) {
    res.status(400).json({ error: "A model reference image is required for Swimwear Fit Studio." });
    return;
  }

  if (!process.env.XAI_API_KEY) {
    res.status(202).json({
      status: "ready_for_xai_key",
      requestId,
      message: "Set XAI_API_KEY to run Grok precheck and swimwear image editing.",
      request: { provider, model, quality, size }
    });
    return;
  }

  try {
    events.push(buildSwimwearFitEvent(requestId, "request", "accepted", {
      provider,
      model,
      promptVariant: "intake",
      providerResponse: "Image attached. Grok safety and fit precheck starting.",
      estimatedCostUsd: 0
    }));

    const plan = await createSwimwearFitPlan({ file: req.file, userPrompt, model });
    events.push(buildSwimwearFitEvent(requestId, "precheck", plan.allowed ? "allowed" : "blocked", {
      provider,
      model: plan.precheckModel || xaiMeasurementModel,
      promptVariant: "grok_precheck",
      providerResponse: plan.userMessage,
      rejectionReason: plan.allowed ? "" : plan.blockReason,
      estimatedCostUsd: 0
    }));

    if (!plan.allowed) {
      await persistSwimwearFitLog(events, { requestId, finalStatus: "blocked", startedAt });
      res.json({
        status: "blocked",
        requestId,
        provider,
        model,
        finalOutcome: "blocked",
        message: plan.userMessage,
        rejectionReason: plan.blockReason,
        attempts: [],
        saved: [],
        plan,
        events
      });
      return;
    }

    const prompts = [plan.primaryPrompt, plan.fallbackPrompt].filter(Boolean).slice(0, swimwearFitMaxAttempts);
    const attempts = [];

    for (const [index, prompt] of prompts.entries()) {
      const attemptNumber = index + 1;
      const promptVariant = attemptNumber === 1 ? "primary_bikini" : "fallback_swimwear";
      events.push(buildSwimwearFitEvent(requestId, "attempt", "sent", {
        provider,
        model,
        promptVariant,
        prompt,
        providerResponse: `Attempt ${attemptNumber} sent to Grok image edit.`,
        estimatedCostUsd: swimwearFitCostEstimate
      }));

      try {
        const result = await executeXaiImageEditTool(req.file, prompt, { model, quality, size });
        const attemptCost = result.costUsd || calculateAccurateCost("xai", result.model || model, {}, "image_edit");
        attempts.push({
          attempt: attemptNumber,
          promptVariant,
          status: "succeeded",
          prompt,
          providerMessage: "Grok returned swimwear fit media.",
          costUsd: attemptCost,
          saved: result.saved || []
        });
        events.push(buildSwimwearFitEvent(requestId, "attempt", "succeeded", {
          provider,
          model: result.model || model,
          promptVariant,
          prompt,
          providerResponse: "Grok returned swimwear fit media.",
          estimatedCostUsd: attemptCost,
          costUsd: attemptCost
        }));
        await persistSwimwearFitLog(events, { requestId, finalStatus: "generated", startedAt });
        res.json({
          status: "completed",
          requestId,
          provider,
          model: result.model || model,
          finalOutcome: "generated",
          message: "Swimwear Fit Studio completed and saved locally.",
          costUsd: attemptCost,
          attempts,
          saved: result.saved || [],
          plan,
          events
        });
        return;
      } catch (error) {
        const providerMessage = error.message || "Grok rejected or failed the swimwear edit request.";
        const rejected = isProviderRejection(providerMessage);
        attempts.push({
          attempt: attemptNumber,
          promptVariant,
          status: rejected ? "rejected" : "failed",
          prompt,
          providerMessage,
          rejectionReason: rejected ? providerMessage : ""
        });
        events.push(buildSwimwearFitEvent(requestId, "attempt", rejected ? "rejected" : "failed", {
          provider,
          model,
          promptVariant,
          prompt,
          providerResponse: providerMessage,
          rejectionReason: rejected ? providerMessage : "",
          estimatedCostUsd: swimwearFitCostEstimate
        }));
      }
    }

    await persistSwimwearFitLog(events, { requestId, finalStatus: "stopped", startedAt });
    res.status(422).json({
      status: "stopped",
      requestId,
      provider,
      model,
      finalOutcome: "stopped",
      message: "Swimwear Fit Studio stopped after two compliant attempts. No extra retries were made.",
      attempts,
      saved: [],
      plan,
      events
    });
  } catch (error) {
    const message = error.message || "Swimwear Fit Studio failed.";
    events.push(buildSwimwearFitEvent(requestId, "request", "failed", {
      provider,
      model,
      promptVariant: "system",
      providerResponse: message,
      rejectionReason: isProviderRejection(message) ? message : "",
      estimatedCostUsd: 0
    }));
    await persistSwimwearFitLog(events, { requestId, finalStatus: "failed", startedAt });
    res.status(statusForError(error)).json({
      status: "failed",
      requestId,
      provider,
      model,
      finalOutcome: "failed",
      message,
      attempts: [],
      saved: [],
      events
    });
  }
});

app.get("/api/video-job-status", async (req, res) => {
  const { provider, model, id, seconds } = req.query || {};
  try {
    const result = await pollVideoProviderJob({ provider: String(provider || ""), model: String(model || ""), id: String(id || ""), seconds: String(seconds || "") });
    res.json({
      ...result,
      budget: await getBudgetStatus("video", result.model),
      usage: { provider: result.provider, model: result.model, costUsd: result.costUsd || 0, pricingSource: result.provider === "gemini" ? "local_gemini_pricing_map" : result.provider === "xai" ? "local_xai_pricing_map" : "local_video_estimate" }
    });
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Video job status failed." });
  }
});

app.get("/api/gemini/omni/capabilities", (_req, res) => {
  const liveEnabled = process.env.GEMINI_LIVE_ENABLED === "true";
  res.json({
    provider: "gemini",
    model: "gemini-omni-flash",
    status: process.env.GEMINI_OMNI_ENABLED === "true" ? "enabled" : "api_pending",
    enabled: process.env.GEMINI_OMNI_ENABLED === "true",
    supports: {
      prompt: true,
      referenceImages: 5,
      sourceVideo: true,
      voiceReference: true,
      conversationalVideoEditing: true,
      asyncPolling: true,
      liveStreaming: liveEnabled
    },
    live: {
      status: liveEnabled ? "enabled" : "prepared",
      model: process.env.GEMINI_LIVE_MODEL || "gemini-live-2.5-flash-preview",
      responseModalities: ["TEXT", "AUDIO"],
      outputRule: "Use one response modality per Live session.",
      realtimeInputs: ["text", "audio/pcm", "image/jpeg frames"],
      serverSideOnly: true
    },
    message: process.env.GEMINI_OMNI_ENABLED === "true"
      ? "Gemini Omni provider is enabled by environment flag."
      : "Gemini Omni Flash is prepared in the app architecture, but the developer API is not enabled here yet."
  });
});

app.get("/api/gemini/omni/live/capabilities", (_req, res) => {
  const enabled = process.env.GEMINI_LIVE_ENABLED === "true";
  res.json({
    provider: "gemini",
    capability: "live_multimodal_stream",
    status: enabled ? "enabled" : "prepared",
    enabled,
    defaultModel: process.env.GEMINI_LIVE_MODEL || "gemini-live-2.5-flash-preview",
    sdk: {
      package: "@google/genai",
      connection: "client.live.connect",
      eventCallbacks: ["onopen", "onmessage", "onerror", "onclose"]
    },
    responseModalities: ["TEXT", "AUDIO"],
    rule: "Create one Live session per selected output modality. Do not request text and audio in the same session.",
    inputs: {
      text: "sendClientContent",
      audio: "sendRealtimeInput({ audio })",
      imageFrames: "sendRealtimeInput({ media })"
    },
    security: "Gemini API key remains server-side. A browser UI should connect through a server WebSocket proxy or ephemeral Live token flow."
  });
});

app.post("/api/gemini/omni/live/session-config", (req, res) => {
  try {
    const { model, responseModality = "TEXT", systemInstruction } = req.body || {};
    const normalized = normalizeLiveModality(responseModality);
    const config = buildLiveSessionConfig({
      model: model || process.env.GEMINI_LIVE_MODEL || "gemini-live-2.5-flash-preview",
      responseModality: normalized,
      systemInstruction: systemInstruction || "You are a helpful fashion creative studio assistant."
    });
    res.json({
      status: "prepared",
      enabled: process.env.GEMINI_LIVE_ENABLED === "true",
      config,
      nextStep: "Use this config from a server-side WebSocket proxy. REST cannot hold a low-latency bidirectional Gemini Live session for the browser."
    });
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Gemini Live config failed." });
  }
});

app.post("/api/analyze/image", upload.single("reference"), async (req, res) => {
  const { provider = "openai", model } = req.body || {};
  if (!req.file) return res.status(400).json({ error: "A reference image is required for analysis." });
  try {
    res.json(await executeMeasurementTool(provider, req.file, model));
  } catch (error) {
    res.status(statusForError(error)).json({ error: error.message || "Image analysis failed." });
  }
});

app.get("/api/billing/summary", async (_req, res) => {
  try {
    const manifest = await buildRecentAssetIndex();
    const storage = await buildStorageSummary();
    const failedJobs = manifest.filter((item) => ["failed", "rejected", "stopped", "blocked"].includes(item.status || item.finalStatus || item.summary?.finalStatus)).length;
    const totals = buildBillingTotals(manifest);
    const openaiOfficial = await fetchOpenAIOfficialBilling({ days: 30 });
    res.json({
      status: "completed",
      generatedAt: new Date().toISOString(),
      manifestCount: manifest.length,
      failedJobs,
      uploads: 0,
      storage,
      totals,
      budget: await getBudgetStatus("image", xaiImageModel),
      openaiOfficial,
      providerSummary: totals.providerSummary,
      modelSummary: totals.modelSummary,
      recentAssets: manifest.slice(0, 80)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Billing summary failed." });
  }
});

app.get("/api/billing/openai-live", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days || 30)));
  const result = await fetchOpenAIOfficialBilling({ days });
  res.status(result.status === "unavailable" || result.status === "error" ? 202 : 200).json(result);
});

app.post("/api/open-output", async (req, res) => {
  try {
    const outputPath = resolveOutputPath(req.body || {});
    const stat = await fs.stat(outputPath);
    const args = stat.isDirectory() ? [outputPath] : [`/select,${outputPath}`];
    execFile("explorer.exe", args);
    res.json({ ok: true, opened: outputPath, type: stat.isDirectory() ? "folder" : "file" });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not open the saved location." });
  }
});

function mapSizeToAspectRatio(size) {
  if (size === "720x1280" || size === "1024x1536") return "9:16";
  if (size === "1536x1024" || size === "1280x720" || size === "1920x1080") return "16:9";
  return "1:1";
}

app.use((error, _req, res, _next) => {
  res.status(statusForError(error)).json({ error: error.message || "Server request failed." });
});

async function fetchCurrencyRates() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/GBP", { signal: controller.signal });
    if (!response.ok) throw new Error("Currency service unavailable.");
    const payload = await response.json();
    const source = payload?.rates || {};
    const rates = {
      GBP: 1,
      USD: Number(source.USD || 1.27),
      EUR: Number(source.EUR || 1.17),
      AED: Number(source.AED || 4.65),
      PKR: Number(source.PKR || 356)
    };
    return { ...rates, source: "open.er-api.com", live: true };
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackCurrencyRates() {
  return { GBP: 1, USD: 1.27, EUR: 1.17, AED: 4.65, PKR: 356, source: "fallback", live: false };
}

async function fetchUkWeatherContext() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=51.5072&longitude=-0.1276&current=temperature_2m,precipitation,wind_speed_10m,weather_code&timezone=Europe%2FLondon";
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Weather service unavailable.");
    const payload = await response.json();
    const current = payload?.current || {};
    const temperature = Number(current.temperature_2m ?? 14);
    const precipitation = Number(current.precipitation ?? 0);
    return {
      city: "London",
      temperatureC: temperature,
      precipitationMm: precipitation,
      windKph: Number(current.wind_speed_10m ?? 0),
      code: Number(current.weather_code ?? 0),
      summary: weatherSummary(Number(current.weather_code ?? 0), temperature, precipitation),
      stylingCue: weatherStylingCue(temperature, precipitation),
      live: true
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackWeatherContext() {
  return {
    city: "London",
    temperatureC: 14,
    precipitationMm: 0,
    windKph: 8,
    code: 1,
    summary: "Mild London weather",
    stylingCue: "Layerable swimwear, resortwear and breathable lingerie edits are suitable.",
    live: false
  };
}

function weatherSummary(code, temperature, precipitation) {
  if (precipitation > 0.4 || code >= 51) return `${Math.round(temperature)}°C with showers`;
  if (temperature >= 22) return `${Math.round(temperature)}°C and warm`;
  if (temperature <= 8) return `${Math.round(temperature)}°C and cool`;
  return `${Math.round(temperature)}°C and mild`;
}

function weatherStylingCue(temperature, precipitation) {
  if (precipitation > 0.4) return "Prioritise quick-dry swimwear, cover-ups, neutral layers and practical delivery timing.";
  if (temperature >= 22) return "Push bikini, resortwear, linen cover-up and brighter colour recommendations.";
  if (temperature <= 8) return "Emphasise lingerie basics, shapewear, lounge sets and thermal layering rather than swim.";
  return "Blend lingerie basics with holiday swim and transitional resortwear edits.";
}

function buildRetailPriceBoard(category, size, rates = fallbackCurrencyRates()) {
  const isBra = String(category).includes("bra");
  const rows = isBra
    ? [
        { retailer: "M&S", low: 14, high: 38, note: "Everyday, full cup, T-shirt, balcony" },
        { retailer: "John Lewis", low: 22, high: 72, note: "Branded and premium cup-shape variety" },
        { retailer: "Next", low: 12, high: 36, note: "Everyday, multipack and fast availability" },
        { retailer: "ASOS", low: 10, high: 45, note: "Trend-led lingerie and swim styling" }
      ]
    : [
        { retailer: "M&S", low: 6, high: 22, note: "Multipacks, no-VPL, cotton and lace" },
        { retailer: "John Lewis", low: 10, high: 38, note: "Premium briefs, shapewear and brands" },
        { retailer: "Next", low: 7, high: 24, note: "Briefs, thongs, shapewear and sets" },
        { retailer: "ASOS", low: 6, high: 28, note: "Trend-led lingerie and bikini bottoms" }
      ];

  return rows.map((row) => ({
    ...row,
    size,
    rangeGbp: formatCurrencyRange(row.low, row.high, "GBP", 1),
    currencies: ["USD", "EUR", "AED", "PKR"].map((currency) => ({
      currency,
      range: formatCurrencyRange(row.low, row.high, currency, rates[currency] || 1)
    }))
  }));
}

function formatCurrencyRange(low, high, currency, rate) {
  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "PKR" ? 0 : 2
  });
  return `${formatter.format(low * rate)}-${formatter.format(high * rate)}`;
}

function buildSeasonalTrendFeed(category, weather = fallbackWeatherContext()) {
  const month = new Date().getMonth();
  const isSummer = month >= 4 && month <= 8;
  const isWinter = month === 11 || month <= 1;
  const isBra = String(category).includes("bra");
  const weatherPush = weather.temperatureC >= 20 ? "weather is warm, so swim and resort edits are elevated" : "weather is mild, so balance swim with everyday lingerie";

  if (isBra) {
    return [
      { label: "Seasonal lead", value: isSummer ? "Bikini tops + balcony bras" : isWinter ? "T-shirt bras + smoothing layers" : "Everyday full-cup + soft balcony", note: weatherPush },
      { label: "Trending finish", value: "Clean neutrals, soft lace, satin trims", note: "Works for editorial and ecommerce styling." },
      { label: "Fit priority", value: "Band support first", note: "Cup style should change after band fit is stable." }
    ];
  }

  return [
    { label: "Seasonal lead", value: isSummer ? "Bikini bottoms + no-VPL briefs" : isWinter ? "High-waist briefs + shapewear" : "Brazilian briefs + cotton basics", note: weatherPush },
    { label: "Trending finish", value: "Seamless, high-leg, tonal sets", note: "Keeps the result modern without overcomplicating fit." },
    { label: "Fit priority", value: "Hip measurement first", note: "Waist matters most for high-waist and shapewear styles." }
  ];
}

async function saveMediaOutputs(payload, folder, prefix, metadata = {}) {
  const assets = extractMediaAssets(payload);
  if (!assets.length) return [];

  const targetDir = path.join(outputRoot, folder);
  await fs.mkdir(targetDir, { recursive: true });

  const saved = [];
  for (const [index, asset] of assets.entries()) {
    const extension = asset.mimeType?.split("/")[1]?.replace("jpeg", "jpg") || asset.extension || "bin";
    const filename = `${prefix}-${Date.now()}-${index + 1}.${extension}`;
    const filePath = path.join(targetDir, filename);
    const bytes = asset.bytes || await downloadBytes(asset.url);
    await fs.writeFile(filePath, bytes);
    saved.push({ filename, path: filePath, url: `/outputs/${folder}/${filename}`, sourceUrl: asset.url || null, ...metadata });
  }

  await appendManifest(saved.map((item) => ({ ...item, type: folder, createdAt: new Date().toISOString() })));
  return saved;
}

async function saveRawMediaOutput(bytes, folder, prefix, extension = "bin", metadata = {}) {
  const targetDir = path.join(outputRoot, folder);
  await fs.mkdir(targetDir, { recursive: true });
  const filename = `${prefix}-${Date.now()}-1.${extension}`;
  const filePath = path.join(targetDir, filename);
  await fs.writeFile(filePath, bytes);
  const saved = [{ filename, path: filePath, url: `/outputs/${folder}/${filename}`, sourceUrl: null, ...metadata }];
  await appendManifest(saved.map((item) => ({ ...item, type: folder, createdAt: new Date().toISOString() })));
  return saved;
}

async function buildRecentAssetIndex() {
  const manifestItems = (await readOutputManifest()).map(repairManifestAsset).map(hydrateBillingCost);
  const folderItems = await scanOutputMediaFiles();
  const byKey = new Map();

  for (const item of [...folderItems, ...manifestItems]) {
    const repaired = hydrateBillingCost(repairManifestAsset(item));
    const key = repaired.filename || repaired.url || repaired.path || `${repaired.type}-${repaired.createdAt}`;
    const current = byKey.get(key);
    byKey.set(key, { ...(current || {}), ...repaired });
  }

  return [...byKey.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function scanOutputMediaFiles() {
  const folders = [
    { folder: "images", absolute: path.join(outputRoot, "images") },
    { folder: "videos", absolute: path.join(outputRoot, "videos") }
  ];
  const rows = [];

  for (const target of folders) {
    let entries = [];
    try {
      entries = await fs.readdir(target.absolute, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(target.absolute, entry.name);
      const stat = await fs.stat(filePath);
      rows.push(repairManifestAsset({
        type: target.folder,
        filename: entry.name,
        path: filePath,
        url: `/outputs/${target.folder}/${entry.name}`,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        status: "completed"
      }));
    }
  }

  return rows;
}

function repairManifestAsset(item = {}) {
  const filename = item.filename || (item.path ? path.basename(item.path) : "");
  const folder = item.type === "videos" || String(item.jobType || "").includes("video") ? "videos" : "images";
  const inferred = inferAssetMetadata(filename, item);
  const url = item.url || (filename ? `/outputs/${folder}/${filename}` : "");
  const filePath = item.path || (filename ? path.join(outputRoot, folder, filename) : "");

  return {
    ...item,
    ...inferred,
    provider: item.provider || inferred.provider,
    model: item.model || inferred.model,
    jobType: item.jobType || inferred.jobType,
    status: item.status || "completed",
    filename,
    path: filePath,
    url,
    type: item.type || folder
  };
}

function inferAssetMetadata(filename = "", item = {}) {
  if (filename.startsWith("xai-edited")) return { provider: "xai", model: xaiImageModel, jobType: "image_edit" };
  if (filename.startsWith("xai-generated")) return { provider: "xai", model: xaiImageModel, jobType: "image_generation" };
  if (filename.startsWith("xai-video")) return { provider: "xai", model: xaiVideoModel, jobType: "video_generation" };
  if (filename.startsWith("gemini-edited")) return { provider: "gemini", model: geminiEditModel, jobType: "image_edit" };
  if (filename.startsWith("gemini-generated")) return { provider: "gemini", model: geminiImageModel, jobType: "image_generation" };
  if (filename.startsWith("gemini-video")) return { provider: "gemini", model: geminiVideoModel, jobType: "video_generation" };
  if (filename.startsWith("openai-generated")) return { provider: "openai", model: imageModel, jobType: "image_generation" };
  if (String(item.sourceUrl || "").includes("x.ai")) return { provider: "xai", model: xaiImageModel, jobType: "image_generation" };
  return {};
}

function resolveOutputPath({ path: requestedPath, url }) {
  const root = path.resolve(outputRoot);
  let target = "";

  if (typeof requestedPath === "string" && requestedPath.trim()) {
    target = path.resolve(requestedPath);
  } else if (typeof url === "string" && url.startsWith("/outputs/")) {
    const relative = url.replace(/^\/outputs\/?/, "");
    target = path.resolve(outputRoot, relative);
  }

  if (!target) throw new Error("No saved output path was provided.");
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Only files saved by this app can be opened.");
  }

  return target;
}

function hydrateBillingCost(item = {}) {
  const filename = item.filename || "";
  const inferredXai = filename.startsWith("xai-") || String(item.sourceUrl || "").includes("x.ai");
  const inferredGemini = filename.startsWith("gemini-") || String(item.sourceUrl || "").includes("googleapis.com");
  const inferredOpenAI = filename.startsWith("openai-");
  const provider = item.provider || (inferredGemini ? "gemini" : inferredXai ? "xai" : inferredOpenAI ? "openai" : "");
  const normalizedProvider = provider === "grok" ? "xai" : provider;
  const inferredJobType = filename.includes("edited") ? "image_edit" : filename.includes("generated") ? "image_generation" : filename.includes("video") ? "video_generation" : "";
  const jobType = inferredJobType || item.jobType || item.type || "";
  const model = item.model || (normalizedProvider === "xai" || normalizedProvider === "gemini" ? modelForBillingJob(jobType, normalizedProvider) : "");
  const status = String(item.status || "").toLowerCase();
  const estimated = Number(item.estimatedCostUsd || 0);
  if (status && status !== "completed") {
    return { ...item, provider: normalizedProvider, model: model || item.model, jobType, costUsd: 0, estimatedCostUsd: Number(estimated.toFixed(6)) };
  }
  const existing = Number(item.costUsd || 0);
  if (existing > 0) return { ...item, provider: normalizedProvider, model: model || item.model, jobType, costUsd: Number(existing.toFixed(6)), estimatedCostUsd: Number(existing.toFixed(6)) };
  if (normalizedProvider !== "xai" && normalizedProvider !== "grok" && normalizedProvider !== "gemini") return { ...item, provider: normalizedProvider, costUsd: 0, estimatedCostUsd: 0 };
  const type = jobType.includes("measurement") ? "measurement" : jobType.includes("agent") ? "agent" : jobType.includes("video") ? "video_generation" : jobType.includes("edit") ? "image_edit" : "image_generation";
  const costUsd = calculateAccurateCost(normalizedProvider, model || modelForBillingJob(type, normalizedProvider), item.usage || {}, type);
  return { ...item, provider: normalizedProvider, model: model || modelForBillingJob(type, normalizedProvider), jobType: type, costUsd, estimatedCostUsd: costUsd };
}

function modelForBillingJob(jobType = "", provider = "xai") {
  if (provider === "gemini") {
    if (jobType.includes("video")) return geminiVideoModel;
    if (jobType.includes("measurement")) return geminiMeasurementModel;
    if (jobType.includes("edit")) return geminiEditModel;
    return geminiImageModel;
  }
  if (jobType.includes("video")) return xaiVideoModel;
  if (jobType.includes("measurement")) return xaiMeasurementModel;
  if (jobType.includes("agent")) return xaiAgentModel;
  return xaiImageModel;
}

function buildBillingTotals(manifest = []) {
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthItems = manifest.filter((item) => !item.createdAt || String(item.createdAt).startsWith(monthKey));
  const totalSpend = sumCosts(monthItems);
  const grokSpend = sumCosts(monthItems.filter((item) => item.provider === "xai" || item.provider === "grok"));
  const geminiSpend = sumCosts(monthItems.filter((item) => item.provider === "gemini"));
  const openaiSpend = sumCosts(monthItems.filter((item) => item.provider === "openai"));
  return {
    totalSpend: Number(totalSpend.toFixed(6)),
    grokSpend: Number(grokSpend.toFixed(6)),
    geminiSpend: Number(geminiSpend.toFixed(6)),
    openaiSpend: Number(openaiSpend.toFixed(6)),
    estimatedNextBill: Number((totalSpend * 1.18).toFixed(6)),
    providerSummary: summarizeManifestCosts(monthItems, "provider"),
    modelSummary: summarizeManifestCosts(monthItems, "model")
  };
}

function sumCosts(items = []) {
  return items.reduce((sum, item) => sum + Number(item.costUsd || item.estimatedCostUsd || 0), 0);
}

function summarizeManifestCosts(items = [], key) {
  const map = new Map();
  for (const item of items) {
    const label = item[key] || "unknown";
    const current = map.get(label) || { provider: label, model: label, count: 0, cost: 0 };
    current.count += 1;
    current.cost += Number(item.costUsd || item.estimatedCostUsd || 0);
    map.set(label, current);
  }
  return [...map.values()].map((item) => ({ ...item, cost: Number(item.cost.toFixed(6)) })).sort((a, b) => b.cost - a.cost);
}

async function createMinimalStylingPlan({ file, userNote = "" }) {
  const openai = getOpenAI();
  if (!openai) throw new Error("OpenAI API key is required for Minimal Styling safety planning.");

  const response = await openai.responses.create({
    model: orchestrationModel,
    input: [
      {
        role: "system",
        content:
          "You are the safety-aware workflow planner for a public fashion image editing app. " +
          "Classify whether a one-click Minimal Styling request can be sent to an image editing provider. " +
          "Stay policy-compliant. Do not create sexualized, explicit, fetish, nude, underwear-only, or bypass/moderation-evasion prompts. " +
          "If safe, create exactly two compliant fashion-edit prompts: primary and fallback. " +
          "Use editorial, e-commerce, resortwear, summer styling, simplified silhouette, sleeveless tasteful variation, lighter outfit styling language. " +
          "Preserve identity, pose, realistic body proportions, and non-explicit presentation. " +
          "Return only JSON: {\"allowed\":boolean,\"riskLevel\":\"low|medium|high\",\"blockReason\":\"\",\"userMessage\":\"\",\"primaryPrompt\":\"\",\"fallbackPrompt\":\"\",\"estimatedCostUsd\":0.07,\"safeAlternatives\":[\"...\"]}."
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `User note: ${userNote || "One-click Minimal Styling. No extra user prompt."}\n` +
              `Image metadata: filename=${file.originalname}, mime=${file.mimetype}, bytes=${file.size}.\n` +
              "Decide if this should proceed and produce safe prompts only."
          },
          {
            type: "input_image",
            image_url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`
          }
        ]
      }
    ]
  });

  const plan = normalizeMinimalStylingPlan(parseJsonObject(extractOutputText(response)));
  if (!plan.allowed) return plan;
  if (!plan.primaryPrompt || !plan.fallbackPrompt) throw new Error("OpenAI did not return compliant Minimal Styling prompts.");
  return plan;
}

function normalizeMinimalStylingPlan(raw = {}) {
  const safeAlternatives = Array.isArray(raw.safeAlternatives) ? raw.safeAlternatives.slice(0, 4) : [];
  const allowed = raw.allowed === true && !looksUnsafeStylingPrompt(`${raw.primaryPrompt || ""} ${raw.fallbackPrompt || ""}`);
  return {
    allowed,
    riskLevel: ["low", "medium", "high"].includes(raw.riskLevel) ? raw.riskLevel : allowed ? "low" : "high",
    blockReason: allowed ? "" : raw.blockReason || "This styling request was not safe to send to the image provider.",
    userMessage: raw.userMessage || (allowed ? "Minimal Styling is approved for a compliant fashion edit." : "Minimal Styling was blocked before sending to the image provider."),
    primaryPrompt: allowed ? enforceSafeMinimalStylingPrompt(raw.primaryPrompt, "primary") : "",
    fallbackPrompt: allowed ? enforceSafeMinimalStylingPrompt(raw.fallbackPrompt, "fallback") : "",
    estimatedCostUsd: Number(raw.estimatedCostUsd) || minimalStylingCostEstimate,
    safeAlternatives: safeAlternatives.length ? safeAlternatives : [
      "Try a refined summer fashion version.",
      "Try a minimalist editorial outfit with clean styling.",
      "Try a tasteful resortwear-inspired silhouette."
    ]
  };
}

function enforceSafeMinimalStylingPrompt(prompt, variant) {
  const base = String(prompt || "").trim();
  const fallback = variant === "fallback"
    ? "Create a tasteful resortwear-inspired fashion edit with a lighter, simplified silhouette, premium editorial styling, realistic fabric, and natural coverage. Preserve the same person, pose, face, body proportions, and non-explicit presentation."
    : "Create a premium editorial fashion edit with lighter minimal styling, a simplified summer outfit silhouette, refined e-commerce lighting, realistic fabric, and tasteful non-explicit coverage. Preserve the same person, pose, face, body proportions, and identity.";
  const safe = looksUnsafeStylingPrompt(base) ? fallback : base || fallback;
  return `${safe} Keep the result fashion-oriented, non-explicit, realistic, and policy-compliant. Do not add nudity, fetish styling, or sexualized presentation.`;
}

function looksUnsafeStylingPrompt(prompt = "") {
  const lower = prompt.toLowerCase();
  return [
    "nude",
    "naked",
    "see through",
    "see-through",
    "transparent clothing",
    "lingerie",
    "underwear",
    "bikini",
    "sexual",
    "erotic",
    "fetish",
    "spicy",
    "revealing"
  ].some((term) => lower.includes(term));
}

async function createSwimwearFitPlan({ file, userPrompt = "", model = xaiImageModel }) {
  const xai = getXAI();
  if (!xai) throw new Error("XAI_API_KEY is required for Grok Swimwear Fit precheck.");

  const response = await xai.chat.completions.create({
    model: xaiMeasurementModel,
    messages: [
      {
        role: "system",
        content:
          "You are Grok Swimwear Fit Safety Planner for a public fashion image editing app. " +
          "Inspect the uploaded image and the user request before any image-edit provider call. " +
          "Allow only adult, tasteful, non-explicit swimwear, bikini, resortwear, or fashion-catalog transformations. " +
          "Block if the person appears under 18, age is uncertain or childlike, or the request asks for nudity, lingerie, underwear, fetish, erotic, explicit, transparent clothing, sexualized posing, or moderation bypass. " +
          "If safe, produce one primary prompt for a fashionable bikini/swimwear edit and one fallback prompt for a more conservative one-piece/resort swimwear edit. " +
          "Prompts must preserve face, identity, pose, body proportions, realistic fabric, and a professional editorial/e-commerce style. " +
          "Return ONLY valid JSON: {\"allowed\":boolean,\"riskLevel\":\"low|medium|high\",\"blockReason\":\"\",\"userMessage\":\"\",\"primaryPrompt\":\"\",\"fallbackPrompt\":\"\",\"safeAlternatives\":[\"...\"],\"precheckModel\":\"grok-4.20-0309-reasoning\"}."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `User request: ${userPrompt || "One-click Swimwear Fit Studio: create tasteful adult bikini/swimwear fashion styling."}\n` +
              `Target edit model: ${model}.\n` +
              `Image metadata: filename=${file.originalname}, mime=${file.mimetype}, bytes=${file.size}.\n` +
              "Decide whether this is safe and produce provider-ready prompts only when safe."
          },
          {
            type: "image_url",
            image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}` }
          }
        ]
      }
    ],
    temperature: 0,
    max_tokens: 900
  });

  return normalizeSwimwearFitPlan(parseJsonObject(extractOutputText(response)));
}

function normalizeSwimwearFitPlan(raw = {}) {
  const rawPrompts = `${raw.primaryPrompt || ""} ${raw.fallbackPrompt || ""}`;
  const requestedAllowed = raw.allowed === true;
  const unsafePrompt = looksUnsafeSwimwearPrompt(rawPrompts);
  const allowed = requestedAllowed && !unsafePrompt;
  const safeAlternatives = Array.isArray(raw.safeAlternatives) ? raw.safeAlternatives.slice(0, 4) : [];
  return {
    allowed,
    riskLevel: ["low", "medium", "high"].includes(raw.riskLevel) ? raw.riskLevel : allowed ? "low" : "high",
    blockReason: allowed ? "" : raw.blockReason || "This image or request is not safe for a swimwear edit.",
    userMessage: raw.userMessage || (allowed
      ? "Grok precheck approved a tasteful adult swimwear fashion edit."
      : "Grok precheck blocked this before any image generation call."),
    primaryPrompt: allowed ? enforceSafeSwimwearPrompt(raw.primaryPrompt, "primary") : "",
    fallbackPrompt: allowed ? enforceSafeSwimwearPrompt(raw.fallbackPrompt, "fallback") : "",
    estimatedCostUsd: swimwearFitCostEstimate,
    safeAlternatives: safeAlternatives.length ? safeAlternatives : [
      "Try a tasteful resortwear editorial look.",
      "Try a one-piece swimwear catalog edit.",
      "Try summer fashion styling with natural coverage."
    ],
    precheckModel: raw.precheckModel || xaiMeasurementModel
  };
}

function enforceSafeSwimwearPrompt(prompt, variant = "primary") {
  const base = String(prompt || "").trim();
  const fallback = variant === "fallback"
    ? "Create a tasteful adult one-piece swimwear or resortwear fashion edit in a professional catalog style. Preserve the same person, face, identity, pose, body proportions, realistic fabric, and natural non-explicit coverage."
    : "Create a tasteful adult bikini swimwear fashion edit in a premium editorial/e-commerce style. Preserve the same person, face, identity, pose, body proportions, realistic fabric, and natural non-explicit coverage.";
  const safe = looksUnsafeSwimwearPrompt(base) ? fallback : base || fallback;
  return `${safe} Use adult fashion-catalog swimwear presentation only. No nudity, lingerie, fetish styling, transparent clothing, sexualized pose, explicit content, or moderation-bypass language.`;
}

function looksUnsafeSwimwearPrompt(prompt = "") {
  const lower = prompt.toLowerCase();
  return [
    "nude",
    "naked",
    "topless",
    "see through",
    "see-through",
    "transparent clothing",
    "transparent dress",
    "lingerie",
    "underwear",
    "panty",
    "panties",
    "thong",
    "g-string",
    "sexual",
    "erotic",
    "fetish",
    "spicy",
    "provocative",
    "seductive",
    "bypass",
    "ignore safety",
    "minor",
    "underage",
    "teen",
    "child",
    "schoolgirl",
    "young-looking"
  ].some((term) => lower.includes(term));
}

function isProviderRejection(message = "") {
  const lower = message.toLowerCase();
  return ["policy", "safety", "moderation", "rejected", "not allowed", "unsafe", "blocked", "content"].some((term) => lower.includes(term));
}

function buildMinimalStylingEvent(requestId, stage, status, detail = {}) {
  return {
    requestId,
    feature: "minimal_styling",
    stage,
    status,
    provider: detail.provider || "",
    model: detail.model || "",
    promptVariant: detail.promptVariant || "",
    prompt: detail.prompt || "",
    providerResponse: detail.providerResponse || "",
    rejectionReason: detail.rejectionReason || "",
    estimatedCostUsd: Number(detail.estimatedCostUsd || 0),
    timestamp: new Date().toISOString()
  };
}

async function persistMinimalStylingLog(events, summary) {
  if (!events.length) return;
  await appendManifest(events.map((event) => ({ ...event, type: "minimal-styling-log", summary })));
  await logMinimalStylingToSupabase(events, summary);
}

function buildSwimwearFitEvent(requestId, stage, status, detail = {}) {
  return {
    requestId,
    feature: "swimwear_fit",
    stage,
    status,
    provider: detail.provider || "",
    model: detail.model || "",
    promptVariant: detail.promptVariant || "",
    prompt: detail.prompt || "",
    providerResponse: detail.providerResponse || "",
    rejectionReason: detail.rejectionReason || "",
    estimatedCostUsd: Number(detail.estimatedCostUsd || 0),
    costUsd: Number(detail.costUsd || detail.estimatedCostUsd || 0),
    timestamp: new Date().toISOString()
  };
}

async function persistSwimwearFitLog(events, summary) {
  if (!events.length) return;
  await appendManifest(events.map((event) => ({ ...event, type: "swimwear-fit-log", summary })));
  await logMinimalStylingToSupabase(events, summary);
}

async function logMinimalStylingToSupabase(events, summary) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const table = process.env.SUPABASE_AI_EVENTS_TABLE || "ai_generation_events";
  if (!url || !key) return;

  const rows = events.map((event) => ({
    request_id: event.requestId,
    feature: event.feature,
    stage: event.stage,
    prompt_variant: event.promptVariant,
    provider: event.provider,
    model: event.model,
    status: event.status,
    prompt: event.prompt,
    outcome: summary.finalStatus,
    provider_response: event.providerResponse,
    rejection_reason: event.rejectionReason,
    estimated_cost_usd: event.estimatedCostUsd,
    metadata: { summary },
    created_at: event.timestamp
  }));

  try {
    await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(rows)
    });
  } catch {
    // Supabase logging is optional; local manifest logging remains the fallback.
  }
}

function extractMediaAssets(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.images) ? payload.images : Array.isArray(payload?.predictions) ? payload.predictions : [];
  const assets = data.flatMap((item) => {
    if (item?.url) return [{ url: item.url, extension: extensionFromUrl(item.url) }];
    if (item?.b64_json) return [{ bytes: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" }];
    if (item?.bytesBase64Encoded) return [{ bytes: Buffer.from(item.bytesBase64Encoded, "base64"), mimeType: item.mimeType || "image/png" }];
    if (item?.image?.bytesBase64Encoded) return [{ bytes: Buffer.from(item.image.bytesBase64Encoded, "base64"), mimeType: item.image.mimeType || "image/png" }];
    return [];
  });
  collectNestedMedia(payload, assets);
  return dedupeAssets(assets);
}

function collectNestedMedia(value, assets, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (typeof value.url === "string" && looksLikeMediaUrl(value.url)) {
    assets.push({ url: value.url, extension: extensionFromUrl(value.url) });
  }
  if (typeof value.b64_json === "string") {
    assets.push({ bytes: Buffer.from(value.b64_json, "base64"), mimeType: "image/png" });
  }
  const inline = value.inlineData || value.inline_data;
  if (inline && typeof inline.data === "string") {
    assets.push({ bytes: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType || inline.mime_type || "image/png" });
  }
  if (typeof value.bytesBase64Encoded === "string") {
    assets.push({ bytes: Buffer.from(value.bytesBase64Encoded, "base64"), mimeType: value.mimeType || "image/png" });
  }
  for (const item of Object.values(value)) {
    if (item && typeof item === "object") collectNestedMedia(item, assets, seen);
  }
}

function looksLikeMediaUrl(url) {
  return /^https?:\/\//i.test(url) && /\.(png|jpe?g|webp|gif|mp4|mov|webm)(\?|$)/i.test(url);
}

function dedupeAssets(assets) {
  const seen = new Set();
  return assets.filter((asset) => {
    const key = asset.url || asset.bytes?.toString("base64").slice(0, 80);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function downloadBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download generated asset: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).replace(".", "");
    return ext || "png";
  } catch {
    return "png";
  }
}

async function appendManifest(items) {
  const manifestPath = path.join(outputRoot, "manifest.json");
  await fs.mkdir(outputRoot, { recursive: true });
  let current = [];
  try {
    current = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    current = [];
  }
  await fs.writeFile(manifestPath, JSON.stringify([...items, ...current].slice(0, 500), null, 2));
}

async function readOutputManifest() {
  const manifestPath = path.join(outputRoot, "manifest.json");
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function buildStorageSummary() {
  const images = await summarizeFolderStorage(path.join(outputRoot, "images"));
  const videos = await summarizeFolderStorage(path.join(outputRoot, "videos"));
  const totalBytes = images.bytes + videos.bytes;
  return {
    totalBytes,
    images: { count: images.count, bytes: images.bytes },
    videos: { count: videos.count, bytes: videos.bytes },
    buckets: [
      { bucket: "outputs/images", count: images.count, bytes: images.bytes },
      { bucket: "outputs/videos", count: videos.count, bytes: videos.bytes }
    ]
  };
}

async function summarizeFolderStorage(folder) {
  let count = 0;
  let bytes = 0;
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        const nested = await summarizeFolderStorage(fullPath);
        count += nested.count;
        bytes += nested.bytes;
      } else {
        const stat = await fs.stat(fullPath);
        count += 1;
        bytes += stat.size;
      }
    }
  } catch {
    return { count, bytes };
  }
  return { count, bytes };
}

app.listen(port, () => {
  console.log(`Measurement studio API running on http://localhost:${port}`);
});
