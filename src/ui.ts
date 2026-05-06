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
