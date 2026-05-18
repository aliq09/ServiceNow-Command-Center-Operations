import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import multer from "multer";
import OpenAI from "openai";
import path from "node:path";
import "dotenv/config";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const port = process.env.PORT || 8790;
const imageModel = "gpt-image-2";
const measurementModel = process.env.OPENAI_MEASUREMENT_MODEL || "gpt-5.2";
const xaiMeasurementModel = process.env.XAI_MEASUREMENT_MODEL || "grok-4.20-0309-reasoning";
const xaiImageModel = process.env.XAI_IMAGE_MODEL || "grok-imagine-image-pro";
const xaiVideoModel = process.env.XAI_VIDEO_MODEL || "grok-imagine-video";
const orchestrationModel = process.env.OPENAI_ORCHESTRATION_MODEL || "gpt-5.2";
const minimalStylingMaxAttempts = 2;
const minimalStylingCostEstimate = 0.07;
const XAI_PRICING = {
  "grok-4.20-0309-reasoning": { input: 0.00125, output: 0.0025 },
  "grok-4.20-multi-agent-0309": { input: 0.00125, output: 0.0025 },
  "grok-imagine-image-pro": { per_image: 0.07 },
  "grok-imagine-image": { per_image: 0.02 },
  "grok-imagine-video": { per_video: 0.25 },
  measurement: { fixed: 0.0035 },
  agent: { input: 0.00125, output: 0.0025 }
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

const getOpenAIAdminKey = () => process.env.OPENAI_ADMIN_API_KEY || "";

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

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    hasXaiKey: Boolean(process.env.XAI_API_KEY),
    imageModel,
    measurementModel,
    xaiMeasurementModel,
    xaiImageModel,
    xaiVideoModel,
    cwd: process.cwd()
  });
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
    res.status(500).json({ error: error.message || "Assistant orchestration failed." });
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
- Internal tools: prompt_refinement, suggest_next_step, export/history.

