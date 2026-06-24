import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle
} from "lucide-react";
import { useToast, ToastContainer } from "./useToast";
import { DashboardLayout } from "./DashboardLayout";
import { WorkInstanceDialog } from "./WorkInstanceDialog";
import { ServiceNowOverview } from "./ServiceNowOverview";
import { ServiceNowDiscovery } from "./ServiceNowDiscovery";
import { ServiceNowSam } from "./ServiceNowSam";
import { ServiceNowCsdm } from "./ServiceNowCsdm";
import { ServiceNowGovernance } from "./ServiceNowGovernance";
import { ServiceNowComputerIntelligence } from "./ServiceNowComputerIntelligence";
import { ServiceNowDataMovements } from "./ServiceNowDataMovements";
import { UnifiedRecordExplorer } from "./UnifiedRecordExplorer";
import { ServiceNowDeveloperStudio } from "./ServiceNowDeveloperStudio";

export function ServiceNowDashboard() {
  const { toasts, showToast, removeToast } = useToast();
  const [overview, setOverview] = useState(null);
  const [discovery, setDiscovery] = useState(null);
  const [sam, setSam] = useState(null);
  const [csdm, setCsdm] = useState(null);
  const [computerIntelligence, setComputerIntelligence] = useState(null);
  const [error, setError] = useState("");
  const [discoveryError, setDiscoveryError] = useState("");
  const [samError, setSamError] = useState("");
  const [csdmError, setCsdmError] = useState("");
  const [computerError, setComputerError] = useState("");
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState([]);
  const [instanceId, setInstanceId] = useState(() => localStorage.getItem("servicenowInstance") || "pdi");
  const [workDialogOpen, setWorkDialogOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [activeModule, setActiveModule] = useState("overview");
  const [sectionState, setSectionState] = useState({
    overview: { loading: false, startedAt: null, tick: 0 },
    discovery: { loading: false, startedAt: null, tick: 0 },
    sam: { loading: false, startedAt: null, tick: 0 },
    csdm: { loading: false, startedAt: null, tick: 0 },
    computer: { loading: false, startedAt: null, tick: 0 }
  });

  const loadInstances = useCallback(async (signal) => {
    const response = await fetch("/api/servicenow/instances", { signal });
    const result = await readJsonResponse(response, "instance profiles");
    if (!response.ok) throw new Error(result.error || "Unable to load instance profiles.");
    setInstances(result.instances || []);
    return result;
  }, []);

  const loadDashboard = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    setDiscoveryError("");
    setSamError("");
    setCsdmError("");
    setComputerError("");
    try {
      const [overviewResponse, discoveryResponse, samResponse, csdmResponse] = await Promise.all([
        fetch(`/api/servicenow/overview?instance=${encodeURIComponent(instanceId)}&refresh=${refreshToken}`, { signal, cache: "no-store" }),
        fetch(`/api/servicenow/discovery?instance=${encodeURIComponent(instanceId)}&refresh=${refreshToken}`, { signal, cache: "no-store" }),
        fetch(`/api/servicenow/sam?instance=${encodeURIComponent(instanceId)}&refresh=${refreshToken}`, { signal, cache: "no-store" }),
        fetch(`/api/servicenow/csdm?instance=${encodeURIComponent(instanceId)}&refresh=${refreshToken}`, { signal, cache: "no-store" })
      ]);
      const computerResponse = await fetch(`/api/servicenow/computer-intelligence?instance=${encodeURIComponent(instanceId)}&refresh=${refreshToken}`, { signal, cache: "no-store" });
      const [overviewResult, discoveryResult, samResult, csdmResult, computerResult] = await Promise.all([
        readJsonResponse(overviewResponse, "ServiceNow overview"),
        readJsonResponse(discoveryResponse, "Discovery data"),
        readJsonResponse(samResponse, "SAM Pro data"),
        readJsonResponse(csdmResponse, "CSDM data"),
        readJsonResponse(computerResponse, "computer intelligence data")
      ]);
      if (!overviewResponse.ok) throw new Error(overviewResult.error || "Unable to load ServiceNow overview.");
      setOverview(overviewResult);
      if (discoveryResponse.ok) {
        setDiscovery(discoveryResult);
      } else {
        setDiscovery(null);
        setDiscoveryError(discoveryResult.error || "Unable to load Discovery data.");
      }
      if (samResponse.ok) {
        setSam(samResult);
      } else {
        setSam(null);
        setSamError(samResult.error || "Unable to load SAM Pro data.");
      }
      if (csdmResponse.ok) {
        setCsdm(csdmResult);
      } else {
        setCsdm(null);
        setCsdmError(csdmResult.error || "Unable to load CSDM data.");
      }
      if (computerResponse.ok) {
        setComputerIntelligence(computerResult);
      } else {
        setComputerIntelligence(null);
        setComputerError(computerResult.error || "Unable to load computer intelligence data.");
      }
    } catch (requestError) {
      if (requestError.name === "AbortError") return;
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [instanceId, refreshToken]);

  const refreshOverview = useCallback(() => {
    refreshSection("overview", "/api/servicenow/overview", setOverview, "ServiceNow overview", setSectionState, showToast);
  }, [instanceId, showToast]);

  const refreshDiscovery = useCallback(() => {
    refreshSection("discovery", "/api/servicenow/discovery", setDiscovery, "Discovery data", setSectionState, showToast);
  }, [instanceId, showToast]);

  const refreshSam = useCallback(() => {
    refreshSection("sam", "/api/servicenow/sam", setSam, "SAM Pro data", setSectionState, showToast);
  }, [instanceId, showToast]);

  const refreshCsdm = useCallback(() => {
    refreshSection("csdm", "/api/servicenow/csdm", setCsdm, "CSDM data", setSectionState, showToast);
  }, [instanceId, showToast]);

  const refreshComputer = useCallback(() => {
    refreshSection("computer", "/api/servicenow/computer-intelligence", setComputerIntelligence, "computer intelligence data", setSectionState, showToast);
  }, [instanceId, showToast]);

  useEffect(() => {
    const controller = new AbortController();
    async function initializeInstances() {
      try {
        const result = await loadInstances(controller.signal);
        const selected = (result.instances || []).find((item) => item.id === instanceId);
        if (!selected?.configured) {
          setInstanceId(result.defaultInstance || result.instances?.[0]?.id || "pdi");
        }
      } catch (requestError) {
        if (requestError.name !== "AbortError") setError(requestError.message);
      }
    }
    initializeInstances();
    return () => controller.abort();
  }, [instanceId, loadInstances]);

  useEffect(() => {
    const controller = new AbortController();
    localStorage.setItem("servicenowInstance", instanceId);
    setOverview(null);
    setDiscovery(null);
    setSam(null);
    setCsdm(null);
    setComputerIntelligence(null);
    loadDashboard(controller.signal);
    return () => controller.abort();
  }, [instanceId, refreshToken, loadDashboard]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSectionState((current) => {
        let changed = false;
        const next = { ...current };
        for (const [key, section] of Object.entries(current)) {
          if (section.loading && section.startedAt) {
            next[key] = { ...section, tick: Math.max(1, Math.floor((Date.now() - section.startedAt) / 1000)) };
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const selectInstance = (nextInstanceId) => {
    const nextInstance = instances.find((instance) => instance.id === nextInstanceId);
    if (nextInstance?.id === "work" && !nextInstance.configured) {
      setWorkDialogOpen(true);
      return;
    }
    setInstanceId(nextInstanceId);
  };

  const completeWorkConnection = (connectedInstance) => {
    setInstances((current) => current.map((instance) => (
      instance.id === connectedInstance.id ? connectedInstance : instance
    )));
    setWorkDialogOpen(false);
    setInstanceId("work");
  };

  const navigateModule = (moduleId) => {
    setActiveModule(moduleId);
    const target = document.getElementById(moduleId);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="snDashboard" aria-label="ServiceNow operations dashboard">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <DashboardLayout currentModule={activeModule} onSelectModule={navigateModule}>
        <div id="overview-content">
          <ServiceNowOverview
            overview={overview}
            discovery={discovery}
            sam={sam}
            csdm={csdm}
            instances={instances}
            instanceId={instanceId}
            onSelectInstance={selectInstance}
            onRefresh={() => setRefreshToken((value) => value + 1)}
            onRefreshOverview={refreshOverview}
            refreshState={sectionState.overview}
            loading={loading}
          />
        </div>

      {error && (
        <div className="snError" role="alert">
          <AlertTriangle size={18} />
          <div><strong>ServiceNow connection failed</strong><span>{error}</span></div>
          <button type="button" onClick={() => setRefreshToken((value) => value + 1)}>Retry</button>
        </div>
      )}

      <div id="discovery">
        <ServiceNowDiscovery
          discovery={discovery}
          loading={loading}
          error={discoveryError}
          onRefresh={refreshDiscovery}
          refreshState={sectionState.discovery}
        />
      </div>
      <div id="csdm">
        <ServiceNowCsdm
          csdm={csdm}
          loading={loading}
          error={csdmError}
          onRefresh={refreshCsdm}
          refreshState={sectionState.csdm}
        />
      </div>
      <div id="governance">
        <ServiceNowGovernance instanceId={instanceId} />
      </div>
      <div id="dataMovements">
        <ServiceNowDataMovements instances={instances} instanceId={instanceId} />
      </div>
      <div id="sam">
        <ServiceNowSam
          sam={sam}
          loading={loading}
          error={samError}
          onRefresh={refreshSam}
          refreshState={sectionState.sam}
        />
      </div>
      <div id="computerIntelligence">
        <ServiceNowComputerIntelligence
          data={computerIntelligence}
          loading={loading}
          error={computerError}
          onRefresh={refreshComputer}
          refreshState={sectionState.computer}
        />
      </div>
      <div id="explorer">
        <UnifiedRecordExplorer instanceId={instanceId} />
      </div>
      <div id="developerStudio">
        <ServiceNowDeveloperStudio instanceId={instanceId} />
      </div>
      
      <WorkInstanceDialog
        open={workDialogOpen}
        onCancel={() => setWorkDialogOpen(false)}
        onConnected={completeWorkConnection}
      />
      </DashboardLayout>
    </section>
  );
}

async function refreshSection(sectionKey, endpoint, setState, label, setSectionState, showToast) {
  const startedAt = Date.now();
  setSectionState((current) => ({
    ...current,
    [sectionKey]: { loading: true, startedAt, tick: 0 }
  }));
  try {
    const params = new URLSearchParams({
      instance: localStorage.getItem("servicenowInstance") || "pdi",
      refresh: String(Date.now())
    });
    const response = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
    const result = await readJsonResponse(response, label);
    if (!response.ok) {
      const error = result.error || `Unable to refresh ${label}.`;
      showToast?.(`Error: ${error}`, "error", 4000);
      throw new Error(error);
    }
    setState(result);
    setSectionState((current) => ({
      ...current,
      [sectionKey]: { loading: false, startedAt: null, tick: 0, updatedAt: Date.now() }
    }));
    showToast?.(`${label} refreshed successfully`, "success", 3000);
    return result;
  } catch (err) {
    setSectionState((current) => ({
      ...current,
      [sectionKey]: { loading: false, startedAt: null, tick: 0 }
    }));
    if (err.message !== "AbortError") {
      showToast?.(`Error refreshing ${label}`, "error", 4000);
    }
    throw err;
  }
}

async function readJsonResponse(response, label) {
  try {
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return {
        error: `Expected JSON from ${label}, but received ${contentType || "an HTML or text response"}. ${text.slice(0, 120).trim()}`
      };
    }
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      error: `Unable to parse JSON from ${label}. The server returned an unexpected response.`
    };
  }
}
