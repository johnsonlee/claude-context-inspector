import express, { type Request, type Response } from 'express';
import { readdir, readFile, stat, rm, unlink, mkdir, writeFile, rename } from 'fs/promises';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import chokidar from 'chokidar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3456;
const CLAUDE_DIR = process.env.CLAUDE_DIR || join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

app.use(express.static(join(__dirname, '..', 'dist')));

// ---------------------------------------------------------------------------
// Active state detection — find running claude processes by cwd
// ---------------------------------------------------------------------------

const activeProjectNames = new Set<string>();

function refreshActiveState() {
  activeProjectNames.clear();
  try {
    const psOut = execSync(`ps -eo pid,comm 2>/dev/null`, { stdio: 'pipe', encoding: 'utf-8' });
    const claudePids: string[] = [];
    for (const line of psOut.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+claude$/);
      if (m) claudePids.push(m[1]);
    }
    if (!claudePids.length) return;

    for (const pid of claudePids) {
      try {
        const lsofOut = execSync(`lsof -p ${pid} -Fn 2>/dev/null`, { stdio: 'pipe', encoding: 'utf-8' });
        const lines = lsofOut.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] === 'fcwd' && lines[i + 1]?.startsWith('n')) {
            // /Users/foo/bar → -Users-foo-bar (matches project dir name format)
            const cwd = lines[i + 1].slice(1);
            activeProjectNames.add(cwd.replaceAll('/', '-'));
            break;
          }
        }
      } catch { /* skip */ }
    }
  } catch {
    // ps/lsof not available — treat everything as deletable
  }
}

function isProjectActive(projectDirName: string): boolean {
  return activeProjectNames.has(projectDirName);
}

function isSessionActive(sessionId: string, projectDirName: string): boolean {
  return activeProjectNames.has(projectDirName);
}

// Initial scan
refreshActiveState();

// ---------------------------------------------------------------------------
// JSONL Parsing — extract meaningful content, not just metrics
// ---------------------------------------------------------------------------

interface RawEntry {
  type?: string;
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  gitBranch?: string;
  cwd?: string;
  userType?: string;
  requestId?: string;
  message?: {
    id?: string;
    content?: unknown;
    model?: string;
    usage?: unknown;
    stop_reason?: string;
  };
  model?: string;
  toolUseMessages?: Array<{
    name?: string;
    tool_name?: string;
    input?: unknown;
    tool_input?: unknown;
    result?: unknown;
    tool_result?: unknown;
    id?: string;
    tool_use_id?: string;
  }>;
  toolUseResult?: unknown;
  thinkingMetadata?: unknown;
  costUSD?: number;
  summary?: string;
  isCompactSummary?: boolean;
  isVisibleInTranscriptOnly?: boolean;
}

interface RawBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  summary?: string;
  [key: string]: unknown;
}

interface ParsedBlock {
  type: string;
  text?: string;
  toolName?: string;
  toolId?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
  raw?: unknown;
}

interface ParsedMessage {
  uuid: string | null;
  parentUuid: string | null;
  timestamp: string | null;
  sessionId: string | null;
  isSidechain: boolean;
  isMeta: boolean;
  gitBranch: string | null;
  cwd: string | null;
  type: string;
  role: string;
  blocks: ParsedBlock[];
  model?: string | null;
  userType?: string;
  toolUseResult?: unknown;
  thinkingMetadata?: unknown;
  toolUseDetails?: Array<{ name: string; input: unknown; result: unknown; id: string }>;
  usage?: unknown;
  costUSD?: number | null;
  stopReason?: string | null;
  requestId?: string | null;
  messageId?: string | null;
  isCompactSummary?: boolean;
}

function parseLine(line: string): RawEntry | null {
  try { return JSON.parse(line); } catch { return null; }
}

function extractContentBlocks(content: unknown): ParsedBlock[] {
  if (!content) return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.map((block: RawBlock) => {
    if (block.type === 'text') return { type: 'text', text: block.text || '' };
    if (block.type === 'thinking') return { type: 'thinking', text: block.thinking || '' };
    if (block.type === 'tool_use') return {
      type: 'tool_use', toolName: block.name || 'unknown',
      toolId: block.id || '', input: block.input || {},
    };
    if (block.type === 'tool_result') return {
      type: 'tool_result', toolUseId: block.tool_use_id || '',
      content: typeof block.content === 'string' ? block.content
        : Array.isArray(block.content) ? block.content.map((c: { text?: string }) => c.text || JSON.stringify(c)).join('\n')
        : JSON.stringify(block.content),
      isError: block.is_error || false,
    };
    if (block.type === 'summary') return { type: 'summary', text: block.summary || block.text || '' };
    return { type: block.type || 'unknown', raw: block };
  });
}

function parseTranscriptFull(rawLines: RawEntry[]): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  for (const entry of rawLines) {
    if (!entry || !entry.type) continue;
    const base = {
      uuid: entry.uuid || null, parentUuid: entry.parentUuid || null,
      timestamp: entry.timestamp || null, sessionId: entry.sessionId || null,
      isSidechain: entry.isSidechain || false, isMeta: entry.isMeta || false,
      gitBranch: entry.gitBranch || null, cwd: entry.cwd || null,
    };
    if (entry.type === 'user' && entry.isCompactSummary) {
      const text = typeof entry.message?.content === 'string' ? entry.message.content : JSON.stringify(entry.message?.content);
      messages.push({ ...base, type: 'summary', role: 'system',
        isCompactSummary: true,
        blocks: [{ type: 'summary', text }],
      });
    } else if (entry.type === 'user') {
      const blocks = extractContentBlocks(entry.message?.content);
      messages.push({ ...base, type: 'user', role: 'user',
        userType: entry.userType || 'external', blocks,
        toolUseResult: entry.toolUseResult || null,
        thinkingMetadata: entry.thinkingMetadata || null,
      });
    } else if (entry.type === 'assistant') {
      const blocks = extractContentBlocks(entry.message?.content);
      const toolUseDetails = (entry.toolUseMessages || []).map((tu) => ({
        name: tu.name || tu.tool_name || 'unknown',
        input: tu.input || tu.tool_input || {},
        result: tu.result || tu.tool_result || null,
        id: tu.id || tu.tool_use_id || '',
      }));
      messages.push({ ...base, type: 'assistant', role: 'assistant',
        model: entry.message?.model || entry.model || null,
        blocks, toolUseDetails,
        usage: entry.message?.usage || null,
        costUSD: entry.costUSD ?? null,
        stopReason: entry.message?.stop_reason || null,
        requestId: entry.requestId || null,
        messageId: entry.message?.id || null,
      });
    } else if (entry.type === 'summary' || entry.type === 'compaction') {
      messages.push({ ...base, type: 'summary', role: 'system',
        blocks: [{ type: 'summary', text: entry.summary || (typeof entry.message?.content === 'string' ? entry.message.content : JSON.stringify(entry)) }],
      });
    } else if (entry.type === 'system') {
      const blocks = extractContentBlocks(entry.message?.content);
      messages.push({ ...base, type: 'system', role: 'system', blocks });
    }
  }
  return messages;
}

