import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export function TrendIndicator({ current, previous, percent = false }) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }

  const currentValue = typeof current === "object" ? current.value : current;
  const previousValue = typeof previous === "object" ? previous.value : previous;

  const currentNum = Number(currentValue || 0);
  const previousNum = Number(previousValue || 0);

  if (currentNum === previousNum) {
    return (
      <span className="snTrendIndicator snTrendFlat" title="No change">
        <Minus size={12} />
        <span className="snTrendLabel">Stable</span>
      </span>
    );
  }

  const difference = currentNum - previousNum;
  const percentChange = previousNum !== 0 ? ((difference / previousNum) * 100).toFixed(1) : 0;
  const isPositive = difference > 0;

  return (
    <span
      className={`snTrendIndicator snTrend${isPositive ? "Up" : "Down"}`}
      title={`${isPositive ? "Increased" : "Decreased"} by ${Math.abs(percentChange)}%`}
    >
      {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      <span className="snTrendLabel">
        {isPositive ? "+" : ""}
        {Math.abs(percentChange)}%
      </span>
    </span>
  );
}

export function MetricWithTrend({ value, previous, label, percent = false }) {
  return (
    <div className="snMetricWithTrend">
      <div className="snMetricValue">
        <strong>{formatValue(value, percent)}</strong>
      </div>
      {previous !== undefined && <TrendIndicator current={value} previous={previous} percent={percent} />}
      <small className="snMetricLabel">{label}</small>
    </div>
  );
}

function formatValue(metric, percent = false) {
  if (!metric || typeof metric !== "object") {
    if (metric === null || metric === undefined) return "—";
    return percent ? `${Number(metric).toLocaleString("en-GB")}%` : Number(metric).toLocaleString("en-GB");
  }
  if (metric.available === false) return "—";
  const raw = metric.value;
  if (raw === null || raw === undefined) return "—";
  return percent ? `${Number(raw).toLocaleString("en-GB")}%` : Number(raw).toLocaleString("en-GB");
}
