#!/usr/bin/env node

import { program } from 'commander';
import { runWorkflow, formatWorkflowResult, type WorkflowResult, type WorkflowEvent } from './workflow.js';
import { listEngines, checkEngines } from './engines.js';
import { getDefaultAdvisors, listEngineEntries, getEngineConfig } from './registry.js';
import { printBanner } from './ui.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

program
  .name('senate')
  .description('Multi-model orchestration CLI — consult claude, vibe, gemini in parallel')
  .version('0.2.0')
  .argument('[query]', 'Task or question to process. If omitted and stdin is piped, stdin is used.')

  // Mode flags
  .option('--consult-only', 'Only consult advisors, skip execution')
  .option('--execute-only', 'Only execute with Vibe, skip consultation')
  .option('--no-consult', 'Skip advisor consultation')
  .option('--no-execute', 'Skip Vibe execution')
  .option('--smart', 'Let the orchestrator (Claude) decide whether to consult and/or execute')

  // Advisor selection
  .option('-a, --advisors <list>', 'Comma-separated list of advisors to consult', getDefaultAdvisors().join(','))
  .option('--no-synthesis', 'Skip the synthesis step after advisors respond')

  // Output modes
  .option('--json', 'Print final result as a single JSON blob to stdout')
  .option('--json-stream', 'Print NDJSON events to stdout as they happen')

  // Utility
  .option('--list-engines', 'List available engines and exit')
  .option('--check-engines', 'Check which engines are authenticated and exit')
  .option('-v, --verbose', 'Show verbose output')

  .action(async (queryArg: string | undefined, options: any) => {
    if (options.listEngines) {
      console.log('Configured engines:');
      for (const e of listEngineEntries()) {
        const overrideNote = e.binOverridden ? `  [SENATE_${e.name.toUpperCase()}_BIN]` : '';
        console.log(`  ${e.name.padEnd(8)} bin=${e.bin}${overrideNote}`);
      }
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
          const e = getEngineConfig(name);
          const overrideNote = e?.binOverridden ? ` [bin=${e.bin}, via SENATE_${name.toUpperCase()}_BIN]` : '';
          console.log(`  ${name}: ${status}${error ? ` (${error})` : ''}${overrideNote}`);
        }
      }
      return;
    }

    // Resolve query: positional arg, then stdin, then help.
    let query = queryArg;
    const stdinPiped = !process.stdin.isTTY;
    if (stdinPiped) {
      const stdinText = await readStdin();
      if (stdinText) {
        query = query ? `${query}\n\n${stdinText}` : stdinText;
      }
    }
    if (!query) {
      program.help();
      return;
    }

    if (options.json && options.jsonStream) {
      console.error('Error: --json and --json-stream are mutually exclusive.');
      process.exit(2);
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

    const jsonMode = Boolean(options.json);
    const streamMode = Boolean(options.jsonStream);
    const machineMode = jsonMode || streamMode;

    const onEvent = streamMode
      ? (e: WorkflowEvent) => process.stdout.write(JSON.stringify(e) + '\n')
      : undefined;

    // Wire Ctrl-C: first press cancels gracefully (via AbortController) and lets the workflow
    // emit/print whatever has finished. A second press exits immediately with 130.
    const controller = new AbortController();
    let sigintCount = 0;
    const onSigint = () => {
      sigintCount++;
      if (sigintCount === 1) {
        if (!machineMode) process.stderr.write('\n[cancel] aborting in-flight engines, will print partial results...\n');
        controller.abort();
      } else {
        process.exit(130);
      }
    };
    process.on('SIGINT', onSigint);

    const mode = {
      consult,
      execute,
      advisors: options.advisors.split(','),
      synthesize: options.synthesis !== false,
      smart: Boolean(options.smart),
      // In machine modes the user expects clean stdout, so silence the human progress chatter on stderr too.
      quiet: machineMode,
      onEvent,
      signal: controller.signal
    };

    if (!machineMode) printBanner();

    if (options.verbose && !machineMode) {
      console.error(`[verbose] consult=${mode.consult} execute=${mode.execute} smart=${mode.smart}`);
      console.error(`[verbose] advisors=${mode.advisors.join(', ')}`);
    }

    try {
      const result: WorkflowResult = await runWorkflow(query, mode);
      if (streamMode) {
        process.stdout.write(JSON.stringify({ type: 'result', result }) + '\n');
      } else if (jsonMode) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        console.log(formatWorkflowResult(result));
      }
      if (result.cancelled) {
        process.off('SIGINT', onSigint);
        process.exit(130);
      }
    } catch (error: any) {
      if (machineMode) {
        process.stdout.write(JSON.stringify({ type: 'error', message: error.message }) + '\n');
      } else {
        console.error('\nError:', error.message);
      }
      process.exit(1);
    } finally {
      process.off('SIGINT', onSigint);
    }
  });

// Handle empty command (no args and stdin is a TTY — i.e. nothing piped).
if (!process.argv.slice(2).length && process.stdin.isTTY) {
  program.help();
}

program.parse();
