import { runEngine, type EngineResult } from './engines.js';
import { getDecision, type Decision } from './orchestrator.js';

export type WorkflowResult = {
  decision: Decision;
  advisorResults: EngineResult[];
  executionResult: EngineResult | null;
  totalDurationMs: number;
};

export async function runWorkflow(prompt: string, options: {
  consult?: boolean;
  execute?: boolean;
  advisors?: string[];
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

  // Step 2: Consult advisors sequentially with live feedback
  let advisorResults: EngineResult[] = [];
  if (decision.consultAdvisors) {
    console.log('\n🤝 Consulting advisors...');
    const advisorStart = Date.now();
    for (const name of decision.advisors) {
      console.log(`  → ${name}...`);
      const result = await runEngine(name, prompt);
      console.log(`     ${result.status === 'ok' ? '✓' : '✗'} ${result.status}${result.error ? ` (${result.error})` : ''}`);
      advisorResults.push(result);
    }
    const successful = advisorResults.filter(r => r.status === 'ok').length;
    console.log(`  ✓ ${successful} advisor(s) responded in ${Date.now() - advisorStart}ms`);
  }

  // Step 3: Execute with Vibe if needed
  let executionResult: EngineResult | null = null;
  if (decision.executeWithVibe) {
    console.log('\n⚡ Executing with Vibe...');
    console.log('  → vibe...');
    executionResult = await runEngine('vibe', prompt);
    console.log(`     ${executionResult.status === 'ok' ? '✓' : '✗'} ${executionResult.status}${executionResult.error ? ` (${executionResult.error})` : ''}`);
  }

  return {
    decision,
    advisorResults,
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
