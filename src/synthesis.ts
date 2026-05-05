import { runEngine, type EngineResult } from './engines.js';
import { getSynthesisPriority } from './registry.js';

export type DisagreementPosition = {
  engine: string;
  stance: string;
};

export type Disagreement = {
  topic: string;
  positions: DisagreementPosition[];
};

export type Outlier = {
  engine: string;
  note: string;
};

export type SynthesisStructured = {
  consensus: string[];
  disagreements: Disagreement[];
  outliers: Outlier[];
  recommendation: string;
};

export type SynthesisResult = {
  engine: string;
  output: string; // human-rendered prose, derived from `structured` when available
  structured: SynthesisStructured | null;
  durationMs: number;
};

function buildSynthesisPrompt(originalPrompt: string, advisors: EngineResult[]): string {
  const present = advisors.map(a => a.name.toUpperCase());
  const sections = advisors
    .map(a => `=== ${a.name.toUpperCase()} ===\n${a.output.trim()}`)
    .join('\n\n');

  return `You are synthesizing responses from ${present.length} AI advisors who answered the same task.

The advisors who responded are: ${present.join(', ')}.
ONLY refer to these advisors. Do NOT mention any other advisor names. Do NOT speculate about what an absent advisor would have said.

Output a SINGLE JSON object (no surrounding prose, no markdown fences) matching this schema:

{
  "consensus": [string, ...],          // points all or most advisors agreed on
  "disagreements": [
    {
      "topic": string,                 // what the disagreement is about
      "positions": [
        { "engine": string, "stance": string }
      ]
    }
  ],
  "outliers": [
    { "engine": string, "note": string }   // empty array if none
  ],
  "recommendation": string             // your judgment given the spread of opinions
}

Use the exact engine names ${present.map(n => `"${n}"`).join(', ')} when attributing positions or outliers. Do not invent agreement that isn't there — if advisors truly diverge, surface that in disagreements rather than rounding off into consensus.

---
ORIGINAL TASK:
${originalPrompt}

---
ADVISOR RESPONSES:
${sections}
`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function parseStructured(raw: string): SynthesisStructured | null {
  try {
    const obj = JSON.parse(extractJson(raw));
    if (!obj || typeof obj !== 'object') return null;
    return {
      consensus: Array.isArray(obj.consensus) ? obj.consensus.filter((x: unknown) => typeof x === 'string') : [],
      disagreements: Array.isArray(obj.disagreements)
        ? obj.disagreements.map((d: any) => ({
            topic: String(d?.topic ?? ''),
            positions: Array.isArray(d?.positions)
              ? d.positions.map((p: any) => ({
                  engine: String(p?.engine ?? ''),
                  stance: String(p?.stance ?? '')
                }))
              : []
          }))
        : [],
      outliers: Array.isArray(obj.outliers)
        ? obj.outliers.map((o: any) => ({
            engine: String(o?.engine ?? ''),
            note: String(o?.note ?? '')
          }))
        : [],
      recommendation: typeof obj.recommendation === 'string' ? obj.recommendation : ''
    };
  } catch {
    return null;
  }
}

export function renderSynthesis(s: SynthesisStructured): string {
  const lines: string[] = [];

  lines.push('## CONSENSUS');
  if (s.consensus.length === 0) {
    lines.push('None recorded.');
  } else {
    for (const c of s.consensus) lines.push(`- ${c}`);
  }

  lines.push('');
  lines.push('## DISAGREEMENTS');
  if (s.disagreements.length === 0) {
    lines.push('None.');
  } else {
    for (const d of s.disagreements) {
      lines.push(`- **${d.topic}**`);
      for (const p of d.positions) {
        lines.push(`  - ${p.engine}: ${p.stance}`);
      }
    }
  }

  lines.push('');
  lines.push('## OUTLIERS');
  if (s.outliers.length === 0) {
    lines.push('None.');
  } else {
    for (const o of s.outliers) lines.push(`- ${o.engine}: ${o.note}`);
  }

  lines.push('');
  lines.push('## RECOMMENDATION');
  lines.push(s.recommendation || '_(no recommendation provided)_');

  return lines.join('\n');
}

export async function synthesize(
  originalPrompt: string,
  advisors: EngineResult[],
  preferredLead?: string,
  signal?: AbortSignal
): Promise<SynthesisResult | null> {
  const successful = advisors.filter(a => a.status === 'ok' && a.output.trim());
  if (successful.length < 2) return null;

  const synthPrompt = buildSynthesisPrompt(originalPrompt, successful);

  const priority = getSynthesisPriority();
  const order = preferredLead
    ? [preferredLead, ...priority.filter(n => n !== preferredLead)]
    : priority;

  for (const lead of order) {
    if (signal?.aborted) return null;
    const start = Date.now();
    const result = await runEngine(lead, synthPrompt, { inactivityMs: 60000, stream: false, signal });
    if (result.status === 'ok' && result.output.trim()) {
      const structured = parseStructured(result.output);
      const output = structured ? renderSynthesis(structured) : result.output;
      return {
        engine: lead,
        output,
        structured,
        durationMs: Date.now() - start
      };
    }
  }

  return null;
}
