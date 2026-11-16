import { useEffect, useMemo, useRef, useState } from 'react';
import { loadData } from '../lib/data';
import { compact } from '../lib/format';
import { StatsDesk, type Answer, type History } from '../lib/stats';

const SUGGESTIONS = [
  'Who has the most wins at Monaco?',
  'How many podiums does Fernando Alonso have?',
  'Hamilton vs Verstappen',
  'Who won the 2008 Brazilian Grand Prix?',
  'How many DNFs did Ferrari have in 2022?',
  'Which team has the most poles since 2014?',
  'Who won the championship in 1976?',
  'Most fastest laps in the 2010s',
];

const KEYWORDS = /\b(SELECT|FROM|JOIN|USING|WHERE|AND|GROUP BY|ORDER BY|LIMIT|DESC|AS|COUNT|SUM|BETWEEN|IN|FILTER|DISTINCT)\b/g;

function Sql({ text }: { text: string }) {
  const parts = text.split(KEYWORDS);
  return (
    <pre className="sql">
      {parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : /'[^']*'/.test(p) ? p.split(/('[^']*')/).map((s, k) => (k % 2 ? <i key={`${i}-${k}`}>{s}</i> : s)) : p))}
    </pre>
  );
}

function AnswerCard({ q, a }: { q: string; a: Answer }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`ans${a.ok ? '' : ' is-miss'}`}>
      <div className="ans-q">
        <span className="label">Asked</span>
        {q}
      </div>
      <div className="ans-body panel ticks">
        <div className="ans-head">
          <h3>{a.headline}</h3>
          {a.detail && <p>{a.detail}</p>}
          {a.note && <p className="ans-note">{a.note}</p>}
        </div>
        {a.rows && a.columns && (
          <div className="ans-table-wrap">
            <table className="ans-table">
              <thead>
                <tr>
                  {a.columns.map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.rows.map((r, i) => (
                  <tr key={i} style={{ ['--i' as string]: i }}>
                    {r.cells.map((c, k) => (
                      <td key={k} className={typeof c === 'number' || /^[\d.,–]+$/.test(String(c)) ? 'num' : ''}>
                        {c}
                        {r.bar != null && k === r.cells.length - 1 && a.columns!.length <= 3 && (
                          <span className="ans-bar">
                            <i style={{ transform: `scaleX(${r.bar})` }} />
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {a.sql && (
          <div className="ans-foot">
            <span className="num">
              {compact(a.scanned ?? 0)} rows scanned in {a.ms! < 10 ? a.ms!.toFixed(1) : Math.round(a.ms!)} ms, in your browser
            </span>
            <button className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? 'Hide query' : 'Show query'}
            </button>
          </div>
        )}
        {a.sql && open && <Sql text={a.sql} />}
      </div>
    </article>
  );
}

export function Stats() {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState(false);
  const [thread, setThread] = useState<{ q: string; a: Answer }[]>([]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData<History>('history.json').then(setHistory, () => setError(true));
  }, []);
  const desk = useMemo(() => (history ? new StatsDesk(history) : null), [history]);

  const ask = (q: string) => {
    const clean = q.trim();
    if (!desk || !clean) return;
    setThread((t) => [...t, { q: clean, a: desk.ask(clean) }]);
    setText('');
    requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  };

  // open with one answered question so the page is never empty
  useEffect(() => {
    if (desk && thread.length === 0) setThread([{ q: SUGGESTIONS[0], a: desk.ask(SUGGESTIONS[0]) }]);
  }, [desk]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page stats">
      <header className="page-head">
        <span className="label rise">Stats desk</span>
        <h1 className="display rise" style={{ ['--i' as string]: 1 }}>
          Ask the results table
        </h1>
        <p className="rise" style={{ ['--i' as string]: 2 }}>
          {history
            ? `${history.span[1] - history.span[0] + 1} seasons, ${history.races.length.toLocaleString()} races and ${history.results.length.toLocaleString()} results, from ${history.span[0]} to ${history.span[1]}. Every answer is computed from the data in your browser, and shows the query it ran.`
            : error
              ? 'The results history has not been built yet. Run the history pipeline to load it.'
              : 'Loading every result since 1950…'}
        </p>
      </header>

      <div className="stats-thread">
        {thread.map((item, i) => (
          <AnswerCard key={i} q={item.q} a={item.a} />
        ))}
        <div ref={end} />
      </div>

      <div className="stats-ask">
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={!desk}>
              {s}
            </button>
          ))}
        </div>
        <form
          className="askbar"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3.5 3.5" />
          </svg>
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="How many wins does Ferrari have at Monza?" aria-label="Ask a question about Formula 1 results" disabled={!desk} />
          <button className="btn" type="submit" disabled={!desk || !text.trim()}>
            Ask
          </button>
        </form>
      </div>
    </main>
  );
}
