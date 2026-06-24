import express from "express";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import multer from "multer";
import OpenAI from "openai";
import path from "node:path";
import "dotenv/config";
import { config as loadEnv, parse as parseEnv } from "dotenv";
import { buildLiveSessionConfig, GeminiOmniLiveService, normalizeLiveModality } from "./services/GeminiOmniLiveService.js";
import { GeminiOmniProvider, isGeminiOmniModel } from "./services/GeminiOmniProvider.js";
import { GeminiVideoService } from "./services/GeminiVideoService.js";

loadEnv({ path: path.join(process.cwd(), ".env.servicenow"), override: false });

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
const serviceNowSessionProfiles = new Map();
const serverStartedAt = new Date().toISOString();
const serviceNowRecordTypes = {
  incidents: {
    label: "Incidents",
    singular: "Incident",
    table: "incident",
    baseQuery: "active=true",
    searchFields: ["number", "short_description", "assigned_to", "assignment_group"],
    fields: ["sys_id", "number", "short_description", "state", "priority", "assigned_to", "assignment_group", "sys_updated_on"],
    columns: [
      ["number", "Number"],
      ["short_description", "Description"],
      ["priority", "Priority"],
      ["state", "State"],
      ["assigned_to", "Assigned to"],
      ["sys_updated_on", "Updated"]
    ]
  },
  problems: {
    label: "Problems",
    singular: "Problem",
    table: "problem",
    baseQuery: "active=true",
    searchFields: ["number", "short_description", "assigned_to", "assignment_group"],
    fields: ["sys_id", "number", "short_description", "state", "priority", "assigned_to", "assignment_group", "sys_updated_on"],
    columns: [
      ["number", "Number"],
      ["short_description", "Description"],
      ["priority", "Priority"],
      ["state", "State"],
      ["assigned_to", "Assigned to"],
      ["sys_updated_on", "Updated"]
    ]
  },
  changes: {
    label: "Changes",
    singular: "Change",
    table: "change_request",
    baseQuery: "active=true",
    searchFields: ["number", "short_description", "assigned_to", "assignment_group"],
    fields: ["sys_id", "number", "short_description", "state", "risk", "type", "assigned_to", "sys_updated_on"],
    columns: [
      ["number", "Number"],
      ["short_description", "Description"],
      ["risk", "Risk"],
      ["state", "State"],
      ["assigned_to", "Assigned to"],
      ["sys_updated_on", "Updated"]
    ]
  },
  requests: {
    label: "Requests",
    singular: "Request",
    table: "sc_request",
    baseQuery: "active=true",
    searchFields: ["number", "requested_for", "requested_by", "opened_by"],
    fields: ["sys_id", "number", "request_state", "requested_for", "requested_by", "opened_at", "sys_updated_on"],
    columns: [
      ["number", "Number"],
      ["request_state", "State"],
      ["requested_for", "Requested for"],
      ["requested_by", "Requested by"],
      ["opened_at", "Opened"],
      ["sys_updated_on", "Updated"]
    ]
  },
  cis: {
    label: "Configuration Items",
    singular: "CI",
    table: "cmdb_ci",
    baseQuery: "",
    searchFields: ["name", "asset_tag", "serial_number", "assigned_to"],
    fields: ["sys_id", "name", "sys_class_name", "operational_status", "install_status", "asset_tag", "assigned_to", "sys_updated_on"],
    columns: [
      ["name", "CI name"],
      ["sys_class_name", "Class"],
      ["operational_status", "Operational status"],
      ["install_status", "Install status"],
      ["asset_tag", "Asset tag"],
      ["sys_updated_on", "Updated"]
    ]
  },
  computers: {
    label: "Computers",
    singular: "Computer",
    table: "cmdb_ci_computer",
    baseQuery: "",
    searchFields: ["name", "asset_tag", "serial_number", "assigned_to"],
    fields: [
      "sys_id",
      "name",
      "manufacturer",
      "model_id",
      "serial_number",
      "assigned_to",
      "install_status",
      "operational_status",
      "discovery_source",
      "last_discovered",
      "sys_updated_on"
    ],
    columns: [
      ["name", "Computer"],
      ["manufacturer", "Manufacturer"],
      ["model_id", "Model"],
      ["serial_number", "Serial number"],
      ["assigned_to", "Assigned to"],
      ["last_discovered", "Last discovered"],
      ["sys_updated_on", "Updated"]
    ]
  },
  servers: {
    label: "Servers",
    singular: "Server",
    table: "cmdb_ci_server",
    baseQuery: "",
    searchFields: ["name", "ip_address", "serial_number", "assigned_to"],
    fields: ["sys_id", "name", "ip_address", "os", "os_version", "operational_status", "assigned_to", "sys_updated_on"],
    columns: [
      ["name", "Server"],
      ["ip_address", "IP address"],
      ["os", "Operating system"],
      ["os_version", "Version"],
      ["operational_status", "Status"],
      ["sys_updated_on", "Updated"]
    ]
  },
  assets: {
    label: "Assets",
    singular: "Asset",
    table: "alm_asset",
    baseQuery: "",
    searchFields: ["asset_tag", "display_name", "serial_number", "assigned_to"],
    fields: ["sys_id", "asset_tag", "display_name", "model", "install_status", "serial_number", "assigned_to", "sys_updated_on"],
    columns: [
      ["asset_tag", "Asset tag"],
      ["display_name", "Asset"],
      ["model", "Model"],
      ["install_status", "Status"],
      ["assigned_to", "Assigned to"],
      ["sys_updated_on", "Updated"]
    ]
  },
  hardware_assets: {
    label: "Hardware assets",
    singular: "Hardware asset",
    table: "alm_hardware",
    baseQuery: "",
    searchFields: ["asset_tag", "display_name", "serial_number", "assigned_to", "model", "install_status"],
    fields: [
      "sys_id",
      "asset_tag",
      "display_name",
      "model",
      "manufacturer",
      "serial_number",
      "assigned_to",
      "install_status",
      "substatus",
      "warranty_status",
      "warranty_expiration",
      "warranty_start_date",
      "purchase_date",
      "last_discovered",
      "sys_updated_on"
    ],
    columns: [
      ["asset_tag", "Asset tag"],
      ["display_name", "Asset"],
      ["manufacturer", "Manufacturer"],
      ["warranty_status", "Warranty status"],
      ["warranty_expiration", "Warranty expires"],
      ["assigned_to", "Assigned to"]
    ]
  }
};
const serviceNowArtifactTypes = {
  business_rule: {
    label: "Business Rules",
    table: "sys_script",
    tableField: "collection",
    fields: ["sys_id", "name", "collection", "active", "when", "order", "insert", "update", "delete", "query", "filter_condition", "description", "script", "sys_scope", "sys_updated_on", "sys_updated_by"],
    createFields: ["active", "when", "order", "insert", "update", "delete", "query", "filter_condition"],
    defaults: { active: true, when: "before", order: 100, insert: false, update: true, delete: false, query: false, filter_condition: "" }
  },
  client_script: {
    label: "Client Scripts",
    table: "sys_script_client",
    tableField: "table",
    fields: ["sys_id", "name", "table", "active", "type", "field", "isolate_script", "global", "description", "script", "sys_scope", "sys_updated_on", "sys_updated_by"],
    createFields: ["active", "type", "field", "isolate_script", "global"],
    defaults: { active: true, type: "onLoad", field: "", isolate_script: true, global: false }
  },
  script_include: {
    label: "Script Includes",
    table: "sys_script_include",
    tableField: "api_name",
    fields: ["sys_id", "name", "api_name", "active", "client_callable", "access", "description", "script", "sys_scope", "sys_updated_on", "sys_updated_by"],
    createFields: ["active", "client_callable", "access"],
    defaults: { active: true, client_callable: false, access: "package_private" }
  },
  ui_action: {
    label: "UI Actions",
    table: "sys_ui_action",
    tableField: "table",
    fields: ["sys_id", "name", "table", "active", "action_name", "order", "client", "form_action", "list_action", "show_insert", "show_update", "condition", "comments", "script", "sys_scope", "sys_updated_on", "sys_updated_by"],
    descriptionField: "comments",
    createFields: ["active", "action_name", "order", "client", "form_action", "list_action", "show_insert", "show_update", "condition"],
    defaults: { active: true, action_name: "", order: 100, client: false, form_action: true, list_action: false, show_insert: true, show_update: true, condition: "" }
  },
  fix_script: {
    label: "Fix Scripts",
    table: "sys_script_fix",
    tableField: "",
    fields: ["sys_id", "name", "active", "unloadable", "before", "description", "script", "sys_scope", "sys_updated_on", "sys_updated_by"],
    createFields: ["active", "unloadable", "before"],
    defaults: { active: true, unloadable: false, before: false }
  }
};

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

app.get("/api/servicenow/instances", async (_req, res) => {
  try {
    const registry = await readServiceNowInstanceRegistry();
    const instances = await Promise.all(registry.instances.map(async (profile) => {
      const configuration = await readServiceNowProfile(profile);
      return publicServiceNowProfile(profile, configuration);
    }));
    res.json({
      defaultInstance: registry.defaultInstance,
      instances
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unable to load ServiceNow instance profiles." });
  }
});

app.post("/api/servicenow/instances/:instanceId/session", async (req, res) => {
  const { url = "", username = "", password = "" } = req.body || {};
  try {
    const registry = await readServiceNowInstanceRegistry();
    const profile = resolveServiceNowProfile(registry, req.params.instanceId);
    if (profile.id !== "work") {
      throw new Error("Session credentials are only supported for the Work instance profile.");
    }

    const instanceUrl = validateServiceNowInstanceUrl(url);
    if (!String(username).trim() || !String(password)) {
      throw new Error("ServiceNow username and password are required.");
    }

    const configuration = {
      SERVICENOW_INSTANCE_URL: instanceUrl,
      SERVICENOW_AUTH_TYPE: "basic",
      SERVICENOW_USERNAME: String(username).trim(),
      SERVICENOW_PASSWORD: String(password),
      _CONNECTED_AT: new Date().toISOString()
    };
    await validateServiceNowConnection(configuration);
    serviceNowSessionProfiles.set(profile.id, configuration);

    res.json({
      status: "connected",
      instance: publicServiceNowProfile(profile, configuration, "session")
    });
  } catch (error) {
    res.status(400).json({
      error: error.message || "Unable to connect to the ServiceNow Work instance."
    });
  }
});

app.delete("/api/servicenow/instances/:instanceId/session", async (req, res) => {
  serviceNowSessionProfiles.delete(req.params.instanceId);
  res.json({ status: "disconnected", instanceId: req.params.instanceId });
});

app.get("/api/servicenow/incidents", async (req, res) => {
  try {
    const registry = await readServiceNowInstanceRegistry();
    const profile = resolveServiceNowProfile(registry, req.query.instance);
    const configuration = await readServiceNowProfile(profile);
    assertServiceNowProfileConfigured(profile, configuration);

    const instanceUrl = String(configuration.SERVICENOW_INSTANCE_URL).replace(/\/$/, "");
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);
    const activeOnly = String(req.query.active || "true") !== "false";
    const query = activeOnly ? "active=true^ORDERBYDESCsys_updated_on" : "ORDERBYDESCsys_updated_on";
    const fields = [
      "sys_id",
      "number",
      "short_description",
      "state",
      "priority",
      "assignment_group",
      "assigned_to",
      "caller_id",
      "opened_at",
      "sys_updated_on"
    ].join(",");
    const url = new URL(`${instanceUrl}/api/now/table/incident`);
    url.searchParams.set("sysparm_query", query);
    url.searchParams.set("sysparm_fields", fields);
    url.searchParams.set("sysparm_display_value", "true");
    url.searchParams.set("sysparm_exclude_reference_link", "true");
    url.searchParams.set("sysparm_limit", String(limit));

    const authorization = await getServiceNowAuthorization(configuration);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: authorization
      }
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`ServiceNow returned ${response.status}: ${detail.slice(0, 180)}`);
    }

    const payload = await response.json();
    const incidents = (payload.result || []).map((record) => normalizeServiceNowIncident(record, instanceUrl));
    res.json({
      status: "connected",
      instanceId: profile.id,
      instanceName: profile.name,
      environment: profile.environment,
      instance: new URL(instanceUrl).hostname,
      activeOnly,
      generatedAt: new Date().toISOString(),
      summary: summarizeIncidents(incidents),
      incidents
    });
  } catch (error) {
    res.status(502).json({
      error: error.message || "Unable to retrieve ServiceNow incidents."
    });
  }
});

