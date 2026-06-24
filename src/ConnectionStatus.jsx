import { Signal, AlertCircle, CheckCircle2 } from "lucide-react";

export function ConnectionStatus({ connection, refreshedAt }) {
  if (!connection) {
    return (
      <div className="snConnectionStatus snConnectionPending" title="Connecting to instance...">
        <div className="snStatusDot snStatusDotPending" />
        <span>Connecting</span>
      </div>
    );
  }

  const latency = calculateLatency(connection.connectedAt, refreshedAt);
  const healthStatus = getConnectionHealth(connection);
  const statusIcon = healthStatus.isHealthy ? CheckCircle2 : AlertCircle;
  const StatusIcon = statusIcon;

  return (
    <div
      className={`snConnectionStatus snConnectionActive status-${healthStatus.level}`}
      title={`Connection: ${healthStatus.label}\nLatency: ${latency}ms\nConnected: ${formatTime(connection.connectedAt)}`}
    >
      <div className={`snStatusDot snStatusDot${healthStatus.isHealthy ? "Healthy" : "Degraded"}`} />
      <div className="snStatusInfo">
        <span className="snStatusLabel">{healthStatus.label}</span>
        <span className="snStatusLatency">{latency}ms</span>
      </div>
    </div>
  );
}

function calculateLatency(connectedAt, refreshedAt) {
  if (!refreshedAt || !connectedAt) return "—";
  const connectionTime = new Date(connectedAt).getTime();
  const now = new Date(refreshedAt).getTime();
  const latency = Math.max(0, Math.round(now - connectionTime));
  return latency < 1000 ? `${latency}ms` : `${(latency / 1000).toFixed(1)}s`;
}

function getConnectionHealth(connection) {
  if (connection.error) {
    return { level: "error", label: "Connection error", isHealthy: false };
  }
  if (connection.environment === "DEV" || connection.environment === "SANDBOX") {
    return { level: "warning", label: `${connection.environment} instance`, isHealthy: true };
  }
  return { level: "success", label: "Connected", isHealthy: true };
}

function formatTime(dateString) {
  if (!dateString) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(dateString));
}
