"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type WorkflowStats, type QueuedMessage, type WorkflowConfigItem, type GhlPipeline } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Zap, MessageSquare, Clock, Pause, Send, X, Save, Settings2, Link2, Check, Loader2,
  GitBranch,
} from "lucide-react";

// ─── Workflow Diagram ──────────────────────────────────────────────────────────

type NodeType = "trigger" | "condition" | "action" | "wait" | "end" | "manual";

interface ChainNode {
  type: NodeType;
  label: string;
  detail?: string;
}

interface WFBranch {
  label: string;
  nodes: ChainNode[];
}

interface WorkflowDef {
  id: string;
  title: string;
  dot: string;
  chain: ChainNode[];
  branches?: WFBranch[];
  note?: string;
}

const NODE_STYLES: Record<NodeType, string> = {
  trigger: "bg-blue-100 border border-blue-400 text-blue-800",
  condition: "bg-amber-100 border border-amber-400 text-amber-800",
  action: "bg-green-100 border border-green-500 text-green-800",
  wait: "bg-gray-100 border border-gray-300 text-gray-600",
  end: "bg-purple-100 border border-purple-400 text-purple-800",
  manual: "bg-orange-100 border border-orange-400 text-orange-800",
};

function NodeChip({ node }: { node: ChainNode }) {
  return (
    <span
      className={`inline-flex flex-col items-center rounded-md px-2 py-1 text-xs font-medium leading-tight ${NODE_STYLES[node.type]}`}
      title={node.detail}
    >
      {node.label}
      {node.detail && (
        <span className="text-[10px] font-normal opacity-70 mt-0.5">{node.detail}</span>
      )}
    </span>
  );
}

