export function fmtTime(ts: string | null): string {
  if (!ts) return '\u2014';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtSize(b: number): string {
  if (b > 1048576) return (b / 1048576).toFixed(1) + 'MB';
  if (b > 1024) return (b / 1024).toFixed(0) + 'KB';
  return b + 'B';
}

export function fmtPct(n: number, total: number): string {
  return total ? Math.round(n / total * 100) + '%' : '0%';
}

export function fmtUSD(n: number): string {
  if (n >= 100) return '$' + n.toFixed(0);
  if (n >= 10) return '$' + n.toFixed(1);
  return '$' + n.toFixed(2);
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
