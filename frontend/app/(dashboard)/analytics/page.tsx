"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  Target,
  Calendar,
  Clock,
  Zap,
  AlertTriangle,
  MessageSquare,
  CheckCircle,
  Send,
  Inbox,
  Users,
  ArrowDownRight,
  BarChart3,
  Layers,
  Lightbulb,
  MapPin,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalyticsRevenue {
  total_revenue: number;
  total_bookings: number;
  avg_deal_value: number;
  current_month_revenue: number;
  previous_month_revenue: number;
  month_change_pct: number;
  projected_month_revenue: number;
  revenue_trend: { period: string; revenue: number; bookings: number; avg_deal: number }[];
  tier_distribution: { tier: string; count: number; revenue: number }[];
  top_zip_codes: { zip_code: string; bookings: number; revenue: number }[];
}

interface AnalyticsFunnel {
  funnel_stages: { stage: string; count: number }[];
  overall_conversion_rate: number;
  biggest_dropoff: { from: string; to: string; drop_pct: number } | null;
  conversion_trend: { week: string; leads: number; booked: number; rate: number }[];
}

interface AnalyticsSpeed {
  avg_hours_to_estimate: number | null;
  avg_hours_to_booking: number | null;
  avg_days_lead_to_booking: number | null;
  stage_dwell_times: { stage: string; label: string; avg_hours: number; count: number }[];
  current_bottlenecks: { stage: string; label: string; count: number; avg_days_stuck: number }[];
  speed_trend: { week: string; avg_days: number }[];
}

