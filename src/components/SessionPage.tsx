import { useState, useEffect } from 'react';
import type { Project, Message, Composition, ContextHealth } from '../types';
import { api } from '../utils/api';
import CompositionPanel from './CompositionPanel';
import ContextHealthPanel from './ContextHealthPanel';
import MessageBlock from './MessageBlock';

interface SessionPageProps {
  project: Project;
  sessionId: string;
  onBack: () => void;
}

interface SessionData {
  messages: Message[];
  composition: Composition;
  contextHealth: ContextHealth;
}

interface FilterState {
  user: boolean;
  assistant: boolean;
  system: boolean;
  summary: boolean;
  sidechain: boolean;
}

export default function SessionPage({ project, sessionId, onBack }: SessionPageProps) {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>({ user: true, assistant: true, system: true, summary: true, sidechain: false });
  const [expandAll, setExpandAll] = useState(false);
  const [searchQ, setSearchQ] = useState('');

  useEffect(() => {
    setLoading(true);
    api<SessionData>(`/api/session/${encodeURIComponent(project.name)}/${sessionId}`)
      .then(setData).finally(() => setLoading(false));
  }, [project.name, sessionId]);

  if (loading) return <div className="empty"><div className="spinner" /></div>;
  if (!data) return <div className="empty">Not found</div>;

  const { messages, composition, contextHealth } = data;

  let filtered = messages.filter(m => {
    if (m.isSidechain && !filter.sidechain) return false;
    if (m.type === 'summary' && !filter.summary) return false;
    if (m.type === 'user' && !filter.user) return false;
    if (m.type === 'assistant' && !filter.assistant) return false;
    if (m.type === 'system' && !filter.system) return false;
    return true;
  });

  if (searchQ) {
    const q = searchQ.toLowerCase();
    filtered = filtered.filter(m =>
      (m.blocks || []).some(b => {
        const text = 'text' in b ? String(b.text || '') : '';
        const toolName = b.type === 'tool_use' ? b.toolName : '';
        const content = b.type === 'tool_result' ? b.content : '';
        const input = b.type === 'tool_use' ? JSON.stringify(b.input || '') : '';
        return text.toLowerCase().includes(q) ||
          toolName.toLowerCase().includes(q) ||
          content.toLowerCase().includes(q) ||
          input.toLowerCase().includes(q);
      })
    );
  }

  const toggleFilter = (key: keyof FilterState) => setFilter(f => ({ ...f, [key]: !f[key] }));

  return (
    <div>
      <button className="back" onClick={onBack}>{'\u2190 Sessions'}</button>
      <div className="crumb">
        <b>{project.displayName}</b> {'\u203a '}{sessionId.slice(0, 12)}{'\u2026'}
      </div>

      <CompositionPanel composition={composition} />

      {contextHealth && <ContextHealthPanel health={contextHealth} />}

      <div className="gap" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="filters">
          {([['user', '👤 User'], ['assistant', '🤖 Assistant'], ['system', '⚙ System'], ['summary', '📝 Summary'], ['sidechain', '🔗 Sidechain']] as const).map(([k, l]) => (
            <button key={k} className={'fbtn' + (filter[k] ? ' on' : '')} onClick={() => toggleFilter(k)}>{l}</button>
          ))}
          <button className={'fbtn' + (expandAll ? ' on' : '')} onClick={() => setExpandAll(!expandAll)}>
            {expandAll ? '\u25b2 Collapse all' : '\u25bc Expand all'}
          </button>
        </div>
        <input
          type="text"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search content\u2026"
          style={{
            background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '5px 10px', color: 'var(--t1)', font: '12px var(--mono)', width: 220, outline: 'none',
          }}
        />
        <span style={{ font: '11px var(--mono)', color: 'var(--t3)' }}>
          {filtered.length + ' / ' + messages.length + ' messages'}
        </span>
      </div>

      <div className="gap">
        {filtered.map((msg, i) => (
          <MessageBlock key={msg.uuid || i} msg={msg} defaultOpen={expandAll} />
        ))}
      </div>
    </div>
  );
}
