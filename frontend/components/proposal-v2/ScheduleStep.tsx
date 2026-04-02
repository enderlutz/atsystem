"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ScheduleSlot } from "@/lib/api";
import { V2, type V2State } from "./ProposalFlowV2";

interface Props {
  state: V2State;
  updateState: (patch: Partial<V2State>) => void;
  token: string;
  onNext: () => void;
  onBack: () => void;
}

export default function ScheduleStep({ state, updateState, onNext, onBack }: Props) {
  const today = new Date();
  const [datesMonth, setDatesMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );
  const [availableDates, setAvailableDates] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDates = useCallback(async (month: string) => {
    setLoading(true);
    try {
      const slots = await api.getAvailableDates(month);
      setAvailableDates(slots);
    } catch {
      setAvailableDates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDates(datesMonth);
  }, [datesMonth, fetchDates]);

  const [calYear, calMonthNum] = datesMonth.split("-").map(Number);
  const firstDayOfMonth = new Date(calYear, calMonthNum - 1, 1).getDay();
  const daysInCalMonth = new Date(calYear, calMonthNum, 0).getDate();
  const calCells: (number | null)[] = [
    ...Array(firstDayOfMonth).fill(null),
    ...Array.from({ length: daysInCalMonth }, (_, i) => i + 1),
  ];
  while (calCells.length % 7 !== 0) calCells.push(null);

  const todayISO = today.toISOString().slice(0, 10);
  const dateSlotMap = Object.fromEntries(availableDates.map((s) => [s.date, s]));

  const monthLabel = new Date(calYear, calMonthNum - 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const prevMonth = () => {
    const d = new Date(calYear, calMonthNum - 2, 1);
    setDatesMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nextMonth = () => {
    const d = new Date(calYear, calMonthNum, 1);
    setDatesMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleDateTap = (dayNum: number) => {
    const dateStr = `${calYear}-${String(calMonthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    if (dateStr <= todayISO) return;
    const slot = dateSlotMap[dateStr];
    if (slot && slot.spots_remaining <= 0) return;
    updateState({ selectedDate: dateStr });
  };

  const selectedDateDisplay = state.selectedDate
    ? new Date(state.selectedDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div style={{ padding: "0 16px 32px" }}>
      <h2
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: 26,
          fontWeight: 600,
          color: V2.text,
          marginBottom: 8,
        }}
      >
        When works best for you?
      </h2>
      <p style={{ color: V2.textMuted, fontSize: 15, marginBottom: 24, lineHeight: 1.5 }}>
        Pick your preferred start date. We'll confirm availability within 24 hours.
      </p>

      {/* Month nav */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <button
          onClick={prevMonth}
          style={{
            background: "none",
            border: "none",
            color: V2.textMuted,
            fontSize: 20,
            cursor: "pointer",
            padding: 8,
          }}
        >
          &larr;
        </button>
        <span style={{ color: V2.text, fontWeight: 600, fontSize: 16 }}>{monthLabel}</span>
        <button
          onClick={nextMonth}
          style={{
            background: "none",
            border: "none",
            color: V2.textMuted,
            fontSize: 20,
            cursor: "pointer",
            padding: 8,
          }}
        >
          &rarr;
        </button>
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              fontSize: 12,
              color: V2.textDim,
              fontWeight: 600,
              padding: "4px 0",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: V2.textMuted }}>Loading dates...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {calCells.map((day, i) => {
            if (day === null) return <div key={`empty-${i}`} />;
            const dateStr = `${calYear}-${String(calMonthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isPast = dateStr <= todayISO;
            const slot = dateSlotMap[dateStr];
            const isFull = slot && slot.spots_remaining <= 0;
            const isSelected = state.selectedDate === dateStr;
            const isAvailable = !isPast && !isFull;

            return (
              <button
                key={dateStr}
                onClick={() => isAvailable && handleDateTap(day)}
                disabled={!isAvailable}
                style={{
                  aspectRatio: "1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  border: isSelected ? `2px solid ${V2.accent}` : `1px solid ${V2.surfaceBorder}`,
                  background: isSelected ? V2.accent + "20" : V2.surface,
                  color: isPast || isFull ? V2.textDim : isSelected ? V2.accent : V2.text,
                  fontSize: 14,
                  fontWeight: isSelected ? 700 : 500,
                  cursor: isAvailable ? "pointer" : "not-allowed",
                  opacity: isPast || isFull ? 0.4 : 1,
                  transition: "all 200ms ease",
                }}
              >
                {day}
              </button>
            );
          })}
        </div>
      )}

      {/* Selected date chip */}
      {selectedDateDisplay && (
        <div
          style={{
            marginTop: 20,
            padding: "12px 16px",
            borderRadius: 12,
            background: V2.accent + "15",
            border: `1px solid ${V2.accent}40`,
            color: V2.accent,
            fontSize: 15,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          {selectedDateDisplay}
        </div>
      )}

      {/* Continue button */}
      <button
        onClick={onNext}
        disabled={!state.selectedDate}
        style={{
          marginTop: 24,
          width: "100%",
          padding: "14px 0",
          borderRadius: 12,
          border: "none",
          background: state.selectedDate ? V2.accent : V2.textDim,
          color: state.selectedDate ? "#0A0A0F" : V2.textMuted,
          fontSize: 16,
          fontWeight: 700,
          cursor: state.selectedDate ? "pointer" : "not-allowed",
          transition: "all 200ms ease",
        }}
      >
        Continue &rarr;
      </button>
    </div>
  );
}
