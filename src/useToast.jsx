import { useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "info", duration = 3000) => {
    const id = Date.now();
    const toast = { id, message, type, timestamp: Date.now() };

    setToasts((current) => [...current, toast]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, removeToast };
}

export function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="snToastContainer" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function Toast({ toast, onRemove }) {
  const getIcon = () => {
    switch (toast.type) {
      case "success":
        return <CheckCircle2 size={18} />;
      case "error":
        return <AlertCircle size={18} />;
      case "info":
      default:
        return <Info size={18} />;
    }
  };

  return (
    <div className={`snToast snToast-${toast.type}`} role="alert">
      <div className="snToastIcon">{getIcon()}</div>
      <span className="snToastMessage">{toast.message}</span>
      <button
        type="button"
        className="snToastClose"
        onClick={() => onRemove(toast.id)}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
