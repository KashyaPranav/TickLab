"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  CalendarCheck,
  History as HistoryIcon,
  ListChecks,
  Settings as SettingsIcon,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { startSyncEngine } from "@/lib/sync/engine";
import { useGuestMerge } from "@/hooks/useGuestMerge";

const NAV = [
  { href: "/today", label: "Today", icon: CalendarCheck },
  { href: "/habits", label: "Habits", icon: ListChecks },
  { href: "/history", label: "History", icon: HistoryIcon },
  { href: "/insights", label: "Insights", icon: TrendingUp },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const satisfies readonly { href: string; label: string; icon: LucideIcon }[];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const isActive = useIsActive();
  useGuestMerge();

  // Idempotent: wires up open, reconnect and tab-focus triggers once.
  useEffect(() => {
    startSyncEngine();
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        Phones get a bottom tab bar, because five tabs plus the wordmark cannot
        fit across 320px and a nav you have to scroll sideways is worse than one
        you can always reach with a thumb. From sm up it moves inline, where the
        horizontal space exists.
      */}
      <header className="sticky top-0 z-40 hidden border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:block">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <Link href="/today" className="font-semibold tracking-tight">
            TickLab
          </Link>
          <nav aria-label="Main">
            <ul className="flex items-center gap-0.5">
              {NAV.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex h-9 items-center rounded-lg px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        active
                          ? "bg-accent font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>

      {/* pb-24 keeps the last card clear of the fixed tab bar. */}
      <main id="main" className="flex-1 pb-24 sm:pb-8">
        {children}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:hidden"
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-full flex-col items-center gap-0.5 px-1 py-2 text-[0.6875rem] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon aria-hidden className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}