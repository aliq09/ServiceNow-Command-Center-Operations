import {
  TicketCheck,
  Layers3,
  Navigation,
  Lightbulb,
  Database,
  Zap,
  Share2,
  BookOpen
} from "lucide-react";

export const MODULES = [
  {
    id: "overview",
    label: "Overview",
    icon: TicketCheck,
    title: "Dashboard overview"
  },
  {
    id: "discovery",
    label: "Discovery",
    icon: Navigation,
    title: "Hardware discovery"
  },
  {
    id: "sam",
    label: "SAM Pro",
    icon: PackageCheckIcon,
    title: "Software asset management"
  },
  {
    id: "csdm",
    label: "CSDM",
    icon: Layers3,
    title: "Configuration & service data model"
  },
  {
    id: "governance",
    label: "Governance",
    icon: Lightbulb,
    title: "Data governance"
  },
  {
    id: "dataMovements",
    label: "Data Movements",
    icon: Share2,
    title: "Data flow tracking"
  },
  {
    id: "computerIntelligence",
    label: "Intelligence",
    icon: Zap,
    title: "Computer intelligence"
  },
  {
    id: "recordExplorer",
    label: "Record Explorer",
    icon: Database,
    title: "Unified record browser"
  },
  {
    id: "developerStudio",
    label: "Dev Studio",
    icon: BookOpen,
    title: "Developer tools"
  }
];

function PackageCheckIcon(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7 16.5V7.5A2.5 2.5 0 0 1 9.5 5h5A2.5 2.5 0 0 1 17 7.5v9" />
      <path d="M16 12h4" />
      <path d="M16 16h4" />
      <path d="M3 12h4" />
      <path d="M3 16h4" />
    </svg>
  );
}

export function ModuleNav({ activeModule, onSelectModule }) {
  return (
    <nav className="snModuleNavigation" role="navigation" aria-label="ServiceNow modules">
      <div className="snModuleNavHeader">
        <span>Modules</span>
      </div>
      <div className="snModuleNavList">
        {MODULES.map((module) => {
          const Icon = module.icon;
          return (
            <button
              key={module.id}
              className={`snModuleNavItem ${activeModule === module.id ? "isActive" : ""}`}
              onClick={() => onSelectModule(module.id)}
              title={module.title}
              aria-label={module.title}
              aria-current={activeModule === module.id ? "page" : undefined}
            >
              <Icon size={16} className="snModuleNavIcon" />
              <span className="snModuleNavLabel">{module.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function ModuleBreadcrumb({ currentModule }) {
  const module = MODULES.find((m) => m.id === currentModule);
  if (!module) return null;

  return (
    <div className="snModuleBreadcrumb" role="navigation" aria-label="Current section">
      <span className="snBreadcrumbItem">
        <module.icon size={14} />
        {module.label}
      </span>
    </div>
  );
}