const WORKFLOW_DEFINITIONS: WorkflowDef[] = [
  {
    id: "wf1",
    title: "WF1 — New Lead",
    dot: "bg-blue-500",
    chain: [
      { type: "trigger", label: "New lead arrives" },
      { type: "action", label: "Send intro SMS ×3", detail: "Now → 1hr → 24hr" },
      { type: "condition", label: "Customer replies?" },
    ],
    branches: [
      { label: "YES + has address", nodes: [{ type: "end", label: "→ Hot Lead" }] },
      { label: "YES + no address", nodes: [{ type: "end", label: "→ Ask Address" }] },
    ],
    note: "VA override: can approve estimate directly (force send) without waiting for a reply.",
  },
  {
    id: "wf2a",
    title: "WF2a — Ask for Address",
    dot: "bg-orange-400",
    chain: [
      { type: "manual", label: "VA clicks 'Ask for Address'" },
      { type: "action", label: "Send address request ×2", detail: "Now → 24hr" },
      { type: "wait", label: "VA reviews reply" },
      { type: "end", label: "→ Hot Lead (manual)" },
    ],
  },
  {
    id: "wf2b",
    title: "WF2b — New Build (Can't Measure)",
    dot: "bg-orange-400",
    chain: [
      { type: "manual", label: "VA clicks 'New Build'" },
      { type: "action", label: "Send photos/in-person SMS ×2", detail: "Now → 24hr" },
      { type: "wait", label: "Customer chooses option" },
      { type: "end", label: "→ VA handles" },
    ],
  },
  {
    id: "wf3",
    title: "WF3 — Proposal Sent (No Open)",
    dot: "bg-teal-500",
    chain: [
      { type: "trigger", label: "Estimate approved & sent" },
      { type: "action", label: "Proposal link SMS", detail: "Immediate" },
      { type: "wait", label: "Customer opens?" },
    ],
    branches: [
      {
        label: "NO — follow-ups",
        nodes: [
          { type: "action", label: "4hr follow-up" },
          { type: "action", label: "Day 2" },
          { type: "action", label: "Day 4" },
          { type: "action", label: "Day 5" },
          { type: "action", label: "Day 6" },
        ],
      },
      { label: "YES — opened", nodes: [{ type: "end", label: "→ WF5" }] },
    ],
  },
  {
    id: "wf5",
    title: "WF5 — No Package Selection",
    dot: "bg-yellow-500",
    chain: [
      { type: "trigger", label: "Proposal opened" },
      { type: "wait", label: "15 min" },
      { type: "condition", label: "Package chosen?" },
    ],
    branches: [
      {
        label: "NO",
        nodes: [
          { type: "action", label: "\"Signature is popular\" SMS", detail: "Immediate" },
          { type: "action", label: "Day 1" },
          { type: "action", label: "Day 3 (review)" },
          { type: "action", label: "Day 5" },
          { type: "action", label: "Day 6" },
          { type: "end", label: "7d → Cold Nurture" },
        ],
      },
      { label: "YES", nodes: [{ type: "end", label: "→ WF6" }] },
    ],
  },
  {
    id: "wf6",
    title: "WF6 — Package Selected, No Color",
    dot: "bg-cyan-400",
    chain: [
      { type: "trigger", label: "Package selected" },
      { type: "action", label: "Tier color chart SMS", detail: "Immediate + 2hr + Day 2" },
      { type: "condition", label: "Customer texts color?" },
    ],
    branches: [
      {
        label: "YES — auto-detected",
        nodes: [
          { type: "action", label: "Color saved to proposal" },
          { type: "end", label: "→ No Date" },
        ],
      },
      {
        label: "NO — VA sends date link",
        nodes: [
          { type: "manual", label: "VA: 'Send Date Link'" },
          { type: "action", label: "SMS with ?step=date URL" },
          { type: "end", label: "→ No Date" },
        ],
      },
    ],
  },
  {
    id: "wf7",
    title: "WF7 — No Date Selected",
    dot: "bg-indigo-500",
    chain: [
      { type: "trigger", label: "Color chosen, no date" },
      { type: "action", label: "\"Openings available\" SMS", detail: "Immediate" },
      { type: "action", label: "4hr nudge" },
      { type: "action", label: "Day 2 (urgency)" },
      { type: "action", label: "Day 4 (personal)" },
    ],
  },
  {
    id: "wf8",
    title: "WF8 — Date Selected, No Deposit",
    dot: "bg-blue-800",
    chain: [
      { type: "trigger", label: "Date selected" },
      { type: "condition", label: "Still on page?" },
    ],
    branches: [
      {
        label: "NO (left)",
        nodes: [
          { type: "action", label: "Deposit reminder", detail: "1 min" },
          { type: "action", label: "2hr reminder" },
          { type: "action", label: "Day 1" },
          { type: "action", label: "Day 2" },
        ],
      },
      {
        label: "YES (active)",
        nodes: [
          { type: "wait", label: "15 min" },
          { type: "action", label: "Deposit reminder" },
        ],
      },
    ],
  },
  {
    id: "wf9",
    title: "WF9 — Deposit Paid",
    dot: "bg-green-600",
    chain: [
      { type: "trigger", label: "Deposit paid" },
      { type: "action", label: "Confirmation SMS", detail: "Immediate" },
      { type: "action", label: "Day-before reminder", detail: "6 PM eve" },
      { type: "action", label: "Job-day SMS", detail: "7 AM" },
      { type: "manual", label: "VA marks complete" },
      { type: "action", label: "Review request + referral", detail: "Now + Day 3" },
      { type: "end", label: "14d → Past Customer" },
    ],
  },
];

