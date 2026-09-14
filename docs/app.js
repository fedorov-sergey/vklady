/* app.js — v2: карточки (по продуктам / по сценариям), сайдбар-фильтры, сортировка */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  let DATA = null;
  let GROUPS = null;

  const state = {
    type: "all",        // all | вклад | счет
    view: "grouped",    // grouped | scenario
    sortCol: "rate",    // rate | income | duration | bank
    sortAsc: false,
  };

  /* ================= helpers ================= */
  function fmtNum(n) {
    return n == null ? "—" : n.toLocaleString("ru-RU");
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return "—";
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + " млн";
    return fmtNum(Math.round(n)) + " \u20bd";
  }
  function fmtRate(r) {
    return r == null ? "—" : r.toFixed(2).replace(/\.?0+$/, "");
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ================= доход / ставки ================= */
  // эффективная ставка строки с учётом toggle «новые деньги»
  function rowRate(row, newMoney) {
    if (row.profile.new_money && row.rate_base != null && !newMoney) return row.rate_base;
    return row.rate;
  }
  // доход за срок вклада (счёт ~ за 12 мес)
  function estIncomeRate(rate, months, amount) {
    if (!rate || !amount) return null;
    const m = months || 12;
    return (amount * rate) / 100 * (m / 12);
  }

  function profileState() {
    return {
      spending: $("#f-spend").value ? parseInt($("#f-spend").value) : null,
      subscription: $("#f-sub").value || null,
      newMoney: $("#f-newmoney").checked,
    };
  }
  function filterState() {
    return {
      type: state.type,
      amount: parseFloat($("#f-amount").value) || 0,
      term: $("#f-term").value ? parseInt($("#f-term").value) : null,
      popolnenie: $("#f-pop").value,
      snyatie: $("#f-sny").value,
    };
  }
  function amount() {
    const a = parseFloat($("#f-amount").value) || 0;
    return a || DATA.meta.default_amount;
  }

  // базовые фильтры (сумма/тип/срок/пополнение/снятие)
  function baseMatch(r, f) {
    if (r.rate == null) return false;
    if (f.type !== "all" && r.type !== f.type) return false;
    if (f.amount > 0 && f.amount < r.min_sum) return false;
    if (f.term != null) {
      if (r.type !== "вклад" || r.duration_months !== f.term) return false;
    }
    if (f.popolnenie && r.popolnenie !== f.popolnenie) return false;
    if (f.snyatie && r.snyatie !== f.snyatie) return false;
    return true;
  }
  // профильные условия: подходит ли сценарий выбранному профилю
  function profileMatch(r, p) {
    if (p.spending != null && r.profile.spending != null && r.profile.spending > p.spending) return false;
    if (p.subscription != null && r.profile.subscription != null && r.profile.subscription !== p.subscription) return false;
    return true;
  }

  /* ================= группировка ================= */
  function buildGroups() {
    const map = new Map();
    for (const r of DATA.rows) {
      const key = [r.bank, r.product, r.type, r.min_sum, r.popolnenie, r.snyatie, r.duration_months].join("\u0001");
      if (!map.has(key)) {
        map.set(key, {
          key,
          isGroup: true,
          bank: r.bank,
          product: r.product,
          type: r.type,
          duration_months: r.duration_months,
          duration_display: r.duration_display,
          min_sum: r.min_sum,
          popolnenie: r.popolnenie,
          snyatie: r.snyatie,
          account_type: r.account_type,
          tiers: [],
        });
      }
      map.get(key).tiers.push(r);
    }
    GROUPS = [...map.values()];
  }

  function anyCbr(g) {
    return g.tiers.find((t) => t.cbr) || null;
  }
  function maxSpending(g) {
    return g.tiers.reduce((m, t) => (t.profile.spending != null && t.profile.spending > m ? t.profile.spending : m), null);
  }
  // «ваша ставка»: лучшая из тарифов, подходящих профилю
  function groupRate(g, p) {
    let best = null;
    for (const t of g.tiers) {
      if (profileMatch(t, p)) {
        const r = rowRate(t, p.newMoney);
        if (best === null || r > best) best = r;
      }
    }
    if (best === null) {
      best = Math.min(...g.tiers.map((t) => rowRate(t, p.newMoney)));
    }
    return best;
  }
  function groupBaseRate(g, p) {
    return Math.min(...g.tiers.map((t) => rowRate(t, false)));
  }

  /* ================= сортировка ================= */
  function sortValue(x, p, amt) {
    switch (state.sortCol) {
      case "rate":
        return x.isGroup ? groupRate(x, p) : rowRate(x, p.newMoney);
      case "income":
        return (x.isGroup
          ? estIncomeRate(groupRate(x, p), x.duration_months, amt)
          : estIncomeRate(rowRate(x, p.newMoney), x.duration_months, amt)) ?? -1;
      case "duration":
        return x.duration_months ?? 9999;
      case "bank":
        return x.bank;
      default:
        return 0;
    }
  }
  function compare(x, y, p, amt) {
    let a = sortValue(x, p, amt);
    let b = sortValue(y, p, amt);
    const dir = state.sortAsc ? 1 : -1;
    if (state.sortCol === "bank") {
      if (a < b) return state.sortAsc ? -1 : 1;
      if (a > b) return state.sortAsc ? 1 : -1;
    } else if (a !== b) {
      return a < b ? dir : -dir;
    }
    // стабильный порядок при равенстве
    if (x.bank !== y.bank) return x.bank < y.bank ? -1 : 1;
    if (x.product !== y.product) return x.product < y.product ? -1 : 1;
    return (x.duration_months ?? 9999) - (y.duration_months ?? 9999);
  }

  /* ================= чипы ================= */
  const RATE_NOTE_SHORT = {
    "Ставка при открытии": "при открытии",
    "Ставка с капитализацией при открытии": "с кап. (открытие)",
    "Ставка с капитализацией": "с кап.",
    "Ставка без Капитализации": "без кап.",
    "Ставка Новые деньги Надбавка": "надбавка",
  };
  function tierLabel(t) {
    const c = [];
    if (t.profile.spending != null && t.profile.spending > 0) c.push("траты \u2265 " + fmtNum(t.profile.spending));
    if (t.profile.subscription) c.push("подписка " + t.profile.subscription);
    if (t.profile.new_money) c.push("все деньги новые");
    if (t.cbr) c.push("ЦБ " + (t.cbr.delta == null ? "фикс" : (t.cbr.delta > 0 ? "+" : "") + t.cbr.delta + "%"));
    return c.length ? c.join(" · ") : "базовые условия";
  }
  function groupChips(g, p) {
    const h = [];
    const c = anyCbr(g);
    if (c) {
      const d = c.cbr.delta;
      h.push('<span class="chip chip-cbr">\u26a0 зависит от ЦБ' +
        (d != null ? " (" + (d > 0 ? "+" : "") + d + "%)" : "") + "</span>");
    }
    const ms = maxSpending(g);
    if (ms != null && ms > 0) h.push('<span class="chip chip-spend">траты \u2265 ' + fmtNum(ms) + "</span>");
    const subs = [...new Set(g.tiers.map((t) => t.profile.subscription).filter(Boolean))];
    subs.forEach((s) => h.push('<span class="chip chip-sub">подписка ' + esc(s) + "</span>"));
    if (g.tiers.some((t) => t.profile.new_money))
      h.push('<span class="chip chip-new">все деньги новые</span>');
    return h.join("");
  }
  function rowChips(r) {
    const h = [];
    if (r.profile.spending != null && r.profile.spending > 0)
      h.push('<span class="chip chip-spend">траты \u2265 ' + fmtNum(r.profile.spending) + "</span>");
    if (r.profile.subscription)
      h.push('<span class="chip chip-sub">подписка ' + esc(r.profile.subscription) + "</span>");
    if (r.profile.new_money) h.push('<span class="chip chip-new">все деньги новые</span>');
    if (r.cbr) {
      const d = r.cbr.delta;
      h.push('<span class="chip chip-cbr">\u26a0 зависит от ЦБ' +
        (d != null ? " (" + (d > 0 ? "+" : "") + d + "%)" : "") + "</span>");
    }
    h.push('<span class="chip chip-plain">' + (RATE_NOTE_SHORT[r.rate_note] || esc(r.rate_note || "")) + "</span>");
    return h.join("");
  }

  /* ================= факты карточки ================= */
  function factsHTML(x) {
    const parts = [];
    if (x.duration_display) parts.push("срок " + x.duration_display);
    if (x.type === "счет" && x.account_type) parts.push(esc(x.account_type));
    parts.push("от " + fmtNum(x.min_sum));
    if (x.popolnenie) parts.push("пополнение: " + (x.popolnenie === "да" ? "да" : x.popolnenie === "?" ? "?" : "нет"));
    if (x.snyatie) parts.push("снятие: " + (x.snyatie === "да" ? "да" : x.snyatie === "без" ? "нет" : x.snyatie));
    return parts.join(" · ");
  }

  /* ================= рендер ================= */
  let emptyState = null; // {div}

  function rankBadge(i) {
    if (i === 0) return '<span class="rank-badge best">Лучший</span>';
    if (i === 1) return '<span class="rank-badge n2">\u2116 2</span>';
    if (i === 2) return '<span class="rank-badge n3">\u2116 3</span>';
    return "";
  }

  function cardShell(items) {
    return `<article class="card ${items.top}">
      <div class="card-body">
        <div class="card-head">
          <span class="bank-chip">${esc(items.bank)}</span>
          <span class="type-chip ${items.type}">${items.type === "счет" ? "Счёт" : "Вклад"}</span>
          ${items.rank}
        </div>
        <div class="card-rate-line">
          <span class="rate ${items.yours ? "yours" : ""}">${fmtRate(items.rate)}<small>%</small></span>
          ${items.baseLabel ? '<span class="base-rate">' + items.baseLabel + "</span>" : ""}
        </div>
        <div class="card-title">${esc(items.product)}</div>
        <div class="card-facts">${items.facts}</div>
        <div class="chips">${items.chips}</div>
        <div class="card-foot">
          <span class="income">доход ~ ${fmtMoney(items.income)}</span>
          <span class="more">&#9660;</span>
        </div>
      </div>
      <div class="card-extra">${items.extra}</div>
    </article>`;
  }

  function tierRows(g, p) {
    return g.tiers
      .slice()
      .sort((a, b) => rowRate(b, p.newMoney) - rowRate(a, p.newMoney))
      .map((t) => {
        const hit = profileMatch(t, p);
        return `<div class="tier ${hit ? "hit" : ""}">
          <span>${esc(tierLabel(t))}</span>
          <span class="tier-rate">${fmtRate(rowRate(t, p.newMoney))}%</span>
        </div>`;
      })
      .join("");
  }

  function groupedCard(g, i, p, amt) {
    const your = groupRate(g, p);
    const base = groupBaseRate(g, p);
    const income = estIncomeRate(your, g.duration_months, amt);
    const notes = g.tiers.map((t) => [t.note, t.income_note].filter(Boolean)).flat();
    const maxT = g.tiers.slice().sort((a, b) => rowRate(b, p.newMoney) - rowRate(a, p.newMoney))[0];
    const extra = `
      <div class="extra-title">Ставки по условиям</div>
      ${tierRows(g, p)}
      <div class="meta-line">Источник ставки: ${esc(RATE_NOTE_SHORT[maxT.rate_note] || maxT.rate_note || "—")} · доход за ${g.duration_months != null ? g.duration_months + " мес" : "счёт, год"}
        ${g.type === "счет" ? " · на остаток" : ""}</div>
      ${notes.length ? '<div class="note-line">' + notes.map(esc).join(" · ") + "</div>" : ""}`;
    return cardShell({
      top: i === 0 ? "top top-1" : i < 3 ? "top" : "",
      bank: g.bank,
      type: g.type,
      rank: rankBadge(i),
      yours: your !== base,
      rate: your,
      baseLabel: your !== base ? "база " + fmtRate(base) + "%" : "по профилю",
      product: g.product,
      facts: factsHTML(g),
      chips: groupChips(g, p),
      income,
      extra,
    });
  }

  function scenarioCard(r, i, p, amt) {
    const your = rowRate(r, p.newMoney);
    const income = estIncomeRate(your, r.duration_months, amt);
    const note = [r.note, r.income_note].filter(Boolean).join(" · ");
    const extra = `
      <div class="extra-title">О сценарии</div>
      <div class="meta-line">
        Источник: ${esc(r.rate_note || "—")}
        ${r.cbr && r.cbr.delta != null ? " · ЦБ " + (r.cbr.delta > 0 ? "+" : "") + r.cbr.delta + "%" : ""}
        · мин. сумма ${fmtNum(r.min_sum)}
        · пополнение ${r.popolnenie || "—"} · снятие ${r.snyatie || "—"}
        ${r.type === "счет" && r.account_type ? " · " + esc(r.account_type) : ""}
      </div>
      ${note ? '<div class="note-line">' + esc(note) + "</div>" : ""}`;
    return cardShell({
      top: i === 0 ? "top top-1" : i < 3 ? "top" : "",
      bank: r.bank,
      type: r.type,
      rank: rankBadge(i),
      yours: false,
      rate: your,
      baseLabel: r.rate_base != null ? "база " + fmtRate(r.rate_base) + "%" : "",
      product: r.product,
      facts: factsHTML(r),
      chips: rowChips(r),
      income,
      extra,
    });
  }

  /* ================= render ================= */
  function renderSortBar() {
    $$(".sort-btn").forEach((b) => {
      const active = b.dataset.sort === state.sortCol;
      b.classList.toggle("active", active);
      b.textContent = b.textContent.replace(/[ \u25bc\u25b2\u2191\u2193]/g, "").trim();
      if (active) b.textContent += state.sortAsc ? " \u25b2" : " \u25bc";
    });
    $$(".segment").forEach((s) => {
      const active = s.dataset.type
        ? s.dataset.type === state.type
        : s.dataset.view === state.view;
      s.classList.toggle("active", active);
    });
    $("#f-term").disabled = state.type === "счет";
  }

  function render() {
    if (!DATA) return;
    const f = filterState();
    const p = profileState();
    const amt = amount();
    const container = $("#cards");

    if (state.view === "grouped") {
      const groups = GROUPS.filter((g) => {
        if (f.type !== "all" && g.type !== f.type) return false;
        if (f.amount > 0 && f.amount < g.min_sum) return false;
        if (f.term != null) {
          if (g.type !== "вклад" || g.duration_months !== f.term) return false;
        }
        if (f.popolnenie && !g.tiers.some((t) => t.popolnenie === f.popolnenie)) return false;
        if (f.snyatie && !g.tiers.some((t) => t.snyatie === f.snyatie)) return false;
        return true;
      });
      groups.sort((a, b) => compare(a, b, p, amt));
      const html = groups.map((g, i) => groupedCard(g, i, p, amt)).join("");
      container.innerHTML = html || emptyHTML("Нет подходящих продуктов");
      $("#count").textContent = "Показано " + groups.length + " из " + GROUPS.length + " продуктов";
    } else {
      const rows = DATA.rows
        .filter((r) => baseMatch(r, f) && profileMatch(r, p));
      rows.sort((a, b) => compare(a, b, p, amt));
      const html = rows.map((r, i) => scenarioCard(r, i, p, amt)).join("");
      container.innerHTML = html || emptyHTML("Нет подходящих сценариев");
      $("#count").textContent = "Показано " + rows.length + " из " + DATA.rows.length + " сценариев";
    }

    // пересчёт липкого отступа больше не нужен (карточки, без sticky-шапки)
    renderSortBar();
  }

  function emptyHTML(msg) {
    return `<div class="empty">${esc(msg)}<br><span>Измените параметры фильтров</span></div>`;
  }

  /* ================= события ================= */
  function wireEvents() {
    $$("#filters select, #filters input").forEach((el) => {
      el.addEventListener("input", render);
      el.addEventListener("change", render);
    });

    $$("#segment-type .segment").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.type = btn.dataset.type;
        render();
      });
    });
    $$("#view-switch .segment").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.view = btn.dataset.view;
        render();
      });
    });
    $$(".sort-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const col = btn.dataset.sort;
        if (state.sortCol === col) {
          state.sortAsc = !state.sortAsc;
        } else {
          state.sortCol = col;
          state.sortAsc = col === "duration" || col === "bank";
        }
        render();
      });
    });

    $("#filters-toggle").addEventListener("click", () => {
      const f = $("#filters");
      const hidden = f.hasAttribute("hidden");
      f.toggleAttribute("hidden", !hidden);
      $("#filters-toggle").setAttribute("aria-expanded", String(!hidden));
      $("#filters-toggle").textContent = hidden ? "Скрыть фильтры" : "Фильтры";
    });

    $("#cards").addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      if (card) card.classList.toggle("open");
    });
    $("#cards").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".card");
      if (card) {
        e.preventDefault();
        card.classList.toggle("open");
      }
    });
  }

  /* ================= инициализация ================= */
  async function init() {
    try {
      const res = await fetch("data.json");
      if (!res.ok) throw new Error(res.statusText);
      DATA = await res.json();
    } catch (e) {
      $("#meta-info").textContent = "Ошибка загрузки data.json: " + e.message;
      return;
    }

    const m = DATA.meta;
    const f = DATA.filters;
    $("#meta-info").textContent = "Данные на " + m.updated;
    $("#header-stat").textContent =
      f.banks.length + " банка · " + f.products.length + " продуктов · " + DATA.rows.length + " сценариев";
    $("#footer-meta").textContent =
      "Источник: " + m.source + " · Сгенерировано: " + m.generated +
      " · Сумма по умолчанию: " + fmtNum(m.default_amount) + " \u20bd";
    $("#sidebar-note").textContent =
      "Банки: " + f.banks.join(", ") + ". Срезано на " + m.updated +
      ". Ставки в % годовых; у счетов доход оценён на 12 мес.";

    $("#f-amount").value = m.default_amount;

    const termSel = $("#f-term");
    f.durations.forEach((d) => {
      const o = document.createElement("option");
      o.value = d;
      o.textContent = d + " мес";
      termSel.appendChild(o);
    });
    const spendSel = $("#f-spend");
    f.spending_options.forEach((s) => {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s === 0 ? "0 (базовая)" : "от " + fmtNum(s) + " \u20bd";
      spendSel.appendChild(o);
    });
    const subSel = $("#f-sub");
    f.subscription_options.forEach((s) => {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      subSel.appendChild(o);
    });

    buildGroups();
    wireEvents();
    render();
  }

  init();
})();