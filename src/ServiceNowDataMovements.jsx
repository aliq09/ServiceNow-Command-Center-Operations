import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Database, Layers3, RefreshCw, ShieldCheck, Workflow, Unplug } from "lucide-react";

const TABLE_CATALOG = {
  essential: [
    ["sys_user", "Users"],
    ["task", "Task"],
    ["incident", "Incident"],
    ["problem", "Problem"],
    ["change_request", "Change request"],
    ["sc_request", "Catalog request"],
    ["sc_req_item", "Requested item"],
    ["cmdb_ci", "Configuration item"]
  ],
  itsm: [
    ["incident", "Incident"],
    ["problem", "Problem"],
    ["change_request", "Change request"],
    ["sc_request", "Catalog request"],
    ["sc_req_item", "Requested item"],
    ["sc_task", "Catalog task"],
    ["sysapproval_approver", "Approval"],
    ["task_sla", "Task SLA"],
    ["sys_journal_field", "Journal field"],
    ["sys_attachment", "Attachment"]
  ],
  itom: [
    ["cmdb_ci", "CI base"],
    ["cmdb_ci_computer", "Computer"],
    ["cmdb_ci_server", "Server"],
    ["cmdb_ci_ip_switch", "IP switch"],
    ["cmdb_ci_router", "Router"],
    ["cmdb_ci_firewall", "Firewall"],
    ["cmdb_ci_ip_address", "IP address"],
    ["cmdb_rel_ci", "CI relationship"],
    ["discovery_schedule", "Discovery schedule"],
    ["discovery_status", "Discovery status"],
    ["ecc_agent", "MID Server"],
    ["ecc_queue", "ECC queue"]
  ],
  itam: [
    ["alm_asset", "Asset"],
    ["alm_hardware", "Hardware asset"],
    ["alm_license", "License"],
    ["alm_entitlement", "Entitlement"],
    ["alm_stockroom", "Stockroom"],
    ["alm_consumable", "Consumable"],
    ["alm_transfer_order", "Transfer order"],
    ["cmdb_hardware_product_model", "Hardware product model"]
  ],
  sam: [
    ["cmdb_sam_sw_discovery_model", "Software discovery model"],
    ["cmdb_sam_sw_product_model", "Software product model"],
    ["cmdb_sam_sw_publisher", "Software publisher"],
    ["sn_license", "License"],
    ["sn_entitlement", "Entitlement"],
    ["sn_entitlement_user", "Entitlement user"]
  ],
  hrsd: [
    ["sn_hr_core_case", "HR case"],
    ["sn_hr_core_task", "HR task"],
    ["sn_hr_core_profile", "HR profile"],
    ["sn_hr_core_service", "HR service"],
    ["sys_user", "User"],
    ["sys_user_group", "Group"],
    ["sys_user_role", "Role"]
  ],
  foundation: [
    ["core_company", "Company"],
    ["cmn_location", "Location"],
    ["cmn_cost_center", "Cost center"],
    ["cmdb_ci_business_app", "Business application"],
    ["cmdb_ci_service_business", "Business service"],
    ["cmdb_ci_service_technical", "Technical service"],
    ["service_offering", "Service offering"]
  ],
  aws: [
    ["cmdb_ci_aws_account", "AWS account"],
    ["cmdb_ci_ec2_instance", "EC2 instance"],
    ["cmdb_ci_vm_instance", "VM instance"],
    ["cmdb_ci_cloud_subnet", "Subnet"],
    ["cmdb_ci_cloud_database", "Cloud database"],
    ["cmdb_ci_cloud_load_balancer", "Load balancer"],
    ["cmdb_ci_cloud_object_storage", "Object storage"],
    ["cmdb_ci_cloud_function", "Cloud function"]
  ],
  technical: [
    ["sys_user", "User"],
    ["sys_user_group", "Group"],
    ["sys_user_role", "Role"],
    ["task", "Task"],
    ["sys_dictionary", "Dictionary"],
    ["sys_choice", "Choice"],
    ["sys_metadata", "Metadata"],
    ["sys_script", "Business rule"],
    ["sys_script_client", "Client script"],
    ["sys_script_include", "Script include"],
    ["ecc_agent", "MID Server"],
    ["ecc_queue", "ECC queue"]
  ]
};

