import { runEngine, type EngineResult } from './engines.js';
import { getDecision, type Decision } from './orchestrator.js';
import { synthesize, type SynthesisResult } from './synthesis.js';
import { section, startSpinner } from './ui.js';

export type WorkflowResult = {
  decision: Decision;
  advisorResults: EngineResult[];
  synthesis: SynthesisResult | null;
  executionResult: EngineResult | null;
  totalDurationMs: number;
  cancelled: boolean;
};

export type WorkflowEvent =
  | { type: 'mode'; smart: boolean; consult: boolean; execute: boolean; advisors: string[]; synthesize: boolean }
  | { type: 'orchestrator_start' }
  | { type: 'orchestrator_done'; decision: Decision }
  | { type: 'consult_start'; advisors: string[] }
  | { type: 'engine_done'; name: string; status: EngineResult['status']; durationMs: number; error?: string; output?: string }
  | { type: 'consult_done'; successful: number; total: number; durationMs: number }
  | { type: 'synthesis_start' }
  | { type: 'synthesis_done'; engine: string | null; durationMs: number; output?: string }
  | { type: 'execute_start' }
  | { type: 'execute_done'; status: EngineResult['status']; output?: string; error?: string };

export type RunOptions = {
  consult?: boolean;
  execute?: boolean;
  advisors?: string[];
  synthesize?: boolean;
  smart?: boolean;
  quiet?: boolean;
  onEvent?: (e: WorkflowEvent) => void;
  signal?: AbortSignal;
};

function defaultDecision(prompt: string, options: RunOptions): Decision {
  const consultAdvisors = options.consult ?? true;
  const executeWithVibe = options.execute ?? false;
  return {
    consultAdvisors,
    advisors: options.advisors || ['claude', 'vibe'],
    executeWithVibe,
    explanation: consultAdvisors && !executeWithVibe ? 'Default: consult only'
      : executeWithVibe && !consultAdvisors ? 'User requested execution only'
      : 'User-specified mode'
  };
}

export async function runWorkflow(prompt: string, options: RunOptions = {}): Promise<WorkflowResult> {
  const start = Date.now();
  const log = (line: string) => { if (!options.quiet) process.stderr.write(line + '\n'); };
  const emit = (e: WorkflowEvent) => options.onEvent?.(e);

  // Step 1: Decide. Only consult the orchestrator when --smart is set; otherwise use defaults.
  let decision: Decision;
  if (options.smart) {
    log(section('DECIDE'));
    emit({ type: 'orchestrator_start' });
    const stop = options.quiet ? () => {} : startSpinner('orchestrator deciding');
    try {
      decision = await getDecision(prompt);
    } finally {
      stop();
    }
  } else {
    decision = defaultDecision(prompt, options);
    log(section('DECIDE') + '  (defaults; --smart routes via orchestrator)');
  }
  emit({ type: 'orchestrator_done', decision });

  log(`  · ${decision.explanation}`);
  log(`  · advisors: ${decision.advisors.join(', ')}`);
  log(`  · execute: ${decision.executeWithVibe}`);

  // Step 2: Consult advisors in parallel. Stream is disabled while parallel because interleaved
  // output is unreadable; we print a status line per engine as each one settles.
  let advisorResults: EngineResult[] = [];
  if (decision.consultAdvisors) {
    log(section(`CONSULT (${decision.advisors.length} in parallel)`));
    emit({ type: 'consult_start', advisors: decision.advisors });
    const advisorStart = Date.now();
    const settled = new Set<string>();

    const tasks = decision.advisors.map(async (name) => {
      const t0 = Date.now();
      const result = await runEngine(name, prompt, { inactivityMs: 30000, stream: false, signal: options.signal });
      settled.add(name);
      const elapsed = Date.now() - t0;
      const icon = result.status === 'ok' ? '✓' : '✗';
      const detail = result.error ? ` (${result.error})` : '';
      const pending = decision.advisors.filter(n => !settled.has(n));
      const waitingNote = pending.length > 0 ? `  [waiting: ${pending.join(', ')}]` : '';
      log(`  ${icon} ${name} — ${result.status}${detail} (${elapsed}ms)${waitingNote}`);
      emit({
        type: 'engine_done',
        name,
        status: result.status,
        durationMs: elapsed,
        error: result.error,
        output: result.status === 'ok' ? result.output : undefined
      });
      return result;
    });

    const results = await Promise.allSettled(tasks);
    advisorResults = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { name: decision.advisors[i], status: 'error' as const, output: '', durationMs: 0, error: String(r.reason) }
    );

    const successful = advisorResults.filter(r => r.status === 'ok').length;
    const consultDuration = Date.now() - advisorStart;
    log(`  · ${successful}/${advisorResults.length} responded in ${consultDuration}ms`);
    emit({ type: 'consult_done', successful, total: advisorResults.length, durationMs: consultDuration });
  }

  // Step 3: Synthesize advisor outputs. Skip if explicitly disabled, cancelled, or fewer than 2 succeeded.
  let synthesisResult: SynthesisResult | null = null;
  const wantSynthesis = options.synthesize !== false && !options.signal?.aborted;
  if (wantSynthesis && advisorResults.filter(r => r.status === 'ok').length >= 2) {
    log(section('SYNTHESIZE'));
    emit({ type: 'synthesis_start' });
    const t0 = Date.now();
    const stop = options.quiet ? () => {} : startSpinner('lead summarizer working');
    try {
      synthesisResult = await synthesize(prompt, advisorResults, undefined, options.signal);
    } finally {
      stop();
    }
    const synthDuration = Date.now() - t0;
    if (synthesisResult) {
      log(`  ✓ ${synthesisResult.engine} (${synthDuration}ms)`);
      emit({ type: 'synthesis_done', engine: synthesisResult.engine, durationMs: synthDuration, output: synthesisResult.output });
    } else {
      log(`  ✗ synthesis failed (all lead summarizers errored)`);
      emit({ type: 'synthesis_done', engine: null, durationMs: synthDuration });
    }
  }

  // Step 4: Execute with Vibe if needed (skip if user cancelled).
  let executionResult: EngineResult | null = null;
  if (decision.executeWithVibe && !options.signal?.aborted) {
    log(section('EXECUTE (vibe)'));
    emit({ type: 'execute_start' });
    const stop = options.quiet ? () => {} : startSpinner('vibe working');
    try {
      executionResult = await runEngine('vibe', prompt, { signal: options.signal });
    } finally {
      stop();
    }
    const icon = executionResult.status === 'ok' ? '✓' : '✗';
    const detail = executionResult.error ? ` (${executionResult.error})` : '';
    log(`  ${icon} vibe — ${executionResult.status}${detail}`);
    emit({
      type: 'execute_done',
      status: executionResult.status,
      output: executionResult.status === 'ok' ? executionResult.output : undefined,
      error: executionResult.error
    });
  }

  return {
    decision,
    advisorResults,
    synthesis: synthesisResult,
    executionResult,
    totalDurationMs: Date.now() - start,
    cancelled: Boolean(options.signal?.aborted)
  };
}

