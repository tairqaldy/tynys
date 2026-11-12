import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './hooks';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A number that glides to its new value (ease-out). Jumps straight there with reduced motion.
 * `initial` sets where the first glide starts (for a count-up on mount); default: no first glide.
 */
export function useTween(target: number, ms = 600, initial?: number): number {
  const reduced = useReducedMotion();
  const start0 = initial ?? target;
  const [v, setV] = useState(start0);
  const from = useRef(start0);
  const cur = useRef(start0);
  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      cur.current = target;
      setV(target);
      return;
    }
    from.current = cur.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - start) / ms));
      const x = from.current + (target - from.current) * easeOut(k);
      cur.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return v;
}

/** Tween every entry of a vector together; `initial` as in useTween. */
export function useTweenVec(target: readonly number[], ms = 600, initial?: readonly number[]): number[] {
  const reduced = useReducedMotion();
  const key = target.join(',');
  const [v, setV] = useState<number[]>(() => [...(initial ?? target)]);
  const cur = useRef<number[]>([...(initial ?? target)]);
  useEffect(() => {
    const to = key.split(',').map(Number);
    if (reduced) {
      cur.current = to;
      setV(to);
      return;
    }
    const from = cur.current.length === to.length ? [...cur.current] : to.map(() => 0);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = easeOut(Math.max(0, Math.min(1, (now - start) / ms)));
      const x = to.map((t, i) => from[i] + (t - from[i]) * k);
      cur.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, ms, reduced]);
  return v;
}

/** True once the element has scrolled into view (stays true). */
export function useInView<T extends Element>(margin = '0px 0px -12% 0px'): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin, seen]);
  return [ref, seen];
}
