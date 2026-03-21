"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type WorkflowStats, type QueuedMessage, type WorkflowConfigItem } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Zap, MessageSquare, Clock, Pause, Send, X, Save, Settings2,
} from "lucide-react";

const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-blue-500",
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
  const [stats, setStats] = useState<WorkflowStats | null>(null);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [config, setConfig] = useState<WorkflowConfigItem[]>([]);
  const [editingConfig, setEditingConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [s, q, c] = await Promise.all([
        api.getWorkflowStats(),
        api.getMessageQueue(),
        api.getWorkflowConfig(),
      ]);
      setStats(s);
      setQueue(q);
      setConfig(c);
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
      setConfig((prev) =>
        prev.map((c) => (c.key === key ? { ...c, value } : c))
      );
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
            {config.map((item) => {
              const isEditing = item.key in editingConfig;
              const currentValue = isEditing
                ? editingConfig[item.key]
                : item.value;

              return (
                <div key={item.key} className="space-y-1">
                  <label className="text-sm font-medium">
                    {configLabels[item.key] || item.key}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={currentValue}
                      onChange={(e) =>
                        setEditingConfig((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }))
                      }
                      className="flex-1"
                    />
                    {isEditing && (
                      <Button
                        size="sm"
                        onClick={() => handleSaveConfig(item.key)}
                        disabled={saving === item.key}
                      >
                        <Save className="h-3 w-3 mr-1" />
                        {saving === item.key ? "Saving..." : "Save"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