app.get("/api/servicenow/overview", async (req, res) => {
  try {
    const registry = await readServiceNowInstanceRegistry();
    const profile = resolveServiceNowProfile(registry, req.query.instance);
    const configuration = await readServiceNowProfile(profile);
    assertServiceNowProfileConfigured(profile, configuration);

    const instanceUrl = String(configuration.SERVICENOW_INSTANCE_URL).replace(/\/$/, "");
    const authorization = await getServiceNowAuthorization(configuration);
    const connection = await getServiceNowConnectionIdentity(
      profile,
      configuration,
      instanceUrl,
      authorization
    );
    const computerDuplicateScan = await scanServiceNowDuplicateDataset(
      { instanceUrl, authorization },
      "computers",
      serviceNowDedupDefinitions.computers
    );
    const definitions = {
      activeIncidents: ["incident", "active=true"],
      criticalIncidents: ["incident", "active=true^priority=1"],
      unassignedIncidents: ["incident", "active=true^assigned_toISEMPTY"],
      activeChangeTasks: ["change_task", "active=true"],
      approvedChanges: ["change_request", "state=approved"],
      approvedChangeApprovals: ["sysapproval_approver", "state=approved^sysapproval.sys_class_name=change_request"],
      activeRequests: ["sc_request", "active=true"],
      approvedRequestApprovals: ["sysapproval_approver", "state=approved^sysapproval.sys_class_name=sc_req_item"],
      activeChanges: ["change_request", "active=true"],
      activeProblems: ["problem", "active=true"],
      totalCis: ["cmdb_ci", ""],
      computers: ["cmdb_ci_computer", ""],
      servers: ["cmdb_ci_server", ""],
      applications: ["cmdb_ci_appl", ""],
      services: ["cmdb_ci_service", ""],
      databases: ["cmdb_ci_database", ""],
      relationshipCount: ["cmdb_rel_ci", ""],
      duplicateRelationships: ["cmdb_rel_ci", "duplicate=true"],
      orphanRelationships: ["cmdb_rel_ci", "parentISEMPTY^ORchildISEMPTY"],
      staleRelationships: ["cmdb_rel_ci", "sys_updated_onRELATIVELE@dayofweek@ago@30"],
      certifiedCis: ["cmdb_ci", "certified=true"],
      uncertifiedCis: ["cmdb_ci", "certified=false"],
      totalAssets: ["alm_asset", ""],
      hardwareAssets: ["alm_hardware", ""],
      deployedAssets: ["alm_asset", "install_status=1"],
      stockAssets: ["alm_asset", "install_status=6"]
    };
    const entries = await Promise.all(Object.entries(definitions).map(async ([key, definition]) => {
      try {
        const count = await getServiceNowTableCount(
          instanceUrl,
          authorization,
          definition[0],
          definition[1]
        );
        return [key, { value: count, available: true }];
      } catch (error) {
        return [key, { value: null, available: false, reason: compactServiceNowError(error) }];
      }
    }));
    const metrics = Object.fromEntries(entries);

    res.json({
      status: "connected",
      generatedAt: new Date().toISOString(),
      connection,
      itsm: {
        incidents: metrics.activeIncidents,
        critical: metrics.criticalIncidents,
        unassigned: metrics.unassignedIncidents,
        approvedChanges: metrics.approvedChanges,
        changeApprovals: metrics.approvedChangeApprovals,
        changeTasks: metrics.activeChangeTasks,
        requests: metrics.activeRequests,
        requestApprovals: metrics.approvedRequestApprovals,
        changes: metrics.activeChanges,
        problems: metrics.activeProblems
      },
      cmdb: {
        total: metrics.totalCis,
        computers: metrics.computers,
        servers: metrics.servers,
        applications: metrics.applications,
        services: metrics.services,
        databases: metrics.databases,
        relationships: metrics.relationshipCount,
        relationshipHealth: {
          duplicate: metrics.duplicateRelationships,
          orphan: metrics.orphanRelationships,
          stale: metrics.staleRelationships
        },
        certification: {
          certified: metrics.certifiedCis,
          uncertified: metrics.uncertifiedCis
        }
      },
      assets: {
        total: metrics.totalAssets,
        hardware: metrics.hardwareAssets,
        deployed: metrics.deployedAssets,
        stock: metrics.stockAssets
      },
      governance: {
        duplicateHotspots: computerDuplicateScan.duplicateRecords,
        duplicateHotspotTable: computerDuplicateScan.table,
        duplicateHotspotLabel: computerDuplicateScan.label,
        duplicateHotspotExact: computerDuplicateScan.exactDuplicateRecords,
        duplicateHotspotRate: computerDuplicateScan.duplicatePercent
      }
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to load ServiceNow overview." });
  }
});

app.get("/api/servicenow/csdm", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const definitions = {
      companies: ["core_company", ""],
      locations: ["cmn_location", ""],
      costCenters: ["cmn_cost_center", ""],
      businessApplications: ["cmdb_ci_business_app", ""],
      applicationServices: ["cmdb_ci_service_auto", ""],
      businessServices: ["cmdb_ci_service_business", ""],
      technicalServices: ["cmdb_ci_service_technical", ""],
      serviceOfferings: ["service_offering", ""],
      relationships: ["cmdb_rel_ci", ""],
      samDiscoveryModels: ["cmdb_sam_sw_discovery_model", ""],
      samNormalized: ["cmdb_sam_sw_discovery_model", "statusINnormalized,manually normalized"],
      samPartial: ["cmdb_sam_sw_discovery_model", "statusINpartially normalized,publisher normalized"],
      samAttention: ["cmdb_sam_sw_discovery_model", "statusINnew,missed"],
      hamModels: ["cmdb_hardware_product_model", ""],
      hamReady: ["cmdb_hardware_product_model", "manufacturerISNOTEMPTY^model_numberISNOTEMPTY"],
      hamAttention: ["cmdb_hardware_product_model", "manufacturerISEMPTY^ORmodel_numberISEMPTY"]
    };
    const entries = await Promise.all(Object.entries(definitions).map(async ([key, [table, query]]) => {
      try {
        return [key, {
          value: await getServiceNowTableCount(context.instanceUrl, context.authorization, table, query),
          available: true,
          table
        }];
      } catch (error) {
        return [key, {
          value: null,
          available: false,
          table,
          reason: compactServiceNowError(error)
        }];
      }
    }));
    const metrics = Object.fromEntries(entries);
    const samTotal = metrics.samDiscoveryModels.value || 0;
    const hamTotal = metrics.hamModels.value || 0;

    res.json({
      status: "connected",
      generatedAt: new Date().toISOString(),
      framework: {
        version: "CSDM 4.0+",
        foundation: {
          companies: metrics.companies,
          locations: metrics.locations,
          costCenters: metrics.costCenters
        },
        domains: {
          businessApplications: metrics.businessApplications,
          applicationServices: metrics.applicationServices,
          businessServices: metrics.businessServices,
          technicalServices: metrics.technicalServices,
          serviceOfferings: metrics.serviceOfferings,
          relationships: metrics.relationships
        }
      },
      normalization: {
        sam: {
          total: metrics.samDiscoveryModels,
          normalized: metrics.samNormalized,
          partial: metrics.samPartial,
          attention: metrics.samAttention,
          normalizedPercent: samTotal ? Math.round(((metrics.samNormalized.value || 0) / samTotal) * 100) : 0,
          source: "Software Discovery Model normalization status"
        },
        ham: {
          total: metrics.hamModels,
          ready: metrics.hamReady,
          attention: metrics.hamAttention,
          readyPercent: hamTotal ? Math.round(((metrics.hamReady.value || 0) / hamTotal) * 100) : 0,
          source: "Hardware model manufacturer and model-number readiness",
          note: "Hardware Content Service normalization fields are not exposed by this PDI."
        }
      }
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to load CSDM and normalization data." });
  }
});

app.get("/api/servicenow/stats", async (req, res) => {
  try {
    const registry = await readServiceNowInstanceRegistry();
    const profile = resolveServiceNowProfile(registry, req.query.instance);
    const configuration = await readServiceNowProfile(profile);
    assertServiceNowProfileConfigured(profile, configuration);
    const instanceUrl = String(configuration.SERVICENOW_INSTANCE_URL).replace(/\/$/, "");
    const authorization = await getServiceNowAuthorization(configuration);
    res.json(await getServiceNowInstanceStats({ instanceUrl, authorization, instanceName: profile.name }));
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to load ServiceNow instance statistics." });
  }
});

app.post("/api/servicenow/data-movements/plan", async (req, res) => {
  try {
    const {
      sourceUrl,
      sourceUser,
      sourcePassword,
      targetUrl,
      targetUser,
      targetPassword,
      table
    } = req.body || {};
    if (!sourceUrl || !targetUrl || !table) throw new Error("Source URL, target URL, and table are required.");
    const source = await inspectTableSchema(sourceUrl, sourceUser, sourcePassword, table);
    const target = await inspectTableSchema(targetUrl, targetUser, targetPassword, table);
    const fieldMatrix = buildFieldMatrix(source.fields, target.fields);
    res.json({
      status: "planned",
      table,
      source: { url: normalizeUrl(sourceUrl), count: source.count, fields: source.fields.length },
      target: { url: normalizeUrl(targetUrl), count: target.count, fields: target.fields.length },
      fieldMatrix,
      recommendation: summarizeMovementPlan(fieldMatrix),
      irePayloadPreview: buildIrePreview(table, fieldMatrix, source, target)
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to plan data movement." });
  }
});

app.post("/api/servicenow/data-movements/run", async (req, res) => {
  try {
    const { plannedRecords = 0, table, sourceUrl, sourceUser, sourcePassword, targetUrl, targetUser, targetPassword, fieldMatrix, ireEndpointPath } = req.body || {};
    if (!table || !sourceUrl || !targetUrl) throw new Error("Table, source URL, and target URL are required.");
    const sourceContext = {
      instanceUrl: normalizeUrl(sourceUrl),
      authorization: `Basic ${Buffer.from(`${sourceUser || ""}:${sourcePassword || ""}`).toString("base64")}`
    };
    const targetContext = {
      instanceUrl: normalizeUrl(targetUrl),
      authorization: `Basic ${Buffer.from(`${targetUser || ""}:${targetPassword || ""}`).toString("base64")}`
    };
    const sourceFieldNames = Array.from(new Set([...(fieldMatrix?.mappings || []).map((field) => field.source), ...(fieldMatrix?.mappings || []).map((field) => field.target), "sys_id", "sys_updated_on", "name", "serial_number", "model_id", "manufacturer", "fqdn", "host_name", "ip_address", "asset_tag", "os", "os_version", "install_status", "display_name", "user_name", "code"])).filter(Boolean);
    const sourceTotal = await getServiceNowTableCount(sourceContext.instanceUrl, sourceContext.authorization, table, "");
    const sourceLimit = String(plannedRecords).toLowerCase() === "all"
      ? Math.max(1, sourceTotal || 100)
      : Math.max(1, Number(plannedRecords || 100));
    const sourceRows = await fetchServiceNowRows(sourceContext.instanceUrl, sourceContext.authorization, table, sourceFieldNames, sourceLimit);
    if (!sourceRows.available) throw new Error(sourceRows.reason || "Unable to read source records.");
    const count = sourceTotal || sourceRows.total || (sourceRows.records || []).length || 0;
    const target = await inspectTableSchema(targetContext.instanceUrl, targetUser || "", targetPassword || "", table).catch(() => ({ fields: [] }));
    const sourceName = /kkr/i.test(sourceUrl) ? "KKR_DEV" : /ga/i.test(sourceUrl) ? "GA" : /pdi/i.test(sourceUrl) ? "PDI" : "SOURCE";
    const endpointPath = ireEndpointPath || "/api/now/identifyreconcile";
    const previewPath = `${endpointPath.replace(/\/$/, "")}/query`;
    const discoverySources = await getValidDiscoverySources(targetContext).catch(() => []);
    const requestedDiscoverySource = String(req.body?.discoverySource || sourceName || "").trim();
    const fallbackDiscoverySource = [requestedDiscoverySource, "ImportSet", "Manual via IRE", discoverySources[0]].find((value) => value && discoverySources.includes(value)) || "Manual via IRE";
    const appliedDiscoverySource = discoverySources.includes(requestedDiscoverySource) ? requestedDiscoverySource : fallbackDiscoverySource;
    const discoverySourceValidation = {
      requested: requestedDiscoverySource,
      applied: appliedDiscoverySource,
      allowed: discoverySources,
      usedFallback: appliedDiscoverySource !== requestedDiscoverySource,
      note: appliedDiscoverySource !== requestedDiscoverySource
        ? `Using fallback discovery_source "${appliedDiscoverySource}" because "${requestedDiscoverySource}" is not valid on the target CMDB.`
        : `Using discovery_source "${appliedDiscoverySource}".`
    };
    const readinessProbe = await buildIreReadinessProbe(targetContext, table, sourceRows.records || [], appliedDiscoverySource).catch((error) => ({ ok: false, status: 0, preview: error.message || "unreachable" }));
    const readiness = readinessProbe;
    if (!readiness.ok) throw new Error(`IRE endpoint not ready at ${previewPath} (${readiness.status}). ${readiness.preview}`);
    const verification = {
      sourceTable: table,
      sourceInstance: sourceContext.instanceUrl,
      detectedCount: count,
      fetchedCount: (sourceRows.records || []).length,
      verified: Number(count) === Number((sourceRows.records || []).length),
      note: Number(count) === Number((sourceRows.records || []).length)
        ? "Source count verified before transfer."
        : "Source count differs from fetched batch size; all available rows will still be transferred."
    };
    const transfer = await runIreRestTransfer(
      targetContext,
      endpointPath,
      table,
      appliedDiscoverySource,
      sourceRows.records || [],
      fieldMatrix || { mappings: [] },
      target.fields || [],
      (event) => writeEvent(event.event, event)
    );
    const transferMode = isCmdbIreTable(table) ? "IRE" : "Table API";
    const firstBlockedReason = transfer.results.find((item) => item.status === "blocked")?.reason || "";
    const sampleReasons = [...new Set(transfer.results.map((item) => item.reason).filter(Boolean))].slice(0, 3);
    const samplePayloadPreview = transfer.results.find((item) => item.payload)?.payload || transfer.results.find((item) => item.input_payload)?.input_payload || null;
    const progress = [20, 40, 60, 80, 100].map((percent, index) => ({
      step: index + 1,
      percent,
      label: index < 4 ? `IRE batch ${index + 1}` : "IRE commit complete"
    }));
    res.json({
      status: "transferred",
      table,
      sourceUrl: sourceContext.instanceUrl,
      targetUrl: targetContext.instanceUrl,
      ireEndpointPath: endpointPath,
      readiness,
      transferMode,
      totalRecords: count,
      transferredRecords: transfer.processed,
      insertedRecords: transfer.inserted,
      updatedRecords: transfer.updated,
      blockedRecords: transfer.blocked,
      verifiedRecords: transfer.verifiedRecords || [],
      firstBlockedReason,
      sampleReasons,
      samplePayloadPreview,
      discoverySourceValidation,
      verification,
      progress,
      results: transfer.results,
      message: transferMode === "IRE"
        ? `Transferred ${transfer.processed} records through the PDI IRE endpoint.`
        : `Transferred ${transfer.processed} records through the Table API endpoint.`
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to run data movement." });
  }
});

app.post("/api/servicenow/data-movements/run-stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  const writeEvent = (event, data = {}) => {
    res.write(`${JSON.stringify({ event, ...data })}\n`);
  };
  try {
    const { plannedRecords = 0, table, sourceUrl, sourceUser, sourcePassword, targetUrl, targetUser, targetPassword, fieldMatrix, ireEndpointPath } = req.body || {};
    if (!table || !sourceUrl || !targetUrl) throw new Error("Table, source URL, and target URL are required.");
    writeEvent("stage", { key: "identify", label: "Destination instance Table API called", detail: "Reading source and target table schema." });
    const sourceContext = {
      instanceUrl: normalizeUrl(sourceUrl),
      authorization: `Basic ${Buffer.from(`${sourceUser || ""}:${sourcePassword || ""}`).toString("base64")}`
    };
    const targetContext = {
      instanceUrl: normalizeUrl(targetUrl),
      authorization: `Basic ${Buffer.from(`${targetUser || ""}:${targetPassword || ""}`).toString("base64")}`
    };
    const sourceFieldNames = Array.from(new Set([...(fieldMatrix?.mappings || []).map((field) => field.source), ...(fieldMatrix?.mappings || []).map((field) => field.target), "sys_id", "sys_updated_on", "name", "serial_number", "model_id", "manufacturer", "fqdn", "host_name", "ip_address", "asset_tag", "os", "os_version", "install_status", "display_name", "user_name", "code"])).filter(Boolean);
    const sourceTotal = await getServiceNowTableCount(sourceContext.instanceUrl, sourceContext.authorization, table, "");
    const requestedLimit = String(plannedRecords).toLowerCase() === "all"
      ? Math.max(1, sourceTotal || 100)
      : Math.min(10, Math.max(1, Number(plannedRecords || 10)));
    const sourceRows = await fetchServiceNowRows(sourceContext.instanceUrl, sourceContext.authorization, table, sourceFieldNames, requestedLimit);
    if (!sourceRows.available) throw new Error(sourceRows.reason || "Unable to read source records.");
    const count = sourceTotal || sourceRows.total || (sourceRows.records || []).length || 0;
    writeEvent("stage", { key: "mapping", label: "Data field mapping in progress", detail: `${(fieldMatrix?.mappings || []).length || 0} fields mapped from source to target.` });
    const target = await inspectTableSchema(targetContext.instanceUrl, targetUser || "", targetPassword || "", table).catch(() => ({ fields: [] }));
    const sourceName = /kkr/i.test(sourceUrl) ? "KKR_DEV" : /ga/i.test(sourceUrl) ? "GA" : /pdi/i.test(sourceUrl) ? "PDI" : "SOURCE";
    const endpointPath = ireEndpointPath || "/api/now/identifyreconcile";
    const previewPath = `${endpointPath.replace(/\/$/, "")}/query`;
    const discoverySources = await getValidDiscoverySources(targetContext).catch(() => []);
    const requestedDiscoverySource = String(req.body?.discoverySource || sourceName || "").trim();
    const fallbackDiscoverySource = [requestedDiscoverySource, "ImportSet", "Manual via IRE", discoverySources[0]].find((value) => value && discoverySources.includes(value)) || "Manual via IRE";
    const appliedDiscoverySource = discoverySources.includes(requestedDiscoverySource) ? requestedDiscoverySource : fallbackDiscoverySource;
    const readinessProbe = await buildIreReadinessProbe(targetContext, table, sourceRows.records || [], appliedDiscoverySource).catch((error) => ({ ok: false, status: 0, preview: error.message || "unreachable" }));
    if (!readinessProbe.ok) throw new Error(`IRE endpoint not ready at ${previewPath} (${readinessProbe.status}). ${readinessProbe.preview}`);
    writeEvent("stage", { key: "movement", label: "Data movement in progress", detail: `Streaming up to ${requestedLimit} records into ${isCmdbIreTable(table) ? "IRE" : "Table API"} mode.` });
    const transfer = await runIreRestTransfer(
      targetContext,
      endpointPath,
      table,
      appliedDiscoverySource,
      sourceRows.records || [],
      fieldMatrix || { mappings: [] },
      target.fields || [],
      (event) => writeEvent(event.event, event)
    );
    writeEvent("stage", { key: "ire", label: "IRE response received", detail: `${transfer.processed} processed, ${transfer.blocked} blocked.` });
    writeEvent("stage", { key: "complete", label: "Data moved confirmation", detail: `Transfer finished with ${transfer.processed} processed records.` });
    const firstBlockedReason = transfer.results.find((item) => item.status === "blocked")?.reason || "";
    const sampleReasons = [...new Set(transfer.results.map((item) => item.reason).filter(Boolean))].slice(0, 3);
    const samplePayloadPreview = transfer.results.find((item) => item.payload)?.payload || transfer.results.find((item) => item.input_payload)?.input_payload || null;
    res.end(`${JSON.stringify({
      event: "complete",
      status: "transferred",
      table,
      sourceUrl: sourceContext.instanceUrl,
      targetUrl: targetContext.instanceUrl,
      ireEndpointPath: endpointPath,
      readiness: readinessProbe,
      transferMode: isCmdbIreTable(table) ? "IRE" : "Table API",
      totalRecords: requestedLimit,
      transferredRecords: transfer.processed,
      insertedRecords: transfer.inserted,
      updatedRecords: transfer.updated,
      blockedRecords: transfer.blocked,
      verifiedRecords: transfer.verifiedRecords || [],
      firstBlockedReason,
      sampleReasons,
      samplePayloadPreview,
      discoverySourceValidation: {
        requested: requestedDiscoverySource,
        applied: appliedDiscoverySource,
        allowed: discoverySources,
        usedFallback: appliedDiscoverySource !== requestedDiscoverySource,
        note: appliedDiscoverySource !== requestedDiscoverySource
          ? `Using fallback discovery_source "${appliedDiscoverySource}" because "${requestedDiscoverySource}" is not valid on the target CMDB.`
          : `Using discovery_source "${appliedDiscoverySource}".`
      },
      verification: {
        sourceTable: table,
        sourceInstance: sourceContext.instanceUrl,
        detectedCount: count,
        fetchedCount: (sourceRows.records || []).length,
        verified: Number(count) === Number((sourceRows.records || []).length),
        note: Number(count) === Number((sourceRows.records || []).length)
          ? "Source count verified before transfer."
          : "Source count differs from fetched batch size; all available rows will still be transferred."
      },
      progress: [20, 40, 60, 80, 100].map((percent, index) => ({
        step: index + 1,
        percent,
        label: index < 4 ? `Batch ${index + 1}` : "Commit complete"
      })),
      results: transfer.results,
      message: isCmdbIreTable(table)
        ? `Transferred ${transfer.processed} records through the PDI IRE endpoint.`
        : `Transferred ${transfer.processed} records through the Table API endpoint.`
    })}\n`);
  } catch (error) {
    writeEvent("error", { error: error.message || "Unable to run data movement." });
    res.end();
  }
});

const serviceNowDedupDefinitions = {
  computers: {
    label: "Computers",
    table: "cmdb_ci_computer",
    displayField: "name",
    keyRules: [{ label: "Serial number", fields: ["serial_number"], baseConfidence: 96 }],
    comparisonFields: ["name", "serial_number", "manufacturer", "model_id", "asset", "install_status", "operational_status"],
    fields: ["sys_id", "name", "serial_number", "manufacturer", "model_id", "asset", "install_status", "operational_status", "sys_created_on", "sys_updated_on"]
  },
  servers: {
    label: "Servers",
    table: "cmdb_ci_server",
    displayField: "name",
    keyRules: [{ label: "Serial number", fields: ["serial_number"], baseConfidence: 96 }],
    comparisonFields: ["name", "serial_number", "manufacturer", "model_id", "asset", "install_status", "operational_status"],
    fields: ["sys_id", "name", "serial_number", "manufacturer", "model_id", "asset", "install_status", "operational_status", "sys_created_on", "sys_updated_on"]
  },
  ham: {
    label: "HAM Pro hardware models",
    table: "cmdb_hardware_product_model",
    displayField: "name",
    keyRules: [{ label: "Manufacturer + model number", fields: ["manufacturer", "model_number"], baseConfidence: 97 }],
    comparisonFields: ["name", "manufacturer", "model_number", "status", "cmdb_model_category"],
    fields: ["sys_id", "name", "manufacturer", "model_number", "status", "cmdb_model_category", "sys_created_on", "sys_updated_on"]
  },
  sam: {
    label: "SAM Pro discovery models",
    table: "cmdb_sam_sw_discovery_model",
    displayField: "display_name",
    keyRules: [{ label: "Publisher + product + version", fields: ["publisher", "display_name", "version"], baseConfidence: 97 }],
    comparisonFields: ["display_name", "publisher", "version", "edition", "platform", "status", "model"],
    fields: ["sys_id", "display_name", "publisher", "version", "edition", "platform", "status", "model", "sys_created_on", "sys_updated_on"]
  },
  companies: {
    label: "Companies",
    table: "core_company",
    displayField: "name",
    keyRules: [{ label: "Company name", fields: ["name"], baseConfidence: 92 }],
    comparisonFields: ["name", "street", "city", "state", "country", "phone", "website", "vendor", "manufacturer"],
    fields: ["sys_id", "name", "street", "city", "state", "country", "phone", "website", "vendor", "manufacturer", "sys_created_on", "sys_updated_on"]
  },
  locations: {
    label: "Locations",
    table: "cmn_location",
    displayField: "name",
    keyRules: [{ label: "Name + street + city", fields: ["name", "street", "city"], baseConfidence: 96 }],
    comparisonFields: ["name", "street", "city", "state", "country", "zip", "company", "parent"],
    fields: ["sys_id", "name", "street", "city", "state", "country", "zip", "company", "parent", "sys_created_on", "sys_updated_on"]
  },
  costCenters: {
    label: "Cost centers",
    table: "cmn_cost_center",
    displayField: "name",
    keyRules: [{ label: "Cost-center code", fields: ["code"], baseConfidence: 98 }],
    comparisonFields: ["name", "code", "company", "manager", "account_number", "valid_from", "valid_to"],
    fields: ["sys_id", "name", "code", "company", "manager", "account_number", "valid_from", "valid_to", "sys_created_on", "sys_updated_on"]
  },
  users: {
    label: "Users",
    table: "sys_user",
    displayField: "name",
    keyRules: [
      { label: "User name", fields: ["user_name"], baseConfidence: 98 },
      { label: "Email address", fields: ["email"], baseConfidence: 93 }
    ],
    comparisonFields: ["name", "user_name", "email", "active", "company", "department", "manager", "employee_number"],
    fields: ["sys_id", "name", "user_name", "email", "active", "company", "department", "manager", "employee_number", "sys_created_on", "sys_updated_on"]
  }
};

app.get("/api/servicenow/governance", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const [usersResult, rolesResult, subscriptionsResult, unlicensedResult] = await Promise.all([
      getServiceNowRecordsWithValues(context, {
        table: "sys_user",
        query: "active=true^ORDERBYname",
        fields: ["sys_id", "name", "user_name", "email", "title", "department", "company", "last_login_time"],
        limit: 2000
      }),
      getServiceNowRecordsWithValues(context, {
        table: "sys_user_has_role",
        query: "user.active=true",
        fields: ["sys_id", "user", "role", "inherited"],
        limit: 10000
      }),
      getServiceNowRecordsWithValues(context, {
        table: "license_details",
        query: "ORDERBYname",
        fields: ["sys_id", "name", "license_id", "license_type", "meter_type", "count", "allocated", "allocated_status", "product_cost", "is_capped"],
        limit: 500
      }),
      getServiceNowRecordsWithValues(context, {
        table: "sys_user_unlicensed",
        query: "",
        fields: ["sys_id", "user", "license", "reason"],
        limit: 2000
      })
    ]);
    const roleAssignments = rolesResult.records;
    const licensedUsers = new Set(roleAssignments.map((record) => rawValue(record.user)).filter(Boolean));
    const roleMap = new Map();
    for (const assignment of roleAssignments) {
      const role = displayValue(assignment.role) || "Unknown role";
      roleMap.set(role, (roleMap.get(role) || 0) + 1);
    }
    const subscriptions = subscriptionsResult.records.map((record) => ({
      sysId: rawValue(record.sys_id),
      name: displayValue(record.name) || displayValue(record.license_id) || "ServiceNow subscription",
      purchased: numberValue(record.count),
      allocated: numberValue(record.allocated),
      meterType: displayValue(record.meter_type),
      licenseType: displayValue(record.license_type),
      costType: displayValue(record.product_cost),
      capped: booleanValue(record.is_capped)
    }));

    res.json({
      status: "connected",
      generatedAt: new Date().toISOString(),
      users: {
        active: metricFromRecords(usersResult),
        withRoles: availableMetric(rolesResult.available, licensedUsers.size, rolesResult.reason),
        roleAssignments: metricFromRecords(rolesResult),
        averageRoles: licensedUsers.size ? Number((roleAssignments.length / licensedUsers.size).toFixed(1)) : 0,
        topRoles: [...roleMap.entries()]
          .map(([role, count]) => ({ role, count }))
          .sort((left, right) => right.count - left.count)
          .slice(0, 6)
      },
      licensing: {
        subscriptionsAvailable: subscriptions.length > 0,
        subscriptions,
        purchased: subscriptions.reduce((sum, item) => sum + item.purchased, 0),
        allocated: subscriptions.reduce((sum, item) => sum + item.allocated, 0),
        unlicensedUsers: metricFromRecords(unlicensedResult),
        contractCostAvailable: false,
        contractCost: null,
        message: subscriptions.length
          ? "Subscription consumption is available. Contract pricing is not stored in the instance tables exposed to this application."
          : "No ServiceNow subscription records are populated in this instance. Contract invoices and negotiated pricing are not available from the PDI.",
        pricingSource: "ServiceNow contract, order form, or Subscription Management financial integration"
      }
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to load governance data." });
  }
});

app.get("/api/servicenow/dedup/scan", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const type = String(req.query.type || "computers");
    const definition = serviceNowDedupDefinitions[type];
    if (!definition) throw new Error(`Unsupported duplicate dataset: ${type}`);
    res.json(await scanServiceNowDuplicateDataset(context, type, definition));
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to scan for duplicate records." });
  }
});

app.post("/api/servicenow/dedup/execute", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.body?.instance);
    const type = String(req.body?.type || "");
    const definition = serviceNowDedupDefinitions[type];
    if (!definition) throw new Error(`Unsupported duplicate dataset: ${type}`);
    const scan = await scanServiceNowDuplicateDataset(context, type, definition);
    const group = scan.groups.find((item) => item.id === req.body?.groupId);
    if (!group) throw new Error("The duplicate group changed or is no longer available. Run the scan again.");
    if (!group.exact || group.confidence !== 100) {
      throw new Error("Deletion is restricted to groups with a verified 100% field match.");
    }
    const keepSysId = String(req.body?.keepSysId || "");
    const deleteSysIds = [...new Set((req.body?.deleteSysIds || []).map(String))];
    const groupIds = new Set(group.records.map((record) => record.sysId));
    if (!groupIds.has(keepSysId) || !deleteSysIds.length || deleteSysIds.includes(keepSysId)) {
      throw new Error("A valid retained record and at least one duplicate record are required.");
    }
    if (deleteSysIds.some((sysId) => !groupIds.has(sysId))) {
      throw new Error("One or more selected records are not part of the verified duplicate group.");
    }
    const confirmation = `DELETE ${deleteSysIds.length} DUPLICATES`;
    if (req.body?.confirmation !== confirmation || req.body?.acknowledgeReferences !== true) {
      throw new Error(`Type "${confirmation}" and acknowledge reference impact before running deletion.`);
    }

    const deleted = [];
    for (const sysId of deleteSysIds) {
      const url = `${context.instanceUrl}/api/now/table/${definition.table}/${encodeURIComponent(sysId)}`;
      const response = await fetch(url, {
        method: "DELETE",
        headers: { Accept: "application/json", Authorization: context.authorization }
      });
      if (!response.ok) {
        throw new Error(`Deletion stopped after ${deleted.length} record(s); ServiceNow returned ${response.status}.`);
      }
      deleted.push(sysId);
    }
    res.json({
      status: "committed",
      table: definition.table,
      retainedSysId: keepSysId,
      deletedSysIds: deleted,
      verifiedAt: new Date().toISOString(),
      message: `${deleted.length} verified duplicate record(s) deleted. Run the scan again to verify the remaining dataset.`
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to execute the deduplication job." });
  }
});

app.get("/api/servicenow/discovery", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const last24Hours = "sys_created_onRELATIVEGE@hour@ago@24";
    const todayWindow = "sys_created_onONToday@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()";
    const discoveredToday = "last_discoveredONToday@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()";
    const failedStates = "stateINFailed,Error,Cancelled,Canceled,Completed with errors,Completed with Errors";
    const runningStates = "stateINStarting,Running,Active,Pending";
    const definitions = {
      activeSchedules: ["discovery_schedule", "active=true"],
      totalSchedules: ["discovery_schedule", ""],
      completedRuns: ["discovery_status", `${last24Hours}^state=Completed`],
      failedRuns: ["discovery_status", `${last24Hours}^${failedStates}`],
      runningRuns: ["discovery_status", `${last24Hours}^${runningStates}`],
      completedRunsToday: ["discovery_status", `${todayWindow}^state=Completed`],
      failedRunsToday: ["discovery_status", `${todayWindow}^${failedStates}`],
      ec2Today: ["cmdb_ci_ec2_instance", discoveredToday],
      ec2Total: ["cmdb_ci_ec2_instance", ""],
      vmToday: ["cmdb_ci_vm_instance", discoveredToday],
      vmTotal: ["cmdb_ci_vm_instance", ""],
      awsAccounts: ["cmdb_ci_aws_account", ""],
      awsRegions: ["cmdb_ci_aws_datacenter", ""],
      loadBalancers: ["cmdb_ci_cloud_load_balancer", ""],
      databases: ["cmdb_ci_cloud_database", ""],
      objectStorage: ["cmdb_ci_cloud_object_storage", ""],
      functions: ["cmdb_ci_cloud_function", ""],
      subnets: ["cmdb_ci_cloud_subnet", ""],
      ecsClusters: ["cmdb_ci_cloud_ecs_cluster", ""]
    };

    const entries = await Promise.all(Object.entries(definitions).map(async ([key, [table, query]]) => {
      try {
        const value = await getServiceNowTableCount(
          context.instanceUrl,
          context.authorization,
          table,
          query
        );
        return [key, { value, available: true, table }];
      } catch (error) {
        return [key, { value: null, available: false, table, reason: compactServiceNowError(error) }];
      }
    }));
    const metrics = Object.fromEntries(entries);
    const midServerInventory = await getServiceNowRecordsWithValues(context, {
      table: "ecc_agent",
      query: "ORDERBYname",
      fields: ["sys_id", "name", "status", "operational_status", "active"],
      limit: 1000
    });
    const midServersTotal = midServerInventory.available ? midServerInventory.total : null;
    const midServersActive = midServerInventory.available
      ? midServerInventory.records.filter((record) => {
        const status = String(record.status?.display_value || record.status || "").toLowerCase();
        const operational = String(record.operational_status?.display_value || record.operational_status || "").toLowerCase();
        const active = String(record.active?.display_value || record.active || "").toLowerCase();
        return active === "true"
          || active === "yes"
          || status.includes("up")
          || status.includes("active")
          || status.includes("online")
          || operational === "1"
          || operational.includes("up")
          || operational.includes("operational");
      }).length
      : null;
    const completed = metrics.completedRuns.available ? metrics.completedRuns.value : 0;
    const failed = metrics.failedRuns.available ? metrics.failedRuns.value : 0;
    const terminalRuns = completed + failed;
    const successRate = terminalRuns
      ? Math.round((completed / terminalRuns) * 100)
      : null;
    const runsTodayCompleted = metrics.completedRunsToday.available ? metrics.completedRunsToday.value : 0;
    const runsTodayFailed = metrics.failedRunsToday.available ? metrics.failedRunsToday.value : 0;
    const runsTodayTotal = runsTodayCompleted + runsTodayFailed;
    const ec2TodayValue = sumAvailableMetrics(metrics.ec2Today, metrics.vmToday);
    const ec2TotalValue = sumAvailableMetrics(metrics.ec2Total, metrics.vmTotal);

    const [recentRuns, recentEc2] = await Promise.all([
      getServiceNowRecordsSafe(context, {
        table: "discovery_status",
        query: `${last24Hours}^ORDERBYDESCsys_created_on`,
        fields: ["sys_id", "number", "state", "dscheduler", "sys_created_on", "sys_updated_on", "duration", "description", "source"],
        limit: 6
      }),
      getServiceNowRecordsSafe(context, {
        table: "cmdb_ci_ec2_instance",
        query: `${discoveredToday}^ORDERBYDESClast_discovered`,
        fields: ["sys_id", "name", "object_id", "state", "last_discovered", "discovery_source", "operational_status"],
        limit: 5
      })
    ]);

    res.json({
      status: "connected",
      generatedAt: new Date().toISOString(),
      window: "Last 24 hours",
      schedules: {
        successRate: {
          value: successRate,
          available: metrics.completedRuns.available && metrics.failedRuns.available,
          reason: terminalRuns ? "" : "No completed runs in the last 24 hours"
        },
        completed: metrics.completedRuns,
        failed: metrics.failedRuns,
        running: metrics.runningRuns,
        active: metrics.activeSchedules,
        inactive: metrics.totalSchedules.available ? {
          value: Math.max((metrics.totalSchedules.value || 0) - (metrics.activeSchedules.value || 0), 0),
          available: true
        } : { value: null, available: false, reason: metrics.totalSchedules.reason },
        total: metrics.totalSchedules,
        midServers: midServersTotal === null
          ? { value: null, available: false, reason: midServerInventory.reason || "MID Server inventory unavailable" }
          : { value: midServersTotal, available: true },
        midServersActive: midServersActive === null
          ? { value: null, available: false, reason: midServerInventory.reason || "MID Server inventory unavailable" }
          : { value: midServersActive, available: true }
      },
      runsToday: {
        total: { value: runsTodayTotal, available: metrics.completedRunsToday.available && metrics.failedRunsToday.available },
        completed: metrics.completedRunsToday,
        failed: metrics.failedRunsToday
      },
      aws: {
        ec2Today: ec2TodayValue,
        ec2Total: ec2TotalValue,
        vmToday: metrics.vmToday,
        vmTotal: metrics.vmTotal,
        accounts: metrics.awsAccounts,
        regions: metrics.awsRegions,
        loadBalancers: metrics.loadBalancers,
        databases: metrics.databases,
        objectStorage: metrics.objectStorage,
        functions: metrics.functions,
        subnets: metrics.subnets,
        ecsClusters: metrics.ecsClusters
      },
      recentRuns,
      recentEc2,
      sourceNote: "AWS EC2 coverage combines cmdb_ci_ec2_instance and cmdb_ci_vm_instance so pattern-based VM discovery is not missed."
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to load ServiceNow Discovery data." });
  }
});

const samDemoMetricResults = [
  {
    sys_id: "demo-microsoft-office",
    display_name: "[DEMO SAM] Microsoft Office Professional 2010",
    publisher: "Microsoft",
    rights_owned: 370,
    rights_used: 320,
    rights_consumed: 320,
    rights_needed: 0,
    unused_rights: 50,
    true_up_cost: 0,
    over_licensed_amount: 25000,
    total_spend: 129500
  },
  {
    sys_id: "demo-adobe-acrobat",
    display_name: "[DEMO SAM] Adobe Acrobat DC Professional",
    publisher: "Adobe Systems",
    rights_owned: 600,
    rights_used: 720,
    rights_consumed: 720,
    rights_needed: 120,
    unused_rights: 0,
    true_up_cost: 21600,
    over_licensed_amount: 0,
    total_spend: 189000
  },
  {
    sys_id: "demo-ibm-db2",
    display_name: "[DEMO SAM] IBM DB2 Advanced Enterprise Server Edition",
    publisher: "IBM",
    rights_owned: 100000,
    rights_used: 65000,
    rights_consumed: 65000,
    rights_needed: 0,
    unused_rights: 35000,
    true_up_cost: 0,
    over_licensed_amount: 350000,
    total_spend: 1000000
  },
  {
    sys_id: "demo-citrix-gotomeeting",
    display_name: "[DEMO SAM] Citrix GoToMeeting 4.8",
    publisher: "Citrix Systems",
    rights_owned: 630,
    rights_used: 700,
    rights_consumed: 700,
    rights_needed: 70,
    unused_rights: 0,
    true_up_cost: 35000,
    over_licensed_amount: 0,
    total_spend: 315000
  }
];

const samDemoPublisherResults = [
  {
    sys_id: "demo-publisher-microsoft",
    publisher: "Microsoft",
    status: "Compliant",
    published_status: "Demo position: compliant · 50 rights available",
    true_up_cost: 0,
    over_licensed_amount: 25000,
    total_spend: 129500
  },
  {
    sys_id: "demo-publisher-adobe",
    publisher: "Adobe Systems",
    status: "Not compliant",
    published_status: "Demo position: not compliant · 120 rights short",
    unlicensed_installs: 120,
    true_up_cost: 21600,
    over_licensed_amount: 0,
    total_spend: 189000
  },
  {
    sys_id: "demo-publisher-ibm",
    publisher: "IBM",
    status: "Compliant",
    published_status: "Demo position: compliant · optimization opportunity",
    true_up_cost: 0,
    over_licensed_amount: 350000,
    total_spend: 1000000
  },
  {
    sys_id: "demo-publisher-citrix",
    publisher: "Citrix Systems",
    status: "Not compliant",
    published_status: "Demo position: not compliant · 70 rights short",
    unlicensed_installs: 70,
    true_up_cost: 35000,
    over_licensed_amount: 0,
    total_spend: 315000
  }
];

app.get("/api/servicenow/sam", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const [entitlementsResult, metricResultsResult, publisherResultsResult, reconciliationJobsResult] = await Promise.all([
      getServiceNowRecordsWithValues(context, {
        table: "alm_license",
        query: "ORDERBYDESCsys_updated_on",
        fields: [
          "sys_id",
          "display_name",
          "software_model",
          "software_model.name",
          "software_model.manufacturer",
          "purchased_rights",
          "rights",
          "unit_cost",
          "license_yearly_cost",
          "product_type",
          "license_duration",
          "start_date",
          "end_date",
          "maintenance",
          "unlimited_license",
          "sys_updated_on"
        ],
        limit: 1000
      }),
      getServiceNowRecordsWithValues(context, {
        table: "samp_license_metric_result",
        query: "ORDERBYDESCsys_updated_on",
        fields: [
          "sys_id",
          "display_name",
          "publisher",
          "product",
          "software_model",
          "rights_owned",
          "rights_used",
          "rights_consumed",
          "rights_needed",
          "unused_rights",
          "licenses_available",
          "unlicensed_installs",
          "true_up_cost",
          "over_licensed_amount",
          "total_spend",
          "sys_updated_on"
        ],
        limit: 2000
      }),
      getServiceNowRecordsWithValues(context, {
        table: "samp_publisher_result",
        query: "ORDERBYDESCsys_updated_on",
        fields: [
          "sys_id",
          "publisher",
          "status",
          "published_status",
          "total_products",
          "compliant_products",
          "unlicensed_installs",
          "unlicensed_users",
          "unlicensed_subscriptions",
          "unlicensed_cals",
          "unlicensed_options",
          "unmanaged_installs",
          "true_up_cost",
          "over_licensed_amount",
          "total_spend",
          "sys_updated_on"
        ],
        limit: 1000
      }),
      getServiceNowRecordsWithValues(context, {
        table: "samp_reconciliation_result",
        query: "ORDERBYDESCsys_created_on",
        fields: [
          "sys_id",
          "number",
          "status",
          "progress",
          "progress_ux",
          "progress_step",
          "total",
          "current_processed",
          "last_reconciled",
          "recon_progress_summary",
          "sys_created_on",
          "sys_updated_on"
        ],
        limit: 20
      })
    ]);

    const countDefinitions = {
      softwareModels: ["cmdb_software_product_model", ""],
      installations: ["cmdb_sam_sw_install", ""],
      unlicensedInstalls: ["cmdb_sam_sw_install", "unlicensed_install=true"],
      discoveryModels: ["cmdb_sam_sw_discovery_model", ""],
      unreconciledEntitlements: ["samp_unreconciled_entitlement", ""],
      reconciliationResults: ["samp_reconciliation_result", ""]
    };
    const countEntries = await Promise.all(Object.entries(countDefinitions).map(async ([key, [table, query]]) => {
      try {
        return [key, {
          value: await getServiceNowTableCount(context.instanceUrl, context.authorization, table, query),
          available: true,
          table
        }];
      } catch (error) {
        return [key, { value: null, available: false, table, reason: compactServiceNowError(error) }];
      }
    }));
    const counts = Object.fromEntries(countEntries);
    const entitlements = entitlementsResult.records;
    let metricResults = metricResultsResult.records;
    let publisherResults = publisherResultsResult.records;
    const reconciliationJobs = reconciliationJobsResult.records;
    const demoData = metricResults.length === 0
      && publisherResults.length === 0
      && context.profile.id === "pdi";
    if (demoData) {
      metricResults = samDemoMetricResults;
      publisherResults = samDemoPublisherResults;
    }

    const entitlementSummary = entitlements.reduce((summary, record) => {
      const purchasedRights = numberValue(record.purchased_rights);
      const activeRights = numberValue(record.rights);
      const unitCost = numberValue(record.unit_cost);
      summary.purchasedRights += purchasedRights;
      summary.activeRights += activeRights;
      summary.estimatedValue += purchasedRights * unitCost;
      if (isDateWithinDays(record.end_date?.value, 90)) summary.expiring90 += 1;
      if (booleanValue(record.maintenance)) summary.maintenance += 1;
      return summary;
    }, {
      purchasedRights: 0,
      activeRights: 0,
      estimatedValue: 0,
      expiring90: 0,
      maintenance: 0
    });

    const vendorMap = new Map();
    for (const record of entitlements) {
      const publisher = displayValue(record["software_model.manufacturer"])
        || "Unspecified publisher";
      const purchasedRights = numberValue(record.purchased_rights);
      const unitCost = numberValue(record.unit_cost);
      const current = vendorMap.get(publisher) || {
        publisher,
        entitlements: 0,
        purchasedRights: 0,
        activeRights: 0,
        estimatedValue: 0
      };
      current.entitlements += 1;
      current.purchasedRights += purchasedRights;
      current.activeRights += numberValue(record.rights);
      current.estimatedValue += purchasedRights * unitCost;
      vendorMap.set(publisher, current);
    }
    const vendors = [...vendorMap.values()]
      .sort((left, right) => right.purchasedRights - left.purchasedRights)
      .slice(0, 10);

    const licensePosition = metricResults.reduce((summary, record) => {
      summary.owned += numberValue(record.rights_owned);
      summary.used += numberValue(record.rights_used) || numberValue(record.rights_consumed);
      summary.required += numberValue(record.rights_needed);
      summary.available += numberValue(record.unused_rights) || numberValue(record.licenses_available);
      summary.unlicensed += numberValue(record.unlicensed_installs);
      summary.trueUpCost += numberValue(record.true_up_cost);
      summary.overLicensedAmount += numberValue(record.over_licensed_amount);
      summary.totalSpend += numberValue(record.total_spend);
      return summary;
    }, {
      owned: 0,
      used: 0,
      required: 0,
      available: 0,
      unlicensed: 0,
      trueUpCost: 0,
      overLicensedAmount: 0,
      totalSpend: 0
    });

    const publisherCompliance = publisherResults.map((record) => {
      const exposure =
        numberValue(record.unlicensed_installs)
        + numberValue(record.unlicensed_users)
        + numberValue(record.unlicensed_subscriptions)
        + numberValue(record.unlicensed_cals)
        + numberValue(record.unlicensed_options)
        + numberValue(record.unmanaged_installs);
      const status = displayValue(record.published_status) || displayValue(record.status) || "";
      const nonCompliant = exposure > 0
        || numberValue(record.true_up_cost) > 0
        || /non.?compliant|not.?compliant|out.?of.?compliance/i.test(status);
      return {
        sysId: rawValue(record.sys_id),
        publisher: displayValue(record.publisher) || "Unknown publisher",
        status: status || (nonCompliant ? "Non-compliant" : "Compliant"),
        nonCompliant,
        totalProducts: numberValue(record.total_products),
        compliantProducts: numberValue(record.compliant_products),
        exposure,
        trueUpCost: numberValue(record.true_up_cost),
        overLicensedAmount: numberValue(record.over_licensed_amount),
        totalSpend: numberValue(record.total_spend)
      };
    }).sort((left, right) => (
      Number(right.nonCompliant) - Number(left.nonCompliant)
      || right.trueUpCost - left.trueUpCost
    ));

    const reconciliationAvailable = metricResults.length > 0 || publisherResults.length > 0;
    const latestJobRecord = reconciliationJobs[0] || null;
    let latestSummary = null;
    if (latestJobRecord && rawValue(latestJobRecord.recon_progress_summary)) {
      const summaryResult = await getServiceNowRecordsWithValues(context, {
        table: "samp_recon_progress_summary",
        query: `sys_id=${rawValue(latestJobRecord.recon_progress_summary)}`,
        fields: ["sys_id", "latest_step", "log", "sys_created_on", "sys_updated_on"],
        limit: 1
      });
      latestSummary = summaryResult.records[0] || null;
    }
    const summaryLog = parseServiceNowJsonObject(rawValue(latestSummary?.log));
    const licensableInstalls = Number(summaryLog["Number of licensable installs and subscriptions"] || 0);
    const healthWarning = String(summaryLog["Failed to log health check issues"] || "");
    const latestJob = latestJobRecord ? {
      sysId: rawValue(latestJobRecord.sys_id),
      number: displayValue(latestJobRecord.number),
      status: displayValue(latestJobRecord.status),
      progress: numberValue(latestJobRecord.progress),
      progressLabel: displayValue(latestJobRecord.progress_ux),
      step: displayValue(latestJobRecord.progress_step),
      processed: numberValue(latestJobRecord.current_processed),
      total: numberValue(latestJobRecord.total),
      lastReconciled: displayValue(latestJobRecord.last_reconciled),
      createdOn: displayValue(latestJobRecord.sys_created_on),
      licensableInstalls,
      inUseEntitlements: Number(summaryLog["Number of in use entitlements"] || 0),
      inferredInstalls: Number(summaryLog["Number of inferred installs"] || 0),
      healthWarning,
      url: `${context.instanceUrl}/nav_to.do?uri=samp_reconciliation_result.do?sys_id=${encodeURIComponent(rawValue(latestJobRecord.sys_id))}`
    } : null;
    res.json({
      status: "connected",
      generatedAt: new Date().toISOString(),
      demoData,
      dataSource: demoData
        ? "Live PDI entitlements with application-generated SAM demonstration positions"
        : "Native ServiceNow SAM Pro reconciliation",
      entitlements: {
        total: metricFromRecords(entitlementsResult),
        purchasedRights: availableMetric(entitlementsResult.available, entitlementSummary.purchasedRights, entitlementsResult.reason),
        activeRights: availableMetric(entitlementsResult.available, entitlementSummary.activeRights, entitlementsResult.reason),
        estimatedValue: availableMetric(entitlementsResult.available, roundCurrency(entitlementSummary.estimatedValue), entitlementsResult.reason),
        expiring90: availableMetric(entitlementsResult.available, entitlementSummary.expiring90, entitlementsResult.reason),
        maintenance: availableMetric(entitlementsResult.available, entitlementSummary.maintenance, entitlementsResult.reason)
      },
      inventory: {
        softwareModels: counts.softwareModels,
        installations: demoData ? availableMetric(true, 66740) : counts.installations,
        unlicensedInstalls: demoData ? availableMetric(true, 190) : counts.unlicensedInstalls,
        discoveryModels: demoData ? availableMetric(true, 4) : counts.discoveryModels,
        unreconciledEntitlements: counts.unreconciledEntitlements
      },
      reconciliation: {
        available: reconciliationAvailable,
        jobCompleted: Boolean(latestJob && /completed/i.test(latestJob.status)),
        latestJob,
        resultCount: counts.reconciliationResults,
        metricResultCount: metricResults.length,
        publisherResultCount: publisherResults.length,
        position: licensePosition,
        nonCompliantPublishers: publisherCompliance.filter((publisher) => publisher.nonCompliant).length,
        message: reconciliationAvailable
          ? demoData
            ? "Demo license positions are displayed using live PDI entitlement and software-model data."
            : "Latest available SAM reconciliation results are displayed."
          : latestJob && /completed/i.test(latestJob.status) && licensableInstalls === 0
            ? "Reconciliation completed successfully, but no license position was generated because there are no licensable software installs or subscriptions."
            : "No SAM reconciliation results are available. Run Software Asset reconciliation to calculate compliance and license position."
      },
      vendors,
      publisherCompliance: publisherCompliance.slice(0, 10),
      recentEntitlements: entitlements.slice(0, 6).map((record) => ({
        sysId: rawValue(record.sys_id),
        name: displayValue(record.display_name) || displayValue(record.software_model) || "Software entitlement",
        model: displayValue(record.software_model),
        publisher: displayValue(record["software_model.manufacturer"]) || "Unspecified publisher",
        purchasedRights: numberValue(record.purchased_rights),
        activeRights: numberValue(record.rights),
        unitCost: numberValue(record.unit_cost),
        endDate: displayValue(record.end_date),
        url: `${context.instanceUrl}/nav_to.do?uri=alm_license.do?sys_id=${encodeURIComponent(rawValue(record.sys_id))}`
      }))
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to load ServiceNow SAM Pro data." });
  }
});

app.get("/api/servicenow/records", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const type = String(req.query.type || "incidents");
    const definition = serviceNowRecordTypes[type];
    if (!definition) throw new Error(`Unsupported record type: ${type}`);

    const pageSize = [10, 20, 50, 100].includes(Number(req.query.pageSize))
      ? Number(req.query.pageSize)
      : 20;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * pageSize;
    const search = sanitizeServiceNowSearch(req.query.q);
    const queryParts = [];
    if (definition.baseQuery) queryParts.push(definition.baseQuery);
    if (search) {
      queryParts.push(definition.searchFields
        .map((field, index) => `${index ? "OR" : ""}${field}LIKE${search}`)
        .join("^"));
    }
    queryParts.push("ORDERBYDESCsys_updated_on");

    const url = new URL(`${context.instanceUrl}/api/now/table/${definition.table}`);
    url.searchParams.set("sysparm_query", queryParts.filter(Boolean).join("^"));
    url.searchParams.set("sysparm_fields", definition.fields.join(","));
    url.searchParams.set("sysparm_display_value", "true");
    url.searchParams.set("sysparm_exclude_reference_link", "true");
    url.searchParams.set("sysparm_limit", String(pageSize));
    url.searchParams.set("sysparm_offset", String(offset));
    url.searchParams.set("sysparm_suppress_pagination_header", "false");
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: context.authorization }
    });
    if (!response.ok) throw new Error(`${definition.label} query failed with status ${response.status}.`);
    const payload = await response.json();
    const total = Number(response.headers.get("x-total-count") || payload.result?.length || 0);
    const records = (payload.result || []).map((record) => ({
      ...record,
      sysId: record.sys_id,
      url: `${context.instanceUrl}/nav_to.do?uri=${definition.table}.do?sys_id=${encodeURIComponent(record.sys_id || "")}`
    }));

    res.json({
      type,
      label: definition.label,
      singular: definition.singular,
      table: definition.table,
      columns: definition.columns.map(([key, label]) => ({ key, label })),
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
      rangeStart: total ? offset + 1 : 0,
      rangeEnd: Math.min(offset + records.length, total),
      records
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to load ServiceNow records." });
  }
});

