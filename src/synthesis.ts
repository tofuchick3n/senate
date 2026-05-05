import { runEngine, type EngineResult } from './engines.js';

export type SynthesisResult = {
  engine: string;
  output: string;
  durationMs: number;
};

const LEAD_ORDER = ['claude', 'vibe', 'gemini'];

function buildSynthesisPrompt(originalPrompt: string, advisors: EngineResult[]): string {
  const present = advisors.map(a => a.name.toUpperCase());
  const sections = advisors
    .map(a => `=== ${a.name.toUpperCase()} ===\n${a.output.trim()}`)
    .join('\n\n');

  return `You are synthesizing responses from ${present.length} AI advisors who answered the same task.

The advisors who responded are: ${present.join(', ')}.
ONLY refer to these advisors. Do NOT mention any other advisor names. Do NOT speculate about what an absent advisor would have said.

Produce a structured synthesis with these sections (use these exact headers):

## CONSENSUS
Points all or most advisors agreed on.

## DISAGREEMENTS
Where advisors differ. For each disagreement, name which advisor took which stance.

## OUTLIERS
Any advisor that took an unusual or contradictory position. Write "None." if there are none.

## RECOMMENDATION
Your judgment given the spread of opinions.

Be concise. Quote advisors by name (${present.join(', ')}) when attributing positions. Do not invent agreement that isn't there — if they truly diverge, say so.

---
ORIGINAL TASK:
${originalPrompt}

---
ADVISOR RESPONSES:
${sections}
`;
}

export async function synthesize(
  originalPrompt: string,
  advisors: EngineResult[],
  preferredLead?: string
): Promise<SynthesisResult | null> {
  const successful = advisors.filter(a => a.status === 'ok' && a.output.trim());
  if (successful.length < 2) return null;

  const synthPrompt = buildSynthesisPrompt(originalPrompt, successful);

  const order = preferredLead
    ? [preferredLead, ...LEAD_ORDER.filter(n => n !== preferredLead)]
    : LEAD_ORDER;

  for (const lead of order) {
    const start = Date.now();
    const result = await runEngine(lead, synthPrompt, 60000, false);
    if (result.status === 'ok' && result.output.trim()) {
      return {
        engine: lead,
        output: result.output,
        durationMs: Date.now() - start
      };
    }
  }

  return null;
}