interface AnalyticsEngagement {
  sms_stats: { sent: number; failed: number; cancelled: number; pending: number };
  delivery_rate: number;
  stage_response_rates: { stage: string; label: string; messaged: number; responded: number; rate: number }[];
  overall_response_rate: number;
  message_volume: { day: string; sent: number; failed: number }[];
  schedule_capacity: { date: string; max_bookings: number; booked: number }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtHours(n: number | null): string {
  if (n === null || n === undefined) return "--";
  return `${n.toFixed(1)} hrs`;
}

function fmtDays(n: number | null): string {
  if (n === null || n === undefined) return "--";
  return `${n.toFixed(1)} days`;
}

function shortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon: Icon,
  subtext,
  subtextColor,
}: {
  label: string;
  value: string | number;
  icon?: React.ElementType;
  subtext?: string;
  subtextColor?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtext && (
          <p className={`text-xs mt-1 ${subtextColor ?? "text-muted-foreground"}`}>{subtext}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
          </CardHeader>
          <CardContent>
            <div className="h-7 w-20 bg-muted animate-pulse rounded mb-2" />
            <div className="h-3 w-32 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SkeletonChart() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-40 bg-muted animate-pulse rounded" />
      </CardHeader>
      <CardContent>
        <div className="h-[300px] bg-muted animate-pulse rounded" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-16 text-center text-muted-foreground">
        <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>{message}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tabs config
// ---------------------------------------------------------------------------

const TABS = [
  { key: "revenue", label: "Revenue & Deals", icon: DollarSign },
  { key: "funnel", label: "Conversion Funnel", icon: Users },
  { key: "speed", label: "Operational Speed", icon: Zap },
  { key: "engagement", label: "SMS & Engagement", icon: MessageSquare },
  { key: "cohorts", label: "Cohort Analysis", icon: Layers },
  { key: "insights", label: "Lead Insights", icon: Lightbulb },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const PERIODS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const TIER_COLORS: Record<string, string> = {
  Essential: "#94A3B8",
  Signature: "#0693e3",
  Legacy: "#F59E0B",
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [period, setPeriod] = useState("30d");
  const [activeTab, setActiveTab] = useState<TabKey>("revenue");
  const [loading, setLoading] = useState(true);

  const [revenue, setRevenue] = useState<AnalyticsRevenue | null>(null);
  const [funnel, setFunnel] = useState<AnalyticsFunnel | null>(null);
  const [speed, setSpeed] = useState<AnalyticsSpeed | null>(null);
  const [engagement, setEngagement] = useState<AnalyticsEngagement | null>(null);
  const [cohorts, setCohorts] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      switch (activeTab) {
        case "revenue": {
          const data = await (api as any).getAnalyticsRevenue(period);
          setRevenue(data);
          break;
        }
        case "funnel": {
          const data = await (api as any).getAnalyticsFunnel(period);
          setFunnel(data);
          break;
        }
        case "speed": {
          const data = await (api as any).getAnalyticsSpeed(period);
          setSpeed(data);
          break;
        }
        case "engagement": {
          const data = await (api as any).getAnalyticsEngagement(period);
          setEngagement(data);
          break;
        }
        case "cohorts": {
          const data = await (api as any).getAnalyticsCohorts(period === "90d" || period === "all" ? "month" : "week");
          setCohorts(data);
          break;
        }
        case "insights": {
          const data = await (api as any).getAnalyticsInsights(period);
          setInsights(data);
          break;
        }
      }
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Data-driven insights for decision making</p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "revenue" && <RevenueTab data={revenue} loading={loading} />}
      {activeTab === "funnel" && <FunnelTab data={funnel} loading={loading} />}
      {activeTab === "speed" && <SpeedTab data={speed} loading={loading} />}
      {activeTab === "engagement" && <EngagementTab data={engagement} loading={loading} />}
      {activeTab === "cohorts" && <CohortsTab data={cohorts} loading={loading} />}
      {activeTab === "insights" && <InsightsTab data={insights} loading={loading} />}
    </div>
  );
}

// ===========================================================================
// Tab 1: Revenue & Deals
// ===========================================================================

function RevenueTab({ data, loading }: { data: AnalyticsRevenue | null; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <SkeletonCards count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        <SkeletonChart />
      </div>
    );
  }

  const trendData = data.revenue_trend.map((d) => ({
    ...d,
    label: shortDate(d.period),
  }));

  const tierData = data.tier_distribution.map((t) => ({
    ...t,
    pct: data.total_bookings > 0 ? ((t.count / data.total_bookings) * 100).toFixed(1) : "0",
  }));

  const zipData = [...data.top_zip_codes].slice(0, 10).reverse();

  const hasRevenue = data.total_revenue > 0;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Revenue" value={fmtCurrency(data.total_revenue)} icon={DollarSign} />
        <StatCard label="Avg Deal Value" value={fmtCurrency(data.avg_deal_value)} icon={TrendingUp} />
        <StatCard
          label="This Month"
          value={fmtCurrency(data.current_month_revenue)}
          icon={Calendar}
          subtext={`${data.month_change_pct > 0 ? "+" : ""}${data.month_change_pct.toFixed(1)}% vs last month`}
          subtextColor={data.month_change_pct >= 0 ? "text-green-600" : "text-red-600"}
        />
        <StatCard
          label="Projected Revenue"
          value={fmtCurrency(data.projected_month_revenue)}
          icon={Target}
        />
      </div>

      {!hasRevenue ? (
        <EmptyState message="No revenue data yet. Revenue will appear here once bookings start coming in." />
      ) : (
        <>
          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0693e3" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#0693e3" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis
                      yAxisId="revenue"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis yAxisId="bookings" orientation="right" tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={((value: number, name: string) =>
                        name === "revenue" ? fmtCurrency(value) : value
                      ) as any}
                    />
                    <Legend />
                    <Area
                      yAxisId="revenue"
                      type="monotone"
                      dataKey="revenue"
                      stroke="#0693e3"
                      fill="url(#revenueGradient)"
                      strokeWidth={2}
                    />
                    <Bar yAxisId="bookings" dataKey="bookings" fill="#94A3B8" radius={[2, 2, 0, 0]} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Tier Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tier Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={tierData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      dataKey="count"
                      nameKey="tier"
                      label={({ tier, pct }: any) => `${tier} (${pct}%)`}
                    >
                      {tierData.map((entry) => (
                        <Cell
                          key={entry.tier}
                          fill={TIER_COLORS[entry.tier] ?? "#CBD5E1"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={((value: number, name: string, props: any) => [
                        `${value} bookings (${fmtCurrency(props.payload.revenue)})`,
                        name,
                      ]) as any}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Top Zip Codes */}
          {zipData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Zip Codes by Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(300, zipData.length * 40)}>
                  <BarChart data={zipData} layout="vertical" margin={{ left: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v: number) => fmtCurrency(v)}
                    />
                    <YAxis type="category" dataKey="zip_code" tick={{ fontSize: 12 }} width={50} />
                    <Tooltip formatter={((v: number) => fmtCurrency(v)) as any} />
                    <Bar dataKey="revenue" fill="#0693e3" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Tab 2: Conversion Funnel
// ===========================================================================

function FunnelTab({ data, loading }: { data: AnalyticsFunnel | null; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <SkeletonCards count={3} />
        <SkeletonChart />
        <SkeletonChart />
      </div>
    );
  }

  const totalLeads = data.funnel_stages.length > 0 ? data.funnel_stages[0].count : 0;
  const hasFunnelData = totalLeads > 0;

  // Compute drop-off between stages
  const funnelWithDropoff = data.funnel_stages.map((stage, i) => {
    const prev = i > 0 ? data.funnel_stages[i - 1].count : stage.count;
    const dropPct = prev > 0 ? (((prev - stage.count) / prev) * 100) : 0;
    return { ...stage, dropPct: i === 0 ? 0 : dropPct };
  });

  // Funnel colors from light to dark
  const funnelColors = ["#E2E8F0", "#CBD5E1", "#94A3B8", "#64748B", "#475569", "#334155", "#0693e3"];

  const trendData = data.conversion_trend.map((d) => ({
    ...d,
    label: shortDate(d.week),
  }));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Overall Conversion Rate"
          value={fmtPct(data.overall_conversion_rate)}
          icon={TrendingUp}
        />
        <StatCard
          label="Biggest Drop-off"
          value={
            data.biggest_dropoff
              ? `${data.biggest_dropoff.from} \u2192 ${data.biggest_dropoff.to}`
              : "None"
          }
          icon={ArrowDownRight}
          subtext={data.biggest_dropoff ? `${data.biggest_dropoff.drop_pct.toFixed(1)}% lost` : undefined}
          subtextColor="text-red-600"
        />
        <StatCard label="Total Leads" value={totalLeads} icon={Users} />
      </div>

      {!hasFunnelData ? (
        <EmptyState message="No funnel data yet. Leads will populate the funnel as they progress through stages." />
      ) : (
        <>
          {/* Funnel Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lead Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {funnelWithDropoff.map((stage, i) => {
                  const maxCount = funnelWithDropoff[0].count || 1;
                  const widthPct = Math.max((stage.count / maxCount) * 100, 8);
                  const color = funnelColors[Math.min(i, funnelColors.length - 1)];
                  return (
                    <div key={stage.stage}>
                      <div className="flex items-center gap-3">
                        <div className="w-32 text-sm text-gray-600 text-right shrink-0 truncate">
                          {stage.stage}
                        </div>
                        <div className="flex-1">
                          <div
                            className="h-10 rounded-md flex items-center px-3 transition-all"
                            style={{ width: `${widthPct}%`, backgroundColor: color }}
                          >
                            <span className="text-sm font-semibold text-white drop-shadow-sm">
                              {stage.count}
                            </span>
                          </div>
                        </div>
                        {i > 0 && stage.dropPct > 0 && (
                          <span className="text-xs text-red-500 font-medium w-16 shrink-0">
                            -{stage.dropPct.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Conversion Rate Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weekly Conversion Rate Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {trendData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  Not enough data to show a trend yet.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v: number) => `${v}%`}
                      domain={[0, "auto"]}
                    />
                    <Tooltip formatter={((v: number) => `${v.toFixed(1)}%`) as any} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      name="Conversion Rate"
                      stroke="#22C55E"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Tab 3: Operational Speed
// ===========================================================================

function SpeedTab({ data, loading }: { data: AnalyticsSpeed | null; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <SkeletonCards count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        <SkeletonChart />
      </div>
    );
  }

  const topBottleneck =
    data.current_bottlenecks.length > 0
      ? data.current_bottlenecks.reduce((a, b) => (a.count > b.count ? a : b))
      : null;

  const dwellData = data.stage_dwell_times.map((s) => ({
    ...s,
    fill: s.avg_hours < 6 ? "#22C55E" : s.avg_hours < 24 ? "#EAB308" : "#EF4444",
  }));

  const hasData =
    data.stage_dwell_times.length > 0 ||
    data.current_bottlenecks.length > 0 ||
    data.speed_trend.length > 0;

  const trendData = data.speed_trend.map((d) => ({
    ...d,
    label: shortDate(d.week),
  }));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Avg Lead to Estimate"
          value={fmtHours(data.avg_hours_to_estimate)}
          icon={Clock}
        />
        <StatCard
          label="Avg to Booking"
          value={fmtHours(data.avg_hours_to_booking)}
          icon={Clock}
        />
        <StatCard
          label="Avg Full Cycle"
          value={fmtDays(data.avg_days_lead_to_booking)}
          icon={Calendar}
        />
        <StatCard
          label="Current Bottleneck"
          value={topBottleneck ? `${topBottleneck.label} (${topBottleneck.count})` : "None"}
          icon={AlertTriangle}
        />
      </div>

      {!hasData ? (
        <EmptyState message="No operational speed data available yet. Data will populate as leads move through the pipeline." />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stage Dwell Times */}
            {dwellData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Stage Dwell Times</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={Math.max(300, dwellData.length * 45)}>
                    <BarChart data={dwellData} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v: number) => `${v}h`}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        tick={{ fontSize: 12 }}
                        width={70}
                      />
                      <Tooltip
                        formatter={((v: number) => `${v.toFixed(1)} hours`) as any}
                        labelFormatter={((label: string) => label) as any}
                      />
                      <Bar dataKey="avg_hours" radius={[0, 4, 4, 0]}>
                        {dwellData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-sm bg-green-500" /> &lt; 6 hrs
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-sm bg-yellow-500" /> 6-24 hrs
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-sm bg-red-500" /> &gt; 24 hrs
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Current Pipeline / Bottlenecks */}
            {data.current_bottlenecks.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Current Pipeline Bottlenecks</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data.current_bottlenecks}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={((v: number, name: string) =>
                          name === "count" ? `${v} leads` : `${v.toFixed(1)} days`
                        ) as any}
                      />
                      <Legend />
                      <Bar dataKey="count" name="Leads Stuck" fill="#0693e3" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Speed Trend */}
          {trendData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Avg Days to Booking (Weekly Trend)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}d`} />
                    <Tooltip formatter={((v: number) => `${v.toFixed(1)} days`) as any} />
                    <Line
                      type="monotone"
                      dataKey="avg_days"
                      name="Avg Days"
                      stroke="#0693e3"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Tab 4: SMS & Engagement
// ===========================================================================

function EngagementTab({ data, loading }: { data: AnalyticsEngagement | null; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <SkeletonCards count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        <SkeletonChart />
      </div>
    );
  }

  const hasMessages = data.sms_stats.sent > 0 || data.sms_stats.pending > 0;

  const volumeData = data.message_volume.map((d) => ({
    ...d,
    label: shortDate(d.day),
  }));

  const responseData = data.stage_response_rates.map((s) => ({
    ...s,
    fill: s.rate > 50 ? "#22C55E" : s.rate > 25 ? "#EAB308" : "#EF4444",
  }));

  const capacityData = data.schedule_capacity.map((d) => ({
    ...d,
    label: shortDate(d.date),
    remaining: Math.max(0, d.max_bookings - d.booked),
  }));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Messages Sent" value={data.sms_stats.sent.toLocaleString()} icon={Send} />
        <StatCard
          label="Delivery Rate"
          value={fmtPct(data.delivery_rate)}
          icon={CheckCircle}
          subtext={data.delivery_rate >= 95 ? "Healthy" : "Below target"}
          subtextColor={data.delivery_rate >= 95 ? "text-green-600" : "text-red-600"}
        />
        <StatCard
          label="Response Rate"
          value={fmtPct(data.overall_response_rate)}
          icon={MessageSquare}
        />
        <StatCard
          label="Pending Queue"
          value={data.sms_stats.pending.toLocaleString()}
          icon={Inbox}
        />
      </div>

      {!hasMessages ? (
        <EmptyState message="No SMS data yet. Message analytics will appear here once messages start being sent." />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Message Volume */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily Message Volume</CardTitle>
              </CardHeader>
              <CardContent>
                {volumeData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">No volume data available.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={volumeData}>
                      <defs>
                        <linearGradient id="sentGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0693e3" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#0693e3" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="sent"
                        name="Sent"
                        stroke="#0693e3"
                        fill="url(#sentGradient)"
                        stackId="1"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="failed"
                        name="Failed"
                        stroke="#EF4444"
                        fill="url(#failedGradient)"
                        stackId="1"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Response Rate by Stage */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Response Rate by Stage</CardTitle>
              </CardHeader>
              <CardContent>
                {responseData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">No response data available.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={responseData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v: number) => `${v}%`}
                        domain={[0, 100]}
                      />
                      <Tooltip formatter={((v: number) => `${v.toFixed(1)}%`) as any} />
                      <Bar dataKey="rate" name="Response Rate" radius={[4, 4, 0, 0]}>
                        {responseData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Schedule Capacity */}
          {capacityData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Schedule Capacity (Next 30 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={capacityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="booked"
                      name="Booked"
                      stackId="capacity"
                      fill="#0693e3"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="remaining"
                      name="Available"
                      stackId="capacity"
                      fill="#E2E8F0"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Tab 5: Cohort Analysis
// ===========================================================================

function CohortsTab({ data, loading }: { data: any; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <SkeletonCards count={3} />
        <SkeletonChart />
        <SkeletonChart />
      </div>
    );
  }

  const cohorts: any[] = data.cohorts || [];
  if (cohorts.length === 0) {
    return <EmptyState message="No cohort data available yet." />;
  }

  const latest = cohorts[0];
  const previous = cohorts.length > 1 ? cohorts[1] : null;
  const rateChange = previous
    ? (latest.booking_rate - previous.booking_rate).toFixed(1)
    : null;

  const chartData = [...cohorts].reverse().map((c) => ({
    ...c,
    label: shortDate(c.cohort),
  }));

  const COHORT_COLORS = {
    estimate_rate: "#94A3B8",
    proposal_rate: "#0693e3",
    booking_rate: "#22C55E",
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Latest Cohort"
          value={shortDate(latest.cohort)}
          icon={Layers}
          subtext={`${latest.leads} leads`}
        />
        <StatCard
          label="Booking Rate"
          value={fmtPct(latest.booking_rate)}
          icon={TrendingUp}
          subtext={
            rateChange !== null
              ? `${Number(rateChange) >= 0 ? "+" : ""}${rateChange}% vs prev`
              : undefined
          }
          subtextColor={
            rateChange !== null
              ? Number(rateChange) >= 0
                ? "text-green-600"
                : "text-red-600"
              : undefined
          }
        />
        <StatCard
          label="Revenue / Lead"
          value={fmtCurrency(latest.revenue_per_lead)}
          icon={DollarSign}
        />
        <StatCard
          label="Cohort Revenue"
          value={fmtCurrency(latest.revenue)}
          icon={Target}
        />
      </div>

      {/* Conversion Rates by Cohort */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversion Rates by Cohort</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}%`} domain={[0, "auto"]} />
              <Tooltip formatter={((v: number) => `${v.toFixed(1)}%`) as any} />
              <Legend />
              <Bar dataKey="estimate_rate" name="Estimated" fill={COHORT_COLORS.estimate_rate} radius={[2, 2, 0, 0]} />
              <Bar dataKey="proposal_rate" name="Proposal Sent" fill={COHORT_COLORS.proposal_rate} radius={[2, 2, 0, 0]} />
              <Bar dataKey="booking_rate" name="Booked" fill={COHORT_COLORS.booking_rate} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Revenue per Lead by Cohort */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue per Lead by Cohort</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="rplGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22C55E" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip formatter={((v: number) => fmtCurrency(v)) as any} />
              <Area
                type="monotone"
                dataKey="revenue_per_lead"
                name="Revenue / Lead"
                stroke="#22C55E"
                fill="url(#rplGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Cohort Detail Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cohort Detail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Cohort</th>
                  <th className="pb-2 pr-4 text-right">Leads</th>
                  <th className="pb-2 pr-4 text-right">Estimated</th>
                  <th className="pb-2 pr-4 text-right">Sent</th>
                  <th className="pb-2 pr-4 text-right">Booked</th>
                  <th className="pb-2 pr-4 text-right">Rate</th>
                  <th className="pb-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c: any) => (
                  <tr key={c.cohort} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-medium">{shortDate(c.cohort)}</td>
                    <td className="py-2 pr-4 text-right">{c.leads}</td>
                    <td className="py-2 pr-4 text-right">{c.estimated}</td>
                    <td className="py-2 pr-4 text-right">{c.proposal_sent}</td>
                    <td className="py-2 pr-4 text-right">{c.booked}</td>
                    <td className="py-2 pr-4 text-right">
                      <span className={c.booking_rate >= 20 ? "text-green-600 font-medium" : c.booking_rate >= 10 ? "text-yellow-600" : "text-red-500"}>
                        {fmtPct(c.booking_rate)}
                      </span>
                    </td>
                    <td className="py-2 text-right">{fmtCurrency(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// Tab 6: Lead Insights
// ===========================================================================

const DAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT: Record<string, string> = {
  Sunday: "Sun", Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed",
  Thursday: "Thu", Friday: "Fri", Saturday: "Sat",
};

function InsightsTab({ data, loading }: { data: any; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <SkeletonCards count={3} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        <SkeletonChart />
      </div>
    );
  }

  const zipPerf: any[] = data.zip_performance || [];
  const leadsByDay: any[] = data.leads_by_day || [];
  const bookingsByDay: any[] = data.bookings_by_day || [];
  const bookingsByHour: any[] = data.bookings_by_hour || [];
  const followup: any[] = data.followup_effectiveness || [];

  const hasData = zipPerf.length > 0 || leadsByDay.length > 0 || followup.length > 0;

  const bestZip = zipPerf.length > 0 ? zipPerf.reduce((a: any, b: any) => (a.conversion_rate > b.conversion_rate && a.total_leads >= 3 ? a : b)) : null;
  const bestLeadDay = leadsByDay.length > 0 ? leadsByDay.reduce((a: any, b: any) => (a.leads > b.leads ? a : b)) : null;
  const bestFollowup = followup.length > 0 ? followup.reduce((a: any, b: any) => (a.booking_rate > b.booking_rate && a.leads_messaged >= 3 ? a : b)) : null;

  const dayData = DAY_ORDER.map((day) => {
    const lead = leadsByDay.find((d: any) => d.day_name === day);
    const booking = bookingsByDay.find((d: any) => d.day_name === day);
    return {
      day: DAY_SHORT[day] || day,
      leads: lead?.leads || 0,
      bookings: booking?.bookings || 0,
    };
  });

  const hourData = bookingsByHour.map((h: any) => ({
    hour: `${h.hour}:00`,
    bookings: h.bookings,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Best Zip Code"
          value={bestZip ? bestZip.zip_code : "--"}
          icon={MapPin}
          subtext={bestZip ? `${fmtPct(bestZip.conversion_rate)} conversion, ${bestZip.total_leads} leads` : undefined}
          subtextColor="text-green-600"
        />
        <StatCard
          label="Best Day for Leads"
          value={bestLeadDay ? bestLeadDay.day_name : "--"}
          icon={Calendar}
          subtext={bestLeadDay ? `${bestLeadDay.leads} leads` : undefined}
        />
        <StatCard
          label="Best Follow-up Stage"
          value={bestFollowup ? bestFollowup.label : "--"}
          icon={MessageSquare}
          subtext={bestFollowup ? `${fmtPct(bestFollowup.booking_rate)} eventually book` : undefined}
          subtextColor="text-green-600"
        />
      </div>

      {!hasData ? (
        <EmptyState message="Not enough data for insights yet." />
      ) : (
        <>
          {/* Zip Code Performance Table */}
          {zipPerf.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Zip Code Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Zip Code</th>
                        <th className="pb-2 pr-4 text-right">Leads</th>
                        <th className="pb-2 pr-4 text-right">Bookings</th>
                        <th className="pb-2 pr-4 text-right">Conversion</th>
                        <th className="pb-2 pr-4 text-right">Avg Deal</th>
                        <th className="pb-2 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zipPerf.map((z: any) => (
                        <tr key={z.zip_code} className="border-b border-gray-100">
                          <td className="py-2 pr-4 font-medium">{z.zip_code}</td>
                          <td className="py-2 pr-4 text-right">{z.total_leads}</td>
                          <td className="py-2 pr-4 text-right">{z.bookings}</td>
                          <td className="py-2 pr-4 text-right">
                            <span className={z.conversion_rate >= 30 ? "text-green-600 font-medium" : z.conversion_rate >= 15 ? "text-yellow-600" : "text-red-500"}>
                              {fmtPct(z.conversion_rate)}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-right">{fmtCurrency(z.avg_deal)}</td>
                          <td className="py-2 text-right">{fmtCurrency(z.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {dayData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Leads & Bookings by Day of Week</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={dayData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="leads" name="Leads" fill="#94A3B8" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="bookings" name="Bookings" fill="#0693e3" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {hourData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bookings by Hour of Day</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={hourData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="hour" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="bookings" name="Bookings" fill="#22C55E" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Follow-up Effectiveness */}
          {followup.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Follow-up Effectiveness by Stage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Stage</th>
                        <th className="pb-2 pr-4 text-right">Leads Messaged</th>
                        <th className="pb-2 pr-4 text-right">Responded (48h)</th>
                        <th className="pb-2 pr-4 text-right">Response Rate</th>
                        <th className="pb-2 pr-4 text-right">Eventually Booked</th>
                        <th className="pb-2 text-right">Booking Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {followup.map((f: any) => (
                        <tr key={f.stage} className="border-b border-gray-100">
                          <td className="py-2 pr-4 font-medium">{f.label}</td>
                          <td className="py-2 pr-4 text-right">{f.leads_messaged}</td>
                          <td className="py-2 pr-4 text-right">{f.responded_48h}</td>
                          <td className="py-2 pr-4 text-right">
                            <span className={f.response_rate >= 40 ? "text-green-600 font-medium" : f.response_rate >= 20 ? "text-yellow-600" : "text-red-500"}>
                              {fmtPct(f.response_rate)}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-right">{f.eventually_booked}</td>
                          <td className="py-2 text-right">
                            <span className={f.booking_rate >= 30 ? "text-green-600 font-medium" : f.booking_rate >= 15 ? "text-yellow-600" : "text-red-500"}>
                              {fmtPct(f.booking_rate)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