app.get("/api/servicenow/computer-intelligence", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const computerInventory = await getServiceNowRecordsWithValues(context, {
      table: "cmdb_ci_computer",
      query: "ORDERBYDESCsys_updated_on",
      fields: [
        "sys_id",
        "manufacturer",
        "assigned_to",
      ],
      limit: 1000
    });

    const records = computerInventory.available ? computerInventory.records : [];
    const manufacturerGroups = groupByCount(records, "manufacturer", "Not set");
    const assignedCount = records.filter((record) => displayValue(record.assigned_to)).length;
    const topManufacturer = manufacturerGroups[0] || null;

    res.json({
      status: "connected",
      generatedAt: new Date().toISOString(),
      summary: {
        total: computerInventory.total,
        assigned: assignedCount,
        topManufacturer
      },
      manufacturerGroups,
      signals: {
        source: "cmdb_ci_computer inventory",
        note: "Counts are grouped from computer CIs only."
      }
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to load computer intelligence data." });
  }
});

app.get("/api/servicenow/developer/artifacts", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const type = String(req.query.type || "business_rule");
    const definition = serviceNowArtifactTypes[type];
    if (!definition) throw new Error(`Unsupported artifact type: ${type}`);
    const search = sanitizeServiceNowSearch(req.query.q);
    const tableName = sanitizeServiceNowSearch(req.query.table);
    const queryParts = [];
    if (search) queryParts.push(`nameLIKE${search}`);
    if (tableName && definition.tableField) queryParts.push(`${definition.tableField}=${tableName}`);
    queryParts.push("ORDERBYname");

    const url = new URL(`${context.instanceUrl}/api/now/table/${definition.table}`);
    url.searchParams.set("sysparm_query", queryParts.filter(Boolean).join("^"));
    url.searchParams.set("sysparm_fields", definition.fields.filter((field) => field !== "script").join(","));
    url.searchParams.set("sysparm_display_value", "true");
    url.searchParams.set("sysparm_exclude_reference_link", "true");
    url.searchParams.set("sysparm_limit", "50");
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: context.authorization }
    });
    if (!response.ok) throw new Error(`${definition.label} search failed with status ${response.status}.`);
    res.json({
      type,
      label: definition.label,
      artifacts: ((await response.json()).result || []).map((record) => normalizeServiceNowArtifactRecord(definition, record))
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to search ServiceNow development artifacts." });
  }
});

