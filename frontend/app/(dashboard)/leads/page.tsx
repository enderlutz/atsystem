"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api, type Lead, type Estimate } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, CheckCircle2, Circle, RefreshCw } from "lucide-react";

type KanbanStatus = "gray" | "no_address" | "needs_info" | "green" | "yellow" | "red" | "follow_up";

// Tags that route a lead into "Needs More Information"
const NEEDS_INFO_TAGS = new Set(["Needs height", "Age of the Fence", "Needs Info", "needs_info"]);
// Tags that route a lead into "Follow Up Quote"
const FOLLOW_UP_TAGS = new Set(["Follow Up Quote", "follow_up_quote", "Follow Up"]);

function getKanbanStatus(lead: Lead, estimateMap: Map<string, Estimate>): KanbanStatus {
  if (!lead.address || lead.address.trim() === "") return "no_address";
  if (lead.tags?.some((t) => NEEDS_INFO_TAGS.has(t))) return "needs_info";
  if (lead.tags?.some((t) => FOLLOW_UP_TAGS.has(t))) return "follow_up";
  const est = estimateMap.get(lead.id);
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
];

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

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [estimateMap, setEstimateMap] = useState<Map<string, Estimate>>(new Map());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    const [leadsData, estimatesData] = await Promise.all([
      api.getLeads("limit=200"),
      api.getEstimates("limit=200"),
    ]);
    setLeads(leadsData);
    const map = new Map<string, Estimate>();
    for (const est of estimatesData) {
      if (!map.has(est.lead_id)) map.set(est.lead_id, est);
    }
    setEstimateMap(map);
  }, []);

  useEffect(() => {
    Promise.all([loadData(), api.getSyncStatus()])
      .then(([, syncStatus]) => setLastSyncAt(syncStatus.last_sync_at))
      .catch(console.error)
      .finally(() => setLoading(false));

    // Auto-refresh every 5 minutes
    const interval = setInterval(() => {
      loadData().catch(console.error);
      api.getSyncStatus().then((s) => setLastSyncAt(s.last_sync_at)).catch(console.error);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await api.syncPipeline();
      await loadData();
      const s = await api.getSyncStatus();
      setLastSyncAt(s.last_sync_at);
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const filtered = leads.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (l.contact_name || "").toLowerCase().includes(q) ||
      l.address.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3" style={{ minWidth: "max-content" }}>
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="h-64 w-64 rounded-lg bg-muted animate-pulse flex-shrink-0" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground">
            {leads.length} total — sorted by estimate review status
            {lastSyncAt && (
              <span className="ml-2 text-xs">
                · Last synced {formatDate(lastSyncAt)}
              </span>
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSyncNow}
          disabled={syncing}
          className="shrink-0 mt-1"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync Now"}
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or address..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Kanban board — horizontally scrollable */}
      <div className="overflow-x-auto pb-3">
        <div className="flex gap-3" style={{ minWidth: "max-content" }}>
          {COLUMNS.map((col) => {
            const colLeads = filtered
              .filter((l) => getKanbanStatus(l, estimateMap) === col.key)
              .sort((a, b) => {
                const order: Record<string, number> = { HOT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
                return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
              });

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
                    <span className="ml-auto text-xs font-medium bg-white/70 rounded-full px-2 py-0.5">
                      {colLeads.length}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 pl-4">{col.description}</p>
                </div>

                {/* Cards */}
                <div className={`flex-1 p-2 space-y-2 ${col.bgCls} rounded-b-lg overflow-y-auto`}>
                  {colLeads.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-10">No leads</p>
                  ) : (
                    colLeads.map((lead) => {
                      const est = estimateMap.get(lead.id);
                      const reason = est?.inputs?._approval_reason as string | undefined;

                      return (
                        <div
                          key={lead.id}
                          className="bg-white rounded-md border shadow-sm p-3 space-y-2 hover:shadow-md transition-shadow"
                        >
                          {/* Name + priority */}
                          <div className="flex items-start justify-between gap-1">
                            <span className="font-medium text-sm leading-tight">
                              {lead.contact_name || "—"}
                            </span>
                            <span
                              className={`shrink-0 inline-flex px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                priorityColors[lead.priority] || priorityColors.MEDIUM
                              }`}
                            >
                              {lead.priority}
                            </span>
                          </div>

                          {/* Address */}
                          {lead.address && (
                            <p className="text-xs text-muted-foreground truncate">{lead.address}</p>
                          )}

                          {/* Estimate range */}
                          {est && est.estimate_low > 0 && (
                            <p className="text-xs font-semibold text-emerald-700">
                              ${est.estimate_low.toFixed(0)}–${est.estimate_high.toFixed(0)}
                            </p>
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
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs px-2"
                              asChild
                            >
                              <Link href={`/leads/${lead.id}`}>View</Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
