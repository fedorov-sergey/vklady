/* app.js — загрузка data.json, фильтры, сортировка, рендер таблицы */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  /* ---- state ---- */
  let DATA = null;
  let sortCol = "rate";
  let sortAsc = false;

  /* ---- helpers ---- */
  function fmtNum(n) {
    return n == null ? "—" : n.toLocaleString("ru-RU");
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return "—";
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + " млн";
    return fmtNum(Math.round(n)) + " ₽";
  }
  function fmtRate(r) {
    return r == null ? "—" : r.toFixed(2).replace(/\.?0+$/, "");
  }

  /* ---- income estimation (simple: no compounding) ---- */
  function estIncome(row, amount) {
    const months = row.type === "вклад" ? row.duration_months : 12;
    if (!months || !row.rate) return null;
    const rate = effectiveRate(row);
    return (amount * rate) / 100 * (months / 12);
  }

  function effectiveRate(row) {
    if (row.new_money && row.rate_base != null && !$("#f-newmoney").checked) {
      return row.rate_base;
    }
    return row.rate;
  }

  /* ---- read filters ---- */
  function getFilters() {
    const f = {};
    f.amount = parseFloat($("#f-amount").value) || 0;
    f.term = $("#f-term").value ? parseInt($("#f-term").value) : null;
    f.type = $("#f-type").value;
    f.popolnenie = $("#f-pop").value;
    f.snyatie = $("#f-sny").value;
    f.spending = $("#f-spend").value ? parseInt($("#f-spend").value) : null;
    f.subscription = $("#f-sub").value || null;
    return f;
  }

  /* ---- filter rows ---- */
  function matchRow(row, f) {
    if (row.rate == null) return false;
    if (f.type !== "all" && row.type !== f.type) return false;
    if (f.amount > 0 && f.amount < row.min_sum) return false;
    if (f.term != null) {
      if (row.type !== "вклад") return false;
      if (row.duration_months !== f.term) return false;
    }
    if (f.popolnenie && row.popolnenie !== f.popolnenie) return false;
    if (f.snyatie && row.snyatie !== f.snyatie) return false;

    // spending: include rows where spending==null (generic) or spending <= filter
    if (f.spending != null) {
      const rSp = row.profile.spending;
      if (rSp != null && rSp > f.spending) return false;
    }
    // subscription: include rows where sub==null (no requirement) or sub==filter
    if (f.subscription != null) {
      const rSub = row.profile.subscription;
      if (rSub != null && rSub !== f.subscription) return false;
    }
    return true;
  }

  /* ---- sort ---- */
  function comparator(a, b, col, asc) {
    let va, vb;
    switch (col) {
      case "bank":
        va = a.bank; vb = b.bank; return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      case "product":
        va = a.product; vb = b.product; return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      case "type":
        va = a.type; vb = b.type; return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      case "duration":
        va = a.duration_months ?? 9999; vb = b.duration_months ?? 9999; break;
      case "rate":
        va = effectiveRate(a); vb = effectiveRate(b); break;
      case "min_sum":
        va = a.min_sum; vb = b.min_sum; break;
      case "income":
        va = estIncome(a, getFilters().amount || DATA.meta.default_amount);
        vb = estIncome(b, getFilters().amount || DATA.meta.default_amount);
        va = va ?? -1; vb = vb ?? -1;
        break;
      default:
        return 0;
    }
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  }

  /* ---- badges ---- */
  function rowBadges(row) {
    const h = [];
    if (row.profile.spending != null && row.profile.spending > 0)
      h.push('<span class="badge badge-spend">траты ≥' + fmtNum(row.profile.spending) + '</span>');
    if (row.profile.subscription)
      h.push('<span class="badge badge-sub">подписка ' + row.profile.subscription + '</span>');
    if (row.profile.new_money)
      h.push('<span class="badge badge-new">новые деньги</span>');
    if (row.cbr && row.cbr.delta != null)
      h.push('<span class="badge badge-cbr">ЦБ ' + (row.cbr.delta > 0 ? '+' : '') + row.cbr.delta + '%</span>');
    if (row.rate_note === "Ставка без Капитализации")
      h.push('<span class="badge badge-note">без кап.</span>');
    if (row.note)
      h.push('<span class="badge badge-note">' + escHtml(row.note) + '</span>');
    return h.join("");
  }
  function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---- render ---- */
  function render() {
    if (!DATA) return;
    const f = getFilters();
    const rows = DATA.rows.filter((r) => matchRow(r, f));
    rows.sort((a, b) => comparator(a, b, sortCol, sortAsc));

    const amount = f.amount || DATA.meta.default_amount;

    // top 3
    const top = rows.slice(0, 3);
    const topHtml = top.map((r, i) => {
      const rate = effectiveRate(r);
      const inc = estIncome(r, amount);
      const cls = i === 0 ? "card highlight" : "card";
      return `<div class="${cls}">
        <span class="card-title">${i === 0 ? "🏆 Лучший" : "Альтернатива №" + (i + 1)}</span>
        <span class="card-rate">${fmtRate(rate)}%</span>
        <span class="card-product">${escHtml(r.product)}</span>
        <span class="card-sub">${escHtml(r.bank)} · ${r.type === "счет" ? "счёт" : r.duration_display || "—"}</span>
        <span class="card-sub">Доход: ${fmtMoney(inc)}</span>
      </div>`;
    }).join("");
    $("#top-cards").innerHTML = topHtml || '<span style="color:var(--fg-muted)">Нет подходящих вариантов</span>';

    // table
    const tbody = $("#tbody");
    const trs = rows.map((r, idx) => {
      const rate = effectiveRate(r);
      const inc = estIncome(r, amount);
      const popBadge = r.popolnenie === "да"
        ? '<span class="badge badge-pop">да</span>'
        : r.popolnenie || "—";
      const snyBadge = r.snyatie === "да"
        ? '<span class="badge badge-sny">да</span>'
        : r.snyatie === "?" ? "?" : r.snyatie || "—";
      const topCls = idx < 3 ? ' class="top-row"' : "";
      return `<tr${topCls}>
        <td>${escHtml(r.bank)}</td>
        <td>${escHtml(r.product)}</td>
        <td>${r.type === "счет" ? "Счёт" : "Вклад"}</td>
        <td>${r.duration_display || "—"}</td>
        <td>${fmtRate(rate)}</td>
        <td><div class="badges">${rowBadges(r)}</div></td>
        <td>${popBadge}</td>
        <td>${snyBadge}</td>
        <td>${fmtNum(r.min_sum)}</td>
        <td class="income">${fmtMoney(inc)}</td>
      </tr>`;
    }).join("");
    tbody.innerHTML = trs;

    $("#count").textContent = `Показано ${rows.length} из ${DATA.rows.length} сценариев`;
  }

  /* ---- init ---- */
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
    $("#meta-info").textContent =
      `Данные на ${m.updated} · ${DATA.filters.banks.length} банка · ${DATA.rows.length} сценариев`;
    $("#footer-meta").textContent =
      `Источник: ${m.source} · Сгенерировано: ${m.generated} · Сумма по умолчанию: ${fmtNum(m.default_amount)} ₽`;

    // populate filters
    $("#f-amount").value = m.default_amount;

    const termSel = $("#f-term");
    DATA.filters.durations.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d + " мес";
      termSel.appendChild(opt);
    });

    const spendSel = $("#f-spend");
    DATA.filters.spending_options.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s === 0 ? "0 (базовая)" : "от " + fmtNum(s) + " ₽";
      spendSel.appendChild(opt);
    });

    const subSel = $("#f-sub");
    DATA.filters.subscription_options.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      subSel.appendChild(opt);
    });
    // add "без подписки" option
    const noSub = document.createElement("option");
    noSub.value = "нет";
    noSub.textContent = "нет";
    subSel.appendChild(noSub);

    // wire events
    $$("#filters select, #filters input").forEach((el) => {
      el.addEventListener("input", render);
      el.addEventListener("change", render);
    });

    // sort headers
    $$("thead th[data-col]").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        if (col === "badges") return;
        if (sortCol === col) {
          sortAsc = !sortAsc;
        } else {
          sortCol = col;
          sortAsc = col === "bank" || col === "product";
        }
        // update sort indicators
        $$("thead th").forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
        th.classList.add(sortAsc ? "sort-asc" : "sort-desc");
        render();
      });
    });

    render();
  }

  init();
})();