app.get("/api/servicenow/developer/artifacts/:type/:sysId", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const definition = serviceNowArtifactTypes[req.params.type];
    if (!definition) throw new Error(`Unsupported artifact type: ${req.params.type}`);
    const record = await getServiceNowRecord(
      context,
      definition.table,
      req.params.sysId,
      definition.fields
    );
    res.json({
      type: req.params.type,
      label: definition.label,
      table: definition.table,
      record: normalizeServiceNowArtifactRecord(definition, record),
      sourceHash: hashText(record.script || "")
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to load ServiceNow development artifact." });
  }
});

app.post("/api/servicenow/developer/ai-refactor", async (req, res) => {
  const openai = getOpenAI();
  if (!openai) {
    res.status(503).json({ error: "OPENAI_API_KEY is required for AI-assisted refactoring." });
    return;
  }

  try {
    const {
      artifactType = "",
      name = "",
      table = "",
      description = "",
      script = "",
      instruction = ""
    } = req.body || {};
    const definition = serviceNowArtifactTypes[artifactType];
    if (!definition) throw new Error(`Unsupported artifact type: ${artifactType}`);
    if (!String(script).trim()) throw new Error("Load an artifact with source code before using AI.");
    if (!String(instruction).trim()) throw new Error("Describe the change you want OpenAI to make.");
    if (String(script).length > 60000) throw new Error("This script is too large for the current AI review workflow.");

    res.json(await generateServiceNowRefactor(openai, {
      artifactType,
      name,
      table,
      description,
      script,
      instruction
    }));
  } catch (error) {
    res.status(502).json({ error: error.message || "OpenAI refactoring failed." });
  }
});