Return only valid JSON. Do not include markdown.
Schema:
{
  "intent": "image_generate|image_edit|image_enhance|image_consistency|image_to_video|style_transfer|measurement_analysis|prompt_refinement|suggest_next_step",
  "mode": "measure|image|edit|video|agent",
  "recommended_provider": "openai|xai|internal",
  "recommended_model": "model id",
  "recommended_action": "analyze_image|generate_image|edit_image|generate_video|refine_prompt|suggest_next_step",
  "tool_route": "openai.measurement|openai.image.generate|openai.video.generate|xai.measurement|xai.image.generate|xai.image.edit|xai.video.generate|internal.prompt",
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

  if (provider === "xai") {
    if (!xai) {
      res.status(202).json({
        status: "ready_for_xai_key",
        message: "Set XAI_API_KEY to estimate measurements with Grok image analysis.",
        request: { provider: "xai", model: model || xaiMeasurementModel }
      });
      return;
    }

    const imageBase64 = req.file.buffer.toString("base64");

    try {
      const response = await xai.chat.completions.create({
        model: model || xaiMeasurementModel,
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
      const usage = buildMeasurementUsageReport(response.usage, "xai", model || xaiMeasurementModel);
      await appendUsageEvent({
        type: "measurement",
        provider: "xai",
        model: model || xaiMeasurementModel,
        status: "completed",
        costUsd: usage.costUsd,
        estimatedCostUsd: usage.costUsd,
        providerResponse: "Grok measurement completed."
      });
      res.json({
        status: "completed",
        provider: "xai",
        model: model || xaiMeasurementModel,
        measurement,
        recommendations: getClothingSizeRecommendations(measurement),
        costUsd: usage.costUsd,
        usage
      });
    } catch (error) {
      res.status(500).json({ error: error.message || "Grok measurement estimation failed." });
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
      usage: buildMeasurementUsageReport(response.usage, "openai", model || measurementModel)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Measurement estimation failed." });
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
    recommended_provider: ["openai", "xai", "internal"].includes(raw.recommended_provider) ? raw.recommended_provider : providerForRoute(route),
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

  if (plan.tool_route === "openai.measurement" || plan.tool_route === "xai.measurement") {
    if (!options.file) throw new Error("A reference image is required for measurement analysis.");
    return executeMeasurementTool(plan.tool_route === "xai.measurement" ? "xai" : "openai", options.file, plan.recommended_model);
  }

  if (plan.tool_route === "openai.image.generate" || plan.tool_route === "xai.image.generate") {
    if (!prompt) throw new Error("The assistant did not return a generation prompt.");
    return executeImageGenerationTool(plan.tool_route.startsWith("xai") ? "xai" : "openai", prompt, {
      model: plan.recommended_model,
      quality: options.quality,
      size: options.size
    });
  }

  if (plan.tool_route === "xai.image.edit") {
    if (!options.file) throw new Error("A reference image is required for image editing.");
    if (!prompt) throw new Error("The assistant did not return an edit prompt.");
    return executeXaiImageEditTool(options.file, prompt, {
      model: plan.recommended_model || xaiImageModel,
      quality: options.quality,
      size: options.size
    });
  }

  if (plan.tool_route === "openai.video.generate" || plan.tool_route === "xai.video.generate") {
    if (!prompt) throw new Error("The assistant did not return a video prompt.");
    return executeVideoTool(plan.tool_route.startsWith("xai") ? "xai" : "openai", prompt, {
      file: options.file,
      model: plan.recommended_model,
      size: options.size,
      seconds: options.seconds
    });
  }

  return { status: "planned", provider: "internal", model: "router", message: "No executable tool was selected.", saved: [] };
}

async function executeMeasurementTool(provider, file, model) {
  const client = provider === "xai" ? getXAI() : getOpenAI();
  if (!client) throw new Error(provider === "xai" ? "Set XAI_API_KEY to use Grok measurement." : "Set OPENAI_API_KEY to use OpenAI measurement.");
  if (provider === "xai") {
    const imageBase64 = file.buffer.toString("base64");
    const response = await client.chat.completions.create({
      model: model || xaiMeasurementModel,
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
    const usage = buildMeasurementUsageReport(response.usage, provider, model || xaiMeasurementModel);
    await appendUsageEvent({
      type: "measurement",
      provider,
      model: model || xaiMeasurementModel,
      status: "completed",
      costUsd: usage.costUsd,
      estimatedCostUsd: usage.costUsd,
      providerResponse: "Grok measurement completed."
    });
    return {
      status: "completed",
      provider,
      model: model || xaiMeasurementModel,
      measurement,
      recommendations: getClothingSizeRecommendations(measurement),
      costUsd: usage.costUsd,
      usage,
      saved: []
    };
  }
  const imageUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  const response = await client.responses.create({
    model: model || (provider === "xai" ? xaiMeasurementModel : measurementModel),
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "Estimate fashion fitting measurements. Return only JSON: {\"confidence\":\"low|medium|high\",\"notes\":\"short note\",\"heightCm\":number,\"shoulderCm\":number,\"bustCm\":number,\"underbustCm\":number,\"waistCm\":number,\"hipCm\":number,\"inseamCm\":number}." },
        { type: "input_image", image_url: imageUrl, detail: "high" }
      ]
    }]
  });
  return {
    status: "completed",
    provider,
    model: model || (provider === "xai" ? xaiMeasurementModel : measurementModel),
    measurement: parseMeasurementJson(extractOutputText(response)),
    usage: buildMeasurementUsageReport(response.usage, provider, model || measurementModel),
    saved: []
  };
}

async function executeImageGenerationTool(provider, prompt, { model, quality = "auto", size = "auto" }) {
  if (provider === "xai") {
    if (!process.env.XAI_API_KEY) throw new Error("Set XAI_API_KEY to generate images with Grok/xAI.");
    const response = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model || xaiImageModel, prompt, n: 1, aspect_ratio: mapSizeToAspectRatio(size), resolution: quality === "high" ? "2k" : "1k" })
    });
    const image = await response.json();
    if (!response.ok) throw new Error(image.error?.message || "xAI image generation failed.");
    const resolvedModel = model || xaiImageModel;
    const outputCount = Array.isArray(image.data) ? image.data.length || 1 : 1;
    const costUsd = Number((calculateAccurateCost("xai", resolvedModel, image.usage || {}, "image_generation") * outputCount).toFixed(6));
    const saved = attachCostToSaved(
      await saveMediaOutputs(image, "images", "xai-generated", { provider: "xai", model: resolvedModel, costUsd, estimatedCostUsd: costUsd, status: "completed", jobType: "image_generation" }),
      costUsd,
      { provider: "xai", model: resolvedModel, status: "completed", jobType: "image_generation" }
    );
    return { status: "completed", provider: "xai", model: resolvedModel, saved, image, costUsd, usage: { provider: "xai", model: resolvedModel, costUsd, pricingSource: "local_xai_pricing_map" } };
  }

  const openai = getOpenAI();
  if (!openai) throw new Error("Set OPENAI_API_KEY to generate images with OpenAI.");
  const resolvedModel = model || imageModel;
  const image = await openai.images.generate({ model: resolvedModel, prompt, quality, size, n: 1 });
  return {
    status: "completed",
    provider: "openai",
    model: resolvedModel,
    saved: await saveMediaOutputs(image, "images", "openai-generated", { provider: "openai", model: resolvedModel, status: "completed", jobType: "image_generation" }),
    image
  };
}

