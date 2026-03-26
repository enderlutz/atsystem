"use client";

import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import Link from "next/link";
import { api, leadDetailCache, type Lead, type Estimate } from "@/lib/api";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, CheckCircle2, Circle, Flame, LayoutGrid, List, Send, Sparkles, Zap, Archive } from "lucide-react";
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
  new_lead: "New lead (waiting for automation response)",
  asking_address: "Asking for Address/ZIP (Automation)",
  new_build: "Address Correct but Not Measurable",
  hot_lead: "Hot lead (send proposal)",
  requote: "Re-quote Past Leads",
  proposal_sent: "Proposal sent(follow ups to open)",
  no_package_selection: "no package selection",
  package_selected: "package selection-no color chosen",
  no_date_selected: "no date selected",
  date_selected: "date selected, no deposit",
  deposit_paid: "Deposit paid (CLOSED)",
  declined_estimate: "Declined Estimate",
  planning_future: "Planning for future",
  job_complete: "job complete(review & referral)",
  cold_nurture: "Cold Lead Nurture",
};

function prefetchLead(id: string) {
  if (leadDetailCache.has(id)) return;
  api.getLead(id).then((data) => leadDetailCache.set(id, data)).catch(() => {});
}
const LEADS_CACHE_KEY = "at_leads_cache";
const ESTIMATES_CACHE_KEY = "at_estimates_cache";

type KanbanStatus =
  | "gray"
  | "no_address"
  | "needs_info"
  | "red"
  | "green"
  | "requote"
  | "sent"
  | "no_package"
  | "pkg_no_color"
  | "no_date"
  | "date_selected"
  | "deposit_paid"
  | "declined"
  | "planning"
  | "job_complete"
  | "cold_nurture";

// Tags that route a lead into "Address Correct but Not Measurable"
const NEEDS_INFO_TAGS = new Set(["Needs height", "Age of the Fence", "Needs Info", "needs_info"]);

// Workflow stages that map directly to kanban columns (highest priority routing)
const WORKFLOW_STAGE_TO_COLUMN: Record<string, KanbanStatus> = {
  past_customer: "requote",
  cold_nurture: "cold_nurture",
  job_complete: "job_complete",
  planning_future: "planning",
  declined_estimate: "declined",
  deposit_paid: "deposit_paid",
  date_selected: "date_selected",
  no_date_selected: "no_date",
  package_selected: "pkg_no_color",
  no_package_selection: "no_package",
  proposal_sent: "sent",
  requote: "requote",
  hot_lead: "green",
  new_build: "needs_info",
  asking_address: "no_address",
  new_lead: "gray",
};

// Queue sort order for kanban column (lower = higher priority VA action needed)
const COLUMN_QUEUE_ORDER: Record<KanbanStatus, number> = {
  green: 0,
  needs_info: 1,
  no_address: 2,
  gray: 3,
  red: 4,
  requote: 5,
  sent: 6,
  no_package: 7,
  pkg_no_color: 8,
  no_date: 9,
  date_selected: 10,
  deposit_paid: 11,
  declined: 12,
  planning: 13,
  job_complete: 14,
  cold_nurture: 15,
};

