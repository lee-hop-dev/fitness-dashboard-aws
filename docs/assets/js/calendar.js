/**
 * Training OS — Month calendar widget (vanilla)
 *
 * Renders a Monday-first 6×7 month grid with workout pills.
 * Handles prev/next month navigation, "today" click, and emits
 * day-click events. No dependencies.
 *
 * Usage:
 *
 *   import { initCalendar } from "/js/calendar.js";
 *
 *   initCalendar(document.getElementById("calendar"), {
 *     monthStart: "2026-05-01",         // ISO date; first of the month
 *     schedule: {
 *       "2026-05-13": { sport: "cycling", title: "VO2 5x4'", tss: 138, state: "today" },
 *       "2026-05-14": { sport: "running", title: "Threshold", tss: 92,  state: "planned" },
 *       ...
 *     },
 *     onDayClick: (isoDate) => location.href = `/day/${isoDate}`,
 *     onMonthChange: (newMonthIso) => fetchSchedule(newMonthIso),
 *   });
 *
 * If onMonthChange is omitted, the calendar will just re-render with
 * whatever schedule is already in memory (showing prev/next month
 * structure but empty pills).
 */

const SPORT_GLYPH = {
  cycling: "⬡",
  running: "▷",
  rowing:  "⊕",
  cardio:  "◎",
  other:   "○",
};
const SPORT_COLOR = {
  cycling: "var(--accent)",
  running: "var(--accent-2)",
  rowing:  "var(--accent-3)",
  cardio:  "var(--accent-4)",
  other:   "var(--fg-4)",
};
const SPORT_SHORT = {
  cycling: "RIDE",
  running: "RUN",
  rowing:  "ROW",
  cardio:  "CARDIO",
  other:   "OTHER",
};

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const parseIso = (s) => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };

