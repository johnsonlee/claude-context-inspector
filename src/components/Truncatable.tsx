import { useState } from 'react';

interface TruncatableProps {
  text: string;
  maxLen?: number;
}

export default function Truncatable({ text, maxLen = 600 }: TruncatableProps) {
  const [exp, setExp] = useState(false);
  const needsTrunc = text.length > maxLen;
  return (
    <div>
      <pre className={needsTrunc && !exp ? 'trunc' : ''}>
        {needsTrunc && !exp ? text.slice(0, maxLen) + '\u2026' : text}
      </pre>
      {needsTrunc && (
        <div className="trunc-btn" onClick={() => setExp(!exp)}>
          {exp ? '\u25b2 Collapse' : '\u25bc Show full content (' + text.length + ' chars)'}
        </div>
      )}
    </div>
  );
}
