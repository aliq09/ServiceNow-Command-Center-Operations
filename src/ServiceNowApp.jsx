import { ShieldCheck, Layers3 } from "lucide-react";
import { ServiceNowDashboard } from "./ServiceNowDashboard";

export function ServiceNowApp() {
  return (
    <main className="snStandaloneApp mode-incidents">
      <header className="snStandaloneHeader">
        <a className="snBrand" href="/servicenow" aria-label="ServiceNow Operations home">
          <span><Layers3 size={22} /></span>
          <div>
            <strong>ServiceNow Command Center Operations</strong>
            <small>Operational intelligence hub</small>
          </div>
        </a>
        <div className="snStandaloneStatus">
          <ShieldCheck size={16} />
          Credentials protected server-side
        </div>
      </header>
      <div className="snStandaloneContent">
        <ServiceNowDashboard />
      </div>
    </main>
  );
}
