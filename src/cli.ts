#!/usr/bin/env node

import { program } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runWorkflow, formatWorkflowResult, type WorkflowResult, type WorkflowEvent } from './workflow.js';
import { listEngines, checkEngines } from './engines.js';
import { getDefaultAdvisors, listEngineEntries, getEngineConfig, listEngineNames } from './registry.js';
import { printBanner, formatAdvisorLine } from './ui.js';
import { startTui } from './tui.js';
import { parseDuration } from './duration.js';
import { loadConfig } from './config.js';
import { startRepl, type Turn } from './repl.js';
import { getVersion } from './version.js';
import {
  TranscriptWriter,
  listSessions,
  loadSession,
  resolveSessionRef
} from './transcripts.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function resolveBundledSkillDir(): string {
  // cli.ts lives at src/cli.ts (dev) or dist/cli.js (built / npm-installed).
  // In both layouts, the bundled skill is one level up from this file's dir.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'skills', 'senate');
}

function getInstalledSkillDir(): string {
  return path.join(os.homedir(), '.claude', 'skills', 'senate');
}

function installSkill(force: boolean): void {
  const src = resolveBundledSkillDir();
  if (!fs.existsSync(src) || !fs.existsSync(path.join(src, 'SKILL.md'))) {
    console.error(`Error: bundled skill not found at ${src}`);
    console.error('This usually means the package was built without skills/. Reinstall or rebuild.');
    process.exit(1);
  }
  const targetDir = getInstalledSkillDir();
  if (fs.existsSync(targetDir) && !force) {
    console.error(`Skill already installed at ${targetDir}`);
    console.error('Use --force to overwrite, or --uninstall-skill first.');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(src, targetDir, { recursive: true });
  console.log(`Installed senate skill to ${targetDir}`);
  console.log('Restart Claude Code (or run /skills) to pick it up.');
}

function uninstallSkill(): void {
  const targetDir = getInstalledSkillDir();
  if (!fs.existsSync(targetDir)) {
    console.log(`No skill installed at ${targetDir}`);
    return;
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log(`Removed ${targetDir}`);
}

program
  .name('senate')
  .description('Multi-model orchestration CLI — consult claude, vibe, gemini in parallel')
  .version(getVersion())
  .argument('[query]', 'Task or question to process. If omitted and stdin is piped, stdin is used.')

  // Mode flags
  .option('--consult-only', 'Only consult advisors, skip execution')
  .option('--execute-only', 'Only execute with Vibe, skip consultation')
  .option('--no-consult', 'Skip advisor consultation')
  .option('--no-execute', 'Skip Vibe execution')
  .option('--smart', 'Let the orchestrator (Claude) decide whether to consult and/or execute')

  // Advisor selection. Default is resolved at runtime: ~/.senate/config.json `advisors`
  // field if present, otherwise the registry's default list. (Commander's static default
  // would shadow the config file, so we leave it undefined and resolve in the action.)
  .option('-a, --advisors <list>', `Comma-separated advisors. Default: ~/.senate/config.json or ${getDefaultAdvisors().join(',')}`)
  .option('--no-synthesis', 'Skip the synthesis step after advisors respond')
  .option('--timeout <duration>', 'Per-advisor inactivity timeout. Accepts 600, 600s, 10m, 1h, 1500ms. Defaults: claude=240s, gemini=240s, vibe=60s')

  // Output modes
  .option('--json', 'Print final result as a single JSON blob to stdout')
  .option('--json-stream', 'Print NDJSON events to stdout as they happen')
  .option('--no-tui', 'Disable the live dashboard (fallback to plain settle-line output)')
  .option('--quiet', 'Suppress all progress output (banner, dashboard, settle lines, save footer); print the final result only')
  .option('--repl', 'After the first result, drop into a conversation REPL with prior turns as context')

  // Transcripts (#12)
  .option('--no-transcript', 'Do not persist this session to ~/.senate/sessions/')
  .option('--list-sessions [count]', 'List recent saved sessions and exit')
  .option('--resume <ref>', 'Reprint a saved session by index (0=newest) or path')

  // Utility
  .option('--list-engines', 'List available engines and exit')
  .option('--check-engines', 'Check which engines are authenticated and exit')
  .option('--install-skill', 'Install the bundled Claude Code skill to ~/.claude/skills/senate')
  .option('--uninstall-skill', 'Remove the senate skill from ~/.claude/skills/senate')
  .option('--force', 'With --install-skill, overwrite an existing installation')
  .option('-v, --verbose', 'Show verbose output')

  .action(async (queryArg: string | undefined, options: any) => {
    if (options.installSkill) {
      installSkill(Boolean(options.force));
      return;
    }

    if (options.uninstallSkill) {
      uninstallSkill();
      return;
    }

    if (options.listEngines) {
      console.log('Configured engines:');
      for (const e of listEngineEntries()) {
        const overrideNote = e.binOverridden ? `  [SENATE_${e.name.toUpperCase()}_BIN]` : '';
        console.log(`  ${e.name.padEnd(8)} bin=${e.bin}${overrideNote}`);
      }
      return;
    }

    if (options.listSessions !== undefined) {
      const limit = typeof options.listSessions === 'string' ? parseInt(options.listSessions, 10) || 20 : 20;
      const sessions = listSessions(undefined, limit);
      if (sessions.length === 0) {
        console.log('No sessions found in ~/.senate/sessions/');
        return;
      }
      console.log(`Recent sessions (${sessions.length}):`);
      sessions.forEach((s, i) => {
        const flag = s.cancelled ? ' [cancelled]' : '';
        console.log(`  ${String(i).padStart(2)}  ${s.ts}  ${s.advisors.join(',').padEnd(20)} ${s.promptPreview}${flag}`);
      });
      console.log(`\nReprint with: senate --resume <index> | senate --resume <path>`);
      return;
    }

    if (options.resume) {
      const path = resolveSessionRef(options.resume);
      if (!path) {
        console.error(`Error: no session matching "${options.resume}" (try --list-sessions)`);
        process.exit(1);
      }
      const { end, start } = loadSession(path);
      if (!end?.result) {
        console.error(`Error: session at ${path} has no recorded result (likely aborted)`);
        process.exit(1);
      }
      if (start) console.log(`# Resumed session ${start.ts}\n# Prompt: ${start.prompt}\n`);
      console.log(formatWorkflowResult(end.result));
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
    const quietMode = Boolean(options.quiet);

    // Resolve advisors: explicit -a → ~/.senate/config.json `advisors` → registry default.
    const config = loadConfig();
    const advisorsRaw: string =
      options.advisors ??
      (config.advisors && config.advisors.length > 0 ? config.advisors.join(',') : getDefaultAdvisors().join(','));
    const advisors = advisorsRaw.split(',').map((s: string) => s.trim()).filter(Boolean);

    // TUI is on by default in human + TTY mode. --no-tui or --quiet disables it. Machine modes always disable.
    const tuiEnabled = options.tui !== false && !machineMode && !quietMode && process.stderr.isTTY;
    const advisorLine = formatAdvisorLine(advisors, listEngineNames());
    const tui = tuiEnabled ? startTui({ advisorLine }) : null;
    // When TUI is on, machine mode is on, or --quiet is set, silence workflow.ts settle-line chatter.
    const workflowQuiet = machineMode || tuiEnabled || quietMode;

    // Transcript writer (best-effort; commander's --no-transcript flips options.transcript false).
    const wantTranscript = options.transcript !== false;
    const transcriptMode = {
      consult: options.consultOnly ?? !options.noConsult,
      execute: options.executeOnly ?? !options.noExecute,
      advisors,
      smart: Boolean(options.smart),
      synthesize: options.synthesis !== false
    };
    const transcript = wantTranscript ? new TranscriptWriter(query, transcriptMode) : null;

    const onEvent = (e: WorkflowEvent) => {
      if (streamMode) process.stdout.write(JSON.stringify(e) + '\n');
      tui?.onEvent(e);
      transcript?.appendEvent(e);
    };

    const sigintQuiet = machineMode || quietMode;

    // Wire Ctrl-C: first press cancels gracefully (via AbortController) and lets the workflow
    // emit/print whatever has finished. A second press exits immediately with 130.
    const controller = new AbortController();
    let sigintCount = 0;
    const onSigint = () => {
      sigintCount++;
      if (sigintCount === 1) {
        if (!sigintQuiet) process.stderr.write('\n[cancel] aborting in-flight engines, will print partial results...\n');
        controller.abort();
      } else {
        process.exit(130);
      }
    };
    process.on('SIGINT', onSigint);

    // --timeout accepts duration strings (600, 600s, 10m, 1h, 1500ms). Bare integer = seconds.
    const advisorInactivityMs = parseDuration(options.timeout);
    if (options.timeout !== undefined && advisorInactivityMs === undefined) {
      console.error(`Error: --timeout: could not parse "${options.timeout}" (try 600, 600s, 10m, 1h, 1500ms)`);
      process.exit(2);
    }

    const mode = {
      consult,
      execute,
      advisors,
      synthesize: options.synthesis !== false,
      smart: Boolean(options.smart),
      // Silence workflow.ts chatter when in machine modes (clean stdout) or when the TUI is showing the same info.
      quiet: workflowQuiet,
      onEvent,
      signal: controller.signal,
      advisorInactivityMs
    };

    // Banner is for the static fallback path. The TUI has its own header. --quiet suppresses both.
    if (!machineMode && !tuiEnabled && !quietMode) {
      printBanner();
      process.stderr.write(`       ${advisorLine}\n`);
    }

    if (options.verbose && !machineMode) {
      console.error(`[verbose] consult=${mode.consult} execute=${mode.execute} smart=${mode.smart}`);
      console.error(`[verbose] advisors=${mode.advisors.join(', ')}`);
    }

    try {
      const result: WorkflowResult = await runWorkflow(query, mode);
      tui?.stop(result);
      transcript?.end(result);
      if (streamMode) {
        process.stdout.write(JSON.stringify({ type: 'result', result }) + '\n');
      } else if (jsonMode) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        console.log(formatWorkflowResult(result));
        if (transcript && !quietMode) console.log(`(saved to ${transcript.path})`);
      }

      // REPL: only in human + interactive mode. Skip if cancelled, machine modes, or no TTY.
      // process.stdin.isTTY already covers the "stdin piped" case.
      const replEnabled = options.repl && !machineMode && !result.cancelled && process.stdin.isTTY;
      if (replEnabled) {
        // The outer SIGINT handler used `controller`, which is a one-shot AbortController. Once
        // aborted it stays aborted, which would kill every subsequent REPL turn. Detach the outer
        // handler before entering the REPL — each turn manages its own controller.
        process.off('SIGINT', onSigint);

        process.stderr.write(`\n[repl] Enter follow-up questions (prior turns kept as context). /exit to quit. Ctrl-C cancels current turn.\n`);
        await startRepl(
          { prompt: query, result },
          {
            runTurn: async (enrichedPrompt: string, _displayPrompt: string) => {
              const turnController = new AbortController();
              let turnSigintCount = 0;
              const turnSigint = () => {
                turnSigintCount++;
                if (turnSigintCount === 1) {
                  if (!quietMode) process.stderr.write('\n[cancel] aborting current turn (Ctrl-C again to exit)\n');
                  turnController.abort();
                } else {
                  process.exit(130);
                }
              };
              process.on('SIGINT', turnSigint);

              // Each REPL turn gets its own TUI, transcript, and cancel-aware execution.
              const turnTui = (options.tui !== false && !quietMode && process.stderr.isTTY) ? startTui({ advisorLine }) : null;
              const turnTranscript = wantTranscript ? new TranscriptWriter(enrichedPrompt, transcriptMode) : null;
              const turnOnEvent = (e: WorkflowEvent) => {
                turnTui?.onEvent(e);
                turnTranscript?.appendEvent(e);
              };
              try {
                const turnResult = await runWorkflow(enrichedPrompt, { ...mode, onEvent: turnOnEvent, signal: turnController.signal });
                turnTui?.stop(turnResult);
                turnTranscript?.end(turnResult);
                return turnResult;
              } finally {
                process.off('SIGINT', turnSigint);
              }
            },
            printResult: (r) => {
              console.log(formatWorkflowResult(r));
            }
          },
          () => false  // Per-turn controllers handle cancellation; never report "session aborted" to the REPL.
        );
      }

      if (result.cancelled) {
        process.off('SIGINT', onSigint);
        process.exit(130);
      }
    } catch (error: any) {
      tui?.stop();
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
