import React from "react";
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
        <ServiceNowErrorBoundary>
          <ServiceNowDashboard />
        </ServiceNowErrorBoundary>
      </div>
    </main>
  );
}

class ServiceNowErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="snError snErrorFatal" role="alert">
          <ShieldCheck size={18} />
          <div>
            <strong>ServiceNow app failed to render</strong>
            <span>{this.state.error?.message || "A client-side error stopped the dashboard from loading."}</span>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
