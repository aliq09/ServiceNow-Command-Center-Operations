import { Eye, EyeOff, LockKeyhole, Server, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export function WorkInstanceDialog({ open, onCancel, onConnected }) {
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const clearForm = useCallback(() => {
    setUrl("");
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setError("");
  }, []);

  const cancel = useCallback(() => {
    clearForm();
    onCancel();
  }, [clearForm, onCancel]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !connecting) cancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [cancel, connecting, open]);

  if (!open) return null;

  const connect = async (event) => {
    event.preventDefault();
    setConnecting(true);
    setError("");
    try {
      const response = await fetch("/api/servicenow/instances/work/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, username, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to connect to the Work instance.");
      clearForm();
      onConnected(result.instance);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="snDialogBackdrop" role="presentation">
      <section className="snCredentialDialog" role="dialog" aria-modal="true" aria-labelledby="work-instance-title">
        <div className="snDialogHeader">
          <div className="snDialogIcon"><Server size={20} /></div>
          <div>
            <span>Session connection</span>
            <h2 id="work-instance-title">Connect Work instance</h2>
            <p>Credentials stay in local server memory and are cleared when the server restarts.</p>
          </div>
          <button type="button" className="snDialogClose" onClick={cancel} aria-label="Close connection dialog">
            <X size={18} />
          </button>
        </div>

        <form className="snCredentialForm" onSubmit={connect}>
          <label>
            <span>Instance URL</span>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://company.service-now.com"
              autoComplete="url"
              required
              autoFocus
            />
          </label>
          <label>
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="your.name"
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>Password</span>
            <div className="snPasswordField">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>

          {error && <div className="snDialogError" role="alert">{error}</div>}

          <div className="snSecurityNote">
            <LockKeyhole size={16} />
            <span>Nothing is written to files, logs, local storage, or the browser profile.</span>
          </div>

          <div className="snDialogActions">
            <button type="button" onClick={cancel}>Cancel</button>
            <button type="submit" disabled={connecting}>
              {connecting ? "Testing connection…" : "Connect securely"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
