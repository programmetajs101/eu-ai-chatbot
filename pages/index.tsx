import { useEffect, useRef, useState } from 'react';

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

export default function Home() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Array<{ text: string; sender: 'user' | 'bot' }>>([]);
  const [loading, setLoading] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>({ roles: [], useCases: [] });
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [guidance, setGuidance] = useState<string[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [orgDraft, setOrgDraft] = useState({ name: '', country: '', industry: '', size: '' });

  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottom = () => endRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    try { const s = localStorage.getItem('ai_agent_state'); if (s) setAgentState(JSON.parse(s)); } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('ai_agent_state', JSON.stringify(agentState)); } catch {}
  }, [agentState]);

  // sync org draft
  useEffect(() => {
    setOrgDraft({
      name: agentState.org?.name || '',
      country: agentState.org?.country || '',
      industry: agentState.org?.industry || '',
      size: agentState.org?.size || '',
    });
  }, [agentState.org?.name, agentState.org?.country, agentState.org?.industry, agentState.org?.size]);

  const roleOptions = ['Provider', 'Deployer', 'Importer', 'Distributor'];

  const activeStep = (() => {
    if (!agentState?.roles || agentState.roles.length === 0) return 1;
    if (!agentState?.useCases || agentState.useCases.length === 0) return 2;
    return 3;
  })();

  const mergeState = (update?: Partial<AgentState>) => {
    if (!update) return;
    setAgentState(prev => ({
      ...prev,
      ...(update?.org ? { org: { ...(prev.org || {}), ...(update.org || {}) } } : {}),
      ...(update?.roles ? { roles: update.roles } : {}),
      ...(update?.useCases
        ? {
            useCases: (() => {
              const existing = prev.useCases || [];
              const incoming = update.useCases || [];
              const byId = new Map<string, any>();
              for (const u of existing) byId.set(u.id, u);
              for (const u of incoming) byId.set(u.id, { ...(byId.get(u.id) || {}), ...u });
              return Array.from(byId.values());
            })(),
          }
        : {}),
    }));
  };

  // Auto-resize helper for textarea inputs
  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'; // cap height
  };

  // Minimal formatter for bot text: headers (###), numbered items, bullets (• or -), and inline **bold**
  const renderFormatted = (text: string): JSX.Element => {
    const boldize = (t: string) => {
      const parts = t.split(/(\*\*[^*]+\*\*)/g);
      return parts.map((part, idx) => {
        const m = part.match(/^\*\*([^*]+)\*\*$/);
        if (m) return <strong key={idx}>{m[1]}</strong>;
        return <span key={idx}>{part}</span>;
      });
    };

    const lines = text.split(/\r?\n/);
    return (
      <div className="space-y-1">
        {lines.map((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={i} className="h-2" />;
          // Headers like ### Title
          if (/^#{2,6}\s+/.test(trimmed)) {
            const content = trimmed.replace(/^#{2,6}\s+/, '').trim();
            return (
              <div key={i} className="font-semibold mt-2">{boldize(content)}</div>
            );
          }
          // Numbered items: 1. Text -> bold number
          const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
          if (numMatch) {
            return (
              <div key={i}>
                <strong>{numMatch[1]}.</strong> {boldize(numMatch[2])}
              </div>
            );
          }
          // Bullets: leading • or -
          if (/^[•\-]\s+/.test(trimmed)) {
            const content = trimmed.replace(/^[•\-]\s+/, '');
            return (
              <div key={i}>• {boldize(content)}</div>
            );
          }
          return <p key={i}>{boldize(trimmed)}</p>;
        })}
      </div>
    );
  };

  // Send a message programmatically (used by clickable suggestions)
  const sendMessage = async (text: string) => {
    const userText = text.trim();
    if (!userText || loading) return;
    setMessages(prev => [...prev, { text: userText, sender: 'user' }]);
    setMessage('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: userText, state: agentState }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error || `Request failed with ${res.status}`;
        setMessages(prev => [...prev, { text: msg, sender: 'bot' }]);
      } else {
        const data = await res.json();
        const reply = (data?.reply || '').toString().trim() || '(no response)';
        setMessages(prev => [...prev, { text: reply, sender: 'bot' }]);
        if (Array.isArray(data?.suggestions)) setSuggestions(data.suggestions);
        if (Array.isArray(data?.guidance)) setGuidance(data.guidance);
        if (Array.isArray((data as any)?.questions)) setQuestions((data as any).questions);
        if (data?.stateUpdates) {
          mergeState(data.stateUpdates);
        }
        if (Array.isArray((data as any)?.useCases) && (data as any).useCases.length > 0) {
          mergeState({ useCases: (data as any).useCases });
        }
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { text: error?.message || 'Network error', sender: 'bot' }]);
    } finally {
      setLoading(false);
    }
  };

  const selectRole = (role: string) => {
    mergeState({ roles: [role] });
    setSuggestions([]);
    setMessages(prev => [...prev, { sender: 'bot', text: `Role set to ${role}. Please provide organization details below.` }]);
  };

  const saveOrg = () => {
    const clean = {
      name: orgDraft.name.trim(),
      country: orgDraft.country.trim(),
      industry: orgDraft.industry.trim(),
      size: orgDraft.size.trim(),
    };
    mergeState({ org: clean });
    setMessages(prev => [...prev, { sender: 'bot', text: 'Organization details saved. Now please provide your AI use cases.' }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMessage(message);
  };

  const applySuggestion = (s: string) => setMessage(s);

  const renderObject = (obj: any): JSX.Element => {
    if (typeof obj !== 'object' || obj === null) return <span>{String(obj)}</span>;
    if (Array.isArray(obj)) {
      return <ul className="list-disc pl-5">{obj.map((item,i)=><li key={i}>{renderObject(item)}</li>)}</ul>;
    }
    return <ul className="list-disc pl-5">{Object.entries(obj).map(([key,value])=>(
      <li key={key}><strong>{key}:</strong> {typeof value === 'object' ? renderObject(value) : String(value)}</li>
    ))}</ul>;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 w-full border-b bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex justify-between items-center">
          <div className="font-semibold">EU AI Act Assistant</div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 mt-4">

          <div className="mb-2 flex justify-center gap-4 text-sm">
            <div className={activeStep===1?'font-semibold':'text-gray-500'}>1. Role</div><div>→</div>
            <div className={activeStep===2?'font-semibold':'text-gray-500'}>2. Use cases</div><div>→</div>
            <div className={activeStep===3?'font-semibold':'text-gray-500'}>3. Registry</div>
          </div>

          {/* Registry preview */}
          {agentState.useCases && agentState.useCases.length > 0 && (
            <div className="mb-4 rounded-md border bg-white p-4">
              <div className="mb-2 text-sm font-semibold">AI Use Cases ({agentState.useCases.length})</div>
              <div className="space-y-3">
                {agentState.useCases.map((u) => (
                  <div key={u.id} className="rounded border p-3">
                    <div className="font-medium">{u.name || 'Untitled use case'}</div>
                    {u.description && <div className="text-sm text-gray-600 mt-1">{u.description}</div>}
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                      <div><span className="text-gray-500">Process:</span> {u.process || '-'}</div>
                      <div><span className="text-gray-500">Risk:</span> {u.risk || '-'}</div>
                      <div><span className="text-gray-500">Owner:</span> {u.owner || '-'}</div>
                      <div className="md:col-span-3"><span className="text-gray-500">Jurisdictions:</span> {(u.jurisdictions||[]).join(', ') || '-'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {messages.length === 0 && (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
              <h1 className="text-2xl font-semibold mb-6">Hey! Ready to dive in?</h1>
              {!agentState.roles || agentState.roles.length===0 && (
                <div className="mb-6 w-full">
                  <div className="text-sm text-gray-600 mb-2">Select your role</div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {roleOptions.map(r => <button key={r} onClick={()=>selectRole(r)} className="rounded-full border px-3 py-1 text-sm">{r}</button>)}
                  </div>
                </div>
              )}
              {agentState.roles && agentState.roles.length>0 && (
                <div className="mb-6 w-full max-w-3xl text-left">
                  <div className="text-sm text-gray-600 mb-2">Organization information</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input value={orgDraft.name} onChange={e=>setOrgDraft(v=>({...v,name:e.target.value}))} placeholder="Name" className="w-full rounded border px-3 py-2 outline-none"/>
                    <input value={orgDraft.country} onChange={e=>setOrgDraft(v=>({...v,country:e.target.value}))} placeholder="Country" className="w-full rounded border px-3 py-2 outline-none"/>
                    <input value={orgDraft.industry} onChange={e=>setOrgDraft(v=>({...v,industry:e.target.value}))} placeholder="Industry" className="w-full rounded border px-3 py-2 outline-none"/>
                    <input value={orgDraft.size} onChange={e=>setOrgDraft(v=>({...v,size:e.target.value}))} placeholder="Size (e.g., 120)" className="w-full rounded border px-3 py-2 outline-none"/>
                  </div>
                  <div className="mt-3">
                    <button onClick={saveOrg} className="rounded bg-black px-4 py-2 text-white">Save organization</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chat messages */}
          {messages.length > 0 && (
            <div className="py-6 pb-28">
              <div className="space-y-6">
                {messages.map((msg,index)=>{
                  let isJSON=false; let parsed:any=null;
                  if(msg.sender==='bot'){
                    try{ parsed = JSON.parse(msg.text); isJSON=true }catch{}
                  }

                  return (
                    <div key={index} className="flex">
                      {msg.sender==='user' ? (
                        <div className="ml-auto max-w-[85%]">
                          <div className="rounded-2xl border px-4 py-2 text-sm whitespace-pre-wrap break-words break-all hyphens-auto max-w-[60ch]">
                            {msg.text}
                          </div>
                        </div>
                      ) : (
                        <div className="max-w-[80%] break-words break-all hyphens-auto">
                          <div className="prose prose-neutral whitespace-pre-wrap break-words break-all hyphens-auto max-w-[65ch]">
                            {isJSON ? (
                              <div className="bg-gray-50 border rounded-md p-3 text-sm">{renderObject(parsed)}</div>
                            ) : (
                              renderFormatted(msg.text)
                            )}
                          </div>
                          {guidance.length>0 && (
                            <div className="mt-2">
                              <div className="text-sm font-medium mb-1">Guidance</div>
                              <ul className="list-disc pl-6 text-sm">
                                {guidance.map((g,i)=>(<li key={i}>{g}</li>))}
                              </ul>
                            </div>
                          )}
                          {questions.length>0 && (
                            <div className="mt-2">
                              <div className="text-sm font-medium mb-1">Questions</div>
                              <ul className="list-decimal pl-6 text-sm">
                                {questions.map((q,i)=>(<li key={i}>{q}</li>))}
                              </ul>
                            </div>
                          )}
                          {suggestions.length>0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {suggestions.map((s,i)=>(
                                <button key={i} onClick={()=>sendMessage(s)} className="rounded-full border px-3 py-1 text-sm">{s}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={endRef}/>
              </div>
            </div>
          )}

        </div>
      </main>

      {messages.length>0 && (
        <div className="sticky bottom-0 w-full border-t bg-white/70 backdrop-blur">
          <div className="mx-auto max-w-3xl px-4 py-4">
            <div className="w-full">
                <div className="mx-auto w-full max-w-2xl">
                  <form onSubmit={handleSubmit} className="rounded-2xl border bg-white shadow-sm">
                    <div className="flex items-center gap-2 px-3 py-1.5">
                      <input
                        type="text"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={(!agentState.roles || agentState.roles.length===0) ? 'Or choose a role above' : 'Ask anything'}
                        className="w-full bg-transparent h-8 leading-8 text-sm outline-none"
                      />
                      <button type="submit" disabled={loading} className="shrink-0 rounded-full bg-black px-3 h-8 text-xs text-white disabled:opacity-50">
                        {loading ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </form>
                </div>
              {suggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => applySuggestion(s)} className="rounded-full border px-3 py-1 text-sm">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
