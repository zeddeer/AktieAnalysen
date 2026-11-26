(() => {
  "use strict";

  const app = document.getElementById("app");
  const stamp = document.getElementById("stamp");
  let DATA = null;
  let PRICES = { quotes: {} };
  let SHORTS = null;
  let NOTES = null;
  let range = "6M";

  const STANCE = { positiv: "Positiv", neutral: "Neutral", negativ: "Negativ" };
  const RANGES = { "1M": 31, "3M": 92, "6M": 183, "1Å": 366 };

  // ---------- helpers ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const nf = (v, d = 2) =>
    v == null || isNaN(v) ? "—" : Number(v).toLocaleString("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d });

  const pct = (v) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v)) + " %");
  const cls = (v) => (v == null || v === 0 ? "flat" : v > 0 ? "up" : "down");

  const today = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const parseDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const daysUntil = (s) => Math.round((parseDate(s) - today()) / 86400000);
  const fmtDate = (s, opts = { day: "numeric", month: "short", year: "numeric" }) =>
    s ? parseDate(s).toLocaleDateString("sv-SE", opts) : "";
  const inDays = (n) => (n === 0 ? "idag" : n === 1 ? "imorgon" : n > 0 ? `om ${n} dagar` : `${-n} dagar sedan`);

  const quote = (s) => PRICES.quotes?.[s.yahoo] || null;

  const nextEvent = (s) =>
    (s.events || []).filter((e) => daysUntil(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0] || null;

  const pointsSince = (q, days) => {
    if (!q?.history?.length) return [];
    const cut = new Date(today() - days * 86400000).toISOString().slice(0, 10);
    return q.history.filter(([d]) => d >= cut);
  };

  // ---------- charts ----------
  function sparkline(q) {
    const pts = pointsSince(q, 92);
    if (pts.length < 2) return `<svg class="spark" viewBox="0 0 96 36"></svg>`;
    const vals = pts.map((p) => p[1]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const path = vals
      .map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * 96).toFixed(1)},${(33 - ((v - min) / span) * 30).toFixed(1)}`)
      .join("");
    const color = vals[vals.length - 1] >= vals[0] ? "var(--up)" : "var(--down)";
    return `<svg class="spark" viewBox="0 0 96 36" preserveAspectRatio="none" aria-hidden="true">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function bigChart(s, q) {
    const pts = pointsSince(q, RANGES[range]);
    if (pts.length < 2) return `<p class="empty">Kurshistorik saknas ännu – den hämtas automatiskt efter börsens stängning.</p>`;
    const W = Math.max(280, Math.round((app.clientWidth || 700) - 34)), H = 190, L = 4, R = 46, T = 10, B = 22;
    const vals = pts.map((p) => p[1]);
    const target = s.analysts?.avgTarget;
    let min = Math.min(...vals), max = Math.max(...vals);
    if (target && target < max * 1.6 && target > min * 0.6) { min = Math.min(min, target); max = Math.max(max, target); }
    const pad = (max - min) * 0.08 || 1;
    min -= pad; max += pad;
    const x = (i) => L + (i / (vals.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
    const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = `${line}L${x(vals.length - 1).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
    const up = vals[vals.length - 1] >= vals[0];
    const col = up ? "var(--up)" : "var(--down)";
    const ticks = [0, 0.5, 1].map((f) => min + pad + f * (max - min - 2 * pad));
    const grid = ticks
      .map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>
        <text x="${W - R + 6}" y="${y(v) + 3}">${nf(v, v < 100 ? 2 : 0)}</text>`)
      .join("");
    const tgt =
      target && target >= min && target <= max
        ? `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--brass)" stroke-width="1.5" stroke-dasharray="5 4"/>`
        : "";
    const d0 = pts[0][0], d1 = pts[pts.length - 1][0];
    const chg = (vals[vals.length - 1] / vals[0] - 1) * 100;
    return `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kursutveckling ${range}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${up ? "#3ccf8e" : "#ff5a47"}" stop-opacity="0.22"/>
          <stop offset="1" stop-color="${up ? "#3ccf8e" : "#ff5a47"}" stop-opacity="0"/></linearGradient></defs>
        ${grid}
        <path d="${area}" fill="url(#g)"/>
        <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        ${tgt}
        <text x="${L}" y="${H - 6}">${fmtDate(d0, { day: "numeric", month: "short" })}</text>
        <text x="${W - R}" y="${H - 6}" text-anchor="end">${fmtDate(d1, { day: "numeric", month: "short" })}</text>
      </svg>
      <div class="legend">
        <span>${range}: <b class="num ${cls(chg)}">${pct(chg)}</b></span>
        ${target ? `<span><i></i>Snittriktkurs ${nf(target)} ${esc(s.currency)}</span>` : ""}
      </div>`;
  }

  // ---------- views ----------
  function renderList() {
    const stocks = DATA.stocks;
    app.innerHTML = `
      <div class="overview"><h1>Bevakning</h1><span>${stocks.length} aktier</span></div>
      <div class="cards">${stocks.map(card).join("")}</div>`;
  }

  function card(s) {
    const q = quote(s);
    const ev = nextEvent(s);
    const n = ev ? daysUntil(ev.date) : null;
    return `
      <a class="card" href="#${esc(s.id)}">
        <div class="head"><span class="name">${esc(s.name)}</span><span class="tick">${esc(s.ticker)}</span></div>
        <div class="px">
          <div class="p">${q ? nf(q.price) : "—"} <small class="flat">${esc(s.currency)}</small></div>
          <div class="c ${cls(q?.changePct)}">${q ? pct(q.changePct) : ""}</div>
        </div>
        <div class="thesis">${esc(s.thesis)}</div>
        ${sparkline(q)}
        <div class="meta">
          <span class="chip ${esc(s.stance)}">${esc(STANCE[s.stance] || s.stance)}</span>
          <span>Risk: ${esc(s.risk)}</span>
          ${ev ? `<span class="${n <= 10 ? "soon" : ""}">${esc(ev.label.replace(/ \(.*\)/, ""))} ${inDays(n)}</span>` : ""}
        </div>
      </a>`;
  }

  function renderDetail(s) {
    const q = quote(s);
    const a = s.analysts || {};
    const pos52 = q && q.high52 > q.low52 ? ((q.price - q.low52) / (q.high52 - q.low52)) * 100 : null;
    const upside = q && a.avgTarget ? (a.avgTarget / q.price - 1) * 100 : null;

    app.innerHTML = `
      <a class="back" href="#bevakning">← Bevakning</a>
      <section class="hero">
        <h1>${esc(s.name)}${s.shareClass ? ` <span class="flat">${esc(s.shareClass)}</span>` : ""}</h1>
        <div class="sub">${esc(s.ticker)} · ${esc(s.market)} · ${esc(s.sector)}</div>
        <div class="quote">
          <span class="p">${q ? nf(q.price) : "—"}</span>
          <span class="flat">${esc(s.currency)}</span>
          <span class="c ${cls(q?.changePct)}">${q ? pct(q.changePct) : ""}</span>
          ${q ? `<span class="t">Senaste kurs ${new Date(q.marketTime).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>` : ""}
        </div>
      </section>

      <section class="panel">
        <div class="ranges">${Object.keys(RANGES).map((r) => `<button data-range="${r}" class="${r === range ? "on" : ""}">${r}</button>`).join("")}</div>
        <div id="chart">${bigChart(s, q)}</div>
        ${pos52 != null ? `
        <div class="range52">
          <p class="lbl">52 veckor</p>
          <div class="bar"><span class="dot" style="left:${Math.max(0, Math.min(100, pos52))}%"></span></div>
          <div class="ends"><span>${nf(q.low52)}</span><span>${nf(q.high52)}</span></div>
        </div>` : ""}
      </section>

      <section class="panel">
        <div class="verdict">
          <span class="chip ${esc(s.stance)}">${esc(STANCE[s.stance] || s.stance)}</span>
          <span class="risk">Risk: <b>${esc(s.risk)}</b></span>
        </div>
        <p class="thesis-big">${esc(s.thesis)}</p>
        <p class="summary">${esc(s.summary)}</p>
      </section>

      <section class="panel">
        <p class="lbl">Nyckeltal</p>
        <div class="figs">${(s.keyFigures || []).map((f) => `
          <div class="fig"><div class="k">${esc(f.label)}</div><div class="v">${esc(f.value)}</div>${f.note ? `<div class="n">${esc(f.note)}</div>` : ""}</div>`).join("")}
        </div>
      </section>

      ${s.latestReport ? `
      <section class="panel">
        <p class="lbl">${esc(s.latestReport.title)}<span class="rep-date">${fmtDate(s.latestReport.date)}</span></p>
        <ul class="plain">${s.latestReport.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
      </section>` : ""}

      <div class="twocol stack">
        <section class="panel bull"><p class="lbl">Talar för</p><ul class="plain">${(s.bull || []).map((h) => `<li>${esc(h)}</li>`).join("")}</ul></section>
        <section class="panel bear"><p class="lbl">Talar emot</p><ul class="plain">${(s.bear || []).map((h) => `<li>${esc(h)}</li>`).join("")}</ul></section>
      </div>

      <div class="twocol stack">
        <section class="panel">
          <p class="lbl">Bevaka</p>
          <ul class="plain">${(s.watch || []).map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
        </section>
        <section class="panel">
          <p class="lbl">Kommande</p>
          <ul class="plain">${(s.events || []).map((e) => `<li><span class="num">${fmtDate(e.date)}</span> – ${esc(e.label)} <span class="flat">(${inDays(daysUntil(e.date))})</span></li>`).join("") || "<li>Inget inlagt</li>"}</ul>
        </section>
      </div>

      ${shortHoldersPanel(s)}

      <section class="panel">
        <p class="lbl">Analytiker</p>
        ${a.consensus || a.avgTarget || upside != null ? `
        <div class="consensus">
          ${a.consensus ? `<div>Konsensus<b>${esc(a.consensus)}</b></div>` : ""}
          ${a.avgTarget ? `<div>Snittriktkurs<b>${nf(a.avgTarget)}</b></div>` : ""}
          ${upside != null ? `<div>Potential<b class="${cls(upside)}">${pct(upside)}</b></div>` : ""}
        </div>` : ""}
        ${(a.targets || []).length ? `
        <table class="targets">${a.targets.map((t) => `
          <tr><td class="d">${t.date ? fmtDate(t.date, { day: "numeric", month: "short" }) : "–"}</td><td>${esc(t.bank)} <span class="flat">· ${esc(t.rating)}</span></td><td class="r">${nf(t.target, t.target % 1 ? 1 : 0)}</td></tr>`).join("")}
        </table>` : `<p class="flat" style="margin:0">${esc(a.avgTargetNote || "Inga riktkurser registrerade.")}</p>`}
        ${a.avgTargetNote && (a.avgTarget || (a.targets || []).length) ? `<p class="flat" style="font-size:12px;margin:8px 0 0">${esc(a.avgTargetNote)}</p>` : ""}
      </section>

      <section class="panel">
        <p class="lbl">Analyslogg</p>
        <ul class="timeline">${(s.log || []).slice().sort((x, y) => y.date.localeCompare(x.date)).map((l) => `<li><span class="d">${fmtDate(l.date)}</span>${esc(l.text)}</li>`).join("")}</ul>
      </section>

      <div class="twocol stack">
        <section class="panel links"><p class="lbl">Följ aktien</p>${(s.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>`).join("")}</section>
        <section class="panel links"><p class="lbl">Källor</p>${(s.sources || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>`).join("")}</section>
      </div>`;

    app.querySelectorAll("[data-range]").forEach((b) =>
      b.addEventListener("click", () => {
        range = b.dataset.range;
        app.querySelectorAll("[data-range]").forEach((x) => x.classList.toggle("on", x === b));
        document.getElementById("chart").innerHTML = bigChart(s, q);
      })
    );
  }

  function renderCalendar() {
    const rows = [];
    DATA.stocks.forEach((s) => (s.events || []).forEach((e) => rows.push({ s, e })));
    rows.sort((a, b) => a.e.date.localeCompare(b.e.date));
    const upcoming = rows.filter((r) => daysUntil(r.e.date) >= -7);
    app.innerHTML = `
      <div class="overview"><h1>Kalender</h1><span>Rapporter & händelser</span></div>
      <div class="cal">${upcoming.map(({ s, e }) => {
        const n = daysUntil(e.date);
        const d = parseDate(e.date);
        return `<a href="#${esc(s.id)}" class="${n < 0 ? "past" : ""}">
          <div class="dt"><b>${d.getDate()}</b><span>${d.toLocaleDateString("sv-SE", { month: "short" }).replace(".", "")}</span></div>
          <div class="what"><b>${esc(s.name)}</b><span>${esc(e.label)}</span></div>
          <div class="in ${n >= 0 && n <= 10 ? "soon" : ""}">${inDays(n)}</div></a>`;
      }).join("") || `<p class="empty">Inga kommande händelser.</p>`}</div>`;
  }

  // ---------- blankning ----------
  const pc = (v, d = 2) => (v == null ? "—" : v === 0 ? "<0,5" : nf(v, d));
  const delta = (v) => (!v ? `<span class="flat">±0</span>` : `<span class="${v > 0 ? "down" : "up"}">${v > 0 ? "+" : "−"}${nf(Math.abs(v))}</span>`);

  function shortHoldersPanel(s) {
    const list = SHORTS?.watch?.[s.id];
    if (!list) return "";
    return `
      <section class="panel">
        <p class="lbl">Blankare enligt FI (≥ 0,5 %)<span class="rep-date">${SHORTS.registerDate ? fmtDate(SHORTS.registerDate) : ""}</span></p>
        ${list.length ? `<table class="targets">${list.map((h) => `
          <tr><td class="d">${fmtDate(h.date, { day: "numeric", month: "short", year: "2-digit" })}</td><td>${esc(h.holder)}</td><td class="r">${nf(h.pct)} %</td></tr>`).join("")}</table>`
          : `<p class="flat" style="margin:0">Ingen publik position över 0,5 %.</p>`}
        <p class="flat" style="font-size:12px;margin:8px 0 0"><a href="#blankning">Citadel-analysen →</a></p>
      </section>`;
  }

  function stepChart(p) {
    const W = Math.max(280, Math.round((app.clientWidth || 700) - 34)), H = 170, L = 4, R = 40, T = 8, B = 20;
    const ser = (p.series || []).map(([d, v]) => [parseDate(d), v]);
    const px = (p.price || []).map(([d, v]) => [parseDate(d), v]);
    if (!ser.length) return "";
    const t0 = Math.min(ser[0][0], px.length ? px[0][0] : ser[0][0]);
    const t1 = Math.max(today(), px.length ? px[px.length - 1][0] : 0);
    const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const vmax = Math.max(0.8, ...ser.map((s) => s[1])) * 1.1;
    const y = (v) => T + (1 - v / vmax) * (H - T - B);
    let d = "";
    ser.forEach(([t, v], i) => {
      d += i ? `H${x(t).toFixed(1)}V${y(v).toFixed(1)}` : `M${x(t).toFixed(1)},${y(v).toFixed(1)}`;
    });
    d += `H${x(t1).toFixed(1)}`;
    let price = "";
    if (px.length > 1) {
      const lo = Math.min(...px.map((q) => q[1])), hi = Math.max(...px.map((q) => q[1]));
      const yp = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
      price = `<path d="${px.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${yp(v).toFixed(1)}`).join("")}" fill="none" stroke="var(--muted)" stroke-width="1.2" opacity="0.7" vector-effect="non-scaling-stroke"/>`;
    }
    const grid = [0.5, 0.6, 0.7, 0.8, 1.0, 1.5, 2.0].filter((v) => v < vmax).map((v) =>
      `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1" ${v === 0.5 ? 'stroke-dasharray="4 3"' : ""}/><text x="${W - R + 5}" y="${y(v) + 3}">${nf(v, 1)}</text>`).join("");
    const band = p.band ? `<rect x="${L}" width="${W - L - R}" y="${y(p.band.high)}" height="${y(p.band.low) - y(p.band.high)}" fill="var(--brass)" opacity="0.08"/>` : "";
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="height:${H}px">${band}${grid}${price}
      <path d="${d}" fill="none" stroke="var(--down)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <text x="${L}" y="${H - 5}">${fmtDate(new Date(t0).toISOString().slice(0, 10), { month: "short", year: "numeric" })}</text>
      <text x="${W - R}" y="${H - 5}" text-anchor="end">idag</text></svg>
      <div class="legend"><span style="color:var(--down)">━ Blankning %</span>${price ? `<span>━ Kurs (skala till höger ej visad)</span>` : ""}${p.band ? `<span>▇ Band ${nf(p.band.low, 1)}–${nf(p.band.high, 1)} (${Math.round(p.band.share * 100)} % av rapporterna)</span>` : ""}</div>`;
  }

  function studyTable(pooled) {
    const rows = [["ökning", "Firman ökar"], ["minskning", "Firman minskar"], ["under 0,5", "Går under 0,5 %"], ["in i bandet uppifrån", "In i bandet uppifrån"], ["in i bandet underifrån", "In i bandet underifrån"]];
    const cell = (a) => (a && a.n ? `<td class="r ${cls(a.mean)}">${a.mean > 0 ? "+" : ""}${nf(a.mean, 1)}<small class="flat"> · ${a.hit}% · n${a.n}</small></td>` : `<td class="r flat">—</td>`);
    return `<table class="targets"><tr><td class="d">Händelse</td><td class="r d">5 dagar</td><td class="r d">20 dagar</td><td class="r d">60 dagar</td></tr>
      ${rows.map(([k, label]) => `<tr><td>${label}</td>${["5", "20", "60"].map((n) => cell(pooled[k]?.[n]?.excess)).join("")}</tr>`).join("")}</table>
      <p class="flat" style="font-size:12px;margin:8px 0 0">Överavkastning i % mot aktiens normala utveckling över lika lång period · andel positiva · antal händelser. Köp antas dagen efter positionsdatumet.</p>`;
  }

  function daytradeTable(dt) {
    const c = (a) => (a && a.n ? `<td class="r ${cls(a.mean)}">${a.mean > 0 ? "+" : ""}${nf(a.mean, 2)}<small class="flat"> · ${a.hit}% · n${a.n}</small></td>` : `<td class="r flat">—</td>`);
    const rows = ["i bandet", "position utanför bandet", "ingen position"].filter((k) => dt.groups[k]);
    return `
        <p class="lbl" style="margin-top:16px">Som daytrade (dagar då positionen var känd)</p>
        <div class="hscroll"><table class="targets daytrade">
          <tr><td class="d">Citadels senast kända position</td><td class="r d">Öppning→stängning</td><td class="r d">Limit −2 %</td><td class="r d">Limit −4 %</td><td class="r d">Svängning</td></tr>
          ${rows.map((k) => { const g = dt.groups[k]; return `<tr><td>${esc(k)}<br><small class="flat">${g.days} dagar</small></td>${c(g.openClose)}${c(g.dip2)}${c(g.dip4)}<td class="r">${nf(g.rangeMean, 1)} %</td></tr>`; }).join("")}
        </table></div>
        <p class="flat" style="font-size:12px;margin:8px 0 0">Snitt % per affär före courtage och spread · andel positiva · antal. Limit = köp om kursen når X % under öppningen, sälj på stängningen. Positionen räknas som känd ${dt.lagDays} handelsdagar efter positionsdatumet (FI publicerar i efterhand). Svängning = (högsta − lägsta) / öppning.</p>`;
  }

  function thesisPanel(t) {
    const c = (a) => (a && a.n ? `<b class="${cls(a.mean)}">${a.mean > 0 ? "+" : ""}${nf(a.mean, 1)} %</b><small>median ${nf(a.median, 1)} · ${a.hit} % positiva · n ${a.n}</small>` : "<b>—</b>");
    return `
      <section class="panel">
        <p class="lbl">Tes: ${esc(t.name)}</p>
        <div class="consensus thesis">
          <div>5 dagar${c(t.h5)}</div><div>20 dagar${c(t.h20)}</div><div>60 dagar${c(t.h60)}</div><div>Till nästa rapport${c(t.untilNext)}</div>
        </div>
        <p class="flat" style="font-size:12px;margin:0 0 10px">Aktiens normala utveckling samma period: ${["5", "20", "60"].map((n) => `${n} d ${t.baseline[n] == null ? "—" : nf(t.baseline[n], 1) + " %"}`).join(" · ")}</p>
        <table class="targets">${t.events.slice().reverse().map((e) => `
          <tr><td class="d">${fmtDate(e.date, { day: "numeric", month: "short", year: "2-digit" })}</td><td>${pc(e.from)} → <b>${nf(e.pct)}</b>${e.nextPct != null ? ` <span class="flat">→ ${pc(e.nextPct)}</span>` : ""}</td>
          <td class="r ${cls(e["20"])}">${e["20"] == null ? "—" : (e["20"] > 0 ? "+" : "") + nf(e["20"], 1) + " %"}</td></tr>`).join("")}</table>
        <p class="flat" style="font-size:12px;margin:8px 0 0">Position före → vid köp → nästa rapport · kursutveckling 20 handelsdagar efter köp.</p>
        ${t.daytrade ? daytradeTable(t.daytrade) : ""}
      </section>`;
  }

  function focusSection(f) {
    const chg = (list) => list.length ? `<ul class="plain">${list.map((c) => `<li class="chg"><span>${esc(c.issuer)} <span class="flat">${esc(c.kind)}</span></span><span class="num">${pc(c.from)} → ${pc(c.to)}</span></li>`).join("")}</ul>` : `<p class="flat" style="margin:0">Inga förändringar.</p>`;
    const cut = new Date(today() - 90 * 86400000).toISOString().slice(0, 10);
    const pos = f.positions.filter((p) => p.current > 0 || p.lastDate >= cut);
    return `
      <section class="panel">
        <div class="verdict"><span class="chip neutral">${esc(f.name)}</span><span class="risk">${esc(f.role)} · <b>${f.active}</b> aktiva positioner · summa <b>${nf(f.sumActive)} %</b></span></div>
        <p class="flat" style="font-size:12px;margin:0">Juridiska enheter: ${f.entities.map(esc).join(", ")}</p>
      </section>
      <div class="twocol stack">
        <section class="panel"><p class="lbl">Senaste veckan</p>${chg(f.week)}</section>
        <section class="panel"><p class="lbl">Senaste månaden</p>${chg(f.month)}</section>
      </div>
      <section class="panel">
        <p class="lbl">Positioner (öppna + stängda senaste 90 dagarna) – klicka för diagram</p>
        <table class="targets shorts">
          <tr><td class="d">Bolag</td><td class="r d">Nu</td><td class="r d">7 d</td><td class="r d">30 d</td><td class="r d">Band 12 mån</td></tr>
          ${pos.map((p) => `
          <tr class="srow" data-isin="${esc(f.name + p.isin)}"><td>${esc(p.issuer)}<br><small class="flat">${fmtDate(p.lastDate, { day: "numeric", month: "short", year: "2-digit" })} · ${p.reports365} rapp. · ${p.reversals365} vändn.</small></td>
            <td class="r">${pc(p.current)}</td><td class="r">${delta(p.change7)}</td><td class="r">${delta(p.change30)}</td>
            <td class="r">${p.band ? `${nf(p.band.low, 1)}–${nf(p.band.high, 1)}<br><small class="flat">${Math.round(p.band.share * 100)} %${p.likelyCap ? ` · tak ${nf(p.likelyCap, 1)}×${p.capHits}` : ""}${p.likelyFloor != null && p.floorHits ? ` · golv ${p.likelyFloor ? nf(p.likelyFloor, 1) : "<0,5"}×${p.floorHits}` : ""}</small>` : "—"}</td></tr>
          <tr class="sdet" data-for="${esc(f.name + p.isin)}" hidden><td colspan="5"></td></tr>`).join("")}
        </table>
      </section>
      <section class="panel">
        <p class="lbl">Vad händer med kursen efter ${esc(f.name)}s rapporter? (2 år, alla bolag)</p>
        ${studyTable(f.pooled)}
      </section>`;
  }

  function renderShorts() {
    if (!SHORTS) {
      app.innerHTML = `<div class="overview"><h1>Blankning</h1></div><p class="empty">Blankningsdata saknas ännu – den hämtas automatiskt från FI.</p>`;
      return;
    }
    const n = NOTES || {};
    const latest = (arr) => (arr || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    app.innerHTML = `
      <div class="overview"><h1>Blankning</h1><span>FI-registret ${fmtDate(SHORTS.registerDate)}</span></div>
      ${n.conclusion ? `<section class="panel"><p class="lbl">Slutsats hittills<span class="rep-date">${fmtDate(n.conclusionDate)}</span></p><p class="summary">${esc(n.conclusion)}</p></section>` : ""}
      <section class="panel"><p class="lbl">Så fungerar registret</p><p class="summary" style="font-size:13.5px">${esc(SHORTS.note)} Ett "band" mellan två tiondelssteg kan därför vara rapporteringsrutnätet snarare än en avsiktlig gräns.</p></section>
      ${(SHORTS.theses || []).map(thesisPanel).join("")}
      ${["weekly", "monthly"].map((k) => latest(n[k]).length ? `<section class="panel"><p class="lbl">${k === "weekly" ? "Veckoanalys" : "Månadsanalys"}</p><ul class="timeline">${latest(n[k]).slice(0, 6).map((l) => `<li><span class="d">${fmtDate(l.date)}</span>${esc(l.text)}</li>`).join("")}</ul></section>` : "").join("")}
      ${SHORTS.focus.map(focusSection).join("")}
      <section class="panel">
        <p class="lbl">Liknande mönster hos andra firmor (2 år)</p>
        <table class="targets">${SHORTS.patterns.slice(0, 20).map((p) => `
          <tr><td>${esc(p.holder)}<br><small class="flat">${esc(p.issuer)}</small></td><td class="r">${nf(p.band[0], 1)}–${nf(p.band[1], 1)}<br><small class="flat">${Math.round(p.share * 100)} % · ${p.reversals} vändn.</small></td><td class="r">${pc(p.current)}</td></tr>`).join("")}</table>
        <p class="flat" style="font-size:12px;margin:8px 0 0">Par där positionen vänt minst fyra gånger och mest legat inom två tiondelssteg. Mest förekommande firmor: ${SHORTS.patternHolders.slice(0, 6).map((h) => `${esc(h.holder)} (${h.pairs})`).join(", ")}.</p>
      </section>`;
    app.querySelectorAll(".srow").forEach((r) =>
      r.addEventListener("click", () => {
        const det = app.querySelector(`.sdet[data-for="${CSS.escape(r.dataset.isin)}"]`);
        if (!det.hidden) { det.hidden = true; return; }
        const f = SHORTS.focus.find((f) => r.dataset.isin.startsWith(f.name));
        const p = f.positions.find((p) => f.name + p.isin === r.dataset.isin);
        det.firstElementChild.innerHTML = stepChart(p);
        det.hidden = false;
      })
    );
  }

  // ---------- router ----------
  function route() {
    if (!DATA) return;
    let h = location.hash.replace(/^#\/?/, "");
    if (h === "bevakning") h = "";
    document.querySelectorAll("[data-nav]").forEach((a) =>
      a.classList.toggle("on", (h === a.dataset.nav) || (h === "" && a.dataset.nav === "list"))
    );
    if (h === "kalender") renderCalendar();
    else if (h === "blankning") { renderShorts(); document.title = "Blankning · AktieAnalysen"; }
    else if (h) {
      const s = DATA.stocks.find((x) => x.id === h);
      s ? renderDetail(s) : renderList();
      document.title = s ? `${s.name} · AktieAnalysen` : "AktieAnalysen";
    } else {
      renderList();
      document.title = "AktieAnalysen";
    }
    window.scrollTo(0, 0);
  }

  async function load() {
    const bust = `?t=${Date.now()}`;
    try {
      DATA = await (await fetch(`data/stocks.json${bust}`)).json();
    } catch (e) {
      app.innerHTML = `<p class="empty">Kunde inte läsa data/stocks.json.</p>`;
      return;
    }
    try {
      const r = await fetch(`data/prices.json${bust}`);
      if (r.ok) PRICES = await r.json();
    } catch (e) { /* kurser saknas – visa analysen ändå */ }
    try {
      const [a, b] = await Promise.all([fetch(`data/shorts.json${bust}`), fetch(`data/shorts_notes.json${bust}`)]);
      if (a.ok) SHORTS = await a.json();
      if (b.ok) NOTES = await b.json();
    } catch (e) { /* blankningsdata saknas */ }

    const pt = PRICES.updated ? new Date(PRICES.updated).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" }) : "ej hämtade ännu";
    stamp.textContent = `Analys uppdaterad ${fmtDate(DATA.updated)} · Kurser ${pt}`;
    route();
  }

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const el = document.getElementById("chart");
      const s = DATA && DATA.stocks.find((x) => x.id === location.hash.replace(/^#\/?/, ""));
      if (el && s) el.innerHTML = bigChart(s, quote(s));
    }, 150);
  });
  window.addEventListener("hashchange", route);
  load();
})();