export function initCalendar(element, options) {
  let cursor = options.monthStart ? parseIso(options.monthStart) : (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let schedule = options.schedule || {};
  const today = new Date();
  today.setHours(0,0,0,0);

  function render() {
    element.classList.add("card");
    element.style.padding = "0";
    element.style.overflow = "hidden";

    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const monthName = cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstCol = (firstDay.getDay() + 6) % 7; // Mon = 0
    const daysInMonth = lastDay.getDate();

    let monthDone = 0, monthPlanned = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoDay(new Date(year, month, d));
      const w = schedule[iso];
      if (!w) continue;
      if (w.state === "done") monthDone += w.tss || 0;
      else if (w.state === "planned" || w.state === "today") monthPlanned += w.tss || 0;
    }

    // Build markup as a string for performance, then attach handlers.
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dayNum = i - firstCol + 1;
      const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
      const date = inMonth ? new Date(year, month, dayNum) : null;
      const iso = date ? isoDay(date) : null;
      const w = date ? schedule[iso] : null;
      const isToday = date && date.getTime() === today.getTime();
      const isWeekend = i % 7 >= 5;

      const bg = !inMonth
        ? "color-mix(in oklch, var(--bg-2) 50%, transparent)"
        : isToday
          ? "color-mix(in oklch, var(--accent) 8%, transparent)"
          : isWeekend
            ? "color-mix(in oklch, var(--bg-2) 60%, transparent)"
            : "transparent";

      const borderL = i % 7 !== 0 ? "1px solid var(--line)" : "0";
      const borderT = i >= 7 ? "1px solid var(--line)" : "0";

      cells.push(`
        <div class="cal-cell" ${inMonth ? `data-iso="${iso}"` : ""} ${isToday ? 'data-today="1"' : ""}
             style="position:relative;padding:10px;min-height:96px;
                    border-left:${borderL};border-top:${borderT};
                    background:${bg};
                    cursor:${inMonth ? "pointer" : "default"};
                    transition:background 180ms">
          ${inMonth ? `
            <div class="row ai-c jc-sb" style="margin-bottom:6px">
              <span class="num" style="font-size:13px;color:${isToday ? "var(--accent)" : "var(--fg-2)"};font-weight:${isToday ? 600 : 400}">${dayNum}</span>
              ${isToday ? `<span class="dot" style="width:5px;height:5px"></span>` : ""}
              ${w && w.state === "done" ? `<span style="color:var(--accent);font-size:10px;font-family:var(--font-mono)">✓</span>` : ""}
            </div>
            ${renderPill(w)}
          ` : ""}
        </div>
      `);
    }

    element.innerHTML = `
      <div class="row ai-c jc-sb" style="padding:14px 16px;border-bottom:1px solid var(--line)">
        <div class="row ai-c gap-12">
          <h3 style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:var(--fg-2)">Training calendar</h3>
          <span class="badge dim">${monthName}</span>
          <span class="badge lime">${monthDone} TSS done</span>
          <span class="badge dim">${monthPlanned} TSS planned</span>
        </div>
        <div class="row ai-c gap-8">
          <button class="btn" data-action="prev">‹</button>
          <button class="btn" data-action="today">Today</button>
          <button class="btn" data-action="next">›</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--line)">
        ${["MON","TUE","WED","THU","FRI","SAT","SUN"].map((d, i) =>
          `<div class="up dim" style="padding:8px 12px;font-size:10px;color:var(--fg-4);border-left:${i>0 ? "1px solid var(--line)" : "0"}">${d}</div>`
        ).join("")}
      </div>

      <div style="display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:minmax(96px,auto)">
        ${cells.join("")}
      </div>

      <div class="row ai-c jc-sb" style="padding:10px 16px;border-top:1px solid var(--line);font-family:var(--font-mono);font-size:11px;color:var(--fg-3)">
        <div class="row ai-c gap-16">
          ${["cycling","running","rowing","cardio"].map(s =>
            `<span><i style="width:8px;height:8px;border-radius:2px;background:${SPORT_COLOR[s]};display:inline-block;margin-right:6px;vertical-align:middle"></i>${SPORT_SHORT[s]}</span>`
          ).join("")}
        </div>
        <span class="dim">Drag workouts to reschedule · Click a day to edit</span>
      </div>
    `;

    // Bind handlers
    element.querySelector('[data-action="prev"]').addEventListener("click", () => goto(new Date(year, month - 1, 1)));
    element.querySelector('[data-action="next"]').addEventListener("click", () => goto(new Date(year, month + 1, 1)));
    element.querySelector('[data-action="today"]').addEventListener("click", () => goto(new Date(today.getFullYear(), today.getMonth(), 1)));

    element.querySelectorAll(".cal-cell[data-iso]").forEach(cell => {
      cell.addEventListener("click", () => {
        if (typeof options.onDayClick === "function") options.onDayClick(cell.dataset.iso);
      });
      // hover affordance
      const baseBg = cell.style.background;
      cell.addEventListener("mouseenter", () => {
        cell.style.background = `color-mix(in oklch, var(--fg) 4%, ${baseBg === "transparent" ? "transparent" : baseBg})`;
      });
      cell.addEventListener("mouseleave", () => { cell.style.background = baseBg; });
    });
  }

  function renderPill(w) {
    if (!w) return "";
    if (!w.sport || w.sport === "rest") {
      return `<div class="dim" style="font-size:10.5px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">Rest day</div>`;
    }
    const c = SPORT_COLOR[w.sport] || "var(--fg-4)";
    const done = w.state === "done";
    return `
      <div style="padding:6px 8px;border-radius:6px;
                  background:color-mix(in oklch, ${c} ${done ? 8 : 14}%, var(--bg-2));
                  border-left:2px solid ${c};
                  opacity:${done ? 0.65 : 1}">
        <div class="row ai-c gap-8" style="margin-bottom:2px">
          <span class="num" style="font-size:11px;color:${c}">${SPORT_GLYPH[w.sport] || "·"}</span>
          <span class="up dim" style="font-size:9px;color:${c}">${SPORT_SHORT[w.sport] || ""}</span>
        </div>
        <div style="font-size:11.5px;color:var(--fg);line-height:1.25;font-weight:500">${escape(w.title || "")}</div>
        ${w.tss != null ? `<div class="num dim" style="font-size:10px;margin-top:2px">${w.tss} TSS</div>` : ""}
      </div>
    `;
  }

  function goto(newCursor) {
    cursor = newCursor;
    if (typeof options.onMonthChange === "function") {
      const result = options.onMonthChange(isoDay(cursor));
      // If consumer returns a promise of new schedule, apply when resolved.
      if (result && typeof result.then === "function") {
        result.then(newSchedule => {
          if (newSchedule) schedule = newSchedule;
          render();
        });
        return;
      }
    }
    render();
  }

  function setSchedule(next) {
    schedule = next || {};
    render();
  }

  render();
  return { setSchedule, goto, getCursor: () => isoDay(cursor) };
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
