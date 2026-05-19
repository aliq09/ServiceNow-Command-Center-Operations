import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Camera,
  Check,
  Clapperboard,
  CircleCheck,
  Command,
  CreditCard,
  Database,
  Download,
  Filter,
  FolderOpen,
  FolderKanban,
  GitCompare,
  ImagePlus,
  Layers,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Star,
  Sun,
  Shirt,
  Ruler,
  ScanLine,
  Sparkles,
  Tag,
  Upload,
  Wand2
} from "lucide-react";
import "./styles.css";

const measurementSteps = [
  "Image uploaded",
  "AI vision request",
  "Measurement estimate",
  "UK sizing"
];

const operationSteps = ["Prepare", "Send API call", "Receive result", "Save locally"];

const defaultMeasurementEstimate = {
  label: "Measurement estimate",
  model: "gpt-5.2",
  inputTokens: 3500,
  outputTokens: 450,
  costUsd: 0.0125
};

const imageQualities = [
  { value: "auto", label: "Auto", note: "Best default" },
  { value: "low", label: "Low", note: "Fast draft" },
  { value: "medium", label: "Medium", note: "Balanced" },
  { value: "high", label: "High", note: "Editorial" }
];

const imageSizes = [
  { value: "auto", label: "Auto" },
  { value: "1024x1024", label: "Square" },
  { value: "1024x1536", label: "Portrait" },
  { value: "1536x1024", label: "Landscape" }
];

const videoQualities = [
  { value: "standard", label: "Standard", note: "Sora 2" },
  { value: "pro", label: "Pro", note: "Sora 2 Pro" }
];

const videoSizes = [
  { value: "1280x720", label: "HD" },
  { value: "720x1280", label: "Vertical" },
  { value: "1920x1080", label: "Full HD" }
];

const providerOptions = [
  { value: "openai", label: "OpenAI" },
  { value: "xai", label: "Grok / xAI" },
  { value: "gemini", label: "Google Gemini" }
];