function computeContextComposition(messages: ParsedMessage[]) {
  let userMsgs = 0, assistantMsgs = 0, systemMsgs = 0;
  let thinkingBlocks = 0, toolUseCalls = 0, toolResults = 0, summaries = 0;
  let textChars = 0, thinkingChars = 0, toolInputChars = 0, toolResultChars = 0, summaryChars = 0;
  const toolNameCounts: Record<string, number> = {};
  const models: Record<string, number> = {};
  for (const msg of messages) {
    if (msg.type === 'user') userMsgs++;
    else if (msg.type === 'assistant') assistantMsgs++;
    else systemMsgs++;
    if (msg.model) models[msg.model] = (models[msg.model] || 0) + 1;
    for (const b of (msg.blocks || [])) {
      if (b.type === 'text') textChars += (b.text || '').length;
      if (b.type === 'thinking') { thinkingBlocks++; thinkingChars += (b.text || '').length; }
      if (b.type === 'tool_use') {
        toolUseCalls++; toolNameCounts[b.toolName!] = (toolNameCounts[b.toolName!] || 0) + 1;
        toolInputChars += JSON.stringify(b.input || {}).length;
      }
      if (b.type === 'tool_result') { toolResults++; toolResultChars += (b.content || '').length; }
      if (b.type === 'summary') { summaries++; summaryChars += (b.text || '').length; }
    }
  }
  const total = textChars + thinkingChars + toolInputChars + toolResultChars + summaryChars;
  return {
    messageCounts: { user: userMsgs, assistant: assistantMsgs, system: systemMsgs },
    blockCounts: { thinking: thinkingBlocks, toolUse: toolUseCalls, toolResult: toolResults, summary: summaries },
    charBreakdown: { text: textChars, thinking: thinkingChars, toolInput: toolInputChars,
      toolResult: toolResultChars, summary: summaryChars, total: total || 1 },
    toolNameCounts, models,
  };
}

// ---------------------------------------------------------------------------
// Context Health — unified per-compaction analysis
// ---------------------------------------------------------------------------

interface ToolShift {
  tool: string;
  prePct: number;
  postPct: number;
  delta: number;
}

interface CompactionEvent {
  index: number;
  timestamp: string | null;
  // Information loss
  messagesCompacted: number;
  preChars: number;
  summaryChars: number;
  compressionRatio: number;
  entitiesLost: string[];
  entitiesRetained: string[];
  toolCallsCompacted: number;
  timeSpanSeconds: number;
  // Behavioral diff
  toolShifts: ToolShift[];
  filesDropped: string[];
  filesAdded: string[];
  filesContinued: string[];
  thinkingRatePre: number;
  thinkingRatePost: number;
  avgResponseLenPre: number;
  avgResponseLenPost: number;
  summaryMissed: string[];
  driftSeverity: number;
}

interface ContextHealth {
  compactionCount: number;
  compactions: CompactionEvent[];
  overallCompressionRatio: number;
  totalEntitiesLost: number;
  totalEntitiesRetained: number;
  healthScore: number;
  overallDriftSeverity: number;
}

function extractEntities(text: string): Set<string> {
  const entities = new Set<string>();
  const pathRe = /(?:(?:\/|\.\/|\.\.\/)[^\s,;:'"()[\]{}<>]+|(?:src|lib|test|tests|server|client|app|components|utils|hooks|pages|api|config|dist|build|node_modules)\/[^\s,;:'"()[\]{}<>]+)/g;
  let m;
  while ((m = pathRe.exec(text)) !== null) {
    const p = m[0].replace(/[.,:;!?)]+$/, '');
    if (p.length > 3) entities.add(p);
  }
  const fnRe = /(?:function|class|def|const|let|var|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = fnRe.exec(text)) !== null) entities.add(m[1]);
  return entities;
}

function extractEntitiesFromBlocks(blocks: ParsedBlock[]): Set<string> {
  const entities = new Set<string>();
  for (const b of blocks) {
    if (b.text) extractEntities(b.text).forEach(e => entities.add(e));
    if (b.content) extractEntities(b.content).forEach(e => entities.add(e));
    if (b.input) {
      for (const val of Object.values(b.input)) {
        if (typeof val === 'string') extractEntities(val).forEach(e => entities.add(e));
      }
    }
  }
  return entities;
}

