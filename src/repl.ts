import * as readline from 'node:readline';
import type { WorkflowResult } from './workflow.js';

/**
 * Conversation REPL: after the first workflow completes, drop into a `>` prompt.
 * Each new turn runs the workflow again with prior turns prepended as context,
 * so advisors can answer follow-ups with continuity.
 *
 * Commands:
 *   /exit (or Ctrl-D)  exit cleanly
 *   /history           print the full transcript so far
 *   /clear             drop prior turns from context (next turn starts fresh)
 *
 * The REPL writes to stderr (prompt + meta) and lets the workflow's normal
 * output go to stdout. Prior workflow output is reused via formatWorkflowResult.
 */

export type Turn = {
  prompt: string;
  result: WorkflowResult;
};

export type ReplDeps = {
  /** Run a workflow turn given the new prompt enriched with prior context. */
  runTurn: (enrichedPrompt: string, plainPromptForDisplay: string) => Promise<WorkflowResult>;
  /** Format and print a workflow result (caller's normal renderer). */
  printResult: (result: WorkflowResult) => void;
};

/**
 * Build the next-turn prompt by prepending compressed prior turns.
 * Uses synthesis recommendation when available, otherwise raw advisor outputs.
 * Exported for tests.
 */
export function buildEnrichedPrompt(turns: Turn[], newPrompt: string): string {
  if (turns.length === 0) return newPrompt;

  const sections: string[] = ['PRIOR CONVERSATION CONTEXT (older turns first):'];
  turns.forEach((t, i) => {
    sections.push(`\n--- TURN ${i + 1} ---`);
    sections.push(`USER: ${t.prompt}`);
    if (t.result.synthesis?.structured?.recommendation) {
      sections.push(`SENATE_RECOMMENDATION: ${t.result.synthesis.structured.recommendation}`);
    } else if (t.result.synthesis?.output) {
      sections.push(`SENATE_SYNTHESIS:\n${t.result.synthesis.output}`);
    } else {
      const ok = t.result.advisorResults.filter(r => r.status === 'ok');
      for (const a of ok) {
        sections.push(`${a.name.toUpperCase()}: ${a.output}`);
      }
    }
  });

  sections.push('\n--- NEW QUESTION ---');
  sections.push(newPrompt);
  return sections.join('\n');
}

export async function startRepl(
  initial: Turn,
  deps: ReplDeps,
  signalAborted: () => boolean
): Promise<Turn[]> {
  const turns: Turn[] = [initial];

  // Use stderr for the prompt so stdout stays for the workflow's output.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: '\nsenate> ',
    terminal: true
  });

  rl.prompt();

  return new Promise((resolve) => {
    const cleanup = () => {
      rl.close();
      resolve(turns);
    };

    rl.on('line', async (raw) => {
      const line = raw.trim();
      if (!line) {
        rl.prompt();
        return;
      }

      if (line === '/exit' || line === '/quit') {
        process.stderr.write('exiting REPL.\n');
        cleanup();
        return;
      }
      if (line === '/clear') {
        // Keep just the original turn? Or drop everything? Drop everything to truly reset.
        turns.length = 0;
        process.stderr.write('(context cleared — next turn starts fresh)\n');
        rl.prompt();
        return;
      }
      if (line === '/history') {
        process.stderr.write(`(${turns.length} turn${turns.length === 1 ? '' : 's'} in context)\n`);
        turns.forEach((t, i) => {
          process.stderr.write(`  ${i + 1}. ${t.prompt.slice(0, 100)}\n`);
        });
        rl.prompt();
        return;
      }

      if (signalAborted()) {
        process.stderr.write('(aborted — exiting REPL)\n');
        cleanup();
        return;
      }

      // Pause input while a turn runs to avoid line-buffering surprises.
      rl.pause();
      try {
        const enriched = buildEnrichedPrompt(turns, line);
        const result = await deps.runTurn(enriched, line);
        deps.printResult(result);
        turns.push({ prompt: line, result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`\n[error] ${msg}\n`);
      }
      if (signalAborted()) {
        cleanup();
        return;
      }
      rl.resume();
      rl.prompt();
    });

    rl.on('close', cleanup);
  });
}
