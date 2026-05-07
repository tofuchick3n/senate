import { createLogUpdate } from 'log-update';
import type { WorkflowEvent, WorkflowResult } from './workflow.js';

/**
 * Live auto-refreshing dashboard for the workflow.
 *
 * Subscribes to WorkflowEvents (via the existing onEvent plumbing) and
 * renders a per-advisor panel with status, spinner, elapsed time, and
 * the last stdout line. Re-renders on a timer so spinners animate and
 * elapsed times tick even between events.
 *
 * Only safe when stderr is a TTY and machine modes are off — caller
 * decides; if conditions aren't met, fall back to the regular event
 * stream + final formatter.
 *
 * Limitations:
 *   - No keypress expand-to-full-output yet (raw-mode stdin conflicts
 *     with stdin-as-prompt; would need careful state management).
 *   - Renders to stderr (same channel as our existing progress chatter)
 *     so the final result on stdout stays unpolluted.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

type AdvisorState = {
  name: string;
  status: 'pending' | 'ok' | 'error' | 'cancelled' | 'unauthenticated' | 'missing';
  startMs: number;
  endMs?: number;
  error?: string;
};

type SynthState = {
  status: 'pending' | 'ok' | 'failed' | 'skipped';
  engine?: string;
  startMs?: number;
  endMs?: number;
};

type ExecState = {
  status: 'pending' | 'ok' | 'error' | 'cancelled' | 'skipped';
  startMs?: number;
  endMs?: number;
};

export type TuiHandle = {
  /** Wire this into runWorkflow's `onEvent`. */
  onEvent: (e: WorkflowEvent) => void;
  /** Stops the timer and clears the live region (so cli.ts's final formatter is the sole post-completion output). */
  stop: (result?: WorkflowResult) => void;
};

export type TuiOptions = {
  /** One-line advisor summary rendered in the dashboard header (e.g. from `formatAdvisorLine`). Optional. */
  advisorLine?: string;
};

export function startTui(opts: TuiOptions = {}): TuiHandle {
  const advisors = new Map<string, AdvisorState>();
  let synth: SynthState = { status: 'skipped' };
  let exec: ExecState = { status: 'skipped' };
  let phase: 'decide' | 'consult' | 'synth' | 'execute' | 'done' = 'decide';
  let frameIdx = 0;
  const startedAt = Date.now();

  // Render to stderr so stdout stays clean for piping.
  const render = createLogUpdate(process.stderr, { showCursor: false });

  const elapsed = (start: number, end?: number) => {
    const ms = (end ?? Date.now()) - start;
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  };

  const statusGlyph = (s: AdvisorState['status']) => {
    if (s === 'pending') return FRAMES[frameIdx % FRAMES.length];
    if (s === 'ok') return '✓';
    return '✗';
  };

  const synthGlyph = () => {
    if (synth.status === 'pending') return FRAMES[frameIdx % FRAMES.length];
    if (synth.status === 'ok') return '✓';
    if (synth.status === 'failed') return '✗';
    return '·';
  };

  const execGlyph = () => {
    if (exec.status === 'pending') return FRAMES[frameIdx % FRAMES.length];
    if (exec.status === 'ok') return '✓';
    if (exec.status === 'error' || exec.status === 'cancelled') return '✗';
    return '·';
  };

  function build(): string {
    const lines: string[] = [];
    lines.push('SENATE');
    if (opts.advisorLine) lines.push(`  ${opts.advisorLine}`);

    if (phase === 'decide') {
      lines.push(`  ${FRAMES[frameIdx % FRAMES.length]} preparing...`);
    }

    if (advisors.size > 0) {
      lines.push('');
      lines.push(`  CONSULT (${advisors.size} in parallel)`);
      for (const a of advisors.values()) {
        const g = statusGlyph(a.status);
        const t = elapsed(a.startMs, a.endMs).padStart(7);
        const detail = a.status === 'pending'
          ? 'working...'
          : (a.status === 'ok' ? 'done' : (a.error || a.status));
        lines.push(`    [${g}] ${a.name.padEnd(8)} ${t}   ${detail}`);
      }
    }

    if (synth.status !== 'skipped') {
      lines.push('');
      const t = synth.startMs ? elapsed(synth.startMs, synth.endMs).padStart(7) : '       ';
      const detail = synth.status === 'ok' ? `via ${synth.engine}` : synth.status === 'failed' ? 'all leads failed' : 'working...';
      lines.push(`  [${synthGlyph()}] SYNTHESIZE      ${t}   ${detail}`);
    }

    if (exec.status !== 'skipped') {
      lines.push('');
      const t = exec.startMs ? elapsed(exec.startMs, exec.endMs).padStart(7) : '       ';
      lines.push(`  [${execGlyph()}] EXECUTE (vibe)  ${t}`);
    }

    lines.push('');
    lines.push(`  ${elapsed(startedAt)} total elapsed`);
    return lines.join('\n');
  }

  const tick = () => {
    frameIdx = (frameIdx + 1) % FRAMES.length;
    render(build());
  };

  // Initial paint and timer.
  render(build());
  const timer: NodeJS.Timeout = setInterval(tick, 80);
  // Don't keep the process alive on the timer alone.
  if (typeof timer.unref === 'function') timer.unref();

  function onEvent(e: WorkflowEvent) {
    switch (e.type) {
      case 'orchestrator_start':
      case 'orchestrator_done':
        phase = 'decide';
        break;
      case 'consult_start': {
        phase = 'consult';
        const now = Date.now();
        for (const name of e.advisors) {
          if (!advisors.has(name)) {
            advisors.set(name, { name, status: 'pending', startMs: now });
          }
        }
        break;
      }
      case 'engine_done': {
        const a = advisors.get(e.name);
        if (a) {
          a.status = e.status as AdvisorState['status'];
          a.endMs = a.startMs + e.durationMs;
          a.error = e.error;
        }
        break;
      }
      case 'consult_done':
        // Advisors all settled.
        break;
      case 'synthesis_start':
        phase = 'synth';
        synth = { status: 'pending', startMs: Date.now() };
        break;
      case 'synthesis_done':
        synth.endMs = (synth.startMs ?? Date.now()) + e.durationMs;
        synth.status = e.engine ? 'ok' : 'failed';
        synth.engine = e.engine ?? undefined;
        break;
      case 'execute_start':
        phase = 'execute';
        exec = { status: 'pending', startMs: Date.now() };
        break;
      case 'execute_done':
        exec.endMs = Date.now();
        exec.status = e.status === 'ok' ? 'ok' : (e.status === 'cancelled' ? 'cancelled' : 'error');
        break;
    }
    render(build());
  }

  function stop(_result?: WorkflowResult) {
    clearInterval(timer);
    // Clear the live region so cli.ts's final formatter is the sole post-completion output
    // (otherwise the dashboard's last frame would be visually duplicated by the result block).
    render.clear();
    render.done();
  }

  return { onEvent, stop };
}