const PRIORITY_ORDER: Record<string, number> = { HOT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function getKanbanStatus(lead: Lead, estimateMap: Map<string, Estimate>): KanbanStatus {
  const est = estimateMap.get(lead.id);
  // 1. Explicit VA override (drag-and-drop)
  if (lead.kanban_column) return lead.kanban_column as KanbanStatus;
  // 2. Workflow stage drives column — covers the full post-proposal funnel automatically
  if (lead.workflow_stage && WORKFLOW_STAGE_TO_COLUMN[lead.workflow_stage]) {
    return WORKFLOW_STAGE_TO_COLUMN[lead.workflow_stage];
  }
  // 3. Booked proposal → Deposit Paid column
  if (est?.proposal_status === "booked") return "deposit_paid";
  // 4. Pre-workflow fallback: lead/estimate status
  if (lead.status === "sent" || lead.status === "approved" || est?.status === "approved") {
    return "sent";
  }
  if (!lead.address || lead.address.trim() === "") return "no_address";
  if (lead.tags?.some((t) => NEEDS_INFO_TAGS.has(t))) return "needs_info";
  if (!est) return "gray";
  const approval = est.inputs?._approval_status;
  if (approval === "green") return "green";
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
    label: "New lead (waiting for automation response)",
    description: "Lead just came in — automation hasn't completed yet",
    headerCls: "bg-gray-100 border-gray-200",
    bgCls: "bg-gray-50",
    dotCls: "bg-gray-400",
  },
  {
    key: "no_address",
    label: "Asking for Address/ZIP (Automation)",
    description: "Automation is asking the customer for their address",
    headerCls: "bg-purple-100 border-purple-200",
    bgCls: "bg-purple-50",
    dotCls: "bg-purple-400",
  },
  {
    key: "needs_info",
    label: "Address Correct but Not Measurable",
    description: "Has address but missing height, age, or can't measure via satellite",
    headerCls: "bg-orange-100 border-orange-200",
    bgCls: "bg-orange-50",
    dotCls: "bg-orange-400",
  },
  {
    key: "red",
    label: "Needs Review",
    description: "Outside zone, too small, 15+ yrs, or missing data — owner review required",
    headerCls: "bg-red-100 border-red-200",
    bgCls: "bg-red-50",
    dotCls: "bg-red-500",
  },
  {
    key: "green",
    label: "Hot lead (send proposal)",
    description: "All criteria met — ready to approve and send proposal",
    headerCls: "bg-green-100 border-green-200",
    bgCls: "bg-green-50",
    dotCls: "bg-green-500",
  },
  {
    key: "requote",
    label: "Re-quote Past Leads",
    description: "Previous customer — re-quote for new or repeat service",
    headerCls: "bg-teal-100 border-teal-200",
    bgCls: "bg-teal-50",
    dotCls: "bg-teal-500",
  },
  {
    key: "sent",
    label: "Proposal sent(follow ups to open)",
    description: "All 3 packages sent — automation following up to get customer to open",
    headerCls: "bg-emerald-100 border-emerald-200",
    bgCls: "bg-emerald-50",
    dotCls: "bg-emerald-500",
  },
  {
    key: "no_package",
    label: "no package selection",
    description: "Customer opened proposal but hasn't chosen a package yet",
    headerCls: "bg-sky-100 border-sky-200",
    bgCls: "bg-sky-50",
    dotCls: "bg-sky-500",
  },
  {
    key: "pkg_no_color",
    label: "package selection-no color chosen",
    description: "Package selected — waiting on customer to pick a stain color",
    headerCls: "bg-cyan-100 border-cyan-200",
    bgCls: "bg-cyan-50",
    dotCls: "bg-cyan-500",
  },
  {
    key: "no_date",
    label: "no date selected",
    description: "Color chosen — customer hasn't picked a service date yet",
    headerCls: "bg-yellow-100 border-yellow-200",
    bgCls: "bg-yellow-50",
    dotCls: "bg-yellow-500",
  },
  {
    key: "date_selected",
    label: "date selected, no deposit",
    description: "Date confirmed — waiting on deposit payment",
    headerCls: "bg-amber-100 border-amber-200",
    bgCls: "bg-amber-50",
    dotCls: "bg-amber-500",
  },
  {
    key: "deposit_paid",
    label: "Deposit paid (CLOSED)",
    description: "Deposit received — job is locked in",
    headerCls: "bg-indigo-100 border-indigo-200",
    bgCls: "bg-indigo-50",
    dotCls: "bg-indigo-500",
  },
  {
    key: "declined",
    label: "Declined Estimate",
    description: "Customer declined the estimate",
    headerCls: "bg-rose-100 border-rose-200",
    bgCls: "bg-rose-50",
    dotCls: "bg-rose-400",
  },
  {
    key: "planning",
    label: "Planning for future",
    description: "Customer interested but planning for a future date",
    headerCls: "bg-blue-100 border-blue-200",
    bgCls: "bg-blue-50",
    dotCls: "bg-blue-400",
  },
  {
    key: "job_complete",
    label: "job complete(review & referral)",
    description: "Job done — automation requesting review and referral",
    headerCls: "bg-violet-100 border-violet-200",
    bgCls: "bg-violet-50",
    dotCls: "bg-violet-500",
  },
  {
    key: "cold_nurture",
    label: "Cold Lead Nurture",
    description: "Lead went cold — long-term nurture sequence active",
    headerCls: "bg-slate-100 border-slate-200",
    bgCls: "bg-slate-50",
    dotCls: "bg-slate-400",
  },
];