function countCharsInBlocks(blocks: ParsedBlock[]): number {
  let total = 0;
  for (const b of blocks) {
    if (b.text) total += b.text.length;
    if (b.content) total += b.content.length;
    if (b.input) total += JSON.stringify(b.input).length;
  }
  return total;
}

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','must','can','could',
  'to','of','in','for','on','with','at','by','from','as','into','through','during',
  'before','after','above','below','between','out','off','over','under','again','further',
  'then','once','here','there','when','where','why','how','all','both','each','few',
  'more','most','other','some','such','no','nor','not','only','own','same','so','than',
  'too','very','just','about','also','and','but','or','if','that','this','it','its',
  'they','them','their','we','our','you','your','he','she','him','her','i','me','my',
  'what','which','who','whom','up','down','new','old','get','set','one','two','see',
  'use','used','using','make','like','need','want','now','well','way','file','line',
  'code','change','add','update','fix','error','work','run','test','sure','need',
  'let','try','thing','look','right','still','back','going','made','take','think',
  'val','var','let','const','function','class','def','fun','fn','func','return',
  'import','export','from','require','module','package','pub','public','private',
  'protected','static','final','abstract','override','interface','type','enum','struct',
  'trait','impl','self','this','super','null','nil','none','true','false','undefined',
  'void','int','string','bool','boolean','float','double','long','byte','char',
  'if','else','elif','elseif','switch','case','match','when','for','while','do',
  'break','continue','throw','try','catch','finally','async','await','yield',
  'new','delete','typeof','instanceof','extends','implements','constructor',
  'println','print','log','console','fmt','printf','sprintf','assert',
  'data','object','companion','sealed','open','internal','inline','suspend',
  'readonly','declare','namespace','keyof','infer','never','unknown','any',
  'src','lib','app','com','org','io','kt','ts','tsx','js','jsx','py','java','go','rs',
  'ok','err','res','req','msg','idx','len','str','num','buf','ctx','cfg','arg','opt',
  'todo','note','hack','fixme','xxx',
]);

function extractTerms(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) || [];
  for (const w of words) {
    if (STOP_WORDS.has(w) || w.length < 3 || w.length > 40) continue;
    if (/^\d+$/.test(w) || /^0x[0-9a-f]+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return counts;
}

function topTerms(terms: Map<string, number>, n: number): string[] {
  return [...terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

function extractFilePaths(blocks: ParsedBlock[]): Set<string> {
  const files = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.input) {
      const fp = b.input['file_path'] || b.input['path'] || b.input['filePath'];
      if (typeof fp === 'string' && fp.length > 1) files.add(fp.split('/').slice(-2).join('/'));
    }
  }
  return files;
}

function computeToolFreqs(msgs: ParsedMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of msgs) {
    for (const b of (m.blocks || [])) {
      if (b.type === 'tool_use' && b.toolName) counts.set(b.toolName, (counts.get(b.toolName) || 0) + 1);
    }
  }
  return counts;
}

function computeContextHealth(messages: ParsedMessage[]): ContextHealth {
  const compactions: CompactionEvent[] = [];
  let prevBoundary = 0;

  const compactionIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].isCompactSummary) compactionIndices.push(i);
  }

  for (const ci of compactionIndices) {
    const preMsgs = messages.slice(prevBoundary, ci);
    const msg = messages[ci];
    const summaryText = msg.blocks?.[0]?.text || '';
    const summaryChars = summaryText.length;

    // --- Information Loss ---
    let preChars = 0;
    let toolCallsCompacted = 0;
    const preEntities = new Set<string>();
    for (const pm of preMsgs) {
      preChars += countCharsInBlocks(pm.blocks || []);
      for (const b of (pm.blocks || [])) {
        if (b.type === 'tool_use') toolCallsCompacted++;
      }
      extractEntitiesFromBlocks(pm.blocks || []).forEach(e => preEntities.add(e));
    }

    const summaryEntities = extractEntities(summaryText);
    const entitiesLost: string[] = [];
    const entitiesRetained: string[] = [];
    for (const e of preEntities) {
      if (summaryEntities.has(e)) entitiesRetained.push(e);
      else entitiesLost.push(e);
    }

    const timestamps = preMsgs.filter(m => m.timestamp).map(m => new Date(m.timestamp!).getTime());
    let timeSpanSeconds = 0;
    if (timestamps.length >= 2) timeSpanSeconds = Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 1000);

    // --- Behavioral Diff ---
    const nextCi = compactionIndices.find(x => x > ci);
    const postMsgs = messages.slice(ci + 1, nextCi ?? messages.length);

    // Tool shifts
    const preTools = computeToolFreqs(preMsgs);
    const postTools = computeToolFreqs(postMsgs);
    const allTools = new Set([...preTools.keys(), ...postTools.keys()]);
    const preAsstCount = preMsgs.filter(m => m.type === 'assistant').length || 1;
    const postAsstCount = postMsgs.filter(m => m.type === 'assistant').length || 1;
    const toolShifts: ToolShift[] = [];
    let shiftedTools = 0;
    for (const tool of allTools) {
      const prePct = Math.round(((preTools.get(tool) || 0) / preAsstCount) * 100);
      const postPct = Math.round(((postTools.get(tool) || 0) / postAsstCount) * 100);
      const delta = postPct - prePct;
      if (Math.abs(delta) >= 3) shiftedTools++;
      toolShifts.push({ tool, prePct, postPct, delta });
    }
    toolShifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    // File focus
    const preFiles = new Set<string>();
    const postFiles = new Set<string>();
    for (const m of preMsgs) extractFilePaths(m.blocks || []).forEach(f => preFiles.add(f));
    for (const m of postMsgs) extractFilePaths(m.blocks || []).forEach(f => postFiles.add(f));
    const filesDropped = [...preFiles].filter(f => !postFiles.has(f));
    const filesAdded = [...postFiles].filter(f => !preFiles.has(f));
    const filesContinued = [...preFiles].filter(f => postFiles.has(f));

    // Response pattern
    const preAsstMsgs = preMsgs.filter(m => m.type === 'assistant');
    const postAsstMsgs = postMsgs.filter(m => m.type === 'assistant');
    const thinkingRatePre = preAsstMsgs.length > 0
      ? Math.round((preAsstMsgs.filter(m => (m.blocks || []).some(b => b.type === 'thinking')).length / preAsstMsgs.length) * 100) : 0;
    const thinkingRatePost = postAsstMsgs.length > 0
      ? Math.round((postAsstMsgs.filter(m => (m.blocks || []).some(b => b.type === 'thinking')).length / postAsstMsgs.length) * 100) : 0;
    const avgLen = (ms: ParsedMessage[]) => ms.length === 0 ? 0 : Math.round(ms.reduce((s, m) => s + countCharsInBlocks(m.blocks || []), 0) / ms.length);
    const avgResponseLenPre = avgLen(preAsstMsgs);
    const avgResponseLenPost = avgLen(postAsstMsgs);

    // Topic shift
    const preTerms = new Map<string, number>();
    for (const m of preMsgs) for (const b of (m.blocks || [])) for (const [t, c] of extractTerms(b.text || b.content || '')) preTerms.set(t, (preTerms.get(t) || 0) + c);
    const summaryTerms = extractTerms(summaryText);
    const topPre = topTerms(preTerms, 20);
    const summaryMissed = topPre.filter(t => !summaryTerms.has(t)).slice(0, 15);

    // Drift severity
    const totalPreFiles = preFiles.size || 1;
    const fileDrift = (filesDropped.length / totalPreFiles) * 30;
    const totalPreTopics = topPre.length || 1;
    const topicDrift = (summaryMissed.length / totalPreTopics) * 30;
    const toolDriftScore = (shiftedTools / (allTools.size || 1)) * 20;
    const summaryCoverage = topPre.length > 0 ? topPre.filter(t => summaryTerms.has(t)).length / topPre.length : 1;
    const coverageGap = (1 - summaryCoverage) * 20;
    const driftSeverity = Math.min(100, Math.round(fileDrift + topicDrift + toolDriftScore + coverageGap));

    compactions.push({
      index: ci, timestamp: msg.timestamp,
      messagesCompacted: preMsgs.length, preChars, summaryChars,
      compressionRatio: summaryChars > 0 ? Math.round((preChars / summaryChars) * 10) / 10 : 0,
      entitiesLost: entitiesLost.slice(0, 50), entitiesRetained: entitiesRetained.slice(0, 50),
      toolCallsCompacted, timeSpanSeconds,
      toolShifts: toolShifts.slice(0, 10),
      filesDropped: filesDropped.slice(0, 20), filesAdded: filesAdded.slice(0, 20), filesContinued: filesContinued.slice(0, 10),
      thinkingRatePre, thinkingRatePost, avgResponseLenPre, avgResponseLenPost,
      summaryMissed, driftSeverity,
    });

    prevBoundary = ci + 1;
  }

  const totalPreChars = compactions.reduce((s, c) => s + c.preChars, 0);
  const totalSummaryChars = compactions.reduce((s, c) => s + c.summaryChars, 0);

  let healthScore = 100;
  for (const c of compactions) {
    healthScore -= Math.min(20, c.compressionRatio / 10);
    const totalEnts = c.entitiesLost.length + c.entitiesRetained.length;
    if (totalEnts > 0) healthScore -= (c.entitiesLost.length / totalEnts) * 15;
  }
  healthScore = Math.max(0, Math.round(healthScore));

  const overallDriftSeverity = compactions.length > 0
    ? Math.round(compactions.reduce((s, c) => s + c.driftSeverity, 0) / compactions.length) : 0;

  return {
    compactionCount: compactions.length, compactions,
    overallCompressionRatio: totalSummaryChars > 0 ? Math.round((totalPreChars / totalSummaryChars) * 10) / 10 : 0,
    totalEntitiesLost: compactions.reduce((s, c) => s + c.entitiesLost.length, 0),
    totalEntitiesRetained: compactions.reduce((s, c) => s + c.entitiesRetained.length, 0),
    healthScore, overallDriftSeverity,
  };
}

