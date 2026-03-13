"use client";

import { useEffect, useState } from "react";
import { api, getCurrentUser, type AdminScheduleSlot } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CalendarDays, X } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toMonthStr(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function toDayStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function SchedulePage() {
  const user = getCurrentUser();
  const isAdmin = user?.role === "admin";
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [slots, setSlots] = useState<AdminScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editSlot, setEditSlot] = useState<Partial<AdminScheduleSlot>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const monthStr = toMonthStr(year, month);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getAdminSchedule(monthStr);
      setSlots(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [monthStr]);

  const slotMap = Object.fromEntries(slots.map((s) => [s.date, s]));

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  };

  const handleDayClick = (day: number) => {
    const dateStr = toDayStr(year, month, day);
    setSelectedDate(dateStr);
    if (isAdmin) {
      const existing = slotMap[dateStr];
      setEditSlot(existing
        ? { date: dateStr, is_available: existing.is_available, max_bookings: existing.max_bookings, label: existing.label || "" }
        : { date: dateStr, is_available: true, max_bookings: 1, label: "" }
      );
    }
  };

  const handleSave = async () => {
    if (!selectedDate) return;
    setSaving(true);
    try {
      await api.upsertScheduleSlot({
        date: selectedDate,
        is_available: editSlot.is_available ?? true,
        max_bookings: editSlot.max_bookings ?? 1,
        label: editSlot.label || "",
      });
      await load();
      setSelectedDate(null);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedDate) return;
    setDeleting(true);
    try {
      await api.deleteScheduleSlot(selectedDate);
      await load();
      setSelectedDate(null);
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const todayStr = toDayStr(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Schedule</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {isAdmin
            ? "Control which dates customers can book via the proposal page. Click any date to add or edit availability."
            : "View booking availability for each month."}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        {/* Calendar */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                {MONTHS[month]} {year}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={prevMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={nextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-2">
              {DAYS.map((d) => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>

            {/* Calendar cells */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                if (!day) return <div key={i} />;
                const dateStr = toDayStr(year, month, day);
                const slot = slotMap[dateStr];
                const isSelected = selectedDate === dateStr;
                const isToday = dateStr === todayStr;
                const isPast = dateStr < todayStr;

                let cellClass = `rounded-lg border text-center py-2 text-sm ${isAdmin || slotMap[dateStr] ? "cursor-pointer" : "cursor-default"} transition-all select-none `;
                if (isSelected) {
                  cellClass += "border-blue-500 bg-blue-50 text-blue-800 font-semibold ";
                } else if (slot?.is_available && slot.booked_count < slot.max_bookings) {
                  cellClass += "border-green-400 bg-green-50 text-green-800 hover:bg-green-100 ";
                } else if (slot && (slot.booked_count >= slot.max_bookings || !slot.is_available)) {
                  cellClass += "border-yellow-400 bg-yellow-50 text-yellow-800 hover:bg-yellow-100 ";
                } else {
                  cellClass += `border-border bg-background hover:bg-muted/50 ${isPast ? "opacity-40" : ""}`;
                }

                return (
                  <div key={i} className={cellClass} onClick={() => handleDayClick(day)}>
                    <p className={`text-xs font-bold leading-none ${isToday ? "text-blue-600" : ""}`}>{day}</p>
                    {slot && (
                      <p className="text-[10px] mt-0.5 leading-none">
                        {slot.booked_count}/{slot.max_bookings}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 pt-3 border-t text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-green-100 border border-green-400" /> Available
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-yellow-100 border border-yellow-400" /> Full / Off
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-background border border-border" /> Not added
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Detail / Edit panel */}
        <div className="space-y-4">
          {selectedDate ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                  </CardTitle>
                  <button onClick={() => setSelectedDate(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {slotMap[selectedDate] && (
                  <Badge variant={slotMap[selectedDate].is_available ? "success" : "pending"} className="w-fit text-xs">
                    {slotMap[selectedDate].booked_count > 0 ? `${slotMap[selectedDate].booked_count} booking(s)` : "No bookings yet"}
                  </Badge>
                )}
              </CardHeader>
              {isAdmin ? (
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="avail"
                      className="h-4 w-4 rounded"
                      checked={editSlot.is_available ?? true}
                      onChange={(e) => setEditSlot((s) => ({ ...s, is_available: e.target.checked }))}
                    />
                    <label htmlFor="avail" className="text-sm font-medium cursor-pointer">Available for booking</label>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Max bookings</label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={editSlot.max_bookings ?? 1}
                      onChange={(e) => setEditSlot((s) => ({ ...s, max_bookings: parseInt(e.target.value) || 1 }))}
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Label (optional)</label>
                    <Input
                      placeholder="e.g. Morning only"
                      value={editSlot.label ?? ""}
                      onChange={(e) => setEditSlot((s) => ({ ...s, label: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="flex flex-col gap-2 pt-1">
                    <Button size="sm" onClick={handleSave} disabled={saving} className="w-full">
                      {saving ? "Saving…" : slotMap[selectedDate] ? "Update" : "Add Date"}
                    </Button>
                    {slotMap[selectedDate] && (
                      <Button size="sm" variant="outline" onClick={handleDelete} disabled={deleting || (slotMap[selectedDate]?.booked_count ?? 0) > 0} className="w-full text-destructive hover:text-destructive">
                        {deleting ? "Removing…" : "Remove Date"}
                      </Button>
                    )}
                    {(slotMap[selectedDate]?.booked_count ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground text-center">Can't remove — has active bookings</p>
                    )}
                  </div>
                </CardContent>
              ) : (
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  {slotMap[selectedDate] ? (
                    <>
                      <p>Status: <span className="font-medium text-foreground">{slotMap[selectedDate].is_available ? "Available" : "Unavailable"}</span></p>
                      <p>Capacity: <span className="font-medium text-foreground">{slotMap[selectedDate].booked_count} / {slotMap[selectedDate].max_bookings}</span></p>
                      {slotMap[selectedDate].label && <p>Note: <span className="font-medium text-foreground">{slotMap[selectedDate].label}</span></p>}
                    </>
                  ) : (
                    <p>No availability configured for this date.</p>
                  )}
                </CardContent>
              )}
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-center text-sm text-muted-foreground space-y-2">
                <CalendarDays className="h-8 w-8 mx-auto opacity-40" />
                <p>{isAdmin ? "Click any date to add or edit availability" : "Click any date to view details"}</p>
              </CardContent>
            </Card>
          )}

          {/* Month summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Month Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Available dates</span>
                <span className="font-medium">{slots.filter((s) => s.is_available && s.booked_count < s.max_bookings).length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total bookings</span>
                <span className="font-medium">{slots.reduce((acc, s) => acc + s.booked_count, 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Full dates</span>
                <span className="font-medium">{slots.filter((s) => s.booked_count >= s.max_bookings).length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
