import { useState } from 'react';
import type { ContextHealth, CompactionEvent } from '../types';

interface Props {
  health: ContextHealth;
}

function scoreColor(score: number): string {
  if (score > 70) return 'var(--green)';
  if (score > 40) return 'var(--amber)';
  return 'var(--red)';
}
function scoreBg(score: number): string {
  if (score > 70) return 'var(--green-d)';
  if (score > 40) return 'var(--amber-d)';
  return 'var(--red-d)';
}
function driftColor(s: number): string {
  if (s < 30) return 'var(--green)';
  if (s < 60) return 'var(--amber)';
  return 'var(--red)';
}
function driftBg(s: number): string {
  if (s < 30) return 'var(--green-d)';
  if (s < 60) return 'var(--amber-d)';
  return 'var(--red-d)';
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function fmtChars(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function CompactionCard({ c, idx }: { c: CompactionEvent; idx: number }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'info' | 'drift' | 'entities'>('info');
  const totalEntities = c.entitiesLost.length + c.entitiesRetained.length;
  const retentionPct = totalEntities > 0 ? Math.round((c.entitiesRetained.length / totalEntities) * 100) : 100;

  return (
    <div className="compaction-card">
      {/* Header — always visible, click to expand */}
      <div className="compaction-card-hdr" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="caret" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
          <span style={{ font: '600 12px var(--mono)', color: 'var(--t1)', minWidth: 20 }}>#{idx + 1}</span>
          <span className="compaction-badge">{c.compressionRatio}:1</span>
          <span className="compaction-badge wide" style={{ background: driftBg(c.driftSeverity), color: driftColor(c.driftSeverity) }}>
            drift {c.driftSeverity}%
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, font: '11px var(--mono)', color: 'var(--t3)' }}>
          <span>{c.messagesCompacted} msgs</span>
          <span>{fmtChars(c.preChars)} → {fmtChars(c.summaryChars)}</span>
          {c.timeSpanSeconds > 0 && <span>{fmtDuration(c.timeSpanSeconds)}</span>}
          <span>{c.toolCallsCompacted} tool calls</span>
        </div>
      </div>

      {/* Tab bar + content — only when expanded */}
      {open && <><div className="ctx-tabs">
        {(['info', 'drift', 'entities'] as const).map(t => (
          <button key={t} className={'ctx-tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
            {t === 'info' ? 'Metrics' : t === 'drift' ? 'Behavioral Drift' : `Entities (${retentionPct}%)`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="compaction-card-body">
        {tab === 'info' && (
          <div className="ctx-metrics-grid">
            <div className="ctx-metric">
              <div className="ctx-metric-val">{c.compressionRatio}:1</div>
              <div className="ctx-metric-lbl">Compression</div>
            </div>
            <div className="ctx-metric">
              <div className="ctx-metric-val">{c.messagesCompacted}</div>
              <div className="ctx-metric-lbl">Messages</div>
            </div>
            <div className="ctx-metric">
              <div className="ctx-metric-val">{c.toolCallsCompacted}</div>
              <div className="ctx-metric-lbl">Tool Calls</div>
            </div>
            <div className="ctx-metric">
              <div className="ctx-metric-val">{retentionPct}%</div>
              <div className="ctx-metric-lbl">Entity Retention</div>
            </div>
            <div className="ctx-metric">
              <div className="ctx-metric-val">
                {c.thinkingRatePre}%
                <span style={{ color: 'var(--t3)', fontWeight: 400 }}> → </span>
                <span style={{ color: c.thinkingRatePost < c.thinkingRatePre ? 'var(--red)' : 'var(--green)' }}>
                  {c.thinkingRatePost}%
                </span>
              </div>
              <div className="ctx-metric-lbl">Thinking Rate</div>
            </div>
            <div className="ctx-metric">
              <div className="ctx-metric-val">
                {fmtChars(c.avgResponseLenPre)}
                <span style={{ color: 'var(--t3)', fontWeight: 400 }}> → </span>
                {fmtChars(c.avgResponseLenPost)}
              </div>
              <div className="ctx-metric-lbl">Avg Response</div>
            </div>
            {c.summaryMissed.length > 0 && (
              <div className="ctx-metric" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {c.summaryMissed.map((t, i) => (
                    <span key={i} className="entity-tag lost">{t}</span>
                  ))}
                </div>
                <div className="ctx-metric-lbl" style={{ marginTop: 4 }}>Topics NOT in summary</div>
              </div>
            )}
          </div>
        )}

        {tab === 'drift' && (
          <div>
            {/* Tool usage stacked bars: before vs after */}
            {c.toolShifts.length > 0 && (() => {
              const preTotal = c.toolShifts.reduce((s, ts) => s + ts.prePct, 0) || 1;
              const postTotal = c.toolShifts.reduce((s, ts) => s + ts.postPct, 0) || 1;
              const TOOL_COLORS: Record<string, string> = {
                Read: '#4488ff', Edit: '#22dd88', Write: '#00d4ff', Bash: '#ff66aa',
                Grep: '#aa66ff', Glob: '#ffaa22', Task: '#ff4466', WebSearch: '#66ddff',
                WebFetch: '#88aaff',
              };
              const toolColor = (name: string) => TOOL_COLORS[name] || 'var(--t3)';
              return (
                <div style={{ marginBottom: 10 }}>
                  <div className="bdiff-section-label">Tool Usage — Before</div>
                  <div className="comp-bar" style={{ height: 22, marginBottom: 4 }}>
                    {c.toolShifts.filter(ts => ts.prePct > 0).map((ts, i) => (
                      <div key={i} className="comp-seg" title={`${ts.tool}: ${ts.prePct}%`}
                        style={{ flex: ts.prePct / preTotal, background: toolColor(ts.tool) }}>
                        {ts.prePct >= 8 ? ts.tool : ''}
                      </div>
                    ))}
                  </div>
                  <div className="bdiff-section-label">Tool Usage — After</div>
                  <div className="comp-bar" style={{ height: 22, marginBottom: 8 }}>
                    {c.toolShifts.filter(ts => ts.postPct > 0).map((ts, i) => (
                      <div key={i} className="comp-seg" title={`${ts.tool}: ${ts.postPct}%`}
                        style={{ flex: ts.postPct / postTotal, background: toolColor(ts.tool) }}>
                        {ts.postPct >= 8 ? ts.tool : ''}
                      </div>
                    ))}
                  </div>
                  {c.toolShifts.filter(ts => Math.abs(ts.delta) >= 3).map((ts, i) => (
                    <div key={i} className="bdiff-tool-row">
                      <span className="bdiff-tool-name">{ts.tool}</span>
                      <span style={{ font: '11px var(--mono)', color: 'var(--t3)', minWidth: 32, textAlign: 'right' }}>{ts.prePct}%</span>
                      <span style={{ font: '11px var(--mono)', color: 'var(--t3)' }}>→</span>
                      <span style={{ font: '11px var(--mono)', color: 'var(--t3)', minWidth: 32 }}>{ts.postPct}%</span>
                      <span className="bdiff-delta" style={{
                        color: ts.delta > 0 ? 'var(--green)' : ts.delta < 0 ? 'var(--red)' : 'var(--t3)',
                      }}>
                        {ts.delta > 0 ? '+' : ''}{ts.delta}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* File focus */}
            {(c.filesDropped.length > 0 || c.filesAdded.length > 0) && (
              <div>
                <div className="bdiff-section-label">File Focus Shift</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {c.filesDropped.map((f, i) => (
                    <span key={'d' + i} className="entity-tag lost" title="Dropped">{f}</span>
                  ))}
                  {c.filesAdded.map((f, i) => (
                    <span key={'a' + i} className="entity-tag kept" title="Added">{f}</span>
                  ))}
                  {c.filesContinued.map((f, i) => (
                    <span key={'c' + i} className="entity-tag" style={{ background: 'var(--bg-4)', color: 'var(--t2)' }} title="Continued">{f}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'entities' && (
          <div>
            <div style={{ font: '11px var(--mono)', color: 'var(--t2)', marginBottom: 8 }}>
              {c.entitiesRetained.length} retained / {totalEntities} total ({retentionPct}%)
            </div>
            {c.entitiesRetained.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {c.entitiesRetained.map((e, i) => (
                  <span key={i} className="entity-tag kept">{e}</span>
                ))}
              </div>
            )}
            {c.entitiesLost.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {c.entitiesLost.map((e, i) => (
                  <span key={i} className="entity-tag lost">{e}</span>
                ))}
              </div>
            )}
            {totalEntities === 0 && (
              <span style={{ font: '11px var(--mono)', color: 'var(--t3)' }}>No entities extracted</span>
            )}
          </div>
        )}
      </div></>}
    </div>
  );
}

export default function ContextHealthPanel({ health }: Props) {
  if (health.compactionCount === 0) return null;

  // Timeline segments
  const segments: number[] = [];
  for (const c of health.compactions) segments.push(c.messagesCompacted);
  segments.push(Math.max(1, segments.length > 0 ? Math.round(segments.reduce((a, b) => a + b, 0) / segments.length) : 10));
  const totalSegs = segments.reduce((a, b) => a + b, 0);

  return (
    <div className="card gap ctx-health">
      <div className="card-label">Context Health</div>

      {/* Summary row */}
      <div className="ctx-health-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="health-score" style={{ background: scoreBg(health.healthScore), color: scoreColor(health.healthScore) }}>
            {health.healthScore}
          </div>
          <div>
            <div style={{ font: '600 13px var(--sans)', color: 'var(--t1)' }}>Health Score</div>
            <div style={{ font: '11px var(--mono)', color: 'var(--t3)', marginTop: 2 }}>
              {health.compactionCount} compaction{health.compactionCount !== 1 ? 's' : ''} · {health.overallCompressionRatio}:1 overall
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ font: '600 16px var(--mono)', color: driftColor(health.overallDriftSeverity) }}>{health.overallDriftSeverity}%</div>
            <div style={{ font: '9px var(--mono)', color: 'var(--t3)' }}>DRIFT</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ font: '600 16px var(--mono)', color: 'var(--red)' }}>{health.totalEntitiesLost}</div>
            <div style={{ font: '9px var(--mono)', color: 'var(--t3)' }}>LOST</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ font: '600 16px var(--mono)', color: 'var(--green)' }}>{health.totalEntitiesRetained}</div>
            <div style={{ font: '9px var(--mono)', color: 'var(--t3)' }}>KEPT</div>
          </div>
        </div>
      </div>

      {/* Timeline bar */}
      <div className="health-timeline">
        {segments.map((count, i) => (
          <div key={i} style={{ display: 'flex', flex: count / totalSegs, alignItems: 'stretch' }}>
            <div className="health-seg" style={{ flex: 1 }} />
            {i < segments.length - 1 && <div className="health-divider" title={`Compaction #${i + 1}`} />}
          </div>
        ))}
      </div>

      {/* Per-compaction cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {health.compactions.map((c, i) => (
          <CompactionCard key={i} c={c} idx={i} />
        ))}
      </div>
    </div>
  );
}
