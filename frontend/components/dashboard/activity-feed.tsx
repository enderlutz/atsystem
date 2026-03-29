"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type AutomationLogEvent } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Send, Clock, AlertCircle, MessageSquare, ArrowRight,
  Eye, CheckCircle, DollarSign, Zap,
} from "lucide-react";

const EVENT_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  sms_sent: { icon: Send, label: "SMS Sent", color: "text-blue-600 bg-blue-50" },
  sms_queued: { icon: Clock, label: "SMS Scheduled", color: "text-gray-500 bg-gray-50" },
  sms_failed: { icon: AlertCircle, label: "SMS Failed", color: "text-red-600 bg-red-50" },
  customer_reply: { icon: MessageSquare, label: "Customer Replied", color: "text-green-600 bg-green-50" },
  stage_transition: { icon: ArrowRight, label: "Stage Changed", color: "text-purple-600 bg-purple-50" },
  proposal_opened: { icon: Eye, label: "Proposal Viewed", color: "text-amber-600 bg-amber-50" },
  estimate_approved: { icon: CheckCircle, label: "Estimate Approved", color: "text-green-600 bg-green-50" },
  deposit_paid: { icon: DollarSign, label: "Deposit Paid", color: "text-emerald-600 bg-emerald-50" },
  job_complete: { icon: CheckCircle, label: "Job Complete", color: "text-green-700 bg-green-50" },
};

const DEFAULT_CONFIG = { icon: Zap, label: "Event", color: "text-gray-600 bg-gray-50" };

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActivityFeed() {
  const [events, setEvents] = useState<AutomationLogEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAutomationLog({ limit: 15 })
      .then((res) => setEvents(res.events))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Recent Automation Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No automation activity yet.</p>
        ) : (
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {events.map((evt) => {
              const cfg = EVENT_CONFIG[evt.event_type] || DEFAULT_CONFIG;
              const Icon = cfg.icon;
              return (
                <Link
                  key={evt.id}
                  href={`/leads/${evt.lead_id}`}
                  className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
                >
                  <span className={`mt-0.5 rounded-full p-1.5 ${cfg.color}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {evt.contact_name || "Unknown"}{" "}
                      <span className="font-normal text-muted-foreground">— {cfg.label}</span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{evt.detail}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap mt-0.5">
                    {timeAgo(evt.created_at)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
