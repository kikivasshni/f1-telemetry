import { useEffect, useState } from 'react';
import { loadIndex } from './lib/data';
import { href, useRoute, type Route } from './lib/router';
import type { SeasonIndex } from './lib/types';
import { Home } from './views/Home';
import { Lake } from './views/Lake';
import { Predictor } from './views/Predictor';
import { Race } from './views/Race';
import { Stats } from './views/Stats';

const LINKS: { label: string; route: Route }[] = [
  { label: 'Season', route: { name: 'home' } },
  { label: 'Predictor', route: { name: 'predictor' } },
  { label: 'Stats desk', route: { name: 'stats' } },
  { label: 'Data lake', route: { name: 'lake' } },
];

export function App() {
  const route = useRoute();
  const [index, setIndex] = useState<SeasonIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIndex().then(setIndex, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (route.name !== 'race') window.scrollTo(0, 0);
  }, [route.name]);

  const ready = index
    ? Object.values(index.seasons)
        .flatMap((s) => s.races)
        .filter((r) => r.status === 'ready').length
    : 0;
  const activeName = route.name === 'race' ? 'home' : route.name;

  return (
    <div className="app">
      <header className="nav">
        <a className="brand" href={href({ name: 'home' })} aria-label="Pit Wall home">
          <i className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </i>
          <span>Pit Wall</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.label} className={`nav-link${activeName === l.route.name ? ' is-active' : ''}`} href={href(l.route)}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav-right">
          <a className="pulse-chip" href={href({ name: 'lake' })} title="Open the data lake">
            <i className="pulse-dot" />
            {ready ? `${ready} sessions in the lake` : 'loading the lake'}
          </a>
        </div>
      </header>

      {error ? (
        <div className="loader">
          <div className="loader-inner">
            <div className="label">Could not load the season index</div>
            <div className="loader-title">Data lake unreachable</div>
            <p className="dim" style={{ marginTop: 10 }}>
              {error}
            </p>
          </div>
        </div>
      ) : !index ? (
        <div className="loader">
          <div className="loader-inner">
            <div className="label">Pit Wall</div>
            <div className="loader-title">Reading the season</div>
            <div className="loader-bar">
              <i style={{ transform: 'scaleX(0.3)' }} />
            </div>
          </div>
        </div>
      ) : route.name === 'race' ? (
        <Race key={route.key} raceKey={route.key} tab={route.tab} index={index} />
      ) : route.name === 'predictor' ? (
        <Predictor index={index} />
      ) : route.name === 'stats' ? (
        <Stats />
      ) : route.name === 'lake' ? (
        <Lake index={index} />
      ) : (
        <Home index={index} />
      )}
    </div>
  );
}