const COLUMN_BADGE: Record<KanbanStatus, string> = {
  gray: "bg-gray-100 text-gray-600",
  no_address: "bg-purple-100 text-purple-700",
  needs_info: "bg-orange-100 text-orange-700",
  red: "bg-red-100 text-red-700",
  green: "bg-green-100 text-green-700",
  requote: "bg-teal-100 text-teal-700",
  sent: "bg-emerald-100 text-emerald-700",
  no_package: "bg-sky-100 text-sky-700",
  pkg_no_color: "bg-cyan-100 text-cyan-700",
  no_date: "bg-yellow-100 text-yellow-700",
  date_selected: "bg-amber-100 text-amber-700",
  deposit_paid: "bg-indigo-100 text-indigo-700",
  declined: "bg-rose-100 text-rose-700",
  planning: "bg-blue-100 text-blue-700",
  job_complete: "bg-violet-100 text-violet-700",
  cold_nurture: "bg-slate-100 text-slate-600",
};

const COLUMN_LABEL: Record<KanbanStatus, string> = {
  gray: "New Lead",
  no_address: "Asking for Address",
  needs_info: "Not Measurable",
  red: "Needs Review",
  green: "Hot Lead",
  requote: "Re-quote",
  sent: "Proposal Sent",
  no_package: "No Package",
  pkg_no_color: "No Color Chosen",
  no_date: "No Date",
  date_selected: "Date Selected",
  deposit_paid: "Deposit Paid",
  declined: "Declined",
  planning: "Planning",
  job_complete: "Job Complete",
  cold_nurture: "Cold Nurture",
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
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const prevLeadIdsRef = useRef<Set<string>>(new Set());
  const prevRespondedRef = useRef<Set<string>>(new Set());
  const notifiedMsgIdsRef = useRef<Set<string>>(new Set());
  const [hoveredLeadId, setHoveredLeadId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverData, setHoverData] = useState<{ log: import("@/lib/api").AutomationLogEvent[]; queue: import("@/lib/api").QueuedMessage[] } | null>(null);
  const [hoverDataLoading, setHoverDataLoading] = useState(false);
  const hoverCardRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // Detect new leads and new customer replies before updating state
    const prevIds = prevLeadIdsRef.current;
    const prevResponded = prevRespondedRef.current;

    if (prevIds.size > 0) {
      // New leads toast
      for (const lead of leadsData) {
        if (!prevIds.has(lead.id)) {
          toast("New lead: " + (lead.contact_name || "Unknown"), {
            description: lead.address || lead.contact_phone || "",
          });
        }
      }
      // Customer replied toast
      for (const lead of leadsData) {
        if (lead.customer_responded && !prevResponded.has(lead.id)) {
          toast("New message from " + (lead.contact_name || "Unknown"), {
            description: "Customer replied — check their conversation",
          });
        }
      }
    }

    // Update refs for next poll
    prevLeadIdsRef.current = new Set(leadsData.map((l) => l.id));
    prevRespondedRef.current = new Set(leadsData.filter((l) => l.customer_responded).map((l) => l.id));

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

    // Check for upcoming SMS messages (due in next 5 min) and show toast
    const checkUpcomingSms = () => {
      api.getMessageQueue("status=pending&limit=20").then((messages) => {
        const now = Date.now();
        const fiveMin = 5 * 60 * 1000;
        for (const msg of messages) {
          const sendAt = new Date(msg.send_at).getTime();
          const diff = sendAt - now;
          if (diff > 0 && diff <= fiveMin && !notifiedMsgIdsRef.current.has(msg.id)) {
            notifiedMsgIdsRef.current.add(msg.id);
            const mins = Math.max(1, Math.round(diff / 60000));
            toast(`SMS sending in ${mins}min → ${msg.contact_name || "Unknown"}`, {
              description: msg.message_body.slice(0, 80) + (msg.message_body.length > 80 ? "..." : ""),
            });
          }
        }
      }).catch(() => {});
    };

    // Auto-refresh every 60 seconds — picks up new leads synced from GHL by the backend poller
    const interval = setInterval(() => {
      loadData();
      checkUpcomingSms();
      api.getSyncStatus().then((s) => setLastSyncAt(s.last_sync_at)).catch(() => {});
    }, 60 * 1000);

    // Initial check for upcoming SMS
    checkUpcomingSms();

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

  const handleArchive = async (leadId: string) => {
    setArchivingId(leadId);
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    try {
      await api.archiveLead(leadId);
      toast.success("Lead archived");
    } catch (e) {
      console.error(e);
      toast.error("Failed to archive lead");
      await loadData(); // restore on error
    } finally {
      setArchivingId(null);
      setConfirmArchiveId(null);
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
    // Block dragging into automated columns — these are driven by workflow stage
    // All columns accept manual drag-and-drop — workflow engine will auto-correct
    // if real activity (e.g. customer picks package) moves the lead later.
    // Optimistic update
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, kanban_column: newCol } : l));
    try {
      await api.updateLeadColumn(leadId, newCol);
      toast.success(`Moved to ${COLUMNS.find((c) => c.key === newCol)?.label ?? newCol}`);
    } catch (e) {
      console.error(e);
      setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, kanban_column: lead.kanban_column ?? null } : l));
      toast.error("Failed to move lead");
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
                        const hasAddons = Boolean(((leadFormData.additional_services as string) || "").trim());
                        const addonsPending = hasAddons && !est?.additional_services_sent;

                        return (
                          <DraggableKanbanCard key={lead.id} leadId={lead.id}>
                          <div
                            className={`bg-white rounded-md border shadow-sm p-3 space-y-2 hover:shadow-md transition-shadow ${
                              isOwnerLead ? "opacity-80" : ""
                            } ${newLeadIds.has(lead.id) ? "ring-2 ring-blue-300 ring-offset-1" : ""} ${addonsPending ? "ring-2 ring-yellow-400 ring-offset-1" : ""}`}
                            onMouseEnter={(e) => {
                              if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHoveredLeadId(lead.id);
                              setHoverPos({ x: rect.right + 8, y: rect.top });
                              // Fetch activity log + scheduled messages
                              setHoverData(null);
                              setHoverDataLoading(true);
                              Promise.allSettled([
                                api.getAutomationLog({ lead_id: lead.id, limit: 5 }),
                                api.getMessageQueue(`lead_id=${lead.id}&status=pending`),
                              ]).then(([logRes, queueRes]) => {
                                setHoverData({
                                  log: logRes.status === "fulfilled" ? logRes.value.events : [],
                                  queue: queueRes.status === "fulfilled" ? queueRes.value : [],
                                });
                                setHoverDataLoading(false);
                              });
                            }}
                            onMouseLeave={() => {
                              hoverTimeoutRef.current = setTimeout(() => {
                                setHoveredLeadId(null);
                                setHoverPos(null);
                                setHoverData(null);
                              }, 200);
                            }}
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

                            {/* Add-ons badge */}
                            {addonsPending && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 border border-yellow-300 font-medium">
                                ★ Add-ons estimate needed
                              </span>
                            )}
                            {hasAddons && est?.additional_services_sent && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                                ✓ Additional Estimate{est.addon_price != null ? `: $${Number(est.addon_price).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""}
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
                            {(col.key === "sent" || col.key === "deposit_paid") && (() => {
                              const stage = est?.proposal_funnel_stage;
                              if (!stage) return null;
                              const STAGE_LABELS: Record<string, string> = {
                                sent: "Not opened yet",
                                opened: "Viewed",
                                hoa_selected: "HOA step",
                                package_selected: "Package picked",
                                color_selected: "Color picked",
                                date_selected: "Date picked",
                                checkout_started: "At checkout",
                                booked: "Deposit Paid",
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

                            {/* Footer: responded + date + view + archive */}
                            {confirmArchiveId === lead.id ? (
                              <div className="flex items-center justify-between gap-2 pt-0.5">
                                <span className="text-xs text-muted-foreground">Archive this lead?</span>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-6 text-xs px-2"
                                    disabled={archivingId === lead.id}
                                    onClick={(e) => { e.stopPropagation(); handleArchive(lead.id); }}
                                  >
                                    {archivingId === lead.id ? "…" : "Archive"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs px-2"
                                    onClick={(e) => { e.stopPropagation(); setConfirmArchiveId(null); }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
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
                                <div className="flex items-center gap-1">
                                  <button
                                    title="Archive lead"
                                    className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    onClick={(e) => { e.stopPropagation(); setConfirmArchiveId(lead.id); }}
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                  </button>
                                  <Button size="sm" variant="outline" className="h-6 text-xs px-2" asChild onMouseEnter={() => prefetchLead(lead.id)}>
                                    <Link href={`/leads/${lead.id}`}>View</Link>
                                  </Button>
                                </div>
                              </div>
                            )}
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
              const canApprove = kanbanStatus === "green"
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
                    {confirmArchiveId === lead.id ? (
                      <>
                        <span className="text-xs text-muted-foreground">Archive?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs px-2"
                          disabled={archivingId === lead.id}
                          onClick={() => handleArchive(lead.id)}
                        >
                          {archivingId === lead.id ? "…" : "Yes"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2"
                          onClick={() => setConfirmArchiveId(null)}
                        >
                          No
                        </Button>
                      </>
                    ) : (
                      <>
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
                        ) : kanbanStatus === "green" && !lead.customer_responded ? (
                          <span className="text-xs text-muted-foreground shrink-0">Awaiting reply</span>
                        ) : null}
                        <button
                          title="Archive lead"
                          className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          onClick={() => setConfirmArchiveId(lead.id)}
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2.5" asChild onMouseEnter={() => prefetchLead(lead.id)}>
                          <Link href={`/leads/${lead.id}`}>View</Link>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Hover card — fixed position, shows lead details on kanban card hover */}
      {hoveredLeadId && hoverPos && (() => {
        const hLead = leads.find((l) => l.id === hoveredLeadId);
        if (!hLead) return null;
        const hEst = estimateMap.get(hLead.id);
        const tiers = hEst?.inputs?._tiers as Record<string, number> | undefined;
        const fd = (hLead.form_data || {}) as Record<string, unknown>;
        const posLeft = hoverPos.x + 280 > window.innerWidth ? hoverPos.x - 296 : hoverPos.x;
        const posTop = Math.min(hoverPos.y, window.innerHeight - 400);

        const formatTime = (iso: string) => {
          try {
            return new Date(iso).toLocaleString("en-US", {
              timeZone: "America/Chicago", month: "short", day: "numeric",
              hour: "numeric", minute: "2-digit", hour12: true,
            });
          } catch { return iso; }
        };

        const formatRelative = (iso: string) => {
          const diff = new Date(iso).getTime() - Date.now();
          const mins = Math.round(diff / 60000);
          if (mins < 0) return "overdue";
          if (mins < 60) return `in ${mins}m`;
          const hrs = Math.round(mins / 60);
          if (hrs < 24) return `in ${hrs}h`;
          return `in ${Math.round(hrs / 24)}d`;
        };

        const EVENT_BADGE: Record<string, string> = {
          stage_transition: "bg-blue-100 text-blue-700",
          sms_sent: "bg-green-100 text-green-700",
          sms_failed: "bg-red-100 text-red-700",
          sms_queued: "bg-gray-100 text-gray-600",
          customer_reply: "bg-yellow-100 text-yellow-700",
          proposal_opened: "bg-purple-100 text-purple-700",
          package_selected: "bg-cyan-100 text-cyan-700",
          deposit_paid: "bg-emerald-100 text-emerald-700",
          estimate_approved: "bg-green-100 text-green-700",
        };

        const handleCancelMsg = async (msgId: string) => {
          try {
            await api.cancelQueuedMessage(msgId);
            setHoverData((prev) => prev ? { ...prev, queue: prev.queue.filter((m) => m.id !== msgId) } : prev);
          } catch (e) {
            console.error("Failed to cancel message:", e);
          }
        };

        return (
          <div
            ref={hoverCardRef}
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3.5 text-sm overflow-y-auto"
            style={{ left: posLeft, top: posTop, width: 320, maxHeight: 480 }}
            onMouseEnter={() => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); }}
            onMouseLeave={() => { setHoveredLeadId(null); setHoverPos(null); setHoverData(null); }}
          >
            <div className="font-semibold text-base leading-tight mb-1">{hLead.contact_name || "—"}</div>
            {hLead.contact_phone && (
              <div className="text-xs text-muted-foreground">{hLead.contact_phone}</div>
            )}
            {hLead.contact_email && (
              <div className="text-xs text-muted-foreground truncate">{hLead.contact_email}</div>
            )}
            {hLead.address && (
              <div className="text-xs text-muted-foreground mt-1 truncate">{hLead.address}</div>
            )}
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-600 font-medium capitalize">
                {hLead.service_type?.replace("_", " ") || "—"}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${priorityColors[hLead.priority] || priorityColors.MEDIUM}`}>
                {hLead.priority}
              </span>
            </div>
            {!!fd.additional_services && (
              <div className="mt-1.5 text-xs text-amber-700">
                Add-ons: {String(fd.additional_services)}
              </div>
            )}
            {tiers?.signature ? (
              <div className="mt-2 pt-2 border-t grid grid-cols-3 gap-1 text-xs">
                <div className="text-center">
                  <div className="text-muted-foreground">Essential</div>
                  <div className="font-medium text-emerald-700">${Number(tiers.essential || 0).toFixed(0)}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">Signature</div>
                  <div className="font-semibold text-emerald-700">${Number(tiers.signature).toFixed(0)}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">Legacy</div>
                  <div className="font-medium text-emerald-700">${Number(tiers.legacy || 0).toFixed(0)}</div>
                </div>
              </div>
            ) : (
              <div className="mt-1.5 text-xs text-muted-foreground">No estimate yet</div>
            )}
            {hLead.tags?.length > 0 && (
              <div className="mt-2 pt-2 border-t flex flex-wrap gap-1">
                {hLead.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">{tag}</span>
                ))}
              </div>
            )}

            {/* Scheduled Messages */}
            {hoverData && hoverData.queue.length > 0 && (
              <div className="mt-2 pt-2 border-t">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Scheduled Messages</div>
                <div className="space-y-1">
                  {hoverData.queue.slice(0, 4).map((m) => (
                    <div key={m.id} className="flex items-start gap-1.5 group">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] text-muted-foreground">{formatRelative(m.send_at)}</div>
                        <p className="text-xs text-muted-foreground line-clamp-1">{m.message_body}</p>
                      </div>
                      <button
                        onClick={() => handleCancelMsg(m.id)}
                        className="shrink-0 px-1 py-0.5 rounded text-[10px] text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Cancel this message"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                  {hoverData.queue.length > 4 && (
                    <div className="text-[10px] text-muted-foreground">+{hoverData.queue.length - 4} more</div>
                  )}
                </div>
              </div>
            )}

            {/* Activity Log */}
            {hoverData && hoverData.log.length > 0 && (
              <div className="mt-2 pt-2 border-t">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Recent Activity</div>
                <div className="space-y-1">
                  {hoverData.log.map((evt) => (
                    <div key={evt.id} className="flex items-start gap-1.5">
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap w-16 shrink-0">
                        {formatTime(evt.created_at)}
                      </span>
                      <span className={`shrink-0 px-1 py-0.5 rounded text-[9px] font-medium ${EVENT_BADGE[evt.event_type] || "bg-gray-100 text-gray-600"}`}>
                        {evt.event_type.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate">{evt.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hoverDataLoading && (
              <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground">Loading activity...</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
