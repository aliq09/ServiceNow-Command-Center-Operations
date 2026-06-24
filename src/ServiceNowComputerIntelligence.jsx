import { ChartColumn, Laptop, RefreshCw, ShieldCheck, Users } from "lucide-react";

export function ServiceNowComputerIntelligence({ data, loading, error, onRefresh, refreshState }) {
  const summary = data?.summary || {};
  const topManufacturer = summary.topManufacturer;

  return (
    <section className="snComputerIntelligence" aria-label="Computer intelligence">
      <header className="snComputerHeader">
        <div>
          <span><Laptop size={18} /></span>
          <div>
            <small>Endpoint inventory</small>
            <strong>Computer inventory counts</strong>
            <p>Three signals only: total computer CIs, assigned computers, and the top manufacturer.</p>
          </div>
        </div>
        <div className="snComputerHeaderMeta">
          <span><ShieldCheck size={14} /> {loading ? "Refreshing..." : "Live from cmdb_ci_computer"}</span>
          <strong>{data?.signals?.note || "Counts are pulled from CMDB computer inventory."}</strong>
          <button type="button" className="snInlineRefresh snComputerRefresh" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={13} className={loading || refreshState?.loading ? "isSpinning" : ""} />
            {refreshState?.loading ? `Refreshing… ${refreshState.tick || 1}s` : "Refresh"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="snComputerError">{error}</div>
      ) : (
        <div className="snComputerBody">
          <div className="snComputerSummary">
            <article className="snComputerSummaryPrimary">
              <div>
                <small>Total computer CIs</small>
                <strong>{formatMetric(summary.total)}</strong>
                <span>All records in <code>cmdb_ci_computer</code></span>
              </div>
              <div>
                <small>Assigned computers</small>
                <strong>{formatMetric(summary.assigned)}</strong>
                <span>Records where Assigned to is populated</span>
              </div>
              <div>
                <small>Top manufacturer</small>
                <strong>{topManufacturer ? `${topManufacturer.label} (${formatMetric(topManufacturer.value)})` : "—"}</strong>
                <span>Manufacturer with the highest count</span>
              </div>
            </article>
          </div>

          <article className="snComputerPanel snComputerWide">
            <div className="snComputerPanelTitle">
              <div><ChartColumn size={16} /><strong>Manufacturer distribution</strong></div>
              <span>Top manufacturers by computer count</span>
            </div>
            <div className="snComputerBarList">
              {(data?.manufacturerGroups || []).slice(0, 10).map((group) => (
                <div key={group.label} className="snComputerBarRow">
                  <div>
                    <strong>{group.label}</strong>
                    <span>{group.value} computers</span>
                  </div>
                  <i><b style={{ width: `${barPercent(group.value, summary.total)}%` }} /></i>
                </div>
              ))}
            </div>
          </article>

          <article className="snComputerPanel snComputerWide">
            <div className="snComputerPanelTitle">
              <div><Users size={16} /><strong>Assigned computers</strong></div>
              <span>Count of devices where Assigned to is not empty</span>
            </div>
            <div className="snAssignedGrid">
              <div>
                <strong>{formatMetric(summary.assigned)}</strong>
                <span>Assigned to populated</span>
              </div>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

function barPercent(value, total) {
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return Math.max(Math.min((Number(value || 0) / denominator) * 100, 100), 0).toFixed(1);
}

function formatMetric(value) {
  if (value === null || value === undefined) return "—";
  return Number(value || 0).toLocaleString("en-GB");
}