app.post("/api/servicenow/developer/copilot", async (req, res) => {
  const openai = getOpenAI();
  if (!openai) {
    res.status(503).json({ error: "OPENAI_API_KEY is required for Developer Copilot." });
    return;
  }

  try {
    const instanceId = String(req.body?.instance || "").trim();
    const command = String(req.body?.command || "").trim();
    if (!command) throw new Error("Enter a Developer Copilot command.");
    if (command.length > 2000) throw new Error("The Developer Copilot command is too long.");

    const intent = await parseServiceNowCopilotCommand(openai, command);
    const context = await getServiceNowRequestContext(instanceId);
    const definition = serviceNowArtifactTypes[intent.artifactType];

    if (intent.operation === "create") {
      const existing = await findServiceNowArtifacts(
        context,
        intent.artifactType,
        intent.artifactName,
        intent.table,
        { exactOnly: true }
      );
      if (existing.length) {
        res.status(409).json({
          error: `${definition.label.replace(/s$/, "")} "${intent.artifactName}" already exists${intent.table ? ` on ${intent.table}` : ""}. Use a modify command or choose another name.`,
          intent,
          candidates: existing.map((record) => ({
            sys_id: record.sys_id,
            name: record.name,
            table: getArtifactTableName(intent.artifactType, record),
            active: record.active,
            sys_updated_on: record.sys_updated_on
          }))
        });
        return;
      }

      const creation = await generateServiceNowCreation(openai, intent);
      const draft = buildServiceNowArtifactDraft(intent, creation);
      res.json({
        ...creation,
        command,
        operation: "create",
        intent,
        artifact: draft,
        workflow: [
          { id: "interpret", label: "Create command interpreted", status: "completed", detail: `${definition.label}: ${intent.artifactName}` },
          { id: "locate", label: "Duplicate check", status: "completed", detail: "No existing artifact with the same name and table was found." },
          { id: "inspect", label: "Requirements analysed", status: "completed", detail: creation.proposal.summary },
          { id: "refactor", label: "New artifact generated", status: creation.checks.passed ? "completed" : "failed", detail: `${definition.table} insert payload prepared locally.` },
          { id: "verify", label: "Static verification", status: creation.checks.passed ? "completed" : "failed", detail: creation.checks.passed ? "Script and creation metadata checks passed." : "One or more blocking checks failed." },
          { id: "save", label: "ServiceNow create", status: "waiting", detail: "Waiting for explicit user confirmation." }
        ]
      });
      return;
    }

    const matches = await findServiceNowArtifacts(
      context,
      intent.artifactType,
      intent.artifactName,
      intent.table
    );

    if (!matches.length) {
      res.status(404).json({
        error: `No ${serviceNowArtifactTypes[intent.artifactType].label.toLowerCase()} matched "${intent.artifactName}".`,
        intent
      });
      return;
    }

    const exactMatches = matches.filter((record) =>
      String(record.name || "").trim().toLowerCase() === intent.artifactName.trim().toLowerCase()
    );
    const candidates = exactMatches.length ? exactMatches : matches;
    if (candidates.length > 1) {
      res.status(409).json({
        error: "More than one artifact matched. Refine the command with the exact artifact name and table.",
        intent,
        candidates: candidates.map((record) => ({
          sys_id: record.sys_id,
          name: record.name,
          table: getArtifactTableName(intent.artifactType, record),
          active: record.active,
          sys_updated_on: record.sys_updated_on
        }))
      });
      return;
    }

    const artifact = await getServiceNowRecord(
      context,
      definition.table,
      candidates[0].sys_id,
      definition.fields
    );
    if (!String(artifact.script || "").trim()) {
      throw new Error(`${artifact.name} does not contain script source that can be refactored.`);
    }

    const refactor = await generateServiceNowRefactor(openai, {
      artifactType: intent.artifactType,
      name: artifact.name,
      table: getArtifactTableName(intent.artifactType, artifact) || intent.table,
      description: artifact.description || "",
      script: artifact.script || "",
      instruction: intent.instruction
    });

    res.json({
      ...refactor,
      command,
      operation: intent.operation,
      intent,
      artifact: {
        ...normalizeServiceNowArtifactRecord(definition, artifact),
        sourceHash: hashText(artifact.script || "")
      },
      workflow: [
        { id: "interpret", label: "Command interpreted", status: "completed", detail: `${definition.label}: ${artifact.name}` },
        { id: "locate", label: "Artifact located", status: "completed", detail: `${definition.table} / ${artifact.sys_id}` },
        { id: "inspect", label: "Current source inspected", status: "completed", detail: `Updated ${artifact.sys_updated_on || "unknown"} by ${artifact.sys_updated_by || "unknown"}` },
        { id: "refactor", label: "Refactor generated", status: refactor.checks.passed ? "completed" : "failed", detail: refactor.proposal.summary },
        { id: "verify", label: "Static verification", status: refactor.checks.passed ? "completed" : "failed", detail: refactor.checks.passed ? "All blocking checks passed." : "One or more blocking checks failed." },
        { id: "save", label: "ServiceNow save", status: "waiting", detail: "Waiting for explicit user confirmation." }
      ]
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Developer Copilot failed." });
  }
});

app.post("/api/servicenow/developer/artifacts/:type", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const artifactType = req.params.type;
    const definition = serviceNowArtifactTypes[artifactType];
    if (!definition) throw new Error(`Unsupported artifact type: ${artifactType}`);
    const {
      name = "",
      table = "",
      script = "",
      description = "",
      configuration = {},
      confirmation = ""
    } = req.body || {};
    if (confirmation !== "CONFIRM_CREATE") {
      res.status(400).json({ error: "Explicit creation confirmation is required." });
      return;
    }
    const safeName = sanitizeServiceNowSearch(name);
    const safeTable = sanitizeServiceNowSearch(table);
    if (!safeName) {
      res.status(400).json({ error: "Artifact name is required." });
      return;
    }
    if (definition.tableField && artifactType !== "script_include" && !safeTable) {
      res.status(400).json({ error: `A target table is required for ${definition.label}.` });
      return;
    }
    if (typeof script !== "string" || !script.trim()) {
      res.status(400).json({ error: "A non-empty script is required." });
      return;
    }

    const checks = validateServiceNowProposal(artifactType, "", script);
    const metadataChecks = validateServiceNowCreationMetadata(artifactType, safeTable, configuration);
    if (checks.blocking || metadataChecks.blocking) {
      res.status(400).json({
        error: "The artifact failed creation validation.",
        checks: mergeServiceNowChecks(checks, metadataChecks)
      });
      return;
    }

    const existing = await findServiceNowArtifacts(
      context,
      artifactType,
      safeName,
      safeTable,
      { exactOnly: true }
    );
    if (existing.length) {
      res.status(409).json({
        error: `${definition.label.replace(/s$/, "")} "${safeName}" already exists${safeTable ? ` on ${safeTable}` : ""}.`
      });
      return;
    }

    const payload = buildServiceNowCreatePayload(
      artifactType,
      safeName,
      safeTable,
      script,
      description,
      configuration
    );
    const createResponse = await fetch(`${context.instanceUrl}/api/now/table/${definition.table}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: context.authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!createResponse.ok) {
      const detail = await createResponse.text();
      throw new Error(`ServiceNow creation failed with status ${createResponse.status}: ${detail.slice(0, 220)}`);
    }
    const created = (await createResponse.json()).result;
    const sysId = String(created?.sys_id?.value || created?.sys_id || "");
    if (!sysId) throw new Error("ServiceNow created the record but did not return a sys_id.");

    const afterRaw = await getServiceNowRecord(context, definition.table, sysId, definition.fields);
    const after = normalizeServiceNowArtifactRecord(definition, afterRaw);
    const updateSet = await findServiceNowUpdateCapture(context, definition.table, sysId);
    res.status(201).json({
      status: "created",
      committedAt: new Date().toISOString(),
      artifact: {
        type: artifactType,
        table: definition.table,
        sysId,
        name: after.name
      },
      changedFields: Object.keys(payload),
      before: {
        sourceHash: "",
        updatedOn: "",
        updatedBy: ""
      },
      after: {
        sourceHash: hashText(after.script || ""),
        updatedOn: after.sys_updated_on,
        updatedBy: after.sys_updated_by
      },
      updateSet,
      record: after,
      verified:
        after.name === safeName
        && after.script === script
        && String(after.description || "") === String(description || "")
        && (!definition.tableField || artifactType === "script_include" || getArtifactTableName(artifactType, after) === safeTable)
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to create ServiceNow development artifact." });
  }
});

app.patch("/api/servicenow/developer/artifacts/:type/:sysId", async (req, res) => {
  try {
    const context = await getServiceNowRequestContext(req.query.instance);
    const definition = serviceNowArtifactTypes[req.params.type];
    if (!definition) throw new Error(`Unsupported artifact type: ${req.params.type}`);
    const { script, description = "", expectedUpdatedOn = "", confirmation = "" } = req.body || {};
    if (confirmation !== "CONFIRM_SAVE") {
      res.status(400).json({ error: "Explicit save confirmation is required." });
      return;
    }
    if (typeof script !== "string" || !script.trim()) {
      res.status(400).json({ error: "A non-empty script is required." });
      return;
    }

    const before = await getServiceNowRecord(
      context,
      definition.table,
      req.params.sysId,
      definition.fields
    );
    if (expectedUpdatedOn && before.sys_updated_on !== expectedUpdatedOn) {
      res.status(409).json({
        error: "This record changed in ServiceNow after it was loaded. Reload before saving.",
        currentUpdatedOn: before.sys_updated_on,
        currentUpdatedBy: before.sys_updated_by
      });
      return;
    }

    const descriptionField = definition.descriptionField || "description";
    const updateResponse = await fetch(
      `${context.instanceUrl}/api/now/table/${definition.table}/${encodeURIComponent(req.params.sysId)}`,
      {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          Authorization: context.authorization,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ script, [descriptionField]: description })
      }
    );
    if (!updateResponse.ok) {
      const detail = await updateResponse.text();
      throw new Error(`ServiceNow save failed with status ${updateResponse.status}: ${detail.slice(0, 180)}`);
    }
    const afterRaw = await getServiceNowRecord(
      context,
      definition.table,
      req.params.sysId,
      definition.fields
    );
    const after = normalizeServiceNowArtifactRecord(definition, afterRaw);
    const normalizedBefore = normalizeServiceNowArtifactRecord(definition, before);
    const updateSet = await findServiceNowUpdateCapture(context, definition.table, req.params.sysId);
    res.json({
      status: "committed",
      committedAt: new Date().toISOString(),
      artifact: {
        type: req.params.type,
        table: definition.table,
        sysId: req.params.sysId,
        name: after.name
      },
      changedFields: [
        ...(normalizedBefore.script !== after.script ? ["script"] : []),
        ...(normalizedBefore.description !== after.description ? ["description"] : [])
      ],
      before: {
        sourceHash: hashText(normalizedBefore.script || ""),
        updatedOn: normalizedBefore.sys_updated_on,
        updatedBy: normalizedBefore.sys_updated_by
      },
      after: {
        sourceHash: hashText(after.script || ""),
        updatedOn: after.sys_updated_on,
        updatedBy: after.sys_updated_by
      },
      updateSet,
      verified: after.script === script && String(after.description || "") === String(description || "")
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Unable to save ServiceNow development artifact." });
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

async function readServiceNowInstanceRegistry() {
  const registryPath = path.join(process.cwd(), "servicenow-instances.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  if (!Array.isArray(registry.instances) || !registry.instances.length) {
    throw new Error("No ServiceNow instance profiles are defined.");
  }
  return registry;
}

async function getServiceNowRequestContext(instanceId) {
  const registry = await readServiceNowInstanceRegistry();
  const profile = resolveServiceNowProfile(registry, instanceId);
  const configuration = await readServiceNowProfile(profile);
  assertServiceNowProfileConfigured(profile, configuration);
  const instanceUrl = String(configuration.SERVICENOW_INSTANCE_URL).replace(/\/$/, "");
  return {
    profile,
    configuration,
    instanceUrl,
    authorization: await getServiceNowAuthorization(configuration)
  };
}

async function scanServiceNowDuplicateDataset(context, type, definition) {
  const result = await getServiceNowRecordsWithValues(context, {
    table: definition.table,
    query: "ORDERBYsys_created_on",
    fields: definition.fields,
    limit: 5000
  });
  if (!result.available) throw new Error(result.reason || `${definition.label} records are unavailable.`);
  const records = result.records;
  const groupsByRecordSet = new Map();

  for (const rule of definition.keyRules) {
    const keyedRecords = new Map();
    for (const record of records) {
      const values = rule.fields.map((field) => normalizeDuplicateValue(record[field]));
      if (values.some((value) => !value)) continue;
      const key = values.join("|");
      if (!keyedRecords.has(key)) keyedRecords.set(key, []);
      keyedRecords.get(key).push(record);
    }
    for (const [key, matchingRecords] of keyedRecords.entries()) {
      if (matchingRecords.length < 2) continue;
      const recordSet = matchingRecords
        .map((record) => rawValue(record.sys_id))
        .filter(Boolean)
        .sort()
        .join(",");
      const existing = groupsByRecordSet.get(recordSet);
      if (existing && existing.rule.baseConfidence >= rule.baseConfidence) continue;
      groupsByRecordSet.set(recordSet, { key, rule, records: matchingRecords });
    }
  }

  const groups = [...groupsByRecordSet.values()].map(({ key, rule, records: matchingRecords }) => {
    const exact = definition.comparisonFields.every((field) => {
      const values = new Set(matchingRecords.map((record) => normalizeDuplicateValue(record[field])));
      return values.size === 1;
    });
    const confidence = exact ? 100 : rule.baseConfidence;
    const sortedRecords = [...matchingRecords].sort((left, right) => {
      const leftActive = booleanValue(left.active) ? 1 : 0;
      const rightActive = booleanValue(right.active) ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;
      return rawValue(left.sys_created_on).localeCompare(rawValue(right.sys_created_on));
    });
    const id = createHash("sha256")
      .update(`${type}:${rule.label}:${key}:${sortedRecords.map((record) => rawValue(record.sys_id)).join(",")}`)
      .digest("hex")
      .slice(0, 20);
    return {
      id,
      rule: rule.label,
      key: key.split("|").join(" · "),
      confidence,
      exact,
      deleteEligible: exact,
      retainedSysId: rawValue(sortedRecords[0].sys_id),
      duplicateCount: sortedRecords.length - 1,
      warning: exact
        ? "All compared business fields match. References and audit requirements must still be reviewed before deletion."
        : "The duplicate key matches, but other business fields differ. Merge or manual review is required.",
      records: sortedRecords.map((record, index) => ({
        sysId: rawValue(record.sys_id),
        display: displayValue(record[definition.displayField]) || displayValue(record.name) || rawValue(record.sys_id),
        active: rawValue(record.active) ? booleanValue(record.active) : null,
        createdOn: displayValue(record.sys_created_on),
        updatedOn: displayValue(record.sys_updated_on),
        retainRecommended: index === 0,
        values: Object.fromEntries(definition.comparisonFields.map((field) => [field, displayValue(record[field])]))
      }))
    };
  }).sort((left, right) => (
    Number(right.exact) - Number(left.exact)
    || right.confidence - left.confidence
    || right.duplicateCount - left.duplicateCount
  ));
  const duplicateRecords = groups.reduce((sum, group) => sum + group.duplicateCount, 0);
  const exactDuplicateRecords = groups
    .filter((group) => group.exact)
    .reduce((sum, group) => sum + group.duplicateCount, 0);

  return {
    status: "complete",
    generatedAt: new Date().toISOString(),
    type,
    label: definition.label,
    table: definition.table,
    totalRecords: records.length,
    duplicateGroups: groups.length,
    duplicateRecords,
    exactDuplicateRecords,
    duplicatePercent: records.length ? Number(((duplicateRecords / records.length) * 100).toFixed(1)) : 0,
    exactPercent: records.length ? Number(((exactDuplicateRecords / records.length) * 100).toFixed(1)) : 0,
    groups: groups.slice(0, 50),
    methodology: "Exact-key grouping with full business-field comparison. A 100% score means compared fields are identical; it does not prove that references, history, or legal retention obligations are absent."
  };
}

function normalizeDuplicateValue(field) {
  return displayValue(field)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function inspectTableSchema(instanceUrl, username, password, table) {
  const auth = `Basic ${Buffer.from(`${username || ""}:${password || ""}`).toString("base64")}`;
  const [dictionaryResult, sampleResult] = await Promise.all([
    fetchJsonTable(instanceUrl, auth, "sys_dictionary", `name=${encodeURIComponent(table)}^internal_type!=collection`, ["element", "column_label", "internal_type", "reference", "mandatory", "max_length", "active"], 200),
    fetchJsonTable(instanceUrl, auth, table, "", ["sys_id"], 1)
  ]);
  if (!dictionaryResult.available) throw new Error(dictionaryResult.reason || `${table}: schema unavailable.`);
  return {
    fields: (dictionaryResult.records || []).map((record) => ({
      name: displayValue(record.element),
      label: displayValue(record.column_label) || displayValue(record.element),
      type: displayValue(record.internal_type),
      reference: displayValue(record.reference),
      mandatory: booleanValue(record.mandatory),
      maxLength: numberValue(record.max_length),
      active: booleanValue(record.active)
    })),
    count: sampleResult.available ? sampleResult.total || 0 : 0
  };
}

async function fetchJsonTable(instanceUrl, authorization, table, query, fields, limit = 10, offset = 0) {
  try {
    const url = new URL(`${normalizeUrl(instanceUrl)}/api/now/table/${table}`);
    if (query) url.searchParams.set("sysparm_query", query);
    if (fields?.length) url.searchParams.set("sysparm_fields", fields.join(","));
    url.searchParams.set("sysparm_display_value", "true");
    url.searchParams.set("sysparm_exclude_reference_link", "true");
    url.searchParams.set("sysparm_limit", String(limit));
    if (offset) url.searchParams.set("sysparm_offset", String(offset));
    url.searchParams.set("sysparm_suppress_pagination_header", "false");
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: authorization }
    });
    if (!response.ok) {
      return { available: false, reason: `${table}: ${response.status}`, records: [], total: 0 };
    }
    const payload = await response.json();
    return {
      available: true,
      total: Number(response.headers.get("x-total-count") || payload.result?.length || 0),
      records: payload.result || []
    };
  } catch (error) {
    return { available: false, reason: compactServiceNowError(error), records: [], total: 0 };
  }
}

async function fetchServiceNowRows(instanceUrl, authorization, table, fields, limit = 100) {
  const maxRecords = Math.max(1, Number(limit || 100));
  const pageSize = Math.max(1, Math.min(100, maxRecords));
  let offset = 0;
  const records = [];
  let total = 0;
  let available = true;
  let reason = "";
  while (true) {
    const result = await fetchJsonTable(instanceUrl, authorization, table, "", fields, pageSize, offset);
    if (!result.available) {
      available = false;
      reason = result.reason || `${table}: unavailable`;
      break;
    }
    total = result.total || total;
    records.push(...(result.records || []));
    if (records.length >= maxRecords) {
      records.length = maxRecords;
      break;
    }
    if ((result.records || []).length < pageSize) break;
    offset += pageSize;
  }
  return { available, reason, records, total };
}

function buildFieldMatrix(sourceFields = [], targetFields = []) {
  const sourceMap = new Map(sourceFields.map((field) => [field.name, field]));
  const targetMap = new Map(targetFields.map((field) => [field.name, field]));
  const shared = [];
  const sourceOnly = [];
  const targetOnly = [];
  const mappings = [];
  for (const [name, sourceField] of sourceMap.entries()) {
    const targetField = targetMap.get(name);
    if (targetField) {
      shared.push({ name, source: sourceField, target: targetField });
      mappings.push({
        source: name,
        target: name,
        label: sourceField.label || name,
        confidence: 100,
        reason: "Exact field name match"
      });
    } else {
      sourceOnly.push(sourceField);
    }
  }
  for (const [name, targetField] of targetMap.entries()) {
    if (!sourceMap.has(name)) targetOnly.push(targetField);
  }
  return {
    shared,
    sourceOnly,
    targetOnly,
    mappings: mappings.sort((left, right) => left.source.localeCompare(right.source)).slice(0, 40)
  };
}

function summarizeMovementPlan(matrix) {
  const mapCount = matrix.mappings.length;
  const sharedCount = matrix.shared.length;
  const sourceOnlyCount = matrix.sourceOnly.length;
  const targetOnlyCount = matrix.targetOnly.length;
  return `Ready to map ${mapCount} fields across ${sharedCount} shared fields. ${sourceOnlyCount} source-only and ${targetOnlyCount} target-only fields need review before IRE staging.`;
}

function buildIrePreview(table, matrix, source, target) {
  const identifierFields = getIreIdentifierFields(table);
  return {
    sourceTable: table,
    targetTable: table,
    operation: "IRE import preview",
    payloadShape: {
      className: table,
      identifier: identifierFields.length ? identifierFields.join(" ? ") : "sys_id / business key",
      mappedFields: matrix.mappings.slice(0, 12),
      sourceFieldCount: source.fields.length,
      targetFieldCount: target.fields.length,
      enrichment: table === "cmdb_ci_server"
        ? ["model_id resolved to sys_id", "manufacturer resolved when possible", "fqdn / host_name / ip_address included"]
        : table === "cmdb_ci_ip_switch"
          ? ["serial_number prioritized", "name / fqdn / ip_address / mac_address included", "manufacturer and model_number normalized"]
          : ["source values normalized before IRE"]
    }
  };
}

function isCmdbIreTable(tableName) {
  return /^cmdb(_ci|_)/.test(String(tableName || "").trim());
}

function getIreIdentifierFields(tableName) {
  if (tableName === "cmdb_ci_ip_switch") return ["serial_number", "name", "ip_address", "fqdn", "mac_address"];
  if (tableName === "cmdb_ci_server") return ["serial_number", "name", "ip_address", "fqdn", "host_name"];
  if (tableName === "cmdb_ci_computer") return ["serial_number", "name", "manufacturer", "model_id"];
  return ["serial_number", "name"];
}

function normalizeUrl(url) {
  return String(url || "").replace(/\/$/, "");
}

async function checkIreEndpointReadiness(context, endpointPath) {
  const endpoint = `${normalizeUrl(context.instanceUrl)}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: context.authorization,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items: [] })
  });
  const preview = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    preview: preview.slice(0, 240)
  };
}

