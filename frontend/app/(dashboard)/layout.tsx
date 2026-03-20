import { Sidebar } from "@/components/dashboard/sidebar";
import { NewLeadNotifier } from "@/components/dashboard/new-lead-notifier";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto" style={{ background: "#f1f5f9" }}>
        {children}
      </main>
      <NewLeadNotifier />
    </div>
  );
}
