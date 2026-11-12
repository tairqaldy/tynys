import type { ReactNode } from 'react';
import type { AirResponse, KindMeta, PlanResponse, RouteResponse } from '../api/types';
import { QuestionHead, Skeleton } from '../components/common';
import { MathAstar } from '../math/MathAstar';
import { MathHmm } from '../math/MathHmm';
import { MathMdp } from '../math/MathMdp';
import type { Navigate } from '../lib/route';

interface Props {
  air: AirResponse | null;
  plan: PlanResponse | null;
  route: RouteResponse | null;
  kinds: KindMeta[];
  navigate: Navigate;
}

function Panel({ n, title, sub, children }: { n: string; title: string; sub: string; children: ReactNode }) {
  return (
    <details className="panel">
      <summary>
        <span className="panel__n" aria-hidden="true">
          {n}
        </span>
        <span className="panel__titles">
          <span className="panel__title">{title}</span>
          <span className="panel__sub">{sub}</span>
        </span>
        <span className="panel__chev" aria-hidden="true" />
      </summary>
      <div className="panel__body">{children}</div>
    </details>
  );
}

export function MathSection({ air, plan, route, kinds, navigate }: Props) {
  return (
    <section className="q q--math" aria-labelledby="q-math" id="math">
      <QuestionHead n="∑" id="q-math" kicker="Inputs → steps → output" title="Show the math" />
      <p className="lede">
        The live numbers behind the answers above, input to output. To play with each algorithm, open{' '}
        <a
          href="/docs"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            navigate('docs');
          }}
        >
          How it works
        </a>
        .
      </p>
      <Panel n="1" title="Hidden Markov model" sub="Belief about the air now: transition and emission matrices, one Bayes step, Viterbi">
        {air ? <MathHmm air={air} /> : <Skeleton lines={4} />}
      </Panel>
      <Panel n="2" title="Markov decision process" sub="Go, wait or skip: rewards, the Bellman backup, the belief-weighted choice">
        {plan ? <MathMdp plan={plan} /> : <Skeleton lines={4} />}
      </Panel>
      <Panel n="3" title="A* search" sub="Two cost functions, an admissible heuristic, expansions against Dijkstra">
        <MathAstar kinds={kinds} route={route} />
      </Panel>
    </section>
  );
}