export function formatWorkflowResult(result: WorkflowResult): string {
  const lines: string[] = [];
  const rule = '─'.repeat(60);

  lines.push('');
  lines.push(rule);
  lines.push(result.cancelled ? '  RESULTS  (cancelled — partial)' : '  RESULTS');
  lines.push(rule);

  if (result.executionResult?.status === 'ok') {
    lines.push('');
    lines.push('▸ EXECUTION (vibe)');
    lines.push(rule);
    lines.push(result.executionResult.output);
  } else if (result.executionResult) {
    lines.push('');
    lines.push(`▸ EXECUTION FAILED: ${result.executionResult.error}`);
  }

  if (result.synthesis) {
    lines.push('');
    lines.push(`▸ SYNTHESIS  (lead: ${result.synthesis.engine})`);
    lines.push(rule);
    lines.push(result.synthesis.output);
  }

  if (result.advisorResults.some(r => r.status === 'ok')) {
    lines.push('');
    lines.push('▸ ADVISORS');
    lines.push(rule);

    for (const r of result.advisorResults) {
      if (r.status !== 'ok') {
        lines.push(`\n  ${r.name.toUpperCase()}  [${r.status}] ${r.error || 'No response'}`);
        continue;
      }
      lines.push(`\n  ${r.name.toUpperCase()}`);
      lines.push(r.output);
    }
  }

  if (!result.executionResult && !result.advisorResults.some(r => r.status === 'ok')) {
    lines.push('');
    lines.push('  No results. Check your CLI authentication and subscriptions.');
  }

  lines.push('');
  lines.push(rule);
  lines.push(`  USAGE`);
  lines.push(rule);
  for (const r of result.advisorResults) {
    const elapsed = formatElapsed(r.durationMs);
    let usagePart = '';
    if (r.usage) {
      const u = r.usage;
      const tokens = u.totalTokens != null
        ? `${u.totalTokens} tok` + (u.inputTokens != null && u.outputTokens != null ? ` (${u.inputTokens} in / ${u.outputTokens} out)` : '')
        : '';
      const cost = u.costUsd != null ? `  $${u.costUsd.toFixed(4)}` : '';
      usagePart = tokens ? `  ${tokens}${cost}` : cost;
    }
    lines.push(`  ${r.name.padEnd(20)} ${elapsed.padStart(7)}${usagePart}`);
  }
  if (result.synthesis) {
    lines.push(`  ${('synthesis (' + result.synthesis.engine + ')').padEnd(20)} ${formatElapsed(result.synthesis.durationMs).padStart(7)}`);
  }
  if (result.executionResult) {
    lines.push(`  ${'execute (vibe)'.padEnd(20)} ${formatElapsed(result.executionResult.durationMs).padStart(7)}`);
  }
  lines.push(`  ${'─'.repeat(20)} ${'─'.repeat(7)}`);
  lines.push(`  ${'total'.padEnd(20)} ${formatElapsed(result.totalDurationMs).padStart(7)}`);
  lines.push('');

  return lines.join('\n');
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
