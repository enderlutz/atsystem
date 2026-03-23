"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { api, leadDetailCache, type Lead, type Estimate } from "@/lib/api";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, CheckCircle2, Circle, Flame, LayoutGrid, List, Send, Sparkles, Zap } from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const LAST_VISIT_KEY = "atSystemLastVisitAt";

const WORKFLOW_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  asking_address: "Asking Address",
  hot_lead: "Hot Lead",
  proposal_sent: "Proposal Sent",
  no_package_selection: "No Package",
  package_selected: "Pkg Selected",
  no_date_selected: "No Date",
  date_selected: "Date Selected",
  deposit_paid: "Deposit Paid",
  additional_service: "Add-on",
  job_complete: "Complete",
  cold_nurture: "Cold Nurture",
  past_customer: "Past Customer",
};

function prefetchLead(id: string) {
  if (leadDetailCache.has(id)) return;
  api.getLead(id).then((data) => leadDetailCache.set(id, data)).catch(() => {});
}
const LEADS_CACHE_KEY = "at_leads_cache";
const ESTIMATES_CACHE_KEY = "at_estimates_cache";

type KanbanStatus = "gray" | "no_address" | "needs_info" | "green" | "yellow" | "red" | "follow_up" | "sent_addons" | "sent";

// Tags that route a lead into "Needs More Information"
const NEEDS_INFO_TAGS = new Set(["Needs height", "Age of the Fence", "Needs Info", "needs_info"]);
// Tags that route a lead into "Follow Up Quote"
const FOLLOW_UP_TAGS = new Set(["Follow Up Quote", "follow_up_quote", "Follow Up"]);

// Queue sort order for kanban column (lower = higher priority action needed)
const COLUMN_QUEUE_ORDER: Record<KanbanStatus, number> = {
  green: 0,
  yellow: 1,
  needs_info: 2,
  no_address: 3,
  gray: 4,
  follow_up: 5,
  red: 6,
  sent_addons: 7,
  sent: 8,
};

