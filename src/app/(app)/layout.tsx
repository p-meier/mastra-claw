import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { requireAdmin } from "@/lib/auth";

/**
 * Authenticated app shell. Single auth gate for everything under
 * `(app)/*` — once you pass requireAdmin() here, every nested page can
 * trust that the user is signed in and is an admin.
 *
 * Pages still call requireAdmin() themselves where they need the
 * CurrentUser object — calls are deduped via React.cache, so it's free.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const currentUser = await requireAdmin();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar currentUser={currentUser} />
        {children}
      </SidebarProvider>
    </TooltipProvider>
  );
}
