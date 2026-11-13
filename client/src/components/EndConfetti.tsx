import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#facc15'];
const W = 160;
const H = 120;
const DURATION = 1500;

type Particle = { x: number; y: number; vx: number; vy: number; size: number; color: string; spin: number; angle: number };

/**
 * A small confetti burst confined to ~160×120px, centred on the right end of its (relative) parent.
 * Never blocks clicks. Under prefers-reduced-motion it shows a short glow instead.
 */
export default function EndConfetti({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0, ready: false });
  // Keep the latest callback without restarting the animation when the parent re-renders.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Centre the burst on the bar's right end (viewport coordinates).
  useLayoutEffect(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.top, ready: true });
  }, []);

  useEffect(() => {
    if (reduced) {
      const t = window.setTimeout(() => onDoneRef.current(), DURATION);
      return () => window.clearTimeout(t);
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const particles: Particle[] = Array.from({ length: 60 }, () => {
      const a = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.6;
      return {
        x: W / 2,
        y: H / 2,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 1.6,
        size: 3 + Math.random() * 3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? '#4f46e5',
        spin: (Math.random() - 0.5) * 0.4,
        angle: Math.random() * Math.PI,
      };
    });

    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      const alpha = Math.max(0, 1 - t / DURATION);
      for (const p of particles) {
        p.vy += 0.09; // gravity
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (t < DURATION) frame = requestAnimationFrame(tick);
      else onDoneRef.current();
    };
    frame = requestAnimationFrame(tick);
    // Animation frames pause in background tabs; always clean up anyway.
    const fallback = window.setTimeout(() => onDoneRef.current(), DURATION + 500);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, [reduced]);

  if (reduced) {
    return <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full ring-4 ring-emerald-300/70" />;
  }
  return (
    <>
      <span ref={anchorRef} aria-hidden className="pointer-events-none absolute right-0 top-1/2 h-0 w-0" />
      {/* Fixed (not absolute) so the burst can spill past the card without adding page scrollbars. */}
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: 'fixed', left: pos.x - W / 2, top: pos.y - H / 2, width: W, height: H, pointerEvents: 'none', zIndex: 60, visibility: pos.ready ? 'visible' : 'hidden' }}
      />
    </>
  );
}