const measurementModelOptions = {
  openai: [{ value: "gpt-5.2", label: "GPT-5.2 Vision" }],
  xai: [
    { value: "grok-4.20-0309-reasoning", label: "Grok 4.20 Reasoning" },
    { value: "grok-4.20-0309-non-reasoning", label: "Grok 4.20 Fast" },
    { value: "grok-4.20-multi-agent-0309", label: "Grok 4.20 Multi-Agent" }
  ],
  gemini: [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash Vision" }]
};

const imageModelOptions = {
  openai: [{ value: "gpt-image-2", label: "GPT-image-2" }],
  xai: [
    { value: "grok-imagine-image", label: "Grok Image" },
    { value: "grok-imagine-image-pro", label: "Grok Image Pro" }
  ],
  gemini: [{ value: "imagen-3.0-generate-002", label: "Imagen 3" }]
};

const videoModelOptions = {
  openai: [
    { value: "sora-2", label: "Sora 2" },
    { value: "sora-2-pro", label: "Sora 2 Pro" }
  ],
  xai: [{ value: "grok-imagine-video", label: "Grok Imagine" }],
  gemini: [{ value: "veo-3.1-generate-preview", label: "Veo 3.1" }]
};

const editModelOptions = {
  xai: [
    { value: "grok-imagine-image", label: "Grok Image" },
    { value: "grok-imagine-image-pro", label: "Grok Image Pro" }
  ],
  gemini: [{ value: "gemini-2.5-flash-image", label: "Nano Banana" }]
};

const workspaceModes = [
  { id: "measure", label: "Measure", title: "Measurement Review", cta: "Ask OpenAI + measure", icon: Ruler },
  { id: "image", label: "Image", title: "Image Studio", cta: "Ask OpenAI + image", icon: ImagePlus },
  { id: "edit", label: "Edit", title: "Image Edit", cta: "Ask OpenAI + edit", icon: Sparkles },
  { id: "video", label: "Video", title: "Video Studio", cta: "Ask OpenAI + video", icon: Clapperboard },
  { id: "agent", label: "Agent", title: "Grok Agent", cta: "Send message", icon: Wand2 },
  { id: "billing", label: "Billing", title: "Billing Intelligence", cta: "Refresh billing", icon: CreditCard }
];

const defaultProjectId = "atelier-default";

const defaultProjects = [
  {
    id: defaultProjectId,
    name: "Main Studio",
    description: "Default workspace for measurements, image edits, generated media and video tests.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const outputTypeOptions = [
  { value: "all", label: "All outputs" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "edited", label: "Edited" },
  { value: "favorite", label: "Favorites" }
];

const providerFilterOptions = [
  { value: "all", label: "All providers" },
  { value: "openai", label: "OpenAI" },
  { value: "xai", label: "Grok / xAI" },
  { value: "gemini", label: "Gemini" }
];

function previewActionCost(type, model = "") {
  if (String(model || "").startsWith("veo")) return 1.6;
  if (String(model || "").startsWith("imagen")) return 0.04;
  if (String(model || "").includes("flash-image")) return 0.039;
  if (type === "video") return 0.25;
  if (type === "measurement") return 0.0035;
  if (type === "agent") return 0.0035;
  if (model === "grok-imagine-image-pro") return 0.07;
  return 0.02;
}

function actionCostHint(type, model = "") {
  return `This action costs ≈ ${formatUsd(previewActionCost(type, model))} before it runs.`;
}

function App() {
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [editFile, setEditFile] = useState(null);
  const [measurementProvider, setMeasurementProvider] = useState("xai");
  const [measurementModel, setMeasurementModel] = useState("grok-4.20-0309-reasoning");
  const [imageQuality, setImageQuality] = useState("auto");
  const [imageSize, setImageSize] = useState("auto");
  const [imageProvider, setImageProvider] = useState("openai");
  const [imageModel, setImageModel] = useState("gpt-image-2");
  const [videoQuality, setVideoQuality] = useState("standard");
  const [videoSize, setVideoSize] = useState("1280x720");
  const [videoProvider, setVideoProvider] = useState("openai");
  const [videoModel, setVideoModel] = useState("sora-2");
  const [editProvider, setEditProvider] = useState("xai");
  const [editModel, setEditModel] = useState("grok-imagine-image");
  const [editQuality, setEditQuality] = useState("high");
  const [shoppingGuide, setShoppingGuide] = useState(null);
  const [fitProfile, setFitProfile] = useState(buildEmptyFitProfile());
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [workflowState, setWorkflowState] = useState("idle");
  const [lastMeasurementProvider, setLastMeasurementProvider] = useState("openai");
  const [notice, setNotice] = useState({ tone: "neutral", text: "Upload model photos to begin a measurement-ready session." });
  const [usageLog, setUsageLog] = useState([]);
  const [mediaResults, setMediaResults] = useState([]);
  const [operation, setOperation] = useState({ type: "No active request", provider: "No provider active", status: "ready", step: -1, message: "Start a measurement, image edit, generation, or video job to see live provider stages here." });
  const [progressOverlay, setProgressOverlay] = useState(null);
  const [agentMessages, setAgentMessages] = useState([
    {
      id: "welcome",
      role: "agent",
      text: "Hi, I am your Grok Agent. I can inspect the active model image, plan image edits, write generation prompts, or prepare an image-to-video brief.",
      action: "none",
      steps: ["Choose or upload a model photo", "Ask for measurement, edit, image, or video direction"]
    }
  ]);
  const [agentInput, setAgentInput] = useState("");
  const [agentAttachImage, setAgentAttachImage] = useState(true);
  const [agentFile, setAgentFile] = useState(null);
  const [agentReference, setAgentReference] = useState(null);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [activeMode, setActiveMode] = useState("measure");
  const [assistantRoute, setAssistantRoute] = useState(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeActivity, setRouteActivity] = useState(null);
  const [minimalStyling, setMinimalStyling] = useState(null);
  const [isMinimalStyling, setIsMinimalStyling] = useState(false);
  const [editSession, setEditSession] = useState({
    status: "idle",
    requestedAt: "",
    completedAt: "",
    source: null,
    userPrompt: "",
    refinedPrompt: "",
    provider: "",
    model: "",
    reason: "",
    providerMessage: "",
    result: null,
    saved: []
  });
  const [localBudget, setLocalBudget] = useState(5);
  const [billingSnapshot, setBillingSnapshot] = useState(null);
  const [billingFilters, setBillingFilters] = useState({ provider: "all", type: "all", status: "all", query: "" });
  const [selectedBillingRow, setSelectedBillingRow] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("atelierTheme") || "light");
  const [commandOpen, setCommandOpen] = useState(false);
  const [projects, setProjects] = useState(() => loadStoredArray("atelierProjects", defaultProjects));
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem("atelierActiveProjectId") || defaultProjectId);
  const [promptLibrary, setPromptLibrary] = useState(() => loadStoredArray("atelierPromptLibrary", seedPromptLibrary()));
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [outputFilters, setOutputFilters] = useState({ query: "", provider: "all", type: "all" });
  const [compareItems, setCompareItems] = useState([]);
  const [imagePrompt, setImagePrompt] = useState("Luxury fashion model full-body editorial image, neutral studio background, accurate garment proportions, premium catalog lighting.");
  const [videoPrompt, setVideoPrompt] = useState("Fashion model turns slowly for a fit-review walk cycle, clean studio lighting, realistic fabric movement, professional campaign style.");
  const [editPrompt, setEditPrompt] = useState("Enhance this fashion model image with premium editorial lighting, keep the body proportions and garment shape consistent, clean background distractions, preserve realistic skin and fabric detail.");
  const inputRef = useRef(null);
  const editInputRef = useRef(null);
  const agentInputRef = useRef(null);
  const routeTimersRef = useRef([]);
  const measurementTimersRef = useRef([]);
  const todayStats = useMemo(() => buildTodayStats(usageLog), [usageLog]);
  const agentCost = useMemo(() => buildAgentCostStats(usageLog), [usageLog]);
  const budgetStatus = billingSnapshot?.budget || null;
  const videoBudgetBlocked = Boolean(budgetStatus?.videoDisabled || Number(budgetStatus?.remainingUsd ?? 5) < previewActionCost("video", videoModel));
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || projects[0] || defaultProjects[0],
    [projects, activeProjectId]
  );
  const projectMediaResults = useMemo(
    () => sortMediaResults(mediaResults.filter((item) => mediaBelongsToProject(item, activeProject?.id || defaultProjectId))),
    [mediaResults, activeProject]
  );
  const filteredProjectMedia = useMemo(
    () => filterMediaResults(projectMediaResults, outputFilters),
    [projectMediaResults, outputFilters]
  );
  const currentPrompt = activeMode === "edit" ? editPrompt : activeMode === "video" ? videoPrompt : imagePrompt;
  const currentRecommendation = useMemo(
    () => buildModelRecommendation(activeMode, {
      measurementProvider,
      measurementModel,
      imageProvider,
      imageModel,
      editProvider,
      editModel,
      videoProvider,
      videoModel,
      hasImage: Boolean(activeFile || editFile || agentReference)
    }),
    [activeMode, measurementProvider, measurementModel, imageProvider, imageModel, editProvider, editModel, videoProvider, videoModel, activeFile, editFile, agentReference]
  );

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("atelierUsageLog") || "[]");
      if (Array.isArray(saved)) setUsageLog(saved);
      const savedMedia = JSON.parse(localStorage.getItem("atelierMediaResults") || "[]");
      if (Array.isArray(savedMedia)) setMediaResults(sortMediaResults(savedMedia));
    } catch {
      setUsageLog([]);
      setMediaResults([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("atelierUsageLog", JSON.stringify(usageLog));
  }, [usageLog]);

  useEffect(() => {
    localStorage.setItem("atelierMediaResults", JSON.stringify(mediaResults));
  }, [mediaResults]);

  useEffect(() => {
    localStorage.setItem("atelierProjects", JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem("atelierActiveProjectId", activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    localStorage.setItem("atelierPromptLibrary", JSON.stringify(promptLibrary));
  }, [promptLibrary]);

  useEffect(() => {
    refreshBillingSnapshot();
  }, []);

  useEffect(() => {
    localStorage.setItem("atelierTheme", theme);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const addFiles = (incoming) => {
    const accepted = Array.from(incoming || []).filter((file) => file.type.startsWith("image/"));
    const mapped = accepted.map((file) => ({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      url: URL.createObjectURL(file)
    }));
    setFiles((current) => [...mapped, ...current]);
    if (mapped[0]) {
      selectReference(mapped[0], true);
    }
    if (mapped.length) {
      setNotice({ tone: "progress", text: "Reference added. Starting AI estimate." });
    }
  };

  const selectReference = (item, shouldMeasure = false) => {
    setActiveFile(item);
    setFitProfile(buildDraftFitProfile(item));
    setWorkflowState("uploaded");
    if (shouldMeasure) requestMeasurement(item);
  };

  const touchActiveProject = () => {
    setProjects((current) => current.map((project) => (
      project.id === activeProject.id ? { ...project, updatedAt: new Date().toISOString() } : project
    )));
  };

  const createProject = () => {
    const name = window.prompt("Project name", "New fashion concept");
    if (!name?.trim()) return;
    const now = new Date().toISOString();
    const project = {
      id: `project-${crypto.randomUUID()}`,
      name: name.trim(),
      description: "Creative workspace for related measurements, prompts and generated outputs.",
      createdAt: now,
      updatedAt: now
    };
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    setNotice({ tone: "success", text: `Project created · ${project.name}` });
  };

  const saveCurrentPrompt = () => {
    if (!currentPrompt.trim()) {
      setNotice({ tone: "warning", text: "Add a prompt before saving it to the library." });
      return;
    }
    const now = new Date().toISOString();
    const promptItem = {
      id: `prompt-${crypto.randomUUID()}`,
      title: promptTitle(currentPrompt),
      prompt: currentPrompt.trim(),
      negativePrompt: "",
      tags: inferPromptTags(currentPrompt, activeMode),
      type: activeMode === "edit" ? "edit" : activeMode === "video" ? "video" : "image",
      providerCompatibility: compatibleProvidersForMode(activeMode),
      favorite: true,
      projectId: activeProject.id,
      createdAt: now
    };
    setPromptLibrary((current) => [promptItem, ...current].slice(0, 80));
    setNotice({ tone: "success", text: "Prompt saved to library." });
  };

  const applyPromptFromLibrary = (promptItem) => {
    if (!promptItem?.prompt) return;
    if (activeMode === "video" || promptItem.type === "video") {
      setVideoPrompt(promptItem.prompt);
      setActiveMode("video");
    } else if (activeMode === "edit" || promptItem.type === "edit") {
      setEditPrompt(promptItem.prompt);
      setActiveMode("edit");
    } else {
      setImagePrompt(promptItem.prompt);
      setActiveMode("image");
    }
    setPromptLibraryOpen(false);
    setNotice({ tone: "success", text: `Prompt inserted · ${promptItem.title}` });
  };

  const togglePromptFavorite = (promptId) => {
    setPromptLibrary((current) => current.map((prompt) => prompt.id === promptId ? { ...prompt, favorite: !prompt.favorite } : prompt));
  };

  const enhanceSavedMedia = (saved, context = {}) => {
    const parentJobId = context.parentJobId || `job-${Date.now()}`;
    return saved.map((item, index) => ({
      ...item,
      projectId: activeProject.id,
      projectName: activeProject.name,
      parentJobId,
      variantIndex: index + 1,
      prompt: context.prompt || currentPrompt,
      sourceMode: context.mode || activeMode,
      resultType: context.resultType || item.label,
      isFavorite: Boolean(item.isFavorite)
    }));
  };

  const updateMediaItem = (id, updater) => {
    setMediaResults((current) => current.map((item) => item.id === id ? updater(item) : item));
  };

  const toggleMediaFavorite = (item) => {
    updateMediaItem(item.id, (current) => ({ ...current, isFavorite: !current.isFavorite }));
  };

  const reuseResultPrompt = (item) => {
    if (!item?.prompt) {
      setNotice({ tone: "warning", text: "This result does not include a reusable prompt." });
      return;
    }
    if (item.kind === "video" || item.sourceMode === "video") {
      setVideoPrompt(item.prompt);
      setActiveMode("video");
    } else if (item.label?.toLowerCase().includes("edit") || item.sourceMode === "edit") {
      setEditPrompt(item.prompt);
      setActiveMode("edit");
    } else {
      setImagePrompt(item.prompt);
      setActiveMode("image");
    }
    setNotice({ tone: "success", text: "Prompt reused from saved result." });
  };

  const generateSimilarFromResult = (item) => {
    const basePrompt = item?.prompt || "Create a similar premium fashion editorial image with the same visual direction.";
    setImagePrompt(`${basePrompt}\n\nCreate a close visual variant with a fresh pose, refined styling, and consistent fashion editorial quality.`);
    setImageProvider(providerValueFromLabel(item?.provider) || imageProvider);
    setActiveMode("image");
    setNotice({ tone: "progress", text: "Similar-generation prompt prepared." });
  };

  const animateResultToVideo = (item) => {
    if (!item) return;
    setAgentReference(item);
    setVideoPrompt(`Animate this saved fashion result into a smooth model turn/walk cycle. Keep the subject, outfit, styling, and lighting consistent. Cinematic camera movement, realistic fabric motion, no text or logos.`);
    setVideoProvider("gemini");
    setVideoModel(videoModelOptions.gemini[0].value);
    setActiveMode("video");
    setNotice({ tone: "progress", text: "Image-to-video setup prepared with Gemini Veo." });
  };

  const toggleCompareItem = (item) => {
    setCompareItems((current) => {
      if (current.some((entry) => entry.id === item.id)) return current.filter((entry) => entry.id !== item.id);
      return [item, ...current].slice(0, 4);
    });
  };

  const applyRecommendation = (recommendation = currentRecommendation) => {
    if (!recommendation?.provider) return;
    if (activeMode === "measure") {
      setMeasurementProvider(recommendation.provider);
      setMeasurementModel(recommendation.model);
    } else if (activeMode === "image") {
      setImageProvider(recommendation.provider);
      setImageModel(recommendation.model);
    } else if (activeMode === "edit") {
      setEditProvider(recommendation.provider === "openai" ? "xai" : recommendation.provider);
      setEditModel(recommendation.model);
    } else if (activeMode === "video") {
      setVideoProvider(recommendation.provider);
      setVideoModel(recommendation.model);
    }
    setNotice({ tone: "success", text: `Recommended model applied · ${recommendation.providerLabel}` });
  };

  const requestMeasurement = async (item, forcedProvider = measurementProvider) => {
    const selectedModel = forcedProvider === "xai" ? "grok-4.20-0309-reasoning" : measurementModel;
    const formData = new FormData();
    formData.append("reference", item.file);
    formData.append("provider", forcedProvider);
    formData.append("model", selectedModel);
    startMeasurementActivity(forcedProvider, selectedModel);
    setIsMeasuring(true);
    setWorkflowState("analyzing");
    setProgressOverlay({ type: "Measurement", provider: providerLabel(forcedProvider), label: "Analysing", progress: 28, quality: "Vision" });
    setNotice({ tone: "progress", text: `${providerLabel(forcedProvider)} measurement estimate running.` });

    try {
      const response = await fetch("/api/measure-image", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Measurement request failed.");
      if (result.status !== "completed") {
        setNotice({ tone: "warning", text: compactMessage(result.message || "Measurement endpoint is ready.") });
        setOperation({
          type: "Measurement analysis",
          provider: providerLabel(forcedProvider),
          model: selectedModel,
          status: "failed",
          step: 1,
          message: compactMessage(result.message || "Provider is not ready for measurement.")
        });
        return;
      }

      setFitProfile(buildAiFitProfile({ ...result.measurement, recommendations: result.recommendations }, result.model, result.provider));
      setLastMeasurementProvider(result.provider || forcedProvider);
      if (result.usage) {
        setUsageLog((current) => [buildUsageEntry("Measurement", result.usage), ...current].slice(0, 8));
      }
      refreshBillingSnapshot();
      setWorkflowState("completed");
      const scoreText = result.measurement.confidenceScore ? `${result.measurement.confidenceScore}%` : result.measurement.confidence || "available";
      setNotice({ tone: "success", text: `Completed via ${result.provider === "xai" ? "Grok/xAI" : "OpenAI"} API · confidence ${scoreText}` });
      setOperation({
        type: "Measurement analysis",
        provider: providerLabel(result.provider || forcedProvider),
        model: result.model || selectedModel,
        status: "completed",
        step: 3,
        message: `${result.provider === "xai" ? "Grok/xAI" : "OpenAI"} returned measurements, UK sizing, and confidence ${scoreText}.`
      });
      setProgressOverlay({ type: "Measurement", provider: providerLabel(result.provider || forcedProvider), label: "Completed", progress: 100, quality: "Vision", done: true });
      setTimeout(() => setProgressOverlay(null), 1400);
    } catch (error) {
      setWorkflowState("fallback");
      setOperation({
        type: "Measurement analysis",
        provider: providerLabel(forcedProvider),
        model: selectedModel,
        status: "failed",
        step: 1,
        message: compactMessage(error.message)
      });
      setProgressOverlay({ type: "Measurement", provider: providerLabel(forcedProvider), label: "Fallback", progress: 100, quality: "Vision", failed: true });
      setTimeout(() => setProgressOverlay(null), 1600);
      setNotice({ tone: "warning", text: compactMessage(error.message) });
      setFitProfile(buildDraftFitProfile(item, "AI estimate failed; showing draft fallback."));
    } finally {
      clearMeasurementTimers();
      setIsMeasuring(false);
    }
  };

  const callGeneration = async (type) => {
    const formData = new FormData();
    const endpoint = type === "image" ? "/api/generate-image" : "/api/generate-video";
    const prompt = type === "image" ? imagePrompt : videoPrompt;

    formData.append("prompt", prompt);
    if (type === "image") {
      formData.append("provider", imageProvider);
      formData.append("model", imageModel);
      formData.append("quality", imageQuality);
      formData.append("size", imageSize);
      files.slice(0, 8).forEach((item) => formData.append("references", item.file));
    } else {
      formData.append("provider", videoProvider);
      formData.append("model", videoModel);
      formData.append("quality", videoQuality);
      formData.append("size", videoSize);
      formData.append("seconds", videoProvider === "gemini" ? "4" : "8");
      await appendReferenceToFormData(formData, activeFile || agentReference);
    }

    const provider = type === "image" ? imageProvider : videoProvider;
    const model = type === "image" ? imageModel : videoModel;
    setProgressOverlay({
      type: type === "image" ? "Image generation" : "Video generation",
      provider: providerLabel(provider),
      label: type === "image" ? "Generating" : "Generating video",
      progress: type === "image" ? 35 : 24,
      quality: type === "image" ? imageQuality.toUpperCase() : videoSize.includes("720") ? "720p" : "1080p",
      cancellable: type === "video"
    });
    setOperation({ type: type === "image" ? "Image generation" : "Video generation", provider: providerLabel(provider), model, status: "running", step: 1, message: "Sending request to model API." });
    setNotice({ tone: "progress", text: type === "image" ? "Image generation request prepared." : "Video render request prepared." });

    try {
      const response = await fetch(endpoint, { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request failed.");
      const saved = enhanceSavedMedia(
        normalizeSavedMedia(result.saved, type, result.provider || provider, result.model || model),
        { prompt, mode: type, resultType: type === "video" ? "Generated video" : "Generated image" }
      );
      if (saved.length) {
        setMediaResults((current) => mergeMediaResults(current, saved).slice(0, 24));
        touchActiveProject();
        if (type === "image") {
          setAgentReference(saved[0]);
          setAgentFile(null);
        }
      }
      setOperation({
        type: type === "image" ? "Image generation" : "Video generation",
        provider: providerLabel(result.provider || provider),
        model: result.model || model,
        status: result.status === "queued" ? "queued" : "completed",
        step: saved.length ? 3 : 2,
        message: saved.length ? "Result received and saved locally." : "Request accepted. Waiting for final media URL."
      });
      setProgressOverlay({
        type: type === "image" ? "Image generation" : "Video generation",
        provider: providerLabel(result.provider || provider),
        label: result.status === "queued" ? "Queued" : "Completed",
        progress: result.status === "queued" ? 72 : 100,
        quality: type === "image" ? imageQuality.toUpperCase() : videoSize.includes("720") ? "720p" : "1080p",
        done: result.status !== "queued"
      });
      if (result.status !== "queued") setTimeout(() => setProgressOverlay(null), 1400);
      setUsageLog((current) => [
        buildUsageEntry(type === "image" ? "Image" : "Video", {
          model: result.model || (type === "image" ? imageModel : videoModel),
          provider: result.provider || (type === "image" ? imageProvider : videoProvider),
          costUsd: result.costUsd || result.usage?.costUsd || 0,
          status: result.status
        }),
        ...current
      ].slice(0, 16));
      refreshBillingSnapshot();
      setNotice({ tone: "success", text: compactMessage(result.message || (type === "image" ? "Image generation completed." : "Video job queued.")) });
      if (type === "video" && result.status === "queued" && result.job?.pollUrl) {
        pollQueuedVideoJob(result.job, result.provider || provider, result.model || model);
      }
    } catch (error) {
      setOperation({ type: type === "image" ? "Image generation" : "Video generation", provider: providerLabel(provider), model, status: "failed", step: 1, message: compactMessage(error.message) });
      setProgressOverlay({ type: type === "image" ? "Image generation" : "Video generation", provider: providerLabel(provider), label: "Failed", progress: 100, quality: type === "image" ? imageQuality.toUpperCase() : "Video", failed: true });
      setTimeout(() => setProgressOverlay(null), 1600);
      setNotice({ tone: "warning", text: compactMessage(error.message) });
    }
  };

  const pollQueuedVideoJob = async (job, provider, model) => {
    const pollUrl = job?.pollUrl;
    if (!pollUrl) return;
    setOperation({
      type: "Video generation",
      provider: providerLabel(provider),
      model,
      status: "queued",
      step: 2,
      message: "Provider accepted the video job. Checking for the final MP4."
    });
    setProgressOverlay({
      type: "Video generation",
      provider: providerLabel(provider),
      label: "Rendering",
      progress: Math.max(35, Number(job.progress || 35)),
      quality: videoSize.includes("720") ? "720p" : "1080p",
      cancellable: true
    });

    for (let attempt = 1; attempt <= 36; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 4 ? 5000 : 10000));
      try {
        const response = await fetch(pollUrl);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Video status check failed.");
        const progress = Math.max(40, Math.min(92, Number(result.video?.progress ?? result.job?.progress ?? 40 + attempt * 3)));
        const saved = enhanceSavedMedia(
          normalizeSavedMedia(result.saved, "video", result.provider || provider, result.model || model),
          { prompt: videoPrompt, mode: "video", resultType: "Generated video" }
        );

        if (saved.length || result.status === "completed") {
          if (saved.length) setMediaResults((current) => mergeMediaResults(current, saved).slice(0, 24));
          if (saved.length) touchActiveProject();
          setOperation({
            type: "Video generation",
            provider: providerLabel(result.provider || provider),
            model: result.model || model,
            status: saved.length ? "completed" : "completed",
            step: saved.length ? 3 : 2,
            message: saved.length ? "Video received and saved locally." : "Video completed, but no downloadable media was returned."
          });
          setProgressOverlay({
            type: "Video generation",
            provider: providerLabel(result.provider || provider),
            label: saved.length ? "Completed" : "Completed",
            progress: 100,
            quality: videoSize.includes("720") ? "720p" : "1080p",
            done: Boolean(saved.length)
          });
          setTimeout(() => setProgressOverlay(null), 1600);
          setNotice({ tone: saved.length ? "success" : "warning", text: saved.length ? "Video completed and saved locally." : "Video completed but no file was returned to save." });
          refreshBillingSnapshot();
          return;
        }

        setOperation({
          type: "Video generation",
          provider: providerLabel(result.provider || provider),
          model: result.model || model,
          status: result.status || "queued",
          step: 2,
          message: "Video is still rendering with the provider."
        });
        setProgressOverlay((current) => current ? { ...current, label: "Rendering", progress } : current);
      } catch (error) {
        setOperation({
          type: "Video generation",
          provider: providerLabel(provider),
          model,
          status: "failed",
          step: 2,
          message: compactMessage(error.message)
        });
        setProgressOverlay({ type: "Video generation", provider: providerLabel(provider), label: "Status check failed", progress: 100, quality: "Video", failed: true });
        setTimeout(() => setProgressOverlay(null), 1600);
        setNotice({ tone: "warning", text: compactMessage(error.message) });
        return;
      }
    }

    setOperation({
      type: "Video generation",
      provider: providerLabel(provider),
      model,
      status: "queued",
      step: 2,
      message: "Video is still rendering. Use returned media refresh later to pick up the saved file."
    });
    setProgressOverlay(null);
    setNotice({ tone: "progress", text: "Video job is still rendering with the provider." });
  };

  const callImageEdit = async () => {
    const source = editFile || agentReference || activeFile;
    if (!validateEditInputs(source, editPrompt)) return;
    await callAssistantRouter({ mode: "edit", message: editPrompt, reference: source });
  };

  const callMinimalStyling = async () => {
    const source = editFile || agentReference || activeFile;
    if (!source) {
      setNotice({ tone: "warning", text: "Upload or select an image before Minimal Styling." });
      return;
    }
    if (isMinimalStyling || isRouting) {
      setNotice({ tone: "progress", text: "A styling workflow is already running." });
      return;
    }

    const formData = new FormData();
    await appendReferenceToFormData(formData, source);
    formData.append("model", editModel);
    formData.append("quality", editQuality);
    formData.append("size", imageSize);
    formData.append("userNote", "One-click Minimal Styling: safe lighter, simpler, tasteful fashion styling.");

    const started = {
      status: "running",
      finalOutcome: "running",
      message: "OpenAI is checking policy and preparing safe Minimal Styling prompts.",
      attempts: [],
      events: [
        { stage: "request", status: "accepted", providerResponse: "Image attached. Safety planner starting." },
        { stage: "planner", status: "running", providerResponse: "OpenAI is preparing one primary and one fallback compliant prompt." }
      ]
    };
    setMinimalStyling(started);
    setIsMinimalStyling(true);
    beginEditSession({
      source,
      prompt: "One-click Minimal Styling: safe lighter, simpler, tasteful fashion styling.",
      provider: "OpenAI safety planner",
      model: editModel,
      reason: "OpenAI checks policy first, then Grok gets at most two compliant edit attempts.",
      message: started.message
    });
    setOperation({ type: "Minimal Styling", provider: "OpenAI + Grok / xAI", model: editModel, status: "running", step: 1, message: started.message });
    setNotice({ tone: "progress", text: "Minimal Styling started. Max 2 safe attempts." });

    try {
      const response = await fetch("/api/minimal-styling", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok && !["stopped", "blocked"].includes(result.status)) throw new Error(result.error || result.message || "Minimal Styling failed.");

      setMinimalStyling(result);
      const saved = enhanceSavedMedia(
        normalizeSavedMedia(result.saved, "image", result.provider || "xai", result.model || editModel, "Minimal styling"),
        { prompt: result.attempts?.find((attempt) => attempt.prompt)?.prompt || result.plan?.primaryPrompt || editPrompt, mode: "edit", resultType: "Minimal styling" }
      );
      if (saved.length) {
        setMediaResults((current) => mergeMediaResults(current, saved).slice(0, 24));
        touchActiveProject();
        setAgentReference(saved[0]);
        setAgentFile(null);
      }
      completeEditSession({
        status: result.status === "completed" ? "completed" : result.status,
        refinedPrompt: result.attempts?.find((attempt) => attempt.prompt)?.prompt || result.plan?.primaryPrompt || "",
        provider: "OpenAI + Grok / xAI",
        model: result.model || editModel,
        reason: result.plan?.userMessage || "Minimal Styling used a policy-aware prompt and a controlled retry limit.",
        message: result.message || "Minimal Styling finished.",
        result: saved.find((item) => item.kind === "image") || null,
        saved
      });
      const totalCost = (result.events || []).reduce((sum, item) => sum + Number(item.estimatedCostUsd || 0), 0);
      setUsageLog((current) => [
        buildUsageEntry("Image", {
          model: result.model || editModel,
          provider: "xai",
          costUsd: totalCost,
          status: result.finalOutcome || result.status
        }),
        ...current
      ].slice(0, 16));
      refreshBillingSnapshot();
      setOperation({
        type: "Minimal Styling",
        provider: "OpenAI + Grok / xAI",
        model: result.model || editModel,
        status: result.status === "completed" ? "completed" : result.status,
        step: saved.length ? 3 : 2,
        message: result.message || "Minimal Styling finished."
      });
      setNotice({
        tone: result.status === "completed" ? "success" : "warning",
        text: compactMessage(result.message || "Minimal Styling finished.")
      });
    } catch (error) {
      const text = compactMessage(error.message);
      setMinimalStyling((current) => ({
        ...(current || {}),
        status: "failed",
        finalOutcome: "failed",
        message: text,
        events: [...(current?.events || []), { stage: "request", status: "failed", providerResponse: text }]
      }));
      completeEditSession({
        status: "failed",
        provider: "OpenAI + Grok / xAI",
        model: editModel,
        message: text
      });
      setOperation({ type: "Minimal Styling", provider: "OpenAI + Grok / xAI", model: editModel, status: "failed", step: 1, message: text });
      setNotice({ tone: "warning", text });
    } finally {
      setIsMinimalStyling(false);
    }
  };

  const sendAgentMessage = async () => {
    const message = agentInput.trim();
    if (!message || isAgentThinking) return;

    const attached = agentAttachImage ? (agentFile || agentReference || editFile || activeFile) : null;
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: message,
      attachment: mediaAttachment(attached)
    };
    setAgentMessages((current) => [...current, userMessage]);
    setAgentInput("");
    setIsAgentThinking(true);
    setProgressOverlay({ type: "Grok Agent", provider: "Grok / xAI", label: "Thinking", progress: 42, quality: "Agent" });

    const formData = new FormData();
    formData.append("message", message);
    formData.append("model", "grok-4.20-0309-non-reasoning");
    formData.append("context", JSON.stringify({
      activeImage: activeFile?.file.name || null,
      editImage: editFile?.file.name || null,
      measurementProvider,
      imageProvider,
      videoProvider,
      editProvider,
      selectedModels: { measurementModel, imageModel, videoModel, editModel }
    }));

    if (attached) await appendReferenceToFormData(formData, attached);

    try {
      const response = await fetch("/api/grok-agent-chat", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Grok Agent chat failed.");
      const agent = result.agent || {};
      const agentMessage = {
        id: crypto.randomUUID(),
        role: "agent",
        text: agent.reply || "I prepared a suggestion.",
        action: agent.action || "none",
        prompt: agent.prompt || "",
        steps: Array.isArray(agent.steps) ? agent.steps : [],
        confidence: agent.confidence || "medium",
        attachment: mediaAttachment(attached)
      };
      setAgentMessages((current) => [
        ...current,
        agentMessage
      ]);
      if (result.usage) {
        setUsageLog((current) => [buildUsageEntry("Agent", result.usage), ...current].slice(0, 16));
        refreshBillingSnapshot();
      }
      if (shouldAutoRunAgentAction(agentMessage)) {
        await runAgentAction(agentMessage, attached);
      } else {
        setProgressOverlay({ type: "Grok Agent", provider: "Grok / xAI", label: "Ready", progress: 100, quality: "Agent", done: true });
        setTimeout(() => setProgressOverlay(null), 1100);
      }
    } catch (error) {
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: compactMessage(error.message), action: "none", steps: [] }
      ]);
      setProgressOverlay({ type: "Grok Agent", provider: "Grok / xAI", label: "Failed", progress: 100, quality: "Agent", failed: true });
      setTimeout(() => setProgressOverlay(null), 1400);
    } finally {
      setIsAgentThinking(false);
    }
  };

  const applyAgentAction = (message) => {
    if (!message.prompt && message.action !== "measure") return;
    if (agentFile) {
      setEditFile(agentFile);
      setActiveFile(agentFile);
    }
    if (message.action === "edit_image") {
      setEditPrompt(message.prompt);
      setEditModel("grok-imagine-image");
      setNotice({ tone: "progress", text: "Agent prompt copied to image edit." });
    } else if (message.action === "generate_image") {
      setImageProvider("xai");
      setImageModel("grok-imagine-image");
      setImagePrompt(message.prompt);
      setNotice({ tone: "progress", text: "Agent prompt copied to Grok image generation." });
    } else if (message.action === "generate_video") {
      setVideoProvider("xai");
      setVideoModel("grok-imagine-video");
      setVideoPrompt(message.prompt);
      setNotice({ tone: "progress", text: "Agent prompt copied to Grok video generation." });
    } else if (message.action === "measure") {
      setMeasurementProvider("xai");
      setMeasurementModel("grok-4.20-0309-reasoning");
      setNotice({ tone: "progress", text: "Measurement set to Grok analysis." });
    }
  };

  const runAgentAction = async (message, source) => {
    const action = message.action;
    const prompt = message.prompt || message.text;
    if (!prompt || action === "none" || action === "measure") return;

    if (action === "edit_image" && !source) {
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: "Attach or select a reference image first, then I can run the edit.", action: "none", steps: [] }
      ]);
      return;
    }

    const isVideo = action === "generate_video";
    const isEdit = action === "edit_image";
    if (isEdit) {
      if (!validateEditInputs(source, prompt)) return;
      setEditPrompt(prompt);
      setActiveMode("edit");
      setAgentMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: "I sent this image edit through the guided OpenAI routing workflow. The Image Edit workspace will show the source image, refined prompt, provider decision, result, and saved location.",
          action: "none",
          steps: ["Prepared edit prompt", "Attached reference image", "Started guided edit route"]
        }
      ]);
      setProgressOverlay(null);
      await callAssistantRouter({ mode: "edit", message: prompt, reference: source });
      return;
    }
    const endpoint = isVideo ? "/api/generate-video" : "/api/generate-image";
    const formData = new FormData();
    formData.append("prompt", prompt);

    if (isVideo) {
      formData.append("provider", "xai");
      formData.append("model", "grok-imagine-video");
      formData.append("quality", videoQuality);
      formData.append("size", videoSize);
      formData.append("seconds", "8");
      if (source) await appendReferenceToFormData(formData, source);
    } else {
      formData.append("provider", "xai");
      formData.append("model", "grok-imagine-image");
      formData.append("quality", imageQuality);
      formData.append("size", imageSize);
    }

    const title = isEdit ? "Agent image edit" : isVideo ? "Agent video generation" : "Agent image generation";
    setOperation({ type: title, provider: "Grok / xAI", model: isVideo ? "grok-imagine-video" : "grok-imagine-image", status: "running", step: 1, message: "Grok Agent action is running." });
    setProgressOverlay({ type: title, provider: "Grok / xAI", label: isVideo ? "Generating video" : isEdit ? "Editing" : "Generating", progress: isVideo ? 24 : 38, quality: isVideo ? "720p" : "2K", cancellable: isVideo });

    try {
      const response = await fetch(endpoint, { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Agent action failed.");
      const saved = enhanceSavedMedia(
        normalizeSavedMedia(
          result.saved,
          isVideo ? "video" : "image",
          result.provider || "xai",
          result.model || (isVideo ? "grok-imagine-video" : "grok-imagine-image"),
          isEdit ? "Agent edited image" : isVideo ? "Agent video" : "Agent generated image"
        ),
        { prompt: message.prompt || message.text || agentInput, mode: isVideo ? "video" : isEdit ? "edit" : "image", resultType: isEdit ? "Agent edited image" : isVideo ? "Agent video" : "Agent generated image" }
      );

      if (saved.length) {
        setMediaResults((current) => mergeMediaResults(current, saved).slice(0, 24));
        touchActiveProject();
        const nextImage = saved.find((item) => item.kind === "image");
        if (nextImage) {
          setAgentReference(nextImage);
          setAgentFile(null);
        }
      }

      setUsageLog((current) => [
        buildUsageEntry(isVideo ? "Video" : "Image", {
          model: result.model || (isVideo ? "grok-imagine-video" : "grok-imagine-image"),
          provider: "xai",
          costUsd: result.costUsd || result.usage?.costUsd || (isVideo ? 0.25 : 0.02),
          status: result.status
        }),
        ...current
      ].slice(0, 16));
      refreshBillingSnapshot();

      const resultMessage = saved.length
        ? `${isVideo ? "Video" : "Image"} returned from Grok and saved locally.`
        : isVideo
          ? "Grok accepted the video job. The app will save the video when the provider returns a final media URL."
          : "Grok completed the request, but no downloadable media file was returned.";

      setAgentMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: resultMessage,
          action: "none",
          steps: saved.length ? ["API returned media", "Saved in local outputs folder", "Ready for the next instruction"] : ["API accepted request", "Waiting for final media URL"],
          media: saved
        }
      ]);

      setOperation({ type: title, provider: "Grok / xAI", model: result.model || "", status: result.status === "queued" ? "queued" : "completed", step: saved.length ? 3 : 2, message: resultMessage });
      setProgressOverlay({ type: title, provider: "Grok / xAI", label: result.status === "queued" ? "Queued" : "Completed", progress: result.status === "queued" ? 72 : 100, quality: isVideo ? "720p" : "2K", done: result.status !== "queued" });
      if (result.status !== "queued") setTimeout(() => setProgressOverlay(null), 1300);
      setNotice({ tone: saved.length ? "success" : "progress", text: compactMessage(resultMessage) });
    } catch (error) {
      const text = compactMessage(error.message);
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text, action: "none", steps: ["Action failed", "Adjust prompt or billing and retry"] }
      ]);
      setOperation({ type: title, provider: "Grok / xAI", model: "", status: "failed", step: 1, message: text });
      setProgressOverlay({ type: title, provider: "Grok / xAI", label: "Failed", progress: 100, quality: isVideo ? "Video" : "Image", failed: true });
      setTimeout(() => setProgressOverlay(null), 1500);
      setNotice({ tone: "warning", text });
    }
  };

  const runPrimaryAction = () => {
    if (["measure", "image", "edit", "video"].includes(activeMode)) {
      callAssistantRouter();
    } else if (activeMode === "agent" && agentInput.trim()) {
      sendAgentMessage();
    } else if (activeMode === "billing") {
      refreshBillingSnapshot();
    }
  };

  const refreshBillingSnapshot = async () => {
    try {
      const response = await fetch("/api/billing/summary");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Billing summary unavailable.");
      setBillingSnapshot(result);
      const manifestMedia = (result.recentAssets || []).map(manifestToMediaResult).filter(Boolean);
      if (manifestMedia.length) {
        setMediaResults((current) => mergeMediaResults(current, manifestMedia).slice(0, 60));
      }
      if (activeMode === "billing") setNotice({ tone: "success", text: "Billing snapshot refreshed." });
    } catch (error) {
      setNotice({ tone: "warning", text: compactMessage(error.message) });
    }
  };

  const clearRouteTimers = () => {
    routeTimersRef.current.forEach((timer) => clearTimeout(timer));
    routeTimersRef.current = [];
  };

  const clearMeasurementTimers = () => {
    measurementTimersRef.current.forEach((timer) => clearTimeout(timer));
    measurementTimersRef.current = [];
  };

  const startMeasurementActivity = (provider, model) => {
    clearMeasurementTimers();
    const label = providerLabel(provider);
    const shortProvider = provider === "xai" ? "Grok/xAI" : "OpenAI";
    setOperation({
      type: "Measurement analysis",
      provider: label,
      model,
      status: "running",
      step: 0,
      message: `Preparing the uploaded image for ${shortProvider} vision measurement.`
    });
    measurementTimersRef.current = [
      setTimeout(() => {
        setOperation((current) => current.type === "Measurement analysis"
          ? { ...current, step: 1, message: `Sending the image to ${shortProvider} using ${model}.` }
          : current);
      }, 450),
      setTimeout(() => {
        setOperation((current) => current.type === "Measurement analysis"
          ? { ...current, step: 2, message: `${shortProvider} is reading body proportions, confidence, and sizing signals.` }
          : current);
      }, 1300)
    ];
  };

  const startRouteActivity = (routeMode, reference) => {
    clearRouteTimers();
    const steps = buildRouteSteps(routeMode);
    const title = routeMode === "edit" ? "Editing existing image" : routeMode === "image" ? "Creating new image" : routeMode === "video" ? "Preparing video" : "Running measurement";
    const detail = routeMode === "edit"
      ? `Using ${reference?.file?.name || reference?.filename || "selected image"} and your edit prompt.`
      : "OpenAI is reading the prompt and current workspace context.";
    setAssistantRoute(null);
    setRouteActivity({ mode: routeMode, title, detail, stage: 0, steps });
    setOperation({ type: title, provider: "OpenAI", model: "router", status: "running", step: 0, message: steps[0].detail });

    routeTimersRef.current = [
      setTimeout(() => {
        setRouteActivity((current) => current && { ...current, stage: 1 });
        setOperation((current) => ({ ...current, step: 1, message: steps[1].detail }));
      }, 650),
      setTimeout(() => {
        setRouteActivity((current) => current && { ...current, stage: 2 });
        setOperation((current) => ({ ...current, step: 2, message: steps[2].detail }));
      }, 2200),
      setTimeout(() => {
        setRouteActivity((current) => current && { ...current, detail: "Still waiting for the AI provider. Large image edits can take longer; the request is still active." });
      }, 9000)
    ];
  };

  const validateEditInputs = (source, prompt) => {
    if (!source) {
      setNotice({ tone: "warning", text: "Choose an image before starting the edit workflow." });
      return false;
    }
    if (!prompt.trim()) {
      setNotice({ tone: "warning", text: "Write the edit instruction before routing the image." });
      return false;
    }
    if (prompt.trim().length < 8) {
      setNotice({ tone: "warning", text: "Add a little more detail so AI knows what to edit." });
      return false;
    }
    if (source.file) {
      if (!source.file.type?.startsWith("image/")) {
        setNotice({ tone: "warning", text: "The edit reference must be an image file." });
        return false;
      }
      if (source.file.size > 25 * 1024 * 1024) {
        setNotice({ tone: "warning", text: "Image is too large for this workflow. Please use a file under 25 MB." });
        return false;
      }
    }
    return true;
  };

  const beginEditSession = ({ source, prompt, provider = "OpenAI routing", model = "router", reason, message }) => {
    setEditSession({
      status: "running",
      requestedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      completedAt: "",
      source: mediaAttachment(source),
      userPrompt: prompt,
      refinedPrompt: "",
      provider,
      model,
      reason: reason || "OpenAI is reading the source image, prompt, and workspace context before selecting the edit provider.",
      providerMessage: message || "Preparing edit workflow.",
      result: null,
      saved: []
    });
  };

  const completeEditSession = ({ status = "completed", refinedPrompt = "", provider, model, reason, message, result = null, saved = [] }) => {
    setEditSession((current) => ({
      ...current,
      status,
      completedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      refinedPrompt: refinedPrompt || current.refinedPrompt || current.userPrompt,
      provider: provider || current.provider,
      model: model || current.model,
      reason: reason || current.reason,
      providerMessage: message || current.providerMessage,
      result: result || current.result,
      saved: saved.length ? saved : current.saved
    }));
  };

  const openSavedLocation = async (item) => {
    try {
      const response = await fetch("/api/open-output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, url: item.url })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open the saved location.");
      setNotice({ tone: "success", text: `Saved location opened Â· ${item.filename || "output file"}` });
    } catch (error) {
      setNotice({ tone: "warning", text: compactMessage(error.message) });
    }
  };

  const callAssistantRouter = async (options = {}) => {
    if (isRouting) {
      setNotice({ tone: "progress", text: "A workflow is already running. Please wait for the current request." });
      return;
    }

    const routeMode = options.mode || activeMode;
    const promptByMode = {
      measure: "Analyze this uploaded model image for measurement and UK sizing. Recommend the best next workflow step.",
      image: imagePrompt,
      edit: editPrompt,
      video: videoPrompt,
      agent: agentInput || "Suggest the best next step for this active image workflow."
    };
    const message = options.message || promptByMode[routeMode] || imagePrompt;
    const reference = options.reference || (routeMode === "edit" ? (editFile || agentReference || activeFile) : routeMode === "agent" ? (agentFile || agentReference || activeFile) : activeFile);

    if (!message.trim()) {
      setNotice({ tone: "warning", text: "Add a prompt before asking OpenAI to route the workflow." });
      return;
    }
    if (routeMode === "edit" && !reference) {
      setNotice({ tone: "warning", text: "Upload or select an image before starting an edit workflow." });
      return;
    }
    if (routeMode === "edit") {
      if (!validateEditInputs(reference, message)) return;
      beginEditSession({
        source: reference,
        prompt: message,
        provider: "OpenAI routing",
        model: "router",
        message: "Preparing edit workflow."
      });
    }

    const formData = new FormData();
    formData.append("message", message);
    formData.append("currentMode", routeMode);
    formData.append("execute", "true");
    formData.append("quality", routeMode === "edit" ? editQuality : imageQuality);
    formData.append("size", routeMode === "video" ? videoSize : imageSize);
    formData.append("seconds", routeMode === "video" && videoProvider === "gemini" ? "4" : "8");
    formData.append("context", JSON.stringify({
      activeMode: routeMode,
      selectedModels: { measurementModel, imageModel, videoModel, editModel },
      selectedProviders: { measurementProvider, imageProvider, videoProvider, editProvider },
      activeImage: activeFile?.file?.name || null,
      editImage: editFile?.file?.name || null,
      existingResults: mediaResults.length
    }));
    if (reference) await appendReferenceToFormData(formData, reference);

    setIsRouting(true);
    startRouteActivity(routeMode, reference);
    setNotice({ tone: "progress", text: routeMode === "edit" ? "Edit workflow started. OpenAI is preparing the image and prompt." : "OpenAI orchestration is routing the request." });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch("/api/assistant/route", { method: "POST", body: formData, signal: controller.signal });
      clearTimeout(timeout);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "OpenAI orchestration failed.");

      setAssistantRoute(result);
      const plan = result.plan || {};
      const execution = result.execution || {};
      setRouteActivity({ mode: plan.mode || routeMode, title: "Workflow completed", detail: plan.user_visible_explanation || "The AI route finished.", stage: 3, steps: buildRouteSteps(plan.mode || routeMode) });
      if (routeMode === "edit" || plan.mode === "edit") {
        completeEditSession({
          status: execution.status === "completed" ? "completed" : execution.status || "completed",
          refinedPrompt: plan.prompt_improvements || message,
          provider: providerLabel(execution.provider || plan.recommended_provider),
          model: execution.model || plan.recommended_model || "router",
          reason: plan.user_visible_explanation || "OpenAI selected the edit route based on the uploaded image and prompt.",
          message: execution.status ? `Provider execution: ${execution.status}` : "Edit route completed.",
          result: null,
          saved: []
        });
      }

      if (plan.prompt_improvements) {
        if (plan.mode === "image") setImagePrompt(plan.prompt_improvements);
        if (plan.mode === "edit") setEditPrompt(plan.prompt_improvements);
        if (plan.mode === "video") setVideoPrompt(plan.prompt_improvements);
      }
      if (plan.mode && plan.mode !== activeMode) setActiveMode(plan.mode);
      if (plan.recommended_provider === "openai") {
        if (plan.mode === "measure") setMeasurementProvider("openai");
        if (plan.mode === "image") setImageProvider("openai");
        if (plan.mode === "video") setVideoProvider("openai");
      }
      if (plan.recommended_provider === "xai") {
        if (plan.mode === "measure") setMeasurementProvider("xai");
        if (plan.mode === "image") setImageProvider("xai");
        if (plan.mode === "video") setVideoProvider("xai");
      }
      if (plan.recommended_provider === "gemini") {
        if (plan.mode === "measure") setMeasurementProvider("gemini");
        if (plan.mode === "image") setImageProvider("gemini");
        if (plan.mode === "edit") setEditProvider("gemini");
        if (plan.mode === "video") setVideoProvider("gemini");
      }

      if (execution.measurement) {
        setFitProfile(buildAiFitProfile(execution.measurement, execution.model, execution.provider));
        setLastMeasurementProvider(execution.provider || "openai");
        setWorkflowState("completed");
      }

      if (execution.costUsd || execution.usage?.costUsd) {
        setUsageLog((current) => [
          buildUsageEntry(plan.mode === "video" ? "Video" : plan.mode === "measure" ? "Measurement" : "Image", {
            model: execution.model || plan.recommended_model,
            provider: execution.provider || plan.recommended_provider,
            costUsd: execution.costUsd || execution.usage?.costUsd || 0,
            status: execution.status || "completed"
          }),
          ...current
        ].slice(0, 16));
        refreshBillingSnapshot();
      }

      const saved = enhanceSavedMedia(
        normalizeSavedMedia(execution.saved, plan.mode === "video" ? "video" : "image", execution.provider || plan.recommended_provider, execution.model || plan.recommended_model, "Assistant routed result"),
        {
          prompt: plan.prompt_improvements || message,
          mode: plan.mode || routeMode,
          resultType: readableIntent(plan.intent || plan.mode || routeMode)
        }
      );
      if (saved.length) {
        setMediaResults((current) => mergeMediaResults(current, saved).slice(0, 24));
        touchActiveProject();
        const firstImage = saved.find((item) => item.kind === "image");
        if (firstImage) {
          setAgentReference(firstImage);
          setAgentFile(null);
          if (routeMode === "edit" || plan.mode === "edit") {
            completeEditSession({
              status: "completed",
              result: firstImage,
              saved,
              message: "Edited image returned and saved locally."
            });
          }
        }
      }

      setOperation({
        type: `Assistant: ${plan.intent || "workflow"}`,
        provider: providerLabel(execution.provider || plan.recommended_provider),
        model: execution.model || plan.recommended_model || "router",
        status: execution.status || "completed",
        step: saved.length || execution.measurement ? 3 : 2,
        message: plan.user_visible_explanation || "OpenAI routed the workflow."
      });
      setNotice({ tone: "success", text: compactMessage(plan.user_visible_explanation || "OpenAI orchestration completed.") });
      if (plan.mode === "video" && execution.status === "queued" && execution.job?.pollUrl) {
        pollQueuedVideoJob(execution.job, execution.provider || plan.recommended_provider, execution.model || plan.recommended_model);
      }
    } catch (error) {
      const messageText = error.name === "AbortError" ? "AI routing timed out. No charge is shown in this app unless a provider returned a result." : compactMessage(error.message);
      setOperation({ type: "OpenAI orchestration", provider: "OpenAI", model: "router", status: "failed", step: 1, message: messageText });
      setRouteActivity((current) => current && { ...current, detail: messageText, failed: true });
      if (routeMode === "edit") {
        completeEditSession({
          status: "failed",
          message: messageText
        });
      }
      setNotice({ tone: "warning", text: messageText });
    } finally {
      clearTimeout(timeout);
      clearRouteTimers();
      setIsRouting(false);
    }
  };

  const activeMeta = workspaceModes.find((mode) => mode.id === activeMode) || workspaceModes[0];
  const primaryDisabled = activeMode === "agent" ? !agentInput.trim() || isAgentThinking : activeMode === "measure" ? isMeasuring : false;
  const editSource = editFile || agentReference || activeFile;

  return (
    <main className={`app mode-${activeMode} theme-${theme}`}>
      <aside className="sidebar compactNav">
        <div className="brand">
          <div className="brandMark"><Ruler size={22} /></div>
          <div>
            <h1>Atelier Measure Studio</h1>
            <p>Fashion model measurement and media generation</p>
          </div>
        </div>

        <nav className="workspaceNav" aria-label="Workspace navigation">
          {workspaceModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-label={mode.label}
              title={mode.label}
              className={activeMode === mode.id ? "active" : ""}
              onClick={() => setActiveMode(mode.id)}
            >
              <mode.icon size={18} />
              <span>{mode.label}</span>
            </button>
          ))}
        </nav>

        <div className="navSession">
          <span>Session</span>
          <strong>{files.length ? `${files.length} reference${files.length > 1 ? "s" : ""}` : "No references"}</strong>
          <small>{mediaResults.length} saved result{mediaResults.length === 1 ? "" : "s"}</small>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => addFiles(event.target.files)}
        />



        <div className="sidebarFooter">
          <span>Models</span>
          <strong>{measurementProvider === "xai" ? "Grok analysis" : "OpenAI analysis"}</strong>
          <small>{imageProvider === "xai" ? "Grok Image" : "GPT-image-2"} Â· {videoProvider === "xai" ? "Grok video" : "Sora video"}</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar premiumTopbar">
          <div>
            <span className="eyebrow">AI fit atelier</span>
            <h2>{activeMeta.title}</h2>
            <div className={`compactNotice ${notice.tone}`}>
              <Sparkles size={15} />
              <span>{notice.text}</span>
            </div>
          </div>
          <div className="topbarActions">
            <TopbarModelControl
              activeMode={activeMode}
              measurementProvider={measurementProvider}
              setMeasurementProvider={setMeasurementProvider}
              measurementModel={measurementModel}
              setMeasurementModel={setMeasurementModel}
              imageProvider={imageProvider}
              setImageProvider={setImageProvider}
              imageModel={imageModel}
              setImageModel={setImageModel}
              videoProvider={videoProvider}
              setVideoProvider={setVideoProvider}
              videoModel={videoModel}
              setVideoModel={setVideoModel}
              editProvider={editProvider}
              setEditProvider={setEditProvider}
              editModel={editModel}
              setEditModel={setEditModel}
            />
            <button className="topbarButton ghost" type="button" onClick={() => inputRef.current?.click()}>
              <Upload size={17} />
              Upload
            </button>
            <button className="topbarButton iconOnly" type="button" onClick={() => setCommandOpen(true)} aria-label="Open command palette">
              <Command size={17} />
              <span>Ctrl K</span>
            </button>
            <button className="topbarButton iconOnly" type="button" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="topbarButton ghost orchestrationButton" type="button" disabled={isRouting} onClick={callAssistantRouter}>
              <Sparkles size={17} />
              {isRouting ? "Routing..." : "Ask OpenAI"}
            </button>
            <button className="topbarButton primary" type="button" disabled={primaryDisabled} onClick={runPrimaryAction}>
              <Wand2 size={17} />
              {activeMeta.cta}
            </button>
          </div>
        </header>

        <ProjectCommandBar
          projects={projects}
          activeProject={activeProject}
          activeProjectId={activeProjectId}
          setActiveProjectId={setActiveProjectId}
          onCreateProject={createProject}
          outputCount={projectMediaResults.length}
          promptCount={promptLibrary.filter((prompt) => prompt.projectId === activeProject.id || activeProject.id === defaultProjectId).length}
        />

        <div className="modeTabs" role="tablist" aria-label="AI workflow modes">
          {workspaceModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={activeMode === mode.id}
              className={activeMode === mode.id ? "active" : ""}
              onClick={() => setActiveMode(mode.id)}
            >
              <mode.icon size={16} />
              {mode.label}
            </button>
          ))}
        </div>

        <AssistantRoutePanel route={assistantRoute} activity={routeActivity} isRouting={isRouting} onRun={callAssistantRouter} />

        <CostPanel
          estimate={defaultMeasurementEstimate}
          usageLog={usageLog}
            todayStats={todayStats}
            localBudget={localBudget}
            setLocalBudget={setLocalBudget}
            isMeasuring={isMeasuring}
            budget={budgetStatus}
        />

        <ProviderGuide
          measurementProvider={measurementProvider}
          imageProvider={imageProvider}
          videoProvider={videoProvider}
        />

        <ResultsStudio
          operation={operation}
          mediaResults={filteredProjectMedia}
          activeProject={activeProject}
          filters={outputFilters}
          setFilters={setOutputFilters}
          compareItems={compareItems}
          onOpenLocation={openSavedLocation}
          onToggleFavorite={toggleMediaFavorite}
          onReusePrompt={reuseResultPrompt}
          onGenerateSimilar={generateSimilarFromResult}
          onAnimate={animateResultToVideo}
          onCompare={toggleCompareItem}
        />

        <GrokAgentChat
          messages={agentMessages}
          input={agentInput}
          setInput={setAgentInput}
          attachImage={agentAttachImage}
          setAttachImage={setAgentAttachImage}
          activeImageName={(editFile || activeFile)?.file.name}
          activeImageUrl={(editFile || activeFile)?.url}
          agentFileName={agentFile?.file.name}
          agentFileUrl={agentFile?.url}
          agentReference={agentReference}
          onBrowse={() => agentInputRef.current?.click()}
          onClearFile={() => setAgentFile(null)}
          agentCost={agentCost}
          isThinking={isAgentThinking}
          onSend={sendAgentMessage}
          onApply={applyAgentAction}
        />

        <BillingDashboard
          usageLog={usageLog}
          mediaResults={mediaResults}
          files={files}
          snapshot={billingSnapshot}
          localBudget={localBudget}
          setLocalBudget={setLocalBudget}
          filters={billingFilters}
          setFilters={setBillingFilters}
          selectedRow={selectedBillingRow}
          setSelectedRow={setSelectedBillingRow}
          onOpenLocation={openSavedLocation}
          onRefresh={refreshBillingSnapshot}
        />
        <input
          ref={agentInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setAgentFile({
              id: `agent-${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
              file,
              url: URL.createObjectURL(file)
            });
            setAgentAttachImage(true);
            setNotice({ tone: "progress", text: "Image attached to Grok Agent chat." });
          }}
        />

        <div className="contentGrid">
          <section className="previewPanel">
            {activeFile ? (
              <>
                <img src={activeFile.url} alt="Selected fashion model reference" />
                <div className="previewCaption">
                  <span>Active reference</span>
                  <strong>{activeFile.file.name}</strong>
                </div>
                <WorkflowOverlay state={workflowState} provider={lastMeasurementProvider} />
              </>
            ) : (
              <div className="emptyPreview">
                <div className="emptyMark"><ScanLine size={38} /></div>
                <strong>Upload a full-body model photo</strong>
                <span>Front, side, and back references improve size confidence.</span>
                <button onClick={() => inputRef.current?.click()} type="button">
                  <Upload size={18} />
                  Choose images
                </button>
              </div>
            )}
          </section>

          <section className="measurePanel">
            <div className="panelHeader">
              <Ruler size={19} />
              <div>
                <h3>{fitProfile.sourceLabel}</h3>
                <p>{isMeasuring ? `${providerLabel(measurementProvider)} vision analysis in progress` : fitProfile.confidenceLabel}</p>
              </div>
            </div>

            {fitProfile.confidenceScore !== undefined && (
              <div className={`grokConfidence ${confidenceTone(fitProfile.confidenceScore)}`}>
                <span>Grok Confidence</span>
                <strong>{fitProfile.confidenceScore}%</strong>
                <small>Per-measurement confidence shown below</small>
              </div>
            )}

            <ModelPicker
              label="Measurement analysis"
              provider={measurementProvider}
              setProvider={(provider) => {
                setMeasurementProvider(provider);
                setMeasurementModel(measurementModelOptions[provider][0].value);
              }}
              model={measurementModel}
              setModel={setMeasurementModel}
              models={measurementModelOptions[measurementProvider]}
            />

            <div className="measurementProviderNote">
              <span>Measurement cost guide</span>
              <strong>{measurementProvider === "xai" ? "Grok is currently the lower-cost measurement path in your logged usage." : "OpenAI is selected first for this measurement scan."}</strong>
              <small>{measurementProvider === "xai" ? "OpenAI scan is available below for comparison; Grok AI remains available for second-opinion rescans." : "Use Grok AI below for a second-opinion rescan when needed."}</small>
            </div>

            <div className="fitSummary">
              {fitProfile.recommendations.map((item) => (
                <button
                  key={item.label}
                  className={`fitCard ${item.type ? "interactive" : ""}`}
                  onClick={() => item.type && setShoppingGuide(buildShoppingGuide(item, fitProfile))}
                  type="button"
                >
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.note}</small>
                </button>
              ))}
            </div>

            {fitProfile.globalSizes && (
              <div className="globalSizeGrid">
                <article><span>US</span><strong>{fitProfile.globalSizes.US}</strong></article>
                <article><span>UK</span><strong>{fitProfile.globalSizes.UK}</strong></article>
                <article><span>EU</span><strong>{fitProfile.globalSizes.EU}</strong></article>
                <article><span>Height</span><strong>{fitProfile.globalSizes.heightCategory}</strong></article>
              </div>
            )}

            <FitShoppingAssistant fitProfile={fitProfile} onOpenGuide={setShoppingGuide} />

            <div className="measurementList">
              {fitProfile.measurements.map((item) => (
                <div key={item.label} className="measurementRow">
                  <div>
                    <span>{item.label}</span>
                    <small>{item.note}</small>
                  </div>
                  <strong>
                    {item.metric}
                    <em>{item.imperial}</em>
                    {item.confidence !== undefined && <b className={`confidenceBadge ${confidenceTone(item.confidence)}`}>{item.confidence}%</b>}
                  </strong>
                </div>
              ))}
            </div>

            <div className="remeasureActions">
              <button className="remeasureButton openaiPrimary" type="button" disabled={!activeFile || isMeasuring} onClick={() => activeFile && requestMeasurement(activeFile, "openai")}>
                <Wand2 size={17} />
                {isMeasuring ? "Measuring..." : "Run OpenAI scan"}
              </button>
              <button className="remeasureButton grokPrimary" type="button" disabled={!activeFile || isMeasuring} onClick={() => activeFile && requestMeasurement(activeFile, "xai")}>
                <ScanLine size={17} />
                {isMeasuring ? "Measuring..." : "Re-run with Grok AI"}
              </button>
            </div>

            <div className="stylingNote">
              <Shirt size={18} />
              <p>{fitProfile.notes} Confirm final sizes with manual tape measurement before production.</p>
            </div>
          </section>
        </div>

        <section className="generatorGrid">
          <GeneratorCard
            icon={<ImagePlus size={22} />}
            title="Create New Image"
            subtitle="Prompt-to-image from OpenAI or Grok with AI prompt refinement"
            prompt={imagePrompt}
            setPrompt={setImagePrompt}
            primaryLabel="Ask OpenAI + generate"
            busyLabel="OpenAI is preparing image"
            disabled={isRouting}
            costHint={actionCostHint("image", imageModel)}
            onGenerate={() => callAssistantRouter({ mode: "image" })}
            recommendation={activeMode === "image" ? currentRecommendation : null}
            onApplyRecommendation={applyRecommendation}
            onSavePrompt={saveCurrentPrompt}
            onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
          >
            <ModelPicker
              label="Image processor"
              provider={imageProvider}
              setProvider={(provider) => {
                setImageProvider(provider);
                setImageModel(imageModelOptions[provider][0].value);
              }}
              model={imageModel}
              setModel={setImageModel}
              models={imageModelOptions[imageProvider]}
            />
            <Segmented label="Image quality" value={imageQuality} onChange={setImageQuality} options={imageQualities} />
            <Segmented label="Image shape" value={imageSize} onChange={setImageSize} options={imageSizes} compact />
          </GeneratorCard>

          <GeneratorCard
            icon={<Sparkles size={22} />}
            title="Edit Existing Image"
            subtitle="Upload a photo, let OpenAI refine the edit, then apply it with Grok or Gemini"
            prompt={editPrompt}
            setPrompt={setEditPrompt}
            primaryLabel="Ask OpenAI + edit existing image"
            busyLabel="Editing workflow running"
            disabled={isRouting}
            costHint={actionCostHint("image_edit", editModel)}
            onGenerate={callImageEdit}
            recommendation={activeMode === "edit" ? currentRecommendation : null}
            onApplyRecommendation={applyRecommendation}
            onSavePrompt={saveCurrentPrompt}
            onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
          >
            <input
              ref={editInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const url = URL.createObjectURL(file);
                setEditFile({
                  id: `edit-${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
                  file,
                  url
                });
                setEditSession((current) => ({
                  ...current,
                  status: "selected",
                  source: { name: file.name, url, type: "image" },
                  userPrompt: editPrompt,
                  providerMessage: "Source image selected and ready for an edit prompt."
                }));
                setNotice({ tone: "progress", text: "Edit image selected." });
              }}
            />
            <button className="browseEditButton" type="button" onClick={() => editInputRef.current?.click()}>
              <Upload size={17} />
              Browse image for edit
            </button>
            <button className="minimalStylingButton" type="button" disabled={isMinimalStyling || isRouting} onClick={callMinimalStyling}>
              <Shirt size={17} />
              {isMinimalStyling ? "Minimal Styling running" : "Minimal Styling"}
            </button>
            <MinimalStylingStatus result={minimalStyling} isRunning={isMinimalStyling} />
            <div className="modelPicker singleProvider">
              <span>Image edit provider</span>
              <div>
                <select value={editProvider} onChange={(event) => {
                  const provider = event.target.value;
                  setEditProvider(provider);
                  setEditModel(editModelOptions[provider][0].value);
                }}>
                  {providerOptions.filter((option) => option.value !== "openai").map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select value={editModel} onChange={(event) => setEditModel(event.target.value)}>
                  {editModelOptions[editProvider].map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select value={editQuality} onChange={(event) => setEditQuality(event.target.value)}>
                  <option value="high">2K quality</option>
                  <option value="standard">1K quality</option>
                </select>
              </div>
            </div>
            <div className="editHint">
              {editSource?.url && <img src={editSource.url} alt="Selected image for edit" />}
              <div>
                <span>Image sent for edit</span>
                <strong>{editSource?.file?.name || editSource?.filename || "No image selected yet"}</strong>
                <small>OpenAI reads this image plus your prompt, improves the instruction, then routes the edit workflow.</small>
              </div>
            </div>
          </GeneratorCard>

          <GeneratorCard
            icon={<Clapperboard size={22} />}
            title="Video Generator"
            subtitle="Sora render request with standard quality controls"
            prompt={videoPrompt}
            setPrompt={setVideoPrompt}
            primaryLabel="Ask OpenAI + video"
            busyLabel={videoBudgetBlocked ? "Budget too low for video" : "OpenAI is preparing video"}
            disabled={isRouting || videoBudgetBlocked}
            costHint={videoBudgetBlocked ? "Video is disabled because the remaining monthly budget is below the next video estimate." : actionCostHint("video", videoModel)}
            onGenerate={callAssistantRouter}
            recommendation={activeMode === "video" ? currentRecommendation : null}
            onApplyRecommendation={applyRecommendation}
            onSavePrompt={saveCurrentPrompt}
            onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
          >
            <ModelPicker
              label="Video processor"
              provider={videoProvider}
              setProvider={(provider) => {
                setVideoProvider(provider);
                setVideoModel(videoModelOptions[provider][0].value);
              }}
              model={videoModel}
              setModel={setVideoModel}
              models={videoModelOptions[videoProvider]}
            />
            <Segmented label="Video quality" value={videoQuality} onChange={setVideoQuality} options={videoQualities} />
            <Segmented label="Video size" value={videoSize} onChange={setVideoSize} options={videoSizes} compact />
          </GeneratorCard>

          <EditStudioWorkspace
            source={editSource}
            userPrompt={editPrompt}
            session={editSession}
            route={assistantRoute}
            activity={routeActivity}
            isRunning={isRouting}
            onBrowse={() => editInputRef.current?.click()}
            onReEdit={() => callAssistantRouter({ mode: "edit" })}
            onOpenLocation={openSavedLocation}
            olderResults={mediaResults}
          />
        </section>
      </section>

      {shoppingGuide && (
        <ShoppingModal guide={shoppingGuide} onClose={() => setShoppingGuide(null)} />
      )}
      {progressOverlay && (
        <GenerationStage overlay={progressOverlay} onCancel={() => setProgressOverlay(null)} />
      )}
      {commandOpen && (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          setActiveMode={setActiveMode}
          onUpload={() => inputRef.current?.click()}
          onRoute={callAssistantRouter}
          isRouting={isRouting}
        />
      )}
      {promptLibraryOpen && (
        <PromptLibraryDrawer
          prompts={promptLibrary}
          activeMode={activeMode}
          onClose={() => setPromptLibraryOpen(false)}
          onInsert={applyPromptFromLibrary}
          onToggleFavorite={togglePromptFavorite}
        />
      )}
    </main>
  );
}

