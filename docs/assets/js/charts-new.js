/**
 * Training OS — SVG chart primitives (vanilla, framework-free)
 *
 * Five render functions and a measure helper. Each function takes an
 * element + an options object, builds SVG, and re-renders on resize.
 *
 * Drop this file into /public/js/charts.js and import as:
 *   import { renderRing, renderLineChart, ... } from "/js/charts.js";
 *
 * All visual constants reference CSS custom properties from tokens.css.
 * If you change the design tokens, you don't need to touch this file.
 *
 * No dependencies.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/* ─────────────────────────────────────────────────────────────────────
 * Internals
 * ─────────────────────────────────────────────────────────────────── */

function svgEl(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Cheap unique id per call site — avoids gradient id collisions. */
let __uid = 0;
const uid = () => `tos-${++__uid}`;

/**
 * Observe a container's width; calls `render(width)` whenever it changes.
 * Returns a teardown function.
 */
function observeWidth(el, render) {
  let prev = 0;
  const measure = () => {
    const w = el.clientWidth;
    if (w === prev) return;
    prev = w;
    render(w);
  };
  measure();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }
  window.addEventListener("resize", measure);
  return () => window.removeEventListener("resize", measure);
}

/* ─────────────────────────────────────────────────────────────────────
 * Path builders (pure)
 * ─────────────────────────────────────────────────────────────────── */

