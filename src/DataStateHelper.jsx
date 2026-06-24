import { AlertCircle, Clock, Settings, HelpCircle } from "lucide-react";

export function getDataStateLabel(metric) {
  if (!metric) return "Module not available";
  if (typeof metric !== "object") return "—";

  const { available, reason, value } = metric;

  if (available === false) {
    if (reason === "not-configured") return "Module not configured";
    if (reason === "loading") return "Loading...";
    if (reason === "error") return "Connection error";
    return reason || "Data unavailable";
  }

  if (value === null || value === undefined) return "No data yet";
  return null;
}

export function DataStateIndicator({ metric, label, showHelp = false }) {
  const state = getDataStateLabel(metric);

  if (!state) return null;

  const getIcon = () => {
    if (state.includes("Loading")) return <Clock size={14} />;
    if (state.includes("configured")) return <Settings size={14} />;
    if (state.includes("error")) return <AlertCircle size={14} />;
    return <HelpCircle size={14} />;
  };

  return (
    <div className="snDataStateIndicator" title={`${label}: ${state}`}>
      <div className="snDataStateIcon">{getIcon()}</div>
      <span className="snDataStateText">{state}</span>
      {showHelp && <HelpCircle size={13} className="snDataStateHelp" />}
    </div>
  );
}

export function UnavailableMetricPlaceholder({ label, reason = "not-configured" }) {
  const messages = {
    "not-configured": `${label} has not been configured in this instance`,
    "loading": `Loading ${label}...`,
    "error": `Unable to load ${label} due to a connection error`,
    "no-data": `No ${label} data available yet`
  };

  return (
    <div className="snUnavailableMetricPlaceholder">
      <div className="snUnavailablePlaceholderIcon">
        {reason === "loading" ? <Clock size={18} /> : <AlertCircle size={18} />}
      </div>
      <p className="snUnavailablePlaceholderText">{messages[reason] || messages["not-configured"]}</p>
    </div>
  );
}

export function formatMetricValue(metric, percent = false) {
  if (metric === null || metric === undefined) return "—";
  if (typeof metric === "object") {
    if (metric.available === false) return "—";
    const raw = metric.value;
    if (raw === null || raw === undefined) return "—";
    if (percent) return `${Number(raw).toLocaleString("en-GB")}%`;
    return Number(raw).toLocaleString("en-GB");
  }
  return percent ? `${Number(metric).toLocaleString("en-GB")}%` : Number(metric).toLocaleString("en-GB");
}

export function metricAvailabilityLabel(metric) {
  const state = getDataStateLabel(metric);
  return state || "Live";
}
