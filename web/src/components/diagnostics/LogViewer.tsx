import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Download,
  Eraser,
  FileJson,
  FileText,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { LOG_LEVEL_ORDER, LogEntry, LogLevel } from '../../types/diagnostics';
import {
  clearLogs,
  exportLogsAsJson,
  exportLogsAsText,
  filterLogs,
  formatLogEntry,
  getLogRetention,
  getLogs,
  getSubsystems,
  subscribeLogs,
} from '../../services/logging';

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: '#64748b',
  INFO: '#38bdf8',
  WARNING: '#f59e0b',
  ERROR: '#ef4444',
  CRITICAL: '#f43f5e',
};

interface LogViewerProps {
  /** Called when the user asks for a diagnostics report export/copy. */
  onCopyReport?: () => void;
  onExportReport?: (format: 'text' | 'json') => void;
}

const buttonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 11px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.25)',
  backgroundColor: 'rgba(148, 163, 184, 0.08)',
  color: '#cbd5e1',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

/** Reads and displays the retained diagnostic log with filters and export actions. */
export const LogViewer: React.FC<LogViewerProps> = ({ onCopyReport, onExportReport }) => {
  const [logs, setLogs] = useState<LogEntry[]>(() => getLogs());
  const [levels, setLevels] = useState<LogLevel[]>([]);
  const [subsystem, setSubsystem] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => subscribeLogs(setLogs), []);

  const filtered = useMemo(
    () => filterLogs(logs, { levels, subsystem, search }),
    [logs, levels, subsystem, search]
  );

  const subsystems = useMemo(() => getSubsystems(logs), [logs]);
  const retention = getLogRetention();

  const toggleLevel = (level: LogLevel) => {
    setLevels((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]));
  };

  const copyText = useCallback(async (text: string, key: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for webviews without the async clipboard API.
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
    } catch {
      setCopied('failed');
      setTimeout(() => setCopied(null), 2200);
    }
  }, []);

  const download = useCallback((content: string, filename: string, type: string) => {
    try {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      // Downloading is best-effort: the copy buttons remain as a fallback.
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Retention summary */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 12,
          backgroundColor: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          fontSize: 11,
          color: '#94a3b8',
        }}
      >
        <span>
          <strong style={{ color: '#e2e8f0' }}>{logs.length}</strong> of {retention.maxEntries} entries retained ·
          max {Math.round(retention.maxBytes / 1024)} KB · {retention.retentionDays}-day retention
        </span>
        <span>{filtered.length} shown</span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {LOG_LEVEL_ORDER.map((level) => {
            const active = levels.includes(level);
            return (
              <button
                key={level}
                type="button"
                onClick={() => toggleLevel(level)}
                aria-pressed={active}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: `1px solid ${active ? LEVEL_COLORS[level] : 'rgba(148, 163, 184, 0.2)'}`,
                  backgroundColor: active ? `${LEVEL_COLORS[level]}26` : 'transparent',
                  color: active ? LEVEL_COLORS[level] : '#94a3b8',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {level}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: '1 1 180px',
              padding: '7px 10px',
              borderRadius: 10,
              backgroundColor: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(148, 163, 184, 0.18)',
            }}
          >
            <Search size={13} color="#94a3b8" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search log messages…"
              aria-label="Search logs"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#f8fafc', fontSize: 12 }}
            />
          </div>

          <select
            value={subsystem}
            onChange={(e) => setSubsystem(e.target.value)}
            aria-label="Filter by subsystem"
            style={{
              padding: '7px 10px',
              borderRadius: 10,
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(148, 163, 184, 0.18)',
              color: '#cbd5e1',
              fontSize: 12,
              outline: 'none',
            }}
          >
            <option value="all">All subsystems</option>
            {subsystems.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" style={buttonStyle} onClick={() => download(exportLogsAsText(filtered), 'MindMesh-Logs.txt', 'text/plain')}>
            <FileText size={13} /> Export logs (text)
          </button>
          <button type="button" style={buttonStyle} onClick={() => download(exportLogsAsJson(filtered), 'MindMesh-Logs.json', 'application/json')}>
            <FileJson size={13} /> Export logs (JSON)
          </button>
          <button type="button" style={buttonStyle} onClick={() => copyText(exportLogsAsText(filtered), 'logs')}>
            <Copy size={13} /> {copied === 'logs' ? 'Copied' : 'Copy logs'}
          </button>
          {onCopyReport && (
            <button type="button" style={buttonStyle} onClick={onCopyReport}>
              <Copy size={13} /> Copy diagnostic report
            </button>
          )}
          {onExportReport && (
            <>
              <button type="button" style={buttonStyle} onClick={() => onExportReport('text')}>
                <Download size={13} /> Export report (text)
              </button>
              <button type="button" style={buttonStyle} onClick={() => onExportReport('json')}>
                <Download size={13} /> Export report (JSON)
              </button>
            </>
          )}
          <button
            type="button"
            style={{ ...buttonStyle, color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.3)' }}
            onClick={() => {
              if (confirm('Clear all diagnostic logs on this device?')) clearLogs();
            }}
          >
            <Eraser size={13} /> Clear logs
          </button>
        </div>

        {copied === 'failed' && (
          <span style={{ fontSize: 11, color: '#f59e0b' }}>
            Copying is not available in this environment. Use the export buttons instead.
          </span>
        )}
        {copied && copied !== 'failed' && copied !== 'logs' && (
          <span style={{ fontSize: 11, color: '#34d399' }}>Copied to clipboard.</span>
        )}
      </div>

      {/* Entries */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          maxHeight: 420,
          overflowY: 'auto',
          padding: 4,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 18,
              textAlign: 'center',
              fontSize: 12,
              color: '#64748b',
              borderRadius: 12,
              border: '1px dashed rgba(148, 163, 184, 0.25)',
            }}
          >
            <RefreshCw size={16} style={{ marginBottom: 6, opacity: 0.6 }} />
            <div>No log entries match the current filters.</div>
          </div>
        ) : (
          filtered.map((entry) => {
            const isOpen = expanded === entry.id;
            return (
              <div
                key={entry.id}
                style={{
                  borderRadius: 10,
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(148, 163, 184, 0.14)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : entry.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {isOpen ? <ChevronDown size={13} color="#94a3b8" /> : <ChevronRight size={13} color="#94a3b8" />}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: LEVEL_COLORS[entry.level],
                      minWidth: 62,
                    }}
                  >
                    {entry.level}
                  </span>
                  <span style={{ fontSize: 10, color: '#818cf8', minWidth: 84 }}>{entry.subsystem}</span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: '#e2e8f0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {entry.message}
                  </span>
                  <span style={{ fontSize: 10, color: '#64748b' }}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </button>

                {isOpen && (
                  <div style={{ padding: '0 10px 10px 31px' }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                      {new Date(entry.timestamp).toLocaleString()}
                    </div>
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <pre
                        style={{
                          margin: 0,
                          padding: 8,
                          borderRadius: 8,
                          backgroundColor: '#0b1220',
                          color: '#cbd5e1',
                          fontSize: 11,
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                    <button
                      type="button"
                      style={{ ...buttonStyle, marginTop: 8, padding: '5px 9px' }}
                      onClick={() => copyText(formatLogEntry(entry), entry.id)}
                    >
                      <Copy size={12} /> {copied === entry.id ? 'Copied' : 'Copy entry'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LogViewer;