// ---------------------------------------------------------------------------
// In-memory caches — mtime-based invalidation avoids redundant file reads
// ---------------------------------------------------------------------------

interface CachedFileParse {
  mtimeMs: number;
  sizeBytes: number;
  messages: ParsedMessage[];
}

const fileParseCache = new Map<string, CachedFileParse>();
const MAX_FILE_CACHE_ENTRIES = 500;

function evictOldestCacheEntries() {
  if (fileParseCache.size <= MAX_FILE_CACHE_ENTRIES) return;
  const excess = fileParseCache.size - MAX_FILE_CACHE_ENTRIES;
  const iter = fileParseCache.keys();
  for (let i = 0; i < excess; i++) {
    const key = iter.next().value;
    if (key) fileParseCache.delete(key);
  }
}

async function getOrParseFile(filePath: string): Promise<CachedFileParse> {
  const fileStat = await stat(filePath);
  const cached = fileParseCache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.sizeBytes === fileStat.size) {
    return cached;
  }
  const content = await readFile(filePath, 'utf-8');
  const rawLines = content.trim().split('\n').map(parseLine).filter((x): x is RawEntry => x !== null);
  const messages = parseTranscriptFull(rawLines);
  const entry: CachedFileParse = { mtimeMs: fileStat.mtimeMs, sizeBytes: fileStat.size, messages };
  fileParseCache.set(filePath, entry);
  evictOldestCacheEntries();
  return entry;
}

interface CachedSessionMeta {
  mtimeMs: number;
  sizeBytes: number;
  sessionId: string;
  isAgent: boolean;
  title: string;
  startTime: string | null;
  endTime: string | null;
  messageCount: number;
  toolCallCount: number;
  thinkingBlockCount: number;
  summaryCount: number;
  fileSize: number;
  costUSD: number;
}

const sessionMetaCache = new Map<string, CachedSessionMeta>();