async function executeXaiImageEditTool(file, prompt, { model = xaiImageModel, quality = "high", size = "auto" }) {
  validateImageUpload(file);
  validatePrompt(prompt, "Edit prompt");
  if (!process.env.XAI_API_KEY) throw new Error("Set XAI_API_KEY to edit images with Grok Imagine.");
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
  return { status: "completed", provider: "xai", model, saved, edit, costUsd, usage: { provider: "xai", model, costUsd, pricingSource: "local_xai_pricing_map" } };
}

async function executeVideoTool(provider, prompt, { file, model, size = "1280x720", seconds = "8" }) {
  const resolvedModel = model || (provider === "xai" ? xaiVideoModel : "sora-2");
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
      await appendUsageEvent({ type: "video_generation", provider: "xai", model: resolvedModel, status, costUsd, estimatedCostUsd: costUsd, providerResponse: "Grok video request accepted; final media URL not returned yet." });
    }
    return { status, provider: "xai", model: resolvedModel, saved, video, costUsd, usage: { provider: "xai", model: resolvedModel, costUsd, pricingSource: "local_xai_pricing_map" } };
  }

  const openai = getOpenAI();
  if (!openai) throw new Error("Set OPENAI_API_KEY to start Sora video jobs.");
  const video = await openai.videos.create({ model: resolvedModel, prompt, size, seconds });
  const saved = await saveMediaOutputs(video, "videos", "openai-video");
  return { status: saved.length ? "completed" : "queued", provider: "openai", model: resolvedModel, saved, video };
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

function cryptoRandomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function routeForAction(action, provider = "openai") {
  if (action === "analyze_image") return provider === "xai" ? "xai.measurement" : "openai.measurement";
  if (action === "generate_image") return provider === "xai" ? "xai.image.generate" : "openai.image.generate";
  if (action === "edit_image") return "xai.image.edit";
  if (action === "generate_video") return provider === "xai" ? "xai.video.generate" : "openai.video.generate";
  return "internal.prompt";
}

function providerForRoute(route) {
  if (route?.startsWith("xai.")) return "xai";
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

  if (provider === "xai") {
    if (!process.env.XAI_API_KEY) {
      res.status(202).json({
        status: "ready_for_xai_key",
        message: "Set XAI_API_KEY to generate images with Grok/xAI.",
        request: { provider: "xai", model: model || xaiImageModel, quality, size, referenceCount: req.files?.length || 0 }
      });
      return;
    }

    try {
      res.json(await executeImageGenerationTool("xai", prompt, { model, quality, size }));
    } catch (error) {
      res.status(500).json({ error: error.message || "xAI image generation failed." });
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
    const image = await openai.images.generate({
      model: model || imageModel,
      prompt,
      quality,
      size,
      n: 1
    });

    const saved = await saveMediaOutputs(image, "images", "openai-generated", { provider: "openai", model: model || imageModel, status: "completed", jobType: "image_generation" });
    res.json({ status: "completed", provider: "openai", model: model || imageModel, image, saved });
  } catch (error) {
    res.status(500).json({ error: error.message || "Image generation failed." });
  }
});

app.post("/api/edit-image", upload.single("reference"), async (req, res) => {
  const { prompt, model = xaiImageModel, quality = "high", size = "auto" } = req.body || {};

  try {
    validatePrompt(prompt, "Edit prompt");
    validateImageUpload(req.file);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (!process.env.XAI_API_KEY) {
    res.status(202).json({
      status: "ready_for_xai_key",
      message: "Set XAI_API_KEY to edit images with Grok Imagine.",
      request: { provider: "xai", model, quality, size }
    });
    return;
  }

  try {
    res.json(await executeXaiImageEditTool(req.file, prompt, { model, quality, size }));
  } catch (error) {
    const status = /required|must be|detail/i.test(error.message || "") ? 400 : 500;
    res.status(status).json({ error: error.message || "xAI image edit failed." });
  }
});

app.post("/api/grok-agent-chat", upload.single("reference"), async (req, res) => {
  const { message, context = "", model = xaiMeasurementModel } = req.body || {};

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
      usage
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Grok Agent chat failed." });
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
    res.status(500).json({ error: error.message || "Grok Agent chat failed." });
  }
});
*/

