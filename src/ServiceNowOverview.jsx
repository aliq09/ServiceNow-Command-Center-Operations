import {
  Boxes,
  Building2,
  ChevronDown,
  CircleUserRound,
  Clock3,
  RefreshCcw,
  Database,
  BadgeCheck,
  GitPullRequestArrow,
  HardDrive,
  Laptop,
  PackageCheck,
  GitBranch,
  RefreshCw,
  Server,
  ShieldCheck,
  ShoppingCart,
  Siren,
  TicketCheck,
  TriangleAlert,
  Wrench
} from "lucide-react";
import { ConnectionStatus } from "./ConnectionStatus";
import { DataStateIndicator, formatMetricValue, metricAvailabilityLabel } from "./DataStateHelper";

const ITSM_METRICS = [
  { key: "incidents", label: "Active incidents", icon: Siren, tone: "red" },
  { key: "critical", label: "Critical incidents", icon: TriangleAlert, tone: "red" },
  { key: "unassigned", label: "Unassigned", icon: CircleUserRound, tone: "amber" },
  { key: "approvedChanges", label: "Approved changes", icon: TicketCheck, tone: "blue" },
  { key: "changeApprovals", label: "Change approvals", icon: BadgeCheck, tone: "violet" },
  { key: "requests", label: "Service requests", icon: ShoppingCart, tone: "blue" },
  { key: "changes", label: "Active changes", icon: GitPullRequestArrow, tone: "violet" },
  { key: "requestApprovals", label: "Request approvals", icon: BadgeCheck, tone: "slate" },
  { key: "changeTasks", label: "Change tasks", icon: Wrench, tone: "slate" },
  { key: "problems", label: "Active problems", icon: Wrench, tone: "slate" }
];

const CMDB_METRICS = [
  { key: "total", label: "Total CIs", icon: Database },
  { key: "computers", label: "Computers", icon: Laptop },
  { key: "servers", label: "Servers", icon: Server },
  { key: "applications", label: "Applications", icon: Boxes },
  { key: "services", label: "Services", icon: Building2 },
  { key: "databases", label: "Databases", icon: HardDrive }
];

const CMDB_HEALTH_METRICS = [
  { key: "relationships", label: "Relationships", icon: GitBranch, tone: "blue", detail: "Parent / child links" },
  { key: "certifiedCis", label: "Certified CIs", icon: BadgeCheck, tone: "green", detail: "Data certification" },
  { key: "relationshipDuplicate", label: "Duplicate relationships", icon: BadgeCheck, tone: "amber", detail: "Relationship health" },
  { key: "relationshipOrphan", label: "Orphan relationships", icon: BadgeCheck, tone: "amber", detail: "Missing parent or child" },
  { key: "relationshipStale", label: "Stale relationships", icon: BadgeCheck, tone: "slate", detail: "Older than 30 days" }
];

const ASSET_METRICS = [
  { key: "total", label: "Total assets" },
  { key: "hardware", label: "Hardware" },
  { key: "deployed", label: "Deployed" },
  { key: "stock", label: "In stock" }
];

const ASSET_LIFECYCLE_STAGES = [
  { key: "request", label: "Request" },
  { key: "fulfill", label: "Fulfill" },
  { key: "deploy", label: "Deploy" },
  { key: "monitor", label: "Monitor" },
  { key: "refresh", label: "Retire" }
];

