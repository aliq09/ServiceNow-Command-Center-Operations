import React from "react";
import {
  RefreshCw,
  ChevronDown,
  Clock,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle
} from "lucide-react";

export function HeroHeader({
  instanceId,
  instances,
  onSelectInstance,
  onRefresh,
  loading,
  connection,
  overview,
  refreshedAt
}) {
  const getConnectionStatus = () => {
    if (!connection) return { status: "pending", label: "Connecting...", color: "gray" };
    if (connection.error) return { status: "error", label: "Connection Error", color: "red" };
    if (connection.latency > 2000) return { status: "warning", label: "Slow Connection", color: "orange" };
    return { status: "healthy", label: "Connected", color: "green" };
  };

  const connectionInfo = getConnectionStatus();
  const latencyLabel = connection?.latency ? `${Math.round(connection.latency)}ms` : "?";
  const syncTime = refreshedAt ? new Date(refreshedAt).toLocaleTimeString() : "?";
  const instanceLabel = connection?.instanceName || instances.find((item) => item.id === instanceId)?.name || "Instance";
  const environmentLabel = connection?.environment || "Unknown environment";
  const sessionLabel = connection?.credentialSource || "session";
  const hostLabel = connection?.host || "Host unavailable";

  return (
    <div className="snHeroHeader">
      <div className="snHeroLeft">
        <div className="snHeroTitle">
          <h1>ServiceNow Operations Console</h1>
          <p>Real-time operational intelligence and compliance monitoring</p>
        </div>
      </div>

      <div className="snHeroCenter">
        <div className={`snConnectionBadge status-${connectionInfo.color}`}>
          <span className={`snConnectionDot snConnectionDot-${connectionInfo.status}`}>
            {connectionInfo.status === "healthy" && <CheckCircle size={16} />}
            {connectionInfo.status === "warning" && <AlertCircle size={16} />}
            {connectionInfo.status === "error" && <WifiOff size={16} />}
            {connectionInfo.status === "pending" && <Wifi size={16} />}
          </span>
          <div className="snConnectionInfo">
            <strong>{connectionInfo.label}</strong>
            <small>Latency: {latencyLabel}</small>
            <small>{instanceLabel} ? {environmentLabel}</small>
          </div>
          <div className="snSyncStatus">
            <Clock size={14} />
            <span>{syncTime}</span>
          </div>
        </div>
        <div className="snConnectionMeta">
          <span>{hostLabel}</span>
          <small>{sessionLabel}</small>
        </div>
      </div>

      <div className="snHeroRight">
        <label className="snInstancePickerHero">
          <span>Instance</span>
          <select
            value={instanceId}
            onChange={(event) => onSelectInstance(event.target.value)}
            aria-label="ServiceNow instance"
          >
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}{instance.configured ? "" : " (configure)"}
              </option>
            ))}
          </select>
          <ChevronDown size={15} />
        </label>

        <button
          type="button"
          className="snHeroRefreshBtn"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh all data"
        >
          <RefreshCw size={16} className={loading ? "isSpinning" : ""} />
          <span>{loading ? "Refreshing..." : "Refresh"}</span>
        </button>
      </div>
    </div>
  );
}
