import { Sidebar } from "@/components/dashboard/sidebar";
import { NewLeadNotifier } from "@/components/dashboard/new-lead-notifier";
import { NotificationBell } from "@/components/dashboard/notification-bell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-auto">
        <header className="sticky top-0 z-40 flex items-center justify-end h-14 px-8 border-b bg-white/80 backdrop-blur-sm">
          <NotificationBell />
        </header>
        <main className="flex-1 p-8" style={{ background: "#f1f5f9" }}>
          {children}
        </main>
      </div>
      <NewLeadNotifier />
    </div>
  );
}
