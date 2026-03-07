"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type DashboardStats, type Estimate } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Users, CheckCircle, TrendingUp, ArrowRight } from "lucide-react";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

const statusVariant: Record<string, "pending" | "success" | "destructive" | "warning"> = {
  pending: "pending",
  approved: "success",
  rejected: "destructive",
  adjusted: "warning",
};

const serviceLabel: Record<string, string> = {
  fence_staining: "Fence Staining",
  pressure_washing: "Pressure Washing",
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pendingEstimates, setPendingEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getStats().catch(() => null),
      api.getEstimates("status=pending&limit=5").catch(() => []),
    ]).then(([s, e]) => {
      setStats(s as DashboardStats);
      setPendingEstimates(e as Estimate[]);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back — here's what needs your attention.</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Pending Approvals"
          value={loading ? "—" : (stats?.pending_estimates ?? 0)}
          icon={Clock}
          description="Estimates waiting for your review"
        />
        <StatCard
          title="Leads This Week"
          value={loading ? "—" : (stats?.leads_this_week ?? 0)}
          icon={Users}
          description="New leads from GoHighLevel"
        />
        <StatCard
          title="Approved This Month"
          value={loading ? "—" : (stats?.approved_this_month ?? 0)}
          icon={CheckCircle}
          description="Estimates sent to clients"
        />
        <StatCard
          title="Revenue Estimate"
          value={loading ? "—" : formatCurrency(stats?.revenue_estimate_this_month ?? 0)}
          icon={TrendingUp}
          description="Low estimate, approved jobs this month"
        />
      </div>

      {/* Pending Approval Queue */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Pending Approvals</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/estimates">
              View all <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : pendingEstimates.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No pending estimates — you're all caught up!
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pendingEstimates.map((est) => (
              <Card key={est.id} className="hover:shadow-md transition-shadow">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {est.lead?.contact_name || (serviceLabel[est.service_type] ?? est.service_type)}
                        </span>
                        <Badge variant={statusVariant[est.status] ?? "outline"}>
                          {est.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {serviceLabel[est.service_type] ?? est.service_type}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {est.lead?.address ?? "Address pending"}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(est.created_at)}</p>
                    </div>
                    <div className="text-right space-y-1">
                      <p className="font-bold text-lg">
                        {formatCurrency(est.estimate_low)}–{formatCurrency(est.estimate_high)}
                      </p>
                      <Button size="sm" asChild>
                        <Link href={`/estimates/${est.id}`}>Review</Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
