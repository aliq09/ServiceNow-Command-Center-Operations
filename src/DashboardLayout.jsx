import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Search,
  Settings2,
  Database,
  GitBranch,
  Shield,
  BarChart3,
  Zap,
  Code2,
  Eye,
  Server
} from "lucide-react";

const MODULE_NAVIGATION = [
  { id: "overview", label: "Overview", icon: LayoutGrid, description: "Dashboard & metrics" },
  { id: "discovery", label: "Discovery", icon: Search, description: "Asset discovery" },
  { id: "sam", label: "SAM Pro", icon: BarChart3, description: "Software licensing" },
  { id: "csdm", label: "CSDM", icon: Database, description: "Config management" },
  { id: "governance", label: "Governance", icon: Shield, description: "Controls & compliance" },
  { id: "dataMovements", label: "Data Movements", icon: GitBranch, description: "Change tracking" },
  { id: "computerIntelligence", label: "Intelligence", icon: Zap, description: "AI insights" },
  { id: "explorer", label: "Record Explorer", icon: Eye, description: "Data browser" },
  { id: "studio", label: "Dev Studio", icon: Code2, description: "Development" }
];

export function DashboardLayout({ children, currentModule = "overview", onSelectModule }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <div className="snDashboardLayout">
      {/* Left Sidebar Navigation */}
      <aside className={`snModuleSidebar ${sidebarCollapsed ? "is-collapsed" : ""}`}>
        <div className="snSidebarHeader">
          <button
            className="snSidebarToggle"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand" : "Collapse"}
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          {!sidebarCollapsed && (
            <div className="snSidebarTitle">
              <Settings2 size={16} />
              <span>Modules</span>
            </div>
          )}
        </div>

        <nav className="snModuleNav">
          {MODULE_NAVIGATION.map((module) => {
            const Icon = module.icon;
            const isActive = currentModule === module.id;
            return (
              <button
                key={module.id}
                type="button"
                className={`snModuleNavItem ${isActive ? "is-active" : ""}`}
                title={module.label}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelectModule?.(module.id)}
              >
                <span className="snModuleIcon">
                  <Icon size={18} />
                </span>
                {!sidebarCollapsed && (
                  <div className="snModuleLabel">
                    <strong>{module.label}</strong>
                    <small>{module.description}</small>
                  </div>
                )}
              </button>
            );
          })}
        </nav>

        <div className="snSidebarFooter">
          {!sidebarCollapsed && (
            <div className="snSidebarHint">
              <small>Tip: Click to navigate between modules and views</small>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="snDashboardMain">
        {children}
      </div>
    </div>
  );
}
