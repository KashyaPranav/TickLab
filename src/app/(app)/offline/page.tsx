import Link from "next/link";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10"
    >
      <h1 className="text-center text-2xl font-semibold tracking-tight">
        You are offline
      </h1>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        This screen is not cached yet. Anything you have already opened still
        works, and your check-ins are saved on this device either way.
      </p>
      <Link
        href="/today"
        className="mx-auto mt-6 inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        Back to Today
      </Link>
    </main>
  );
}