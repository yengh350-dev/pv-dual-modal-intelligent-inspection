import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, Gauge, RefreshCw, Send, Square, Trash2, UserRound, X } from 'lucide-react';
import { IconButton } from './ui';
import { askCopilot, getAIProviders, getApiErrorMessage, type AIProvider, type CopilotMessage } from '../lib/api';

type Message = { role: 'user' | 'assistant'; text: string; meta?: string; sources?: string[] };
type PendingQuestion = { text: string; context: Record<string, unknown>; provider: string; history: CopilotMessage[] };
const greeting: Message = { role: 'assistant', text: '我可以帮助复核巡检证据、整理运维清单和分析模型结果。请告诉我你想确认的问题。', meta: '建议需人工确认，不自动执行操作' };

export default function Copilot({ open, onClose, context }: { open: boolean; onClose: () => void; context: Record<string, unknown> }) {
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [provider, setProvider] = useState(() => window.localStorage.getItem('sentinel_ai_provider') ?? 'auto');
  const [failure, setFailure] = useState('');
  const [copied, setCopied] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const retryRef = useRef<PendingQuestion | null>(null);
  const catalogGeneration = useRef(0);

  const loadProviders = useCallback(async () => {
    const generation = ++catalogGeneration.current;
    setCatalogState('loading');
    try {
      const result = await getAIProviders();
      if (generation !== catalogGeneration.current) return;
      setProviders(result.providers);
      setProvider((current) => current === 'auto' || result.providers.some((item) => item.id === current && item.configured) ? current : 'auto');
      setCatalogState('ready');
    } catch {
      if (generation === catalogGeneration.current) setCatalogState('error');
    }
  }, []);

  useEffect(() => {
    if (open) void loadProviders();
    return () => { catalogGeneration.current += 1; };
  }, [open, loadProviders]);
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); active?.focus(); };
  }, [open, onClose]);
  useEffect(() => { if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, loading, failure, open]);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const send = async (question: PendingQuestion, retry = false) => {
    if (requestRef.current || catalogState !== 'ready') return;
    const controller = new AbortController();
    requestRef.current = controller;
    retryRef.current = question;
    setFailure('');
    setCopied(null);
    setLoading(true);
    if (!retry) { setMessages((items) => [...items, { role: 'user', text: question.text }]); setInput(''); }
    try {
      const result = await askCopilot(question.text, question.context, question.provider, question.history, controller.signal);
      if (controller.signal.aborted) return;
      setMessages((items) => [...items, { role: 'assistant', text: result.answer, sources: result.sources, meta: `${result.providerLabel} · ${result.model} · ${(result.latencyMs / 1000).toFixed(1)} s${result.mode === 'demo' ? ' · 本地规则解释，非大模型' : ''}` }]);
      retryRef.current = null;
    } catch (error) {
      if (!controller.signal.aborted) setFailure(getApiErrorMessage(error, '未收到模型回复，请检查连接或切换已配置的模型后重试。'));
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setLoading(false); }
    }
  };
  const submit = (text = input) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 4000) return;
    void send({ text: trimmed, context: structuredClone(context), provider, history: messages.slice(1).slice(-8).map((item) => ({ role: item.role, content: item.text })) });
  };
  const stop = () => {
    requestRef.current?.abort();
    setFailure('已停止等待。服务端可能仍在处理，未执行任何工程操作。');
  };
  const copy = async (text: string, index: number) => {
    try { await navigator.clipboard.writeText(text); setCopied(index); }
    catch { setFailure('浏览器未允许复制，请选择回答文本进行复制。'); }
  };
  const active = providers.find((item) => item.id === provider) ?? providers.find((item) => item.default);
  const available = catalogState === 'ready' && providers.some((item) => item.configured);

  return <aside className={open ? 'copilot open' : 'copilot'} aria-hidden={!open} inert={!open} role="dialog" aria-label="Sentinel AI 助手">
    <header><div><span className="ai-mark"><Bot /></span><span><strong>巡检助手</strong><small>{catalogState === 'ready' ? active?.label ?? '自动选择模型' : catalogState === 'error' ? '连接不可用' : '正在读取配置'}</small></span></div><div className="copilot-header-actions"><IconButton label="清空会话" disabled={loading || messages.length === 1} onClick={() => { setMessages([greeting]); setFailure(''); retryRef.current = null; }}><Trash2 /></IconButton><IconButton label="关闭 AI 助手" onClick={onClose}><X /></IconButton></div></header>
    <div className="copilot-provider"><label htmlFor="copilot-provider">模型</label><select id="copilot-provider" value={provider} disabled={loading || !available} onChange={(event) => { setProvider(event.target.value); window.localStorage.setItem('sentinel_ai_provider', event.target.value); }}><option value="auto">自动选择已配置模型</option>{providers.map((item) => <option key={item.id} value={item.id} disabled={!item.configured}>{item.label} · {item.configured ? item.model : '未配置密钥'}</option>)}</select><IconButton label="刷新模型配置" disabled={loading || catalogState === 'loading'} onClick={() => void loadProviders()}><RefreshCw /></IconButton></div>
    <div className="copilot-context"><Gauge /><span>{String(context.module ?? '当前页面')}</span><b>仅提供建议</b></div>
    {catalogState === 'error' ? <div className="copilot-alert" role="alert">模型目录不可达。请检查平台 API，或点击刷新重试。</div> : null}
    <div ref={scrollRef} className="copilot-messages" role="log" aria-live="polite" aria-relevant="additions" aria-busy={loading}>
      {messages.map((message, index) => <div key={index} className={`message ${message.role}`}><span>{message.role === 'assistant' ? <Bot /> : <UserRound />}</span><div className="message-body"><p>{message.text}</p>{message.meta ? <small>{message.meta}</small> : null}{message.sources?.length ? <details className="answer-sources"><summary>回答依据</summary><ul>{message.sources.map((source) => <li key={source}>{source}</li>)}</ul></details> : null}{index > 0 && message.role === 'assistant' ? <button className="copy-answer" onClick={() => void copy(message.text, index)}><span>{copied === index ? <Check /> : <Copy />}</span>{copied === index ? '已复制' : '复制回答'}</button> : null}</div></div>)}
      {loading ? <div className="message assistant"><span><Bot /></span><div className="message-body"><p className="thinking">正在分析本次提交的页面证据…</p><small>模型响应时间取决于服务商</small></div></div> : null}
      {failure ? <div className="copilot-alert" role="alert"><p>{failure}</p>{retryRef.current && available ? <button disabled={loading} onClick={() => retryRef.current && void send({ ...retryRef.current, provider }, true)}><RefreshCw />重试此问题</button> : null}</div> : null}
    </div>
    <div className="prompt-chips">{['解释当前风险', '生成现场复核清单', '说明当前模块'].map((text) => <button key={text} disabled={loading || !available} onClick={() => submit(text)}>{text}</button>)}</div>
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}><textarea ref={inputRef} maxLength={4000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="询问任务、证据或运维问题…" aria-label="询问 AI 助手" />{loading ? <button type="button" onClick={stop} aria-label="停止等待" title="停止等待"><Square /></button> : <button type="submit" disabled={!available || !input.trim()} aria-label="发送消息" title="发送消息"><Send /></button>}</form>
  </aside>;
}
