import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Database,
  RefreshCw,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { useEffect, useState } from "react";

const RECORD_TYPES = [
  ["incidents", "Incidents"],
  ["problems", "Problems"],
  ["changes", "Changes"],
  ["requests", "Requests"],
  ["cis", "All CIs"],
  ["computers", "Computers"],
  ["servers", "Servers"],
  ["assets", "Assets (alm_asset)"]
];
const PAGE_SIZES = [10, 20, 50, 100];

export function UnifiedRecordExplorer({ instanceId }) {
  const [type, setType] = useState("incidents");
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (signal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        instance: instanceId,
        type,
        page: String(page),
        pageSize: String(pageSize),
        q: committedQuery
      });
      const response = await fetch(`/api/servicenow/records?${params}`, { signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load records.");
      setData(result);
    } catch (requestError) {
      if (requestError.name !== "AbortError") setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [committedQuery, instanceId, page, pageSize, type]);

  const changeType = (nextType) => {
    setType(nextType);
    setPage(1);
    setQuery("");
    setCommittedQuery("");
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setPage(1);
    setCommittedQuery(query.trim());
  };

  return (
    <section className="snRecordExplorer" aria-label="ServiceNow record explorer">
      <div className="snExplorerHeader">
        <div className="snExplorerTitle">
          <span><Database size={17} /></span>
          <div>
            <small>Unified data explorer</small>
            <strong>{data?.label || "ServiceNow records"}</strong>
            <p>Search and page through ITSM, CMDB, and asset records.</p>
          </div>
        </div>
        <div className="snDatasetTabs" role="tablist" aria-label="Record datasets">
          {RECORD_TYPES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={type === value}
              className={type === value ? "active" : ""}
              onClick={() => changeType(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="snExplorerToolbar">
        <form className="snExplorerSearch" onSubmit={submitSearch}>
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${String(data?.label || "records").toLowerCase()}…`}
          />
          <button type="submit">Search</button>
        </form>
        <label className="snPageSize">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            aria-label="Records per page"
          >
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button type="button" className="snExplorerRefresh" onClick={() => load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? "isSpinning" : ""} />
          Refresh
        </button>
      </div>

      {error && <div className="snExplorerError" role="alert">{error}</div>}

      <div className="snGenericTableWrap">
        <table className="snGenericTable">
          <thead>
            <tr>
              {(data?.columns || []).map((column) => <th key={column.key}>{column.label}</th>)}
              <th><span className="srOnly">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {(data?.records || []).map((record) => (
              <tr key={record.sysId}>
                {(data?.columns || []).map((column, index) => (
                  <td key={column.key}>
                    {index === 0 ? (
                      <a className="snRecordPrimary" href={record.url} target="_blank" rel="noreferrer">
                        {displayValue(record[column.key]) || "—"}
                      </a>
                    ) : (
                      <span className={column.key === "priority" ? `snInlinePriority priority-${priorityTone(record[column.key])}` : ""}>
                        {displayValue(record[column.key]) || "—"}
                      </span>
                    )}
                  </td>
                ))}
                <td>
                  <a className="snOpenButton" href={record.url} target="_blank" rel="noreferrer" aria-label={`Open ${data?.singular || "record"} in ServiceNow`}>
                    <ArrowUpRight size={15} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !data?.records?.length && (
          <div className="snEmptyState">
            <SlidersHorizontal size={23} />
            <strong>No {String(data?.label || "records").toLowerCase()} found</strong>
            <span>Change the dataset or search text.</span>
          </div>
        )}
      </div>

      <footer className="snPagination">
        <div>
          <strong>{data?.singular || "Record"} {data?.rangeStart || 0}–{data?.rangeEnd || 0}</strong>
          <span>of {Number(data?.total || 0).toLocaleString("en-GB")}</span>
        </div>
        <div className="snPageControls">
          <button type="button" onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1 || loading} aria-label="Previous page">
            <ChevronLeft size={16} />
          </button>
          <span>Page <strong>{data?.page || page}</strong> of <strong>{data?.totalPages || 1}</strong></span>
          <button type="button" onClick={() => setPage((current) => current + 1)} disabled={page >= (data?.totalPages || 1) || loading} aria-label="Next page">
            <ChevronRight size={16} />
          </button>
        </div>
      </footer>
    </section>
  );
}

function displayValue(value) {
  if (value && typeof value === "object") return value.display_value || value.value || "";
  return String(value ?? "");
}

function priorityTone(value) {
  const text = displayValue(value);
  if (text.startsWith("1")) return "critical";
  if (text.startsWith("2")) return "high";
  if (text.startsWith("3")) return "moderate";
  return "low";
}
