import {
  AppWindow,
  Boxes,
  Building2,
  CheckCircle2,
  GitBranch,
  Layers3,
  PackageSearch,
  ServerCog,
  ShieldAlert,
  Store,
  RefreshCw,
  Waypoints
} from "lucide-react";

const CSDM_DOMAINS = [
  {
    key: "foundation",
    label: "Foundation",
    icon: Boxes,
    detail: "Core data classes, company, location, user, and asset foundations."
  },
  {
    key: "strategy",
    label: "Ideation & strategy",
    icon: AppWindow,
    detail: "Demand, planning, and portfolio prioritization before build work starts."
  },
  {
    key: "planning",
    label: "Design & planning",
    icon: Building2,
    detail: "Business capabilities, service definitions, and target operating design."
  },
  {
    key: "integration",
    label: "Build & integration",
    icon: ServerCog,
    detail: "Application services, integrations, and technical service realization."
  },
  {
    key: "delivery",
    label: "Service delivery",
    icon: PackageSearch,
    detail: "Operational support, fulfillment, and runtime service execution."
  },
  {
    key: "consumption",
    label: "Service consumption",
    icon: Store,
    detail: "Service offerings and user-facing access to cataloged services."
  },
  {
    key: "portfolio",
    label: "Manage portfolios",
    icon: Waypoints,
    detail: "Governance, health, lifecycle, and portfolio control across services."
  }
];

const CSDM_METRICS = [
  { key: "businessApplications", label: "Business applications", icon: AppWindow, domain: "Design & planning", detail: "Business-facing applications mapped into the service model." },
  { key: "applicationServices", label: "Service instances", icon: Layers3, domain: "Build & integration", detail: "Application services / service instances used for operational mapping." },
  { key: "technicalServices", label: "Technical services", icon: ServerCog, domain: "Build & integration", detail: "Shared technical capabilities that support multiple services." },
  { key: "businessServices", label: "Business services", icon: Building2, domain: "Service consumption", detail: "User-facing services delivered to the business." },
  { key: "serviceOfferings", label: "Service offerings", icon: Store, domain: "Service consumption", detail: "Selectable offerings published to the catalog." },
  { key: "relationships", label: "CI relationships", icon: GitBranch, domain: "Foundation", detail: "Recorded dependencies linking services, applications, and infrastructure." }
];

