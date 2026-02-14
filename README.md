# Claude Context Inspector

A local web UI for inspecting what's actually inside Claude Code's context window — conversation content, agent thinking process, tool call decisions, and compaction summaries.

## What You Can See

- **Context Composition** — visual breakdown of what's in context: user text vs thinking blocks vs tool inputs vs tool results vs compaction summaries
- **Tool Usage Profile** — which tools Claude called, how often, with full input/output inspection
- **Thinking Blocks** — expand any assistant message to read Claude's internal reasoning before it acts
- **Compaction Summaries** — highlighted `📝 SUMMARY` blocks showing exactly what survived context compaction
- **Sidechain / Sub-agent** — dimmed messages from Task-tool sub-agents, separate from main conversation
- **Content Search** — full-text search across all message content, thinking, tool I/O
- **Filters** — toggle visibility by message type (user / assistant / system / summary / sidechain)

## Data Source

Reads Claude Code's JSONL transcript files directly:

```
~/.claude/projects/<project-name>/<session-id>.jsonl
```

Each line contains a typed message (`user`, `assistant`, `system`, `summary`) with content blocks:
- `text` — plain text content
- `thinking` — Claude's chain-of-thought reasoning
- `tool_use` — tool name + input params (Read, Write, Bash, Grep, etc.)
- `tool_result` — output from tool execution
- `summary` — compaction summary preserving session state

## Quick Start

```bash
npx claude-context-inspector
# → http://localhost:3456
```

Or install globally:

```bash
npm i -g claude-context-inspector
ccinspector
```

## Daemon Mode

Run the inspector as a background service instead of blocking your terminal:

```bash
ccinspector start            # start as background daemon
ccinspector start -p 8080    # start on a custom port
ccinspector status           # check if daemon is running
ccinspector stop             # stop the daemon
```

Logs are written to `~/.claude-context-inspector/daemon.log`. The PID file is stored at `~/.claude-context-inspector/daemon.pid`.

Running `ccinspector` with no arguments still starts in the foreground as before.

## Development

```bash
git clone https://github.com/johnsonlee/claude-context-inspector.git
cd claude-context-inspector
npm install
npm run dev
# → http://localhost:5173 (proxies API to :3456)
```

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `PORT` | `3456` | Server port |
| `CLAUDE_DIR` | `~/.claude` | Claude Code data directory |

## Tech Stack

- **Backend**: Node.js + Express (reads JSONL, serves structured API)
- **Frontend**: React 18 + Recharts (CDN-loaded, zero build step)
- **Styling**: Dark inspector theme, JetBrains Mono

## License

MIT
