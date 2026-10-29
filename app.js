(() => {
  "use strict";

  const app = document.getElementById("app");
  const stamp = document.getElementById("stamp");
  let DATA = null;
  let PRICES = { quotes: {} };
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

  // ---------- router ----------
  function route() {
    if (!DATA) return;
    let h = location.hash.replace(/^#\/?/, "");
    if (h === "bevakning") h = "";
    document.querySelectorAll("[data-nav]").forEach((a) =>
      a.classList.toggle("on", (h === "kalender" && a.dataset.nav === "kalender") || (h === "" && a.dataset.nav === "list"))
    );
    if (h === "kalender") renderCalendar();
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
