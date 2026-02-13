import { useState, useEffect, useCallback, useRef } from 'react';
import type { Project, View } from './types';
import { fmtUSD } from './utils/format';
import { api } from './utils/api';
import { useLiveReload } from './hooks/useLiveReload';
import ConfirmDialog from './components/ConfirmDialog';
import UsagePanel from './components/UsagePanel';
import SessionsListPage from './components/SessionsListPage';
import SessionPage from './components/SessionPage';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<View>({ page: 'projects' });

  const refreshProjects = useCallback(() => {
    api<{ projects: Project[] }>('/api/projects').then(d => setProjects(d.projects || []));
  }, []);

  useEffect(() => { refreshProjects(); }, []);
  useLiveReload(refreshProjects);

  const activeProject = view.project?.name;

  const [delProject, setDelProject] = useState<string | null>(null);

  const doDeleteProject = useCallback(() => {
    if (!delProject) return;
    api(`/api/project/${encodeURIComponent(delProject)}`, { method: 'DELETE' })
      .then(() => {
        setDelProject(null);
        if (view.project?.name === delProject) setView({ page: 'projects' });
        refreshProjects();
      });
  }, [delProject, view.project, refreshProjects]);

  // Sidebar resize
  const [sbWidth, setSbWidth] = useState(320);
  const dragging = useRef(false);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.max(320, Math.min(ev.clientX, 600));
      setSbWidth(w);
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div className="shell">
      {delProject && (
        <ConfirmDialog
          title="Delete project?"
          message="This will permanently delete the project directory and all its sessions."
          onConfirm={doDeleteProject}
          onCancel={() => setDelProject(null)}
        />
      )}

      <nav className="sb" style={{ width: sbWidth }}>
        <div className="sb-resize" onMouseDown={onResizeStart} />
        <div className="sb-hdr">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="28" height="28" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M32 4L56.8 18v28L32 60 7.2 46V18L32 4z" stroke="var(--cyan)" strokeWidth="2" fill="var(--bg-1)" opacity="0.9"/>
              <circle cx="32" cy="32" r="16" stroke="var(--cyan)" strokeWidth="1.5" opacity="0.4"/>
              <line x1="20" y1="26" x2="44" y2="26" stroke="var(--cyan)" strokeWidth="1" opacity="0.3"/>
              <line x1="18" y1="32" x2="46" y2="32" stroke="var(--cyan)" strokeWidth="1" opacity="0.3"/>
              <line x1="20" y1="38" x2="44" y2="38" stroke="var(--cyan)" strokeWidth="1" opacity="0.3"/>
              <path d="M24 24l-6 8 6 8" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M40 24l6 8-6 8" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="32" cy="32" r="2.5" fill="var(--cyan)"/>
              <circle cx="32" cy="4" r="2" fill="var(--cyan)" opacity="0.6"/>
              <circle cx="56.8" cy="18" r="2" fill="var(--cyan)" opacity="0.6"/>
              <circle cx="56.8" cy="46" r="2" fill="var(--cyan)" opacity="0.6"/>
              <circle cx="32" cy="60" r="2" fill="var(--cyan)" opacity="0.6"/>
              <circle cx="7.2" cy="46" r="2" fill="var(--cyan)" opacity="0.6"/>
              <circle cx="7.2" cy="18" r="2" fill="var(--cyan)" opacity="0.6"/>
            </svg>
            <h1>CONTEXT INSPECTOR</h1>
          </div>
          <div className="sub">Claude Code Transcript Viewer</div>
        </div>
        <div className="sb-sec">
          <div className="sb-lbl">Projects</div>
          {projects.map(p => (
            <div
              key={p.name}
              className={'sb-item' + (activeProject === p.name ? ' on' : '')}
              onClick={() => setView({ page: 'sessions', project: p })}
            >
              <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.displayName}
                </div>
                {p.costUSD > 0 && (
                  <div style={{ font: '10px var(--mono)', color: 'var(--t3)', marginTop: 2 }}>
                    {fmtUSD(p.costUSD)} / {p.sessionCount} sessions
                  </div>
                )}
              </div>
              {!(p.costUSD > 0) && <span className="sb-badge">{p.sessionCount}</span>}
              {!p.isActive && (
                <button
                  className="del-btn"
                  title="Delete project"
                  onClick={e => { e.stopPropagation(); setDelProject(p.name); }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {projects.length === 0 && (
            <div className="sb-item" style={{ cursor: 'default', fontSize: 11, color: 'var(--t3)' }}>
              No projects found
            </div>
          )}
        </div>
        <UsagePanel />
      </nav>

      <main className="main">
        {view.page === 'projects' && (
          <div className="empty">
            <div style={{ fontSize: 14, marginBottom: 8 }}>Select a project from the sidebar</div>
            <div style={{ fontSize: 12 }}>
              Sessions are read from{' '}
              <code style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)' }}>~/.claude/projects/</code>
            </div>
          </div>
        )}
        {view.page === 'sessions' && view.project && (
          <SessionsListPage
            project={view.project}
            onSelect={sid => setView({ page: 'session', project: view.project!, sessionId: sid })}
            onBack={() => setView({ page: 'projects' })}
            onSessionsEmpty={() => { setView({ page: 'projects' }); refreshProjects(); }}
            onSessionDeleted={refreshProjects}
          />
        )}
        {view.page === 'session' && view.project && view.sessionId && (
          <SessionPage
            project={view.project}
            sessionId={view.sessionId}
            onBack={() => setView({ page: 'sessions', project: view.project! })}
          />
        )}
      </main>
    </div>
  );
}
