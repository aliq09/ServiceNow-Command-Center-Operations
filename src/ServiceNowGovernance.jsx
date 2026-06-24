import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CircleDollarSign,
  CopyCheck,
  DatabaseZap,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UsersRound
} from "lucide-react";

const DATASETS = [
  ["computers", "Computers"],
  ["servers", "Servers"],
  ["ham", "HAM Pro"],
  ["sam", "SAM Pro"],
  ["companies", "Companies"],
  ["locations", "Locations"],
  ["costCenters", "Cost centers"],
  ["users", "Users"]
];

export function ServiceNowGovernance({ instanceId }) {
  const [governance, setGovernance] = useState(null);
  const [dataset, setDataset] = useState("computers");
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewGroup, setReviewGroup] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [jobOutput, setJobOutput] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadGovernance = useCallback(async (signal) => {
    const response = await fetch(`/api/servicenow/governance?instance=${encodeURIComponent(instanceId)}`, { signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load user and subscription governance.");
    setGovernance(result);
  }, [instanceId]);

  const runScan = useCallback(async (selectedDataset = dataset, signal) => {
    setLoading(true);
    setError("");
    setReviewGroup(null);
    try {
      const response = await fetch(
        `/api/servicenow/dedup/scan?instance=${encodeURIComponent(instanceId)}&type=${encodeURIComponent(selectedDataset)}`,
        { signal }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to scan for duplicate records.");
      setScan(result);
    } catch (requestError) {
      if (requestError.name !== "AbortError") setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [dataset, instanceId]);

  useEffect(() => {
    const controller = new AbortController();
    loadGovernance(controller.signal).catch((requestError) => {
      if (requestError.name !== "AbortError") setError(requestError.message);
    });
    return () => controller.abort();
  }, [instanceId, loadGovernance]);

  useEffect(() => {
    const controller = new AbortController();
    runScan(dataset, controller.signal);
    return () => controller.abort();
  }, [dataset, instanceId, runScan]);

  const selectDataset = (nextDataset) => {
    setDataset(nextDataset);
    setJobOutput(null);
  };

  const openDeletionReview = (group) => {
    setReviewGroup(group);
    setConfirmation("");
    setAcknowledge(false);
    setJobOutput(null);
  };

  const executeDeletion = async () => {
    if (!reviewGroup) return;
    const deleteSysIds = reviewGroup.records
      .filter((record) => record.sysId !== reviewGroup.retainedSysId)
      .map((record) => record.sysId);
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/servicenow/dedup/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance: instanceId,
          type: dataset,
          groupId: reviewGroup.id,
          keepSysId: reviewGroup.retainedSysId,
          deleteSysIds,
          confirmation,
          acknowledgeReferences: acknowledge
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Deduplication job failed.");
      setJobOutput(result);
      setReviewGroup(null);
      await runScan(dataset);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeleting(false);
    }
  };

  const deletionCount = reviewGroup?.duplicateCount || 0;
  const expectedConfirmation = `DELETE ${deletionCount} DUPLICATES`;

  return (
    <section className="snGovernanceCenter" aria-label="Duplicate, user and ServiceNow license governance">
      <header className="snGovernanceHeader">
        <div>
          <span><DatabaseZap size={20} /></span>
          <div>
            <small>Data governance & commercial control</small>
            <strong>Duplicate Intelligence, Users & ServiceNow Licensing</strong>
            <p>Evidence-led duplicate remediation, role consumption, and subscription visibility.</p>
          </div>
        </div>
        <div className="snGovernanceGuardrail">
          <ShieldCheck size={16} />
          <span>Deletion requires 100% field match and explicit confirmation</span>
        </div>
      </header>

      {error && <div className="snGovernanceError"><AlertTriangle size={17} /><span>{error}</span></div>}

      <div className="snGovernanceBody">
        <section className="snDuplicatePanel">
          <div className="snGovernanceTitle">
            <div><CopyCheck size={17} /><strong>Duplicate-record control</strong></div>
            <button type="button" onClick={() => runScan(dataset)} disabled={loading}>
              <RefreshCw size={14} className={loading ? "isSpinning" : ""} /> Rescan
            </button>
          </div>

          <div className="snDedupDatasets" role="tablist" aria-label="Duplicate datasets">
            {DATASETS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={dataset === key}
                className={dataset === key ? "active" : ""}
                onClick={() => selectDataset(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="snDedupSummary">
            <SummaryMetric label="Records scanned" value={scan?.totalRecords} />
            <SummaryMetric label="Duplicate groups" value={scan?.duplicateGroups} />
            <SummaryMetric label="Candidate duplicates" value={scan?.duplicateRecords} />
            <SummaryMetric label="Duplicate rate" value={`${scan?.duplicatePercent || 0}%`} />
            <SummaryMetric label="100% field match" value={scan?.exactDuplicateRecords} tone="exact" />
          </div>

          <p className="snDedupMethodology">
            {scan?.methodology || "Scanning exact business keys and comparing all configured business fields."}
          </p>

          <div className="snDuplicateGroups">
            {loading ? (
              <div className="snGovernanceEmpty">Scanning {DATASETS.find(([key]) => key === dataset)?.[1]}…</div>
            ) : scan?.groups?.length ? (
              scan.groups.slice(0, 8).map((group) => (
                <article key={group.id} className={group.exact ? "exact" : "review"}>
                  <div className="snDuplicateGroupTop">
                    <span>{group.exact ? <BadgeCheck size={17} /> : <AlertTriangle size={17} />}</span>
                    <div>
                      <strong>{group.key}</strong>
                      <small>{group.rule} · {group.records.length} matching records</small>
                    </div>
                    <b>{group.confidence}% confidence</b>
                  </div>
                  <div className="snDuplicateRecordList">
                    {group.records.slice(0, 4).map((record) => (
                      <div key={record.sysId}>
                        <span>{record.retainRecommended ? "KEEP" : "DUPLICATE"}</span>
                        <strong>{record.display}</strong>
                        <small>{record.sysId}</small>
                      </div>
                    ))}
                    {group.records.length > 4 && (
                      <div className="snDuplicateMore">
                        <span>MORE</span>
                        <strong>+{group.records.length - 4} additional matching records</strong>
                      </div>
                    )}
                  </div>
                  <div className="snDuplicateAction">
                    <p>{group.warning}</p>
                    {group.deleteEligible ? (
                      <button type="button" onClick={() => openDeletionReview(group)}>
                        <Trash2 size={14} /> Review deletion job
                      </button>
                    ) : (
                      <span>Manual merge required</span>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="snGovernanceEmpty"><BadgeCheck size={18} /> No duplicate keys found in this dataset.</div>
            )}
          </div>
        </section>

        <aside className="snGovernanceSidebar">
          <section className="snUserGovernance">
            <div className="snGovernanceTitle">
              <div><UsersRound size={17} /><strong>User & role posture</strong></div>
              <span>Live</span>
            </div>
            <div className="snUserKpis">
              <UserMetric icon={UserRoundCheck} label="Active users" value={governance?.users?.active} />
              <UserMetric icon={ShieldCheck} label="Users with roles" value={governance?.users?.withRoles} />
              <UserMetric icon={CopyCheck} label="Role assignments" value={governance?.users?.roleAssignments} />
            </div>
            <div className="snTopRoles">
              <strong>Highest assigned roles</strong>
              {(governance?.users?.topRoles || []).map((role) => (
                <div key={role.role}><span>{role.role}</span><b>{formatNumber(role.count)}</b></div>
              ))}
            </div>
            <p>Average {governance?.users?.averageRoles || 0} role assignments per role-bearing user.</p>
          </section>

          <section className="snLicenseCommercial">
            <div className="snGovernanceTitle">
              <div><CircleDollarSign size={17} /><strong>ServiceNow subscription cost</strong></div>
              <span>{governance?.licensing?.subscriptionsAvailable ? "Measured" : "Contract required"}</span>
            </div>
            <div className="snLicenseCostHero">
              <span>Verified recurring charge</span>
              <strong>{governance?.licensing?.contractCostAvailable ? formatCurrency(governance.licensing.contractCost) : "Not available"}</strong>
              <small>Negotiated ServiceNow pricing is not exposed by this PDI.</small>
            </div>
            <div className="snLicenseConsumption">
              <div><span>Purchased subscriptions</span><strong>{formatNumber(governance?.licensing?.purchased)}</strong></div>
              <div><span>Allocated subscriptions</span><strong>{formatNumber(governance?.licensing?.allocated)}</strong></div>
              <div><span>Unsubscribed users</span><strong>{metricValue(governance?.licensing?.unlicensedUsers)}</strong></div>
            </div>
            <p>{governance?.licensing?.message}</p>
            <small>Financial source: {governance?.licensing?.pricingSource}</small>
          </section>
        </aside>
      </div>

      {reviewGroup && (
        <div className="snDedupReview" role="dialog" aria-modal="true" aria-label="Deduplication deletion review">
          <div className="snDedupReviewCard">
            <div className="snDedupReviewHeader">
              <span><Trash2 size={19} /></span>
              <div><small>Destructive operation</small><strong>Review deduplication job</strong></div>
              <button type="button" onClick={() => setReviewGroup(null)}>Cancel</button>
            </div>
            <p>
              Keep <strong>{reviewGroup.records.find((record) => record.sysId === reviewGroup.retainedSysId)?.display}</strong> and
              delete {deletionCount} record(s). ServiceNow references are not automatically merged.
            </p>
            <label className="snDedupAcknowledge">
              <input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />
              <span>I reviewed reference, audit, legal-retention, and integration impact.</span>
            </label>
            <label className="snDedupConfirmation">
              <span>Type <strong>{expectedConfirmation}</strong></span>
              <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </label>
            <button
              type="button"
              className="snDedupExecute"
              disabled={deleting || !acknowledge || confirmation !== expectedConfirmation}
              onClick={executeDeletion}
            >
              <Trash2 size={15} /> {deleting ? "Deleting…" : "Run verified deletion"}
            </button>
          </div>
        </div>
      )}

      {jobOutput && (
        <div className="snDedupOutput">
          <BadgeCheck size={17} />
          <div><strong>Deduplication committed</strong><span>{jobOutput.message}</span></div>
        </div>
      )}
    </section>
  );
}

function SummaryMetric({ label, value, tone = "" }) {
  return <div className={tone}><span>{label}</span><strong>{value ?? "—"}</strong></div>;
}

function UserMetric({ icon: Icon, label, value }) {
  return (
    <article>
      <span><Icon size={15} /></span>
      <div><small>{label}</small><strong>{metricValue(value)}</strong></div>
    </article>
  );
}

function metricValue(metric) {
  if (!metric?.available) return "—";
  return formatNumber(metric.value);
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