app.post("/api/generate-video", upload.single("reference"), async (req, res) => {
  const openai = getOpenAI();
  const { prompt, quality = "standard", size = "1280x720", seconds = "8", provider = "openai", model } = req.body || {};
  const resolvedModel = model || (provider === "xai" ? xaiVideoModel : quality === "pro" ? "sora-2-pro" : "sora-2");

  if (!prompt) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }

  if (provider === "xai") {
    if (!process.env.XAI_API_KEY) {
      res.status(202).json({
        status: "ready_for_xai_key",
        message: "Set XAI_API_KEY to start Grok/xAI video jobs.",
        request: { provider: "xai", model: resolvedModel, size, seconds, hasReference: Boolean(req.file) }
      });
      return;
    }

    try {
      res.json(await executeVideoTool("xai", prompt, { file: req.file, model: resolvedModel, size, seconds }));
    } catch (error) {
      res.status(500).json({ error: error.message || "xAI video generation failed." });
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
    const video = await openai.videos.create({
      model: resolvedModel,
      prompt,
      size,
      seconds
    });

    const saved = await saveMediaOutputs(video, "videos", "openai-video");
    res.json({ status: saved.length ? "completed" : "queued", provider: "openai", model: resolvedModel, video, saved });
  } catch (error) {
    res.status(500).json({ error: error.message || "Video generation failed." });
  }
});

app.post("/api/generate/image", upload.array("references", 8), async (req, res) => {
  const { prompt, provider = "openai", model, quality = "auto", size = "auto" } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });
  try {
    const result = await executeImageGenerationTool(provider, prompt, { model, quality, size });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || "Image generation failed." });
  }
});

app.post("/api/edit/image", upload.single("reference"), async (req, res) => {
  const { prompt, model = xaiImageModel, quality = "high", size = "auto" } = req.body || {};
  try {
    res.json(await executeXaiImageEditTool(req.file, prompt, { model, quality, size }));
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
    res.status(500).json({
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
    res.status(500).json({ error: error.message || "Video generation failed." });
  }
});

app.post("/api/analyze/image", upload.single("reference"), async (req, res) => {
  const { provider = "openai", model } = req.body || {};
  if (!req.file) return res.status(400).json({ error: "A reference image is required for analysis." });
  try {
    res.json(await executeMeasurementTool(provider, req.file, model));
  } catch (error) {
    res.status(500).json({ error: error.message || "Image analysis failed." });
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
  res.status(500).json({ error: error.message || "Server request failed." });
});

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
  const inferredOpenAI = filename.startsWith("openai-");
  const provider = item.provider || (inferredXai ? "xai" : inferredOpenAI ? "openai" : "");
  const normalizedProvider = provider === "grok" ? "xai" : provider;
  const inferredJobType = filename.includes("xai-edited") ? "image_edit" : filename.includes("xai-generated") ? "image_generation" : filename.includes("xai-video") ? "video_generation" : "";
  const jobType = inferredJobType || item.jobType || item.type || "";
  const model = item.model || (normalizedProvider === "xai" ? modelForBillingJob(jobType) : "");
  const existing = Number(item.costUsd || item.estimatedCostUsd || 0);
  if (existing > 0) return { ...item, provider: normalizedProvider, model: model || item.model, jobType, costUsd: Number(existing.toFixed(6)), estimatedCostUsd: Number(existing.toFixed(6)) };
  if (normalizedProvider !== "xai" && normalizedProvider !== "grok") return { ...item, provider: normalizedProvider, costUsd: 0, estimatedCostUsd: 0 };
  const type = jobType.includes("measurement") ? "measurement" : jobType.includes("agent") ? "agent" : jobType.includes("video") ? "video_generation" : jobType.includes("edit") ? "image_edit" : "image_generation";
  const costUsd = calculateAccurateCost("xai", model || xaiImageModel, item.usage || {}, type);
  return { ...item, provider: "xai", model: model || xaiImageModel, jobType: type, costUsd, estimatedCostUsd: costUsd };
}

function modelForBillingJob(jobType = "") {
  if (jobType.includes("video")) return xaiVideoModel;
  if (jobType.includes("measurement")) return xaiMeasurementModel;
  if (jobType.includes("agent")) return xaiMeasurementModel;
  return xaiImageModel;
}

function buildBillingTotals(manifest = []) {
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthItems = manifest.filter((item) => !item.createdAt || String(item.createdAt).startsWith(monthKey));
  const totalSpend = sumCosts(monthItems);
  const grokSpend = sumCosts(monthItems.filter((item) => item.provider === "xai" || item.provider === "grok"));
  const openaiSpend = sumCosts(monthItems.filter((item) => item.provider === "openai"));
  return {
    totalSpend: Number(totalSpend.toFixed(6)),
    grokSpend: Number(grokSpend.toFixed(6)),
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
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.images) ? payload.images : [];
  const assets = data.flatMap((item) => {
    if (item?.url) return [{ url: item.url, extension: extensionFromUrl(item.url) }];
    if (item?.b64_json) return [{ bytes: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" }];
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