function linePath(arr, w, h, padTop, padBottom, lo, hi) {
  const innerH = h - padTop - padBottom;
  const range = hi - lo || 1;
  return arr.map((v, i) => {
    const x = (i / Math.max(1, arr.length - 1)) * w;
    const y = padTop + innerH - ((v - lo) / range) * innerH;
    return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function areaPath(arr, w, h, padTop, padBottom, lo, hi) {
  return `${linePath(arr, w, h, padTop, padBottom, lo, hi)} L${w},${h - padBottom} L0,${h - padBottom} Z`;
}

/* ─────────────────────────────────────────────────────────────────────
 * renderRing — single-value progress arc
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Render a circular progress ring with a centered label.
 *
 * @param {HTMLElement} element  Host element (any block element).
 * @param {object}      options
 * @param {number}      options.value
 * @param {number}      [options.max=100]
 * @param {number}      [options.size=160]
 * @param {number}      [options.stroke=10]
 * @param {string}      [options.color="var(--accent)"]
 * @param {string}      [options.track="var(--bg-3)"]
 * @param {string|number} options.label       Big text in the center.
 * @param {string}      options.sub           Small caption under the label.
 */
export function renderRing(element, opts) {
  const {
    value, max = 100, size = 160, stroke = 10,
    color = "var(--accent)", track = "var(--bg-3)",
    label, sub,
  } = opts;

  clear(element);
  element.classList.add("ring-wrap");
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  element.style.position = "relative";
  element.style.display = "grid";
  element.style.placeItems = "center";

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const dash = c * pct;

  const svg = svgEl("svg", { width: size, height: size });
  svg.appendChild(svgEl("circle", {
    cx: size/2, cy: size/2, r, stroke: track, "stroke-width": stroke, fill: "none",
  }));
  const arc = svgEl("circle", {
    cx: size/2, cy: size/2, r, stroke: color, "stroke-width": stroke, fill: "none",
    "stroke-linecap": "round",
    "stroke-dasharray": `${dash} ${c}`,
    transform: `rotate(-90 ${size/2} ${size/2})`,
  });
  arc.style.filter = `drop-shadow(0 0 6px ${color})`;
  arc.style.transition = "stroke-dasharray 1.2s cubic-bezier(.2,.8,.2,1)";
  svg.appendChild(arc);
  element.appendChild(svg);

  const center = document.createElement("div");
  center.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;text-align:center";
  center.innerHTML = `<div>
    <div class="num" style="font-size:36px;letter-spacing:-0.02em;line-height:1;color:var(--fg)">${label}</div>
    <div style="font-size:10.5px;color:var(--fg-3);text-transform:uppercase;letter-spacing:0.1em;margin-top:4px">${sub ?? ""}</div>
  </div>`;
  element.appendChild(center);
}

/* ─────────────────────────────────────────────────────────────────────
 * renderSparkline — compact area/line chart, no axes
 * ─────────────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} element  Host element. Width auto, height = options.height.
 * @param {object}      options
 * @param {number[]}    options.data
 * @param {string}      [options.color="var(--accent)"]
 * @param {boolean}     [options.fill=true]
 * @param {number}      [options.height=40]
 * @param {boolean}     [options.animate=true]
 * @param {number}      [options.strokeWidth=1.5]
 */
export function renderSparkline(element, opts) {
  const {
    data, color = "var(--accent)", fill = true,
    height = 40, animate = true, strokeWidth = 1.5,
  } = opts;

  element.style.display = "block";
  element.style.height = `${height}px`;

  const gid = uid();
  return observeWidth(element, (w) => {
    if (!w) return;
    clear(element);
    const min = Math.min(...data);
    const max = Math.max(...data);
    const svg = svgEl("svg", {
      class: "spark",
      style: `height:${height}px;width:100%`,
      viewBox: `0 0 ${w} ${height}`,
      preserveAspectRatio: "none",
    });

    if (fill) {
      const defs = svgEl("defs");
      const grad = svgEl("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(svgEl("stop", { offset: "0%",   "stop-color": color, "stop-opacity": "0.35" }));
      grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0" }));
      defs.appendChild(grad);
      svg.appendChild(defs);
      svg.appendChild(svgEl("path", { d: areaPath(data, w, height, 3, 3, min, max), fill: `url(#${gid})` }));
    }
    const path = svgEl("path", {
      d: linePath(data, w, height, 3, 3, min, max),
      fill: "none", stroke: color, "stroke-width": strokeWidth,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    });
    if (animate) {
      path.setAttribute("class", "draw-path");
      path.style.setProperty("--len", 1200);
    }
    svg.appendChild(path);
    element.appendChild(svg);
  });
}

/* ─────────────────────────────────────────────────────────────────────
 * renderLineChart — multi-series with axes + grid
 * ─────────────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} element
 * @param {object}      options
 * @param {Array<{key:string,data:number[],color:string,fill?:boolean,fillOpacity?:number,strokeWidth?:number,dashed?:boolean}>} options.series
 * @param {number}      [options.height=220]
 * @param {{top:number,right:number,bottom:number,left:number}} [options.padding]
 * @param {number}      [options.yTicks=4]
 * @param {string[]}    [options.xLabels=[]]
 * @param {(v:number)=>string} [options.formatY]
 * @param {boolean}     [options.zeroLine=false]
 * @param {boolean}     [options.animate=true]
 */
export function renderLineChart(element, opts) {
  const {
    series, height = 220,
    padding = { top: 12, right: 14, bottom: 22, left: 36 },
    yTicks = 4, xLabels = [],
    formatY = (v) => v.toFixed(0),
    zeroLine = false, animate = true,
  } = opts;

  element.style.width = "100%";
  element.style.height = `${height}px`;

  if (!series.length) return () => {};

  return observeWidth(element, (w) => {
    if (!w) return;
    clear(element);

    const allVals = series.flatMap(s => s.data);
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const lo = min - (max - min) * 0.05;
    const hi = max + (max - min) * 0.05;

    const innerW = Math.max(1, w - padding.left - padding.right);
    const innerH = Math.max(1, height - padding.top - padding.bottom);
    const yToPx = v => padding.top + innerH - ((v - lo) / ((hi - lo) || 1)) * innerH;
    const xToPx = (i, n) => padding.left + (i / Math.max(1, n - 1)) * innerW;

    const svg = svgEl("svg", { width: w, height, viewBox: `0 0 ${w} ${height}` });

    // defs (gradients per series)
    const defs = svgEl("defs");
    series.forEach((s, i) => {
      const gid = `${s.key}-${i}`;
      const grad = svgEl("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(svgEl("stop", { offset: "0%",   "stop-color": s.color, "stop-opacity": String(s.fillOpacity ?? 0.22) }));
      grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": s.color, "stop-opacity": "0" }));
      defs.appendChild(grad);
    });
    svg.appendChild(defs);

    // y grid + ticks
    for (let i = 0; i <= yTicks; i++) {
      const v = lo + (hi - lo) * (i / yTicks);
      const y = yToPx(v);
      svg.appendChild(svgEl("line", {
        x1: padding.left, x2: w - padding.right, y1: y, y2: y,
        stroke: "var(--line)", "stroke-width": 1,
      }));
      const t = svgEl("text", {
        x: padding.left - 6, y: y + 3, "text-anchor": "end",
        "font-size": 10, fill: "var(--fg-4)", "font-family": "var(--font-mono)",
      });
      t.textContent = formatY(v);
      svg.appendChild(t);
    }

    if (zeroLine && lo < 0 && hi > 0) {
      svg.appendChild(svgEl("line", {
        x1: padding.left, x2: w - padding.right, y1: yToPx(0), y2: yToPx(0),
        stroke: "var(--line-3)", "stroke-width": 1, "stroke-dasharray": "3 3",
      }));
    }

    // x labels
    xLabels.forEach((lbl, i) => {
      const t = svgEl("text", {
        x: padding.left + (i / Math.max(1, xLabels.length - 1)) * innerW,
        y: height - 4, "text-anchor": "middle",
        "font-size": 10, fill: "var(--fg-4)", "font-family": "var(--font-mono)",
      });
      t.textContent = lbl;
      svg.appendChild(t);
    });

    // series areas (back layer)
    series.forEach((s, i) => {
      if (!s.fill) return;
      const path = s.data
        .map((v, j) => `${j === 0 ? "M" : "L"}${xToPx(j, s.data.length)},${yToPx(v)}`).join(" ")
        + ` L${xToPx(s.data.length - 1, s.data.length)},${yToPx(lo)} L${xToPx(0, s.data.length)},${yToPx(lo)} Z`;
      svg.appendChild(svgEl("path", { d: path, fill: `url(#${s.key}-${i})` }));
    });

    // series lines (front)
    series.forEach((s, i) => {
      const d = s.data.map((v, j) => `${j === 0 ? "M" : "L"}${xToPx(j, s.data.length)},${yToPx(v)}`).join(" ");
      const path = svgEl("path", {
        d, fill: "none", stroke: s.color,
        "stroke-width": s.strokeWidth ?? 1.6,
        "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": s.dashed ? "4 4" : undefined,
      });
      if (animate) {
        path.setAttribute("class", "draw-path");
        path.style.setProperty("--len", 2200);
        path.style.animationDelay = `${i * 0.12}s`;
      }
      svg.appendChild(path);
    });

    element.appendChild(svg);
  });
}

/* ─────────────────────────────────────────────────────────────────────
 * renderBarChart — stacked bars
 * ─────────────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} element
 * @param {object}      options
 * @param {Array<Record<string,number>>} options.data
 * @param {string[]}    options.keys
 * @param {string[]}    options.colors
 * @param {number}      [options.height=200]
 * @param {(d:object,i:number)=>string} [options.xLabel]
 * @param {(v:number)=>string} [options.formatY]
 */
export function renderBarChart(element, opts) {
  const { data, keys, colors, height = 200, xLabel, formatY = v => String(v) } = opts;
  const padding = { top: 8, right: 8, bottom: 22, left: 32 };

  element.style.width = "100%";
  element.style.height = `${height}px`;

  return observeWidth(element, (w) => {
    if (!w) return;
    clear(element);
    const innerW = Math.max(1, w - padding.left - padding.right);
    const innerH = Math.max(1, height - padding.top - padding.bottom);
    const totals = data.map(d => keys.reduce((a, k) => a + (d[k] || 0), 0));
    const max = Math.max(...totals) * 1.08 || 1;
    const bw = innerW / data.length;
    const yToPx = v => padding.top + innerH - (v / max) * innerH;

    const svg = svgEl("svg", { width: w, height });

    // y grid
    [0, 0.25, 0.5, 0.75, 1].forEach(p => {
      const v = max * p;
      svg.appendChild(svgEl("line", {
        x1: padding.left, x2: w - padding.right, y1: yToPx(v), y2: yToPx(v),
        stroke: "var(--line)",
      }));
      const t = svgEl("text", {
        x: padding.left - 6, y: yToPx(v) + 3, "text-anchor": "end",
        "font-size": 10, "font-family": "var(--font-mono)", fill: "var(--fg-4)",
      });
      t.textContent = formatY(v);
      svg.appendChild(t);
    });

    data.forEach((d, i) => {
      let acc = 0;
      const x = padding.left + i * bw + bw * 0.18;
      const bw2 = bw * 0.64;
      keys.forEach((k, ki) => {
        const v = d[k] || 0;
        const h = (v / max) * innerH;
        const y = yToPx(acc + v);
        acc += v;
        const r = svgEl("rect", {
          x, y, width: bw2, height: Math.max(0, h),
          fill: colors[ki],
        });
        r.style.animation = `fadeUp .6s ${i * 0.02}s backwards cubic-bezier(.2,.8,.2,1)`;
        svg.appendChild(r);
      });
      if (xLabel && i % Math.max(1, Math.floor(data.length / 8)) === 0) {
        const t = svgEl("text", {
          x: x + bw2/2, y: height - 6, "text-anchor": "middle",
          "font-size": 10, "font-family": "var(--font-mono)", fill: "var(--fg-4)",
        });
        t.textContent = xLabel(d, i);
        svg.appendChild(t);
      }
    });

    element.appendChild(svg);
  });
}

/* ─────────────────────────────────────────────────────────────────────
 * renderPowerCurve — log-x peak power chart
 * ─────────────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} element
 * @param {object}      options
 * @param {Array<{t:number,w:number,prev?:number}>} options.data  Duration buckets in seconds.
 * @param {number}      [options.height=180]
 */
export function renderPowerCurve(element, opts) {
  const { data, height = 180 } = opts;
  const padding = { top: 14, right: 14, bottom: 22, left: 36 };

  element.style.width = "100%";
  element.style.height = `${height}px`;

  return observeWidth(element, (w) => {
    if (!w) return;
    clear(element);
    const innerW = Math.max(1, w - padding.left - padding.right);
    const innerH = Math.max(1, height - padding.top - padding.bottom);

    const tMin = Math.log10(data[0].t);
    const tMax = Math.log10(data[data.length - 1].t);
    const wMax = Math.max(...data.map(d => d.w)) * 1.05;
    const wMin = Math.min(...data.map(d => d.prev ?? d.w)) * 0.9;

    const xFor = t => padding.left + ((Math.log10(t) - tMin) / (tMax - tMin)) * innerW;
    const yFor = v => padding.top + innerH - ((v - wMin) / (wMax - wMin)) * innerH;

    const svg = svgEl("svg", { width: w, height });
    const defs = svgEl("defs");
    const grad = svgEl("linearGradient", { id: "pc-grad", x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(svgEl("stop", { offset: "0%",   "stop-color": "var(--accent)", "stop-opacity": "0.32" }));
    grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "var(--accent)", "stop-opacity": "0" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    const ticksW = 4;
    for (let i = 0; i <= ticksW; i++) {
      const v = wMin + (wMax - wMin) * (i / ticksW);
      svg.appendChild(svgEl("line", {
        x1: padding.left, x2: w - padding.right, y1: yFor(v), y2: yFor(v),
        stroke: "var(--line)",
      }));
      const t = svgEl("text", {
        x: padding.left - 6, y: yFor(v) + 3, "text-anchor": "end",
        "font-size": 10, "font-family": "var(--font-mono)", fill: "var(--fg-4)",
      });
      t.textContent = Math.round(v);
      svg.appendChild(t);
    }

    const tickT = [5, 60, 300, 1200, 3600];
    const labelT = t => t < 60 ? `${t}s` : t < 3600 ? `${(t/60)|0}m` : `${(t/3600)|0}h`;
    tickT.forEach(t => {
      const tx = svgEl("text", {
        x: xFor(t), y: height - 6, "text-anchor": "middle",
        "font-size": 10, "font-family": "var(--font-mono)", fill: "var(--fg-4)",
      });
      tx.textContent = labelT(t);
      svg.appendChild(tx);
    });

    // area
    const areaD = data.map((d, i) => `${i === 0 ? "M" : "L"}${xFor(d.t)},${yFor(d.w)}`).join(" ")
      + ` L${xFor(data[data.length - 1].t)},${yFor(wMin)} L${xFor(data[0].t)},${yFor(wMin)} Z`;
    svg.appendChild(svgEl("path", { d: areaD, fill: "url(#pc-grad)" }));

    // previous (dashed)
    if (data.some(d => d.prev != null)) {
      const prevD = data.map((d, i) => `${i === 0 ? "M" : "L"}${xFor(d.t)},${yFor(d.prev ?? d.w)}`).join(" ");
      svg.appendChild(svgEl("path", {
        d: prevD, fill: "none", stroke: "var(--fg-4)",
        "stroke-width": 1.2, "stroke-dasharray": "3 3",
      }));
    }

    // current
    const curD = data.map((d, i) => `${i === 0 ? "M" : "L"}${xFor(d.t)},${yFor(d.w)}`).join(" ");
    const curPath = svgEl("path", {
      d: curD, fill: "none", stroke: "var(--accent)", "stroke-width": 1.8,
      "stroke-linejoin": "round", "stroke-linecap": "round",
      class: "draw-path",
    });
    curPath.style.setProperty("--len", 1600);
    curPath.style.filter = "drop-shadow(0 0 6px color-mix(in oklch, var(--accent) 50%, transparent))";
    svg.appendChild(curPath);

    // dots
    data.forEach((d, i) => {
      if (i % 2 !== 0) return;
      svg.appendChild(svgEl("circle", {
        cx: xFor(d.t), cy: yFor(d.w), r: 2.5,
        fill: "var(--bg-1)", stroke: "var(--accent)", "stroke-width": 1.2,
      }));
    });

    element.appendChild(svg);
  });
}
