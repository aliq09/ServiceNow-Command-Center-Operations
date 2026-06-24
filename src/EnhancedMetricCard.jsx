import React from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  Loader2,
  Lock,
  Eye
} from "lucide-react";
import { DataStateIndicator, formatMetricValue, metricAvailabilityLabel } from "./DataStateHelper";

/**
 * EnhancedMetricCard - Shows metric value with trend indicator and clear data state
 * Props:
 *   - metric: { label, icon, tone, value, trend?, reason? }
 *   - showDataState: Boolean (default true) - show unavailable/loading state
 */
export function EnhancedMetricCard({ metric, icon: Icon, showDataState = true }) {
  if (!metric) {
    return (
      <article className="snEnhancedMetricCard state-unavailable">
        <div className="snMetricPlaceholder">
          <AlertCircle size={18} />
          <small>Data unavailable</small>
        </div>
      </article>
    );
  }

  const value = formatMetricValue(metric, false);
  const availability = metricAvailabilityLabel(metric);
  const isAvailable = metric.available !== false;
  const hasTrend = metric.trend && (metric.trend.direction !== 'flat');
  const trendPercent = metric.trend?.change || 0;
  const trendDirection = metric.trend?.direction || 'flat';

  return (
    <article className={`snEnhancedMetricCard tone-${metric.tone} ${!isAvailable ? 'state-unavailable' : ''}`}>
      {/* Icon & Label */}
      <div className="snMetricHeader">
        {Icon ? (
          <span className="snMetricIcon"><Icon size={17} /></span>
        ) : (
          <span className="snMetricIcon" style={{ opacity: 0.3 }}>
            <Eye size={17} />
          </span>
        )}
        <small className="snMetricLabel">{metric.label}</small>
      </div>

      {/* Main Value with Trend */}
      <div className="snMetricValue">
        <strong className={isAvailable ? "" : "snMetricValueUnavailable"}>
          {isAvailable ? value : "—"}
        </strong>
        {isAvailable && hasTrend && (
          <span className={`snTrendBadge trend-${trendDirection}`}>
            {trendDirection === 'up' && <TrendingUp size={13} />}
            {trendDirection === 'down' && <TrendingDown size={13} />}
            {trendDirection === 'flat' && <Minus size={13} />}
            <span>{Math.abs(trendPercent)}%</span>
          </span>
        )}
      </div>

      {/* Status / Data State */}
      <div className="snMetricStatus">
        {isAvailable ? (
          <em className="snMetricAvailable">{availability}</em>
        ) : (
          <DataStateIndicator metric={metric} size="small" />
        )}
      </div>
    </article>
  );
}

/**
 * MetricGrid - Layout component for metric cards
 */
export function MetricGrid({ children, columns = "auto" }) {
  return (
    <div className={`snMetricGrid cols-${columns}`}>
      {children}
    </div>
  );
}
