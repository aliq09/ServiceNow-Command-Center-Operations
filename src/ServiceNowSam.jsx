import {
  AlertTriangle,
  BadgeCheck,
  Boxes,
  Calculator,
  CircleDollarSign,
  FileCheck2,
  PackageSearch,
  PieChart,
  Scale,
  ShieldAlert,
  ShoppingBasket,
  RefreshCw,
  UsersRound
} from "lucide-react";

export function ServiceNowSam({ sam, loading, error, onRefresh, refreshState }) {
  const reconciliation = sam?.reconciliation;
  const maxVendorRights = Math.max(...(sam?.vendors || []).map((vendor) => vendor.purchasedRights), 1);

  return (
    <section className="snSamCenter" aria-label="Software Asset Management Pro">
      <div className="snSamHeader">
        <div>
          <span><PieChart size={19} /></span>
          <div>
            <small>Software Asset Management</small>
            <strong>SAM Pro License Intelligence</strong>
            <p>Entitlements, effective license position, publisher compliance, and software inventory.</p>
          </div>
        </div>
        <div className={`snSamReconBadge ${reconciliation?.available || reconciliation?.jobCompleted ? "ready" : "pending"}`}>
          {reconciliation?.available || reconciliation?.jobCompleted ? <BadgeCheck size={15} /> : <AlertTriangle size={15} />}
          <span>
            {loading
              ? "Refreshing SAM data..."
              : reconciliation?.available
                ? "License position available"
                : reconciliation?.jobCompleted
                  ? "Reconciliation completed"
                  : "Reconciliation required"}
          </span>
        </div>
        <button type="button" className="snSamRefresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? "isSpinning" : ""} />
          {refreshState?.loading ? `Refreshing… ${refreshState.tick || 1}s` : "Refresh SAM"}
        </button>
        {sam?.demoData && (
          <div className="snSamDemoBadge">
            <AlertTriangle size={14} />
            <span>Demo reporting data</span>
          </div>
        )}
      </div>

      {error ? (
        <div className="snSamError"><ShieldAlert size={17} /><span>{error}</span></div>
      ) : (
        <>
          {sam?.demoData && (
            <div className="snSamDemoNotice">
              <strong>Demonstration dataset</strong>
              <span>
                Entitlements and software models are live from this PDI. Installation totals, effective license positions, and
                publisher compliance are simulated because protected SAM reconciliation tables do not permit direct REST inserts.
              </span>
            </div>
          )}
          <div className="snSamKpis">
            <SamKpi icon={FileCheck2} tone="blue" label="Entitlements" metric={sam?.entitlements?.total} />
            <SamKpi icon={ShoppingBasket} tone="violet" label="Purchased rights" metric={sam?.entitlements?.purchasedRights} />
            <SamKpi icon={Scale} tone="green" label="Active rights" metric={sam?.entitlements?.activeRights} />
            <SamKpi icon={CircleDollarSign} tone="amber" label="Entitlement value" metric={sam?.entitlements?.estimatedValue} currency />
            <SamKpi icon={PackageSearch} tone="red" label="Expiring in 90 days" metric={sam?.entitlements?.expiring90} />
            <SamKpi icon={Boxes} tone="slate" label="Software models" metric={sam?.inventory?.softwareModels} />
            <SamKpi icon={UsersRound} tone="blue" label="Installations" metric={sam?.inventory?.installations} />
          </div>

          <div className="snSamBody">
            <section className="snSamPosition">
              <SectionTitle icon={Calculator} title="Effective license position" subtitle="Latest reconciliation totals" />
              {reconciliation?.available ? (
                <>
                  <div className="snSamPositionGrid">
                    <PositionMetric label="Rights owned" value={reconciliation.position.owned} />
                    <PositionMetric label="Rights used" value={reconciliation.position.used} />
                    <PositionMetric label="Rights required" value={reconciliation.position.required} />
                    <PositionMetric label="Available rights" value={reconciliation.position.available} tone="positive" />
                    <PositionMetric label="Unlicensed" value={reconciliation.position.unlicensed} tone="negative" />
                    <PositionMetric label="True-up exposure" value={reconciliation.position.trueUpCost} tone="negative" currency />
                  </div>
                  <div className="snSamComplianceSummary">
                    <span>Publisher compliance</span>
                    <strong>{reconciliation.nonCompliantPublishers}</strong>
                    <small>publishers with compliance exposure</small>
                  </div>
                </>
              ) : (
                <div className="snSamReconEmpty">
                  {reconciliation?.jobCompleted ? <BadgeCheck size={24} /> : <Calculator size={24} />}
                  <strong>{reconciliation?.jobCompleted ? "Reconciliation completed with no licensable installs" : "License position has not been calculated"}</strong>
                  <p>{reconciliation?.message || "Run SAM reconciliation to calculate owned, consumed, available, and true-up positions."}</p>
                  {reconciliation?.latestJob && (
                    <a className="snSamJobResult" href={reconciliation.latestJob.url} target="_blank" rel="noreferrer">
                      <span>{reconciliation.latestJob.number || "Latest reconciliation"}</span>
                      <strong>{reconciliation.latestJob.progressLabel || `${reconciliation.latestJob.progress}%`}</strong>
                      <small>{reconciliation.latestJob.step} · {reconciliation.latestJob.lastReconciled}</small>
                    </a>
                  )}
                  <div>
                    <span>{reconciliation?.latestJob?.licensableInstalls || 0} licensable installs</span>
                    <span>{reconciliation?.latestJob?.inUseEntitlements || 0} in-use entitlements</span>
                    <span>Compliance is not inferred</span>
                  </div>
                  {reconciliation?.latestJob?.healthWarning && (
                    <p className="snSamHealthWarning">
                      Health-check warning: the reconciliation completed, but a SAM health check referenced an unavailable table.
                    </p>
                  )}
                </div>
              )}
            </section>

            <section className="snSamPublishers">
              <SectionTitle icon={PieChart} title="License counts by publisher" subtitle="Purchased rights and entitlement value" />
              {sam?.vendors?.length ? (
                <div className="snSamVendorList">
                  {sam.vendors.map((vendor) => (
                    <div key={vendor.publisher}>
                      <div>
                        <strong>{vendor.publisher}</strong>
                        <span>{vendor.entitlements} entitlements · {formatNumber(vendor.purchasedRights)} rights</span>
                      </div>
                      <b><i style={{ width: `${Math.max((vendor.purchasedRights / maxVendorRights) * 100, 2)}%` }} /></b>
                      <em>{formatCurrency(vendor.estimatedValue)}</em>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyText text="No publisher entitlement data is available." />
              )}
            </section>

            <section className="snSamCompliance">
              <SectionTitle icon={ShieldAlert} title="Publisher compliance" subtitle="Reconciliation-derived exposure" />
              {reconciliation?.available && sam?.publisherCompliance?.length ? (
                <div className="snSamComplianceList">
                  {sam.publisherCompliance.map((publisher) => (
                    <article key={publisher.sysId || publisher.publisher} className={publisher.nonCompliant ? "nonCompliant" : "compliant"}>
                      <span>{publisher.nonCompliant ? <ShieldAlert size={15} /> : <BadgeCheck size={15} />}</span>
                      <div><strong>{publisher.publisher}</strong><small>{publisher.status}</small></div>
                      <div><strong>{formatCurrency(publisher.trueUpCost)}</strong><small>{publisher.exposure} exposed units</small></div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyText text={reconciliation?.message || "Publisher compliance requires SAM reconciliation results."} />
              )}
            </section>

            <section className="snSamEntitlements">
              <SectionTitle icon={FileCheck2} title="Recent entitlements" subtitle="Purchased rights and unit costs" />
              {sam?.recentEntitlements?.length ? (
                <div className="snSamEntitlementList">
                  {sam.recentEntitlements.map((entitlement) => (
                    <a key={entitlement.sysId} href={entitlement.url} target="_blank" rel="noreferrer">
                      <div>
                        <strong>{entitlement.model || entitlement.name}</strong>
                        <span>{entitlement.publisher}</span>
                      </div>
                      <div>
                        <strong>{formatNumber(entitlement.purchasedRights)}</strong>
                        <span>purchased rights</span>
                      </div>
                      <div>
                        <strong>{formatCurrency(entitlement.unitCost)}</strong>
                        <span>unit cost</span>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <EmptyText text="No software entitlements were returned." />
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function SamKpi({ icon: Icon, tone, label, metric, currency = false }) {
  return (
    <article className={`snSamKpi tone-${tone}`}>
      <span><Icon size={16} /></span>
      <div>
        <small>{label}</small>
        <strong>{metric?.available ? currency ? formatCurrency(metric.value) : formatNumber(metric.value) : "—"}</strong>
        <em>{metric?.available ? "Live" : metric?.reason || "Unavailable"}</em>
      </div>
    </article>
  );
}

function PositionMetric({ label, value, tone = "", currency = false }) {
  return (
    <div className={tone}>
      <span>{label}</span>
      <strong>{currency ? formatCurrency(value) : formatNumber(value)}</strong>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="snSamSectionTitle">
      <div><Icon size={16} /><span>{title}</span></div>
      <small>{subtitle}</small>
    </div>
  );
}

function EmptyText({ text }) {
  return <div className="snSamEmpty"><AlertTriangle size={18} /><span>{text}</span></div>;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-GB");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}