export function ServiceNowCsdm({ csdm, loading, error, onRefresh, refreshState }) {
  const domains = csdm?.framework?.domains;
  const foundation = csdm?.framework?.foundation;
  const sam = csdm?.normalization?.sam;
  const ham = csdm?.normalization?.ham;

  return (
    <section className="snCsdmCenter" aria-label="CSDM and asset normalization">
      <header className="snCsdmHeader">
        <div>
          <span><Waypoints size={20} /></span>
          <div>
            <small>Service data governance</small>
            <strong>ServiceNow model coverage</strong>
            <p>CSDM 5-ready service structure, foundation data, and asset normalization.</p>
          </div>
        </div>
        <div className="snCsdmFoundation">
          <span>Foundation data</span>
          <strong>{metricValue(foundation?.companies)} companies</strong>
          <small>{metricValue(foundation?.locations)} locations · {metricValue(foundation?.costCenters)} cost centers</small>
        </div>
        <button type="button" className="snCsdmRefresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? "isSpinning" : ""} />
          {refreshState?.loading ? `Refreshing… ${refreshState.tick || 1}s` : "Refresh CSDM"}
        </button>
      </header>

      {error ? (
        <div className="snCsdmError"><ShieldAlert size={18} /><span>{error}</span></div>
      ) : (
        <div className="snCsdmBody">
          <section className="snCsdmModel">
            <div className="snCsdmSectionTitle">
              <div><Waypoints size={17} /><strong>Major CSDM coverage</strong></div>
              <span>{loading ? "Refreshing..." : "Live CMDB counts"}</span>
            </div>
            <div className="snCsdmDomainRail" aria-label="CSDM domain overview">
              {CSDM_DOMAINS.map(({ key, label, icon: Icon, detail }) => (
                <button
                  key={key}
                  type="button"
                  className="snCsdmDomainChip"
                  title={detail}
                  aria-label={`${label}: ${detail}`}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="snFoundationSummary" aria-label="Foundation data summary">
              <article title="Company records used across service, asset, and financial relationships.">
                <small>Companies</small>
                <strong>{metricValue(foundation?.companies)}</strong>
                <span>Reference entities for services and assets</span>
              </article>
              <article title="Location records used for users, assets, and operational footprint.">
                <small>Locations</small>
                <strong>{metricValue(foundation?.locations)}</strong>
                <span>Physical and logical site footprint</span>
              </article>
              <article title="Cost-center records used for ownership and chargeback alignment.">
                <small>Cost centers</small>
                <strong>{metricValue(foundation?.costCenters)}</strong>
                <span>Financial ownership and allocation</span>
              </article>
            </div>
            <div className="snCsdmMetricGrid">
              {CSDM_METRICS.map(({ key, label, icon: Icon, domain }) => (
                <article key={key} title={`CSDM ${domain}: ${label}`}>
                  <span><Icon size={17} /></span>
                  <div><small>{domain}</small><strong>{label}</strong></div>
                  <b>{metricValue(domains?.[key])}</b>
                </article>
              ))}
            </div>
            <div className="snCsdmFlow">
              <span title="Business application that owns or consumes services">Business application</span><i />
              <span title="Application service or service instance used to map runtime behavior">Service instance</span><i />
              <span title="Shared technical capability, infrastructure, or platform support">Technical service</span><i />
              <span title="Business service and catalog offering exposed to users">Business service / offering</span>
            </div>
          </section>

          <section className="snNormalizationPanel">
            <div className="snCsdmSectionTitle">
              <div><CheckCircle2 size={17} /><strong>Normalized data</strong></div>
              <span>HAM Pro + SAM Pro</span>
            </div>
            <NormalizationCard
              icon={Building2}
              title="Foundation data"
              percent={100}
              total={foundation?.companies}
              completed={foundation?.companies}
              attention={null}
              secondary="Company, location and cost center"
              note="Core referential data that anchors the CSDM and asset model."
              tone="foundation"
            />
            <NormalizationCard
              icon={PackageSearch}
              title="SAM Pro software"
              percent={sam?.normalizedPercent}
              total={sam?.total}
              completed={sam?.normalized}
              attention={sam?.attention}
              secondary={`${metricValue(sam?.partial)} partially normalized`}
              note="Publisher, product, version and edition normalization."
              tone="software"
            />
            <NormalizationCard
              icon={Boxes}
              title="HAM Pro hardware"
              percent={ham?.readyPercent}
              total={ham?.total}
              completed={ham?.ready}
              attention={ham?.attention}
              secondary="Manufacturer + model number complete"
              note={ham?.note}
              tone="hardware"
            />
          </section>
        </div>
      )}
    </section>
  );
}

function NormalizationCard({ icon: Icon, title, percent = 0, total, completed, attention, secondary, note, tone }) {
  return (
    <article className={`snNormalizationCard ${tone}`}>
      <div className="snNormalizationTop">
        <span><Icon size={17} /></span>
        <div><strong>{title}</strong><small>{secondary}</small></div>
        <b>{percent}%</b>
      </div>
      <div className="snNormalizationBar"><i style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} /></div>
      <div className="snNormalizationStats">
        <span><strong>{metricValue(completed)}</strong> normalized / ready</span>
        <span><strong>{metricValue(attention)}</strong> need attention</span>
        <span><strong>{metricValue(total)}</strong> total models</span>
      </div>
      {note && <p>{note}</p>}
    </article>
  );
}

function metricValue(metric) {
  if (!metric?.available) return "—";
  return Number(metric.value || 0).toLocaleString("en-GB");
}
