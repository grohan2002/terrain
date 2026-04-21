"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  ArrowLeftRight,
  FolderSync,
  History,
  LogOut,
  Map,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { useState } from "react";

const navItems = [
  { href: "/convert", label: "Convert", icon: ArrowLeftRight },
  { href: "/batch", label: "Batch", icon: FolderSync },
  { href: "/history", label: "History", icon: History },
  { href: "/mappings", label: "Mappings", icon: Map },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: session } = useSession();

  return (
    <>
      {/* Skip to content */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:text-sm"
      >
        Skip to content
      </a>

      {/* Mobile menu button */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-3 left-3 z-50 md:hidden"
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={mobileOpen}
        aria-controls="main-sidebar"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>

      {/* Sidebar */}
      <aside
        id="main-sidebar"
        role="navigation"
        aria-label="Main navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <ArrowLeftRight className="h-5 w-5 text-cta" />
          <span className="font-semibold text-sm text-sidebar-foreground">Terrain</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || (pathname === "/" && item.href === "/convert");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-l-2 border-cta bg-cta/10 text-sidebar-accent-foreground"
                    : "border-l-2 border-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-3 space-y-2">
          {session?.user && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-cta-foreground text-[10px] font-medium">
                  {(session.user.name ?? session.user.email ?? "U")[0].toUpperCase()}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-sidebar-foreground/60 truncate">
                    {session.user.email ?? session.user.name}
                  </span>
                  {"role" in session.user && (
                    <span className="text-[10px] text-sidebar-foreground/40 capitalize">
                      {(session.user.role as string)?.toLowerCase()}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => signOut({ callbackUrl: "/login" })}
                aria-label="Sign out"
              >
                <LogOut className="h-3 w-3" />
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-sidebar-foreground/60">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
}
