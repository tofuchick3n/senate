#!/usr/bin/env node

import { program } from 'commander';
import { runWorkflow, formatWorkflowResult, type WorkflowResult } from './workflow.js';
import { listEngines, getAvailableEngines } from './engines.js';

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
      const available = await getAvailableEngines();
      console.log('Authenticated:', available.join(', '));
      const unavailable = listEngines().filter(e => !available.includes(e));
      if (unavailable.length > 0) {
        console.log('Not authenticated:', unavailable.join(', '));
      }
      return;
    }

    if (!query) {
      program.help();
      return;
    }

    // Determine mode from flags
    const mode = {
      consult: options.consultOnly ? true : options.noConsult ? false : undefined,
      execute: options.executeOnly ? true : options.noExecute ? false : undefined,
      advisors: options.advisors?.split(',') || ['claude', 'vibe']
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
