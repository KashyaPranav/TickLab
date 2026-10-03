"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { getUser, onAuthChange } from "@/lib/supabase/auth";
import "./landing.css";

const HABITS = [
  { id: "gym", label: "Gym session", time: "7:00" },
  { id: "coffee", label: "Black coffee", time: "11:30" },
  { id: "read", label: "Read something new", time: "10:45" },
  { id: "water", label: "8 glasses of water", time: "All day" },
];
const WORDS = ["tunnels", "flights", "dead zones", "new phones"];
const CHIPS = [
  "Works offline",
  "Under 30 seconds",
  "Rest days never break it",
  "Export anytime",
];
const C = 2 * Math.PI * 44;

export default function Landing({ loggedIn: initialLoggedIn }: { loggedIn?: boolean }) {
  const [on, setOn] = useState<Record<string, boolean>>({ coffee: true });
  const [burst, setBurst] = useState(0);

  // Seeded from the server so the first paint is already correct: with
  // @supabase/ssr the session is a cookie, so the server component can read it
  // and there is no flash of the signed-out CTA. The listener is kept because
  // signing in or out in another tab has to update this one.
  const [loggedIn, setLoggedIn] = useState(initialLoggedIn ?? false);
  useEffect(() => {
    void getUser().then((user) => setLoggedIn(!!user));
    return onAuthChange((_event, userId) => setLoggedIn(!!userId));
  }, []);

  const count = HABITS.filter((h) => on[h.id]).length;
  const pct = Math.round((count / HABITS.length) * 100);
  const full = count === HABITS.length;

  // Seeded from `burst` rather than Math.random: render must stay pure, and a
  // seeded throw is also easier to eyeball when tweaking the animation.
  const bits = useMemo(() => {
    if (burst === 0) return [];
    let seed = burst * 2654435761;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    return Array.from({ length: 28 }, (_, i) => ({
      x: (next() - 0.5) * 380,
      y: -90 - next() * 230,
      r: next() * 720,
      c: i % 4,
    }));
  }, [burst]);

  function toggle(id: string) {
    const next = { ...on, [id]: !on[id] };
    setOn(next);
    if (HABITS.every((h) => next[h.id])) setBurst((b) => b + 1);
  }

  function tilt(e: PointerEvent<HTMLDivElement>) {
    const b = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width - 0.5;
    const y = (e.clientY - b.top) / b.height - 0.5;
    e.currentTarget.style.setProperty("--ry", `${x * 8}deg`);
    e.currentTarget.style.setProperty("--rx", `${-y * 8}deg`);
  }

  function untilt(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.style.setProperty("--ry", "0deg");
    e.currentTarget.style.setProperty("--rx", "0deg");
  }

  return (
    <main className="lp" id="main">
      <div className="lp-orb a" />
      <div className="lp-orb b" />
      <div className="lp-grid" />

      <header className="lp-top">
        <Link href="/" className="lp-logo" aria-label="TickLab home">
          <span className="lp-mark">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          TickLab
        </Link>
        <Link href={loggedIn ? "/today" : "/login"} className="lp-link">
          {loggedIn ? "Open app" : "Log in"}
        </Link>
      </header>

      <section className="lp-main">
        <div className="lp-copy">
          <span className="lp-badge rise" style={{ "--d": "0ms" } as CSSProperties}>
            <i /> Offline-first habit tracking
          </span>

          <h1 className="rise" style={{ "--d": "80ms" } as CSSProperties}>
            Your streak survives
            <span className="lp-rot" aria-live="off">
              {WORDS.map((w, i) => (
                <span key={w} style={{ animationDelay: `${i * 2.5}s` }}>
                  {w}
                </span>
              ))}
            </span>
          </h1>

          <p className="rise" style={{ "--d": "160ms" } as CSSProperties}>
            Tap to check off your day in under 30 seconds. Every tick saves to your device first,
            then syncs when you have signal. Nothing gets lost.
          </p>

          <div className="lp-cta rise" style={{ "--d": "240ms" } as CSSProperties}>
            {loggedIn ? (
              <>
                <Link href="/today" className="lp-btn primary">
                  Start tracking <b aria-hidden="true">→</b>
                </Link>
                <Link href="/history" className="lp-btn">
                  View history
                </Link>
              </>
            ) : (
              <>
                <Link href="/signup" className="lp-btn primary">
                  Create free account <b aria-hidden="true">→</b>
                </Link>
                <Link href="/today" className="lp-btn">
                  Try without an account
                </Link>
              </>
            )}
          </div>
        </div>

        <div
          className="lp-stage rise"
          style={{ "--d": "200ms" } as CSSProperties}
          onPointerMove={tilt}
          onPointerLeave={untilt}
        >
          <div className={`lp-card${full ? " full" : ""}`}>
            <div className="lp-card-h">
              <div className="lp-ring">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <circle className="bg" cx="50" cy="50" r="44" />
                  <circle
                    className="fg"
                    cx="50"
                    cy="50"
                    r="44"
                    strokeDasharray={C}
                    strokeDashoffset={C - (C * pct) / 100}
                  />
                </svg>
                <span>{pct}%</span>
              </div>
              <div>
                <small>Try it, tap a habit</small>
                <div className="lp-streak">
                  <span key={full ? "up" : "base"} className="pop">
                    {full ? 13 : 12}
                  </span>{" "}
                  day streak
                </div>
              </div>
            </div>

            <div className="lp-list">
              {HABITS.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={`lp-row${on[h.id] ? " on" : ""}`}
                  role="checkbox"
                  aria-checked={!!on[h.id]}
                  onClick={() => toggle(h.id)}
                >
                  <span className="cb">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  <span className="lb">{h.label}</span>
                  <span className="tm">{h.time}</span>
                </button>
              ))}
            </div>

            <div className={`lp-note${full ? " show" : ""}`}>Day complete. Streak extended.</div>

            <div className="lp-burst" key={burst} aria-hidden="true">
              {bits.map((b, i) => (
                <i
                  key={i}
                  className={`c${b.c}`}
                  style={
                    {
                      "--x": `${b.x}px`,
                      "--y": `${b.y}px`,
                      "--r": `${b.r}deg`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="lp-chips">
        {CHIPS.map((c, i) => (
          <span key={c} className="rise" style={{ "--d": `${360 + i * 70}ms` } as CSSProperties}>
            {c}
          </span>
        ))}
      </footer>
    </main>
  );
}