import {
  Activity,
  Box,
  CheckCircle2,
  Cloud,
  Clock3,
  Database,
  HardDrive,
  Layers3,
  Network,
  RadioTower,
  RefreshCw,
  Server,
  XCircle
} from "lucide-react";

const AWS_ARTIFACTS = [
  { key: "ec2Total", label: "EC2 instances", icon: Server },
  { key: "accounts", label: "AWS accounts", icon: Cloud },
  { key: "regions", label: "AWS regions", icon: RadioTower },
  { key: "loadBalancers", label: "Load balancers", icon: Network },
  { key: "databases", label: "Cloud databases", icon: Database },
  { key: "objectStorage", label: "Object storage", icon: HardDrive },
  { key: "functions", label: "Cloud functions", icon: Box },
  { key: "subnets", label: "Cloud subnets", icon: Layers3 },
  { key: "ecsClusters", label: "ECS clusters", icon: Activity }
];

export function ServiceNowDiscovery({ discovery, loading, error, onRefresh, refreshState }) {
  const rate = discovery?.schedules?.successRate;
  const rateValue = rate?.available && rate.value !== null ? Number(rate.value) : null;

  return (
    <section className="snDiscoveryCenter" aria-label="ServiceNow Discovery and AWS operations">
      <div className="snDiscoveryHeader">
        <div>
          <span><RadioTower size={19} /></span>
          <div>
            <small>ITOM visibility</small>
            <strong>Discovery & AWS Operations</strong>
            <p>Schedule execution health, EC2 discovery activity, and cloud CMDB inventory.</p>
          </div>
        </div>
        <div className="snDiscoveryFreshness">
          <Clock3 size={14} />
          <span>{loading ? "Refreshing Discovery data..." : discovery?.window || "Last 24 hours"}</span>
          <button type="button" className="snInlineRefresh" onClick={onRefresh} disabled={loading} aria-label="Refresh Discovery">
            <RefreshCw size={13} className={loading ? "isSpinning" : ""} />
            {refreshState?.loading ? `${refreshState.tick || 1}s` : ""}
          </button>
        </div>
      </div>

      {error ? (
        <div className="snDiscoveryError">
          <XCircle size={17} />
          <span>{error}</span>
        </div>
      ) : (
        <>
          <div className="snDiscoverySummary">
            <article className="snDiscoveryRate">
              <div
                className="snDiscoveryRateRing"
                style={{ "--discovery-rate": `${rateValue ?? 0}%` }}
              >
                <strong>{rateValue === null ? "—" : `${rateValue}%`}</strong>
                <span>successful</span>
              </div>
              <div>
                <small>Schedule health</small>
                <strong>Discovery completion</strong>
                <p>{rateValue === null ? rate?.reason || "No terminal runs available." : "Completed versus failed runs in the last 24 hours."}</p>
              </div>
            </article>

            <DiscoveryKpi
              icon={CheckCircle2}
              tone="green"
              label="Completed runs"
              metric={discovery?.schedules?.completed}
            />
            <DiscoveryKpi
              icon={XCircle}
              tone="red"
              label="Failed runs"
              metric={discovery?.schedules?.failed}
            />
            <DiscoveryKpi
              icon={Activity}
              tone="blue"
              label="Running now"
              metric={discovery?.schedules?.running}
            />
            <DiscoveryKpi
              icon={RadioTower}
              tone="violet"
              label="Active schedules"
              metric={discovery?.schedules?.active}
              detail={discovery?.schedules?.total?.available
                ? `of ${formatMetric(discovery.schedules.total)} configured`
                : ""}
            />
            <DiscoveryKpi
              icon={RadioTower}
              tone="blue"
              label="MID servers"
              metric={discovery?.schedules?.midServers}
              detail={discovery?.schedules?.midServers?.available
                ? `${formatMetric(discovery.schedules.midServersActive)} active`
                : "MID Server visibility"}
            />
            <DiscoveryKpi
              icon={Server}
              tone="amber"
              label="EC2 discovered today"
              metric={discovery?.aws?.ec2Today}
              detail="Most recent discovery is today"
            />
            <DiscoveryKpi
              icon={CheckCircle2}
              tone="green"
              label="Schedules run today"
              metric={discovery?.runsToday?.total}
              detail={discovery?.runsToday?.available ? "Completed + failed runs" : "Run summary"}
            />
            <DiscoveryKpi
              icon={XCircle}
              tone="red"
              label="Schedules failed today"
              metric={discovery?.runsToday?.failed}
              detail={discovery?.runsToday?.available ? "Failures in the current window" : "Failure summary"}
            />
          </div>

          <div className="snDiscoveryBody">
            <section className="snAwsInventory">
              <div className="snDiscoverySectionTitle">
                <div><Cloud size={16} /><span>AWS and cloud inventory</span></div>
                <small>Live CMDB class totals</small>
              </div>
              <div className="snAwsArtifactGrid">
                {AWS_ARTIFACTS.map(({ key, label, icon: Icon }) => (
                  <article key={key}>
                    <span><Icon size={15} /></span>
                    <div><small>{label}</small><strong>{formatMetric(discovery?.aws?.[key])}</strong></div>
                  </article>
                ))}
              </div>
              <p className="snDiscoverySourceNote">{discovery?.sourceNote}</p>
            </section>

            <section className="snDiscoveryRuns">
              <div className="snDiscoverySectionTitle">
                <div><Activity size={16} /><span>Recent Discovery runs</span></div>
                <small>Latest activity</small>
              </div>
              {discovery?.recentRuns?.records?.length ? (
                <div className="snDiscoveryRunList">
                  {discovery.recentRuns.records.map((run) => (
                    <a key={run.sysId} href={run.url} target="_blank" rel="noreferrer">
                      <i className={runStateClass(run.state)} />
                      <div>
                        <strong>{run.dscheduler || run.number || "Discovery run"}</strong>
                        <span>{run.number} · {run.description || run.source || "Scheduled"}</span>
                      </div>
                      <div>
                        <strong>{run.state || "Unknown"}</strong>
                        <span>{formatServiceNowDate(run.sys_created_on)}</span>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="snDiscoveryEmpty">
                  <RadioTower size={20} />
                  <strong>No recent Discovery runs</strong>
                  <span>{discovery?.recentRuns?.reason || "No runs were returned for the last 24 hours."}</span>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function DiscoveryKpi({ icon: Icon, tone, label, metric, detail = "Last 24 hours" }) {
  return (
    <article className={`snDiscoveryKpi tone-${tone}`}>
      <span><Icon size={17} /></span>
      <div>
        <small>{label}</small>
        <strong>{formatMetric(metric)}</strong>
        <em>{metric?.available ? detail : metric?.reason || "Unavailable"}</em>
      </div>
    </article>
  );
}

function formatMetric(metric) {
  if (!metric?.available) return "—";
  return Number(metric.value || 0).toLocaleString("en-GB");
}

function formatServiceNowDate(value) {
  if (!value) return "Time unavailable";
  const normalized = String(value).replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
}

function runStateClass(state) {
  const normalized = String(state || "").toLowerCase();
  if (normalized === "completed") return "success";
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("cancel")) return "failed";
  return "running";
}
