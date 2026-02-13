import type { Composition } from '../types';
import { fmtPct } from '../utils/format';

const TOOL_COLORS: Record<string, string> = {
  Read: '#4488ff', Edit: '#22dd88', Write: '#00d4ff', Bash: '#ff66aa',
  Grep: '#aa66ff', Glob: '#ffaa22', Task: '#ff4466', WebSearch: '#66ddff',
  WebFetch: '#88aaff', NotebookEdit: '#ddaa44',
};
const TOOL_PALETTE = ['#4488ff', '#22dd88', '#ff66aa', '#aa66ff', '#ffaa22', '#00d4ff', '#ff4466', '#66ddff'];

interface CompositionPanelProps {
  composition: Composition;
}

export default function CompositionPanel({ composition: c }: CompositionPanelProps) {
  const { charBreakdown: cb, toolNameCounts, blockCounts: bc, messageCounts: mc } = c;
  const segments = [
    { label: 'Text', value: cb.text, color: 'var(--cyan)' },
    { label: 'Thinking', value: cb.thinking, color: 'var(--purple)' },
    { label: 'Tool Input', value: cb.toolInput, color: 'var(--green)' },
    { label: 'Tool Result', value: cb.toolResult, color: 'var(--blue)' },
    { label: 'Summary', value: cb.summary, color: 'var(--amber)' },
  ].filter(s => s.value > 0);

  const toolEntries = Object.entries(toolNameCounts).sort((a, b) => b[1] - a[1]);
  const totalToolCalls = toolEntries.reduce((s, [, c]) => s + c, 0) || 1;

  return (
    <div className="grid g2 gap">
      <div className="card">
        <div className="card-label">Context Composition (by chars)</div>
        <div className="comp-bar">
          {segments.map((s, i) => (
            <div
              key={i}
              className="comp-seg"
              style={{ flex: s.value, background: s.color }}
              title={s.label + ': ' + fmtPct(s.value, cb.total)}
            >
              {fmtPct(s.value, cb.total)}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
          {segments.map((s, i) => (
            <div key={i} style={{ fontSize: 11, fontFamily: 'var(--mono)', color: s.color }}>
              {'● ' + s.label + ' ' + fmtPct(s.value, cb.total)}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 16, fontSize: 12, color: 'var(--t2)' }}>
          <span>{'👤 User: ' + mc.user}</span>
          <span>{'🤖 Assistant: ' + mc.assistant}</span>
          <span>{'💭 Thinking: ' + bc.thinking}</span>
          <span>{'📝 Summaries: ' + bc.summary}</span>
        </div>
      </div>
      <div className="card">
        <div className="card-label">{'Tool Usage (' + bc.toolUse + ' calls)'}</div>
        {toolEntries.length === 0 ? (
          <div style={{ color: 'var(--t3)', fontSize: 12 }}>No tool calls</div>
        ) : (
          <>
            <div className="comp-bar">
              {toolEntries.map(([name, count], i) => (
                <div
                  key={i}
                  className="comp-seg"
                  style={{ flex: count, background: TOOL_COLORS[name] || TOOL_PALETTE[i % TOOL_PALETTE.length] }}
                  title={name + ': ' + count}
                >
                  {count / totalToolCalls >= 0.08 ? name : ''}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
              {toolEntries.map(([name, count], i) => (
                <div key={i} style={{ fontSize: 11, fontFamily: 'var(--mono)', color: TOOL_COLORS[name] || TOOL_PALETTE[i % TOOL_PALETTE.length] }}>
                  {'● ' + name + ' ' + count + ' (' + fmtPct(count, totalToolCalls) + ')'}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