export function ServiceNowOverview({
  overview,
  discovery,
  sam,
  csdm,
  instances,
  instanceId,
  onSelectInstance,
  onRefresh,
  onRefreshOverview,
  refreshState,
  loading
}) {
  const connection = overview?.connection;

  return (
    <div className="snCommandCenter">
      <section className="snConnectionHero" aria-label="Current ServiceNow connection">
        <div className="snConnectionPrimary">
          <div className="snHeroKicker">
            <span className="snHeroBrand">ServiceNow Operations</span>
            <span className="snLivePulse"><i /> Live connection</span>
          </div>
          <h1>Operations Console</h1>
          <p>Unified operational view for ITSM, ITOM, ITAM, CSDM, and governance signals.</p>
          <div className="snHeroSubline">
            <span>Connected instance</span>
            <strong>{connection?.instanceName || "Connecting..."}</strong>
            <span className="snHeroDot" aria-hidden="true" />
            <span>{connection?.host || "Waiting for instance details"}</span>
          </div>
          <div className="snPlatformPills" aria-label="Platform module summary">
            <span>ITSM</span>
            <span>ITOM</span>
            <span>ITAM</span>
            <span>CSDM</span>
            <span>Governance</span>
          </div>
        </div>

        <div className="snConnectionIdentity">
          <div className="snIdentityIcon">
            <ShieldCheck size={22} />
          </div>
          <div className="snIdentityMain">
            <span>Connected instance</span>
            <strong>{connection?.instanceName || "Connecting..."}</strong>
            <small>{connection?.host || "Waiting for instance details"}</small>
          </div>
          <div className="snIdentityDetail">
            <span><CircleUserRound size={14} /> Authenticated user</span>
            <strong>{connection?.user?.displayName || connection?.user?.username || "?"}</strong>
            <small>{connection?.user?.username || "?"}</small>
          </div>
          <div className="snIdentityDetail">
            <span><Clock3 size={14} /> Session established</span>
            <strong>{formatExactDateTime(connection?.connectedAt)}</strong>
            <small>{connection?.authType?.toUpperCase() || "?"} · {connection?.credentialSource || "?"}</small>
          </div>
          <div className="snIdentityDetail snIdentityStatDetail">
            <span><Database size={14} /> Instance stats</span>
            <strong>{connection ? "ONLINE" : "Unavailable"}</strong>
            <small>{connection?.environment || "Connected"} · {connection?.host || "Host unavailable"}</small>
          </div>
          <span className={`snEnvironmentBadge env-${String(connection?.environment || "").toLowerCase()}`}>
            {connection?.environment || "Environment"}
          </span>
        </div>

        <div className="snConnectionControls">
          <ConnectionStatus connection={connection} refreshedAt={overview?.generatedAt} />
          <label className="snInstancePicker snInstancePickerHero">
            <span>Switch instance</span>
            <select value={instanceId} onChange={(event) => onSelectInstance(event.target.value)} aria-label="ServiceNow instance">
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}{instance.configured ? "" : " ? enter credentials"}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
          <button type="button" className="snHeroRefresh" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? "isSpinning" : ""} />
            {loading ? "Refreshing" : "Refresh all"}
          </button>
          <div className="snDataTimestamp">
            <span>Data refreshed</span>
            <strong>{formatExactDateTime(overview?.generatedAt)}</strong>
          </div>
        </div>
      </section>

      <div className="snSectionRefreshBar">
        <button type="button" onClick={onRefreshOverview} disabled={loading}>
          <RefreshCw size={14} className={loading ? "isSpinning" : ""} />
          {refreshState?.loading ? `Refreshing overview? ${refreshState.tick || 1}s` : "Refresh overview"}
        </button>
      </div>

      <section className="snOperationalStrip" aria-label="Operational risk summary">
        <StripCard
          tone="red"
          label="Active incidents"
          value={overview?.itsm?.incidents}
          detail="Current incident load"
        />
        <StripCard
          tone="amber"
          label="Discovery completion"
          value={discovery?.schedules?.successRate}
          detail={rateLabel(discovery?.schedules?.successRate)}
          percent
        />
        <StripCard
          tone="violet"
          label="SAM exposure"
          value={sam?.reconciliation?.available ? sam?.reconciliation?.nonCompliantPublishers : sam?.reconciliation?.publisherRiskCount}
          detail={sam?.reconciliation?.available ? "Publishers requiring review" : "Reconciliation required"}
        />
        <StripCard
          tone="blue"
          label="Normalization"
          value={csdm?.normalization?.sam?.normalizedPercent ?? csdm?.normalization?.ham?.readyPercent}
          detail={normalizationSummary(csdm?.normalization)}
          percent
          compact
        />
        <StripCard
          tone="slate"
          label="Duplicate hotspots"
          value={duplicateHotspotCount(overview)}
          detail={duplicateHotspotSummary(overview)}
          compact
        />
      </section>

      <div className="snDomainGrid">
        <section className="snDomainCard snItsmDomain">
          <DomainHeader icon={TicketCheck} eyebrow="Service operations" title="ITSM workload" subtitle="Live active-record posture" />
          <div className="snItsmMetricGrid">
            {ITSM_METRICS.map((metric) => (
              <OverviewMetric key={metric.key} metric={metric} value={overview?.itsm?.[metric.key]} />
            ))}
          </div>
        </section>

        <section className="snDomainCard snCmdbDomain">
          <DomainHeader
            icon={Database}
            eyebrow="Configuration management"
            title="CMDB overview"
            subtitle="CI population, relationships, certification, and health"
          />
          <div className="snCmdbTotal">
            <div>
              <span>Total configuration items</span>
              <strong>{metricValue(overview?.cmdb?.total)}</strong>
            </div>
            <i><b style={{ width: overview?.cmdb?.total?.available ? "100%" : "0%" }} /></i>
          </div>
          <div className="snCmdbHealthBand">
            {CMDB_HEALTH_METRICS.map((metric) => (
              <div
                key={metric.key}
                className={`tone-${metric.tone}`}
                title={`${metric.label}: ${metric.detail}`}
              >
                <span><metric.icon size={14} /></span>
                <div>
                  <small>{metric.label}</small>
                  <strong>{metricValue(resolveCmdbMetric(overview?.cmdb, metric.key))}</strong>
                  <em>{metric.detail}</em>
                </div>
              </div>
            ))}
          </div>
          <div className="snCmdbClassGrid">
            {CMDB_METRICS.slice(1).map(({ key, label, icon: Icon }) => (
              <div key={key} className="snCmdbClass" title={`${label}: current CMDB population`}>
                <Icon size={16} />
                <span>{label}</span>
                <strong>{metricValue(overview?.cmdb?.[key])}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="snDomainCard snAssetDomain">
          <DomainHeader
            icon={PackageCheck}
            eyebrow="Hardware Asset Management"
            title="Asset lifecycle"
            subtitle="Request-to-retirement posture across inventory, deployment, and refresh"
          />
          <div className="snAssetHero">
            <PackageCheck size={25} />
            <div>
              <span>Managed assets</span>
              <strong>{metricValue(overview?.assets?.total)}</strong>
              <small>{assetLifecycleSummary(overview?.assets)}</small>
            </div>
          </div>
          <div className="snAssetLifecycleRail" aria-label="Asset lifecycle stages">
            {ASSET_LIFECYCLE_STAGES.map((stage, index) => (
              <div key={stage.key} className={`stage-${stage.key}`}>
                <i>{index + 1}</i>
                <span>{stage.label}</span>
              </div>
            ))}
          </div>
          <div className="snAssetMetricGrid">
            {ASSET_METRICS.map(({ key, label }) => (
              <div key={key}>
                <span>{label}</span>
                <strong>{metricValue(overview?.assets?.[key])}</strong>
                <small>{metricAvailability(overview?.assets?.[key])}</small>
              </div>
            ))}
          </div>
          <div className="snAssetInsightRow">
            <AssetInsight icon={RefreshCcw} label="Lifecycle automation" value={assetLifecycleAutomation(overview?.assets)} />
            <AssetInsight icon={BadgeCheck} label="Deployment readiness" value={assetDeploymentReadiness(overview?.assets)} />
            <AssetInsight icon={Laptop} label="Stock to deploy" value={assetStockSignal(overview?.assets)} />
          </div>
        </section>
      </div>
    </div>
  );
}

function DomainHeader({ icon: Icon, eyebrow, title, subtitle }) {
  return (
    <div className="snDomainHeader">
      <span><Icon size={17} /></span>
      <div>
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function OverviewMetric({ metric, value }) {
  const Icon = metric.icon;
  return (
    <article className={`snOverviewMetric tone-${metric.tone}`}>
      <span><Icon size={17} /></span>
      <div>
        <small>{metric.label}</small>
        <strong>{metricValue(value)}</strong>
        <em>{metricAvailability(value)}</em>
      </div>
    </article>
  );
}

function metricValue(metric) {
  return formatMetricValue(metric, false);
}

function resolveCmdbMetric(cmdb, key) {
  if (!cmdb) return null;
  if (key === "relationships") return cmdb.relationships;
  if (key === "certifiedCis") return cmdb.certification?.certified;
  if (key === "relationshipDuplicate") return cmdb.relationshipHealth?.duplicate;
  if (key === "relationshipOrphan") return cmdb.relationshipHealth?.orphan;
  if (key === "relationshipStale") return cmdb.relationshipHealth?.stale;
  return null;
}

function AssetInsight({ icon: Icon, label, value }) {
  return (
    <article className="snAssetInsight">
      <span><Icon size={15} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function assetLifecycleSummary(assets) {
  if (!assets?.total?.available) return "Lifecycle visibility unavailable";
  const total = Number(assets.total.value || 0);
  const deployed = Number(assets.deployed?.value || 0);
  const stock = Number(assets.stock?.value || 0);
  return `${total.toLocaleString("en-GB")} tracked assets, ${deployed.toLocaleString("en-GB")} deployed, ${stock.toLocaleString("en-GB")} ready in stock`;
}

function assetLifecycleAutomation(assets) {
  if (!assets?.total?.available) return "Unavailable";
  return `${assetRatio(assets.deployed, assets.total)} deployed`;
}

function assetDeploymentReadiness(assets) {
  if (!assets?.stock?.available) return "Unavailable";
  const stock = Number(assets.stock.value || 0);
  return stock > 0 ? "Ready to allocate" : "No stock ready";
}

function assetStockSignal(assets) {
  if (!assets?.stock?.available) return "Unavailable";
  return `${Number(assets.stock.value || 0).toLocaleString("en-GB")} available`;
}

function assetRatio(numerator, denominator) {
  const total = Number(denominator?.value || 0);
  if (!total) return "0%";
  const ratio = Math.round((Number(numerator?.value || 0) / total) * 100);
  return `${ratio}%`;
}

function StripCard({ tone, label, value, detail, percent = false, compact = false }) {
  return (
    <article className={`snOperationalCard tone-${tone}${compact ? " isCompact" : ""}`}>
      <span>{label}</span>
      <strong>{formatMetricValue(value, percent)}</strong>
      <small>{detail}</small>
    </article>
  );
}

function rateLabel(metric) {
  if (!metric?.available) return metric?.reason || "No completion rate";
  return `${Number(metric.value || 0).toLocaleString("en-GB")}% successful`;
}

function scanCountFromOverview(overview) {
  const values = [
    overview?.cmdb?.relationshipHealth?.duplicate,
    overview?.duplicates?.count,
    overview?.governance?.duplicateHotspots,
    overview?.cmdb?.duplicateHotspots
  ].filter((value) => typeof value === "number");
  return values[0] ?? null;
}

function duplicateHotspotCount(overview) {
  const count = scanCountFromOverview(overview);
  return count === null ? null : count;
}

function duplicateHotspotSummary(overview) {
  const governance = overview?.governance;
  if (typeof governance?.duplicateHotspots === "number") {
    const parts = [`${Number(governance.duplicateHotspots).toLocaleString("en-GB")} duplicate records`];
    if (governance.duplicateHotspotLabel) parts.push(`${governance.duplicateHotspotLabel}`);
    if (governance.duplicateHotspotRate !== undefined) parts.push(`${Number(governance.duplicateHotspotRate).toLocaleString("en-GB")}% of scanned records`);
    return parts.join(" · ");
  }
  return "Foundation data and CMDB";
}

function normalizationSummary(normalization) {
  const sam = normalization?.sam;
  const ham = normalization?.ham;
  if (sam?.available || ham?.available) {
    const parts = [];
    if (sam?.available) parts.push(`SAM ${Number(sam.normalizedPercent ?? 0).toLocaleString("en-GB")}% normalized`);
    if (ham?.available) parts.push(`HAM ${Number(ham.readyPercent ?? 0).toLocaleString("en-GB")}% ready`);
    return parts.join(" · ");
  }
  return "Normalization coverage";
}

function formatExactDateTime(value) {
  if (!value) return "Waiting...";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}


