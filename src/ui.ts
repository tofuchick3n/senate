import { getVersion } from './version.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const ART = `
   ███████╗███████╗███╗   ██╗ █████╗ ████████╗███████╗
   ██╔════╝██╔════╝████╗  ██║██╔══██╗╚══██╔══╝██╔════╝
   ███████╗█████╗  ██╔██╗ ██║███████║   ██║   █████╗
   ╚════██║██╔══╝  ██║╚██╗██║██╔══██║   ██║   ██╔══╝
   ███████║███████╗██║ ╚████║██║  ██║   ██║   ███████╗
   ╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝   ╚══════╝`;

export function printBanner(): void {
  process.stderr.write(`${ART}\n       multi-model orchestration · v${getVersion()}\n`);
}

/**
 * Renders a one-line advisor summary like `advisors: claude, gemini (vibe excluded — pass -a to add)`.
 * The trailing hint only appears for engines that exist in the registry but were left out of the
 * active advisor list — closes the silent-exclude gap that surprised users on first run.
 */
export function formatAdvisorLine(active: string[], allEngines: string[]): string {
  const excluded = allEngines.filter((n) => !active.includes(n));
  const hint = excluded.length > 0 ? ` (${excluded.join(', ')} excluded — pass -a to add)` : '';
  return `advisors: ${active.join(', ')}${hint}`;
}

export function section(label: string): string {
  return `\n▸ ${label}`;
}

/**
 * Spinner that overwrites a single line on stderr with elapsed time.
 * Returns a stop function. No-op (prints a static line instead) when stderr is not a TTY,
 * which keeps `2>logfile` clean and avoids garbling CI output.
 */
export function startSpinner(msg: string): () => void {
  if (!process.stderr.isTTY) {
    process.stderr.write(`  · ${msg}\n`);
    return () => {};
  }
  let i = 0;
  const start = Date.now();
  const render = () => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    process.stderr.write(`\r  ${FRAMES[i++ % FRAMES.length]} ${msg} (${elapsed}s)`);
  };
  render();
  const id = setInterval(render, 80);
  return () => {
    clearInterval(id);
    // Clear the spinner line.
    process.stderr.write('\r' + ' '.repeat(msg.length + 16) + '\r');
  };
}
