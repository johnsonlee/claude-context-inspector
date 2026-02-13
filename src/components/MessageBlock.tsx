import { useState } from 'react';
import type { Message, Block, ToolUseBlock } from '../types';
import Truncatable from './Truncatable';
import { fmtTime } from '../utils/format';

interface MessageBlockProps {
  msg: Message;
  defaultOpen: boolean;
}

export default function MessageBlock({ msg, defaultOpen }: MessageBlockProps) {
  const [open, setOpen] = useState(defaultOpen || false);

  const roleLabel = msg.isSidechain ? 'SIDECHAIN' : msg.type.toUpperCase();
  const cls = 'msg ' + (msg.isSidechain ? 'sidechain' : msg.type) + (open ? ' open' : '');

  const badges: { label: string; bg: string; color: string }[] = [];
  const bks: Block[] = msg.blocks || [];
  const hasThinking = bks.some(b => b.type === 'thinking');
  const toolUses = bks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
  const toolResults = bks.filter(b => b.type === 'tool_result');
  const hasSummary = bks.some(b => b.type === 'summary');

  if (hasThinking) badges.push({ label: '💭 thinking', bg: 'var(--purple-d)', color: 'var(--purple)' });
  if (toolUses.length) badges.push({ label: '🔧 ' + toolUses.map(t => t.toolName).join(', '), bg: 'var(--green-d)', color: 'var(--green)' });
  if (toolResults.length) badges.push({ label: '📋 result' + (toolResults.length > 1 ? 's' : ''), bg: 'var(--blue-d)', color: 'var(--blue)' });
  if (hasSummary) badges.push({ label: '📝 summary', bg: 'var(--amber-d)', color: 'var(--amber)' });
  if (msg.model) badges.push({ label: msg.model.replace('claude-', '').replace(/-\d{8}$/, ''), bg: 'var(--bg-4)', color: 'var(--t3)' });

  return (
    <div className={cls}>
      <div className="msg-hdr" onClick={() => setOpen(!open)}>
        <span className="caret">▶</span>
        <span className="msg-role">{roleLabel}</span>
        <div className="msg-badges">
          {badges.map((b, i) => (
            <span key={i} className="msg-badge" style={{ background: b.bg, color: b.color }}>
              {b.label}
            </span>
          ))}
        </div>
        <span className="msg-ts">{fmtTime(msg.timestamp)}</span>
      </div>
      <div className="msg-body">
        {bks.map((block, i) => {
          switch (block.type) {
            case 'text':
              return <div key={i} className="blk blk-text">{block.text}</div>;
            case 'thinking':
              return (
                <div key={i} className="blk blk-thinking">
                  <Truncatable text={block.text} maxLen={800} />
                </div>
              );
            case 'tool_use':
              return (
                <div key={i} className="blk blk-tool-use">
                  <div className="blk-tool-name">{block.toolName}</div>
                  <div className="blk-tool-input">
                    <Truncatable text={JSON.stringify(block.input, null, 2)} maxLen={500} />
                  </div>
                </div>
              );
            case 'tool_result':
              return (
                <div key={i} className={'blk blk-tool-result' + (block.isError ? ' error' : '')}>
                  <Truncatable text={block.content || '(empty)'} maxLen={600} />
                </div>
              );
            case 'summary':
              return (
                <div key={i} className="blk blk-summary">
                  <Truncatable text={block.text} maxLen={1200} />
                </div>
              );
            default: {
              const unknown = block as Block & { raw?: unknown };
              return (
                <div key={i} className="blk" style={{ color: 'var(--t3)', fontSize: 11 }}>
                  {'[' + unknown.type + '] ' + (unknown.raw ? JSON.stringify(unknown.raw).slice(0, 200) : '')}
                </div>
              );
            }
          }
        })}
      </div>
    </div>
  );
}
