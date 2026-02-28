import { useState, useEffect, useRef } from 'react';
import type { UsageRange, UsageStats } from '../types';
import { api } from '../utils/api';
import { fmtUSD, fmtTokens } from '../utils/format';

const RANGES: { label: string; value: UsageRange }[] = [
  { label: 'D', value: 'day' },
  { label: 'W', value: 'week' },
  { label: 'M', value: 'month' },
  { label: 'Y', value: 'year' },
  { label: 'ALL', value: 'all' },
];

const SHORT_TO_RANGE: Record<string, UsageRange> = { d: 'day', w: 'week', m: 'month', y: 'year' };
const RANGE_TO_SHORT: Record<string, string> = { day: 'd', week: 'w', month: 'm', year: 'y' };

function getInitialRange(): UsageRange {
  const param = new URLSearchParams(window.location.search).get('range')?.toLowerCase();
  return param && SHORT_TO_RANGE[param] ? SHORT_TO_RANGE[param] : 'all';
}

export default function UsagePanel() {
  const [range, setRange] = useState<UsageRange>(getInitialRange);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [stale, setStale] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setStale(true);
    api<UsageStats>(`/api/usage?range=${range}&scope=all`)
      .then(data => { if (id === reqId.current) { setStats(data); setStale(false); } })
      .catch(() => { if (id === reqId.current) setStale(false); });
  }, [range]);

  return (
    <div className="usage-panel card">
      <div className="usage-header">
        <div className="card-label" style={{ margin: 0 }}>Usage</div>
        <div className="usage-ranges">
          {RANGES.map(r => (
            <button
              key={r.value}
              className={'usage-range' + (range === r.value ? ' on' : '')}
              onClick={() => {
                setRange(r.value);
                const params = new URLSearchParams(window.location.search);
                if (r.value === 'all') params.delete('range'); else params.set('range', RANGE_TO_SHORT[r.value]);
                const qs = params.toString();
                window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!stats && stale && <div style={{ textAlign: 'center', padding: 12 }}><span className="spinner" /></div>}

      {stats && (
        <div style={{ opacity: stale ? 0.5 : 1, transition: 'opacity .15s' }}>
          <div className="usage-grid">
            <div className="usage-stat">
              <div className="stat-val" style={{ color: 'var(--cyan)' }}>{fmtUSD(stats.totalCostUSD)}</div>
              <div className="stat-sub">Total Cost</div>
            </div>
            <div className="usage-stat">
              <div className="stat-val" style={{ color: 'var(--green)' }}>{fmtTokens(stats.totalInputTokens)}</div>
              <div className="stat-sub">Input Tokens</div>
            </div>
            <div className="usage-stat">
              <div className="stat-val" style={{ color: 'var(--purple)' }}>{fmtTokens(stats.totalOutputTokens)}</div>
              <div className="stat-sub">Output Tokens</div>
            </div>
            <div className="usage-stat">
              <div className="stat-val" style={{ color: 'var(--blue)' }}>{fmtTokens(stats.totalCacheReadTokens)}</div>
              <div className="stat-sub">Cache Read</div>
            </div>
            <div className="usage-stat">
              <div className="stat-val" style={{ color: 'var(--amber)' }}>{fmtTokens(stats.totalCacheCreationTokens)}</div>
              <div className="stat-sub">Cache Creation</div>
            </div>
            <div className="usage-stat">
              <div className="stat-val" style={{ color: 'var(--t1)' }}>{stats.sessionCount}</div>
              <div className="stat-sub">Sessions</div>
            </div>
            <div className="usage-stat">
              <div className="stat-val" style={{ color: 'var(--t1)' }}>{stats.messageCount}</div>
              <div className="stat-sub">Messages</div>
            </div>
          </div>

          {Object.keys(stats.models).length > 0 && (
            <div className="usage-models">
              <div className="card-label" style={{ marginTop: 10, marginBottom: 4 }}>Models</div>
              {Object.entries(stats.models)
                .sort((a, b) => b[1].cost - a[1].cost)
                .map(([model, data]) => (
                  <div key={model} className="usage-model-row">
                    <span className="usage-model-name">{model}</span>
                    <span className="usage-model-meta">{fmtUSD(data.cost)} / {data.messages} msgs</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
