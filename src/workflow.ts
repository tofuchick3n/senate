import { runEngine, type EngineResult } from './engines.js';
import { getDecision, type Decision } from './orchestrator.js';
import { synthesize, type SynthesisResult } from './synthesis.js';

export type WorkflowResult = {
  decision: Decision;
  advisorResults: EngineResult[];
  synthesis: SynthesisResult | null;
  executionResult: EngineResult | null;
  totalDurationMs: number;
};

export async function runWorkflow(prompt: string, options: {
  consult?: boolean;
  execute?: boolean;
  advisors?: string[];
  synthesize?: boolean;
} = {}): Promise<WorkflowResult> {
  const start = Date.now();

  // Step 1: Get decision. If user explicitly set either flag, skip the orchestrator entirely
  // and use their choices (defaulting the unset side).
  const userOverride = options.consult !== undefined || options.execute !== undefined;
  let decision: Decision;
  if (userOverride) {
    const consultAdvisors = options.consult ?? true;
    const executeWithVibe = options.execute ?? false;
    decision = {
      consultAdvisors,
      advisors: options.advisors || ['claude', 'vibe', 'gemini'],
      executeWithVibe,
      explanation: consultAdvisors && !executeWithVibe ? 'User requested consultation only'
        : executeWithVibe && !consultAdvisors ? 'User requested execution only'
        : 'User-specified mode'
    };
    console.log('\n🎭 Using user-specified mode (skipping orchestrator)...');
  } else {
    console.log('\n🎭 Orchestrator deciding...');
    decision = await getDecision(prompt);
  }

  console.log(`  → ${decision.explanation}`);
  console.log(`  → Advisors: ${decision.advisors.join(', ')}`);
  console.log(`  → Execute with Vibe: ${decision.executeWithVibe}`);

  // Step 2: Consult advisors in parallel. Stream is disabled while parallel because interleaved
  // output is unreadable; we print a status line per engine as each one settles.
  let advisorResults: EngineResult[] = [];
  if (decision.consultAdvisors) {
    console.log('\n🤝 Consulting advisors in parallel...');
    const advisorStart = Date.now();
    const settled = new Set<string>();

    const tasks = decision.advisors.map(async (name) => {
      const t0 = Date.now();
      const result = await runEngine(name, prompt, 30000, false);
      settled.add(name);
      const elapsed = Date.now() - t0;
      const icon = result.status === 'ok' ? '✓' : '✗';
      const detail = result.error ? ` (${result.error})` : '';
      const pending = decision.advisors.filter(n => !settled.has(n));
      const waitingNote = pending.length > 0 ? `  [waiting: ${pending.join(', ')}]` : '';
      console.log(`  ${icon} ${name} — ${result.status}${detail} (${elapsed}ms)${waitingNote}`);
      return result;
    });

    const results = await Promise.allSettled(tasks);
    advisorResults = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { name: decision.advisors[i], status: 'error' as const, output: '', durationMs: 0, error: String(r.reason) }
    );

    const successful = advisorResults.filter(r => r.status === 'ok').length;
    console.log(`  → ${successful}/${advisorResults.length} advisor(s) responded in ${Date.now() - advisorStart}ms`);
  }

  // Step 3: Synthesize advisor outputs. Skip if explicitly disabled or fewer than 2 succeeded.
  let synthesisResult: SynthesisResult | null = null;
  const wantSynthesis = options.synthesize !== false;
  if (wantSynthesis && advisorResults.filter(r => r.status === 'ok').length >= 2) {
    console.log('\n🧠 Synthesizing...');
    const t0 = Date.now();
    synthesisResult = await synthesize(prompt, advisorResults);
    if (synthesisResult) {
      console.log(`  ✓ synthesized via ${synthesisResult.engine} (${Date.now() - t0}ms)`);
    } else {
      console.log(`  ✗ synthesis failed (all lead summarizers errored)`);
    }
  }

  // Step 4: Execute with Vibe if needed
  let executionResult: EngineResult | null = null;
  if (decision.executeWithVibe) {
    console.log('\n⚡ Executing with Vibe...');
    executionResult = await runEngine('vibe', prompt);
    const icon = executionResult.status === 'ok' ? '✓' : '✗';
    const detail = executionResult.error ? ` (${executionResult.error})` : '';
    console.log(`  ${icon} vibe — ${executionResult.status}${detail}`);
  }

  return {
    decision,
    advisorResults,
    synthesis: synthesisResult,
    executionResult,
    totalDurationMs: Date.now() - start
  };
}

export function formatWorkflowResult(result: WorkflowResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═'.repeat(60));
  lines.push('SENATE RESULTS');
  lines.push('═'.repeat(60));

  if (result.executionResult?.status === 'ok') {
    lines.push('');
    lines.push('🎯 EXECUTION RESULT (via Vibe):');
    lines.push('-'.repeat(60));
    lines.push(result.executionResult.output);
  } else if (result.executionResult) {
    lines.push('');
    lines.push(`⚠️  EXECUTION FAILED: ${result.executionResult.error}`);
  }

  if (result.synthesis) {
    lines.push('');
    lines.push(`🧠 SYNTHESIS (lead: ${result.synthesis.engine}):`);
    lines.push('-'.repeat(60));
    lines.push(result.synthesis.output);
  }

  if (result.advisorResults.some(r => r.status === 'ok')) {
    lines.push('');
    lines.push('💬 ADVISOR OPINIONS:');
    lines.push('-'.repeat(60));

    for (const r of result.advisorResults) {
      if (r.status !== 'ok') {
        lines.push(`\n${r.name.toUpperCase()}: [${r.status}] ${r.error || 'No response'}`);
        continue;
      }
      lines.push(`\n${r.name.toUpperCase()}:`);
      lines.push(r.output);
    }
  }

  if (!result.executionResult && !result.advisorResults.some(r => r.status === 'ok')) {
    lines.push('');
    lines.push('⚠️  No results. Check your CLI authentication and subscriptions.');
  }

  lines.push('');
  lines.push('-'.repeat(60));
  lines.push(`Total time: ${result.totalDurationMs}ms`);
  lines.push('');

  return lines.join('\n');
}
