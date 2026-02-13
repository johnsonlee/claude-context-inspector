import { useState, useCallback, useEffect, useRef } from 'react';
import type { Project, Session } from '../types';
import { api } from '../utils/api';
import { useLiveReload } from '../hooks/useLiveReload';
import { fmtTime, fmtSize, fmtUSD } from '../utils/format';
import ConfirmDialog from './ConfirmDialog';

interface SessionsListPageProps {
  project: Project;
  onSelect: (sessionId: string) => void;
  onBack: () => void;
  onSessionsEmpty?: () => void;
  onSessionDeleted?: () => void;
}

export default function SessionsListPage({ project, onSelect, onBack, onSessionsEmpty, onSessionDeleted }: SessionsListPageProps) {
  const [data, setData] = useState<{ sessions: Session[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ sessions: Session[] }>('/api/sessions?project=' + encodeURIComponent(project.name))
      .then(setData).finally(() => setLoading(false));
  }, [project.name]);

  useEffect(() => { load(); }, [load]);

  // SSE: diff-update sessions without full remount
  const suppressRef = useRef(false);
  useLiveReload(useCallback(() => {
    if (suppressRef.current) { suppressRef.current = false; return; }
    api<{ sessions: Session[] }>('/api/sessions?project=' + encodeURIComponent(project.name))
      .then(fresh => setData(prev => {
        if (!prev) return fresh;
        const oldIds = new Set(prev.sessions.map(s => s.sessionId));
        const newIds = new Set(fresh.sessions.map(s => s.sessionId));
        // Only update if set of sessions actually changed
        if (oldIds.size === newIds.size && [...oldIds].every(id => newIds.has(id))) return prev;
        return fresh;
      }));
  }, [project.name]));

  const doDelete = useCallback(() => {
    if (!delTarget) return;
    suppressRef.current = true;
    api(`/api/session/${encodeURIComponent(project.name)}/${delTarget}`, { method: 'DELETE' })
      .then(() => {
        setData(prev => {
          if (!prev) return prev;
          const remaining = prev.sessions.filter(s => s.sessionId !== delTarget);
          if (remaining.length === 0) {
            // All sessions gone — delete the empty project directory
            api(`/api/project/${encodeURIComponent(project.name)}`, { method: 'DELETE' })
              .then(() => onSessionsEmpty?.());
          }
          return { sessions: remaining };
        });
        setDelTarget(null);
        onSessionDeleted?.();
      });
  }, [delTarget, project.name]);

  if (loading) return <div className="empty"><div className="spinner" /></div>;

  const sessions = data?.sessions || [];

  return (
    <div>
      {delTarget && (
        <ConfirmDialog
          title="Delete session?"
          message={'This will permanently delete the .jsonl file for session ' + delTarget.slice(0, 12) + '\u2026'}
          onConfirm={doDelete}
          onCancel={() => setDelTarget(null)}
        />
      )}
      <button className="back" onClick={onBack}>{'\u2190 Projects'}</button>
      <div className="crumb">
        <b>{project.displayName}</b> {' \u00b7 '}{sessions.length}{' sessions'}
      </div>

      {sessions.length === 0 ? (
        <div className="empty">No sessions found</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {sessions.map(s => (
            <div key={s.sessionId} className="s-row" onClick={() => onSelect(s.sessionId)}>
              <div
                className="s-icon"
                style={{
                  background: s.isAgent ? 'var(--green-d)' : 'var(--cyan-d)',
                  color: s.isAgent ? 'var(--green)' : 'var(--cyan)',
                }}
              >
                {s.isAgent ? '⚡' : '💬'}
              </div>
              <div className="s-body">
                <div className="s-title">{s.title}</div>
                <div className="s-meta">
                  <span>{fmtTime(s.startTime)}</span>
                  <span>{s.messageCount + ' msgs'}</span>
                  {s.toolCallCount > 0 && (
                    <span className="s-chip" style={{ background: 'var(--green-d)', color: 'var(--green)' }}>
                      {'🔧 ' + s.toolCallCount}
                    </span>
                  )}
                  {s.thinkingBlockCount > 0 && (
                    <span className="s-chip" style={{ background: 'var(--purple-d)', color: 'var(--purple)' }}>
                      {'💭 ' + s.thinkingBlockCount}
                    </span>
                  )}
                  {s.summaryCount > 0 && (
                    <span className="s-chip" style={{ background: 'var(--amber-d)', color: 'var(--amber)' }}>
                      {'📝 ' + s.summaryCount + ' compact'}
                    </span>
                  )}
                  {s.costUSD > 0 && (
                    <span className="s-chip" style={{ background: 'var(--cyan-d)', color: 'var(--cyan)' }}>
                      {fmtUSD(s.costUSD)}
                    </span>
                  )}
                  <span style={{ color: 'var(--t3)' }}>{fmtSize(s.fileSize)}</span>
                </div>
              </div>
              {!s.isActive && (
                <button
                  className="del-btn"
                  title="Delete session"
                  onClick={e => { e.stopPropagation(); setDelTarget(s.sessionId); }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