async function getSessionMeta(filePath: string, projectDir: string, project: string): Promise<CachedSessionMeta> {
  const fileStat = await stat(filePath);
  const cached = sessionMetaCache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.sizeBytes === fileStat.size) {
    return cached;
  }
  const { messages } = await getOrParseFile(filePath);
  const file = filePath.split('/').pop()!;
  const isAgent = file.startsWith('agent-');
  const sessionId = file.replace('.jsonl', '');
  const main = messages.filter(m => !m.isSidechain);
  const firstUser = main.find(m => m.type === 'user' && m.blocks?.some(b => b.type === 'text'));
  const title = (firstUser?.blocks?.find(b => b.type === 'text')?.text || '').slice(0, 140) || '(empty)';
  const summaryCount = messages.filter(m => m.blocks?.some(b => b.type === 'summary')).length;
  const ts = messages.filter(m => m.timestamp).map(m => new Date(m.timestamp!));
  const start = ts.length ? new Date(Math.min(...ts.map(t => t.getTime()))) : null;
  const end = ts.length ? new Date(Math.max(...ts.map(t => t.getTime()))) : null;
  // Include subagent files for cost calculation with dedup
  const sessionSubDir = join(projectDir, sessionId);
  const sessionFiles = [filePath];
  if (existsSync(sessionSubDir)) sessionFiles.push(...await findJsonlFiles(sessionSubDir));
  const sessionUsage = await aggregateUsage(sessionFiles, 'all');
  const startIso = start?.toISOString() || null;
  const endIso = end?.toISOString() || null;
  updateSessionCache(project, sessionId, sessionUsage, startIso, endIso);
  const meta: CachedSessionMeta = {
    mtimeMs: fileStat.mtimeMs, sizeBytes: fileStat.size,
    sessionId, isAgent, title,
    startTime: startIso, endTime: endIso,
    messageCount: main.length,
    toolCallCount: main.reduce((n, m) => n + (m.blocks || []).filter(b => b.type === 'tool_use').length, 0),
    thinkingBlockCount: main.reduce((n, m) => n + (m.blocks || []).filter(b => b.type === 'thinking').length, 0),
    summaryCount, fileSize: fileStat.size, costUSD: sessionUsage.totalCostUSD,
  };
  sessionMetaCache.set(filePath, meta);
  return meta;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/api/projects', async (_req: Request, res: Response) => {
  try {
    if (!existsSync(PROJECTS_DIR)) return res.json({ projects: [], error: `Not found: ${PROJECTS_DIR}` });
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    refreshActiveState();
    const dirEntries = entries.filter(e => e.isDirectory());
    const projects = await parallelMap(dirEntries, async (e) => {
      const projectDir = join(PROJECTS_DIR, e.name);
      const files = await readdir(projectDir);
      const sessions = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));
      const fullPath = '/' + e.name.replace(/^-+/, '').replaceAll('-', '/');
      const displayName = fullPath.startsWith(homedir()) ? '~' + fullPath.slice(homedir().length) : fullPath;
      const isActive = isProjectActive(e.name);
      // Use persisted usage cache as primary cost source
      const cachedSessions = getCachedUsageForProject(e.name);
      let costUSD: number;
      if (cachedSessions.length > 0) {
        costUSD = cachedSessions.reduce((sum, cs) => sum + cs.totalCostUSD, 0);
      } else {
        // Fallback: read files only when no cache exists yet
        const allProjectFiles = await findJsonlFiles(projectDir);
        const projectUsage = await aggregateUsage(allProjectFiles, 'all');
        costUSD = projectUsage.totalCostUSD;
      }
      return { name: e.name, displayName, sessionCount: sessions.length, isActive, costUSD };
    }, 10);
    projects.sort((a, b) => b.sessionCount - a.sessionCount);
    res.json({ projects });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/sessions', async (req: Request, res: Response) => {
  try {
    const { project } = req.query as { project?: string };
    if (!project) return res.status(400).json({ error: 'project required' });
    const projectDir = join(PROJECTS_DIR, project);
    if (!existsSync(projectDir)) return res.json({ sessions: [] });
    const files = await readdir(projectDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    refreshActiveState();
    // Parallel session metadata extraction with caching
    const sessions = await parallelMap(jsonlFiles, async (file) => {
      const filePath = join(projectDir, file);
      try {
        const meta = await getSessionMeta(filePath, projectDir, project);
        return {
          sessionId: meta.sessionId, isAgent: meta.isAgent, title: meta.title,
          startTime: meta.startTime, endTime: meta.endTime,
          messageCount: meta.messageCount, toolCallCount: meta.toolCallCount,
          thinkingBlockCount: meta.thinkingBlockCount, summaryCount: meta.summaryCount,
          fileSize: meta.fileSize,
          isActive: isSessionActive(meta.sessionId, project),
          costUSD: meta.costUSD,
        };
      } catch {
        const fileStat = await stat(filePath);
        const sessionId = file.replace('.jsonl', '');
        return {
          sessionId, isAgent: file.startsWith('agent-'),
          title: '(error)', startTime: fileStat.mtime.toISOString(), endTime: null as string | null,
          messageCount: 0, toolCallCount: 0, thinkingBlockCount: 0, summaryCount: 0,
          fileSize: fileStat.size,
          isActive: isSessionActive(sessionId, project), costUSD: 0,
        };
      }
    }, 10);
    // Append archived sessions from cache (JSONL no longer exists)
    const liveIds = new Set(sessions.map(s => s.sessionId));
    const cached = getCachedUsageForProject(project);
    for (const entry of cached) {
      if (liveIds.has(entry.sessionId)) continue;
      sessions.push({
        sessionId: entry.sessionId,
        isAgent: entry.sessionId.startsWith('agent-'),
        title: '(archived)',
        startTime: entry.startTime,
        endTime: entry.endTime,
        messageCount: entry.messageCount,
        toolCallCount: 0, thinkingBlockCount: 0, summaryCount: 0,
        fileSize: 0,
        isActive: false,
        costUSD: entry.totalCostUSD,
      });
    }
    sessions.sort((a, b) => {
      const ta = new Date(a.endTime || a.startTime).getTime();
      const tb = new Date(b.endTime || b.startTime).getTime();
      return tb - ta;
    });
    res.json({ sessions });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/session/:project/:sessionId', async (req: Request<{ project: string; sessionId: string }>, res: Response) => {
  try {
    const { project, sessionId } = req.params;
    const filePath = join(PROJECTS_DIR, project, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    const { messages } = await getOrParseFile(filePath);
    const mainMessages = messages.filter(m => !m.isSidechain);
    const composition = computeContextComposition(mainMessages);
    const contextHealth = computeContextHealth(mainMessages);
    res.json({ messages, composition, contextHealth });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.delete('/api/session/:project/:sessionId', async (req: Request<{ project: string; sessionId: string }>, res: Response) => {
  try {
    const { project, sessionId } = req.params;
    refreshActiveState();
    if (isSessionActive(sessionId, project)) return res.status(409).json({ error: 'Cannot delete an active session' });
    const filePath = join(PROJECTS_DIR, project, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    await unlink(filePath);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.delete('/api/project/:project', async (req: Request<{ project: string }>, res: Response) => {
  try {
    const { project } = req.params;
    const projectDir = join(PROJECTS_DIR, project);
    if (!existsSync(projectDir)) return res.status(404).json({ error: 'Not found' });
    refreshActiveState();
    if (isProjectActive(project)) return res.status(409).json({ error: 'Cannot delete a project with active sessions' });
    await rm(projectDir, { recursive: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ---------------------------------------------------------------------------
// Usage stats aggregation
// ---------------------------------------------------------------------------

type UsageRange = 'day' | 'week' | 'month' | 'year' | 'all';

// Per-million-token pricing (USD) from https://platform.claude.com/docs/en/about-claude/pricing
interface ModelPricing {
  input: number;       // base input $/MTok
  output: number;      // output $/MTok
  cacheWrite: number;  // 5-min cache write $/MTok (1.25x input)
  cacheRead: number;   // cache hit $/MTok (0.1x input)
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6':             { input: 5,    output: 25,   cacheWrite: 6.25,  cacheRead: 0.50 },
  'claude-opus-4-5-20251101':    { input: 5,    output: 25,   cacheWrite: 6.25,  cacheRead: 0.50 },
  'claude-opus-4-5-20250929':    { input: 5,    output: 25,   cacheWrite: 6.25,  cacheRead: 0.50 },
  'claude-opus-4-1-20250414':    { input: 15,   output: 75,   cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4-20250514':      { input: 15,   output: 75,   cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-5-20250929':  { input: 3,    output: 15,   cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-sonnet-4-20250514':    { input: 3,    output: 15,   cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-sonnet-3-7-20250219':  { input: 3,    output: 15,   cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5-20251001':   { input: 1,    output: 5,    cacheWrite: 1.25,  cacheRead: 0.10 },
  'claude-haiku-3-5-20241022':   { input: 0.80, output: 4,    cacheWrite: 1,     cacheRead: 0.08 },
  'claude-3-opus-20240229':      { input: 15,   output: 75,   cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-3-haiku-20240307':     { input: 0.25, output: 1.25, cacheWrite: 0.30,  cacheRead: 0.03 },
};

function findPricing(model: string): ModelPricing | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Fuzzy match: e.g. "claude-opus-4-6" matches key prefix
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key) || key.startsWith(model)) return pricing;
  }
  // Match by family keywords
  if (/opus.*(4\.6|4-6)/.test(model))    return MODEL_PRICING['claude-opus-4-6'];
  if (/opus.*(4\.5|4-5)/.test(model))    return MODEL_PRICING['claude-opus-4-5-20251101'];
  if (/opus.*(4\.1|4-1)/.test(model))    return MODEL_PRICING['claude-opus-4-1-20250414'];
  if (/opus.*4[^.]/.test(model))         return MODEL_PRICING['claude-opus-4-20250514'];
  if (/sonnet.*(4\.5|4-5)/.test(model))  return MODEL_PRICING['claude-sonnet-4-5-20250929'];
  if (/sonnet.*4/.test(model))           return MODEL_PRICING['claude-sonnet-4-20250514'];
  if (/sonnet.*3/.test(model))           return MODEL_PRICING['claude-sonnet-3-7-20250219'];
  if (/haiku.*(4\.5|4-5)/.test(model))   return MODEL_PRICING['claude-haiku-4-5-20251001'];
  if (/haiku.*3\.5/.test(model))         return MODEL_PRICING['claude-haiku-3-5-20241022'];
  if (/haiku.*3/.test(model))            return MODEL_PRICING['claude-3-haiku-20240307'];
  return null;
}

function calcCostFromTokens(model: string, u: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }): number {
  const p = findPricing(model);
  if (!p) return 0;
  const M = 1_000_000;
  return ((u.input_tokens || 0) * p.input
    + (u.output_tokens || 0) * p.output
    + (u.cache_creation_input_tokens || 0) * p.cacheWrite
    + (u.cache_read_input_tokens || 0) * p.cacheRead) / M;
}

function getRangeCutoff(range: UsageRange): Date | null {
  if (range === 'all') return null;
  // Use calendar boundaries (local timezone midnight) to match ccusage behavior
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (range) {
    case 'day': return startOfToday;
    case 'week': return new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - 6);
    case 'month': return new Date(startOfToday.getFullYear(), startOfToday.getMonth() - 1, startOfToday.getDate());
    case 'year': return new Date(startOfToday.getFullYear() - 1, startOfToday.getMonth(), startOfToday.getDate());
  }
}

interface UsageStatsResult {
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  messageCount: number;
  sessionCount: number;
  models: Record<string, { cost: number; messages: number }>;
}

function computeUsageStats(messages: ParsedMessage[], range: UsageRange, seenHashes?: Set<string>): Omit<UsageStatsResult, 'sessionCount'> {
  const cutoff = getRangeCutoff(range);
  const seen = seenHashes || new Set<string>();
  const result = {
    totalCostUSD: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    messageCount: 0,
    models: {} as Record<string, { cost: number; messages: number }>,
  };
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    // Dedup by messageId + requestId (same logic as ccusage)
    if (msg.messageId && msg.requestId) {
      const hash = `${msg.messageId}:${msg.requestId}`;
      if (seen.has(hash)) continue;
      seen.add(hash);
    }
    const model = msg.model || 'unknown';
    // Skip synthetic model entries (matches ccusage behavior)
    if (model === '<synthetic>') continue;
    if (cutoff && msg.timestamp) {
      const ts = new Date(msg.timestamp);
      if (ts < cutoff) continue;
    }
    result.messageCount++;
    const u = msg.usage as { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | null;
    if (u) {
      result.totalInputTokens += u.input_tokens || 0;
      result.totalOutputTokens += u.output_tokens || 0;
      result.totalCacheCreationTokens += u.cache_creation_input_tokens || 0;
      result.totalCacheReadTokens += u.cache_read_input_tokens || 0;
    }
    // Use costUSD if available, otherwise calculate from tokens + model pricing
    const cost = msg.costUSD != null ? msg.costUSD : (u && model !== 'unknown' ? calcCostFromTokens(model, u) : 0);
    result.totalCostUSD += cost;
    if (!result.models[model]) result.models[model] = { cost: 0, messages: 0 };
    result.models[model].messages++;
    result.models[model].cost += cost;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parallel utilities
// ---------------------------------------------------------------------------

async function parallelMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Recursively find all .jsonl files under a directory (parallel subdirs)
async function findJsonlFiles(dir: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files = entries.filter(e => !e.isDirectory() && e.name.endsWith('.jsonl')).map(e => join(dir, e.name));
  const subdirResults = await Promise.all(
    entries.filter(e => e.isDirectory()).map(e => findJsonlFiles(join(dir, e.name)))
  );
  for (const sub of subdirResults) files.push(...sub);
  return files;
}

// Aggregate usage from a set of .jsonl files with dedup (cached + parallel reads)
async function aggregateUsage(files: string[], range: UsageRange): Promise<UsageStatsResult> {
  const seenHashes = new Set<string>();
  const agg: UsageStatsResult = {
    totalCostUSD: 0, totalInputTokens: 0, totalOutputTokens: 0,
    totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
    messageCount: 0, sessionCount: 0, models: {},
  };
  // Parallel reads with cache — then sequential dedup
  const allMessages = await parallelMap(files, async (file) => {
    try {
      const { messages } = await getOrParseFile(file);
      return messages;
    } catch { return null; }
  }, 10);
  for (const messages of allMessages) {
    if (!messages) continue;
    const stats = computeUsageStats(messages, range, seenHashes);
    agg.totalCostUSD += stats.totalCostUSD;
    agg.totalInputTokens += stats.totalInputTokens;
    agg.totalOutputTokens += stats.totalOutputTokens;
    agg.totalCacheCreationTokens += stats.totalCacheCreationTokens;
    agg.totalCacheReadTokens += stats.totalCacheReadTokens;
    agg.messageCount += stats.messageCount;
    if (stats.messageCount > 0) agg.sessionCount++;
    for (const [model, data] of Object.entries(stats.models)) {
      if (!agg.models[model]) agg.models[model] = { cost: 0, messages: 0 };
      agg.models[model].cost += data.cost;
      agg.models[model].messages += data.messages;
    }
  }
  return agg;
}

// ---------------------------------------------------------------------------
// Usage persistence — survive session/project deletion
// ---------------------------------------------------------------------------

interface PersistedSessionUsage {
  project: string;
  sessionId: string;
  startTime: string | null;
  endTime: string | null;
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  messageCount: number;
  models: Record<string, { cost: number; messages: number }>;
  persistedAt: string;
}

interface PersistedUsageFile {
  version: 1;
  updatedAt: string;
  sessions: Record<string, PersistedSessionUsage>;
}

const CACHE_DIR = join(homedir(), '.claude-context-inspector');
const CACHE_FILE = join(CACHE_DIR, 'usage.json');

let usageCache: PersistedUsageFile = { version: 1, updatedAt: new Date().toISOString(), sessions: {} };

// Load cache once at startup (sync)
function loadUsageCache(): void {
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = readFileSync(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && parsed.sessions) {
        usageCache = parsed as PersistedUsageFile;
      }
    }
  } catch {
    // Corrupt or missing — start fresh
    usageCache = { version: 1, updatedAt: new Date().toISOString(), sessions: {} };
  }
}

loadUsageCache();

let savePending = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveUsageCache(): Promise<void> {
  savePending = false;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    usageCache.updatedAt = new Date().toISOString();
    const tmp = CACHE_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(usageCache, null, 2), 'utf-8');
    await rename(tmp, CACHE_FILE);
  } catch {
    // Best-effort — don't crash on write failure
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveUsageCache(); }, 1000);
}

function updateSessionCache(
  project: string,
  sessionId: string,
  stats: Omit<UsageStatsResult, 'sessionCount'>,
  startTime: string | null,
  endTime: string | null,
): void {
  const key = `${project}/${sessionId}`;
  usageCache.sessions[key] = {
    project,
    sessionId,
    startTime,
    endTime,
    totalCostUSD: stats.totalCostUSD,
    totalInputTokens: stats.totalInputTokens,
    totalOutputTokens: stats.totalOutputTokens,
    totalCacheCreationTokens: stats.totalCacheCreationTokens,
    totalCacheReadTokens: stats.totalCacheReadTokens,
    messageCount: stats.messageCount,
    models: { ...stats.models },
    persistedAt: new Date().toISOString(),
  };
  scheduleSave();
}

function getCachedSessionUsage(project: string, sessionId: string): PersistedSessionUsage | null {
  return usageCache.sessions[`${project}/${sessionId}`] || null;
}

function getCachedUsageForProject(project: string): PersistedSessionUsage[] {
  const prefix = `${project}/`;
  return Object.entries(usageCache.sessions)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry);
}

function mergeModelMaps(
  a: Record<string, { cost: number; messages: number }>,
  b: Record<string, { cost: number; messages: number }>,
): Record<string, { cost: number; messages: number }> {
  const merged = { ...a };
  for (const [model, data] of Object.entries(b)) {
    if (!merged[model]) merged[model] = { cost: 0, messages: 0 };
    merged[model].cost += data.cost;
    merged[model].messages += data.messages;
  }
  return merged;
}

function aggregateCachedUsage(entries: PersistedSessionUsage[]): UsageStatsResult {
  const result: UsageStatsResult = {
    totalCostUSD: 0, totalInputTokens: 0, totalOutputTokens: 0,
    totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
    messageCount: 0, sessionCount: 0, models: {},
  };
  for (const e of entries) {
    result.totalCostUSD += e.totalCostUSD;
    result.totalInputTokens += e.totalInputTokens;
    result.totalOutputTokens += e.totalOutputTokens;
    result.totalCacheCreationTokens += e.totalCacheCreationTokens;
    result.totalCacheReadTokens += e.totalCacheReadTokens;
    result.messageCount += e.messageCount;
    if (e.messageCount > 0) result.sessionCount++;
    result.models = mergeModelMaps(result.models, e.models);
  }
  return result;
}

app.get('/api/usage', async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as UsageRange) || 'all';
    const scope = (req.query.scope as string) || 'all';
    const project = req.query.project as string | undefined;
    const sessionId = req.query.sessionId as string | undefined;

    const emptyResult = { totalCostUSD: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0, messageCount: 0, sessionCount: 0, models: {} };

    if (scope === 'session' && project && sessionId) {
      const filePath = join(PROJECTS_DIR, project, `${sessionId}.jsonl`);
      if (!existsSync(filePath)) {
        // Fall back to cached data for deleted sessions
        const cached = getCachedSessionUsage(project, sessionId);
        if (cached) {
          return res.json({
            totalCostUSD: cached.totalCostUSD,
            totalInputTokens: cached.totalInputTokens,
            totalOutputTokens: cached.totalOutputTokens,
            totalCacheCreationTokens: cached.totalCacheCreationTokens,
            totalCacheReadTokens: cached.totalCacheReadTokens,
            messageCount: cached.messageCount,
            sessionCount: cached.messageCount > 0 ? 1 : 0,
            models: cached.models,
          } satisfies UsageStatsResult);
        }
        return res.json(emptyResult);
      }
      // Include session file + its subagent files, with dedup
      const sessionDir = join(PROJECTS_DIR, project, sessionId);
      const files = [filePath];
      if (existsSync(sessionDir)) files.push(...await findJsonlFiles(sessionDir));
      const liveResult = await aggregateUsage(files, range);
      updateSessionCache(project, sessionId, liveResult, null, null);
      return res.json(liveResult);
    }

    let projectDirs: string[] = [];
    if (scope === 'project' && project) {
      projectDirs = [project];
    } else {
      if (!existsSync(PROJECTS_DIR)) return res.json(emptyResult);
      const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
      projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    }

    // Recursively find all .jsonl files across selected projects, with global dedup
    const allFiles: string[] = [];
    for (const pd of projectDirs) {
      const dir = join(PROJECTS_DIR, pd);
      allFiles.push(...await findJsonlFiles(dir));
    }

    const liveResult = await aggregateUsage(allFiles, range);

    // Merge cached sessions not covered by live files
    const liveBasenames = new Set(allFiles.map(f => {
      const parts = f.split('/');
      const fileName = parts.pop()!.replace('.jsonl', '');
      const projectName = parts[parts.indexOf('projects') + 1];
      return `${projectName}/${fileName}`;
    }));
    const cutoff = getRangeCutoff(range);
    const archivedEntries: PersistedSessionUsage[] = [];
    const searchProjects = scope === 'project' && project ? [project] : projectDirs;
    for (const pd of searchProjects) {
      for (const entry of getCachedUsageForProject(pd)) {
        const key = `${pd}/${entry.sessionId}`;
        if (liveBasenames.has(key)) continue;
        // Filter by time range: include if endTime >= cutoff (or no cutoff)
        if (cutoff && entry.endTime) {
          if (new Date(entry.endTime) < cutoff) continue;
        }
        archivedEntries.push(entry);
      }
    }
    if (archivedEntries.length > 0) {
      const cachedResult = aggregateCachedUsage(archivedEntries);
      liveResult.totalCostUSD += cachedResult.totalCostUSD;
      liveResult.totalInputTokens += cachedResult.totalInputTokens;
      liveResult.totalOutputTokens += cachedResult.totalOutputTokens;
      liveResult.totalCacheCreationTokens += cachedResult.totalCacheCreationTokens;
      liveResult.totalCacheReadTokens += cachedResult.totalCacheReadTokens;
      liveResult.messageCount += cachedResult.messageCount;
      liveResult.sessionCount += cachedResult.sessionCount;
      liveResult.models = mergeModelMaps(liveResult.models, cachedResult.models);
    }

    res.json(liveResult);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ---------------------------------------------------------------------------
// SSE — push file-change notifications to connected clients
// ---------------------------------------------------------------------------

const sseClients = new Set<Response>();

app.get('/api/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(':\n\n'); // heartbeat comment to flush headers
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

// Debounce rapid bursts of file-system events into a single notification
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPaths = new Set<string>();

function invalidateCachesForPath(path: string) {
  if (path.endsWith('.jsonl')) {
    fileParseCache.delete(path);
    sessionMetaCache.delete(path);
  }
}

function onFsChange(path: string) {
  invalidateCachesForPath(path);
  pendingPaths.add(path);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    broadcast('change', { paths: [...pendingPaths] });
    pendingPaths.clear();
    debounceTimer = null;
  }, 500);
}

function onFsUnlink(path: string) {
  invalidateCachesForPath(path);
  onFsChange(path);
}

if (existsSync(PROJECTS_DIR)) {
  chokidar
    .watch(PROJECTS_DIR, { ignoreInitial: true, depth: 2 })
    .on('add', onFsChange)
    .on('change', onFsChange)
    .on('unlink', onFsUnlink);
}

// ---------------------------------------------------------------------------

app.get('*', (_req: Request, res: Response) => { res.sendFile(join(__dirname, '..', 'dist', 'index.html')); });

const PID_FILE = join(CACHE_DIR, 'daemon.pid');

app.listen(PORT, async () => {
  console.log(`\n  🔍 Claude Context Inspector`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → Reading from: ${PROJECTS_DIR}`);
  console.log(`  → Live-reload: enabled\n`);

  if (process.env.DAEMON === '1') {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(PID_FILE, String(process.pid), 'utf-8');
  }
});

process.on('SIGTERM', async () => {
  try { await unlink(PID_FILE); } catch { /* ignore */ }
  process.exit(0);
});