const SOURCE_PRESETS = {
  other: { label: "Manual source", description: "Enter the source URL and credentials manually." },
  ga: { label: "GA instance", description: "Use GA as the source system." },
  kkr: { label: "KKR instance", description: "Use KKR as the source system." },
  third: { label: "3rd party instance", description: "Use another external instance as source." }
};

const SOURCE_DEFAULTS = {
  other: { sourceUrl: "", sourceUser: "", sourcePassword: "" },
  ga: { sourceUrl: "https://ga.service-now.com", sourceUser: "api.user", sourcePassword: "" },
  kkr: { sourceUrl: "https://kkr.service-now.com", sourceUser: "api.user", sourcePassword: "" },
  third: { sourceUrl: "", sourceUser: "", sourcePassword: "" }
};

const DEFAULT_FORM = {
  sourceUrl: "",
  sourceUser: "",
  sourcePassword: "",
  table: "cmdb_ci_server"
};

export function ServiceNowDataMovements({ instances = [], instanceId }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [plan, setPlan] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [movementTick, setMovementTick] = useState(0);
  const [stage, setStage] = useState({ key: "idle", label: "Idle", detail: "Awaiting field matrix build." });
  const [liveEvents, setLiveEvents] = useState([]);
  const [ireEndpointPath, setIreEndpointPath] = useState("/api/now/identifyreconcile");
  const [discoverySource, setDiscoverySource] = useState("ImportSet");
  const [sourcePreset, setSourcePreset] = useState("other");
  const [runMode, setRunMode] = useState("test10");
  const pdiInstance = instances.find((item) => item.id === "pdi") || instances.find((item) => item.id === instanceId);

  useEffect(() => {
    const defaults = SOURCE_DEFAULTS[sourcePreset] || SOURCE_DEFAULTS.other;
    setForm((current) => ({ ...current, ...defaults }));
  }, [sourcePreset]);

  const mappedPercent = useMemo(() => {
    if (!plan?.fieldMatrix?.mappings?.length || (!plan?.source?.fields && !plan?.target?.fields)) return 0;
    const denominator = Math.max(plan.source.fields || 0, plan.target.fields || 0, 1);
    return Math.round((plan.fieldMatrix.mappings.length / denominator) * 100);
  }, [plan]);

  const sourceConnected = Boolean(form.sourceUrl && form.sourceUser && form.sourcePassword);
  const targetConnected = Boolean(pdiInstance?.host && pdiInstance?.username);
  const resolvedTarget = pdiInstance?.host ? {
    url: `https://${pdiInstance.host}`,
    user: pdiInstance.username || "",
    password: pdiInstance.password || ""
  } : null;
  const transferLabel = `${(form.sourceUrl || "source").replace(/^https?:\/\//, "")} → ${resolvedTarget?.url ? resolvedTarget.url.replace(/^https?:\/\//, "") : "destination"}`;
  const tableRecordCount = plan?.source?.count || 0;
  const processedCount = runResult?.transferredRecords || 0;
  const sourceConnectionDetail = sourceConnected
    ? `Connected via ${form.sourceUser} on ${(form.sourceUrl || "").replace(/^https?:\/\//, "")}`
    : "Connect the source instance to load records.";
  const verificationDetail = runResult?.verification;
  const readiness = runResult?.readiness;
  const discoverySourceValidation = runResult?.discoverySourceValidation;
  const firstBlockedReason = runResult?.firstBlockedReason || "";
  const sampleReasons = runResult?.sampleReasons || [];
  const samplePayloadPreview = runResult?.samplePayloadPreview || plan?.irePayloadPreview || null;
  const transferMode = runResult?.transferMode || "pending";
  const testBatchSize = 10;
  const verifiedCount = runResult?.results?.filter((item) => item.verification?.found).length || 0;
  const verifiedRecords = runResult?.verifiedRecords || [];
  const rawIreResponse = runResult?.results?.find((item) => item.rawResponse)?.rawResponse || "";
  const responseRows = useMemo(() => {
    if (!runResult?.results?.length) return [];
    return runResult.results.slice(0, 10).map((item, index) => ({
      index: index + 1,
      operation: item.verification?.found ? "VERIFIED" : String(item.ire_output?.operation || item.status || "UNKNOWN").toUpperCase(),
      sysId: item.verification?.record?.sys_id || item.ire_output?.sysId || item.ire_output?.items?.[0]?.sysId || item.ire_output?.additionalCommittedItems?.[0]?.sysId || "",
      status: item.verification?.found ? "Verified in PDI" : item.status || "Pending",
      detail: item.verification?.found ? (item.verification?.query || "Matched by verification query") : (item.reason || item.enrichment?.[0] || "")
    }));
  }, [runResult]);
  const runModeLabel = runMode === "full" ? "Full transfer" : "10-record test";
  const plannedRecordLabel = runMode === "full" ? "All available records" : "10 records";

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const disconnectEndpoints = () => {
    setPlan(null);
    setRunResult(null);
    setConnected(false);
    setLiveEvents([]);
    setMovementTick(0);
    setError("");
    setRunMode("test10");
    setStage({ key: "idle", label: "Disconnected", detail: "Source connection cleared from the workspace." });
  };

  const runPlan = async () => {
    if (!pdiInstance?.host || !pdiInstance?.username) {
      setError("PDI destination must be connected before validating.");
      setStage({ key: "error", label: "Planning blocked", detail: "PDI destination session is not ready." });
      return;
    }
    if (!form.sourceUrl || !form.table) {
      setError("Enter the source URL and select a table before validating.");
      setStage({ key: "error", label: "Planning blocked", detail: "Missing source URL or table selection." });
      return;
    }
    if (!form.sourceUser || !form.sourcePassword) {
      setError("Add source credentials before connecting.");
      setStage({ key: "error", label: "Planning blocked", detail: "Source credentials are required for endpoint validation." });
      return;
    }
    setLoadingPlan(true);
    setError("");
    setRunResult(null);
    setConnected(false);
    setStage({ key: "identify", label: "Fields identified", detail: "Inspecting source and target table schemas." });
    try {
      const response = await fetch("/api/servicenow/data-movements/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          targetUrl: resolvedTarget.url,
          targetUser: resolvedTarget.user,
          targetPassword: resolvedTarget.password
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to build field matrix.");
      setPlan(result);
      setConnected(true);
      setMovementTick(0);
      setStage({ key: "mapping", label: "Fields mapping", detail: "Field matrix is ready for review and alignment." });
    } catch (requestError) {
      setError(requestError.message);
      setStage({ key: "error", label: "Planning failed", detail: requestError.message });
    } finally {
      setLoadingPlan(false);
    }
  };

  const runMovement = async () => {
    if (!plan || !pdiInstance?.host) return;
    setLoadingRun(true);
    setError("");
    let succeeded = false;
    setStage({ key: "movement", label: "Data movement", detail: "Staging records and advancing the batch transfer." });
    try {
      const response = await fetch("/api/servicenow/data-movements/run-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        ...form,
        targetUrl: resolvedTarget.url,
        targetUser: resolvedTarget.user,
        targetPassword: resolvedTarget.password,
          plannedRecords: runMode === "full" ? "all" : testBatchSize,
          ireEndpointPath,
          discoverySource,
          fieldMatrix: plan.fieldMatrix,
          irePayloadPreview: plan.irePayloadPreview
        })
      });
      if (!response.ok || !response.body) {
        const fallback = await response.json().catch(() => ({}));
        throw new Error(fallback.error || "Unable to run movement.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.event === "stage") {
            setStage({ key: event.key || "movement", label: event.label || "Running", detail: event.detail || "" });
            setLiveEvents((current) => [...current.slice(-6), event]);
          } else if (event.event === "complete") {
            result = event;
          } else if (event.event === "error") {
            throw new Error(event.error || "Unable to run movement.");
          }
        }
      }
      if (!result) throw new Error("Transfer finished without a completion payload.");
      setRunResult(result);
      setMovementTick(100);
      setStage({ key: "ire", label: "IRE", detail: result.message || "Import Set API executed and transform completed." });
      succeeded = true;
    } catch (requestError) {
      setError(requestError.message);
      setStage({ key: "error", label: "Transfer failed", detail: requestError.message });
    } finally {
      setLoadingRun(false);
      if (succeeded) {
        setStage({ key: "complete", label: "Data moved confirmation", detail: "Movement completed for review and downstream validation." });
      }
    }
  };

  return (
    <section className="snDataMovements" aria-label="Data movements control plane">
      <header className="snDataMovementsHeader">
        <div>
          <span><Layers3 size={20} /></span>
          <div>
            <small>Separate solution</small>
            <strong>Data Movements</strong>
            <p>Move records with a controlled field matrix, live transfer stages, and post-write PDI confirmation.</p>
          </div>
        </div>
        <div className="snDataMovementsBadge">
          <ShieldCheck size={16} />
          <span>Field matrix · IRE · PDI verification</span>
        </div>
      </header>

      <div className="snMovementSummaryBar">
        <div>
          <strong>Source instance</strong>
          <span>{form.sourceUrl ? `${form.sourceUrl.replace(/^https?:\/\//, "")} · ${form.table}` : "Select a source instance and table to begin."}</span>
        </div>
        <div>
          <strong>Destination instance</strong>
          <span>{pdiInstance?.host ? `${pdiInstance.host} · ${pdiInstance?.username ? `via ${pdiInstance.username}` : "connected"}` : "PDI destination session is required."}</span>
        </div>
        <div>
          <strong>Transfer progress</strong>
          <span>{runResult ? `${processedCount} of ${runResult.totalRecords || tableRecordCount} processed · ${runResult.insertedRecords || 0} inserted, ${runResult.updatedRecords || 0} updated, ${runResult.blockedRecords || 0} blocked` : "No transfer run yet."}</span>
        </div>
        <div>
          <strong>PDI verification</strong>
          <span>{verificationDetail ? `${verificationDetail.verified ? "Verified" : "Review required"} · ${verificationDetail.detectedCount} detected / ${verificationDetail.fetchedCount} fetched` : "Counts are checked before movement."}</span>
        </div>
        <div>
          <strong>IRE endpoint</strong>
          <span>{readiness ? `${readiness.ok ? "Ready" : "Blocked"} · ${readiness.status} ${readiness.preview || ""}` : "Endpoint readiness will be checked before transfer."}</span>
        </div>
        <div>
          <strong>Discovery source</strong>
          <span>{discoverySourceValidation ? `${discoverySourceValidation.applied} · ${discoverySourceValidation.note}` : "Discovery source validation is pending."}</span>
        </div>
      </div>

      {error && <div className="snGovernanceError"><ShieldCheck size={17} /><span>{error}</span></div>}

      <div className="snDataMovementsGrid">
        <article className="snDataMovementsCard snDataMovementsStatusRail">
          <div className="snDataMovementsCardTitle">
            <div><Workflow size={16} /><strong>Transfer stages</strong></div>
            <span>Live step indicator</span>
          </div>
          <div className="snTransferStages">
            {[["identify", "1) Destination instance Table API called"],["mapping", "2) Data field mapping"],["movement", "3) Data movement in progress"],["ire", "4) IRE response received"],["complete", "5) Data moved confirmation"]].map(([key, label]) => (
              <div key={key} className={stage.key === key || (key === "mapping" && ["movement", "ire", "complete"].includes(stage.key)) || (key === "movement" && ["ire", "complete"].includes(stage.key)) || (key === "ire" && stage.key === "complete") ? "isActive" : ""}>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="snTransferStageDetail">
            <strong>{stage.label}</strong>
            <span>{stage.detail}</span>
          </div>
        </article>

        <article className="snDataMovementsCard">
          <div className="snDataMovementsCardTitle">
            <div><Database size={16} /><strong>Instance endpoints</strong></div>
            <span>Source to destination</span>
          </div>
          <div className="snMovementForm">
            <div className="snMovementTwoCol snRunModeRow">
              <label>
                <span>Run mode</span>
                <select value={runMode} onChange={(e) => setRunMode(e.target.value)}>
                  <option value="test10">10-record test</option>
                  <option value="full">Full transfer</option>
                </select>
                <small>{runMode === "full" ? "Transfers all detected source records." : "Transfers only the first 10 records for a safe test."}</small>
              </label>
              <div className="snMovementModeSummary">
                <strong>{runModeLabel}</strong>
                <span>{plannedRecordLabel} prepared for the next transfer.</span>
              </div>
            </div>
            <div className="snMovementTwoCol">
              <label>
                <span>Source instance</span>
                <select value={sourcePreset} onChange={(e) => setSourcePreset(e.target.value)}>
                  {Object.entries(SOURCE_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
                </select>
                <small>{SOURCE_PRESETS[sourcePreset]?.description || SOURCE_PRESETS.other.description}</small>
              </label>
              <label>
                <span>Destination instance</span>
                <input value={pdiInstance?.name || "Personal Developer Instance"} readOnly />
                <small>{pdiInstance?.username ? `PDI connected via ${pdiInstance.username}` : "PDI reuses the already established app session."}</small>
              </label>
            </div>
            <label>
              <span>Discovery source</span>
              <select value={discoverySource} onChange={(e) => setDiscoverySource(e.target.value)}>
                <option value="ImportSet">ImportSet</option>
                <option value="Manual via IRE">Manual via IRE</option>
                <option value="Manual Entry">Manual Entry</option>
                <option value="ServiceNow">ServiceNow</option>
              </select>
            </label>
            <label>
              <span>Source URL</span>
              <input value={form.sourceUrl} onChange={(e) => update("sourceUrl", e.target.value)} placeholder="https://source-instance.service-now.com" />
            </label>
            <div className="snMovementTwoCol">
              <label>
                <span>Source user</span>
                <input value={form.sourceUser} onChange={(e) => update("sourceUser", e.target.value)} placeholder="api.user" />
              </label>
              <label>
                <span>Source password</span>
                <input type="password" value={form.sourcePassword} onChange={(e) => update("sourcePassword", e.target.value)} placeholder="????????" />
              </label>
            </div>
            <label>
              <span>Table</span>
              <select value={form.table} onChange={(e) => update("table", e.target.value)}>
                {Object.entries(TABLE_CATALOG).map(([group, items]) => <optgroup key={group} label={group.toUpperCase()}>{items.map(([value, label]) => <option key={value} value={value}>{label} — {value}</option>)}</optgroup>)}
              </select>
            </label>
            <div className="snMovementConnectionState">
              <div className={sourceConnected ? "isReady" : "isPending"}>
                <strong>{sourcePreset === "ga" ? "GA source ready" : sourcePreset === "kkr" ? "KKR source ready" : "Source ready"}</strong>
                <span>{sourceConnected ? `${form.sourceUser} · ${form.sourceUrl.replace(/^https?:\/\//, "")}` : "Add source credentials to start validation."}</span>
              </div>
              <div className={targetConnected ? "isReady" : "isPending"}>
                <strong>PDI destination ready</strong>
                <span>{targetConnected ? `${pdiInstance?.username || "saved session"} · ${pdiInstance?.host || "PDI host"}` : "PDI destination session is required."}</span>
              </div>
            </div>
          </div>
          <div className="snMovementActions">
            <button type="button" onClick={runPlan} disabled={loadingPlan}>
              <RefreshCw size={14} className={loadingPlan ? "isSpinning" : ""} />
              {loadingPlan ? "Reading source..." : runMode === "full" ? "Prepare full transfer" : "Prepare 10 transfer"}
            </button>
            <button type="button" className="primary" onClick={runMovement} disabled={!plan || loadingRun}>
              <Workflow size={14} className={loadingRun ? "isSpinning" : ""} />
              {loadingRun ? "Moving..." : runMode === "full" ? "Run full transfer" : "Run 10 transfer"}
            </button>
            <button type="button" onClick={disconnectEndpoints} disabled={loadingPlan || loadingRun}>
              <Unplug size={14} />
              Disconnect
            </button>
          </div>
        </article>

        <article className="snDataMovementsCard">
          <div className="snDataMovementsCardTitle">
            <div><ArrowRightLeft size={16} /><strong>Field matrix</strong></div>
            <span>{plan ? `${plan.fieldMatrix.mappings.length} mapped fields` : "Awaiting plan"}</span>
          </div>
          <div className="snMovementProgress">
            <div>
              <strong>{mappedPercent}%</strong>
              <span>field alignment</span>
            </div>
            <i><b style={{ width: `${mappedPercent}%` }} /></i>
          </div>
          <div className="snMovementFieldMatrix">
            {plan?.fieldMatrix?.mappings?.length ? plan.fieldMatrix.mappings.slice(0, 16).map((field) => (
              <div key={`${field.source}-${field.target}`}>
                <strong>{field.source}</strong>
                <span>{field.target}</span>
                <small>{field.reason}</small>
              </div>
            )) : <div className="snMovementEmpty">Build the matrix to see mapped fields between source and target.</div>}
          </div>
        </article>

        <article className="snDataMovementsCard">
          <div className="snDataMovementsCardTitle">
            <div><Workflow size={16} /><strong>IRE preview</strong></div>
            <span>{plan?.recommendation || "No preview yet"}</span>
          </div>
          <pre className="snIrePreview">{JSON.stringify(samplePayloadPreview || { message: "No preview available yet." }, null, 2)}</pre>
        </article>

        <article className="snDataMovementsCard">
          <div className="snDataMovementsCardTitle">
            <div><ShieldCheck size={16} /><strong>Movement status</strong></div>
            <span>{runResult ? `${processedCount}/${runResult.totalRecords || tableRecordCount}` : "Idle"}</span>
          </div>
          <div className="snMovementProgress">
            <div>
              <strong>{movementTick || 0}%</strong>
              <span>{runResult ? `${processedCount} of ${runResult.totalRecords || tableRecordCount} processed` : "Awaiting transfer"}</span>
            </div>
            <i><b style={{ width: `${movementTick || 0}%` }} /></i>
          </div>
            <div className="snMovementLog">
              {!runResult ? (
                <div><strong>{loadingPlan ? "Reading source table..." : loadingRun ? "Submitting transfer..." : "Ready"}</strong><span>{loadingPlan ? "Fetching source records and target schema." : loadingRun ? "Pushing the batch to the destination endpoint." : "Waiting for test transfer."}</span></div>
              ) : null}
              {runResult ? (
              <>
                <div><strong>{transferLabel}</strong><span>transfer path</span></div>
                <div><strong>{runResult.totalRecords}</strong><span>records detected</span></div>
                <div><strong>{runResult.transferredRecords || 0}</strong><span>records processed</span></div>
                <div><strong>{runResult.insertedRecords || 0}</strong><span>inserted</span></div>
                <div><strong>{runResult.updatedRecords || 0}</strong><span>updated</span></div>
                <div><strong>{runResult.blockedRecords || 0}</strong><span>blocked</span></div>
                <div><strong>{verifiedCount}</strong><span>verified in PDI</span></div>
                {runResult.transferMode ? <div><strong>{runResult.transferMode}</strong><span>transfer mode</span></div> : null}
                {verificationDetail ? <div><strong>{verificationDetail.note}</strong><span>{verificationDetail.sourceTable} verification</span></div> : null}
                {readiness ? <div><strong>{readiness.ok ? "Endpoint ready" : "Endpoint blocked"}</strong><span>{readiness.status} {readiness.preview || ""}</span></div> : null}
                {discoverySourceValidation ? <div><strong>{discoverySourceValidation.applied}</strong><span>discovery_source applied</span></div> : null}
                {firstBlockedReason ? <div><strong>{firstBlockedReason}</strong><span>first blocked reason</span></div> : null}
                {sampleReasons.length ? <div><strong>{sampleReasons.join(" | ")}</strong><span>sample blocked reasons</span></div> : null}
                <div><strong>{runResult.message}</strong><span>{runResult.sourceUrl} → {runResult.targetUrl}</span></div>
              </>
            ) : <div className="snMovementEmpty">Transfer is waiting for a valid source connection and field matrix.</div>}
            {liveEvents.length ? liveEvents.map((event, index) => (
              <div key={`${event.event}-${index}`}><strong>{event.label}</strong><span>{event.detail}</span></div>
            )) : null}
          </div>
        </article>

        <article className="snDataMovementsCard">
          <div className="snDataMovementsCardTitle">
            <div><ShieldCheck size={16} /><strong>PDI confirmation</strong></div>
            <span>{verifiedRecords.length ? `${verifiedRecords.length} verified` : "Awaiting verification"}</span>
          </div>
          <div className="snCompactTable">
            {verifiedRecords.length ? verifiedRecords.map((record) => (
              <div key={`${record.sys_id}-${record.recordNumber}`} className="snCompactTableRow">
                <strong>{record.recordNumber}</strong>
                <span>{record.name || record.serial_number || record.sys_id || "Verified record"}</span>
                <span>{record.serial_number ? `Serial ${record.serial_number}` : record.sys_id ? `Sys ID ${record.sys_id}` : "Matched"}</span>
              </div>
            )) : (
              <div className="snMovementEmpty">No verified PDI records yet. Run a transfer to confirm exact inserted rows.</div>
            )}
          </div>
        </article>

        <article className="snDataMovementsCard">
          <div className="snDataMovementsCardTitle">
            <div><Database size={16} /><strong>Raw PDI response</strong></div>
            <span>{rawIreResponse ? "Captured from backend" : "No response yet"}</span>
          </div>
          <div className="snCompactTable">
            {responseRows.length ? responseRows.map((row) => (
              <div className="snCompactTableRow" key={`${row.index}-${row.sysId}`}>
                <strong>{row.index}</strong>
                <span>{row.operation}</span>
                <span>{row.sysId || row.status}</span>
                <small>{row.detail || row.status}</small>
              </div>
            )) : (
              <div className="snMovementEmpty">Run a transfer to capture the structured PDI response.</div>
            )}
          </div>
        </article>

        <article className="snDataMovementsCard">
          <div className="snDataMovementsCardTitle">
            <div><ShieldCheck size={16} /><strong>Migration plan</strong></div>
            <span>{runModeLabel}</span>
          </div>
          <div className="snMovementConnectionState snMovementConnectionStateCompact">
            <div className="isReady">
              <strong>{plannedRecordLabel}</strong>
              <span>{runMode === "full" ? "All matching source rows are queued." : "Only the first 10 records are queued for the test run."}</span>
            </div>
            <div className={verifiedRecords.length ? "isReady" : "isPending"}>
              <strong>{verifiedRecords.length ? `${verifiedRecords.length} verified in PDI` : "PDI verification pending"}</strong>
              <span>{verifiedRecords.length ? "Destination confirmation received." : "Run a transfer to confirm exact destination rows."}</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
