#!/usr/bin/env node

import { program } from 'commander';
import { runWorkflow, formatWorkflowResult, type WorkflowResult } from './workflow.js';
import { listEngines, getAvailableEngines, checkEngines } from './engines.js';

program
  .name('senate')
  .description('Multi-model orchestration CLI - Uses Claude Opus as orchestrator, Vibe for execution')
  .version('0.1.0')
  .argument('[query]', 'Task or question to process')
  
  // Mode flags
  .option('--consult-only', 'Only consult advisors, skip execution')
  .option('--execute-only', 'Only execute with Vibe, skip consultation')
  .option('--no-consult', 'Skip advisor consultation')
  .option('--no-execute', 'Skip Vibe execution')
  
  // Advisor selection
  .option('-a, --advisors <list>', 'Comma-separated list of advisors to consult', 'claude,vibe')
  .option('--no-synthesis', 'Skip the synthesis step after advisors respond')
  
  // Utility
  .option('--list-engines', 'List available engines and exit')
  .option('--check-engines', 'Check which engines are authenticated and exit')
  .option('-v, --verbose', 'Show verbose output')
  
  .action(async (query: string | undefined, options: any) => {
    if (options.listEngines) {
      console.log('Available engines:', listEngines().join(', '));
      return;
    }

    if (options.checkEngines) {
      console.log('Checking engine availability...');
      const results = await checkEngines();
      const available = Object.entries(results)
        .filter(([_, r]) => r.status === 'ok')
        .map(([name]) => name);
      const unavailable = Object.entries(results)
        .filter(([_, r]) => r.status !== 'ok')
        .map(([name, r]) => ({ name, status: r.status, error: r.error }));
      
      console.log('Authenticated:', available.length > 0 ? available.join(', ') : 'none');
      if (unavailable.length > 0) {
        console.log('\nUnavailable engines:');
        for (const { name, status, error } of unavailable) {
          console.log(`  ${name}: ${status}${error ? ` (${error})` : ''}`);
        }
      }
      return;
    }

    if (!query) {
      program.help();
      return;
    }

    // Determine mode from flags. --consult-only implies skip execute; --execute-only implies skip consult.
    const consult = options.consultOnly ? true
      : options.executeOnly ? false
      : options.noConsult ? false
      : undefined;
    const execute = options.executeOnly ? true
      : options.consultOnly ? false
      : options.noExecute ? false
      : undefined;
    const mode = {
      consult,
      execute,
      advisors: options.advisors?.split(',') || ['claude', 'vibe', 'gemini'],
      synthesize: options.synthesis !== false
    };

    if (options.verbose) {
      console.log(`[Verbose] Mode: consult=${mode.consult}, execute=${mode.execute}`);
      console.log(`[Verbose] Advisors: ${mode.advisors.join(', ')}`);
    }

    try {
      const result: WorkflowResult = await runWorkflow(query, mode);
      console.log(formatWorkflowResult(result));
    } catch (error: any) {
      console.error('\n❌ Error:', error.message);
      process.exit(1);
    }
  });

// Handle empty command
if (!process.argv.slice(2).length) {
  program.help();
}

program.parse();
