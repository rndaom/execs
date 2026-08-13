import type { Metadata } from "next";
import { Big_Shoulders, Inter } from "next/font/google";
import Link from "next/link";
import { UserMenu } from "@/components/user-menu";
import "./globals.css";

const display = Big_Shoulders({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display-next",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body-next",
});

export const metadata: Metadata = {
  title: { default: "execs — TF2 configs, shared", template: "%s · execs" },
  description:
    "Browse, share, and one-click-install Team Fortress 2 configs. Every config linted for safety before it reaches your game.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh flex flex-col antialiased">
        <header className="border-b border-edge">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-display text-2xl text-brand">
              execs
            </Link>
            <nav className="flex items-center gap-4 text-sm text-ink-muted">
              <Link href="/" className="hover:text-ink">
                Browse
              </Link>
              <Link href="/upload" className="hover:text-ink">
                Upload
              </Link>
              <Link href="/install-guide" className="hover:text-ink">
                Install guide
              </Link>
            </nav>
            <div className="ml-auto">
              <UserMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-edge py-6 text-center text-xs text-ink-faint">
          <p>
            Powered by Steam. execs is a fan project and is not affiliated with Valve Corporation.
            Team Fortress and Steam are trademarks of Valve Corporation.
          </p>
          <p className="mt-1">
            <Link href="/legal" className="underline hover:text-ink-muted">
              Legal &amp; takedowns
            </Link>
          </p>
        </footer>
      </body>
    </html>
  );
}
