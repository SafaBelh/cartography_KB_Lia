import type { Core, EventObject, NodeSingular } from 'cytoscape';
import { useCallback, useState } from 'react';

/**
 * Elastic drag: while a node is dragged, its neighbours follow it on damped springs
 * (1 hop strongly, 2 hops faintly), then settle where the springs come to rest once released.
 *
 * Each follower i has an anchor a (the dragged node for 1 hop, a 1-hop follower for 2 hops) and a
 * weight w. Its rest position is p0_i + w · (pos(a) − p0_a): it keeps its place relative to the
 * graph, displaced by a fraction of its anchor's motion. A semi-implicit spring/damper integrates
 * towards that rest position every frame, which gives the trailing "rubber band" motion.
 * Nothing runs when the graph is idle: the loop starts on drag and stops once everything is at rest.
 */

export interface PhysicsOptions {
  /** Nodes that must never be pulled (hubs, compound parents…). */
  pinned?: (n: NodeSingular) => boolean;
  maxFollowers?: number;
}

interface Follower {
  n: NodeSingular;
  anchor: NodeSingular;
  a0: { x: number; y: number };
  p0: { x: number; y: number };
  p: { x: number; y: number };
  v: { x: number; y: number };
  w: number;
  k: number;
}

const STIFF_1 = 0.075; // per 16.7 ms frame
const STIFF_2 = 0.05;
const DAMPING = 0.78; // velocity kept per frame: < 1 → a little overshoot, then rest
const W_1 = 0.62;
const W_2 = 0.24;

export function attachDragPhysics(cy: Core, initialEnabled: boolean, opts: PhysicsOptions = {}) {
  let enabled = initialEnabled;
  let followers: Follower[] = [];
  let dragging: NodeSingular | null = null;
  let raf = 0;
  let last = 0;
  let restFrames = 0;
  const maxFollowers = opts.maxFollowers ?? 48;
  const pinned = (n: NodeSingular) => n.isParent() || n.locked() || n.grabbed() || (opts.pinned?.(n) ?? false);

  const build = (g: NodeSingular) => {
    const seen = new Set([g.id()]);
    const out: Follower[] = [];
    const add = (n: NodeSingular, anchor: NodeSingular, w: number, k: number) => {
      if (seen.has(n.id()) || pinned(n) || out.length >= maxFollowers) return;
      seen.add(n.id());
      const p = { ...n.position() };
      out.push({ n, anchor, a0: { ...anchor.position() }, p0: { ...p }, p, v: { x: 0, y: 0 }, w, k });
    };
    const gp = g.position();
    const byDist = (a: NodeSingular, b: NodeSingular) => dist(a.position(), gp) - dist(b.position(), gp);
    const hop1 = g.neighborhood('node').filter((n) => n.visible()).sort(byDist);
    hop1.forEach((n) => add(n, g, W_1, STIFF_1));
    const first = [...out];
    for (const f of first) {
      f.n.neighborhood('node').filter((n) => n.visible()).forEach((n) => add(n, f.n, W_2, STIFF_2));
    }
    return out;
  };

  const loop = (t: number) => {
    const dt = Math.min(3, last ? (t - last) / 16.667 : 1);
    last = t;
    let moving = false;
    // anchors may be followers themselves: read their simulated position, not the stale one
    const simPos = new Map(followers.map((f) => [f.n.id(), f.p]));
    cy.batch(() => {
      for (const f of followers) {
        if (f.n.removed() || f.n.grabbed()) continue;
        const ap = simPos.get(f.anchor.id()) ?? f.anchor.position();
        const tx = f.p0.x + f.w * (ap.x - f.a0.x);
        const ty = f.p0.y + f.w * (ap.y - f.a0.y);
        const damp = Math.pow(DAMPING, dt);
        f.v.x = (f.v.x + f.k * (tx - f.p.x) * dt) * damp;
        f.v.y = (f.v.y + f.k * (ty - f.p.y) * dt) * damp;
        f.p.x += f.v.x * dt;
        f.p.y += f.v.y * dt;
        if (Math.abs(f.v.x) + Math.abs(f.v.y) > 0.03 || Math.abs(tx - f.p.x) + Math.abs(ty - f.p.y) > 0.25) moving = true;
        f.n.position({ x: f.p.x, y: f.p.y });
      }
    });
    // a node held still stops the loop too; the next drag event restarts it
    restFrames = moving ? 0 : restFrames + 1;
    if (restFrames > 3) {
      raf = 0;
      last = 0;
      restFrames = 0;
      if (!dragging) followers = [];
      return;
    }
    raf = requestAnimationFrame(loop);
  };
  const start = () => {
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  };

  const onGrab = (e: EventObject) => {
    if (!enabled) return;
    const g = e.target as NodeSingular;
    // a node grabbed while the previous ones are still settling: restart from where they are now
    followers = build(g);
    dragging = g;
  };
  const onDrag = () => {
    if (enabled && dragging) start();
  };
  const onFree = () => {
    dragging = null;
    if (followers.length) start();
  };
  cy.on('grab', 'node', onGrab);
  cy.on('drag', 'node', onDrag);
  cy.on('free', 'node', onFree);

  return {
    setEnabled(b: boolean) {
      enabled = b;
      if (!b) {
        cancelAnimationFrame(raf);
        raf = 0;
        followers = [];
        dragging = null;
      }
    },
    destroy() {
      cancelAnimationFrame(raf);
      cy.off('grab', 'node', onGrab);
      cy.off('drag', 'node', onDrag);
      cy.off('free', 'node', onFree);
    },
  };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** "Physique" toggle, remembered per browser (falls back to on when storage is unavailable). */
export function usePhysicsPref(): [boolean, (b: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem('carto-physics') !== '0';
    } catch {
      return true;
    }
  });
  const set = useCallback((b: boolean) => {
    setOn(b);
    try {
      localStorage.setItem('carto-physics', b ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, []);
  return [on, set];
}
