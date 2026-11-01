"use client";

import { useEffect, useRef, useState } from "react";

export type TourItem = {
  id: string;
  eyebrow: string;
  title: string;
  titleHighlight: string;
  desc: string;
  points: string[];
  /** The feature's animated mockup (src/components/download/Mockups.tsx). */
  mock: React.ReactNode;
};

const STEP_MS = 7000;

/** Homepage tour of the desktop app's headline features: tabs that play
 * through on their own (paused on hover or focus, and off for reduced
 * motion), each with its mockup. A visitor can also pick one. */
export default function FeatureTour({ items }: { items: TourItem[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const playing = !paused && !reduced;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setActive((i) => (i + 1) % items.length), STEP_MS);
    return () => clearTimeout(timer);
  }, [active, playing, items.length]);

  // On phones the tabs scroll sideways: keep the playing one in view
  // (scrolling only the tab row, never the page).
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = tabsRef.current;
    const tab = row?.children[active] as HTMLElement | undefined;
    if (row && tab && row.scrollWidth > row.clientWidth) {
      row.scrollTo({ left: tab.offsetLeft - row.offsetLeft - 16, behavior: reduced ? "auto" : "smooth" });
    }
  }, [active, reduced]);

  const item = items[active];

  return (
    <div
      className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div>
        <div ref={tabsRef} role="tablist" aria-label={item.eyebrow} className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {items.map((it, i) => {
            const on = i === active;
            return (
              <button
                key={it.id}
                type="button"
                role="tab"
                id={`tour-tab-${it.id}`}
                aria-selected={on}
                aria-controls="tour-panel"
                onClick={() => setActive(i)}
                className={`relative shrink-0 overflow-hidden rounded-2xl border px-4 py-3 text-left transition lg:shrink ${
                  on ? "border-cyan-500/50 bg-surface-2/90 shadow-[0_0_25px_rgba(34,211,238,0.15)]" : "border-border/70 bg-surface-2/40 hover:border-cyan-500/30"
                }`}
              >
                <span className={`block text-xs font-bold uppercase tracking-[0.14em] ${on ? "text-cyan-600" : "text-muted"}`}>{it.eyebrow}</span>
                <span className="mt-1 hidden font-display text-base font-bold text-foreground lg:block">
                  {it.title}
                  {it.titleHighlight}
                </span>
                {on && (
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-border/60">
                    <span
                      key={`${active}-${playing}`}
                      className="block h-full bg-gradient-to-r from-accent to-cyan-500"
                      style={playing ? { animation: `tour-progress ${STEP_MS}ms linear forwards` } : { width: "100%" }}
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${item.id}`} className="mt-6">
          <h3 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl lg:hidden">
            {item.title}
            <span className="text-gradient">{item.titleHighlight}</span>
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base lg:mt-0">{item.desc}</p>
          <ul className="mt-4 space-y-2">
            {item.points.slice(0, 3).map((p) => (
              <li key={p} className="flex gap-2 text-sm text-foreground">
                <span className="font-bold text-cyan-600">✓</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative">
        <div aria-hidden className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-accent/15 to-cyan-500/15 blur-xl" />
        <div key={item.id} className="animate-tour-fade">
          {item.mock}
        </div>
      </div>
    </div>
  );
}
