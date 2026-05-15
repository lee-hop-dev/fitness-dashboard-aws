/**
 * Training OS — Multi-channel stream chart with synchronised scrubber.
 *
 * Renders 5 time-series channels (power, heart rate, cadence, speed,
 * elevation) stacked vertically, with a shared cursor that scrubs all
 * channels in lockstep. Below the channels: a TSS intensity heat band
 * + invisible range input that drives cursor position.
 *
 * Usage:
 *
 *   import { initStreamChart } from "/js/stream-chart.js";
 *
 *   initStreamChart(document.getElementById("stream"), {
 *     streams: activityData.streams,    // ActivityStreams shape
 *     durationSec: activityData.activity.durationMoving,
 *     onScrub: (idx, sample) => {}      // optional
 *   });
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const CHANNELS = [
  { key: "power",     label: "POWER",       unit: "W",    color: "var(--accent)",   height: 110, peak: true },
  { key: "heartRate", label: "HEART RATE",  unit: "bpm",  color: "var(--accent-2)", height: 78 },
  { key: "cadence",   label: "CADENCE",     unit: "rpm",  color: "var(--accent-3)", height: 64 },
  { key: "speed",     label: "SPEED",       unit: "km/h", color: "var(--accent-4)", height: 64 },
  { key: "elevation", label: "ELEVATION",   unit: "m",    color: "var(--fg-3)",     height: 56 },
];

const LEFT_RAIL = 56;

export function initStreamChart(element, options) {
  const { streams, durationSec, onScrub } = options;
  const N = streams.time.length;
  let cursor = 0.42;
  let width = 0;

  element.classList.add("card");
  element.style.padding = "0";
  element.style.overflow = "hidden";

  element.innerHTML = `
    <div class="row ai-c jc-sb" style="padding:12px 16px;border-bottom:1px solid var(--line)">
      <div class="row ai-c gap-12">
        <h3 style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:var(--fg-2)">Workout stream</h3>
        <span class="meta dim">${N.toLocaleString()} samples · 1 Hz</span>
      </div>
      <div class="seg" data-stream-filter>
        <button data-filter="all" class="on">All</button>
        <button data-filter="power">Power</button>
        <button data-filter="hr">HR</button>
        <button data-filter="zones">Zones</button>
      </div>
    </div>
    <div style="padding:14px 16px 6px">
      <div class="row ai-c gap-16" data-readouts style="flex-wrap:wrap;margin-bottom:8px"></div>
      <div data-channels></div>
      <div data-scrubber style="position:relative;margin:6px 0 8px;height:32px">
        <div data-heatband style="position:absolute;top:4px;left:0;right:0;height:12px;border-radius:6px;overflow:hidden;display:flex"></div>
        <input type="range" min="0" max="1" step="0.001" value="${cursor}"
               style="position:absolute;inset:0;width:100%;margin:0;accent-color:var(--accent)" />
        <div data-ticks class="row jc-sb"
             style="position:absolute;top:20px;left:0;right:0;font-family:var(--font-mono);font-size:9px;color:var(--fg-4)"></div>
      </div>
    </div>
  `;

  const readoutsEl = element.querySelector("[data-readouts]");
  const channelsEl = element.querySelector("[data-channels]");
  const heatbandEl = element.querySelector("[data-heatband]");
  const ticksEl    = element.querySelector("[data-ticks]");
  const rangeEl    = element.querySelector('input[type="range"]');

  // Static parts: heatband + ticks
  for (let i = 0; i < 60; i++) {
    const start = Math.floor((i / 60) * N);
    const end = Math.floor(((i + 1) / 60) * N);
    const slice = streams.power.slice(start, end).filter(v => v != null);
    const avg = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
    const intensity = Math.min(1, avg / 350);
    const seg = document.createElement("div");
    seg.style.flex = "1";
    seg.style.background = `color-mix(in oklch, var(--accent) ${intensity * 90}%, var(--bg-2))`;
    heatbandEl.appendChild(seg);
  }
  const tickCount = 8;
  for (let i = 0; i < tickCount; i++) {
    const t = (i / (tickCount - 1)) * durationSec;
    const span = document.createElement("span");
    span.textContent = fmtDuration(t);
    ticksEl.appendChild(span);
  }

  // Channel structure
  const channelHandles = CHANNELS.map(ch => {
    const row = document.createElement("div");
    row.dataset.channel = ch.key;
    row.style.cssText = "position:relative;margin-top:8px;padding-left:" + LEFT_RAIL + "px";

    const rail = document.createElement("div");
    rail.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:52px;display:flex;flex-direction:column;justify-content:space-between;padding:4px 0;font-family:var(--font-mono);font-size:9px;color:var(--fg-4);text-align:right";
    const data = streams[ch.key].filter(v => v != null);
    const min = Math.min(...data);
    const max = Math.max(...data);
    rail.innerHTML = `
      <span>${Math.round(max)} ${ch.unit}</span>
      <span style="color:var(--fg-3)">${ch.label}</span>
      <span>${Math.round(min)}</span>
    `;
    row.appendChild(rail);

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("height", ch.height);
    svg.style.display = "block";
    svg.dataset.channelSvg = ch.key;
    row.appendChild(svg);

    channelsEl.appendChild(row);
    return { row, svg, ch, min, max, data: streams[ch.key] };
  });

  // Readouts row
  const tCell = el("div", { class: "num", style: "color:var(--fg-3);font-size:11px" }, [
    document.createTextNode("T+ "),
    el("span", { "data-t": "" }, [document.createTextNode("0:00")]),
  ]);
  Object.assign(tCell.style, { color: "var(--fg-3)" });
  readoutsEl.appendChild(tCell);
  CHANNELS.forEach(ch => {
    const cell = el("div", { class: "row ai-c gap-8" }, [
      el("i", { style: `width:6px;height:6px;border-radius:50%;background:${ch.color};display:inline-block` }),
      el("span", { class: "up dim", style: "font-size:10px" }, [document.createTextNode(ch.label)]),
      el("span", { class: "num", "data-readout": ch.key, style: `color:${ch.color};font-size:13px` }, [document.createTextNode("—")]),
    ]);
    readoutsEl.appendChild(cell);
  });

  // Resize → redraw all channel SVGs
  function relayout() {
    const w = element.querySelector("[data-channels]").clientWidth || element.clientWidth;
    if (!w || w === width) return;
    width = w;
    channelHandles.forEach(drawChannel);
    updateCursor();
  }

  function drawChannel(h) {
    const svgW = width - LEFT_RAIL;
    const svgH = h.ch.height;
    h.svg.setAttribute("width", svgW);
    h.svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
    while (h.svg.firstChild) h.svg.removeChild(h.svg.firstChild);

    const min = h.min, max = h.max;
    const lo = min - (max - min) * 0.05;
    const hi = max + (max - min) * 0.10;
    const data = h.data;

    const step = Math.max(1, Math.floor(data.length / 600));
    const ds = [];
    for (let i = 0; i < data.length; i += step) {
      if (data[i] != null) ds.push([i, data[i]]);
    }
    const xToPx = i => (i / Math.max(1, data.length - 1)) * svgW;
    const yToPx = v => 6 + (svgH - 12) - ((v - lo) / ((hi - lo) || 1)) * (svgH - 12);

    const lineD = ds.map(([i, v], k) => `${k === 0 ? "M" : "L"}${xToPx(i)},${yToPx(v)}`).join(" ");
    const lastX = xToPx(ds.length ? ds[ds.length - 1][0] : 0);

    // gradient
    const defs = document.createElementNS(SVG_NS, "defs");
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    const gid = `g-${h.ch.key}`;
    grad.setAttribute("id", gid);
    grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
    const s1 = document.createElementNS(SVG_NS, "stop");
    s1.setAttribute("offset", "0%"); s1.setAttribute("stop-color", h.ch.color); s1.setAttribute("stop-opacity", "0.35");
    const s2 = document.createElementNS(SVG_NS, "stop");
    s2.setAttribute("offset", "100%"); s2.setAttribute("stop-color", h.ch.color); s2.setAttribute("stop-opacity", "0");
    grad.appendChild(s1); grad.appendChild(s2);
    defs.appendChild(grad);
    h.svg.appendChild(defs);

    // baseline
    appendLine(h.svg, 0, svgW, svgH - 4, svgH - 4, "var(--line)", 1);

    // area
    const areaD = lineD + ` L${lastX},${svgH - 4} L${xToPx(0)},${svgH - 4} Z`;
    appendPath(h.svg, areaD, `url(#${gid})`, null, 0);

    // line
    const path = appendPath(h.svg, lineD, "none", h.ch.color, 1.3);
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");

    // cursor placeholders (drawn last, updated separately)
    const cursorLine = document.createElementNS(SVG_NS, "line");
    cursorLine.setAttribute("stroke", "var(--fg)");
    cursorLine.setAttribute("stroke-width", "1");
    cursorLine.setAttribute("stroke-dasharray", "2 2");
    cursorLine.setAttribute("opacity", "0.6");
    cursorLine.setAttribute("y1", "0");
    cursorLine.setAttribute("y2", svgH);
    cursorLine.dataset.cursor = "line";
    h.svg.appendChild(cursorLine);

    const cursorDot = document.createElementNS(SVG_NS, "circle");
    cursorDot.setAttribute("r", "3");
    cursorDot.setAttribute("fill", h.ch.color);
    cursorDot.setAttribute("stroke", "var(--bg-1)");
    cursorDot.setAttribute("stroke-width", "1.5");
    cursorDot.dataset.cursor = "dot";
    h.svg.appendChild(cursorDot);

    h._yToPx = yToPx;
    h._xToPx = xToPx;
  }

  function updateCursor() {
    if (!width) return;
    const idx = Math.min(N - 1, Math.max(0, Math.floor(cursor * (N - 1))));
    const cursorX = cursor * (width - LEFT_RAIL);

    channelHandles.forEach(h => {
      const v = h.data[idx];
      const line = h.svg.querySelector('[data-cursor="line"]');
      const dot  = h.svg.querySelector('[data-cursor="dot"]');
      if (!line || !dot) return;
      line.setAttribute("x1", cursorX);
      line.setAttribute("x2", cursorX);
      dot.setAttribute("cx", cursorX);
      if (v == null) {
        dot.setAttribute("opacity", "0");
      } else {
        dot.setAttribute("opacity", "1");
        dot.setAttribute("cy", h._yToPx(v));
      }
      const readout = element.querySelector(`[data-readout="${h.ch.key}"]`);
      if (readout) readout.textContent = v == null ? "—" : `${Math.round(v)} ${h.ch.unit}`;
    });

    const tEl = element.querySelector('[data-t]');
    if (tEl) tEl.textContent = fmtDuration(streams.time[idx] || (cursor * durationSec));

    if (typeof onScrub === "function") {
      const sample = {};
      CHANNELS.forEach(ch => { sample[ch.key] = streams[ch.key][idx]; });
      sample.time = streams.time[idx];
      onScrub(idx, sample);
    }
  }

  rangeEl.addEventListener("input", (e) => {
    cursor = parseFloat(e.target.value);
    updateCursor();
  });

  // Filter buttons (visual toggles for now; consumer can extend behaviour)
  element.querySelectorAll("[data-stream-filter] button").forEach(btn => {
    btn.addEventListener("click", () => {
      element.querySelectorAll("[data-stream-filter] button").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      const f = btn.dataset.filter;
      channelHandles.forEach(h => {
        const visible = f === "all"
          || (f === "power" && h.ch.key === "power")
          || (f === "hr" && h.ch.key === "heartRate")
          || (f === "zones" && (h.ch.key === "power" || h.ch.key === "heartRate"));
        h.row.style.display = visible ? "" : "none";
      });
    });
  });

  // Watch container width
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(relayout);
    ro.observe(element);
  } else {
    window.addEventListener("resize", relayout);
  }
  relayout();

  return {
    setCursor(v) {
      cursor = Math.max(0, Math.min(1, v));
      rangeEl.value = cursor;
      updateCursor();
    },
    getCursor() { return cursor; },
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

function fmtDuration(secs) {
  if (secs == null || isNaN(secs)) return "0:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
    : `${m}:${String(s).padStart(2,"0")}`;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "style") node.style.cssText = v;
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  children.forEach(c => node.appendChild(c));
  return node;
}

function appendLine(svg, x1, x2, y1, y2, stroke, width) {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", x1);
  l.setAttribute("x2", x2);
  l.setAttribute("y1", y1);
  l.setAttribute("y2", y2);
  l.setAttribute("stroke", stroke);
  l.setAttribute("stroke-width", width);
  svg.appendChild(l);
  return l;
}

function appendPath(svg, d, fill, stroke, strokeWidth) {
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", d);
  if (fill)   p.setAttribute("fill", fill); else p.setAttribute("fill", "none");
  if (stroke) p.setAttribute("stroke", stroke);
  if (strokeWidth) p.setAttribute("stroke-width", strokeWidth);
  svg.appendChild(p);
  return p;
}