async function buildIreReadinessProbe(context, className, records, sourceName) {
  const sample = records?.[0] || {};
  const endpoint = `${normalizeUrl(context.instanceUrl)}/api/now/identifyreconcile/query`;
  const probePayload = {
    items: [
      {
        className,
        values: {
          name: String(sample.name || sample.host_name || sample.fqdn || sample.serial_number || "codex-probe"),
          serial_number: String(sample.serial_number || `probe-${Date.now()}`),
          discovery_source: sourceName
        },
        sys_object_source_info: {
          source_name: sourceName,
          source_native_key: String(sample.sys_id || sample.name || `probe-${Date.now()}`),
          source_feed: "Codex IRE probe",
          source_recency_timestamp: String(sample.sys_updated_on || sample.sys_created_on || new Date().toISOString())
        }
      }
    ]
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: context.authorization,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(probePayload)
  });
  const preview = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    preview: preview.slice(0, 240),
    probePayload
  };
}

async function getValidDiscoverySources(context) {
  const response = await fetchJsonTable(
    context.instanceUrl,
    context.authorization,
    "sys_choice",
    "name=cmdb_ci^element=discovery_source^ORDERBYlabel",
    ["value", "label"],
    200
  );
  if (!response.available) return [];
  return (response.records || [])
    .map((record) => String(record.value || "").trim())
    .filter(Boolean);
}

async function runIreRestTransfer(context, endpointPath, className, sourceName, records, fieldMatrix, targetFields = [], onProgress = null) {
  if (!endpointPath) throw new Error("An IRE endpoint path is required.");
  const results = [];
  const verifiedRecords = [];
  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let blocked = 0;
  if (!isCmdbIreTable(className)) {
    return runTableApiTransfer(context, className, sourceName, records, fieldMatrix, targetFields);
  }
  const endpoint = `${normalizeUrl(context.instanceUrl)}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
  const targetMap = new Map(targetFields.map((field) => [field.name, field]));
  const refCache = new Map();
  const modelCache = new Map();

  for (const sourceRecord of records) {
    const recordNumber = processed + inserted + updated + blocked + 1;
    if (typeof onProgress === "function") {
      onProgress({ event: "stage", key: "movement", label: "Record submitted", detail: `Record ${recordNumber}/${records.length} submitted to IRE.` });
      onProgress({ event: "stage", key: "movement", label: "Data movement in progress", detail: `Processing record ${recordNumber} of ${records.length}.` });
    }
    const values = {};
    const enrichment = [];
    let confidence = 100;
    let sourceNativeKey = String(sourceRecord.sys_id || sourceRecord.name || sourceRecord.serial_number || sourceRecord.display_name || sourceRecord.user_name || "");
    if (!sourceNativeKey) {
      blocked += 1;
      results.push({ status: "blocked", reason: "No stable source key found.", confidence: 0 });
      continue;
    }

    for (const mapping of fieldMatrix.mappings || []) {
      const sourceValue = sourceRecord[mapping.source];
      if (sourceValue === undefined || sourceValue === null || sourceValue === "") continue;
      const targetField = targetMap.get(mapping.target);
      const resolved = await normalizeIreValue(context, targetField, sourceValue, refCache, modelCache);
      if (resolved.blocked) {
        confidence = Math.min(confidence, resolved.confidence || 55);
        enrichment.push(resolved.reason);
        continue;
      }
      values[mapping.target] = resolved.value;
      confidence = Math.min(confidence, resolved.confidence || 100);
      if (resolved.reason) enrichment.push(resolved.reason);
    }

    if (className === "cmdb_ci_server" || className === "cmdb_ci_ip_switch") {
      values.name = values.name || String(sourceRecord.name || sourceRecord.host_name || sourceRecord.fqdn || sourceRecord.serial_number || sourceNativeKey || "");
      values.serial_number = values.serial_number || String(sourceRecord.serial_number || "");
      values.ip_address = values.ip_address || String(sourceRecord.ip_address || sourceRecord.u_ip_address || "");
      values.fqdn = values.fqdn || String(sourceRecord.fqdn || sourceRecord.name || "");
      values.mac_address = values.mac_address || String(sourceRecord.mac_address || sourceRecord.mac || "");
      if (sourceRecord.manufacturer && !values.manufacturer) {
        values.manufacturer = await resolveManufacturer(context, sourceRecord.manufacturer, refCache);
      }
      const sourceModel = sourceRecord.model_number || sourceRecord.model_id || sourceRecord.model || "";
      if (sourceModel && !values.model_number && !values.model_id) {
        const resolvedModel = await resolveModelReference(context, sourceModel, refCache, modelCache);
        values.model_number = className === "cmdb_ci_ip_switch" ? String(sourceModel) : undefined;
        values.model_id = className === "cmdb_ci_server" ? resolvedModel : values.model_id;
        if (resolvedModel && resolvedModel !== sourceModel) enrichment.push("Resolved model reference.");
      }
      if (sourceRecord.asset_tag && !values.asset_tag) values.asset_tag = String(sourceRecord.asset_tag);
      if (sourceRecord.os && !values.os) values.os = String(sourceRecord.os);
      if (sourceRecord.os_version && !values.os_version) values.os_version = String(sourceRecord.os_version);
      if (sourceRecord.install_status && !values.install_status) values.install_status = String(sourceRecord.install_status);
      if (sourceRecord.operational_status && !values.operational_status) values.operational_status = String(sourceRecord.operational_status);
      if (sourceRecord.short_description && !values.short_description) values.short_description = String(sourceRecord.short_description);
    }

    if (className === "cmdb_ci_ip_switch") {
      values.model_number = values.model_number || String(sourceRecord.model_number || sourceRecord.model || "");
      values.install_status = values.install_status || String(sourceRecord.install_status || "1");
    }

    values.discovery_source = sourceName;
    const orderedValues = {};
    const identifiers = getIreIdentifierFields(className);
    for (const key of ["sys_class_name", ...identifiers, "manufacturer", "model_number", "model_id", "asset_tag", "install_status", "operational_status", "short_description", "os", "os_version", "discovery_source"]) {
      if (key === "sys_class_name") {
        orderedValues.sys_class_name = className;
        continue;
      }
      if (values[key] !== undefined && values[key] !== null && values[key] !== "") orderedValues[key] = values[key];
    }
    for (const [key, value] of Object.entries(values)) {
      if (orderedValues[key] === undefined && value !== undefined && value !== null && value !== "") orderedValues[key] = value;
    }
    const payload = {
      items: [
        {
          className,
          values: orderedValues,
          sys_object_source_info: {
            source_name: sourceName,
            source_native_key: sourceNativeKey,
            source_feed: `Table API import from ${sourceName}`,
            source_recency_timestamp: String(sourceRecord.sys_updated_on || sourceRecord.sys_created_on || new Date().toISOString())
          }
        }
      ]
    };
    const populatedIdentifierCount = identifiers.filter((key) => orderedValues[key] !== undefined && orderedValues[key] !== null && orderedValues[key] !== "").length;
    confidence = Math.min(confidence, Math.round((populatedIdentifierCount / Math.max(identifiers.length, 1)) * 100));
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: context.authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    if (!response.ok) {
      blocked += 1;
      results.push({ status: "blocked", reason: `IRE endpoint failed with status ${response.status}: ${responseText.slice(0, 180)}`, confidence, payload, rawResponse: responseText });
      if (typeof onProgress === "function") {
        onProgress({ event: "stage", key: "movement", label: "Record blocked", detail: `Record ${recordNumber} blocked: ${responseText.slice(0, 120)}` });
      }
      continue;
    }
    const body = safeJsonParse(responseText, {});
    processed += 1;
    const ireOutput = extractIreOutput(body);
    const committedItem = extractCommittedIreItem(body);
    const targetStatus = String(committedItem?.operation || ireOutput?.status || ireOutput?.operation || ireOutput?.items?.[0]?.operation || "").toLowerCase();
    if (/insert/.test(targetStatus)) inserted += 1;
    else if (/update/.test(targetStatus)) updated += 1;
    const verification = await verifyTransferredRecord(context, className, sourceRecord, sourceNativeKey, orderedValues, committedItem?.sysId || "").catch(() => null);
    if (verification?.found) {
      verifiedRecords.push({
        recordNumber,
        query: verification.query,
        sys_id: verification.record?.sys_id || "",
        name: verification.record?.name || "",
        serial_number: verification.record?.serial_number || "",
        fqdn: verification.record?.fqdn || ""
      });
      if (typeof onProgress === "function") {
        onProgress({ event: "stage", key: "ire", label: "PDI verification passed", detail: `Record ${recordNumber}/${records.length} confirmed in ${className}.` });
      }
    } else if (typeof onProgress === "function") {
      onProgress({ event: "stage", key: "ire", label: "PDI verification missing", detail: `Record ${recordNumber}/${records.length} was not found in ${className} after IRE response.` });
    }
    const statusLabel = /insert/.test(targetStatus) ? "inserted" : /update/.test(targetStatus) ? "updated" : "processed";
    results.push({
      status: body.status || targetStatus || "success",
      source: body.source || sourceName,
      confidence,
      ire_output: ireOutput,
      input_payload: body.input_payload || payload,
      payload,
      enrichment,
      verification,
      rawResponse: responseText
    });
    if (typeof onProgress === "function") {
      onProgress({ event: "stage", key: "movement", label: `Record ${statusLabel}`, detail: `Record ${recordNumber}/${records.length} ${statusLabel}.` });
    }
  }

  return { processed, inserted, updated, blocked, results, verifiedRecords };
}

async function runTableApiTransfer(context, tableName, sourceName, records, fieldMatrix, targetFields = []) {
  const results = [];
  const targetMap = new Map(targetFields.map((field) => [field.name, field]));
  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let blocked = 0;

  for (const sourceRecord of records) {
    const values = {};
    let confidence = 100;
    for (const mapping of fieldMatrix.mappings || []) {
      const sourceValue = sourceRecord[mapping.source];
      if (sourceValue === undefined || sourceValue === null || sourceValue === "") continue;
      const targetField = targetMap.get(mapping.target);
      const resolved = await normalizeIreValue(context, targetField, sourceValue, new Map(), new Map());
      if (resolved.blocked) {
        blocked += 1;
        confidence = Math.min(confidence, resolved.confidence || 55);
      results.push({ status: "blocked", reason: resolved.reason || `Unable to map ${mapping.source}.`, confidence });
        continue;
      }
      values[mapping.target] = resolved.value;
      confidence = Math.min(confidence, resolved.confidence || 100);
    }

    for (const [key, value] of Object.entries(sourceRecord)) {
      if (values[key] === undefined && value !== undefined && value !== null && value !== "") values[key] = value;
    }

    const payload = {
      items: [
        {
          className: tableName,
          values,
          sys_object_source_info: {
            source_name: sourceName,
            source_native_key: String(sourceRecord.sys_id || sourceRecord.sys_number || sourceRecord.number || sourceRecord.name || ""),
            source_feed: `Table API import from ${sourceName}`,
            source_recency_timestamp: String(sourceRecord.sys_updated_on || sourceRecord.sys_created_on || new Date().toISOString())
          }
        }
      ]
    };

    const response = await fetch(`${normalizeUrl(context.instanceUrl)}/api/now/table/${tableName}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: context.authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(values)
    });
    const responseText = await response.text();

    if (!response.ok) {
      blocked += 1;
      results.push({ status: "blocked", reason: `Table API failed with status ${response.status}: ${responseText.slice(0, 180)}`, confidence, payload, rawResponse: responseText });
      continue;
    }

    const body = safeJsonParse(responseText, {});
    processed += 1;
    inserted += 1;
    results.push({
      status: "inserted",
      source: sourceName,
      confidence,
      table_api_output: body.result || body,
      input_payload: payload,
      payload,
      rawResponse: responseText
    });
  }

  return { processed, inserted, updated, blocked, results, verifiedRecords: [] };
}

async function verifyTransferredRecord(context, tableName, sourceRecord, sourceNativeKey, orderedValues, committedSysId = "") {
  const candidates = [
    committedSysId ? `sys_id=${encodeURIComponent(String(committedSysId))}` : "",
    sourceRecord.serial_number ? `serial_number=${encodeURIComponent(String(sourceRecord.serial_number))}` : "",
    sourceRecord.name ? `name=${encodeURIComponent(String(sourceRecord.name))}` : "",
    sourceRecord.fqdn ? `fqdn=${encodeURIComponent(String(sourceRecord.fqdn))}` : "",
    sourceNativeKey ? `sys_id=${encodeURIComponent(String(sourceNativeKey))}` : ""
  ].filter(Boolean);
  for (const query of candidates) {
    const result = await fetchJsonTable(context.instanceUrl, context.authorization, tableName, query, ["sys_id", "name", "serial_number", "fqdn", "sys_updated_on"], 1);
    if (result.available && (result.records || []).length) {
      return { found: true, query, record: result.records[0] };
    }
  }
  return { found: false, attempted: candidates, sample: orderedValues };
}

function extractIreOutput(body = {}) {
  return body.ire_output
    || body.result
    || body.output
    || body?.result?.items?.[0]
    || body?.output?.items?.[0]
    || null;
}

function extractCommittedIreItem(body = {}) {
  const result = body.result || {};
  const committed = result.additionalCommittedItems;
  if (Array.isArray(committed) && committed.length) return committed[0];
  if (committed && typeof committed === "object") return committed;
  const item = result.items?.[0];
  if (item) return {
    operation: item.operation,
    sysId: item.sysId,
    identifierEntrySysId: item.identifierEntrySysId
  };
  return null;
}

async function normalizeIreValue(context, field, value, refCache, modelCache) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!field) return { value: text, confidence: 84, reason: "Target field metadata unavailable; preserved as text." };
  const type = String(field.type || "").toLowerCase();
  if (type === "reference") {
    if (!field.reference) return { blocked: true, confidence: 50, reason: `Reference field ${field.name} has no target table.` };
    const cacheKey = `${field.reference}::${text.toLowerCase()}`;
    if (refCache.has(cacheKey)) return { value: refCache.get(cacheKey), confidence: 96, reason: `Resolved ${field.reference} reference from cache.` };
    const lookup = await fetchJsonTable(context.instanceUrl, context.authorization, field.reference, `name=${encodeURIComponent(text)}^ORu_name=${encodeURIComponent(text)}^ORdisplay_name=${encodeURIComponent(text)}^ORcode=${encodeURIComponent(text)}`, ["sys_id", "name", "u_name", "display_name", "code"], 1);
    const sysId = lookup.available && lookup.records?.[0]?.sys_id;
    if (!sysId) return { blocked: true, confidence: 60, reason: `Could not resolve ${field.reference} reference for "${text}".` };
    refCache.set(cacheKey, sysId);
    return { value: sysId, confidence: 98, reason: `Resolved ${field.reference} reference.` };
  }
  if (field.name === "model_id") {
    const resolved = await resolveModelReference(context, text, refCache, modelCache);
    if (!resolved) return { blocked: true, confidence: 55, reason: `Could not resolve model ${text}.` };
    return { value: resolved, confidence: 97, reason: "Resolved model_id to model sys_id." };
  }
  if (field.name === "manufacturer") {
    const resolved = await resolveManufacturer(context, text, refCache);
    return { value: resolved, confidence: resolved !== text ? 96 : 86, reason: resolved !== text ? "Resolved manufacturer reference." : "Manufacturer left as text." };
  }
  if (["choice", "string", "glide_string", "text", "string_full"].includes(type)) return { value: text, confidence: 94 };
  if (["integer", "longint"].includes(type)) {
    const num = Number(text);
    if (Number.isNaN(num)) return { blocked: true, confidence: 50, reason: `Field ${field.name} expects a number.` };
    return { value: String(num), confidence: 96 };
  }
  if (["decimal", "float"].includes(type)) {
    const num = Number(text);
    if (Number.isNaN(num)) return { blocked: true, confidence: 50, reason: `Field ${field.name} expects a decimal number.` };
    return { value: String(num), confidence: 96 };
  }
  if (["boolean", "glide_boolean"].includes(type)) {
    const normalized = /^(true|1|yes|y)$/i.test(text) ? "true" : /^(false|0|no|n)$/i.test(text) ? "false" : null;
    if (normalized === null) return { blocked: true, confidence: 50, reason: `Field ${field.name} expects a boolean.` };
    return { value: normalized, confidence: 96 };
  }
  return { value: text, confidence: 85, reason: `Field ${field.name} written as normalized text.` };
}

