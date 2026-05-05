import { runEngine } from './engines.js';

export type Decision = {
  consultAdvisors: boolean;
  advisors: string[];
  executeWithVibe: boolean;
  explanation: string;
};

export async function getDecision(prompt: string): Promise<Decision> {
  const decisionPrompt = `
    You are the orchestrator. Analyze this task and respond ONLY with valid JSON:

    {
      "consultAdvisors": boolean,
      "advisors": ["claude", "vibe", "gemini"],
      "executeWithVibe": boolean,
      "explanation": "1 sentence reason"
    }

    Guidelines:
    - consultAdvisors: true for reviews, opinions, comparisons, or complex decisions
    - consultAdvisors: false for simple questions or direct execution tasks
    - executeWithVibe: true for implementation, fixes, code generation
    - executeWithVibe: false for analysis, review, or discussion
    - Always include at least one advisor if consultAdvisors is true
    - explanation should be concise (one sentence)

    Task: ${prompt}
  `;

  const result = await runEngine('claude', decisionPrompt);
  
  if (result.status !== 'ok') {
    console.log(`[Orchestrator] Falling back to defaults (Claude error: ${result.error})`);
    return {
      consultAdvisors: true,
      advisors: ['claude', 'vibe'],
      executeWithVibe: true,
      explanation: 'Using defaults due to orchestrator error'
    };
  }

  try {
    const parsed = JSON.parse(result.output);
    return {
      consultAdvisors: parsed.consultAdvisors ?? true,
      advisors: parsed.advisors ?? ['claude', 'vibe'],
      executeWithVibe: parsed.executeWithVibe ?? true,
      explanation: parsed.explanation ?? 'No explanation provided'
    };
  } catch (e) {
    console.log(`[Orchestrator] Invalid JSON from Claude, using defaults: ${e}`);
    return {
      consultAdvisors: true,
      advisors: ['claude', 'vibe'],
      executeWithVibe: true,
      explanation: 'Invalid JSON from orchestrator, using defaults'
    };
  }
}