const PRIORITY_ORDER: Record<string, number> = { HOT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function getKanbanStatus(lead: Lead, estimateMap: Map<string, Estimate>): KanbanStatus {
  const est = estimateMap.get(lead.id);
  // Explicit VA override takes priority (allows moving sent leads to follow_up etc.)
  if (lead.kanban_column) return lead.kanban_column as KanbanStatus;
  // Sent/approved leads: route to sent column based on additional services
  if (lead.status === "sent" || lead.status === "approved" || est?.status === "approved") {
    const addSvcs = ((lead.form_data?.additional_services as string) || "").trim();
    if (addSvcs) return "sent_addons";
    return "sent";
  }
  if (!lead.address || lead.address.trim() === "") return "no_address";
  if (lead.tags?.some((t) => NEEDS_INFO_TAGS.has(t))) return "needs_info";
  if (lead.tags?.some((t) => FOLLOW_UP_TAGS.has(t))) return "follow_up";
  if (!est) return "gray";
  const approval = est.inputs?._approval_status;
  if (approval === "green") return "green";
  if (approval === "yellow") return "yellow";
  if (approval === "red") return "red";
  return "gray";
}

const COLUMNS: {
  key: KanbanStatus;
  label: string;
  description: string;
  headerCls: string;
  bgCls: string;
  dotCls: string;
}[] = [
  {
    key: "gray",
    label: "New / Untouched",
    description: "No estimate activity yet",
    headerCls: "bg-gray-100 border-gray-200",
    bgCls: "bg-gray-50",
    dotCls: "bg-gray-400",
  },
  {
    key: "no_address",
    label: "No Address",
    description: "Missing address — can't estimate zone",
    headerCls: "bg-purple-100 border-purple-200",
    bgCls: "bg-purple-50",
    dotCls: "bg-purple-400",
  },
  {
    key: "needs_info",
    label: "Needs More Information",
    description: "Tagged: missing fence height, age, etc.",
    headerCls: "bg-orange-100 border-orange-200",
    bgCls: "bg-orange-50",
    dotCls: "bg-orange-400",
  },
  {
    key: "green",
    label: "Ready to Send",
    description: "All criteria met — auto-send approved",
    headerCls: "bg-green-100 border-green-200",
    bgCls: "bg-green-50",
    dotCls: "bg-green-500",
  },
  {
    key: "yellow",
    label: "Add-ons Pending",
    description: "Send fence quote, price add-ons separately",
    headerCls: "bg-yellow-100 border-yellow-200",
    bgCls: "bg-yellow-50",
    dotCls: "bg-yellow-500",
  },
  {
    key: "red",
    label: "Needs Review",
    description: "Outside zone, too small, 15+ yrs, or missing data",
    headerCls: "bg-red-100 border-red-200",
    bgCls: "bg-red-50",
    dotCls: "bg-red-500",
  },
  {
    key: "follow_up",
    label: "Follow Up Quote",
    description: "Quote sent — awaiting follow-up",
    headerCls: "bg-sky-100 border-sky-200",
    bgCls: "bg-sky-50",
    dotCls: "bg-sky-500",
  },
  {
    key: "sent_addons",
    label: "Sent — Add-Ons Needed",
    description: "Estimate sent. Additional services requested — follow up for a separate quote.",
    headerCls: "bg-cyan-100 border-cyan-200",
    bgCls: "bg-cyan-50",
    dotCls: "bg-cyan-500",
  },
  {
    key: "sent",
    label: "Estimate Sent",
    description: "All 3 packages delivered to the customer",
    headerCls: "bg-emerald-100 border-emerald-200",
    bgCls: "bg-emerald-50",
    dotCls: "bg-emerald-500",
  },
];

const COLUMN_BADGE: Record<KanbanStatus, string> = {
  green: "bg-green-100 text-green-700",
  yellow: "bg-yellow-100 text-yellow-700",
  red: "bg-red-100 text-red-700",
  gray: "bg-gray-100 text-gray-600",
  no_address: "bg-purple-100 text-purple-700",
  needs_info: "bg-orange-100 text-orange-700",
  follow_up: "bg-sky-100 text-sky-700",
  sent_addons: "bg-cyan-100 text-cyan-700",
  sent: "bg-emerald-100 text-emerald-700",
};

const COLUMN_LABEL: Record<KanbanStatus, string> = {
  green: "Ready to Send",
  yellow: "Add-ons Pending",
  red: "Needs Review",
  gray: "New",
  no_address: "No Address",
  needs_info: "Needs Info",
  follow_up: "Follow Up",
  sent_addons: "Sent — Add-Ons",
  sent: "Estimate Sent",
};

const priorityColors: Record<string, string> = {
  HOT: "bg-red-100 text-red-700",
  HIGH: "bg-orange-100 text-orange-700",
  MEDIUM: "bg-blue-100 text-blue-700",
  LOW: "bg-gray-100 text-gray-600",
};

const tagColors: Record<string, string> = {
  "HOT LEAD_SEND ESTIMATE": "bg-red-100 text-red-700",
  "New Lead": "bg-blue-100 text-blue-700",
  "Needs height": "bg-orange-100 text-orange-700",
  "Age of the Fence": "bg-orange-100 text-orange-700",
  "Follow Up Quote": "bg-sky-100 text-sky-700",
  "Follow Up": "bg-sky-100 text-sky-700",
};

function DroppableColumnCards({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${className} transition-colors duration-150${isOver ? " ring-2 ring-inset ring-primary/30 brightness-95" : ""}`}
    >
      {children}
    </div>
  );
}

function DraggableKanbanCard({ leadId, children }: { leadId: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: leadId });
  return (
    <div
      ref={setNodeRef}
      className={`touch-none${isDragging ? " opacity-0" : " cursor-grab active:cursor-grabbing"}`}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [estimateMap, setEstimateMap] = useState<Map<string, Estimate>>(new Map());
  const [loading, setLoading] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"kanban" | "queue">("kanban");
  const [quickApprovingId, setQuickApprovingId] = useState<string | null>(null);
  const [newLeadIds, setNewLeadIds] = useState<Set<string>>(new Set());
  const [newLeadCount, setNewLeadCount] = useState(0);
  const [newBannerDismissed, setNewBannerDismissed] = useState(false);
  const [activeDragLead, setActiveDragLead] = useState<Lead | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  const loadData = useCallback(async () => {
    let leadsData: Lead[], estimatesData: Estimate[];
    try {
      [leadsData, estimatesData] = await Promise.all([
        api.getLeads("limit=200"),
        api.getEstimates("limit=200"),
      ]);
    } catch {
      return; // silently skip on error — next poll will retry
    }
    setLeads(leadsData);
    const map = new Map<string, Estimate>();
    for (const est of estimatesData) {
      if (!map.has(est.lead_id)) map.set(est.lead_id, est);
    }
    setEstimateMap(map);

    // Cache for instant next visit
    try {
      localStorage.setItem(LEADS_CACHE_KEY, JSON.stringify(leadsData));
      localStorage.setItem(ESTIMATES_CACHE_KEY, JSON.stringify(estimatesData));
    } catch { /* ignore */ }

    // "New Lead" logic — compare against last visit timestamp
    const lastVisit = localStorage.getItem(LAST_VISIT_KEY);
    if (lastVisit) {
      const newOnes = leadsData.filter((l) => l.created_at > lastVisit);
      setNewLeadIds(new Set(newOnes.map((l) => l.id)));
      setNewLeadCount(newOnes.length);
    }
  }, []);

  useEffect(() => {
    // Show cached data immediately for instant load
    try {
      const cachedLeads = localStorage.getItem(LEADS_CACHE_KEY);
      const cachedEstimates = localStorage.getItem(ESTIMATES_CACHE_KEY);
      if (cachedLeads && cachedEstimates) {
        const leads = JSON.parse(cachedLeads) as Lead[];
        const estimates = JSON.parse(cachedEstimates) as Estimate[];
        setLeads(leads);
        const map = new Map<string, Estimate>();
        for (const est of estimates) {
          if (!map.has(est.lead_id)) map.set(est.lead_id, est);
        }
        setEstimateMap(map);
        setLoading(false);
      }
    } catch { /* ignore */ }

    Promise.all([loadData(), api.getSyncStatus()])
      .then(([, syncStatus]) => setLastSyncAt(syncStatus.last_sync_at))
      .catch(console.error)
      .finally(() => setLoading(false));

    // Auto-refresh every 60 seconds — picks up new leads synced from GHL by the backend poller
    const interval = setInterval(() => {
      loadData();
      api.getSyncStatus().then((s) => setLastSyncAt(s.last_sync_at)).catch(() => {});
    }, 60 * 1000);

    // Reload when tab becomes visible again (e.g. after editing a lead detail page)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadData().catch(console.error);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadData]);

  // Stamp the current time after 5 seconds so next visit knows the baseline
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
    }, 5000);
    return () => {
      clearTimeout(timer);
      // Also stamp on unmount (tab close / navigate away)
      localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
    };
  }, []);

  const handleDismissNewBanner = () => {
    setNewBannerDismissed(true);
    // Clear the "new" highlights too — they've been seen
    setNewLeadIds(new Set());
  };

  const handleQuickApprove = async (lead: Lead) => {
    const est = estimateMap.get(lead.id);
    if (!est) return;
    setQuickApprovingId(est.id);
    try {
      await api.approveEstimate(est.id);
      // Update local estimate map to reflect new status
      const updated = new Map(estimateMap);
      updated.set(lead.id, { ...est, status: "approved" });
      setEstimateMap(updated);
      // Update lead status
      setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, status: "sent" } : l));
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to send estimate");
    } finally {
      setQuickApprovingId(null);
    }
  };

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveDragLead(lead ?? null);
  }, [leads]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragLead(null);
    const { active, over } = event;
    if (!over) return;
    const leadId = active.id as string;
    const newCol = over.id as KanbanStatus;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const currentCol = getKanbanStatus(lead, estimateMap);
    if (currentCol === newCol) return;
    // Block dragging into "sent" columns — leads only enter these when estimate is actually approved
    if (newCol === "sent" || newCol === "sent_addons") return;
    // Optimistic update
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, kanban_column: newCol } : l));
    try {
      await api.updateLeadColumn(leadId, newCol);
    } catch (e) {
      console.error(e);
      setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, kanban_column: lead.kanban_column ?? null } : l));
    }
  }, [leads, estimateMap]);

  const filtered = leads.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (l.contact_name || "").toLowerCase().includes(q) ||
      l.address.toLowerCase().includes(q)
    );
  });

  // HOT leads that haven't been sent/approved yet
  const hotCount = leads.filter(
    (l) => l.priority === "HOT" && l.status !== "sent" && l.status !== "approved"
  ).length;

  // Queue: all filtered leads sorted by priority, then by date (newest first within same priority)
  const queueLeads = [...filtered].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    // Within same priority: newest first
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3" style={{ minWidth: "max-content" }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-64 w-64 rounded-lg bg-muted animate-pulse flex-shrink-0" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">
          {leads.length} total
          {lastSyncAt && (
            <span className="ml-2 text-xs" title={formatDate(lastSyncAt)}>
              · Last synced {(() => {
                const diff = Date.now() - new Date(lastSyncAt).getTime();
                const mins = Math.floor(diff / 60000);
                if (mins < 1) return "just now";
                if (mins < 60) return `${mins}m ago`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `${hrs}h ago`;
                return formatDate(lastSyncAt);
              })()}
            </span>
          )}
        </p>
      </div>

      {/* HOT Leads Banner */}
      {hotCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 text-sm font-medium">
          <Flame className="h-4 w-4 text-orange-500 shrink-0" />
          <span>
            {hotCount} urgent lead{hotCount > 1 ? "s" : ""} — ASAP / This week — need attention now
          </span>
          <button
            className="ml-auto text-xs underline underline-offset-2 hover:no-underline"
            onClick={() => setActiveTab("queue")}
          >
            View in Queue →
          </button>
        </div>
      )}

      {/* New Leads Banner */}
      {!newBannerDismissed && newLeadCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-blue-500 shrink-0" />
          <span>
            {newLeadCount} new lead{newLeadCount > 1 ? "s" : ""} added since your last visit
          </span>
          <button
            className="ml-auto text-xs underline underline-offset-2 hover:no-underline"
            onClick={handleDismissNewBanner}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Search + Tabs row */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or address..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center rounded-lg border p-1 gap-1 bg-background">
          <button
            onClick={() => setActiveTab("kanban")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "kanban"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Kanban
          </button>
          <button
            onClick={() => setActiveTab("queue")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "queue"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="h-3.5 w-3.5" /> Queue
          </button>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:block">
          {activeTab === "kanban" ? "↓ Newest submitted first" : "↓ Sorted by priority · HOT → HIGH → MEDIUM → LOW"}
        </span>
      </div>

      {/* ── KANBAN VIEW ── */}
      {activeTab === "kanban" && (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveDragLead(null)}>
        <div className="overflow-x-auto pb-3">
          <div className="flex gap-3" style={{ minWidth: "max-content" }}>
            {COLUMNS.map((col) => {
              const colLeads = filtered
                .filter((l) => getKanbanStatus(l, estimateMap) === col.key)
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

              return (
                <div
                  key={col.key}
                  className={`rounded-lg border ${col.headerCls} flex flex-col flex-shrink-0`}
                  style={{ width: "260px", minHeight: "500px" }}
                >
                  {/* Column header */}
                  <div className={`px-3 py-2.5 border-b ${col.headerCls} rounded-t-lg`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${col.dotCls}`} />
                      <span className="font-semibold text-sm">{col.label}</span>
                      {col.key === "red" && (
                        <span className="text-xs text-red-500 font-normal">· Owner</span>
                      )}
                      <span className="ml-auto text-xs font-medium bg-white/70 rounded-full px-2 py-0.5">
                        {colLeads.length}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 pl-4">{col.description}</p>
                  </div>

                  {/* Cards */}
                  <DroppableColumnCards id={col.key} className={`flex-1 p-2 space-y-2 ${col.bgCls} rounded-b-lg overflow-y-auto`}>
                    {colLeads.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-10">No leads</p>
                    ) : (
                      colLeads.map((lead) => {
                        const est = estimateMap.get(lead.id);
                        const reason = est?.inputs?._approval_reason as string | undefined;
                        const isOwnerLead = col.key === "red";
                        const leadAddress = typeof lead.address === "string" ? lead.address : "";
                        const leadFormData = (lead.form_data || {}) as Record<string, unknown>;
                        const needsAddressConfirmation = Boolean(leadFormData.address_autocompleted) && !Boolean(leadFormData.address_confirmed);

                        return (
                          <DraggableKanbanCard key={lead.id} leadId={lead.id}>
                          <div
                            className={`bg-white rounded-md border shadow-sm p-3 space-y-2 hover:shadow-md transition-shadow ${
                              isOwnerLead ? "opacity-80" : ""
                            } ${newLeadIds.has(lead.id) ? "ring-2 ring-blue-300 ring-offset-1" : ""}`}
                          >
                            {/* Name + priority */}
                            <div className="flex items-start justify-between gap-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {newLeadIds.has(lead.id) && (
                                  <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
                                    NEW
                                  </span>
                                )}
                                <span className="font-medium text-sm leading-tight truncate">
                                  {lead.contact_name || "—"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {isOwnerLead && (
                                  <span className="inline-flex px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                                    👤 Owner
                                  </span>
                                )}
                                <span
                                  className={`inline-flex px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                    priorityColors[lead.priority] || priorityColors.MEDIUM
                                  }`}
                                >
                                  {lead.priority}
                                </span>
                              </div>
                            </div>

                            {/* Address */}
                            {leadAddress && (
                              <p className="text-xs text-muted-foreground truncate">{leadAddress}</p>
                            )}

                            {/* Unconfirmed address badge */}
                            {needsAddressConfirmation && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 border border-amber-200 font-medium">
                                ⚠ Confirm address
                              </span>
                            )}

                            {/* Estimate — tier prices only */}
                            {(() => {
                              const t = est?.inputs?._tiers as Record<string, number> | undefined;
                              if (!t?.signature) return null;
                              return (
                                <div className="text-xs text-emerald-700 space-y-0.5">
                                  <div className="flex gap-2"><span className="text-muted-foreground">E</span><span className="font-medium">${Number(t.essential || 0).toFixed(0)}</span></div>
                                  <div className="flex gap-2"><span className="text-muted-foreground">S</span><span className="font-semibold">${Number(t.signature).toFixed(0)}</span></div>
                                  <div className="flex gap-2"><span className="text-muted-foreground">L</span><span className="font-medium">${Number(t.legacy || 0).toFixed(0)}</span></div>
                                </div>
                              );
                            })()}

                            {/* Funnel stage (sent column) */}
                            {col.key === "sent" && (() => {
                              const stage = est?.proposal_funnel_stage;
                              if (!stage || stage === "booked") return null;
                              const STAGE_LABELS: Record<string, string> = {
                                sent: "Not opened yet",
                                opened: "Viewed",
                                hoa_selected: "HOA step",
                                package_selected: "Package picked",
                                color_selected: "Color picked",
                                date_selected: "Date picked",
                                checkout_started: "At checkout",
                              };
                              return (
                                <span className="text-xs text-blue-600 flex items-center gap-1">
                                  📊 {STAGE_LABELS[stage] || stage}
                                </span>
                              );
                            })()}

                            {/* Customer page activity indicator */}
                            {col.key === "sent" && est?.proposal_last_active_at && (() => {
                              const lastActive = est.proposal_last_active_at;
                              const leftAt = est.proposal_left_page_at;
                              const now = Date.now();
                              const activeMs = lastActive ? now - new Date(lastActive).getTime() : Infinity;
                              const isActive = activeMs < 120_000 && (!leftAt || new Date(lastActive!).getTime() > new Date(leftAt!).getTime());
                              const hasLeft = leftAt && (!lastActive || new Date(leftAt).getTime() >= new Date(lastActive).getTime());
                              const mins = Math.floor((hasLeft ? now - new Date(leftAt!).getTime() : activeMs) / 60_000);
                              const ago = mins < 1 ? "now" : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
                              if (isActive) return <span className="text-xs text-green-600 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />Active now</span>;
                              if (hasLeft) return <span className="text-xs text-red-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />Left {ago}</span>;
                              return null;
                            })()}

                            {/* Workflow stage badge */}
                            {lead.workflow_stage && (
                              <span className="text-xs text-violet-600 flex items-center gap-1">
                                <Zap className="h-3 w-3" /> {WORKFLOW_LABELS[lead.workflow_stage] || lead.workflow_stage}
                                {lead.workflow_paused && <span className="text-yellow-600">(paused)</span>}
                              </span>
                            )}

                            {/* Review reason (red column) */}
                            {col.key === "red" && reason && (
                              <p className="text-xs text-red-600 leading-tight">{reason}</p>
                            )}

                            {/* Tags */}
                            {lead.tags?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {lead.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                                      tagColors[tag] || "bg-gray-100 text-gray-600"
                                    }`}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Footer: responded + date + view */}
                            <div className="flex items-center justify-between pt-0.5">
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                {lead.customer_responded ? (
                                  <>
                                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                                    <span>Responded</span>
                                  </>
                                ) : (
                                  <>
                                    <Circle className="h-3 w-3 text-gray-300" />
                                    <span className="text-gray-400">{formatDate(lead.created_at)}</span>
                                  </>
                                )}
                              </div>
                              <Button size="sm" variant="outline" className="h-6 text-xs px-2" asChild onMouseEnter={() => prefetchLead(lead.id)}>
                                <Link href={`/leads/${lead.id}`}>View</Link>
                              </Button>
                            </div>
                          </div>
                          </DraggableKanbanCard>
                        );
                      })
                    )}
                  </DroppableColumnCards>
                </div>
              );
            })}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDragLead ? (
            <div className="bg-white rounded-md border shadow-xl p-3 space-y-1 cursor-grabbing" style={{ width: "260px" }}>
              <div className="flex items-center justify-between gap-1">
                <span className="font-medium text-sm truncate">{activeDragLead.contact_name || "—"}</span>
                <span className={`inline-flex px-1.5 py-0.5 rounded-full text-xs font-medium ${priorityColors[activeDragLead.priority] || priorityColors.MEDIUM}`}>
                  {activeDragLead.priority}
                </span>
              </div>
              {activeDragLead.address && (
                <p className="text-xs text-muted-foreground truncate">{activeDragLead.address}</p>
              )}
            </div>
          ) : null}
        </DragOverlay>
        </DndContext>
      )}

      {/* ── QUEUE VIEW ── */}
      {activeTab === "queue" && (
        <div className="space-y-1.5">
          {queueLeads.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No leads match your search.</p>
          ) : (
            queueLeads.map((lead) => {
              const kanbanStatus = getKanbanStatus(lead, estimateMap);
              const est = estimateMap.get(lead.id);
              const reason = est?.inputs?._approval_reason as string | undefined;
              const leadPriority = typeof lead.priority === "string" ? lead.priority : "MEDIUM";
              const leadName = typeof lead.contact_name === "string" ? lead.contact_name : "";
              const leadAddress = typeof lead.address === "string" ? lead.address : "";
              const leadStatus = typeof lead.status === "string" ? lead.status : "";
              const customerResponded = Boolean(lead.customer_responded);
              const leadFormData = (lead.form_data || {}) as Record<string, unknown>;
              const needsAddressConfirmation = Boolean(leadFormData.address_autocompleted) && !Boolean(leadFormData.address_confirmed);
              const isHot = leadPriority === "HOT";
              const isOwner = kanbanStatus === "red";
              const canApprove = (kanbanStatus === "green" || kanbanStatus === "yellow")
                && customerResponded
                && est?.status === "pending"
                && leadStatus !== "sent";
              const alreadySent = leadStatus === "sent" || est?.status === "approved";

              return (
                <div
                  key={lead.id}
                  className={`flex items-center gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm hover:shadow-md transition-shadow ${
                    isHot ? "border-l-4 border-l-orange-400" : ""
                  } ${isOwner ? "opacity-75" : ""} ${newLeadIds.has(lead.id) ? "ring-2 ring-blue-300 ring-offset-1" : ""}`}
                >
                  {/* NEW badge */}
                  {newLeadIds.has(lead.id) && (
                    <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
                      NEW
                    </span>
                  )}
                  {/* Priority */}
                  <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                    priorityColors[leadPriority] || priorityColors.MEDIUM
                  }`}>
                    {leadPriority}
                  </span>

                  {/* Name + address */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{leadName || "—"}</p>
                    <p className="text-xs text-muted-foreground truncate">{leadAddress || "No address"}</p>
                  </div>

                  {/* Unconfirmed address badge */}
                  {needsAddressConfirmation && (
                    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 border border-amber-200 font-medium">
                      ⚠ Confirm address
                    </span>
                  )}

                  {/* Column status badge */}
                  <span className={`shrink-0 hidden sm:inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${COLUMN_BADGE[kanbanStatus]}`}>
                    {isOwner ? "👤 " : ""}{COLUMN_LABEL[kanbanStatus]}
                  </span>

                  {/* Estimate — tier prices only */}
                  {(() => {
                    const t = est?.inputs?._tiers as Record<string, number> | undefined;
                    if (!t?.signature) return null;
                    return (
                      <span className="shrink-0 text-xs font-medium text-emerald-700 hidden md:block whitespace-nowrap">
                        E ${Number(t.essential || 0).toFixed(0)} · S ${Number(t.signature).toFixed(0)} · L ${Number(t.legacy || 0).toFixed(0)}
                      </span>
                    );
                  })()}

                  {/* Review reason for red */}
                  {isOwner && reason && (
                    <span className="shrink-0 text-xs text-red-600 hidden lg:block max-w-[180px] truncate" title={reason}>
                      {reason}
                    </span>
                  )}

                  {/* Customer responded indicator */}
                  {lead.customer_responded ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-gray-300 shrink-0" />
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {alreadySent ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Sent
                      </span>
                    ) : canApprove ? (
                      <Button
                        size="sm"
                        className="h-7 text-xs px-2.5 bg-green-600 hover:bg-green-700 gap-1"
                        disabled={quickApprovingId === est?.id}
                        onClick={() => handleQuickApprove(lead)}
                      >
                        <Send className="h-3 w-3" />
                        {quickApprovingId === est?.id ? "Sending…" : "Approve"}
                      </Button>
                    ) : (kanbanStatus === "green" || kanbanStatus === "yellow") && !lead.customer_responded ? (
                      <span className="text-xs text-muted-foreground shrink-0">Awaiting reply</span>
                    ) : null}
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2.5" asChild onMouseEnter={() => prefetchLead(lead.id)}>
                      <Link href={`/leads/${lead.id}`}>View</Link>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
