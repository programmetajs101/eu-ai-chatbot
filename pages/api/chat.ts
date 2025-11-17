import type { NextApiRequest, NextApiResponse } from 'next';

type AgentState = {
  org?: { name?: string; country?: string; industry?: string; size?: string };
  roles?: string[];
  useCases?: Array<{
    id: string;
    name?: string;
    description?: string;
    process?: string;
    inScope?: boolean;
    risk?: 'minimal' | 'limited' | 'high' | 'prohibited' | 'unknown';
    model?: string;
    data?: string[];
    subjects?: string[];
    owner?: string;
    jurisdictions?: string[];
  }>;
};

// --- Utility: Safe sanitizer to avoid crashes on malformed state ---
function sanitizeStateUpdates(input: any): Partial<AgentState> | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const su: Partial<AgentState> = {};

  if (input.org && typeof input.org === 'object') {
    su.org = {
      name: input.org.name ? String(input.org.name) : undefined,
      country: input.org.country ? String(input.org.country) : undefined,
      industry: input.org.industry ? String(input.org.industry) : undefined,
      size: input.org.size ? String(input.org.size) : undefined,
    };
  }

  if (Array.isArray(input.roles)) {
    su.roles = input.roles.filter((r: any) => typeof r === 'string');
  }

  if (Array.isArray(input.useCases)) {
    su.useCases = input.useCases.map((u: any, idx: number) => ({
      id: u.id || `uc-${Date.now()}-${idx}`,
      name: u.name ? String(u.name) : undefined,
      description: u.description ? String(u.description) : undefined,
      process: u.process ? String(u.process) : undefined,
      inScope: typeof u.inScope === 'boolean' ? u.inScope : undefined,
      risk: ['minimal', 'limited', 'high', 'prohibited', 'unknown'].includes(u.risk)
        ? u.risk
        : undefined,
      model: u.model ? String(u.model) : undefined,
      data: Array.isArray(u.data)
        ? u.data.filter((x: any) => typeof x === 'string')
        : undefined,
      subjects: Array.isArray(u.subjects)
        ? u.subjects.filter((x: any) => typeof x === 'string')
        : undefined,
      owner: u.owner ? String(u.owner) : undefined,
      jurisdictions: Array.isArray(u.jurisdictions)
        ? u.jurisdictions.filter((x: any) => typeof x === 'string')
        : undefined,
    }));
  }

  return su;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { input, model, state } = req.body || {};
  if (!input || typeof input !== 'string') {
    return res.status(400).json({ error: 'Missing "input" string in body' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server' });
  }

  const selectedModel =
    (typeof model === 'string' && model.trim()) ||
    process.env.OPENAI_MODEL ||
    'gpt-4o-mini';

  try {
    const systemPrompt = `
You are an EU AI Act compliance assistant designed for small and medium-sized enterprises (SMEs, 50–300 employees). 
Your goal is to help organizations go through the EU AI Act compliance process with the minimum number of steps. 

Follow this structured reasoning order:
1. Identify the organization’s role(s) in the AI ecosystem. Allowed roles: "provider", "deployer", "importer", "distributor", "manufacturer", "other".
2. Inventory all AI use cases within the organization.
3. Build a structured AI Use Case Registry summarizing those use cases.

Guidelines:
- Always stay factual and concise.
- Ask at most two clarification questions.
- Never invent details — if missing, ask the user directly.
- If using a third-party AI system without modifying or selling it, classify as "deployer".
- Use business-friendly language.
- Be deterministic and consistent.

Output format (always prefer deeper, actionable content by default):
1. Start with a short summary.
2. Provide concise, actionable guidance that references the user's current use cases by name and includes a brief "why this matters" rationale for each item.
3. Ask targeted follow-up questions (max 3) to collect missing details needed for compliance (e.g., data categories, owners, jurisdictions, risk rationale). Keep questions specific and answerable.
4. Provide a roadmap (if you have enough details) that breaks work down into tasks with owners, due dates (<= 90 days), and acceptance criteria. One section per use case.
5. If the user asks for examples or how-to, provide 2–3 short, concrete examples tailored to their described use cases.
6. Then include **exactly one fenced JSON block** with this structure (guidance are non-clickable company recommendations; suggestions are optional next actions the user may take):

\`\`\`json
{
  "guidance": ["example guidance 1", "example guidance 2"],
  "suggestions": ["Add another AI use case", "Generate compliance summary"],
  "questions": ["Q1?", "Q2?"],
  "examples": ["Example answer 1...", "Example answer 2..."],
  "roadmap": [
    {
      "useCaseId": "uc-1",
      "useCaseName": "Customer Support Chatbot",
      "risk": { "level": "limited", "rationale": "short reason" },
      "tasks": [
        {
          "title": "Define human oversight SOP",
          "owner": "Support Lead",
          "dueInDays": 30,
          "acceptance": "SOP approved and communicated to agents"
        }
      ]
    }
  ],
  "stateUpdates": {
    "org": {
      "name": "ExampleCorp",
      "country": "Latvia",
      "industry": "Retail",
      "size": "SME"
    },
    "roles": ["deployer"],
    "useCases": [
      {
        "id": "uc-1",
        "name": "Recommendation Engine",
        "description": "AI system recommending products to customers",
        "process": "E-commerce personalization",
        "inScope": true,
        "risk": "limited",
        "model": "Google Recommendations AI",
        "data": ["browsing data", "purchase history"],
        "subjects": ["customers"],
        "owner": "Marketing Department",
        "jurisdictions": ["EU"]
      }
    ]
  }
}
\`\`\`

Rules:
- Do not output more than 4 suggestions.
- Do not output more than 6 guidance items.
- Do not output more than 3 questions.
- Do not output more than 3 examples.
- Only include a roadmap if you can infer meaningful tasks; otherwise ask questions first.
- Keep JSON valid and parseable.
- Do not repeat or explain JSON outside the fenced block.
`;

    const userEnvelope = { message: input, state: (state ?? {}) as AgentState };
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        input: `${systemPrompt}\n\n<INPUT>\n${JSON.stringify(userEnvelope)}`,
        temperature: 0,
        store: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `OpenAI error: ${errText}` });
    }

    const data = await response.json();

    // Extract text from any OpenAI response format
    const extractText = (d: any): string => {
      if (!d) return '';
      if (typeof d.output_text === 'string' && d.output_text.trim()) return d.output_text;

      if (Array.isArray(d.output)) {
        const parts: string[] = [];
        for (const item of d.output) {
          const content = item?.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              const val =
                (typeof c?.text === 'string' && c.text) ||
                (typeof c?.text?.value === 'string' && c.text.value) ||
                '';
              if (val) parts.push(val);
            }
          }
        }
        if (parts.join('').trim()) return parts.join('\n');
      }

      const cc = d.choices?.[0]?.message?.content;
      if (typeof cc === 'string') return cc;
      if (Array.isArray(cc)) return cc.map((x: any) => x?.text || '').join('\n');
      return '';
    };

    const reply = extractText(data);
    console.log('=== MODEL REPLY ===');
    console.log(reply);

    // --- Extract JSON robustly ---
    let jsonText: string | null = null;

    const fenced = reply.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) jsonText = fenced[1];
    else {
      const plain = reply.match(/{[\s\S]*}/);
      if (plain) jsonText = plain[0];
    }

    let suggestions: string[] | undefined;
    let guidance: string[] | undefined;
    let questions: string[] | undefined;
    let examples: string[] | undefined;
    let roadmap: any[] | undefined;
    let stateUpdates: Partial<AgentState> | undefined;

    if (jsonText) {
      try {
        const obj = JSON.parse(jsonText);
        if (Array.isArray(obj?.suggestions)) {
          suggestions = obj.suggestions.filter((s: any) => typeof s === 'string').slice(0, 4);
        }
        if (Array.isArray(obj?.guidance)) {
          guidance = obj.guidance.filter((g: any) => typeof g === 'string').slice(0, 6);
        }
        if (Array.isArray(obj?.questions)) {
          questions = obj.questions.filter((q: any) => typeof q === 'string').slice(0, 3);
        }
        if (Array.isArray(obj?.examples)) {
          examples = obj.examples.filter((e: any) => typeof e === 'string').slice(0, 3);
        }
        if (Array.isArray(obj?.roadmap)) {
          roadmap = obj.roadmap;
        }
        if (obj?.stateUpdates && typeof obj.stateUpdates === 'object') {
          stateUpdates = sanitizeStateUpdates(obj.stateUpdates);
        }
      } catch (err) {
        console.warn('Failed to parse JSON:', err);
      }
    }

    // Remove JSON before sending reply
    const cleanReply = reply
      .replace(/```json[\s\S]*?```/gi, '')
      .replace(/```[\s\S]*?```/gi, '')
      .trim();

    // Expose top-level useCases for convenience
    const useCases = stateUpdates?.useCases;

    return res.status(200).json({
      reply: cleanReply || '',
      suggestions,
      guidance,
      questions,
      examples,
      roadmap,
      stateUpdates,
      useCases,
      raw: data,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unknown server error' });
  }
}
