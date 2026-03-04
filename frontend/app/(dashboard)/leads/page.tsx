"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Lead, type LeadStatus, type ServiceType } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, CheckCircle2, Circle } from "lucide-react";

const statusVariant: Record<LeadStatus, "pending" | "success" | "destructive" | "warning" | "secondary"> = {
  new: "pending",
  estimated: "warning",
  approved: "success",
  rejected: "destructive",
  sent: "secondary",
};

const priorityColors: Record<string, string> = {
  HOT: "bg-red-100 text-red-700",
  HIGH: "bg-orange-100 text-orange-700",
  MEDIUM: "bg-blue-100 text-blue-700",
  LOW: "bg-gray-100 text-gray-600",
};

const serviceLabel: Record<ServiceType, string> = {
  fence_staining: "Fence Staining",
  pressure_washing: "Pressure Washing",
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState<ServiceType | "all">("all");

  useEffect(() => {
    const params = serviceFilter !== "all" ? `service_type=${serviceFilter}` : "";
    api.getLeads(params)
      .then(setLeads)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [serviceFilter]);

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    return (
      l.address.toLowerCase().includes(q) ||
      l.ghl_contact_id.toLowerCase().includes(q) ||
      (l.contact_name || "").toLowerCase().includes(q)
    );
  });

  // Sort by priority: HOT > HIGH > MEDIUM > LOW
  const priorityOrder: Record<string, number> = { HOT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...filtered].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 2;
    const pb = priorityOrder[b.priority] ?? 2;
    return pa - pb;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">All incoming leads from GoHighLevel</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, address..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {(["all", "fence_staining", "pressure_washing"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={serviceFilter === s ? "default" : "outline"}
              onClick={() => setServiceFilter(s)}
            >
              {s === "all" ? "All Services" : serviceLabel[s]}
            </Button>
          ))}
        </div>
      </div>

      {/* Leads list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No leads found. They&apos;ll appear here when GHL sends them.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-4 font-medium">Contact</th>
                <th className="text-left p-4 font-medium">Service</th>
                <th className="text-left p-4 font-medium">Address</th>
                <th className="text-left p-4 font-medium">Priority</th>
                <th className="text-left p-4 font-medium">Responded</th>
                <th className="text-left p-4 font-medium">Status</th>
                <th className="text-right p-4 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((lead) => (
                <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-4">
                    <div className="font-medium">{lead.contact_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(lead.created_at)}</div>
                  </td>
                  <td className="p-4">
                    <span className="font-medium">{serviceLabel[lead.service_type]}</span>
                  </td>
                  <td className="p-4 max-w-[200px] truncate">{lead.address || "—"}</td>
                  <td className="p-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${priorityColors[lead.priority] || priorityColors.MEDIUM}`}>
                      {lead.priority}
                    </span>
                  </td>
                  <td className="p-4">
                    {lead.customer_responded ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-gray-300" />
                    )}
                  </td>
                  <td className="p-4">
                    <Badge variant={statusVariant[lead.status]}>{lead.status}</Badge>
                  </td>
                  <td className="p-4 text-right">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/leads/${lead.id}`}>View</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