function WorkflowDiagram() {
  const legend: { type: NodeType; label: string }[] = [
    { type: "trigger", label: "Trigger / event" },
    { type: "action", label: "Send SMS / action" },
    { type: "condition", label: "Condition / branch" },
    { type: "wait", label: "Wait / timer" },
    { type: "manual", label: "VA manual action" },
    { type: "end", label: "Stage transition" },
  ];

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-2 pb-2 border-b">
        {legend.map(({ type, label }) => (
          <span key={type} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${NODE_STYLES[type]}`}>
            {label}
          </span>
        ))}
      </div>

      {WORKFLOW_DEFINITIONS.map((wf) => (
        <Card key={wf.id} className="overflow-hidden">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${wf.dot}`} />
              {wf.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {/* Main chain */}
            <div className="flex flex-wrap items-start gap-1">
              {wf.chain.map((node, i) => (
                <div key={i} className="flex items-start gap-1">
                  <NodeChip node={node} />
                  {i < wf.chain.length - 1 && (
                    <span className="text-muted-foreground text-xs pt-1.5">→</span>
                  )}
                </div>
              ))}
            </div>

            {/* Branches */}
            {wf.branches && (
              <div className="space-y-1.5 ml-2 pl-3 border-l-2 border-muted">
                {wf.branches.map((branch, bi) => (
                  <div key={bi} className="flex flex-wrap items-start gap-1">
                    <span className="text-xs font-medium text-muted-foreground pt-1 flex-shrink-0">
                      {branch.label}:
                    </span>
                    {branch.nodes.map((node, ni) => (
                      <div key={ni} className="flex items-start gap-1">
                        <NodeChip node={node} />
                        {ni < branch.nodes.length - 1 && (
                          <span className="text-muted-foreground text-xs pt-1.5">→</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {wf.note && (
              <p className="text-xs text-muted-foreground italic border-t pt-2">{wf.note}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-blue-500",
  new_build: "bg-orange-300",
  asking_address: "bg-orange-400",
  hot_lead: "bg-red-500",
  proposal_sent: "bg-teal-500",
  no_package_selection: "bg-yellow-500",
  package_selected: "bg-cyan-400",
  no_date_selected: "bg-indigo-500",
  date_selected: "bg-blue-800",
  deposit_paid: "bg-green-600",
  additional_service: "bg-purple-500",
  job_complete: "bg-pink-500",
  cold_nurture: "bg-slate-500",
  past_customer: "bg-emerald-600",
};

export default function AutomationsPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "workflow">("overview");
  const [stats, setStats] = useState<WorkflowStats | null>(null);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [config, setConfig] = useState<WorkflowConfigItem[]>([]);
  const [editingConfig, setEditingConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [ghlPipelines, setGhlPipelines] = useState<GhlPipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>("");
  const [stageMapping, setStageMapping] = useState<Record<string, string>>({});
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [savingMap, setSavingMap] = useState(false);
  const [mapSaved, setMapSaved] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [s, q, c] = await Promise.allSettled([
        api.getWorkflowStats(),
        api.getMessageQueue(),
        api.getWorkflowConfig(),
      ]);
      if (s.status === "fulfilled") setStats(s.value);
      if (q.status === "fulfilled") setQueue(q.value);
      if (c.status === "fulfilled") setConfig(c.value);
    } catch (e) {
      console.error("Failed to load workflow data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCancel = async (id: string) => {
    try {
      await api.cancelQueuedMessage(id);
      setQueue((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      console.error("Failed to cancel message:", e);
    }
  };

  const handleSendNow = async (id: string) => {
    try {
      await api.sendQueuedMessageNow(id);
      setQueue((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  };

  const handleSaveConfig = async (key: string) => {
    const value = editingConfig[key];
    if (value === undefined) return;
    setSaving(key);
    try {
      await api.updateWorkflowConfig(key, value);
      setConfig((prev) => {
        const exists = prev.some((c) => c.key === key);
        if (exists) {
          return prev.map((c) => (c.key === key ? { ...c, value } : c));
        }
        return [...prev, { key, value, updated_at: new Date().toISOString() }];
      });
      setEditingConfig((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e) {
      console.error("Failed to save config:", e);
    } finally {
      setSaving(null);
    }
  };

  const formatRelativeTime = (iso: string) => {
    const diff = new Date(iso).getTime() - Date.now();
    const mins = Math.round(diff / 60000);
    if (mins < 0) return "overdue";
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    const days = Math.round(hrs / 24);
    return `in ${days}d`;
  };

  const handleLoadPipelines = useCallback(async () => {
    setLoadingPipelines(true);
    try {
      const pipelines = await api.getGhlPipelines();
      setGhlPipelines(pipelines);
      if (pipelines.length > 0) setSelectedPipeline(pipelines[0].id);
      // Pre-fill mapping from existing config
      const existing: Record<string, string> = {};
      for (const c of config) {
        if (c.key.startsWith("ghl_stage_")) {
          const workflowStage = c.key.replace("ghl_stage_", "");
          existing[workflowStage] = c.value;
        }
      }
      setStageMapping(existing);
    } catch (e) {
      console.error("Failed to load GHL pipelines:", e);
    } finally {
      setLoadingPipelines(false);
    }
  }, [config]);

  // Auto-load GHL pipelines if saved mappings exist
  const [autoLoaded, setAutoLoaded] = useState(false);
  useEffect(() => {
    if (autoLoaded || ghlPipelines.length > 0) return;
    const hasMappings = config.some((c) => c.key.startsWith("ghl_stage_") && c.value);
    if (hasMappings) {
      setAutoLoaded(true);
      handleLoadPipelines();
    }
  }, [config, autoLoaded, ghlPipelines.length, handleLoadPipelines]);

  const handleSaveStageMap = async () => {
    setSavingMap(true);
    try {
      // Save each mapping individually using the config endpoint (which we know works)
      for (const [workflowStage, ghlStageId] of Object.entries(stageMapping)) {
        if (ghlStageId) {
          await api.updateWorkflowConfig(`ghl_stage_${workflowStage}`, ghlStageId);
        }
      }
      setMapSaved(true);
      setTimeout(() => setMapSaved(false), 3000);
      await fetchData(); // Refresh config
    } catch (e) {
      console.error("Failed to save stage mapping:", e);
    } finally {
      setSavingMap(false);
    }
  };

  const WORKFLOW_STAGES = [
    { value: "new_lead", label: "New Lead" },
    { value: "new_build", label: "New Build – Asking for Photos" },
    { value: "asking_address", label: "Asking for Address" },
    { value: "hot_lead", label: "Hot Lead" },
    { value: "proposal_sent", label: "Proposal Sent" },
    { value: "no_package_selection", label: "No Package Selection" },
    { value: "package_selected", label: "Package Selected" },
    { value: "no_date_selected", label: "No Date Selected" },
    { value: "date_selected", label: "Date Selected" },
    { value: "deposit_paid", label: "Deposit Paid" },
    { value: "additional_service", label: "Additional Service" },
    { value: "job_complete", label: "Job Complete" },
    { value: "cold_nurture", label: "Cold Lead Nurture" },
    { value: "past_customer", label: "Past Customer" },
  ];

  const selectedPipelineData = ghlPipelines.find((p) => p.id === selectedPipeline);

  const configLabels: Record<string, string> = {
    google_review_link: "Google Review Link",
    cold_lead_incentive: "Cold Lead Incentive (Month 3)",
    referral_bonus: "Referral Bonus Text",
    entry_color_name: "Entry Package Color Name",
    entry_color_link: "Entry Color Image URL",
    signature_color_chart: "Signature Color Chart URL",
    legacy_color_chart: "Legacy Color Chart URL",
    popular_color_1: "Popular Color #1",
    popular_color_2: "Popular Color #2",
  };

  const configHints: Record<string, string> = {
    google_review_link: "Your Google Business review URL. Used in Job Complete and Cold Nurture messages to ask customers for reviews.",
    cold_lead_incentive: "Promo text sent to cold leads at month 3. Goes into the message as: \"We've got a little something special going on this month, [your text here].\" Example: $100 off any fence staining booked this month",
    referral_bonus: "What referrers and referred customers get. Goes into: \"Anyone who books through you gets [your text here]!\" Example: $50 off their service and you get $50 off your next one",
    entry_color_name: "The single stain color name available in the Entry package. Example: Dark Walnut",
    entry_color_link: "Image URL showing the Entry color on a real fence. Sent to customers who pick the Entry package.",
    signature_color_chart: "Image URL showing all 6 Signature color options. Sent to customers who pick the Signature package.",
    legacy_color_chart: "Image URL showing all 6 Legacy/premium color options. Sent to customers who pick the Legacy package.",
    popular_color_1: "Name of the most popular stain color. Used in Package Selected messages. Example: Dark Walnut",
    popular_color_2: "Name of the second most popular stain color. Example: Cedar",
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="h-6 w-6" />
          Automations
        </h1>
        <Button variant="outline" size="sm" onClick={fetchData}>
          Refresh
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "workflow"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("workflow")}
        >
          <GitBranch className="h-3.5 w-3.5" />
          Workflow Diagram
        </button>
      </div>

      {activeTab === "workflow" && <WorkflowDiagram />}

      {activeTab === "overview" && (<>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Drips</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {Object.values(stats.stage_counts).reduce((a, b) => a + b, 0)}
              </div>
              <p className="text-xs text-muted-foreground">Leads in workflow</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Messages</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.pending_messages}</div>
              <p className="text-xs text-muted-foreground">Scheduled to send</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sent Today</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.sent_today}</div>
              <p className="text-xs text-muted-foreground">Messages sent</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Paused</CardTitle>
              <Pause className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.paused_leads}</div>
              <p className="text-xs text-muted-foreground">Leads paused</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pipeline overview */}
      {stats && Object.keys(stats.stage_counts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pipeline Stages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Object.entries(stats.stage_labels).map(([stage, label]) => {
                const count = stats.stage_counts[stage] || 0;
                return (
                  <div
                    key={stage}
                    className="flex items-center gap-2 p-2 rounded-lg border"
                  >
                    <div
                      className={`w-3 h-3 rounded-full ${STAGE_COLORS[stage] || "bg-gray-400"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground truncate">
                        {label}
                      </div>
                      <div className="text-lg font-bold">{count}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Message queue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Scheduled Messages ({queue.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending messages</p>
          ) : (
            <div className="space-y-3">
              {queue.map((msg) => (
                <div
                  key={msg.id}
                  className="flex items-start gap-3 p-3 border rounded-lg"
                >
                  <div
                    className={`w-2 h-2 rounded-full mt-2 ${STAGE_COLORS[msg.stage] || "bg-gray-400"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">
                        {msg.contact_name || "Unknown"}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {stats?.stage_labels[msg.stage] || msg.stage}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(msg.send_at)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {msg.message_body}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSendNow(msg.id)}
                      title="Send now"
                    >
                      <Send className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancel(msg.id)}
                      title="Cancel"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* GHL Pipeline Stage Mapping */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            GHL Pipeline Stage Mapping
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ghlPipelines.length === 0 ? (
            <div className="space-y-3">
              {(() => {
                const savedMappings = config.filter((c) => c.key.startsWith("ghl_stage_") && c.value);
                if (savedMappings.length > 0) {
                  return (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {savedMappings.length} stage{savedMappings.length === 1 ? "" : "s"} mapped to GHL.
                      </p>
                      <div className="space-y-1">
                        {savedMappings.map((m) => {
                          const stageName = m.key.replace("ghl_stage_", "");
                          const wfStage = WORKFLOW_STAGES.find((s) => s.value === stageName);
                          return (
                            <div key={m.key} className="flex items-center gap-2 text-sm">
                              <div className={`w-2 h-2 rounded-full ${STAGE_COLORS[stageName] || "bg-gray-400"}`} />
                              <span className="text-muted-foreground">{wfStage?.label || stageName}</span>
                              <Check className="h-3 w-3 text-green-500" />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                return (
                  <p className="text-sm text-muted-foreground">
                    Connect your GHL pipeline stages so the workflow engine can sync opportunity stages automatically.
                  </p>
                );
              })()}
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadPipelines}
                disabled={loadingPipelines}
              >
                {loadingPipelines ? (
                  <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Loading...</>
                ) : config.some((c) => c.key.startsWith("ghl_stage_") && c.value) ? (
                  "Edit Mapping"
                ) : (
                  "Load GHL Pipelines"
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {ghlPipelines.length > 1 && (
                <div className="space-y-1">
                  <label className="text-sm font-medium">Pipeline</label>
                  <select
                    value={selectedPipeline}
                    onChange={(e) => setSelectedPipeline(e.target.value)}
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  >
                    {ghlPipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {selectedPipelineData && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Map each workflow stage to a GHL pipeline stage:
                  </p>
                  {WORKFLOW_STAGES.map(({ value, label }) => (
                    <div key={value} className="flex items-center gap-3">
                      <div className="w-48 flex items-center gap-2 flex-shrink-0">
                        <div className={`w-2.5 h-2.5 rounded-full ${STAGE_COLORS[value] || "bg-gray-400"}`} />
                        <span className="text-sm font-medium">{label}</span>
                      </div>
                      <select
                        value={stageMapping[value] || ""}
                        onChange={(e) =>
                          setStageMapping((prev) => ({ ...prev, [value]: e.target.value }))
                        }
                        className="flex-1 border rounded-md px-3 py-1.5 text-sm bg-background"
                      >
                        <option value="">-- Not mapped --</option>
                        {selectedPipelineData.stages.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    onClick={handleSaveStageMap}
                    disabled={savingMap}
                  >
                    {mapSaved ? (
                      <><Check className="h-3 w-3 mr-1" /> Saved!</>
                    ) : savingMap ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Saving...</>
                    ) : (
                      <><Save className="h-3 w-3 mr-1" /> Save Mapping</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workflow config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Workflow Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(configLabels)
              .filter(([key]) => !key.startsWith("ghl_stage_"))
              .map(([key, label]) => {
              const existing = config.find((c) => c.key === key);
              const isEditing = key in editingConfig;
              const currentValue = isEditing
                ? editingConfig[key]
                : existing?.value || "";

              return (
                <div key={key} className="space-y-1">
                  <label className="text-sm font-medium">{label}</label>
                  <div className="flex gap-2">
                    <Input
                      value={currentValue}
                      onChange={(e) =>
                        setEditingConfig((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      placeholder={`Enter ${label.toLowerCase()}`}
                      className="flex-1"
                    />
                    {isEditing && (
                      <Button
                        size="sm"
                        onClick={() => handleSaveConfig(key)}
                        disabled={saving === key}
                      >
                        <Save className="h-3 w-3 mr-1" />
                        {saving === key ? "Saving..." : "Save"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      </>)}
    </div>
  );
}
