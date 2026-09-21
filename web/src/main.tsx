import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { logging, exportLogsAsText, getLogs } from './services/logging';
import { recordError, OPEN_DIAGNOSTICS_FLAG } from './services/diagnosticsStore';
import { APP_VERSION } from './services/backup';
import { BUILD_VERSION } from './services/diagnostics';

/**
 * Application bootstrap.
 *
 * Captures unhandled errors, unhandled promise rejections and rendering failures,
 * records them in the on-device diagnostic log, and shows a friendly recovery
 * screen instead of a blank page.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
  copied: boolean;
}

/** Small, privacy-safe error report used by the copy button. */
function buildErrorReport(error: Error | null): string {
  const lines: string[] = [
    'MindMesh Error Report',
    '=====================',
    `Generated: ${new Date().toISOString()}`,
    `App Version: ${APP_VERSION}`,
    `Build Version: ${BUILD_VERSION}`,
    `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : 'unknown'}`,
    '',
    'Error:',
    `  Name: ${error?.name ?? 'unknown'}`,
    `  Message: ${error?.message ?? 'unknown'}`,
    '',
    'Stack Trace:',
    error?.stack ? error.stack.slice(0, 4000) : '  (no stack trace available)',
    '',
    'Recent Diagnostic Logs:',
    exportLogsAsText(getLogs().slice(0, 40)) || '  (none)',
    '',
    'Note: reminder titles, notes, contacts and financial records are not included in this report.',
  ];
  return lines.join('\n');
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
    return true;
  } catch {
    return false;
  }
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false, copied: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, showDetails: false, copied: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Recorded locally so the diagnostics panel can explain what happened.
    logging.critical('ErrorBoundary', 'Unhandled rendering error', error, {
      componentStack: errorInfo.componentStack?.slice(0, 2000),
    });
    recordError(
      {
        message: error.message || 'Unhandled rendering error',
        name: error.name,
        stack: error.stack?.slice(0, 4000),
        at: new Date().toISOString(),
        subsystem: 'ErrorBoundary',
        level: 'CRITICAL',
      },
      true
    );
  }

  handleRestart = () => {
    // Restart without touching stored data.
    window.location.reload();
  };

  handleRunDiagnostics = () => {
    try {
      sessionStorage.setItem(OPEN_DIAGNOSTICS_FLAG, '1');
    } catch {
      // sessionStorage may be unavailable; diagnostics can still be opened manually.
    }
    window.location.reload();
  };

  handleCopy = async () => {
    const ok = await copyText(buildErrorReport(this.state.error));
    this.setState({ copied: ok });
    if (!ok) setTimeout(() => this.setState({ copied: false }), 2500);
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const buttonBase: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      padding: '11px 16px',
      borderRadius: 12,
      fontSize: 13.5,
      fontWeight: 700,
      cursor: 'pointer',
      border: 'none',
    };

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100%',
          width: '100%',
          padding: 24,
          backgroundColor: '#080B12',
          color: '#F8FAFC',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            padding: 22,
            borderRadius: 18,
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.28)',
            maxWidth: 460,
            width: '100%',
          }}
        >
          <h2 style={{ fontSize: 18, color: '#f87171', marginBottom: 8, fontWeight: 800 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 18, lineHeight: 1.6 }}>
            MindMesh hit an unexpected error. Your saved reminders, contacts and financial data have not been changed.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              onClick={this.handleRestart}
              style={{ ...buttonBase, backgroundColor: '#6366f1', color: '#ffffff' }}
            >
              Restart MindMesh
            </button>
            <button
              type="button"
              onClick={this.handleRunDiagnostics}
              style={{
                ...buttonBase,
                backgroundColor: 'rgba(148, 163, 184, 0.12)',
                border: '1px solid rgba(148, 163, 184, 0.28)',
                color: '#cbd5e1',
              }}
            >
              Run Diagnostics
            </button>
            <button
              type="button"
              onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
              style={{
                ...buttonBase,
                backgroundColor: 'transparent',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                color: '#94a3b8',
              }}
            >
              {this.state.showDetails ? 'Hide Error Details' : 'View Error Details'}
            </button>
            <button
              type="button"
              onClick={this.handleCopy}
              style={{
                ...buttonBase,
                backgroundColor: 'transparent',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                color: this.state.copied ? '#34d399' : '#94a3b8',
              }}
            >
              {this.state.copied ? 'Copied Error Report' : 'Copy Error Report'}
            </button>
          </div>

          {this.state.showDetails && (
            <pre
              style={{
                marginTop: 14,
                padding: 10,
                borderRadius: 10,
                backgroundColor: '#0b1220',
                color: '#fca5a5',
                fontSize: 11,
                textAlign: 'left',
                maxHeight: 200,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {this.state.error?.name}: {this.state.error?.message}
              {'\n\n'}
              {this.state.error?.stack?.slice(0, 2000) ?? '(no stack trace)'}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

/* ------------------------------------------------------------------ *
 * Global error capture
 * ------------------------------------------------------------------ */

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const error = event.error instanceof Error ? event.error : null;
    logging.critical('GlobalError', error?.message || event.message || 'Unhandled error', error, {
      source: event.filename ? `${event.filename}:${event.lineno ?? 0}` : 'unknown',
    });
    recordError(
      {
        message: error?.message || event.message || 'Unhandled error',
        name: error?.name || 'Error',
        stack: error?.stack?.slice(0, 4000),
        at: new Date().toISOString(),
        subsystem: 'GlobalError',
        level: 'CRITICAL',
      },
      true
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : null;
    logging.critical(
      'GlobalError',
      `Unhandled promise rejection: ${error?.message || String(reason).slice(0, 300)}`,
      error ?? { reason: String(reason).slice(0, 300) }
    );
    recordError(
      {
        message: error?.message || `Unhandled promise rejection: ${String(reason).slice(0, 300)}`,
        name: error?.name || 'UnhandledRejection',
        stack: error?.stack?.slice(0, 4000),
        at: new Date().toISOString(),
        subsystem: 'GlobalError',
        level: 'CRITICAL',
      },
      true
    );
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
} else {
  // The logger keeps this on-device; nothing renders if the shell is missing.
  logging.critical('Bootstrap', 'Root element #root not found in document');
}