function ProjectCommandBar({ projects, activeProject, activeProjectId, setActiveProjectId, onCreateProject, outputCount, promptCount }) {
  const recentProjects = sortProjects(projects).slice(0, 4);
  return (
    <section className="phase2StudioBar" aria-label="Project workspace">
      <div className="projectSwitcher">
        <div className="projectSwitcherLabel">
          <FolderKanban size={17} />
          <div>
            <span>Current project</span>
            <strong>{activeProject?.name || "Main Studio"}</strong>
          </div>
        </div>
        <select value={activeProjectId} onChange={(event) => setActiveProjectId(event.target.value)}>
          {sortProjects(projects).map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <button type="button" onClick={onCreateProject}>
          <Plus size={15} />
          New project
        </button>
      </div>
      <div className="projectContextStats">
        <span><Layers size={14} /> {outputCount} outputs</span>
        <span><Tag size={14} /> {promptCount} prompts</span>
        <span>Updated {relativeProjectTime(activeProject)}</span>
      </div>
      <div className="recentProjects">
        {recentProjects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={project.id === activeProjectId ? "active" : ""}
            onClick={() => setActiveProjectId(project.id)}
          >
            {project.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function TopbarModelControl({
  activeMode,
  measurementProvider,
  setMeasurementProvider,
  measurementModel,
  setMeasurementModel,
  imageProvider,
  setImageProvider,
  imageModel,
  setImageModel,
  videoProvider,
  setVideoProvider,
  videoModel,
  setVideoModel,
  editProvider,
  setEditProvider,
  editModel,
  setEditModel
}) {
  if (activeMode === "measure") {
    return (
      <div className="topModelPicker">
        <ModelPicker
          label="Measurement model"
          provider={measurementProvider}
          setProvider={(provider) => {
            setMeasurementProvider(provider);
            setMeasurementModel(measurementModelOptions[provider][0].value);
          }}
          model={measurementModel}
          setModel={setMeasurementModel}
          models={measurementModelOptions[measurementProvider]}
        />
      </div>
    );
  }

  if (activeMode === "image") {
    return (
      <div className="topModelPicker">
        <ModelPicker
          label="Image model"
          provider={imageProvider}
          setProvider={(provider) => {
            setImageProvider(provider);
            setImageModel(imageModelOptions[provider][0].value);
          }}
          model={imageModel}
          setModel={setImageModel}
          models={imageModelOptions[imageProvider]}
        />
      </div>
    );
  }

  if (activeMode === "video") {
    return (
      <div className="topModelPicker">
        <ModelPicker
          label="Video model"
          provider={videoProvider}
          setProvider={(provider) => {
            setVideoProvider(provider);
            setVideoModel(videoModelOptions[provider][0].value);
          }}
          model={videoModel}
          setModel={setVideoModel}
          models={videoModelOptions[videoProvider]}
        />
      </div>
    );
  }

  if (activeMode === "edit") {
    return (
      <div className="topModelPicker">
        <ModelPicker
          label="Edit model"
          provider={editProvider}
          setProvider={(provider) => {
            setEditProvider(provider);
            setEditModel(editModelOptions[provider][0].value);
          }}
          model={editModel}
          setModel={setEditModel}
          models={editModelOptions[editProvider]}
        />
      </div>
    );
  }

  if (activeMode === "billing") {
    return <div className="statusPill muted"><Database size={16} /> Usage, cost and storage</div>;
  }

  return <div className="statusPill muted"><Sparkles size={16} /> Grok Agent</div>;
}

function AssistantRoutePanel({ route, activity, isRouting, onRun }) {
  const plan = route?.plan;
  const execution = route?.execution;
  const steps = activity?.steps || buildRouteSteps(plan?.mode || "image");
  const activeStage = activity?.stage ?? (plan ? 3 : -1);
  return (
    <section className="assistantRoutePanel">
      <div className="assistantRouteHeader">
      <div>
        <span>OpenAI workflow brain</span>
        <strong>{plan ? readableIntent(plan.intent) : activity ? activity.title : isRouting ? "Routing request" : "Ready to route"}</strong>
      </div>
        <button type="button" disabled={isRouting} onClick={onRun}>
          <Sparkles size={15} />
          {isRouting ? "Thinking" : "Route"}
        </button>
      </div>
      {(activity || isRouting) && (
        <div className={`routeLive ${activity?.failed ? "failed" : ""}`}>
          <p>{activity?.detail || "Preparing the workflow."}</p>
          <div className="routeTimeline">
            {steps.map((step, index) => (
              <div key={step.label} className={`routeTimelineStep ${index < activeStage ? "done" : ""} ${index === activeStage ? "active" : ""}`}>
                <i>{index < activeStage ? <Check size={13} /> : index + 1}</i>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {plan ? (
        <>
          <div className="routeBadges">
            <span>{plan.recommended_provider === "xai" ? "Grok / xAI" : plan.recommended_provider}</span>
            <span>{plan.recommended_model}</span>
            <span>{plan.confidence} confidence</span>
          </div>
          <p>{plan.user_visible_explanation}</p>
          <details className="softAccordion">
            <summary>Next actions</summary>
            <div className="routeActions">
              {(plan.next_actions || []).map((item) => <button key={item} type="button">{item}</button>)}
            </div>
          </details>
          <small>{execution?.status ? `Execution: ${execution.status}` : "Plan only"}</small>
        </>
      ) : isRouting && !activity ? (
        <div className="routeSkeleton" aria-label="Routing request">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <p>Primary workflow buttons now route through OpenAI first. OpenAI reads the prompt and image context, chooses OpenAI or Grok, improves the prompt, then runs the selected workflow.</p>
      )}
    </section>
  );
}

function GenerationStage({ overlay, onCancel }) {
  const pct = Math.max(0, Math.min(100, overlay.progress || 0));
  return (
    <div className={`generationStage ${overlay.done ? "done" : ""} ${overlay.failed ? "failed" : ""}`}>
      <div className="stageCanvas">
        <div className="qualityChip">{overlay.quality}</div>
        <div className="stagePill">
          <strong>{overlay.label} {pct}%</strong>
          <i />
          <button type="button" onClick={onCancel}>{overlay.cancellable ? "Cancel Video" : "Hide"}</button>
        </div>
        <div className="stageMeta">
          <span>{overlay.type}</span>
          <strong>{overlay.provider}</strong>
        </div>
      </div>
    </div>
  );
}

function EditStudioWorkspace({ source, userPrompt, session, route, activity, isRunning, onBrowse, onReEdit, onOpenLocation, olderResults }) {
  const result = session?.result;
  const refinedPrompt = session?.refinedPrompt || route?.plan?.prompt_improvements || "";
  const provider = session?.provider || providerLabel(route?.execution?.provider || route?.plan?.recommended_provider || "xai");
  const model = session?.model || route?.execution?.model || route?.plan?.recommended_model || "Grok Image";
  const status = session?.status || "idle";
  const timeline = buildEditTimeline({ source, userPrompt, refinedPrompt, session, activity, result });
  const history = olderResults.filter((item) => item.kind === "image").slice(0, 5);

  return (
    <section className={`editExperience ${status}`}>
      <div className="editExperienceHeader">
        <div>
          <span>Guided image edit</span>
          <h3>{status === "completed" ? `Edit completed with ${model}` : "Build, route, review, and continue"}</h3>
          <p>Every edit shows the source, the exact prompt path, provider decision, returned image, and local save status.</p>
        </div>
        <div className={`editStatusBadge ${status}`}>
          {status === "completed" ? <Check size={16} /> : status === "failed" ? <Sparkles size={16} /> : <ScanLine size={16} />}
          <strong>{readableIntent(status)}</strong>
        </div>
      </div>

      <div className="editStudioGrid">
        <EditSourcePanel source={source} onBrowse={onBrowse} />
        <PromptJourneyCard userPrompt={userPrompt} refinedPrompt={refinedPrompt} />
        <ProviderDecisionCard provider={provider} model={model} reason={session?.reason || route?.plan?.user_visible_explanation} requestedAt={session?.requestedAt} completedAt={session?.completedAt} message={session?.providerMessage} />
        <ResultHeroPanel source={source} result={result} session={session} isRunning={isRunning} onOpenLocation={onOpenLocation} onReEdit={onReEdit} />
      </div>

      <div className="editLowerGrid">
        <EditActivityTimeline steps={timeline} />
        <SavedResultsTray results={history} activeResult={result} onOpenLocation={onOpenLocation} />
      </div>
    </section>
  );
}

function EditSourcePanel({ source, onBrowse }) {
  return (
    <section className="editSourcePanel">
      <div className="miniPanelHeader">
        <span>1 Source image</span>
        <strong>{source ? "Selected for editing" : "No image selected"}</strong>
      </div>
      {source?.url ? (
        <figure>
          <img src={source.url} alt={source.file?.name || source.filename || "Source selected for image edit"} />
          <figcaption>{source.file?.name || source.filename || source.name || "Selected image"}</figcaption>
        </figure>
      ) : (
        <div className="editEmptyState">
          <Upload size={22} />
          <strong>Choose an image to edit</strong>
          <span>The selected photo will be shown here before routing.</span>
        </div>
      )}
      <button type="button" onClick={onBrowse}>
        <Upload size={16} />
        Choose source image
      </button>
    </section>
  );
}

function PromptJourneyCard({ userPrompt, refinedPrompt }) {
  return (
    <section className="promptJourneyCard">
      <div className="miniPanelHeader">
        <span>2 Prompt path</span>
        <strong>{refinedPrompt ? "AI refinement available" : "Waiting for AI refinement"}</strong>
      </div>
      <div className="promptCompare">
        <div>
          <span>User prompt</span>
          <p>{userPrompt || "Write the edit you want to apply to the selected image."}</p>
        </div>
        <div>
          <span>AI-refined prompt</span>
          <p>{refinedPrompt || "After submission, OpenAI will show the refined prompt used for the provider call."}</p>
        </div>
      </div>
    </section>
  );
}

function ProviderDecisionCard({ provider, model, reason, requestedAt, completedAt, message }) {
  return (
    <section className="providerDecisionCard">
      <div className="miniPanelHeader">
        <span>3 Provider decision</span>
        <strong>{provider || "Pending route"}</strong>
      </div>
      <div className="decisionRows">
        <div><span>Model</span><strong>{model || "--"}</strong></div>
        <div><span>Requested</span><strong>{requestedAt || "--"}</strong></div>
        <div><span>Completed</span><strong>{completedAt || "--"}</strong></div>
      </div>
      <p>{reason || "OpenAI will explain why the selected provider/model was chosen."}</p>
      {message && <small>{message}</small>}
    </section>
  );
}

function ResultHeroPanel({ source, result, session, isRunning, onOpenLocation, onReEdit }) {
  if (isRunning && !result) {
    return (
      <section className="resultHeroPanel loading">
        <div className="miniPanelHeader">
          <span>4 Result</span>
          <strong>Provider is working</strong>
        </div>
        <div className="resultSkeleton"><i /><i /><i /></div>
      </section>
    );
  }

  return (
    <section className={`resultHeroPanel ${result ? "ready" : session?.status || "idle"}`}>
      <div className="miniPanelHeader">
        <span>4 Result hero</span>
        <strong>{result ? "Returned and saved" : session?.status === "failed" ? "Edit failed" : "Waiting for result"}</strong>
      </div>
      {result ? (
        <>
          <BeforeAfterCompare source={source} result={result} />
          <ResultConfirmationCard session={session} result={result} onOpenLocation={onOpenLocation} onReEdit={onReEdit} />
        </>
      ) : (
        <div className="editEmptyState">
          <ImagePlus size={24} />
          <strong>The edited image will appear here</strong>
          <span>This area becomes the main result preview after the provider returns media.</span>
        </div>
      )}
    </section>
  );
}

function BeforeAfterCompare({ source, result }) {
  return (
    <div className="beforeAfterCompare">
      <figure>
        {source?.url ? <img src={source.url} alt="Before edit source" /> : <div />}
        <figcaption>Before</figcaption>
      </figure>
      <figure>
        <img src={result.url} alt={result.label || "Edited result"} />
        <figcaption>After</figcaption>
      </figure>
    </div>
  );
}

function ResultConfirmationCard({ session, result, onOpenLocation, onReEdit }) {
  return (
    <div className="resultConfirmationCard">
      <div>
        <span>Completed</span>
        <strong>Edit completed with {session?.model || result.model || "selected provider"}</strong>
        <small>{result.filename ? `Saved locally as ${result.filename}` : "Saved output is ready."}</small>
      </div>
      <div className="resultActions">
        <a href={result.url} target="_blank" rel="noreferrer">View full result</a>
        <button type="button" onClick={() => onOpenLocation?.(result)}>Open saved folder</button>
        <button type="button" onClick={onReEdit}>Re-edit</button>
      </div>
    </div>
  );
}

function EditActivityTimeline({ steps }) {
  return (
    <section className="editActivityTimeline">
      <div className="miniPanelHeader">
        <span>Edit activity</span>
        <strong>Lifecycle</strong>
      </div>
      <div>
        {steps.map((step) => (
          <article key={step.label} className={`editTimelineStep ${step.status}`}>
            <i>{step.status === "done" ? <Check size={13} /> : step.status === "active" ? <ScanLine size={13} /> : step.index}</i>
            <div>
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
              {step.time && <small>{step.time}</small>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SavedResultsTray({ results, activeResult, onOpenLocation }) {
  return (
    <section className="savedResultsTray">
      <div className="miniPanelHeader">
        <span>Result tray</span>
        <strong>{results.length} saved image{results.length === 1 ? "" : "s"}</strong>
      </div>
      {results.length ? (
        <div className="trayScroller">
          {results.map((item) => (
            <article key={item.id} className={activeResult?.id === item.id ? "active" : ""}>
              <img src={item.url} alt={item.label} />
              <span>{item.label}</span>
              <button type="button" onClick={() => onOpenLocation?.(item)}>Open folder</button>
            </article>
          ))}
        </div>
      ) : (
        <div className="editEmptyState compact">
          <span>Completed edits will be collected here.</span>
        </div>
      )}
    </section>
  );
}

function CommandPalette({ onClose, setActiveMode, onUpload, onRoute, isRouting }) {
  const actions = [
    { label: "Measure uploaded model", hint: "Open measurement workspace", icon: Ruler, run: () => setActiveMode("measure") },
    { label: "Create a new image", hint: "Prompt-to-image generation", icon: ImagePlus, run: () => setActiveMode("image") },
    { label: "Edit an existing image", hint: "Upload photo and change styling/clothes", icon: Sparkles, run: () => setActiveMode("edit") },
    { label: "Generate video", hint: "Image-to-video or prompt-to-video", icon: Clapperboard, run: () => setActiveMode("video") },
    { label: "Chat with Grok Agent", hint: "Plan edits and video scenes", icon: Wand2, run: () => setActiveMode("agent") },
    { label: "Upload image", hint: "Add local reference photos", icon: Upload, run: onUpload },
    { label: isRouting ? "OpenAI is routing" : "Ask OpenAI workflow brain", hint: "Classify intent and pick model", icon: Sparkles, run: onRoute, disabled: isRouting }
  ];

  const runAction = (action) => {
    if (action.disabled) return;
    action.run();
    onClose();
  };

  return (
    <div className="commandBackdrop" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={onClose}>
      <section className="commandPalette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="commandSearch">
          <Command size={18} />
          <div>
            <strong>Quick actions</strong>
            <span>Choose a workflow or press Escape to close.</span>
          </div>
          <button type="button" onClick={onClose}>Esc</button>
        </div>
        <div className="commandList">
          {actions.map((action) => (
            <button key={action.label} type="button" disabled={action.disabled} onClick={() => runAction(action)}>
              <action.icon size={18} />
              <span>
                <strong>{action.label}</strong>
                <small>{action.hint}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ResultsStudio({
  operation,
  mediaResults,
  activeProject,
  filters,
  setFilters,
  compareItems = [],
  onOpenLocation,
  onToggleFavorite,
  onReusePrompt,
  onGenerateSimilar,
  onAnimate,
  onCompare
}) {
  const orderedResults = sortMediaResults(mediaResults);
  const latestResult = orderedResults[0];
  const historyResults = orderedResults.slice(1, 12);
  const isActiveRequest = ["running", "queued"].includes(operation.status);

  return (
    <section className="resultsStudio">
      <div className={`operationPanel ${isActiveRequest ? "isLive" : ""}`}>
        <div>
          <span>Current request</span>
          <strong>{operation.type}</strong>
          <small>{operation.provider}{operation.model ? ` · ${operation.model}` : ""}</small>
        </div>
        <div className="operationSteps eventSteps">
          {operationSteps.map((step, index) => (
            <div key={step} className={`operationStep ${index <= operation.step ? "active" : ""} ${operation.status}`}>
              <i>{index + 1}</i>
              <span>{step}</span>
              <small>{operationStepStatus(operation, index)}</small>
            </div>
          ))}
        </div>
        <p>{operation.message}</p>
      </div>

      <div className="mediaGallery mediaGalleryModern">
        <ReturnedMediaHeader count={orderedResults.length} latestResult={latestResult} isLoading={isActiveRequest} activeProject={activeProject} />
        <OutputFilters filters={filters} setFilters={setFilters} />
        <VariantComparePanel items={compareItems} onClear={() => compareItems.forEach((item) => onCompare?.(item))} onOpenLocation={onOpenLocation} />
        {orderedResults.length ? (
          <>
            <LatestResultCard
              result={latestResult}
              onOpenLocation={onOpenLocation}
              onToggleFavorite={onToggleFavorite}
              onReusePrompt={onReusePrompt}
              onGenerateSimilar={onGenerateSimilar}
              onAnimate={onAnimate}
              onCompare={onCompare}
            />
            <MediaHistoryRail
              results={historyResults}
              activeResult={latestResult}
              onOpenLocation={onOpenLocation}
              onToggleFavorite={onToggleFavorite}
              onCompare={onCompare}
            />
          </>
        ) : isActiveRequest ? (
          <ReturnedMediaLoadingState operation={operation} />
        ) : (
          <EmptyReturnedMediaState />
        )}
      </div>
    </section>
  );
}

function ReturnedMediaHeader({ count, latestResult, isLoading, activeProject }) {
  return (
    <div className="galleryHeader returnedMediaHeader">
      <div>
        <span>Returned media</span>
        <strong>{count} saved result{count === 1 ? "" : "s"}</strong>
      </div>
      <small>{activeProject?.name ? `${activeProject.name} · ` : ""}{latestResult ? `Latest ${relativeSavedTime(latestResult)}` : isLoading ? "Waiting for provider output" : "No saved outputs yet"}</small>
    </div>
  );
}

function OutputFilters({ filters, setFilters }) {
  if (!filters || !setFilters) return null;
  return (
    <div className="outputFilters">
      <label>
        <Search size={14} />
        <input
          value={filters.query}
          placeholder="Search prompt, model, filename..."
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
        />
      </label>
      <select value={filters.provider} onChange={(event) => setFilters({ ...filters, provider: event.target.value })}>
        {providerFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
        {outputTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function VariantComparePanel({ items, onClear, onOpenLocation }) {
  if (!items?.length) return null;
  return (
    <div className="variantComparePanel">
      <div className="variantCompareHeader">
        <div>
          <span>Compare mode</span>
          <strong>{items.length} selected variant{items.length === 1 ? "" : "s"}</strong>
        </div>
        <button type="button" onClick={onClear}>Clear</button>
      </div>
      <div className="variantCompareGrid">
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => onOpenLocation?.(item)}>
            {item.kind === "video" ? <video src={item.url} /> : <img src={item.url} alt={item.label} />}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LatestResultCard({ result, onOpenLocation, onToggleFavorite, onReusePrompt, onGenerateSimilar, onAnimate, onCompare }) {
  if (!result) return null;
  return (
    <article className="latestMediaCard">
      <div className="latestMediaPreview">
        {result.kind === "video" ? (
          <video src={result.url} controls />
        ) : (
          <img src={result.url} alt={result.label} />
        )}
      </div>
      <div className="latestMediaBody">
        <span>Latest result</span>
        <strong>{result.label}</strong>
        <ResultMetadata result={result} />
        <ResultActions
          result={result}
          onOpenLocation={onOpenLocation}
          onToggleFavorite={onToggleFavorite}
          onReusePrompt={onReusePrompt}
          onGenerateSimilar={onGenerateSimilar}
          onAnimate={onAnimate}
          onCompare={onCompare}
        />
      </div>
    </article>
  );
}

function ResultMetadata({ result }) {
  return (
    <div className="resultMetadata">
      <small>{result.provider} · {result.model || "selected model"}</small>
      <p title={result.path || result.url}>Stored locally · {displaySavedLocation(result)}</p>
      <time>{relativeSavedTime(result)} · {result.createdAt || "Saved output"}</time>
    </div>
  );
}

function ResultActions({ result, onOpenLocation, onToggleFavorite, onReusePrompt, onGenerateSimilar, onAnimate, onCompare }) {
  return (
    <div className="resultActionRow">
      <button type="button" className="openLocationButton primary" onClick={() => onOpenLocation?.(result)}>
        <FolderOpen size={14} />
        Open saved folder
      </button>
      <button type="button" className="openLocationButton secondary" onClick={() => onToggleFavorite?.(result)}>
        <Star size={14} fill={result.isFavorite ? "currentColor" : "none"} />
        {result.isFavorite ? "Favorited" : "Favorite"}
      </button>
      <a className="openLocationButton secondary" href={result.url} target="_blank" rel="noreferrer">
        View full
      </a>
      <button type="button" className="openLocationButton secondary" onClick={() => onReusePrompt?.(result)}>Reuse prompt</button>
      <button type="button" className="openLocationButton secondary" onClick={() => onGenerateSimilar?.(result)}>Generate similar</button>
      {result.kind === "image" && <button type="button" className="openLocationButton secondary" onClick={() => onAnimate?.(result)}>Animate</button>}
      <button type="button" className="openLocationButton secondary" onClick={() => onCompare?.(result)}><GitCompare size={14} /> Compare</button>
    </div>
  );
}

function MediaHistoryRail({ results, activeResult, onOpenLocation, onToggleFavorite, onCompare }) {
  if (!results.length) return null;
  return (
    <div className="mediaHistoryTray" aria-label="Earlier returned media">
      <div className="mediaHistoryTitle">
        <span>Earlier outputs</span>
        <small>Newest to oldest</small>
      </div>
      <div className="mediaHistoryScroller">
        {results.map((item) => (
          <MediaThumbCard key={item.id} item={item} active={activeResult?.id === item.id} onOpenLocation={onOpenLocation} onToggleFavorite={onToggleFavorite} onCompare={onCompare} />
        ))}
      </div>
    </div>
  );
}

function MediaThumbCard({ item, active, onOpenLocation, onToggleFavorite, onCompare }) {
  return (
    <article className={`mediaHistoryItem ${active ? "active" : ""}`} title={item.path || item.url}>
      <button type="button" className="mediaThumbOpen" onClick={() => onOpenLocation?.(item)}>
        <span className="mediaThumbFrame">
          {item.kind === "video" ? <video src={item.url} /> : <img src={item.url} alt={item.label} />}
        </span>
        <strong>{item.label}</strong>
        <small>{relativeSavedTime(item)}</small>
      </button>
      <div className="mediaThumbActions">
        <button type="button" onClick={() => onToggleFavorite?.(item)}><Star size={12} fill={item.isFavorite ? "currentColor" : "none"} /></button>
        <button type="button" onClick={() => onCompare?.(item)}><GitCompare size={12} /></button>
      </div>
    </article>
  );
}

function EmptyReturnedMediaState() {
  return (
    <div className="emptyGallery modernEmptyGallery">
      <Sparkles size={22} />
      <strong>No returned media yet</strong>
      <span>Generated, edited, and video outputs will appear here with the latest result highlighted first.</span>
    </div>
  );
}

function ReturnedMediaLoadingState({ operation }) {
  return (
    <div className="returnedMediaLoading">
      <div className="mediaSkeletonPreview" />
      <div>
        <span>Waiting for media</span>
        <strong>{operation.type}</strong>
        <small>{operation.provider} is working. The returned file will become the latest result automatically.</small>
      </div>
    </div>
  );
}

function operationStepStatus(operation, index) {
  if (operation.status === "ready" || operation.step < 0) return "Waiting";
  if (operation.status === "failed") {
    if (index < operation.step) return "Done";
    if (index === operation.step) return "Failed";
    return "Stopped";
  }
  if (operation.status === "queued") {
    if (index < operation.step) return "Done";
    if (index === operation.step) return "Queued";
    return "Waiting";
  }
  if (operation.status === "completed") return index <= operation.step ? "Done" : "Waiting";
  if (index < operation.step) return "Done";
  if (index === operation.step) return "Working";
  return "Waiting";
}

function GrokAgentChat({ messages, input, setInput, attachImage, setAttachImage, activeImageName, activeImageUrl, agentFileName, agentFileUrl, agentReference, onBrowse, onClearFile, agentCost, isThinking, onSend, onApply }) {
  const contextName = agentFileName || agentReference?.filename || activeImageName;
  const contextUrl = agentFileUrl || agentReference?.url || activeImageUrl;

  return (
    <section className="agentChatSection">
      <div className="agentHeader">
        <div>
          <span>Chat with Grok Agent</span>
          <strong>Plan measurement, edit, image and video work</strong>
        </div>
        <label className="attachToggle">
          <input type="checkbox" checked={attachImage} onChange={(event) => setAttachImage(event.target.checked)} />
          <span>Attach active image</span>
        </label>
      </div>

      <div className="agentBody">
        <div className="agentMessages">
          {messages.map((message) => (
            <article key={message.id} className={`agentMessage ${message.role}`}>
              {message.attachment?.url && (
                <div className="chatImagePreview">
                  <img src={message.attachment.url} alt={message.attachment.name} />
                  <span>{message.attachment.name}</span>
                </div>
              )}
              <p>{message.text}</p>
              {!!message.steps?.length && (
                <div className="agentSteps">
                  {message.steps.map((step) => <span key={step}>{step}</span>)}
                </div>
              )}
              {!!message.media?.length && (
                <div className="chatMediaGrid">
                  {message.media.map((item) => (
                    <div key={item.id} className="chatMediaCard">
                      {item.kind === "video" ? (
                        <video src={item.url} controls />
                      ) : (
                        <img src={item.url} alt={item.label} />
                      )}
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.filename}</span>
                        <small>Saved locally: {item.path || item.url}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {message.role === "agent" && message.action && message.action !== "none" && (
                <div className="agentActionPreview">
                  <div className={`agentOutputPlaceholder ${message.action}`}>
                    {message.attachment?.url && message.action !== "generate_image" ? (
                      <img src={message.attachment.url} alt="Reference for suggested action" />
                    ) : (
                      <Sparkles size={24} />
                    )}
                    <span>{outputLabel(message.action)}</span>
                  </div>
                  <button type="button" onClick={() => onApply(message)}>
                    Copy to {actionLabel(message.action)}
                  </button>
                </div>
              )}
            </article>
          ))}
          {isThinking && (
            <article className="agentMessage agent thinking">
              <p>Grok Agent is preparing a plan...</p>
            </article>
          )}
        </div>

        <div className="agentComposer">
          <div className="agentCostGuard">
            <div>
              <span>Estimated next chat</span>
              <strong>$0.01-$0.04</strong>
            </div>
            <div>
              <span>Last Grok Agent</span>
              <strong>{agentCost.last ? formatUsd(agentCost.last.costUsd) : "--"}</strong>
            </div>
            <div>
              <span>Today agent spend</span>
              <strong>{formatUsd(agentCost.todayTotal)}</strong>
            </div>
          </div>
          <p className="agentSpendNote">Cost depends on image attachment, reasoning tokens, and reply length. Keep prompts short when exploring.</p>
          <div className="agentContext">
            <span>Image context</span>
            <strong>{attachImage && contextName ? contextName : "No image attached"}</strong>
            {attachImage && contextUrl && (
              <img src={contextUrl} alt="Attached chat context" />
            )}
          </div>
          <div className="agentAttachRow">
            <button type="button" className="paperclipButton" onClick={onBrowse}>
              <Upload size={17} />
              Attach image
            </button>
            {agentFileName && (
              <button type="button" className="clearAttachButton" onClick={onClearFile}>
                Clear
              </button>
            )}
          </div>
          <textarea
            value={input}
            placeholder="Hey Grok Agent, this is the model picture. Create a cinematic image-to-video prompt with camera movement and fashion styling..."
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onSend();
            }}
          />
          <button type="button" disabled={isThinking || !input.trim()} onClick={onSend}>
            <Wand2 size={18} />
            Send to Grok Agent
          </button>
        </div>
      </div>
    </section>
  );
}

function actionLabel(action) {
  return {
    measure: "Grok measurement",
    edit_image: "image edit",
    generate_image: "image generation",
    generate_video: "video generation"
  }[action] || "next action";
}

function outputLabel(action) {
  return {
    measure: "Measurement analysis",
    edit_image: "Edited image preview",
    generate_image: "Generated image preview",
    generate_video: "Image-to-video preview"
  }[action] || "Suggested result";
}

function CostPanel({ estimate, usageLog, todayStats, localBudget, setLocalBudget, isMeasuring, budget }) {
  const sessionTotal = usageLog.reduce((total, item) => total + item.costUsd, 0);
  const strictLimit = Number(budget?.monthlyBudgetUsd ?? localBudget ?? 5);
  const strictSpent = Number(budget?.spentThisMonthUsd ?? sessionTotal);
  const remaining = Math.max(0, Number(budget?.remainingUsd ?? strictLimit - strictSpent));
  const budgetPercent = strictLimit > 0 ? Math.min(100, (strictSpent / strictLimit) * 100) : 100;
  const last = usageLog[0];

  return (
    <section className="costPanel" aria-label="API usage and billing estimate">
      <div className="budgetGuard">
        <div>
          <span>Strict monthly budget</span>
          <strong>Used {formatUsd(strictSpent)} / {formatUsd(strictLimit)} this month</strong>
        </div>
        <em>{formatUsd(remaining)} remaining</em>
        <i><b style={{ width: `${budgetPercent}%` }} /></i>
      </div>
      <div className="costHero">
        <span>Next AI call</span>
        <strong>{formatUsd(budget?.estimatedActionCostUsd ?? estimate.costUsd)}</strong>
        <small>{estimate.model} Â· approx before request</small>
      </div>
      <div className="costMetric">
        <span>Last billed</span>
        <strong>{last ? formatUsd(last.costUsd) : "--"}</strong>
        <small>{last ? `${last.inputTokens} in Â· ${last.outputTokens} out` : "Waiting for first live call"}</small>
      </div>
      <div className="costMetric">
        <span>Session total</span>
        <strong>{formatUsd(sessionTotal)}</strong>
        <small>{usageLog.length} transaction{usageLog.length === 1 ? "" : "s"}</small>
      </div>
      <label className="budgetBox">
        <span>Local budget</span>
        <div>
          <small>$</small>
          <input value={localBudget} min="0" step="0.5" type="number" onChange={(event) => setLocalBudget(Number(event.target.value))} />
        </div>
        <em>{budget ? "Server budget enforced" : `${formatUsd(remaining)} remaining locally`}</em>
      </label>
      <div className={`costPulse ${isMeasuring ? "active" : ""}`}>
        <i />
        <span>{isMeasuring ? "Tracking request" : "Ready"}</span>
      </div>
      <div className="todayUsage">
        <strong>Today</strong>
        <span>{todayStats.Measurement} measurements</span>
        <span>{todayStats.Image} images</span>
        <span>{todayStats.Video} videos</span>
      </div>
      <div className="usageLedger">
        {usageLog.length ? (
          usageLog.slice(0, 3).map((item) => (
            <div key={item.id} className="usageItem">
              <span>{item.createdAt} Â· {item.type} Â· {item.provider === "xai" ? "Grok/xAI" : "OpenAI"} Â· {item.model}</span>
              <strong>{formatUsd(item.costUsd)}</strong>
            </div>
          ))
        ) : (
          <div className="usageItem empty">
            <span>No billed transactions yet</span>
            <strong>--</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function BillingDashboard({ usageLog, mediaResults, files, snapshot, localBudget, setLocalBudget, filters, setFilters, selectedRow, setSelectedRow, onOpenLocation, onRefresh }) {
  const metrics = buildBillingMetrics({ usageLog, mediaResults, files, snapshot, localBudget });
  const activity = filterBillingActivity(buildBillingActivity({ usageLog, mediaResults, snapshot }), filters);

  return (
    <section className="billingDashboard">
      <div className="billingHero billingHeroModern">
        <div>
          <span><CreditCard size={15} /> Billing Intelligence</span>
          <h3>Usage, cost, storage and provider activity</h3>
          <p>Transparent spend intelligence for generation, edits, video jobs, analysis, uploads and saved assets.</p>
        </div>
        <div className="billingHeroActions">
          <select value={filters.range || "30d"} onChange={(event) => setFilters({ ...filters, range: event.target.value })}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <button type="button" className="billingSecondaryButton"><Download size={15} /> Export</button>
          <button type="button" className="billingPrimaryButton" onClick={onRefresh}><RefreshCw size={15} /> Refresh</button>
        </div>
      </div>
      <BillingOverviewCards metrics={metrics} />
      <div className="billingMainGrid">
        <SpendTrendChart title="Daily usage trend" data={metrics.dailyTrend} />
        <ProviderBreakdownChart providerSummary={metrics.providerSummary} />
        <BudgetStatusCard localBudget={localBudget} setLocalBudget={setLocalBudget} spend={metrics.monthSpend} />
        <StorageUsageCard snapshot={snapshot} metrics={metrics} />
      </div>
      <UsageFilters filters={filters} setFilters={setFilters} providers={metrics.providerSummary.map((item) => item.provider)} />
      <BillingActivityTable rows={activity} onSelect={setSelectedRow} onOpenLocation={onOpenLocation} />
      {selectedRow && <BillingDetailSheet row={selectedRow} onClose={() => setSelectedRow(null)} onOpenLocation={onOpenLocation} />}
    </section>
  );
}

function BillingOverviewCards({ metrics }) {
  const cards = [
    { label: "Total Cost", value: formatUsd(metrics.monthSpend), note: metrics.openaiOfficialAvailable ? "Tracked providers + OpenAI official" : "Logged usage this month", icon: CreditCard, tone: "gold", trend: "+ live" },
    { label: "Grok / xAI cost", value: formatUsd(metrics.grokSpend), note: "Real-time xAI pricing map", icon: Sparkles, tone: "green", trend: "accurate" },
    { label: "Gemini cost", value: formatUsd(metrics.geminiSpend), note: "Imagen, Veo and Nano Banana", icon: Sparkles, tone: "amber", trend: "tracked" },
    { label: "OpenAI official", value: metrics.openaiOfficialAvailable ? formatUsd(metrics.openaiOfficialSpend) : "--", note: metrics.openaiOfficialMessage || "OpenAI Costs API", icon: Wand2, tone: "blue", trend: metrics.openaiOfficialAvailable ? "official" : "setup" },
    { label: "Storage Used", value: formatBytes(metrics.storageBytes), note: "Local outputs folder", icon: Database, tone: "violet", trend: `${metrics.uploads} uploads` },
    { label: "Image Generation", value: String(metrics.images), note: `${formatUsd(metrics.averageCost)} average generation`, icon: ImagePlus, tone: "amber", trend: "images" },
    { label: "Video Generation", value: String(metrics.videos), note: "Saved video outputs", icon: Clapperboard, tone: "rose", trend: "videos" },
    { label: "OpenAI tracked", value: formatUsd(metrics.openaiLocalSpend), note: `Difference ${formatUsd(metrics.openaiDifference)}`, icon: CreditCard, tone: "slate", trend: "local" },
    { label: "Failed Jobs", value: String(metrics.failed), note: "Stopped, rejected or failed", icon: CircleCheck, tone: metrics.failed ? "rose" : "green", trend: metrics.failed ? "review" : "clean" }
  ];
  return (
    <div className="billingOverviewCards billingOverviewModern">
      {cards.map(({ label, value, note, icon: Icon, tone, trend }) => (
        <article key={label} className={`billingStatCard tone-${tone}`}>
          <div className="billingStatTop">
            <i><Icon size={18} /></i>
            <em>{trend}</em>
          </div>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{note}</small>
        </article>
      ))}
    </div>
  );
}

function SpendTrendChart({ title, data }) {
  const max = Math.max(0.01, ...data.map((item) => Number(item.cost || 0)));
  return (
    <section className="billingChart billingTrendCard">
      <div className="billingCardHeader">
        <div><span>Trend</span><strong>{title}</strong><small>Cost movement by day</small></div>
        <div className="billingLegend"><i /> Logged cost</div>
      </div>
      <div className="barChart billingBarChart">
        {data.length ? data.map((item) => (
          <div key={item.label} title={`${item.label}: ${formatUsd(item.cost)}`}>
            <i style={{ height: `${Math.max(8, (Number(item.cost || 0) / max) * 100)}%` }} />
            <b>{formatUsd(item.cost)}</b>
            <span>{item.label}</span>
          </div>
        )) : <p>No spend trend recorded yet.</p>}
      </div>
    </section>
  );
}

function ProviderBreakdownChart({ providerSummary }) {
  const total = providerSummary.reduce((sum, item) => sum + item.cost, 0) || 1;
  return (
    <section className="billingChart providerCostCard">
      <div className="billingCardHeader">
        <div><span>Breakdown</span><strong>Provider costs</strong><small>OpenAI vs Grok/xAI</small></div>
      </div>
      <div className="providerBars providerBarsModern">
        {providerSummary.length ? providerSummary.map((item) => {
          const providerLabel = item.provider === "xai" || item.provider === "grok" ? "Grok / xAI" : item.provider || "Unknown";
          const pct = Math.round((item.cost / total) * 100);
          return (
            <div key={item.provider} className="providerCostRow">
              <div className="providerCostTitle">
                <span>{providerLabel}</span>
                <strong>{formatUsd(item.cost)}</strong>
              </div>
              <i><b style={{ width: `${Math.max(4, pct)}%` }} /></i>
              <small>{item.count} request{item.count === 1 ? "" : "s"} · {pct}% of tracked spend</small>
            </div>
          );
        }) : <p>No provider spend recorded yet.</p>}
        <div className="providerSummaryFooter">
          <span>Total tracked</span>
          <strong>{formatUsd(total)}</strong>
        </div>
      </div>
    </section>
  );
}

function BudgetStatusCard({ localBudget, setLocalBudget, spend }) {
  const remaining = Math.max(0, Number(localBudget || 0) - spend);
  const pct = Number(localBudget) ? Math.min(100, (spend / Number(localBudget)) * 100) : 0;
  return (
    <section className="budgetStatusCard billingMiniCard">
      <div className="billingCardHeader compact">
        <div><span>Budget</span><strong>{formatUsd(remaining)} remaining</strong></div>
      </div>
      <label><span>Local monthly budget</span><input type="number" min="0" step="0.5" value={localBudget} onChange={(event) => setLocalBudget(Number(event.target.value))} /></label>
      <div className="budgetMeter"><i style={{ width: `${pct}%` }} /></div>
      <p>{pct >= 80 ? "Warning threshold reached." : "Spend is within your local soft cap."}</p>
    </section>
  );
}

function StorageUsageCard({ snapshot, metrics }) {
  const storage = snapshot?.storage || {};
  return <section className="storageUsageCard billingMiniCard"><div className="billingCardHeader compact"><div><span>Storage</span><strong>{formatBytes(metrics.storageBytes)}</strong></div></div><div className="storageRows"><div><span>Uploaded sources</span><strong>{metrics.uploads}</strong></div><div><span>Generated images</span><strong>{storage.images?.count ?? metrics.images}</strong></div><div><span>Generated videos</span><strong>{storage.videos?.count ?? metrics.videos}</strong></div><div><span>Manifest events</span><strong>{snapshot?.manifestCount || 0}</strong></div></div></section>;
}

function UsageFilters({ filters, setFilters, providers }) {
  return (
    <section className="usageFilters usageFiltersModern">
      <div className="billingSearchBox"><Search size={15} /><input placeholder="Search prompts, models, assets..." value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></div>
      <select value={filters.provider} onChange={(event) => setFilters({ ...filters, provider: event.target.value })}><option value="all">All providers</option>{providers.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="all">All request types</option><option value="Image">Images</option><option value="Video">Videos</option><option value="Measurement">Analysis</option><option value="Agent">Agent</option></select>
      <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="all">All statuses</option><option value="completed">Success</option><option value="failed">Failed</option><option value="queued">Queued</option></select>
    </section>
  );
}

function BillingActivityTable({ rows, onSelect, onOpenLocation }) {
  return (
    <section className="billingTable billingTableModern">
      <div className="billingTableHeader"><div><span>Billing activity</span><strong>Detailed request ledger</strong><small>{rows.length} matching row{rows.length === 1 ? "" : "s"}</small></div></div>
      <div className="billingTableScroll"><table><thead><tr><th>Date/time</th><th>Type</th><th>Provider</th><th>Model</th><th>Status</th><th>Cost</th><th>Output</th><th></th></tr></thead><tbody>
        {rows.length ? rows.map((row) => <tr key={row.id} onClick={() => onSelect(row)}><td className="monoCell">{row.createdAt}</td><td><TypePill type={row.type} /></td><td><ProviderPill provider={row.provider} /></td><td>{row.model}</td><td><span className={`billingStatus ${row.status}`}>{row.status}</span></td><td className="costCell">{formatUsd(row.costUsd)}</td><td>{row.outputCount || "--"}</td><td>{row.asset?.url && <button type="button" onClick={(event) => { event.stopPropagation(); onOpenLocation(row.asset); }}>Open</button>}</td></tr>) : <tr><td colSpan="8">No billing activity matches the current filters.</td></tr>}
      </tbody></table></div>
    </section>
  );
}

function TypePill({ type }) {
  return <span className={`billingTypePill type-${String(type || "job").toLowerCase()}`}>{type || "Job"}</span>;
}

function ProviderPill({ provider }) {
  const isGrok = provider === "xai" || provider === "grok" || provider === "Grok / xAI";
  const isGemini = provider === "gemini" || provider === "Google Gemini";
  return <span className={`billingProviderPill ${isGemini ? "gemini" : isGrok ? "grok" : "openai"}`}>{isGemini ? <Sparkles size={13} /> : isGrok ? <Sparkles size={13} /> : <Wand2 size={13} />}{isGemini ? "Google Gemini" : isGrok ? "Grok / xAI" : provider || "OpenAI"}</span>;
}

function BillingDetailSheet({ row, onClose, onOpenLocation }) {
  return (
    <div className="billingSheetBackdrop" onMouseDown={onClose}>
      <aside className="billingDetailSheet" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose}>Close</button><span>Request detail</span><h3>{row.type} Â· {row.status}</h3>
        <dl><div><dt>Provider</dt><dd>{row.provider}</dd></div><div><dt>Model</dt><dd>{row.model}</dd></div><div><dt>Cost</dt><dd>{formatUsd(row.costUsd)}</dd></div><div><dt>Duration</dt><dd>{row.durationMs ? `${row.durationMs} ms` : "Not captured"}</dd></div><div><dt>Summary</dt><dd>{row.summary}</dd></div><div><dt>Save location</dt><dd>{row.asset?.path || row.asset?.url || "No asset"}</dd></div></dl>
        {row.asset?.url && <>{row.asset.kind === "video" ? <video src={row.asset.url} controls /> : <img src={row.asset.url} alt={row.summary} />}<button type="button" onClick={() => onOpenLocation(row.asset)}>Open saved folder</button></>}
      </aside>
    </div>
  );
}

function ProviderGuide({ measurementProvider, imageProvider, videoProvider }) {
  const grokActive = measurementProvider === "xai" || imageProvider === "xai" || videoProvider === "xai";
  const geminiActive = measurementProvider === "gemini" || imageProvider === "gemini" || videoProvider === "gemini";
  const activeModes = [
    measurementProvider === "xai" ? "Measurement" : null,
    imageProvider === "xai" ? "Image" : null,
    videoProvider === "xai" ? "Video" : null,
    measurementProvider === "gemini" ? "Gemini measurement" : null,
    imageProvider === "gemini" ? "Gemini image" : null,
    videoProvider === "gemini" ? "Gemini video" : null
  ].filter(Boolean);

  return (
    <section className={`providerGuide providerGuideCompact ${grokActive || geminiActive ? "grok" : ""}`}>
      <div>
        <span>Active AI engine</span>
        <strong>{geminiActive ? "Gemini is active" : grokActive ? "Grok / xAI is active" : "OpenAI is active"}</strong>
      </div>
      <p>{grokActive || geminiActive ? `${activeModes.join(", ")} workflows are routed through the selected provider.` : "Measurement, image and video workflows are routed through OpenAI where selected."}</p>
      <div className="providerMiniStats">
        <span>{measurementProvider === "gemini" ? "Gemini vision" : measurementProvider === "xai" ? "Grok vision" : "OpenAI vision"}</span>
        <span>{imageProvider === "gemini" ? "Imagen 3" : imageProvider === "xai" ? "Grok image" : "OpenAI image"}</span>
        <span>{videoProvider === "gemini" ? "Veo 3.1" : videoProvider === "xai" ? "Grok video" : "Sora video"}</span>
      </div>
    </section>
  );
}

function ModelPicker({ label, provider, setProvider, model, setModel, models }) {
  return (
    <div className="modelPicker">
      <span>{label}</span>
      <div>
        <select value={provider} onChange={(event) => setProvider(event.target.value)}>
          {providerOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select value={model} onChange={(event) => setModel(event.target.value)}>
          {models.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function WorkflowOverlay({ state, provider }) {
  const activeIndex = {
    idle: -1,
    uploaded: 0,
    analyzing: 1,
    completed: 3,
    fallback: 3
  }[state] ?? -1;
  const completed = state === "completed";
  const fallback = state === "fallback";
  const providerName = provider === "xai" ? "Grok/xAI" : "OpenAI";

  return (
    <div className={`workflowOverlay ${state}`}>
      <div className="workflowVideo">
        {completed ? <CircleCheck size={18} /> : <ScanLine size={18} />}
        <span>{completed ? `Completed via ${providerName} API` : fallback ? "Fallback estimate" : state === "analyzing" ? `${providerName} API call running` : "Fit flow ready"}</span>
      </div>
      <div className="workflowSteps">
        {measurementSteps.map((step, index) => (
          <div key={step} className={`workflowStep ${index <= activeIndex ? "active" : ""}`}>
            <i>{index <= activeIndex ? <Check size={13} /> : index + 1}</i>
            <span>{step}</span>
          </div>
        ))}
      </div>
      <p className="workflowMessage">
        {completed && `Measurement completed through the live ${providerName} API.`}
        {fallback && "OpenAI call did not complete; app is showing fallback values."}
        {state === "analyzing" && `Image is being sent to ${providerName} for measurement estimation.`}
        {(state === "uploaded" || state === "idle") && "Upload a reference image to start the live measurement call."}
      </p>
    </div>
  );
}

function buildUsageEntry(type, usage) {
  return {
    id: crypto.randomUUID(),
    type,
    provider: usage.provider || "openai",
    model: usage.model,
    inputTokens: usage.inputTokens || 0,
    cachedTokens: usage.cachedTokens || 0,
    outputTokens: usage.outputTokens || 0,
    totalTokens: usage.totalTokens || 0,
    costUsd: usage.costUsd || 0,
    status: usage.status || "completed",
    dayKey: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };
}

function shouldAutoRunAgentAction(message) {
  return ["edit_image", "generate_image", "generate_video"].includes(message.action) && Boolean(message.prompt);
}

function mediaAttachment(source) {
  if (!source) return null;
  return {
    name: source.file?.name || source.filename || source.name || "Reference image",
    url: source.url,
    type: source.kind || "image"
  };
}

async function appendReferenceToFormData(formData, source, fieldName = "reference") {
  if (!source) return;
  if (source.file) {
    formData.append(fieldName, source.file);
    return;
  }
  if (!source.url) return;

  const response = await fetch(source.url);
  if (!response.ok) throw new Error("Could not load the saved image for the next Grok request.");
  const blob = await response.blob();
  const filename = source.filename || source.name || "agent-reference.png";
  formData.append(fieldName, new File([blob], filename, { type: blob.type || "image/png" }));
}

function normalizeSavedMedia(saved = [], kind = "image", provider = "openai", model = "", label = "") {
  const savedAt = new Date().toISOString();
  return (saved || []).map((item) => ({
    id: crypto.randomUUID(),
    kind: kind === "video" ? "video" : "image",
    label: label || (kind === "video" ? "Generated video" : "Generated image"),
    provider: providerLabel(provider),
    model,
    url: item.url,
    path: item.path,
    filename: item.filename,
    costUsd: Number(item.costUsd || item.estimatedCostUsd || 0),
    savedAt,
    createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  })).filter((item) => item.url);
}

function manifestToMediaResult(item) {
  if (!item?.url) return null;
  const url = String(item.url);
  const outputType = String(item.type || item.jobType || "").toLowerCase();
  const isImage = outputType.includes("image") || url.includes("/outputs/images/");
  const isVideo = outputType.includes("video") || url.includes("/outputs/videos/");
  if (!isImage && !isVideo) return null;

  const model = item.model || "";
  const provider = item.provider === "xai" || item.provider === "grok" || model.toLowerCase().includes("grok")
    ? "Grok / xAI"
    : item.provider === "gemini" || model.toLowerCase().includes("gemini") || model.toLowerCase().includes("imagen") || model.toLowerCase().includes("veo")
      ? "Google Gemini"
    : item.provider === "openai"
      ? "OpenAI"
      : providerLabel(item.provider);
  const kind = isVideo ? "video" : "image";
  const jobType = String(item.jobType || item.type || "").toLowerCase();
  const label = jobType.includes("edit")
    ? "Edited image"
    : jobType.includes("minimal")
      ? "Minimal styling"
      : kind === "video"
        ? "Generated video"
        : "Generated image";

  return {
    id: `manifest-${item.filename || url}`,
    kind,
    label,
    provider,
    model,
    url,
    path: item.path,
    filename: item.filename,
    costUsd: Number(item.costUsd || item.estimatedCostUsd || 0),
    savedAt: item.createdAt || new Date().toISOString(),
    projectId: item.projectId || defaultProjectId,
    prompt: item.prompt || "",
    isFavorite: Boolean(item.isFavorite),
    createdAt: item.createdAt
      ? new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };
}

function mergeMediaResults(current = [], incoming = []) {
  const seen = new Set();
  return sortMediaResults([...incoming, ...current].filter((item) => {
    if (!item?.url) return false;
    const key = item.filename || item.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function mediaBelongsToProject(item, activeProjectId = defaultProjectId) {
  if (!item.projectId) return activeProjectId === defaultProjectId;
  return item.projectId === activeProjectId;
}

function filterMediaResults(items = [], filters = {}) {
  const query = String(filters.query || "").toLowerCase().trim();
  const provider = String(filters.provider || "all").toLowerCase();
  const type = String(filters.type || "all").toLowerCase();
  return sortMediaResults(items).filter((item) => {
    const searchable = `${item.label || ""} ${item.prompt || ""} ${item.model || ""} ${item.filename || ""}`.toLowerCase();
    const matchesQuery = !query || searchable.includes(query);
    const providerKey = providerValueFromLabel(item.provider);
    const matchesProvider = provider === "all" || providerKey === provider;
    const label = String(item.label || item.resultType || "").toLowerCase();
    const matchesType = type === "all"
      || (type === "favorite" && item.isFavorite)
      || (type === "edited" && label.includes("edit"))
      || item.kind === type;
    return matchesQuery && matchesProvider && matchesType;
  });
}

function sortMediaResults(items = []) {
  return [...items].sort((a, b) => mediaTimestamp(b) - mediaTimestamp(a));
}

function mediaTimestamp(item = {}) {
  if (item.savedAt) {
    const value = Date.parse(item.savedAt);
    if (Number.isFinite(value)) return value;
  }
  if (item.createdAt) {
    const value = Date.parse(item.createdAt);
    if (Number.isFinite(value)) return value;
  }
  const fromFilename = String(item.filename || item.url || "").match(/-(\d{10,})-/);
  if (fromFilename) return Number(fromFilename[1]);
  return 0;
}

function relativeSavedTime(item = {}) {
  const timestamp = mediaTimestamp(item);
  if (!timestamp) return item.createdAt || "Saved locally";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Saved just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Saved ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Saved ${hours} hr ago`;
  return `Saved ${Math.floor(hours / 24)} day${hours >= 48 ? "s" : ""} ago`;
}

function displaySavedLocation(item) {
  if (item.url?.startsWith("/outputs/")) return item.url.replace(/^\//, "");
  if (item.filename) return item.kind === "video" ? `outputs/videos/${item.filename}` : `outputs/images/${item.filename}`;
  return "outputs";
}

function providerLabel(provider) {
  if (provider === "xai" || provider === "grok") return "Grok / xAI";
  if (provider === "gemini" || provider === "google") return "Google Gemini";
  return "OpenAI";
}

function providerValueFromLabel(provider = "") {
  const label = String(provider || "").toLowerCase();
  if (label.includes("grok") || label.includes("xai")) return "xai";
  if (label.includes("gemini") || label.includes("google")) return "gemini";
  if (label.includes("openai")) return "openai";
  return "";
}

function readableIntent(intent = "") {
  return intent
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ") || "Workflow route";
}

function buildRouteSteps(mode = "image") {
  if (mode === "edit") {
    return [
      { label: "Prepare image", detail: "Attach the selected photo and your edit prompt." },
      { label: "Ask OpenAI", detail: "OpenAI reads intent, image context, and constraints." },
      { label: "Route edit", detail: "Choose the best image edit provider and refined prompt." },
      { label: "Save result", detail: "Return edited media and store it locally." }
    ];
  }
  if (mode === "video") {
    return [
      { label: "Prepare brief", detail: "Collect prompt, duration, quality, and reference image." },
      { label: "Ask OpenAI", detail: "OpenAI plans the video workflow and provider." },
      { label: "Generate video", detail: "Send request to the selected video model." },
      { label: "Save result", detail: "Return video media and store it locally." }
    ];
  }
  if (mode === "measure") {
    return [
      { label: "Prepare photo", detail: "Attach the uploaded model image." },
      { label: "Ask OpenAI", detail: "OpenAI confirms the measurement workflow." },
      { label: "Measure", detail: "Run visual sizing estimate." },
      { label: "Review", detail: "Show UK sizing and measurement summary." }
    ];
  }
  return [
    { label: "Prepare prompt", detail: "Collect the creative direction and settings." },
    { label: "Ask OpenAI", detail: "OpenAI improves the prompt and chooses provider." },
    { label: "Generate", detail: "Send request to the selected image model." },
    { label: "Save result", detail: "Return generated media and store it locally." }
  ];
}

function buildEditTimeline({ source, userPrompt, refinedPrompt, session, activity, result }) {
  const status = session?.status || "idle";
  const completed = status === "completed";
  const failed = status === "failed";
  const activeStage = activity?.stage ?? (completed ? 5 : failed ? 3 : status === "running" ? 2 : source ? 1 : 0);
  const rows = [
    {
      label: "Image selected",
      detail: source ? source.file?.name || source.filename || source.name || "Source image attached" : "Choose a local image before editing.",
      time: source ? session?.requestedAt || "Ready" : "",
      doneWhen: Boolean(source)
    },
    {
      label: "Prompt written",
      detail: userPrompt ? "User edit instruction captured." : "Write what should change in the image.",
      time: userPrompt ? "Ready" : "",
      doneWhen: Boolean(userPrompt)
    },
    {
      label: "Prompt enhanced by AI",
      detail: refinedPrompt || "OpenAI will show the improved provider prompt here after routing.",
      time: refinedPrompt ? session?.completedAt || "Completed" : "",
      doneWhen: Boolean(refinedPrompt)
    },
    {
      label: "Routed to provider",
      detail: session?.provider && session?.model ? `${session.provider} Â· ${session.model}` : "Waiting for provider decision.",
      time: session?.requestedAt || "",
      doneWhen: Boolean(session?.provider && session?.provider !== "OpenAI routing")
    },
    {
      label: "Provider returned image",
      detail: result ? "Edited image received from provider." : failed ? session?.providerMessage || "Provider failed." : "Waiting for returned image.",
      time: result ? session?.completedAt : "",
      doneWhen: Boolean(result)
    },
    {
      label: "Image saved",
      detail: result?.filename ? `Saved locally: ${displaySavedLocation(result)}` : "Saved file path will appear after completion.",
      time: result ? session?.completedAt : "",
      doneWhen: Boolean(result?.filename)
    }
  ];

  return rows.map((row, index) => ({
    ...row,
    index: index + 1,
    status: row.doneWhen ? "done" : failed && index >= activeStage ? "failed" : index === activeStage ? "active" : "pending"
  }));
}

function buildTodayStats(log) {
  const today = new Date().toISOString().slice(0, 10);
  return log.reduce((stats, item) => {
    if (item.dayKey === today && stats[item.type] !== undefined) stats[item.type] += 1;
    return stats;
  }, { Measurement: 0, Image: 0, Video: 0 });
}

function buildAgentCostStats(log) {
  const today = new Date().toISOString().slice(0, 10);
  const agentRows = log.filter((item) => item.type === "Agent");
  return {
    last: agentRows[0] || null,
    todayTotal: agentRows
      .filter((item) => item.dayKey === today)
      .reduce((total, item) => total + item.costUsd, 0)
  };
}

function buildBillingMetrics({ usageLog, mediaResults, files, snapshot, localBudget }) {
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthUsage = usageLog.filter((item) => (item.dayKey || "").startsWith(monthKey));
  const manifestUsage = (snapshot?.recentAssets || []).map(manifestToUsageItem).filter((item) => (item.dayKey || "").startsWith(monthKey));
  const hasManifestCosts = manifestUsage.some((item) => Number(item.costUsd || 0) > 0);
  const localUsage = hasManifestCosts
    ? monthUsage.filter((item) => !["xai", "grok", "Grok / xAI", "gemini", "Google Gemini"].includes(item.provider))
    : monthUsage;
  const billingUsage = [...localUsage, ...manifestUsage];
  const grokSpend = snapshot?.totals?.grokSpend ?? billingUsage.filter((item) => ["xai", "grok", "Grok / xAI"].includes(item.provider)).reduce((sum, item) => sum + Number(item.costUsd || 0), 0);
  const geminiSpend = snapshot?.totals?.geminiSpend ?? billingUsage.filter((item) => ["gemini", "Google Gemini"].includes(item.provider)).reduce((sum, item) => sum + Number(item.costUsd || 0), 0);
  const openaiLocalSpend = snapshot?.totals?.openaiSpend ?? billingUsage.filter((item) => item.provider === "openai" || item.provider === "OpenAI").reduce((sum, item) => sum + Number(item.costUsd || 0), 0);
  const openaiOfficial = snapshot?.openaiOfficial || {};
  const openaiOfficialAvailable = openaiOfficial.status === "completed" && Number.isFinite(Number(openaiOfficial.totalCostUsd));
  const openaiOfficialSpend = openaiOfficialAvailable ? Number(openaiOfficial.totalCostUsd || 0) : 0;
  const openaiSpend = openaiOfficialAvailable ? openaiOfficialSpend : openaiLocalSpend;
  const monthSpend = grokSpend + geminiSpend + openaiSpend;
  const generationItems = billingUsage.filter((item) => ["Image", "Video"].includes(item.type));
  const images = mediaResults.filter((item) => item.kind === "image").length;
  const videos = mediaResults.filter((item) => item.kind === "video").length;
  const failed = monthUsage.filter((item) => ["failed", "stopped", "rejected"].includes(item.status)).length + (snapshot?.failedJobs || 0);
  const providerSummary = summarizeBy(billingUsage, "provider");
  const openaiProvider = providerSummary.find((item) => item.provider === "openai" || item.provider === "OpenAI");
  if (openaiProvider && openaiOfficialAvailable) openaiProvider.cost = openaiOfficialSpend;
  if (!openaiProvider && openaiOfficialAvailable) providerSummary.push({ provider: "OpenAI", count: 1, cost: openaiOfficialSpend });
  return {
    monthSpend,
    estimatedNextBill: openaiOfficialAvailable ? monthSpend * 1.18 : snapshot?.totals?.estimatedNextBill ?? monthSpend * 1.18,
    grokSpend,
    geminiSpend,
    openaiSpend,
    openaiLocalSpend,
    openaiOfficialSpend,
    openaiOfficialAvailable,
    openaiOfficialMessage: openaiOfficialAvailable ? "Official OpenAI Costs API" : openaiOfficial.message || "Admin key required",
    openaiDifference: openaiOfficialAvailable ? openaiOfficialSpend - openaiLocalSpend : 0,
    images,
    videos,
    uploads: files.length + (snapshot?.uploads || 0),
    storageBytes: snapshot?.storage?.totalBytes || estimateMediaStorage(mediaResults),
    averageCost: generationItems.length ? monthSpend / generationItems.length : 0,
    failed,
    providerSummary,
    modelSummary: summarizeBy(billingUsage, "model"),
    dailyTrend: buildDailyBillingTrend(billingUsage),
    remainingBudget: Math.max(0, Number(localBudget || 0) - monthSpend)
  };
}

function manifestToUsageItem(item = {}) {
  const created = item.createdAt ? new Date(item.createdAt) : new Date();
  const itemType = item.jobType || item.type || "";
  const type = itemType.includes("video") ? "Video" : itemType.includes("measurement") ? "Measurement" : itemType.includes("agent") ? "Agent" : "Image";
  const provider = item.provider === "grok" || item.provider === "xai" ? "Grok / xAI" : item.provider || "--";
  return {
    id: item.id || `${item.type || "manifest"}-${item.filename || item.createdAt || Math.random()}`,
    type,
    provider,
    model: item.model || "--",
    status: item.status || item.finalStatus || "completed",
    costUsd: Number(item.costUsd || item.estimatedCostUsd || 0),
    dayKey: created.toISOString().slice(0, 10),
    createdAt: created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };
}

function summarizeBy(items, key) {
  const map = new Map();
  items.forEach((item) => {
    const label = item[key] || "unknown";
    const current = map.get(label) || { provider: label, model: label, count: 0, cost: 0 };
    current.count += 1;
    current.cost += Number(item.costUsd || 0);
    map.set(label, current);
  });
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

function buildDailyBillingTrend(items) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const day = date.toISOString().slice(0, 10);
    const dayItems = items.filter((item) => item.dayKey === day);
    return { label: day.slice(5), count: dayItems.length, cost: dayItems.reduce((sum, item) => sum + Number(item.costUsd || 0), 0) };
  });
}

function buildBillingActivity({ usageLog, mediaResults, snapshot }) {
  const usageRows = usageLog.map((item) => ({
    id: item.id,
    createdAt: item.createdAt,
    type: item.type,
    provider: item.provider === "xai" ? "Grok / xAI" : item.provider || "OpenAI",
    model: item.model || "--",
    status: item.status || "completed",
    costUsd: item.costUsd || 0,
    outputCount: ["Video", "Image"].includes(item.type) ? 1 : 0,
    summary: `${item.type} request via ${item.model || "selected model"}`,
    durationMs: item.latencyMs || 0,
    asset: null
  }));
  const mediaRows = mediaResults.map((item) => ({
    id: `asset-${item.id}`,
    createdAt: item.createdAt || "--",
    type: item.kind === "video" ? "Video" : "Image",
    provider: item.provider || "--",
    model: item.model || "--",
    status: "completed",
    costUsd: item.costUsd || 0,
    outputCount: 1,
    summary: item.label || item.filename || "Saved media asset",
    durationMs: 0,
    asset: item
  }));
  const manifestRows = (snapshot?.recentAssets || []).map((item, index) => ({
    id: `manifest-${index}-${item.filename || item.createdAt}`,
    createdAt: item.createdAt ? new Date(item.createdAt).toLocaleString() : "--",
    type: item.jobType?.includes("video") || item.type?.includes("video") ? "Video" : item.jobType?.includes("measurement") ? "Measurement" : item.jobType?.includes("agent") || item.type?.includes("usage") ? "Agent" : item.type?.includes("log") ? "Log" : "Image",
    provider: item.provider === "xai" || item.provider === "grok" ? "Grok / xAI" : item.provider || "--",
    model: item.model || "--",
    status: item.status || "completed",
    costUsd: item.costUsd || item.estimatedCostUsd || 0,
    outputCount: item.url ? 1 : 0,
    summary: item.providerResponse || item.filename || "Stored output",
    durationMs: item.latency_ms || 0,
    asset: item.url ? { ...item, kind: item.type?.includes("video") ? "video" : "image" } : null
  }));
  return [...usageRows, ...mediaRows, ...manifestRows].slice(0, 100);
}

function filterBillingActivity(rows, filters) {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.provider !== "all" && row.provider !== filters.provider) return false;
    if (filters.type !== "all" && row.type !== filters.type) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (!query) return true;
    return [row.type, row.provider, row.model, row.status, row.summary, row.asset?.filename].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
}

function estimateMediaStorage(mediaResults) {
  return mediaResults.length * 1.8 * 1024 * 1024;
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "--";
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function loadStoredArray(key, fallback = []) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(parsed) && parsed.length ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function seedPromptLibrary() {
  const now = new Date().toISOString();
  return [
    {
      id: "prompt-editorial-suit",
      title: "Luxury editorial suit",
      prompt: "Create a photorealistic full-body fashion editorial image in a luxury interior, premium tailoring, natural daylight, realistic fabric detail, clean background, vertical composition.",
      negativePrompt: "No text, logos, distorted hands, duplicate limbs, or unrealistic body proportions.",
      tags: ["editorial", "tailoring", "photoreal"],
      type: "image",
      providerCompatibility: ["OpenAI", "Gemini", "Grok"],
      favorite: true,
      projectId: defaultProjectId,
      createdAt: now
    },
    {
      id: "prompt-fit-video",
      title: "Fit-review walk cycle",
      prompt: "Animate the fashion model into a smooth fit-review turn and short walk cycle. Keep identity, outfit, body proportions, lighting, and styling consistent. Realistic fabric movement, no text or logos.",
      negativePrompt: "",
      tags: ["video", "fit-review", "consistent"],
      type: "video",
      providerCompatibility: ["Gemini", "OpenAI", "Grok"],
      favorite: true,
      projectId: defaultProjectId,
      createdAt: now
    }
  ];
}

function promptTitle(prompt = "") {
  const clean = String(prompt).replace(/\s+/g, " ").trim();
  return clean.length > 46 ? `${clean.slice(0, 43)}...` : clean || "Saved prompt";
}

function inferPromptTags(prompt = "", mode = "image") {
  const lower = prompt.toLowerCase();
  const tags = new Set([mode === "video" ? "video" : mode === "edit" ? "edit" : "image"]);
  if (lower.includes("editorial")) tags.add("editorial");
  if (lower.includes("studio")) tags.add("studio");
  if (lower.includes("luxury")) tags.add("luxury");
  if (lower.includes("realistic") || lower.includes("photoreal")) tags.add("photoreal");
  if (lower.includes("consistent")) tags.add("consistent");
  return Array.from(tags).slice(0, 5);
}

function compatibleProvidersForMode(mode) {
  if (mode === "video") return ["OpenAI", "Gemini", "Grok"];
  if (mode === "edit") return ["Grok", "Gemini"];
  if (mode === "measure") return ["Grok", "OpenAI", "Gemini"];
  return ["OpenAI", "Gemini", "Grok"];
}

function sortProjects(projects = []) {
  return [...projects].sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
}

function relativeProjectTime(project = {}) {
  if (!project?.updatedAt) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(project.updatedAt)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} day${hours >= 48 ? "s" : ""} ago`;
}

function buildModelRecommendation(mode, context = {}) {
  if (mode === "video") {
    return {
      provider: "gemini",
      providerLabel: "Google Gemini",
      model: videoModelOptions.gemini[0].value,
      modelLabel: videoModelOptions.gemini[0].label,
      reason: "Best fit for image-to-video and async creative video jobs. You can still override to Sora or Grok."
    };
  }
  if (mode === "edit") {
    return {
      provider: "xai",
      providerLabel: "Grok / xAI",
      model: editModelOptions.xai[1].value,
      modelLabel: editModelOptions.xai[1].label,
      reason: "Best current path for image editing and restyling while keeping a clear source image context."
    };
  }
  if (mode === "measure") {
    return {
      provider: "xai",
      providerLabel: "Grok / xAI",
      model: measurementModelOptions.xai[0].value,
      modelLabel: measurementModelOptions.xai[0].label,
      reason: "Reasoning vision is best for body-measurement analysis and confidence notes."
    };
  }
  return {
    provider: "openai",
    providerLabel: "OpenAI",
    model: imageModelOptions.openai[0].value,
    modelLabel: imageModelOptions.openai[0].label,
    reason: "Strong default for prompt-to-image generation and polished fashion editorial compositions."
  };
}

function ShoppingModal({ guide, onClose }) {
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label={`${guide.title} shopping guide`}>
      <section className="shoppingModal">
        <div className="modalHero">
          <div className="videoPreview" aria-label="Short product preview">
            <div className="scanFrame">
              <Sparkles size={22} />
              <strong>{guide.size}</strong>
              <span>{guide.videoLabel}</span>
            </div>
          </div>
          <div className="modalIntro">
            <span>{guide.eyebrow}</span>
            <h2>{guide.title}</h2>
            <p>{guide.description}</p>
            <div className="shopFitScore">
              <strong>{guide.matchScore}</strong>
              <small>{guide.matchLabel}</small>
            </div>
          </div>
        </div>

        <div className="shopInsightGrid">
          {guide.insights.map((insight) => (
            <article key={insight.label}>
              <span>{insight.label}</span>
              <strong>{insight.value}</strong>
              <small>{insight.detail}</small>
            </article>
          ))}
        </div>

        <div className="shopFitChecklist">
          <div>
            <span>Fit checks before buying</span>
            <strong>Use these checks on the retailer size guide</strong>
          </div>
          <ul>
            {guide.fitChecks.map((check) => <li key={check}>{check}</li>)}
          </ul>
        </div>

        <div className="storeGrid">
          {guide.products.map((product) => (
            <a key={product.name} className="storeCard" href={product.href} target="_blank" rel="noreferrer">
              <span>{product.store}</span>
              <strong>{product.name}</strong>
              <small>{product.detail}</small>
              <em>{product.matchReason}</em>
            </a>
          ))}
        </div>

        <div className="modalActions">
          <p>{guide.disclaimer}</p>
          <button onClick={onClose} type="button">Close</button>
        </div>
      </section>
    </div>
  );
}

function FitShoppingAssistant({ fitProfile, onOpenGuide }) {
  const bra = fitProfile.recommendations.find((item) => item.type === "bra");
  const underwear = fitProfile.recommendations.find((item) => item.type === "underwear");
  const dress = fitProfile.recommendations.find((item) => item.label === "UK Dress");
  const hasSize = Boolean(bra && bra.value !== "--") || Boolean(underwear && underwear.value !== "--");

  return (
    <section className="fitShoppingAssistant">
      <div className="fitShopHeader">
        <div>
          <span>Fit-to-shop assistant</span>
          <strong>Find UK size matches from this measurement scan</strong>
        </div>
        <em>{hasSize ? "Ready" : "Needs scan"}</em>
      </div>
      <div className="fitShopActions">
        <button type="button" disabled={!bra || bra.value === "--"} onClick={() => onOpenGuide(buildShoppingGuide(bra, fitProfile))}>
          <Shirt size={16} />
          <span>Shop bra fit</span>
          <strong>{bra?.value || "--"}</strong>
        </button>
        <button type="button" disabled={!underwear || underwear.value === "--"} onClick={() => onOpenGuide(buildShoppingGuide(underwear, fitProfile))}>
          <Sparkles size={16} />
          <span>Shop underwear fit</span>
          <strong>{underwear?.value || "--"}</strong>
        </button>
      </div>
      <p>
        Dress guide: <strong>{dress?.value || "--"}</strong>. The links open retailer searches, not scraped pages, so prices and stock are confirmed directly by the store.
      </p>
    </section>
  );
}

function GeneratorCard({
  icon,
  title,
  subtitle,
  prompt,
  setPrompt,
  primaryLabel,
  busyLabel = "Working",
  disabled = false,
  costHint = "",
  onGenerate,
  recommendation,
  onApplyRecommendation,
  onSavePrompt,
  onOpenPromptLibrary,
  children
}) {
  return (
    <article className="generatorCard">
      <div className="panelHeader">
        {icon}
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      {recommendation && <ModelRecommendationCard recommendation={recommendation} onApply={onApplyRecommendation} />}
      <label className="promptBox">
        <span>
          Creative direction
          <button type="button" onClick={onSavePrompt}><Star size={13} /> Save prompt</button>
          <button type="button" onClick={onOpenPromptLibrary}><Tag size={13} /> Library</button>
        </span>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <details className="advancedDetails">
        <summary>Advanced settings</summary>
        <div className="generatorControls">{children}</div>
      </details>
      {costHint && <div className="actionCostHint">{costHint}</div>}
      <button className="generateButton" onClick={onGenerate} disabled={disabled}>
        <Wand2 size={18} />
        {disabled ? busyLabel : primaryLabel}
      </button>
    </article>
  );
}

function ModelRecommendationCard({ recommendation, onApply }) {
  return (
    <div className="modelRecommendationCard">
      <div>
        <span>Recommended for this task</span>
        <strong>{recommendation.providerLabel} · {recommendation.modelLabel}</strong>
        <small>{recommendation.reason}</small>
      </div>
      <button type="button" onClick={() => onApply?.(recommendation)}>Apply</button>
    </div>
  );
}

function PromptLibraryDrawer({ prompts, activeMode, onClose, onInsert, onToggleFavorite }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const filtered = prompts.filter((prompt) => {
    const text = `${prompt.title} ${prompt.prompt} ${(prompt.tags || []).join(" ")}`.toLowerCase();
    const matchesQuery = !query || text.includes(query.toLowerCase());
    const matchesType = type === "all" || prompt.type === type;
    return matchesQuery && matchesType;
  });

  return (
    <div className="promptDrawerBackdrop" onMouseDown={onClose}>
      <aside className="promptLibraryDrawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="promptDrawerHeader">
          <div>
            <span>Prompt library</span>
            <strong>Reuse successful creative directions</strong>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="promptLibraryFilters">
          <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prompts or tags" /></label>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">All types</option>
            <option value="image">Image</option>
            <option value="edit">Edit</option>
            <option value="video">Video</option>
          </select>
        </div>
        <div className="promptLibraryList">
          {filtered.length ? filtered.map((prompt) => (
            <article key={prompt.id} className="promptLibraryItem">
              <div>
                <span>{prompt.type} · {(prompt.providerCompatibility || []).join(", ")}</span>
                <strong>{prompt.title}</strong>
                <p>{prompt.prompt}</p>
                <div>{(prompt.tags || []).map((tag) => <em key={tag}>{tag}</em>)}</div>
              </div>
              <div className="promptLibraryActions">
                <button type="button" onClick={() => onToggleFavorite(prompt.id)}><Star size={14} fill={prompt.favorite ? "currentColor" : "none"} /></button>
                <button type="button" onClick={() => onInsert(prompt)}>Insert</button>
              </div>
            </article>
          )) : (
            <div className="promptLibraryEmpty">
              <Sparkles size={22} />
              <strong>No prompts found</strong>
              <span>Save a prompt from the editor to build a reusable studio library.</span>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function MinimalStylingStatus({ result, isRunning }) {
  if (!result && !isRunning) {
    return (
      <div className="minimalStatus idle">
        <span>Minimal Styling</span>
        <strong>One safe fashion simplification pass</strong>
        <small>OpenAI checks policy first, then Grok gets at most two compliant edit attempts.</small>
      </div>
    );
  }

  const events = result?.events?.length
    ? result.events
    : [
        { stage: "request", status: "accepted", providerResponse: "Image attached. Preparing request." },
        { stage: "planner", status: isRunning ? "running" : "pending", providerResponse: "OpenAI safety planner is preparing prompts." }
      ];
  const outcome = result?.finalOutcome || result?.status || (isRunning ? "running" : "idle");

  return (
    <div className={`minimalStatus ${outcome}`}>
      <div className="minimalStatusHeader">
        <span>Minimal Styling status</span>
        <strong>{readableIntent(outcome)}</strong>
      </div>
      <div className="minimalTimeline">
        {events.slice(-5).map((event, index) => (
          <div key={`${event.stage}-${event.status}-${index}`} className={`minimalEvent ${event.status}`}>
            <i>{index + 1}</i>
            <div>
              <strong>{event.stage || "step"} Â· {event.status || "pending"}</strong>
              <small>{event.providerResponse || event.rejectionReason || "Waiting for provider response."}</small>
            </div>
          </div>
        ))}
      </div>
      {result?.message && <p>{result.message}</p>}
    </div>
  );
}

function Segmented({ label, value, onChange, options, compact = false }) {
  return (
    <div className="controlGroup">
      <span>{label}</span>
      <div className={`segmented ${compact ? "compact" : ""}`}>
        {options.map((option) => (
          <button
            key={option.value}
            className={value === option.value ? "selected" : ""}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <strong>{option.label}</strong>
            {option.note && <small>{option.note}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

function buildEmptyFitProfile() {
  return {
    sourceLabel: "Smart Measurement Estimate",
    confidenceLabel: "Upload an image to start",
    confidenceScore: undefined,
    globalSizes: null,
    notes: "AI visual estimates are approximate fit-starting points.",
    recommendations: [
      { label: "UK Bra", value: "--", note: "Needs bust + underbust", type: "bra" },
      { label: "Underwear", value: "--", note: "Needs hip measurement", type: "underwear" },
      { label: "UK Dress", value: "--", note: "Needs bust, waist, hip" }
    ],
    measurements: [
      emptyMeasurement("Height", "Full body"),
      emptyMeasurement("Shoulder", "Across back"),
      emptyMeasurement("Bust", "Fullest point"),
      emptyMeasurement("Underbust", "Band line"),
      emptyMeasurement("Waist", "Natural waist"),
      emptyMeasurement("Hip", "Fullest hip"),
      emptyMeasurement("Inseam", "Inside leg"),
      emptyMeasurement("Arm Length", "Shoulder to wrist"),
      emptyMeasurement("Thigh", "Upper leg"),
      emptyMeasurement("Calf", "Fullest calf")
    ]
  };
}

function buildDraftFitProfile(file, note = "Draft fallback uses the uploaded file only until OpenAI returns a vision estimate.") {
  const seed = file.file.size % 9;
  const values = {
    height: 172 + seed,
    shoulder: 40 + (seed % 4),
    bust: 84 + seed,
    underbust: 73 + (seed % 6),
    waist: 64 + (seed % 7),
    hip: 91 + (seed % 6),
    inseam: 78 + (seed % 5),
    armLength: 57 + (seed % 4),
    thigh: 53 + (seed % 5),
    calf: 35 + (seed % 4)
  };

  return buildProfileFromValues(values, {
    sourceLabel: "Draft Measurement Fallback",
    confidenceLabel: "Fallback estimate",
    notes: note
  });
}

function buildAiFitProfile(measurement, model, provider = "openai") {
  const confidenceByField = measurement.confidenceByField || {};
  const values = {
    height: cleanNumber(measurement.heightCm, 172),
    shoulder: cleanNumber(measurement.shoulderCm, 41),
    bust: cleanNumber(measurement.bustCm, 88),
    underbust: cleanNumber(measurement.underbustCm, 76),
    waist: cleanNumber(measurement.waistCm, 68),
    hip: cleanNumber(measurement.hipCm, 96),
    inseam: cleanNumber(measurement.inseamCm, 80),
    armLength: cleanNumber(measurement.armLengthCm, 58),
    thigh: cleanNumber(measurement.thighCm, 55),
    calf: cleanNumber(measurement.calfCm, 36)
  };

  const confidence = measurement.confidence || "low";
  return buildProfileFromValues(values, {
    sourceLabel: provider === "gemini" ? "Gemini Vision Measurement" : provider === "xai" ? "Grok Vision Measurement" : "OpenAI Vision Measurement",
    confidenceLabel: provider === "xai" && measurement.confidenceScore ? `Grok Confidence: ${measurement.confidenceScore}% via ${model}` : provider === "gemini" && measurement.confidenceScore ? `Gemini Confidence: ${measurement.confidenceScore}% via ${model}` : `${confidence.toUpperCase()} confidence via ${model}`,
    confidenceScore: measurement.confidenceScore,
    confidenceByField,
    globalSizes: measurement.recommendations || null,
    notes: measurement.recommendations?.fitNotes || measurement.notes || `${provider === "gemini" ? "Gemini" : provider === "xai" ? "Grok/xAI" : "OpenAI"} vision produced this approximate sizing estimate from the uploaded photo.`
  });
}

function buildProfileFromValues(values, meta) {
  const confidenceByField = meta.confidenceByField || {};
  return {
    ...meta,
    recommendations: [
      { label: "UK Bra", value: estimateUkBra(values.bust, values.underbust), note: "Band + cup estimate", type: "bra" },
      { label: "Underwear", value: estimateUkUnderwear(values.hip), note: "UK brief size", type: "underwear" },
      { label: "UK Dress", value: estimateUkDress(values.bust, values.waist, values.hip), note: "Best sample size" }
    ],
    measurements: [
      makeMeasurement("Height", values.height, "Full body", confidenceByField.heightCm),
      makeMeasurement("Shoulder", values.shoulder, "Across back", confidenceByField.shoulderCm),
      makeMeasurement("Bust", values.bust, "Fullest point", confidenceByField.bustCm),
      makeMeasurement("Underbust", values.underbust, "Band line", confidenceByField.underbustCm),
      makeMeasurement("Waist", values.waist, "Natural waist", confidenceByField.waistCm),
      makeMeasurement("Hip", values.hip, "Fullest hip", confidenceByField.hipCm),
      makeMeasurement("Inseam", values.inseam, "Inside leg", confidenceByField.inseamCm),
      makeMeasurement("Arm Length", values.armLength, "Shoulder to wrist", confidenceByField.armLengthCm),
      makeMeasurement("Thigh", values.thigh, "Upper leg", confidenceByField.thighCm),
      makeMeasurement("Calf", values.calf, "Fullest calf", confidenceByField.calfCm)
    ]
  };
}

function cleanNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.round(number);
}

function emptyMeasurement(label, note) {
  return { label, note, metric: "--", imperial: "--" };
}

function makeMeasurement(label, centimeters, note, confidence) {
  return {
    label,
    note,
    metric: `${centimeters} cm`,
    imperial: `${(centimeters / 2.54).toFixed(1)} in`,
    confidence
  };
}

function confidenceTone(score = 0) {
  if (score >= 75) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function estimateUkBra(bustCm, underbustCm) {
  const underbustIn = underbustCm / 2.54;
  const bustIn = bustCm / 2.54;
  const band = Math.max(28, Math.round(underbustIn / 2) * 2);
  const cupSteps = ["AA", "A", "B", "C", "D", "DD", "E", "F", "FF", "G"];
  const cupIndex = Math.min(cupSteps.length - 1, Math.max(0, Math.round(bustIn - band)));
  return `${band}${cupSteps[cupIndex]}`;
}

function estimateUkUnderwear(hipCm) {
  if (hipCm < 88) return "UK 6 / XS";
  if (hipCm < 94) return "UK 8 / S";
  if (hipCm < 100) return "UK 10 / M";
  if (hipCm < 106) return "UK 12 / L";
  if (hipCm < 112) return "UK 14 / XL";
  return "UK 16+";
}

function estimateUkDress(bustCm, waistCm, hipCm) {
  const score = Math.max(sizeFromBust(bustCm), sizeFromWaist(waistCm), sizeFromHip(hipCm));
  return `UK ${score}`;
}

function sizeFromBust(cm) {
  if (cm < 82) return 6;
  if (cm < 87) return 8;
  if (cm < 92) return 10;
  if (cm < 97) return 12;
  if (cm < 102) return 14;
  return 16;
}

function sizeFromWaist(cm) {
  if (cm < 64) return 6;
  if (cm < 69) return 8;
  if (cm < 74) return 10;
  if (cm < 79) return 12;
  if (cm < 84) return 14;
  return 16;
}

function sizeFromHip(cm) {
  if (cm < 88) return 6;
  if (cm < 93) return 8;
  if (cm < 98) return 10;
  if (cm < 103) return 12;
  if (cm < 108) return 14;
  return 16;
}

function compactMessage(message = "") {
  const lower = message.toLowerCase();
  if (lower.includes("429") || lower.includes("quota") || lower.includes("billing")) {
    return "API credit needed. Showing draft fallback.";
  }
  if (lower.includes("api key")) {
    return "API key needed before AI calls.";
  }
  if (lower.includes("measurement")) {
    return "AI measurement unavailable. Showing fallback.";
  }
  return message.length > 82 ? `${message.slice(0, 79)}...` : message;
}

function buildShoppingGuide(item, fitProfile) {
  const hip = getMeasurementByLabel(fitProfile, "Hip");
  const bust = getMeasurementByLabel(fitProfile, "Bust");
  const underbust = getMeasurementByLabel(fitProfile, "Underbust");
  const waist = getMeasurementByLabel(fitProfile, "Waist");
  const confidence = fitProfile.confidenceScore ? `${fitProfile.confidenceScore}%` : "visual estimate";

  if (item.type === "bra") {
    const searchQuery = `${item.value} bra`;
    return {
      eyebrow: "UK fit-to-shop recommendation",
      title: "Bra matches for this measurement scan",
      size: item.value,
      videoLabel: "Bra fit preview",
      matchScore: confidence,
      matchLabel: "AI measurement confidence",
      description: `Suggested starting point: ${item.value}. Compare band comfort, cup coverage, and centre-front position before selecting the final style.`,
      insights: [
        { label: "Recommended UK size", value: item.value, detail: "Start here, then confirm against the retailer size guide." },
        { label: "Bust", value: bust?.metric || "--", detail: bust?.imperial || "Needed for cup check." },
        { label: "Underbust", value: underbust?.metric || "--", detail: underbust?.imperial || "Needed for band check." }
      ],
      fitChecks: [
        "Band should sit level around the body without riding up.",
        "Cup should contain the bust without gaping or cutting in.",
        "Try sister sizes if the cup fits but the band feels too loose or too firm."
      ],
      products: [
        {
          store: "M&S",
          name: `${item.value} bra search`,
          detail: "High-street basics, full cup, non-wired, T-shirt, and multipack styles.",
          matchReason: "Best broad UK high-street starting point for band and cup searches.",
          href: buildRetailSearchUrl("marks", searchQuery)
        },
        {
          store: "John Lewis",
          name: `${item.value} branded bras`,
          detail: "Includes Triumph, Fantasie, Chantelle, and more UK delivery options.",
          matchReason: "Useful when the user wants more brand and cup-shape variety.",
          href: buildRetailSearchUrl("johnlewis", searchQuery)
        },
        {
          store: "Next",
          name: `${item.value} everyday bras`,
          detail: "Practical daily-wear options, sets, and easy UK returns.",
          matchReason: "Good for fast availability checks and everyday styling options.",
          href: buildRetailSearchUrl("next", searchQuery)
        }
      ],
      disclaimer: "Retailer search results are opened directly. Confirm current stock, price, returns, and exact size chart before buying."
    };
  }

  const briefSize = item.value.replace("/", " ");
  const searchQuery = `${briefSize} knickers briefs`;
  return {
    eyebrow: "UK fit-to-shop recommendation",
    title: "Underwear matches for this measurement scan",
    size: item.value,
    videoLabel: "Underwear fit preview",
    matchScore: confidence,
    matchLabel: "AI measurement confidence",
    description: `Suggested starting point: ${item.value}. Use hip and waist measurements to compare briefs, bikini, high-leg, no-VPL, and shapewear cuts.`,
    insights: [
      { label: "Recommended UK size", value: item.value, detail: "Start here, then check each retailer's size guide." },
      { label: "Hip", value: hip?.metric || "--", detail: hip?.imperial || "Primary underwear fit measurement." },
      { label: "Waist", value: waist?.metric || "--", detail: waist?.imperial || "Useful for high-waist styles." }
    ],
    fitChecks: [
      "For briefs and bikini cuts, prioritise the hip measurement.",
      "For high-waist or shapewear styles, also compare the waist measurement.",
      "If between two sizes, choose based on fabric stretch and desired compression."
    ],
    products: [
      {
        store: "M&S",
        name: `${item.value} knickers search`,
        detail: "Everyday multipacks, cotton-rich briefs, lace, Brazilian, and high-leg cuts.",
        matchReason: "Strong UK baseline for multipacks, no-VPL, cotton, and everyday sizing.",
        href: buildRetailSearchUrl("marks", searchQuery)
      },
      {
        store: "John Lewis",
        name: `${item.value} lingerie and briefs`,
        detail: "Browse briefs, shapewear, lingerie sets, and branded underwear.",
        matchReason: "Good when the user wants branded cuts and premium fabric options.",
        href: buildRetailSearchUrl("johnlewis", searchQuery)
      },
      {
        store: "Next",
        name: `${item.value} underwear search`,
        detail: "Easy UK size filtering across briefs, thongs, multipacks, and shapewear.",
        matchReason: "Good for quick alternatives and modern high-street silhouettes.",
        href: buildRetailSearchUrl("next", searchQuery)
      }
    ],
    disclaimer: "Retailer search results are opened directly. Confirm current stock, price, returns, and exact size chart before buying."
  };
}

function getMeasurementByLabel(fitProfile, label) {
  return fitProfile.measurements.find((measurement) => measurement.label === label);
}

function buildRetailSearchUrl(retailer, query) {
  const encoded = encodeURIComponent(query);
  const urls = {
    marks: `https://www.marksandspencer.com/MSFindItemsByKeyword?searchTerm=${encoded}`,
    johnlewis: `https://www.johnlewis.com/search?search-term=${encoded}`,
    next: `https://www.next.co.uk/search?w=${encoded}`
  };
  return urls[retailer] || `https://www.google.com/search?q=${encoded}`;
}

const rootElement = document.getElementById("root");
const root = window.__atelierRoot || createRoot(rootElement);
window.__atelierRoot = root;
root.render(<App />);
