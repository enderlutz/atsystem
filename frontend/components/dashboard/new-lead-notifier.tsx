"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

const POLL_INTERVAL = 30_000; // 30 seconds

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Two-tone chime: distinct and pleasant
    const freqs = [880, 1108.73]; // A5, C#6 — major third
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, now + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.5);
    });

    // Clean up after sounds finish
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // AudioContext may not be available — silently skip
  }
}

export function NewLeadNotifier() {
  const lastLeadIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    const check = async () => {
      try {
        const latest = await api.getLatestLead();
        if (!latest.id) return;

        if (!initializedRef.current) {
          // First load — just record the current latest, don't notify
          lastLeadIdRef.current = latest.id;
          initializedRef.current = true;
          return;
        }

        if (latest.id !== lastLeadIdRef.current) {
          lastLeadIdRef.current = latest.id;
          const name = latest.contact_name || "Unknown";
          playNotificationSound();
          toast("New Lead", {
            description: `${name} just came in from GHL`,
            action: {
              label: "View",
              onClick: () => {
                window.location.href = `/leads/${latest.id}`;
              },
            },
            duration: 10000,
          });
        }
      } catch {
        // Silently ignore polling errors
      }
    };

    check();
    timer = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return null; // Render nothing — side-effect only
}