async function resolveManufacturer(context, value, refCache) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!text) return "";
  const cacheKey = `core_company::${text.toLowerCase()}`;
  if (refCache.has(cacheKey)) return refCache.get(cacheKey);
  const lookup = await fetchJsonTable(context.instanceUrl, context.authorization, "core_company", `name=${encodeURIComponent(text)}^ORmanufacturer=${encodeURIComponent(text)}^ORvendor=${encodeURIComponent(text)}`, ["sys_id", "name", "manufacturer", "vendor"], 1);
  const sysId = lookup.available && lookup.records?.[0]?.sys_id;
  const resolved = sysId || text;
  refCache.set(cacheKey, resolved);
  return resolved;
}

async function resolveModelReference(context, value, refCache, modelCache) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!text) return "";
  const cacheKey = `cmdb_hardware_product_model::${text.toLowerCase()}`;
  if (modelCache.has(cacheKey)) return modelCache.get(cacheKey);
  const lookup = await fetchJsonTable(context.instanceUrl, context.authorization, "cmdb_hardware_product_model", `name=${encodeURIComponent(text)}^ORdisplay_name=${encodeURIComponent(text)}^ORmodel_number=${encodeURIComponent(text)}`, ["sys_id", "name", "display_name", "model_number"], 1);
  const sysId = lookup.available && lookup.records?.[0]?.sys_id;
  const resolved = sysId || text;
  modelCache.set(cacheKey, resolved);
  return resolved;
}

async function getServiceNowRecord(context, table, sysId, fields) {
  const url = new URL(`${context.instanceUrl}/api/now/table/${table}/${encodeURIComponent(sysId)}`);
  url.searchParams.set("sysparm_fields", fields.join(","));
  url.searchParams.set("sysparm_display_value", "true");
  url.searchParams.set("sysparm_exclude_reference_link", "true");
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: context.authorization }
  });
  if (!response.ok) throw new Error(`${table} record read failed with status ${response.status}.`);
  return (await response.json()).result;
}

async function getServiceNowRecordsSafe(context, {
  table,
  query = "",
  fields = [],
  limit = 10
}) {
  try {
    const url = new URL(`${context.instanceUrl}/api/now/table/${table}`);
    if (query) url.searchParams.set("sysparm_query", query);
    if (fields.length) url.searchParams.set("sysparm_fields", fields.join(","));
    url.searchParams.set("sysparm_display_value", "true");
    url.searchParams.set("sysparm_exclude_reference_link", "true");
    url.searchParams.set("sysparm_limit", String(limit));
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: context.authorization }
    });
    if (!response.ok) {
      return { available: false, reason: compactServiceNowError(new Error(`${table}: ${response.status}`)), records: [] };
    }
    const payload = await response.json();
    return {
      available: true,
      records: (payload.result || []).map((record) => ({
        ...record,
        sysId: record.sys_id,
        url: `${context.instanceUrl}/nav_to.do?uri=${table}.do?sys_id=${encodeURIComponent(record.sys_id || "")}`
      }))
    };
  } catch (error) {
    return { available: false, reason: compactServiceNowError(error), records: [] };
  }
}

async function getServiceNowRecordsWithValues(context, {
  table,
  query = "",
  fields = [],
  limit = 1000
}) {
  try {
    const url = new URL(`${context.instanceUrl}/api/now/table/${table}`);
    if (query) url.searchParams.set("sysparm_query", query);
    if (fields.length) url.searchParams.set("sysparm_fields", fields.join(","));
    url.searchParams.set("sysparm_display_value", "all");
    url.searchParams.set("sysparm_exclude_reference_link", "true");
    url.searchParams.set("sysparm_limit", String(limit));
    url.searchParams.set("sysparm_suppress_pagination_header", "false");
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: context.authorization }
    });
    if (!response.ok) {
      return {
        available: false,
        reason: compactServiceNowError(new Error(`${table}: ${response.status}`)),
        total: 0,
        records: []
      };
    }
    const payload = await response.json();
    return {
      available: true,
      total: Number(response.headers.get("x-total-count") || payload.result?.length || 0),
      records: payload.result || []
    };
  } catch (error) {
    return { available: false, reason: compactServiceNowError(error), total: 0, records: [] };
  }
}

function displayValue(field) {
  if (field && typeof field === "object") {
    return String(field.display_value ?? field.value ?? "");
  }
  return String(field ?? "");
}

function rawValue(field) {
  if (field && typeof field === "object") return String(field.value ?? "");
  return String(field ?? "");
}

function numberValue(field) {
  const raw = rawValue(field).replace(/[^0-9.-]/g, "");
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function booleanValue(field) {
  return ["true", "1", "yes"].includes(rawValue(field).toLowerCase());
}

function isDateWithinDays(value, days) {
  if (!value) return false;
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return false;
  const now = Date.now();
  return date.getTime() >= now && date.getTime() <= now + days * 24 * 60 * 60 * 1000;
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseServiceNowJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function availableMetric(available, value, reason = "") {
  return available
    ? { available: true, value }
    : { available: false, value: null, reason: reason || "Unavailable" };
}

function metricFromRecords(result) {
  return availableMetric(result.available, result.total, result.reason);
}

async function findServiceNowUpdateCapture(context, table, sysId) {
  try {
    const url = new URL(`${context.instanceUrl}/api/now/table/sys_update_xml`);
    url.searchParams.set("sysparm_query", `name=${table}_${sysId}^ORDERBYDESCsys_updated_on`);
    url.searchParams.set("sysparm_fields", "name,update_set,sys_updated_on,sys_updated_by");
    url.searchParams.set("sysparm_display_value", "true");
    url.searchParams.set("sysparm_exclude_reference_link", "true");
    url.searchParams.set("sysparm_limit", "1");
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: context.authorization }
    });
    if (!response.ok) return { captured: false, reason: "Update-set details unavailable" };
    const record = (await response.json()).result?.[0];
    return record
      ? { captured: true, name: record.name, updateSet: record.update_set, updatedOn: record.sys_updated_on }
      : { captured: false, reason: "No update XML record found" };
  } catch {
    return { captured: false, reason: "Update-set details unavailable" };
  }
}

function sanitizeServiceNowSearch(value) {
  return String(value || "")
    .trim()
    .replace(/[\^@]/g, " ")
    .slice(0, 120);
}

function hashText(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

async function parseServiceNowCopilotCommand(openai, command) {
  const response = await openai.responses.create({
    model: orchestrationModel,
    reasoning: { effort: "low" },
    max_output_tokens: 1200,
    store: false,
    input: [
      {
        role: "system",
        content:
          "Convert a natural-language ServiceNow Developer Studio request into a precise execution intent. " +
          "Supported artifact types are Business Rule, Client Script, Script Include, UI Action, and Fix Script. " +
          "Classify the operation as create when the user says create, write a new, add a new, build, or implement a new artifact. " +
          "Classify it as modify when an existing named artifact must be changed or refactored, and inspect for read-only review. " +
          "Extract the artifact name exactly as the user stated it. Use an empty table for Script Includes when none is provided. " +
          "Correct obvious table-name typos using the explicit target table as authoritative, but preserve field names and requirements in the instruction. " +
          "The instruction must retain all requested triggers, fields, referenced tables, behavior, professional comments, logging, and verification requirements. " +
          "Never authorize a save; the application handles save confirmation separately."
      },
      { role: "user", content: command }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "servicenow_developer_command",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["operation", "artifactType", "artifactName", "table", "instruction"],
          properties: {
            operation: {
              type: "string",
              enum: ["create", "modify", "inspect"]
            },
            artifactType: {
              type: "string",
              enum: ["business_rule", "client_script", "script_include", "ui_action", "fix_script"]
            },
            artifactName: { type: "string" },
            table: { type: "string" },
            instruction: { type: "string" }
          }
        }
      }
    }
  });
  if (response.status !== "completed") {
    throw new Error(`OpenAI command interpretation was incomplete: ${response.incomplete_details?.reason || response.status}`);
  }
  const intent = JSON.parse(extractOutputText(response));
  intent.artifactName = sanitizeServiceNowSearch(intent.artifactName);
  intent.table = sanitizeServiceNowSearch(intent.table);
  if (!intent.artifactName) throw new Error("The command must identify an artifact name.");
  return intent;
}

async function findServiceNowArtifacts(context, artifactType, name, tableName, { exactOnly = false } = {}) {
  const definition = serviceNowArtifactTypes[artifactType];
  if (!definition) throw new Error(`Unsupported artifact type: ${artifactType}`);
  const safeName = sanitizeServiceNowSearch(name);
  const safeTable = sanitizeServiceNowSearch(tableName);

  const runQuery = async (nameOperator) => {
    const queryParts = [`name${nameOperator}${safeName}`];
    if (safeTable && definition.tableField) {
      queryParts.push(`${definition.tableField}=${safeTable}`);
    }
    queryParts.push("ORDERBYname");
    const url = new URL(`${context.instanceUrl}/api/now/table/${definition.table}`);
    url.searchParams.set("sysparm_query", queryParts.join("^"));
    url.searchParams.set("sysparm_fields", definition.fields.filter((field) => field !== "script").join(","));
    url.searchParams.set("sysparm_display_value", "true");
    url.searchParams.set("sysparm_exclude_reference_link", "true");
    url.searchParams.set("sysparm_limit", "20");
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: context.authorization }
    });
    if (!response.ok) throw new Error(`${definition.label} search failed with status ${response.status}.`);
    return (await response.json()).result || [];
  };

  const exact = await runQuery("=");
  if (exact.length || exactOnly) return exact;
  return runQuery("LIKE");
}

async function generateServiceNowCreation(openai, intent) {
  const definition = serviceNowArtifactTypes[intent.artifactType];
  if (!definition) throw new Error(`Unsupported artifact type: ${intent.artifactType}`);
  const allowedFields = definition.createFields.join(", ");
  const response = await openai.responses.create({
    model: orchestrationModel,
    reasoning: { effort: "medium" },
    max_output_tokens: 12000,
    store: false,
    input: [
      {
        role: "system",
        content:
          "You are a senior ServiceNow platform engineer designing a new scripted metadata artifact. " +
          "Return a complete production-oriented script and creation metadata, not a patch. " +
          "Use only the configuration fields explicitly allowed for the artifact type. " +
          "Add concise professional comments that explain intent, constraints, and side effects. " +
          "Avoid current.update() in Business Rules, recursion, hard-coded sys_ids, secrets, sensitive logging, and synchronous outbound network calls in record Business Rules. " +
          "For Business Rules that set fields on the current record, prefer a synchronous before rule and assign the field directly. " +
          "If the request mentions AI search, web search, or vendor enrichment, do not invent an endpoint, credential, REST Message, or available AI capability. " +
          "Design a safe integration boundary, identify any required Script Include/Flow/REST Message/system properties as dependencies, and make limitations explicit in risks and assumptions. " +
          "Do not claim the artifact was created, executed, or externally verified."
      },
      {
        role: "user",
        content:
          `Create artifact type: ${definition.label}\n` +
          `Name: ${intent.artifactName}\n` +
          `Target table/API: ${intent.table || "Global"}\n` +
          `Allowed configuration fields: ${allowedFields || "none"}\n` +
          `Default configuration: ${JSON.stringify(definition.defaults || {})}\n\n` +
          `Requirements:\n${intent.instruction}`
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "servicenow_creation_proposal",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "summary",
            "proposedScript",
            "proposedDescription",
            "configuration",
            "changes",
            "risks",
            "testPlan",
            "assumptions",
            "confidence"
          ],
          properties: {
            summary: { type: "string" },
            proposedScript: { type: "string" },
            proposedDescription: { type: "string" },
            configuration: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["field", "value"],
                properties: {
                  field: { type: "string" },
                  value: { type: "string" }
                }
              }
            },
            changes: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } },
            testPlan: { type: "array", items: { type: "string" } },
            assumptions: { type: "array", items: { type: "string" } },
            confidence: { type: "string", enum: ["low", "medium", "high"] }
          }
        }
      }
    }
  });
  if (response.status !== "completed") {
    throw new Error(`OpenAI creation proposal was incomplete: ${response.incomplete_details?.reason || response.status}`);
  }

  const proposal = JSON.parse(extractOutputText(response));
  const configuration = normalizeServiceNowCreationConfiguration(
    intent.artifactType,
    proposal.configuration
  );
  proposal.configuration = configuration;
  const scriptChecks = validateServiceNowProposal(intent.artifactType, "", proposal.proposedScript);
  const metadataChecks = validateServiceNowCreationMetadata(
    intent.artifactType,
    intent.table,
    configuration
  );
  const checks = mergeServiceNowChecks(scriptChecks, metadataChecks);
  return {
    status: "creation_ready",
    model: orchestrationModel,
    generatedAt: new Date().toISOString(),
    originalHash: "",
    proposalHash: hashText(proposal.proposedScript),
    proposal,
    configuration,
    checks,
    usage: response.usage || null
  };
}

async function generateServiceNowRefactor(openai, {
  artifactType,
  name,
  table,
  description,
  script,
  instruction
}) {
  const definition = serviceNowArtifactTypes[artifactType];
  if (!definition) throw new Error(`Unsupported artifact type: ${artifactType}`);
  const response = await openai.responses.create({
    model: orchestrationModel,
    reasoning: { effort: "medium" },
    max_output_tokens: 12000,
    store: false,
    input: [
      {
        role: "system",
        content:
          "You are a senior ServiceNow platform engineer performing a safe code review and refactor. " +
          "Return a complete proposed script, not a patch. Preserve existing behavior unless the user's instruction explicitly changes it. " +
          "Use ServiceNow server/client APIs appropriate to the artifact type. Avoid current.update() in Business Rules, avoid recursive updates, " +
          "avoid logging secrets or sensitive record content, preserve localization with gs.getMessage where present, and add professional intent-focused comments. " +
          "Use concise JSDoc for non-obvious helpers and comments that explain intent, constraints, and side effects rather than restating syntax. " +
          "If debug logging is requested, make it structured, non-sensitive, and easy to disable. " +
          "Do not claim the change was saved or executed. Identify assumptions and risks honestly."
      },
      {
        role: "user",
        content:
          `Artifact type: ${definition.label}\n` +
          `Name: ${String(name)}\n` +
          `Table/API: ${String(table || "Global")}\n` +
          `Current description: ${String(description)}\n\n` +
          `Requested change:\n${String(instruction)}\n\n` +
          `Current script:\n${String(script)}`
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "servicenow_refactor_proposal",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "summary",
            "proposedScript",
            "proposedDescription",
            "changes",
            "risks",
            "testPlan",
            "assumptions",
            "confidence"
          ],
          properties: {
            summary: { type: "string" },
            proposedScript: { type: "string" },
            proposedDescription: { type: "string" },
            changes: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } },
            testPlan: { type: "array", items: { type: "string" } },
            assumptions: { type: "array", items: { type: "string" } },
            confidence: { type: "string", enum: ["low", "medium", "high"] }
          }
        }
      }
    }
  });

  if (response.status !== "completed") {
    throw new Error(`OpenAI response was incomplete: ${response.incomplete_details?.reason || response.status}`);
  }
  const proposal = JSON.parse(extractOutputText(response));
  const checks = validateServiceNowProposal(artifactType, script, proposal.proposedScript);
  return {
    status: "proposal_ready",
    model: orchestrationModel,
    generatedAt: new Date().toISOString(),
    originalHash: hashText(script),
    proposalHash: hashText(proposal.proposedScript),
    proposal,
    checks,
    usage: response.usage || null
  };
}

function getArtifactTableName(artifactType, record = {}) {
  if (artifactType === "business_rule") return record.collection || "";
  if (artifactType === "client_script") return record.table || "";
  if (artifactType === "ui_action") return record.table || "";
  return record.api_name || "";
}

function normalizeServiceNowArtifactRecord(definition, record = {}) {
  const descriptionField = definition.descriptionField || "description";
  return {
    ...record,
    description: record[descriptionField] || ""
  };
}

function normalizeServiceNowCreationConfiguration(artifactType, entries = []) {
  const definition = serviceNowArtifactTypes[artifactType];
  const allowedFields = new Set(definition.createFields || []);
  const configuration = { ...(definition.defaults || {}) };
  for (const entry of Array.isArray(entries) ? entries : []) {
    const field = String(entry?.field || "").trim();
    if (!allowedFields.has(field)) continue;
    const defaultValue = definition.defaults?.[field];
    configuration[field] = coerceServiceNowConfigurationValue(entry?.value, defaultValue);
  }
  return configuration;
}

function coerceServiceNowConfigurationValue(value, defaultValue) {
  if (typeof defaultValue === "boolean") {
    return ["true", "1", "yes"].includes(String(value).trim().toLowerCase());
  }
  if (typeof defaultValue === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }
  return String(value ?? "");
}

