"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { api, type AutomationLogEvent } from "@/lib/api";
import {
  Bell, Send, Clock, AlertCircle, MessageSquare, ArrowRight,
  Eye, CheckCircle, DollarSign, Zap, X,
} from "lucide-react";

const POLL_INTERVAL = 30_000; // 30 seconds
const LS_KEY = "at_notif_last_seen";

const EVENT_ICON: Record<string, React.ElementType> = {
  sms_sent: Send,
  sms_queued: Clock,
  sms_failed: AlertCircle,
  customer_reply: MessageSquare,
  stage_transition: ArrowRight,
  proposal_opened: Eye,
  estimate_approved: CheckCircle,
  deposit_paid: DollarSign,
  job_complete: CheckCircle,
};

const EVENT_COLOR: Record<string, string> = {
  sms_sent: "text-blue-600 bg-blue-50",
  sms_failed: "text-red-600 bg-red-50",
  customer_reply: "text-green-600 bg-green-50",
  stage_transition: "text-purple-600 bg-purple-50",
  estimate_approved: "text-green-600 bg-green-50",
  deposit_paid: "text-emerald-600 bg-emerald-50",
};

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

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AutomationLogEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getLastSeen = () => {
    try { return localStorage.getItem(LS_KEY) || ""; } catch { return ""; }
  };

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    try { localStorage.setItem(LS_KEY, now); } catch {}
    setUnreadCount(0);
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const since = getLastSeen();
      const res = await api.getNotificationsRecent(since || undefined);
      setEvents(res.events);
      setUnreadCount(res.count_since);
    } catch {}
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleToggle = () => {
    if (!open) {
      markSeen();
      fetchNotifications();
    }
    setOpen(!open);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggle}
        className="relative p-2 rounded-md hover:bg-muted transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] rounded-lg border bg-white shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Notifications</h3>
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-muted">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {events.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No recent activity
              </p>
            ) : (
              events.map((evt) => {
                const Icon = EVENT_ICON[evt.event_type] || Zap;
                const color = EVENT_COLOR[evt.event_type] || "text-gray-600 bg-gray-50";
                return (
                  <Link
                    key={evt.id}
                    href={`/leads/${evt.lead_id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b last:border-b-0"
                  >
                    <span className={`mt-0.5 rounded-full p-1.5 shrink-0 ${color}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{evt.contact_name || "Unknown"}</span>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{evt.detail}</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap mt-0.5 shrink-0">
                      {timeAgo(evt.created_at)}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
