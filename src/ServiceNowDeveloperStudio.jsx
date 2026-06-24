import {
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  Code2,
  FileCode2,
  GitCommitHorizontal,
  ListChecks,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  WandSparkles,
  X
} from "lucide-react";
import { useEffect, useState } from "react";

const ARTIFACT_TYPES = [
  ["business_rule", "Business Rules"],
  ["client_script", "Client Scripts"],
  ["script_include", "Script Includes"],
  ["ui_action", "UI Actions"],
  ["fix_script", "Fix Scripts"]
];

export function ServiceNowDeveloperStudio({ instanceId }) {
  const [type, setType] = useState("business_rule");
  const [name, setName] = useState("");
  const [table, setTable] = useState("incident");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [script, setScript] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState({ tone: "idle", text: "Search for a development artifact to begin." });
  const [commit, setCommit] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiProposal, setAiProposal] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [copilotCommand, setCopilotCommand] = useState("");
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotWorkflow, setCopilotWorkflow] = useState([]);
  const [artifactOperation, setArtifactOperation] = useState("modify");
  const [configuration, setConfiguration] = useState({});

  useEffect(() => {
    clearSession();
  }, [instanceId]);

  const clearSession = () => {
    setResults([]);
    setSelected(null);
    setScript("");
    setDescription("");
    setCommit(null);
    setAiInstruction("");
    setAiProposal(null);
    setCopilotCommand("");
    setCopilotWorkflow([]);
    setArtifactOperation("modify");
    setConfiguration({});
    setStatus({ tone: "idle", text: "Search for a development artifact to begin." });
  };

  const changeType = (nextType) => {
    setType(nextType);
    setResults([]);
    setSelected(null);
    setScript("");
    setDescription("");
    setCommit(null);
    setAiProposal(null);
    setCopilotWorkflow([]);
    setArtifactOperation("modify");
    setConfiguration({});
    setStatus({ tone: "idle", text: `Search ${artifactLabel(nextType)} metadata or use Developer Copilot.` });
  };

  const runCopilot = async (event) => {
    event?.preventDefault();
    if (!copilotCommand.trim()) return;
    setCopilotBusy(true);
    setCommit(null);
    setAiProposal(null);
    setCopilotWorkflow([
      { id: "interpret", label: "Interpret command", status: "active", detail: "Extracting artifact, table, and requested change." },
      { id: "locate", label: "Resolve artifact", status: "waiting", detail: "Will locate an existing artifact or check for duplicates when creating." },
      { id: "inspect", label: "Analyse requirements", status: "waiting", detail: "Waiting for command interpretation." },
      { id: "refactor", label: "Generate logic", status: "waiting", detail: "Waiting for requirement analysis." },
      { id: "verify", label: "Verify proposal", status: "waiting", detail: "Waiting for refactor." },
      { id: "save", label: "ServiceNow save", status: "waiting", detail: "Always requires explicit confirmation." }
    ]);
    setStatus({ tone: "running", text: "Developer Copilot is interpreting the request and inspecting ServiceNow metadata..." });
    try {
      const response = await fetch("/api/servicenow/developer/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance: instanceId, command: copilotCommand })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Developer Copilot failed.");

      const artifact = result.artifact;
      const operation = result.operation || result.intent.operation || "modify";
      setType(result.intent.artifactType);
      setArtifactOperation(operation);
      setName(artifact.name || result.intent.artifactName);
      setTable(result.intent.table || artifact.collection || artifact.table || "");
      setResults(operation === "create" ? [] : [artifact]);
      setSelected({ ...artifact, sourceHash: result.originalHash });
      setScript(result.proposal.proposedScript);
      setDescription(result.proposal.proposedDescription);
      setConfiguration(result.configuration || result.proposal.configuration || artifact.configuration || {});
      setAiInstruction(result.intent.instruction);
      setAiProposal(result);
      setCopilotWorkflow(result.workflow || []);
      setStatus({
        tone: result.checks?.passed ? "success" : "error",
        text: result.checks?.passed
          ? operation === "create"
            ? `New ${artifactLabel(result.intent.artifactType)} "${artifact.name}" was generated and verified locally. Review it before confirming creation.`
            : `${artifact.name} was located, inspected, refactored, and verified. The proposal is local only and ready for your save review.`
          : `${artifact.name} has blocking verification failures and cannot be saved.`
      });
    } catch (error) {
      setCopilotWorkflow((steps) => steps.map((step) =>
        step.status === "active"
          ? { ...step, status: "failed", detail: error.message }
          : step
      ));
      setStatus({ tone: "error", text: error.message });
    } finally {
      setCopilotBusy(false);
    }
  };

  const search = async (event) => {
    event?.preventDefault();
    setBusy(true);
    setStatus({ tone: "running", text: `Searching ${artifactLabel(type)} on the connected instance…` });
    try {
      const params = new URLSearchParams({ instance: instanceId, type, q: name, table });
      const response = await fetch(`/api/servicenow/developer/artifacts?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Artifact search failed.");
      setResults(result.artifacts || []);
      setStatus({
        tone: "success",
        text: `Found ${result.artifacts?.length || 0} ${String(result.label || "artifacts").toLowerCase()}. No changes made.`
      });
    } catch (error) {
      setStatus({ tone: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  };

  const openArtifact = async (artifact) => {
    setBusy(true);
    setStatus({ tone: "running", text: `Loading ${artifact.name} source and metadata…` });
    try {
      const response = await fetch(`/api/servicenow/developer/artifacts/${type}/${artifact.sys_id}?instance=${encodeURIComponent(instanceId)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load artifact.");
      setSelected({ ...result.record, sourceHash: result.sourceHash });
      setScript(result.record.script || "");
      setDescription(result.record.description || "");
      setArtifactOperation("modify");
      setConfiguration({});
      setCommit(null);
      setAiProposal(null);
      setStatus({
        tone: "success",
        text: `Loaded ${result.record.name}. Editing is local until Save is explicitly confirmed.`
      });
    } catch (error) {
      setStatus({ tone: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setConfirmOpen(false);
    setBusy(true);
    const isCreate = artifactOperation === "create" || selected?.isNew;
    setStatus({
      tone: "running",
      text: `${isCreate ? "Creating" : "Saving"} and verifying ${selected.name} on ServiceNow...`
    });
    setStatus({ tone: "running", text: `Saving and verifying ${selected.name} on ServiceNow…` });
    try {
      setStatus({
        tone: "running",
        text: `${isCreate ? "Creating" : "Saving"} and verifying ${selected.name} on ServiceNow...`
      });
      const endpoint = isCreate
        ? `/api/servicenow/developer/artifacts/${type}?instance=${encodeURIComponent(instanceId)}`
        : `/api/servicenow/developer/artifacts/${type}/${selected.sys_id}?instance=${encodeURIComponent(instanceId)}`;
      const response = await fetch(endpoint, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isCreate
          ? {
              name: selected.name,
              table: selected.collection || selected.table || "",
              script,
              description,
              configuration,
              confirmation: "CONFIRM_CREATE"
            }
          : {
              script,
              description,
              expectedUpdatedOn: selected.sys_updated_on,
              confirmation: "CONFIRM_SAVE"
            })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Save failed.");
      setCommit(result);
      setSelected((current) => isCreate
        ? {
            ...current,
            ...(result.record || {}),
            isNew: false,
            script,
            description,
            sys_id: result.artifact.sysId,
            sourceHash: result.after.sourceHash
          }
        : {
            ...current,
            script,
            description,
            sys_updated_on: result.after.updatedOn,
            sys_updated_by: result.after.updatedBy,
            sourceHash: result.after.sourceHash
          });
      if (isCreate) {
        setArtifactOperation("modify");
        setResults(result.record ? [result.record] : []);
      }
      setStatus({
        tone: result.verified ? "success" : "error",
        text: result.verified
          ? `${isCreate ? "Created" : "Committed"} and read-back verified: ${result.artifact.name}.`
          : "ServiceNow responded, but read-back verification did not match."
      });
      setCopilotWorkflow((steps) => steps.map((step) =>
        step.id === "save"
          ? {
              ...step,
              status: result.verified ? "completed" : "failed",
              detail: result.verified
                ? `${isCreate ? "Created" : "Committed"} ${result.committedAt} and read-back verified.`
                : "The write completed but read-back verification did not match."
            }
          : step
      ));
    } catch (error) {
      setStatus({ tone: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  };

  const requestAiRefactor = async () => {
    if (!selected || !aiInstruction.trim()) return;
    setAiBusy(true);
    setAiProposal(null);
    setStatus({ tone: "running", text: `OpenAI is reviewing ${selected.name} and preparing a safe proposal…` });
    try {
      const response = await fetch("/api/servicenow/developer/ai-refactor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactType: type,
          name: selected.name,
          table: selected.collection || selected.table || selected.api_name || "",
          description,
          script,
          instruction: aiInstruction
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "OpenAI refactoring failed.");
      setAiProposal(result);
      setStatus({
        tone: result.checks?.passed ? "success" : "error",
        text: result.checks?.passed
          ? `OpenAI proposal ready. Review it before applying to the editor. Model: ${result.model}.`
          : "OpenAI proposal returned, but one or more static checks failed."
      });
    } catch (error) {
      setStatus({ tone: "error", text: error.message });
    } finally {
      setAiBusy(false);
    }
  };

  const applyAiProposal = () => {
    if (!aiProposal?.proposal || aiProposal.checks?.blocking) return;
    setScript(aiProposal.proposal.proposedScript);
    setDescription(aiProposal.proposal.proposedDescription);
    setStatus({
      tone: "success",
      text: "AI proposal applied to the local editor. ServiceNow has not been changed; use Review & save when ready."
    });
  };

  const discardAiProposal = () => {
    if (selected && aiProposal?.proposal && script === aiProposal.proposal.proposedScript) {
      setScript(selected.script || "");
      setDescription(selected.description || "");
    }
    setAiProposal(null);
    setCopilotWorkflow((steps) => steps.map((step) =>
      ["refactor", "verify", "save"].includes(step.id)
        ? { ...step, status: "waiting", detail: "Proposal discarded. Run Copilot again to prepare a new change." }
        : step
    ));
    setStatus({ tone: "idle", text: "AI proposal discarded. ServiceNow was not changed." });
  };

  const dirty = Boolean(selected) && (
    selected.isNew
    || script !== (selected.script || "")
    || description !== (selected.description || "")
  );

  return (
    <section className="snDevStudio" aria-label="ServiceNow developer studio">
      <div className="snDevStudioHeader">
        <div>
          <span><Code2 size={17} /></span>
          <div>
            <small>Advanced development area</small>
            <strong>ServiceNow Developer Studio</strong>
            <p>Find, inspect, edit, confirm, and verify server-side metadata changes.</p>
          </div>
        </div>
        <div className="snDevHeaderActions">
          <div className={`snDevStatus ${status.tone}`}>
            <TerminalSquare size={16} />
            <span>{status.text}</span>
          </div>
          <button type="button" onClick={clearSession} disabled={busy || aiBusy || copilotBusy}>
            <RotateCcw size={14} />
            Clear session
          </button>
        </div>
      </div>

      <section className="snCopilot" aria-label="Developer Copilot">
        <div className="snCopilotIntro">
          <span><Bot size={20} /></span>
          <div>
            <small>Natural-language orchestration</small>
            <strong>Developer Copilot</strong>
            <p>Create new logic or locate, inspect, refactor, and verify existing ServiceNow artifacts.</p>
          </div>
          <div className="snCopilotGuardrail">
            <ShieldAlert size={15} />
            <span>No ServiceNow write occurs until you confirm the final save.</span>
          </div>
        </div>
        <form className="snCopilotCommand" onSubmit={runCopilot}>
          <textarea
            value={copilotCommand}
            onChange={(event) => setCopilotCommand(event.target.value)}
            rows={3}
            disabled={copilotBusy}
            placeholder={'Example: Create a new Business Rule named "Laptop Model information" on cmdb_ci_computer for insert and update, then verify and prepare it for creation.'}
          />
          <button type="submit" disabled={!copilotCommand.trim() || copilotBusy}>
            <Sparkles size={17} />
            {copilotBusy ? "Copilot working..." : "Run end-to-end"}
          </button>
        </form>
        {copilotWorkflow.length > 0 && (
          <div className="snCopilotWorkflow" aria-label="Copilot workflow status">
            {copilotWorkflow.map((step, index) => (
              <div key={step.id} className={`snCopilotStep ${step.status}`}>
                <i>{step.status === "completed" ? <CheckCircle2 size={14} /> : index + 1}</i>
                <p><strong>{step.label}</strong><span>{step.detail}</span></p>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="snDevTypeTabs" role="tablist" aria-label="Development artifact types">
        {ARTIFACT_TYPES.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={type === value} className={type === value ? "active" : ""} onClick={() => changeType(value)}>
            {value === "business_rule" ? <Braces size={15} /> : <FileCode2 size={15} />}
            {label}
          </button>
        ))}
      </div>

      <form className="snDevSearch" onSubmit={search}>
        <label>
          <span>Artifact name</span>
          <div><Search size={15} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Add info messages for incident closure" required /></div>
        </label>
        {artifactRequiresTable(type) && (
          <label>
            <span>Table</span>
            <input value={table} onChange={(event) => setTable(event.target.value)} placeholder="incident" />
          </label>
        )}
        <button type="submit" disabled={busy}>Search metadata</button>
      </form>

      <section className={`snAiWorkbench ${selected ? "ready" : "disabled"}`} aria-label="OpenAI refactoring workbench">
        <div className="snAiWorkbenchTitle">
          <span><Sparkles size={17} /></span>
          <div>
            <small>OpenAI powered</small>
            <strong>AI refactor, review and verification</strong>
            <p>Describe the outcome you want. AI creates a proposal only—it never saves directly to ServiceNow.</p>
          </div>
        </div>
        <div className="snAiPromptRow">
          <textarea
            value={aiInstruction}
            onChange={(event) => setAiInstruction(event.target.value)}
            placeholder={selected
              ? "Example: Refactor this Business Rule for readability, add professional comments and safe debug logs, preserve all existing behavior."
              : "Load a development artifact before requesting an AI refactor."}
            disabled={!selected || aiBusy}
            rows={3}
          />
          <button type="button" onClick={requestAiRefactor} disabled={!selected || !aiInstruction.trim() || aiBusy}>
            <WandSparkles size={17} />
            {aiBusy ? "OpenAI reviewing…" : "Generate proposal"}
          </button>
        </div>
        {aiProposal && (
          <div className="snAiProposal">
            <div className="snAiProposalSummary">
              <div><span>Proposal summary</span><strong>{aiProposal.proposal.summary}</strong></div>
              <div className={`snAiConfidence confidence-${aiProposal.proposal.confidence}`}>
                {aiProposal.proposal.confidence} confidence
              </div>
            </div>
            <div className="snAiReviewGrid">
              <AiReviewList title="Proposed changes" items={aiProposal.proposal.changes} />
              <AiReviewList title="Risks" items={aiProposal.proposal.risks} />
              <AiReviewList title="Verification plan" items={aiProposal.proposal.testPlan} />
              <div className="snAiChecks">
                <span>Automated checks</span>
                {aiProposal.checks.items.map((check) => (
                  <div key={check.id} className={`check-${check.status}`}>
                    <i />
                    <p><strong>{check.label}</strong><small>{check.detail}</small></p>
                  </div>
                ))}
              </div>
            </div>
            <div className="snAiProposalActions">
              <div>
                <span>Model</span>
                <strong>{aiProposal.model}</strong>
                <small>Proposal hash: {aiProposal.proposalHash.slice(0, 12)}…</small>
              </div>
              <button type="button" onClick={discardAiProposal}>Discard proposal</button>
              <button
                type="button"
                onClick={applyAiProposal}
                disabled={aiProposal.checks.blocking || script === aiProposal.proposal.proposedScript}
              >
                {script === aiProposal.proposal.proposedScript ? "Applied to editor" : "Apply to local editor"}
              </button>
            </div>
          </div>
        )}
      </section>

      {selected && dirty && (
        <section className="snChangeReview" aria-label="Prepared change review">
          <div className="snChangeReviewHeader">
            <div>
              <span><ListChecks size={17} /></span>
              <div>
                <small>{selected.isNew ? "New artifact draft - not yet created" : "Prepared change - not yet saved"}</small>
                <strong>{selected.isNew ? "Creation payload and proposed source" : "Before and proposed source"}</strong>
                <p>Review the exact local proposal before opening the final confirmation.</p>
              </div>
            </div>
            <div>
              <span>{selected.isNew ? "Current record" : "Current hash"}</span>
              <code>{selected.isNew ? "Does not exist" : selected.sourceHash?.slice(0, 12) || "unavailable"}</code>
              <span>Proposed hash</span>
              <code>{aiProposal?.proposalHash?.slice(0, 12) || "manual edit"}</code>
            </div>
          </div>
          {selected.isNew && (
            <div className="snCreationMetadata">
              <div><span>Artifact</span><strong>{artifactLabel(type)}</strong></div>
              <div><span>Name</span><strong>{selected.name}</strong></div>
              <div><span>Target</span><strong>{selected.collection || selected.table || "Global"}</strong></div>
              {Object.entries(configuration).map(([field, value]) => (
                <div key={field}><span>{formatMetadataLabel(field)}</span><strong>{String(value)}</strong></div>
              ))}
            </div>
          )}
          {description !== (selected.description || "") && (
            <div className="snDescriptionDiff">
              <div><span>Current description</span><p>{selected.description || "No description"}</p></div>
              <div><span>Proposed description</span><p>{description || "No description"}</p></div>
            </div>
          )}
          <div className="snSourceDiff">
            <div><span>{selected.isNew ? "Current ServiceNow source - no record" : "Current ServiceNow source"}</span><pre>{selected.script || "// New artifact: no existing source."}</pre></div>
            <div><span>Proposed local source</span><pre>{script}</pre></div>
          </div>
        </section>
      )}

      <div className="snDevWorkspace">
        <aside className="snArtifactResults">
          <div><span>Search results</span><strong>{results.length}</strong></div>
          {results.map((artifact) => (
            <button key={artifact.sys_id} type="button" className={selected?.sys_id === artifact.sys_id ? "active" : ""} onClick={() => openArtifact(artifact)}>
              <div>
                <strong>{artifact.name}</strong>
                <span>{artifact.collection || artifact.table || artifact.api_name || "Global"}</span>
                <small>{artifact.active === "true" || artifact.active === true ? "Active" : "Inactive"} · Updated {artifact.sys_updated_on || "—"}</small>
              </div>
              <ChevronRight size={15} />
            </button>
          ))}
          {!results.length && <p>Use search for existing artifacts, or describe a new artifact in Developer Copilot.</p>}
        </aside>

        <div className="snCodeWorkspace">
          {selected ? (
            <>
              <div className="snCodeHeader">
                <div><span>{selected.isNew ? `New ${artifactLabel(type)}` : artifactLabel(type)}</span><strong>{selected.name}</strong><small>{selected.isNew ? "Draft only - no sys_id assigned" : `sys_id: ${selected.sys_id}`}</small></div>
                <div><span>Last updated</span><strong>{selected.sys_updated_on || "—"}</strong><small>by {selected.sys_updated_by || "—"}</small></div>
                <button type="button" onClick={() => setConfirmOpen(true)} disabled={!dirty || busy}>
                  <GitCommitHorizontal size={16} /> {selected.isNew ? "Review & create" : "Review & save"}
                </button>
              </div>
              <label className="snDescriptionEditor">
                <span>Technical description</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
              </label>
              <label className="snScriptEditor">
                <span>Script source</span>
                <textarea value={script} onChange={(event) => setScript(event.target.value)} spellCheck="false" />
              </label>
            </>
          ) : (
            <div className="snCodeEmpty">
              <Code2 size={28} />
              <strong>No artifact selected</strong>
              <span>Search and open a result to inspect its source.</span>
            </div>
          )}
        </div>
      </div>

      <CommitOutput commit={commit} />

      {confirmOpen && (
        <div className="snDialogBackdrop">
          <section className="snSaveDialog" role="dialog" aria-modal="true" aria-labelledby="save-artifact-title">
            <div><ShieldAlert size={22} /><button type="button" onClick={() => setConfirmOpen(false)} aria-label="Close save confirmation"><X size={17} /></button></div>
            <h2 id="save-artifact-title">{selected.isNew ? "Confirm new ServiceNow artifact" : "Confirm ServiceNow metadata change"}</h2>
            <p>This will {selected.isNew ? "create" : "update"} <strong>{selected.name}</strong> on the currently connected instance.</p>
            <dl>
              <div><dt>Artifact</dt><dd>{artifactLabel(type)}</dd></div>
              <div><dt>Table</dt><dd>{selected.collection || selected.table || selected.api_name || "Global"}</dd></div>
              <div><dt>{selected.isNew ? "Operation" : "Changed fields"}</dt><dd>{selected.isNew ? "Insert new metadata record" : [script !== selected.script ? "script" : "", description !== selected.description ? "description" : ""].filter(Boolean).join(", ")}</dd></div>
              {selected.isNew && Object.entries(configuration).map(([field, value]) => (
                <div key={field}><dt>{formatMetadataLabel(field)}</dt><dd>{String(value)}</dd></div>
              ))}
            </dl>
            <div className="snSaveDialogActions">
              <button type="button" onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button type="button" onClick={save}>{selected.isNew ? "Confirm create and verify" : "Confirm save and verify"}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function CommitOutput({ commit }) {
  return (
    <section className={`snCommitOutput ${commit ? "hasCommit" : ""}`} aria-label="Commit output">
      <div className="snCommitTitle">
        {commit ? <CheckCircle2 size={18} /> : <GitCommitHorizontal size={18} />}
        <div><span>Commit output</span><strong>{commit ? "Verified ServiceNow change" : "No changes committed in this session"}</strong></div>
      </div>
      {commit ? (
        <div className="snCommitGrid">
          <div><span>Artifact</span><strong>{commit.artifact.name}</strong><small>{commit.artifact.table} · {commit.artifact.sysId}</small></div>
          <div><span>Changed fields</span><strong>{commit.changedFields.join(", ") || "None"}</strong><small>Read-back verified: {commit.verified ? "Yes" : "No"}</small></div>
          <div><span>Committed by</span><strong>{commit.after.updatedBy}</strong><small>{commit.after.updatedOn}</small></div>
          <div><span>Update set</span><strong>{commit.updateSet?.captured ? commit.updateSet.updateSet : "Not available"}</strong><small>{commit.updateSet?.reason || commit.updateSet?.name || "Captured metadata"}</small></div>
          <div className="snHashOutput"><span>Source hash</span><code>{commit.after.sourceHash}</code><small>Previous: {commit.before.sourceHash}</small></div>
        </div>
      ) : (
        <p>Confirmed saves will appear here with changed fields, user, timestamp, verification state, source hashes, and update-set capture details.</p>
      )}
    </section>
  );
}

function AiReviewList({ title, items = [] }) {
  return (
    <div className="snAiReviewList">
      <span>{title}</span>
      {items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None identified.</p>}
    </div>
  );
}

function artifactLabel(type) {
  return ARTIFACT_TYPES.find(([value]) => value === type)?.[1]?.replace(/s$/, "") || "Artifact";
}

function artifactRequiresTable(type) {
  return ["business_rule", "client_script", "ui_action"].includes(type);
}

function formatMetadataLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