function validateServiceNowCreationMetadata(artifactType, tableName, configuration = {}) {
  const definition = serviceNowArtifactTypes[artifactType];
  const checks = [];
  if (definition.tableField && artifactType !== "script_include") {
    checks.push({
      id: "target_table",
      label: "Target table",
      status: String(tableName || "").trim() ? "passed" : "failed",
      detail: String(tableName || "").trim() ? `Target table: ${tableName}.` : "A target table is required."
    });
  }

  if (artifactType === "business_rule") {
    const validWhen = ["before", "after", "async", "display"].includes(String(configuration.when || ""));
    const triggers = ["insert", "update", "delete", "query"].filter((field) => configuration[field] === true);
    checks.push({
      id: "business_rule_timing",
      label: "Business Rule timing",
      status: validWhen ? "passed" : "failed",
      detail: validWhen ? `Runs ${configuration.when}.` : "Timing must be before, after, async, or display."
    });
    checks.push({
      id: "business_rule_triggers",
      label: "Business Rule triggers",
      status: triggers.length ? "passed" : "failed",
      detail: triggers.length ? `Runs on ${triggers.join(", ")}.` : "At least one trigger must be enabled."
    });
  }

  if (artifactType === "client_script") {
    const validType = ["onLoad", "onChange", "onSubmit", "onCellEdit"].includes(String(configuration.type || ""));
    const needsField = configuration.type === "onChange" || configuration.type === "onCellEdit";
    checks.push({
      id: "client_script_type",
      label: "Client Script type",
      status: validType ? "passed" : "failed",
      detail: validType ? `Type: ${configuration.type}.` : "Type must be onLoad, onChange, onSubmit, or onCellEdit."
    });
    checks.push({
      id: "client_script_field",
      label: "Client Script field",
      status: needsField && !String(configuration.field || "").trim() ? "failed" : "passed",
      detail: needsField ? `Field: ${configuration.field || "missing"}.` : "No field is required for this Client Script type."
    });
  }

  if (artifactType === "script_include") {
    checks.push({
      id: "script_include_access",
      label: "Script Include access",
      status: ["package_private", "public"].includes(String(configuration.access || "")) ? "passed" : "failed",
      detail: `Access: ${configuration.access || "missing"}.`
    });
  }

  const blocking = checks.some((check) => check.status === "failed");
  return { passed: !blocking, blocking, items: checks };
}

function mergeServiceNowChecks(...groups) {
  const items = groups.flatMap((group) => group?.items || []);
  const blocking = items.some((check) => check.status === "failed");
  return { passed: !blocking, blocking, items };
}

function buildServiceNowArtifactDraft(intent, creation) {
  const configuration = creation.configuration || creation.proposal.configuration || {};
  const draft = {
    sys_id: "",
    isNew: true,
    name: intent.artifactName,
    active: configuration.active,
    description: "",
    script: "",
    sourceHash: "",
    configuration
  };
  if (intent.artifactType === "business_rule") draft.collection = intent.table;
  if (intent.artifactType === "client_script" || intent.artifactType === "ui_action") draft.table = intent.table;
  if (intent.artifactType === "script_include") draft.api_name = intent.artifactName;
  return draft;
}

function buildServiceNowCreatePayload(artifactType, name, tableName, script, description, configuration) {
  const definition = serviceNowArtifactTypes[artifactType];
  const normalizedConfiguration = normalizeServiceNowCreationConfiguration(
    artifactType,
    Object.entries(configuration || {}).map(([field, value]) => ({ field, value: String(value) }))
  );
  const payload = {
    name,
    script,
    [definition.descriptionField || "description"]: description,
    ...Object.fromEntries(
      (definition.createFields || []).map((field) => [field, normalizedConfiguration[field]])
    )
  };
  if (definition.tableField && artifactType !== "script_include") {
    payload[definition.tableField] = tableName;
  }
  if (artifactType === "ui_action" && !payload.action_name) {
    payload.action_name = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }
  return payload;
}

function validateServiceNowProposal(artifactType, originalScript, proposedScript) {
  const checks = [];
  const source = String(proposedScript || "");
  try {
    new Function(source);
    checks.push({ id: "javascript_syntax", label: "JavaScript syntax", status: "passed", detail: "Source parsed successfully." });
  } catch (error) {
    checks.push({ id: "javascript_syntax", label: "JavaScript syntax", status: "failed", detail: error.message });
  }

  const unchanged = hashText(originalScript) === hashText(source);
  checks.push({
    id: "source_changed",
    label: "Source changed",
    status: unchanged ? "warning" : "passed",
    detail: unchanged ? "The AI proposal is identical to the current source." : "The proposal contains source changes."
  });

  if (artifactType === "business_rule") {
    const executableSource = stripJavaScriptComments(source);
    const hasCurrentUpdate = /\bcurrent\s*\.\s*update\s*\(/.test(executableSource);
    const hasOutboundCall = /\bRESTMessageV2\b|\bSOAPMessageV2\b/.test(executableSource);
    checks.push({
      id: "business_rule_recursion",
      label: "Business Rule recursion risk",
      status: hasCurrentUpdate ? "failed" : "passed",
      detail: hasCurrentUpdate
        ? "current.update() was detected and can cause recursive Business Rule execution."
        : "No current.update() call detected."
    });
    checks.push({
      id: "business_rule_outbound_call",
      label: "Synchronous integration risk",
      status: hasOutboundCall ? "warning" : "passed",
      detail: hasOutboundCall
        ? "An outbound REST/SOAP call was detected. Confirm the rule is asynchronous or delegates integration work safely."
        : "No direct outbound REST/SOAP call detected in the Business Rule."
    });
  }

  const sensitiveLogging = /(gs\.(info|debug|warn|error)|console\.log)\s*\([^)]*(password|secret|token|close_notes)/i.test(source);
  checks.push({
    id: "sensitive_logging",
    label: "Sensitive logging",
    status: sensitiveLogging ? "failed" : "passed",
    detail: sensitiveLogging ? "Potential sensitive data logging was detected." : "No obvious sensitive logging pattern detected."
  });

  const blocking = checks.some((check) => check.status === "failed");
  return {
    passed: !blocking,
    blocking,
    items: checks
  };
}

function stripJavaScriptComments(source) {
  return String(source || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function resolveServiceNowProfile(registry, requestedId) {
  const profileId = String(requestedId || registry.defaultInstance || "").trim();
  const profile = registry.instances.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown ServiceNow instance profile: ${profileId}`);
  return profile;
}

async function readServiceNowProfile(profile) {
  const sessionConfiguration = serviceNowSessionProfiles.get(profile.id);
  if (sessionConfiguration) return sessionConfiguration;
  if (profile.credentialMode === "session") return {};

  const envPath = path.resolve(process.cwd(), profile.envFile);
  try {
    return parseEnv(await fs.readFile(envPath));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function publicServiceNowProfile(profile, configuration, source = "") {
  const instanceUrl = configuration.SERVICENOW_INSTANCE_URL || "";
  let host = "";
  try {
    host = new URL(instanceUrl).hostname;
  } catch {
    host = "";
  }
  return {
    id: profile.id,
    name: profile.name,
    environment: profile.environment || "",
    host,
    authType: configuration.SERVICENOW_AUTH_TYPE || "basic",
    username: configuration.SERVICENOW_USERNAME || "",
    password: configuration.SERVICENOW_PASSWORD || "",
    configured: isServiceNowProfileConfigured(configuration),
    credentialSource: source
      || (serviceNowSessionProfiles.has(profile.id) ? "session" : profile.credentialMode === "session" ? "none" : "file")
  };
}

function isServiceNowProfileConfigured(configuration) {
  const authType = String(configuration.SERVICENOW_AUTH_TYPE || "basic").toLowerCase();
  const baseConfigured = Boolean(
    configuration.SERVICENOW_INSTANCE_URL
    && configuration.SERVICENOW_USERNAME
    && configuration.SERVICENOW_PASSWORD
  );
  if (authType === "oauth") {
    return baseConfigured && Boolean(
      configuration.SERVICENOW_CLIENT_ID
      && configuration.SERVICENOW_CLIENT_SECRET
    );
  }
  return baseConfigured;
}

function assertServiceNowProfileConfigured(profile, configuration) {
  if (!isServiceNowProfileConfigured(configuration)) {
    throw new Error(
      `ServiceNow profile "${profile.name}" is not configured. Complete ${profile.envFile}.`
    );
  }
}

function validateServiceNowInstanceUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new Error("Enter a valid ServiceNow instance URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("The ServiceNow instance URL must use HTTPS.");
  }
  if (!parsed.hostname.toLowerCase().endsWith(".service-now.com")) {
    throw new Error("The URL must be a service-now.com instance.");
  }
  return `${parsed.protocol}//${parsed.host}`;
}

async function validateServiceNowConnection(configuration) {
  const instanceUrl = String(configuration.SERVICENOW_INSTANCE_URL).replace(/\/$/, "");
  const authorization = await getServiceNowAuthorization(configuration);
  const testUrl = new URL(`${instanceUrl}/api/now/table/incident`);
  testUrl.searchParams.set("sysparm_limit", "1");
  testUrl.searchParams.set("sysparm_fields", "sys_id,number");
  const response = await fetch(testUrl, {
    headers: {
      Accept: "application/json",
      Authorization: authorization
    }
  });
  if (!response.ok) {
    if (response.status === 401) {
      const authentication = await detectServiceNowAuthentication(instanceUrl);
      if (authentication.provider) {
        throw new Error(
          `This instance uses ${authentication.provider} single sign-on. `
          + "Corporate SSO passwords cannot be used through REST Basic Auth. "
          + "Use a ServiceNow local API/service account, or configure OAuth."
        );
      }
      throw new Error(
        "ServiceNow rejected the REST Basic Auth credentials. Confirm the username, "
        + "local ServiceNow password, active account, and Web service access only setting."
      );
    }
    if (response.status === 403) throw new Error("The account is valid but cannot read incident records.");
    throw new Error(`ServiceNow connection test failed with status ${response.status}.`);
  }
}

async function getServiceNowConnectionIdentity(profile, configuration, instanceUrl, authorization) {
  const username = configuration.SERVICENOW_USERNAME || "OAuth user";
  let displayName = username;
  let title = "";
  try {
    const userUrl = new URL(`${instanceUrl}/api/now/table/sys_user`);
    userUrl.searchParams.set("sysparm_query", `user_name=${username}`);
    userUrl.searchParams.set("sysparm_fields", "name,user_name,title");
    userUrl.searchParams.set("sysparm_limit", "1");
    userUrl.searchParams.set("sysparm_display_value", "true");
    const response = await fetch(userUrl, {
      headers: { Accept: "application/json", Authorization: authorization }
    });
    if (response.ok) {
      const user = (await response.json()).result?.[0];
      displayName = user?.name || displayName;
      title = user?.title || "";
    }
  } catch {
    // Username from the authenticated profile remains a reliable fallback.
  }

  return {
    instanceId: profile.id,
    instanceName: profile.name,
    environment: profile.environment || "",
    host: new URL(instanceUrl).hostname,
    instanceUrl,
    user: { username, displayName, title },
    authType: configuration.SERVICENOW_AUTH_TYPE || "basic",
    credentialSource: serviceNowSessionProfiles.has(profile.id) ? "session" : "file",
    connectedAt: configuration._CONNECTED_AT || serverStartedAt
  };
}

async function getServiceNowTableCount(instanceUrl, authorization, table, query) {
  const url = new URL(`${instanceUrl}/api/now/table/${table}`);
  url.searchParams.set("sysparm_limit", "1");
  url.searchParams.set("sysparm_fields", "sys_id");
  url.searchParams.set("sysparm_suppress_pagination_header", "false");
  if (query) url.searchParams.set("sysparm_query", query);
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: authorization }
  });
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  const countHeader = response.headers.get("x-total-count");
  if (countHeader !== null && Number.isFinite(Number(countHeader))) return Number(countHeader);
  return (await response.json()).result?.length || 0;
}

function sumAvailableMetrics(...metrics) {
  const values = metrics.filter((metric) => metric?.available && Number.isFinite(Number(metric.value)));
  if (!values.length) {
    return metrics[0] || { value: null, available: false, reason: "Unavailable" };
  }
  return {
    value: values.reduce((total, metric) => total + Number(metric.value || 0), 0),
    available: true
  };
}

function countTruthy(records, predicate) {
  return Array.isArray(records) ? records.filter(predicate).length : 0;
}

function groupByCount(records, fieldName, fallbackLabel = "Not set") {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const value = displayValue(record?.[fieldName]) || fallbackLabel;
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, 8);
}

function topCounts(records, fieldName, limit = 8) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const value = displayValue(record?.[fieldName]) || "Unassigned";
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit);
}

async function getServiceNowInstanceStats({ instanceUrl, authorization, instanceName }) {
  try {
    const response = await fetch(`${instanceUrl}/stats.do`, {
      headers: { Accept: "text/html,application/xhtml+xml", Authorization: authorization }
    });
    if (!response.ok) {
      return { available: false, reason: `stats.do returned ${response.status}` };
    }
    const html = await response.text();
    const buildDate = extractStatValue(html, /g_builddate\s*=\s*"([^"]+)"/i);
    const buildName = extractStatValue(html, /Build name:\s*([^<\n]+)/i);
    const buildTag = extractStatValue(html, /Build tag:\s*([^<\n]+)/i);
    const statsInstanceName = extractStatValue(html, /Statistics for:\s*([^@<]+)@/i);
    const statsInstanceHost = extractStatValue(html, /Statistics for:\s*[^@<]+@\s*([^<\s]+)/i);
    const clusterNode = extractStatValue(html, /Connected to cluster node:\s*([^<\n]+)/i);
    const instanceId = extractStatValue(html, /Instance ID:\s*([^<\n]+)/i);
    const nodeId = extractStatValue(html, /Node ID:\s*([^<\n]+)/i);
    const state = extractStatValue(html, /Instance State:\s*([^<\n]+)/i);
    const ipAddress = extractStatValue(html, /IP address:\s*([^<\n]+)/i);
    const midBuildstamp = extractStatValue(html, /MID buildstamp:\s*([^<\n]+)/i);
    const loadBalancerStatus = extractStatValue(html, /Load-balancer status:\s*([^<\n]+)/i);
    const databaseLatency = extractStatValue(html, /Database latency:\s*([^<\n]+)/i);
    const offering = extractStatValue(html, /Offering:\s*([^<\n]+)/i);

    const resolvedInstanceName = statsInstanceName || instanceName || "ServiceNow instance";
    const resolvedHost = statsInstanceHost || new URL(instanceUrl).host;
    const stats = {
      available: true,
      instanceName: resolvedInstanceName,
      instanceHost: resolvedHost,
      statsAt: buildDate ? `Build ${buildDate}` : "stats.do loaded",
      clusterNode: clusterNode || "Unavailable",
      buildName: buildName || "Unavailable",
      buildDate: buildDate || "Unavailable",
      buildTag: buildTag || "Unavailable",
      instanceId: instanceId || "Unavailable",
      nodeId: nodeId || "Unavailable",
      state: state || "Unavailable",
      ipAddress: ipAddress || "Unavailable",
      midBuildstamp: midBuildstamp || "Unavailable",
      loadBalancerStatus: loadBalancerStatus || "Unavailable",
      databaseLatency: databaseLatency || "Unavailable",
      offering: offering || "Unavailable",
      fields: [
        { label: "Instance", value: resolvedInstanceName },
        { label: "Host", value: resolvedHost },
        { label: "Build", value: buildName || "Unavailable" },
        { label: "Build date", value: buildDate || "Unavailable" },
        { label: "State", value: state || "Unavailable" },
        { label: "Offering", value: offering || "Unavailable" }
      ]
    };
    return stats;
  } catch (error) {
    return { available: false, reason: compactServiceNowError(error) };
  }
}

function extractStatValue(html, pattern) {
  const match = String(html || "").match(pattern);
  return match ? cleanStatValue(match[1]) : "";
}

function cleanStatValue(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactServiceNowError(error) {
  const message = String(error?.message || "Unavailable");
  if (message.includes("403")) return "Access restricted";
  if (message.includes("404")) return "Table unavailable";
  return "Unavailable";
}

async function detectServiceNowAuthentication(instanceUrl) {
  try {
    const response = await fetch(`${instanceUrl}/`, { redirect: "manual" });
    const location = response.headers.get("location") || "";
    const body = await response.text();
    const evidence = `${location} ${body}`.toLowerCase();
    if (evidence.includes("login.microsoftonline.com") || evidence.includes("microsoft entra")) {
      return { provider: "Microsoft Entra ID" };
    }
    if (evidence.includes("saml")) return { provider: "SAML" };
    if (evidence.includes("okta")) return { provider: "Okta" };
  } catch {
    // Authentication diagnostics are best-effort; preserve the original 401.
  }
  return { provider: "" };
}

async function getServiceNowAuthorization(configuration) {
  const authType = String(configuration.SERVICENOW_AUTH_TYPE || "basic").toLowerCase();
  if (authType === "basic") {
    const encoded = Buffer.from(
      `${configuration.SERVICENOW_USERNAME}:${configuration.SERVICENOW_PASSWORD}`
    ).toString("base64");
    return `Basic ${encoded}`;
  }

  if (authType === "oauth") {
    const instanceUrl = String(configuration.SERVICENOW_INSTANCE_URL).replace(/\/$/, "");
    const tokenUrl = configuration.SERVICENOW_TOKEN_URL || `${instanceUrl}/oauth_token.do`;
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: configuration.SERVICENOW_CLIENT_ID,
        client_secret: configuration.SERVICENOW_CLIENT_SECRET,
        username: configuration.SERVICENOW_USERNAME,
        password: configuration.SERVICENOW_PASSWORD
      })
    });
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error(
        `ServiceNow OAuth token request failed: ${tokenPayload.error_description || tokenPayload.error || tokenResponse.status}`
      );
    }
    return `Bearer ${tokenPayload.access_token}`;
  }

  throw new Error(`Unsupported ServiceNow authentication type: ${authType}`);
}

function normalizeServiceNowIncident(record = {}, instanceUrl = "") {
  return {
    sysId: record.sys_id || record.number,
    number: record.number || "INC—",
    shortDescription: record.short_description || "",
    state: record.state || "Unknown",
    priority: record.priority || "Not set",
    assignmentGroup: record.assignment_group || "",
    assignedTo: record.assigned_to || "",
    caller: record.caller_id || "",
    openedAt: record.opened_at || "",
    updatedAt: record.sys_updated_on || "",
    url: `${instanceUrl}/nav_to.do?uri=incident.do?sys_id=${encodeURIComponent(record.sys_id || "")}`
  };
}

function summarizeIncidents(incidents = []) {
  const count = (predicate) => incidents.filter(predicate).length;
  return {
    total: incidents.length,
    critical: count((incident) => incident.priority.startsWith("1")),
    high: count((incident) => incident.priority.startsWith("2")),
    new: count((incident) => incident.state === "New"),
    inProgress: count((incident) => incident.state === "In Progress"),
    onHold: count((incident) => incident.state === "On Hold"),
    unassigned: count((incident) => !incident.assignedTo),
    noGroup: count((incident) => !incident.assignmentGroup)
  };
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
