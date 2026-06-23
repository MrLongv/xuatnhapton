/*
 * Xuất Nhập Tồn - Frontend Pages
 * Dùng với worker.js + schema_xuat_nhap_ton_d1.sql
 */

const STORAGE = {
  token: "xnt_token",
  user: "xnt_user",
};

const API_BASE = "https://xuat-nhap-ton-api.lequangthuan1988.workers.dev";
const APP_VERSION = "20260623-nxt-scope-v1";
const PAGE_LIMIT = 50;
const IMPORT_BATCH_SIZE = 500;

const state = {
  token: localStorage.getItem(STORAGE.token) || "",
  user: safeJson(localStorage.getItem(STORAGE.user)) || null,
  view: "dashboard",
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  nxtScope: "month", // month | year | all
  pages: {
    products: 1,
    imports: 1,
    exports: 1,
    nxt: 1,
    ledger: 1,
    audit: 1,
  },
  lastRows: {
    nxt: [],
    ledger: [],
    excelPreview: [],
  },
  buckets: [],
  excelRows: [],
};

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

window.XNT_APP_VERSION = APP_VERSION;
window.addEventListener("DOMContentLoaded", init);

function init() {
  // Xóa cấu hình cũ của bản test có ô API Worker để tránh cache/trộn phiên bản.
  localStorage.removeItem("xnt_api_base");
  initYearMonth();
  bindAuth();
  bindNavigation();
  bindCommon();
  bindProducts();
  bindDocs("imports", "IMPORT");
  bindDocs("exports", "EXPORT");
  bindNxt();
  bindLedger();
  bindImportExcel();
  bindPeriods();
  bindAudit();
  bindUsers();
  bindDialogs();


  if (state.token) {
    showApp();
    bootstrapApp();
  } else {
    showAuth();
  }
}

// =========================================================
// API
// =========================================================

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token && options.auth !== false) headers.Authorization = `Bearer ${state.token}`;
  const url = `${API_BASE}${path}`;
  const init = { method, headers };
  if (options.body !== undefined) init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);

  const res = await fetch(url, init);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text || "Response không phải JSON" }; }
  if (!res.ok || data.ok === false) {
    if (res.status === 401 && !["/api/login", "/api/health", "/"].includes(path)) handleSessionExpired();
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  });
  return p.toString() ? `?${p.toString()}` : "";
}


function handleSessionExpired() {
  localStorage.removeItem(STORAGE.token);
  state.token = "";
  toast("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại", "warn");
  showAuth();
}

// =========================================================
// Auth
// =========================================================

function bindAuth() {
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      setButtonLoading($("loginBtn"), true, "Đang đăng nhập...");
      const data = await api("/api/login", {
        method: "POST",
        body: { username: $("usernameInput").value.trim(), password: $("passwordInput").value },
      });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem(STORAGE.token, state.token);
      localStorage.setItem(STORAGE.user, JSON.stringify(state.user));
      toast("Đăng nhập thành công", "success");
      showApp();
      await bootstrapApp();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setButtonLoading($("loginBtn"), false);
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST", body: {} }); } catch {}
    state.token = "";
    state.user = null;
    localStorage.removeItem(STORAGE.token);
    localStorage.removeItem(STORAGE.user);
    showAuth();
  });
}

function showAuth() {
  $("authScreen").classList.remove("hidden");
  $("appShell").classList.add("hidden");
}

function showApp() {
  $("authScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  renderUser();
}

async function bootstrapApp() {
  try {
    const [me, settings, buckets] = await Promise.all([
      api("/api/me"),
      api("/api/settings").catch(() => ({ settings: {} })),
      api("/api/buckets").catch(() => ({ rows: [] })),
    ]);
    state.user = me.user;
    state.buckets = buckets.rows || [];
    localStorage.setItem(STORAGE.user, JSON.stringify(state.user));
    if (settings.settings?.company_name) $("companyName").textContent = settings.settings.company_name;
    if (settings.settings?.current_year) state.year = Number(settings.settings.current_year) || state.year;
    setYearMonthControls();
    renderUser();
    applyRoleVisibility();
    await loadCurrentView();
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderUser() {
  $("currentUserName").textContent = state.user?.display_name || state.user?.username || "-";
  $("currentUserRole").textContent = state.user?.role || "-";
}

function applyRoleVisibility() {
  const role = state.user?.role || "viewer";
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", role !== "admin"));
  $$(".admin-staff").forEach((el) => el.classList.toggle("hidden", !["admin", "staff"].includes(role)));
}

// =========================================================
// Navigation
// =========================================================

function bindNavigation() {
  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      setView(btn.dataset.view);
      document.body.classList.remove("sidebar-open");
    });
  });
  $("menuToggle").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
}

function setView(view) {
  state.view = view;
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.remove("active-view"));
  $(`${view}View`)?.classList.add("active-view");

  const meta = {
    dashboard: ["Tổng quan", "Theo dõi nhanh số liệu tháng đang chọn."],
    products: ["Danh mục mã hàng", "Quản lý mã hàng, tên hàng, ĐVT, khách hàng."],
    imports: ["Nhập kho", "Danh sách phiếu nhập và nhập phát sinh."],
    exports: ["Xuất kho", "Danh sách phiếu xuất, số hóa đơn và xuất phát sinh."],
    nxt: ["Tổng hợp NXT", "Báo cáo tồn đầu kỳ, nhập, xuất, tồn cuối kỳ."],
    ledger: ["Sổ phát sinh", "Xem chi tiết từng phát sinh theo mã hàng."],
    importExcel: ["Import Excel", "Đọc dữ liệu cũ từ sheet NHAP và XUAT."],
    periods: ["Khóa kỳ", "Khóa hoặc mở khóa kỳ tháng."],
    audit: ["Nhật ký thao tác", "Theo dõi ai thêm, sửa, xóa, import, khóa kỳ."],
    users: ["Tài khoản", "Tạo và phân quyền người dùng."],
  }[view] || ["Xuất Nhập Tồn", ""];
  $("viewTitle").textContent = meta[0];
  $("viewSubtitle").textContent = meta[1];
  updatePeriodSelectorState();
  loadCurrentView();
}

async function loadCurrentView() {
  const v = state.view;
  if (v === "dashboard") return loadDashboard();
  if (v === "products") return loadProducts();
  if (v === "imports") return loadDocs("imports", "IMPORT");
  if (v === "exports") return loadDocs("exports", "EXPORT");
  if (v === "nxt") return loadNxt();
  if (v === "ledger") return loadLedger();
  if (v === "periods") return loadPeriods();
  if (v === "audit") return loadAudit();
  if (v === "users") return loadUsers();
}

function bindCommon() {
  $("refreshBtn").addEventListener("click", () => loadCurrentView());
  $("dashOpenImportBtn").addEventListener("click", () => setView("importExcel"));
  $("dashOpenNxtBtn").addEventListener("click", () => setView("nxt"));
  $("dashRebuildBtn").addEventListener("click", rebuildNxt);
  $("yearSelect").addEventListener("change", () => { state.year = Number($("yearSelect").value); loadCurrentView(); });
  $("monthSelect").addEventListener("change", () => { state.month = Number($("monthSelect").value); loadCurrentView(); });
}

function initYearMonth() {
  const ySel = $("yearSelect");
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = Math.min(2022, thisYear - 2); y <= thisYear + 2; y++) years.push(y);
  ySel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  $("monthSelect").innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">Tháng ${i + 1}</option>`).join("");
  setYearMonthControls();
}

function setYearMonthControls() {
  $("yearSelect").value = String(state.year);
  $("monthSelect").value = String(state.month);
  updatePeriodSelectorState();
}

function updatePeriodSelectorState() {
  const y = $("yearSelect");
  const m = $("monthSelect");
  if (!y || !m) return;
  const isNxt = state.view === "nxt";
  const scope = state.nxtScope || "month";
  y.disabled = isNxt && scope === "all";
  m.disabled = isNxt && scope !== "month";
  y.classList.toggle("muted-control", y.disabled);
  m.classList.toggle("muted-control", m.disabled);
}

function periodId() {
  return `${state.year}-${String(state.month).padStart(2, "0")}`;
}

// =========================================================
// Dashboard
// =========================================================

async function loadDashboard() {
  try {
    const data = await api(`/api/dashboard${qs({ year: state.year, month: state.month })}`);
    $("dashboardPeriod").textContent = data.period_id;
    $("statProducts").textContent = fmt(data.products_active);
    $("statImports").textContent = fmt(data.docs?.import_docs);
    $("statExports").textContent = fmt(data.docs?.export_docs);
    $("statClosing").textContent = fmt(data.monthly?.closing_qty);
    const locked = data.period?.status === "locked";
    $("periodStatusText").textContent = locked ? `Đã khóa ${displayDateTime(data.period.locked_at)}` : "Đang mở";
    $("periodStatusText").className = `badge ${locked ? "danger" : "success"}`;
  } catch (err) {
    toast(err.message, "error");
  }
}

// =========================================================
// Products
// =========================================================

function bindProducts() {
  $("productSearchBtn").addEventListener("click", () => { state.pages.products = 1; loadProducts(); });
  $("productSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { state.pages.products = 1; loadProducts(); } });
  $("productAddBtn").addEventListener("click", () => openProductDialog());
  bindPager("products", loadProducts);

  $("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const id = $("productId").value;
      const payload = {
        product_code: $("productCode").value.trim(),
        product_name: $("productName").value.trim(),
        unit: $("productUnit").value.trim() || "PCS",
        customer_name: $("productCustomer").value.trim(),
        item_group: $("productGroup").value.trim(),
        note: $("productNote").value.trim(),
        is_active: $("productActive").value === "1",
        sltn_total: nullableNumber($("productSltnTotal").value) || 0,
        sltn_sl: nullableNumber($("productSltnSl").value) || 0,
        sltn_mau: nullableNumber($("productSltnMau").value) || 0,
      };
      if (id) await api(`/api/products/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
      else await api("/api/products", { method: "POST", body: payload });
      closeDialog("productDialog");
      toast("Đã lưu mã hàng", "success");
      loadProducts();
    } catch (err) { toast(err.message, "error"); }
  });
}

async function loadProducts() {
  try {
    const data = await api(`/api/products${qs({ q: $("productSearch").value.trim(), page: state.pages.products, limit: PAGE_LIMIT })}`);
    $("productsTbody").innerHTML = data.rows.map((r) => `
      <tr>
        <td><strong>${esc(r.product_code)}</strong></td><td>${esc(r.product_name)}</td><td>${esc(r.unit)}</td>
        <td>${esc(r.customer_name)}</td><td>${esc(r.item_group)}</td>
        <td class="num strong">${fmt(r.sltn_total)}</td><td class="num">${fmt(r.sltn_sl)}</td><td class="num">${fmt(r.sltn_mau)}</td>
        <td><span class="badge ${r.is_active ? "success" : "danger"}">${r.is_active ? "Active" : "Ngưng"}</span></td>
        <td class="right"><button class="tiny" data-edit-product='${attrJson(r)}'>Sửa</button></td>
      </tr>`).join("") || emptyRow(10);
    $("productsPage").textContent = data.page;
    setPagerState("products", data);
    $$('[data-edit-product]').forEach((btn) => btn.addEventListener("click", () => openProductDialog(safeJson(btn.dataset.editProduct))));
  } catch (err) { toast(err.message, "error"); }
}

function openProductDialog(r = null) {
  $("productDialogTitle").textContent = r ? "Sửa mã hàng" : "Thêm mã hàng";
  $("productId").value = r?.id || "";
  $("productCode").value = r?.product_code || "";
  $("productName").value = r?.product_name || "";
  $("productUnit").value = r?.unit || "PCS";
  $("productSltnTotal").value = r?.sltn_total ?? 0;
  $("productSltnSl").value = r?.sltn_sl ?? 0;
  $("productSltnMau").value = r?.sltn_mau ?? 0;
  $("productCustomer").value = r?.customer_name || "";
  $("productGroup").value = r?.item_group || "";
  $("productNote").value = r?.note || "";
  $("productActive").value = r?.is_active === 0 ? "0" : "1";
  $("productDialog").showModal();
}

// =========================================================
// Docs: imports / exports
// =========================================================

function bindDocs(kind, docType) {
  $(`${kind}SearchBtn`).addEventListener("click", () => { state.pages[kind] = 1; loadDocs(kind, docType); });
  $(`${kind}Search`).addEventListener("keydown", (e) => { if (e.key === "Enter") { state.pages[kind] = 1; loadDocs(kind, docType); } });
  $(`${kind}AddBtn`).addEventListener("click", () => openDocDialog(docType));
  bindPager(kind, () => loadDocs(kind, docType));
}

async function loadDocs(kind, docType) {
  try {
    const data = await api(`/api/docs${qs({
      type: docType,
      q: $(`${kind}Search`).value.trim(),
      date_from: $(`${kind}DateFrom`).value,
      date_to: $(`${kind}DateTo`).value,
      page: state.pages[kind],
      limit: PAGE_LIMIT,
    })}`);
    const tbody = $(`${kind}Tbody`);
    tbody.innerHTML = data.rows.map((r) => kind === "imports" ? renderImportRow(r) : renderExportRow(r)).join("") || emptyRow(11);
    $(`${kind}Page`).textContent = data.page;
    setPagerState(kind, data);
    $$(`[data-view-doc]`, tbody).forEach((btn) => btn.addEventListener("click", () => openDocDialog(docType, btn.dataset.viewDoc)));
    $$(`[data-cancel-doc]`, tbody).forEach((btn) => btn.addEventListener("click", () => cancelDoc(btn.dataset.cancelDoc, kind, docType)));
  } catch (err) { toast(err.message, "error"); }
}

function renderImportRow(r) {
  return `<tr>
    <td>${esc(displayDate(r.doc_date))}</td>
    <td>${esc(r.description)}</td>
    <td>${fmt(r.line_count)}</td>
    <td class="num">${fmt(r.qty_total)}</td>
    <td class="num">${fmtMoney(r.unit_price_usd, 4)}</td>
    <td class="num">${fmtMoney(r.unit_price_vnd)}</td>
    <td class="num good">${fmtMoney(r.amount_usd, 2)}</td>
    <td class="num good">${fmtMoney(r.amount_vnd)}</td>
    <td>${esc(r.source_sheet || "manual")}</td>
    <td><span class="badge">${esc(r.status)}</span></td>
    <td class="right"><button class="tiny" data-view-doc="${esc(r.id)}">Chi tiết</button> <button class="tiny danger admin-staff" data-cancel-doc="${esc(r.id)}">Hủy</button></td>
  </tr>`;
}

function renderExportRow(r) {
  return `<tr>
    <td>${esc(displayDate(r.doc_date))}</td>
    <td>${esc(r.invoice_no)}</td>
    <td>${esc(r.description)}</td>
    <td>${fmt(r.line_count)}</td>
    <td class="num">${fmt(r.qty_total)}</td>
    <td class="num">${fmtMoney(r.unit_price_usd, 4)}</td>
    <td class="num">${fmtMoney(r.unit_price_vnd)}</td>
    <td class="num bad">${fmtMoney(r.amount_usd, 2)}</td>
    <td class="num bad">${fmtMoney(r.amount_vnd)}</td>
    <td>${esc(r.source_sheet || "manual")}</td>
    <td class="right"><button class="tiny" data-view-doc="${esc(r.id)}">Chi tiết</button> <button class="tiny danger admin-staff" data-cancel-doc="${esc(r.id)}">Hủy</button></td>
  </tr>`;
}

async function openDocDialog(docType, id = "") {
  $("docDialogTitle").textContent = id ? "Sửa phiếu" : (docType === "IMPORT" ? "Thêm phiếu nhập" : "Thêm phiếu xuất");
  $("docId").value = id;
  $("docType").value = docType;
  $("docDate").value = today();
  $("docVoucherNo").value = "";
  $("docInvoiceNo").value = "";
  $("docPartner").value = "";
  $("docDescription").value = docType === "IMPORT" ? "NHẬP TP" : "Xuất TP";
  $("docNote").value = "";
  $("docLinesBox").innerHTML = "";

  if (id) {
    try {
      const data = await api(`/api/docs/${encodeURIComponent(id)}`);
      const d = data.doc;
      $("docType").value = d.doc_type;
      $("docDate").value = d.doc_date;
      $("docVoucherNo").value = d.voucher_no || "";
      $("docInvoiceNo").value = d.invoice_no || "";
      $("docPartner").value = d.partner_name || "";
      $("docDescription").value = d.description || "";
      $("docNote").value = d.note || "";
      (data.lines || []).forEach((line) => addDocLine(d.doc_type, line));
    } catch (err) { toast(err.message, "error"); return; }
  } else {
    addDocLine(docType);
  }

  applyRoleVisibility();
  $("docDialog").showModal();
}

function addDocLine(docType, line = null) {
  const type = docType || $("docType").value || "IMPORT";
  const box = document.createElement("div");
  box.className = "doc-line-card";
  const idx = $$(".doc-line-card", $("docLinesBox")).length + 1;
  const splits = line?.splits || [];
  const qtyOf = (code) => {
    const found = splits.find((s) => s.bucket_code === code);
    return found ? Number(found.quantity || 0) : "";
  };
  const importBuckets = ["KHO", "KHO_TK", "KM", "TK", "TOP"];
  const exportBuckets = ["TP", "CHUYEN_KHO_TK", "KHO_TK", "MAU"];
  const buckets = type === "EXPORT" ? exportBuckets : importBuckets;
  box.innerHTML = `
    <div class="line-title"><strong>Dòng ${idx}</strong><button class="tiny danger" type="button" data-remove-line>Gỡ</button></div>
    <div class="form-grid compact">
      <label>Mã hàng <input class="line-code" value="${esc(line?.product_code || "")}" required /></label>
      <label>Tên hàng <input class="line-name" value="${esc(line?.product_name || "")}" /></label>
      <label>ĐVT <input class="line-unit" value="${esc(line?.unit || "PCS")}" /></label>
      <label>ĐG USD <input class="line-price-usd" type="number" step="0.0001" value="${line?.unit_price_usd ?? ""}" /></label>
      <label>ĐG VND <input class="line-price-vnd" type="number" step="0.01" value="${line?.unit_price_vnd ?? ""}" /></label>
      <label>TT USD <input class="line-amount-usd" type="number" step="0.01" value="${line?.amount_usd ?? ""}" /></label>
      <label>TT VND <input class="line-amount-vnd" type="number" step="0.01" value="${line?.amount_vnd ?? ""}" /></label>
      <label>Ghi chú <input class="line-note" value="${esc(line?.note || "")}" /></label>
    </div>
    <div class="bucket-grid">
      ${buckets.map((b) => `<label>${bucketLabel(b)}<input class="line-bucket" data-bucket="${b}" type="number" step="0.01" min="0" value="${qtyOf(b)}" /></label>`).join("")}
    </div>
    <p class="form-help line-help">Thành tiền sẽ tự tính = tổng số lượng × đơn giá. Có thể sửa tay nếu cần.</p>`;
  box.querySelector("[data-remove-line]").addEventListener("click", () => box.remove());
  box.querySelectorAll(".line-amount-usd, .line-amount-vnd").forEach((input) => {
    if (input.value) input.dataset.manual = "1";
    input.addEventListener("input", () => { input.dataset.manual = input.value ? "1" : "0"; });
  });
  box.querySelectorAll(".line-bucket, .line-price-usd, .line-price-vnd").forEach((input) => {
    input.addEventListener("input", () => refreshLineAmounts(box, false));
  });
  $("docLinesBox").appendChild(box);
  refreshLineAmounts(box, true);
}

function lineQtyTotal(card) {
  return Array.from(card.querySelectorAll(".line-bucket")).reduce((sum, input) => sum + Number(input.value || 0), 0);
}

function refreshLineAmounts(card, initial = false) {
  const total = lineQtyTotal(card);
  const usd = nullableNumber(card.querySelector(".line-price-usd")?.value);
  const vnd = nullableNumber(card.querySelector(".line-price-vnd")?.value);
  const amountUsd = card.querySelector(".line-amount-usd");
  const amountVnd = card.querySelector(".line-amount-vnd");
  if (amountUsd && usd !== null && amountUsd.dataset.manual !== "1") {
    amountUsd.value = roundMoney(total * usd, 2) || "";
  }
  if (amountVnd && vnd !== null && amountVnd.dataset.manual !== "1") {
    amountVnd.value = roundMoney(total * vnd, 2) || "";
  }
}

$("addDocLineBtn")?.addEventListener("click", () => addDocLine($("docType").value));

$("docForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const id = $("docId").value;
    const docType = $("docType").value;
    const payload = {
      doc_type: docType,
      doc_date: $("docDate").value,
      voucher_no: $("docVoucherNo").value.trim(),
      invoice_no: $("docInvoiceNo").value.trim(),
      partner_name: $("docPartner").value.trim(),
      description: $("docDescription").value.trim(),
      note: $("docNote").value.trim(),
      lines: collectDocLines(docType),
    };
    if (!payload.lines.length) throw new Error("Phiếu phải có ít nhất 1 dòng có số lượng");
    if (id) await api(`/api/docs/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
    else await api("/api/docs", { method: "POST", body: payload });
    closeDialog("docDialog");
    toast("Đã lưu phiếu", "success");
    await loadCurrentView();
  } catch (err) { toast(err.message, "error"); }
});

function collectDocLines(docType) {
  const out = [];
  $$(".doc-line-card", $("docLinesBox")).forEach((card) => {
    const productCode = card.querySelector(".line-code").value.trim();
    const quantities = {};
    card.querySelectorAll(".line-bucket").forEach((input) => {
      const n = Number(input.value || 0);
      if (n > 0) quantities[input.dataset.bucket] = n;
    });
    const total = Object.values(quantities).reduce((a, b) => a + Number(b || 0), 0);
    if (productCode && total > 0) {
      out.push({
        product_code: productCode,
        product_name: card.querySelector(".line-name").value.trim(),
        unit: card.querySelector(".line-unit").value.trim() || "PCS",
        qty_total: total,
        quantities,
        unit_price_usd: nullableNumber(card.querySelector(".line-price-usd").value),
        unit_price_vnd: nullableNumber(card.querySelector(".line-price-vnd").value),
        amount_usd: docLineAmount(card, "usd", total),
        amount_vnd: docLineAmount(card, "vnd", total),
        price_month: Number(($("docDate").value || today()).slice(5, 7)) || null,
        note: card.querySelector(".line-note").value.trim(),
      });
    }
  });
  return out;
}

function docLineAmount(card, currency, total) {
  const priceSelector = currency === "usd" ? ".line-price-usd" : ".line-price-vnd";
  const amountSelector = currency === "usd" ? ".line-amount-usd" : ".line-amount-vnd";
  const entered = nullableNumber(card.querySelector(amountSelector)?.value);
  if (entered !== null) return entered;
  const price = nullableNumber(card.querySelector(priceSelector)?.value);
  return price !== null ? roundMoney(total * price, 2) : null;
}

async function cancelDoc(id, kind, docType) {
  if (!confirm("Hủy phiếu này? Dữ liệu sẽ được ghi log và tính lại tồn.")) return;
  try {
    await api(`/api/docs/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Đã hủy phiếu", "success");
    loadDocs(kind, docType);
  } catch (err) { toast(err.message, "error"); }
}

// =========================================================
// NXT / Ledger
// =========================================================

function bindNxt() {
  $("nxtScopeSelect")?.addEventListener("change", () => {
    state.nxtScope = $("nxtScopeSelect").value || "month";
    state.pages.nxt = 1;
    updatePeriodSelectorState();
    loadNxt();
  });
  $("nxtSearchBtn").addEventListener("click", () => { state.pages.nxt = 1; loadNxt(); });
  $("nxtSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { state.pages.nxt = 1; loadNxt(); } });
  $("nxtRebuildBtn").addEventListener("click", rebuildNxt);
  $("nxtExportBtn").addEventListener("click", () => exportCsv(nxtExportFileName(), state.lastRows.nxt));
  bindPager("nxt", loadNxt);
}

async function loadNxt() {
  try {
    const data = await api(`/api/nxt${qs({
      scope: state.nxtScope || "month",
      year: state.year,
      month: state.month,
      q: $("nxtSearch").value.trim(),
      only_in_stock: $("nxtOnlyStock").checked ? 1 : "",
      only_moved: $("nxtOnlyMoved").checked ? 1 : "",
      page: state.pages.nxt,
      limit: PAGE_LIMIT,
    })}`);
    state.lastRows.nxt = data.rows || [];
    if ($("nxtScopeSelect")) $("nxtScopeSelect").value = state.nxtScope || "month";
    updatePeriodSelectorState();
    $("nxtTbody").innerHTML = data.rows.map((r) => `<tr>
      <td><strong>${esc(r.product_code)}</strong></td><td>${esc(r.product_name)}</td><td>${esc(r.unit)}</td>
      <td class="num strong">${fmt(r.sltn_total)}</td><td class="num">${fmt(r.sltn_sl)}</td><td class="num">${fmt(r.sltn_mau)}</td>
      <td class="num">${fmt(r.opening_qty)}</td><td class="num good">${fmt(r.import_qty)}</td><td class="num bad">${fmt(r.export_qty)}</td>
      <td class="num">${fmt(r.adjustment_qty)}</td><td class="num strong">${fmt(r.closing_qty)}</td>
      <td class="num">${fmtMoney(r.unit_price_usd, 4)}</td><td class="num">${fmtMoney(r.unit_price_vnd)}</td>
      <td class="num good">${fmtMoney(r.import_amount_usd, 2)}</td><td class="num bad">${fmtMoney(r.export_amount_vnd)}</td>
    </tr>`).join("") || emptyRow(15);
    $("nxtPage").textContent = data.page;
    setPagerState("nxt", data);
  } catch (err) { toast(err.message, "error"); }
}

async function rebuildNxt() {
  try {
    const scope = state.view === "nxt" ? (state.nxtScope || "month") : "month";
    if (scope === "all" && !confirm("Tính lại NXT tất cả các kỳ có thể mất lâu hơn. Tiếp tục?")) return;
    const body = scope === "month"
      ? { scope, period_id: periodId() }
      : { scope, year: state.year };
    const data = await api("/api/nxt/rebuild", { method: "POST", body });
    if (scope === "month") toast(`Đã tính lại ${data.period_id}: ${fmt(data.product_rows)} mã hàng`, "success");
    else toast(`Đã tính lại ${fmt(data.period_count || 0)} kỳ, ${fmt(data.product_rows || 0)} dòng tổng hợp`, "success");
    await loadCurrentView();
  } catch (err) { toast(err.message, "error"); }
}

function nxtExportFileName() {
  const scope = state.nxtScope || "month";
  if (scope === "all") return "tong_hop_nxt_tat_ca.csv";
  if (scope === "year") return `tong_hop_nxt_${state.year}.csv`;
  return `tong_hop_nxt_${periodId()}.csv`;
}

function bindLedger() {
  $("ledgerSearchBtn").addEventListener("click", () => { state.pages.ledger = 1; loadLedger(); });
  $("ledgerSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { state.pages.ledger = 1; loadLedger(); } });
  $("ledgerExportBtn").addEventListener("click", () => exportCsv("so_phat_sinh.csv", state.lastRows.ledger));
  bindPager("ledger", loadLedger);
}

async function loadLedger() {
  try {
    const data = await api(`/api/ledger${qs({
      q: $("ledgerSearch").value.trim(),
      date_from: $("ledgerDateFrom").value,
      date_to: $("ledgerDateTo").value,
      period_id: periodId(),
      page: state.pages.ledger,
      limit: PAGE_LIMIT,
    })}`);
    state.lastRows.ledger = data.rows || [];
    $("ledgerTbody").innerHTML = data.rows.map((r) => `<tr>
      <td>${esc(displayDate(r.doc_date))}</td><td>${esc(r.doc_type)}</td><td><strong>${esc(r.product_code)}</strong></td><td>${esc(r.product_name)}</td>
      <td>${esc(r.bucket_code)}</td><td>${esc(r.direction)}</td><td class="num">${fmt(r.quantity)}</td>
      <td class="num">${fmtMoney(r.unit_price_usd, 4)}</td><td class="num">${fmtMoney(r.unit_price_vnd)}</td>
      <td class="num">${fmtMoney(r.amount_usd, 2)}</td><td class="num">${fmtMoney(r.amount_vnd)}</td><td>${esc(r.description)}</td>
    </tr>`).join("") || emptyRow(12);
    $("ledgerPage").textContent = data.page;
    setPagerState("ledger", data);
  } catch (err) { toast(err.message, "error"); }
}

// =========================================================
// Excel import
// =========================================================

function bindImportExcel() {
  $("previewExcelBtn").addEventListener("click", previewExcel);
  $("uploadExcelBtn").addEventListener("click", uploadExcel);
}

async function previewExcel() {
  try {
    const file = $("excelFileInput").files[0];
    if (!file) throw new Error("Vui lòng chọn file Excel");
    setProgress("Đang đọc file Excel...", 15);
    const rows = await parseExcelFile(file);
    state.excelRows = rows;
    state.lastRows.excelPreview = rows.slice(0, 200);
    $("excelPreviewTbody").innerHTML = rows.slice(0, 200).map((r) => `<tr>
      <td>${esc(r.source_sheet)}</td><td>${esc(r.source_row)}</td><td>${esc(r.doc_date || "")}</td><td><strong>${esc(r.product_code)}</strong></td>
      <td>${esc(r.product_name)}</td><td class="num">${fmt(r.kind === "PRODUCT" ? r.sltn_total : r.qty_total)}</td>
      <td class="num">${r.kind === "PRODUCT" ? "" : fmtMoney(r.unit_price_usd, 4)}</td><td class="num">${r.kind === "PRODUCT" ? "" : fmtMoney(r.unit_price_vnd)}</td>
      <td class="num">${r.kind === "PRODUCT" ? "" : fmtMoney(r.amount_usd, 2)}</td><td class="num">${r.kind === "PRODUCT" ? "" : fmtMoney(r.amount_vnd)}</td>
      <td>${esc(r.kind === "PRODUCT" ? ("SL: " + fmt(r.sltn_sl) + " / Mẫu: " + fmt(r.sltn_mau)) : r.description)}</td>
    </tr>`).join("") || emptyRow(11, "Không tìm thấy dòng hợp lệ");
    setProgress(`Đã đọc ${fmt(rows.length)} dòng hợp lệ. Bảng chỉ xem trước 200 dòng đầu.`, 100);
    toast(`Đã đọc ${fmt(rows.length)} dòng`, "success");
  } catch (err) {
    hideProgress();
    toast(err.message, "error");
  }
}

async function uploadExcel() {
  try {
    if (state.user?.role !== "admin") throw new Error("Chỉ admin được import Excel lên D1");
    const file = $("excelFileInput").files[0];
    if (!file) throw new Error("Vui lòng chọn file Excel");
    if (!state.excelRows.length) await previewExcel();
    if (!state.excelRows.length) throw new Error("Không có dữ liệu hợp lệ để import");
    if (!confirm(`Import ${state.excelRows.length} dòng lên D1?`)) return;

    const isProductImport = state.excelRows.every((r) => r.kind === "PRODUCT");

    if (isProductImport) {
      let done = 0, inserted = 0, updated = 0, errors = 0;
      const batches = [];
      for (let i = 0; i < state.excelRows.length; i += IMPORT_BATCH_SIZE) batches.push(state.excelRows.slice(i, i + IMPORT_BATCH_SIZE));
      for (let i = 0; i < batches.length; i++) {
        setProgress(`Đang cập nhật danh mục/SLTN lô ${i + 1}/${batches.length}...`, Math.round((i / batches.length) * 90) + 5);
        const res = await api("/api/products/bulk-upsert", { method: "POST", body: { rows: batches[i] } });
        done += batches[i].length;
        inserted += Number(res.inserted || 0);
        updated += Number(res.updated || 0);
        errors += Number(res.errors || 0);
      }
      setProgress(`Xong: ${fmt(done)} mã hàng, thêm ${fmt(inserted)}, cập nhật ${fmt(updated)}, lỗi ${fmt(errors)}.`, 100);
      toast(errors ? `Cập nhật SLTN xong nhưng có ${errors} dòng lỗi` : "Đã cập nhật danh mục/SLTN", errors ? "warn" : "success");
      state.pages.products = 1;
      setView("products");
      return;
    }

    const job = await api("/api/import-jobs", { method: "POST", body: { file_name: file.name, file_size: file.size, source_note: "Import từ giao diện web" } });
    const jobId = job.job_id;
    let done = 0, inserted = 0, skipped = 0, errors = 0;
    const groups = groupBy(state.excelRows, (r) => r.source_sheet);
    const allBatches = [];
    Object.entries(groups).forEach(([sheet, rows]) => {
      for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) allBatches.push({ sheet, rows: rows.slice(i, i + IMPORT_BATCH_SIZE) });
    });

    for (let i = 0; i < allBatches.length; i++) {
      const b = allBatches[i];
      setProgress(`Đang gửi lô ${i + 1}/${allBatches.length} (${b.sheet})...`, Math.round((i / allBatches.length) * 90) + 5);
      const res = await api(`/api/import-jobs/${encodeURIComponent(jobId)}/rows`, { method: "POST", body: { source_sheet: b.sheet, rows: b.rows } });
      done += b.rows.length;
      inserted += Number(res.inserted || 0);
      skipped += Number(res.skipped || 0);
      errors += Number(res.errors || 0);
    }
    setProgress(`Xong: gửi ${fmt(done)}, nhập ${fmt(inserted)}, bỏ qua ${fmt(skipped)}, lỗi ${fmt(errors)}.`, 100);
    toast(errors ? `Import xong nhưng có ${errors} dòng lỗi` : "Import thành công", errors ? "warn" : "success");
    await loadDashboard();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function parseExcelFile(file) {
  if (!window.XLSX) throw new Error("Chưa tải được thư viện SheetJS. Kiểm tra mạng hoặc file xlsx.full.min.js.");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: true });
  const mode = $("excelSheetMode").value;
  const startRow = Math.max(1, Number($("excelStartRow").value || 1));
  const rows = [];
  if (mode === "PRODUCTS") {
    const name = findSheet(wb, ["TONGHOPNX", "TongHopNX", "Tổng hợp", "Tong Hop"]);
    if (name) rows.push(...parseTongHopProductsSheet(wb.Sheets[name], startRow));
    return rows.filter((r) => r.kind === "PRODUCT" && r.product_code);
  }
  if (mode === "BOTH" || mode === "NHAP") {
    const name = findSheet(wb, ["NHAP", "Nhập", "Nhap"]);
    if (name) rows.push(...parseNhapSheet(wb.Sheets[name], startRow));
  }
  if (mode === "BOTH" || mode === "XUAT") {
    const name = findSheet(wb, ["XUAT", "Xuất", "Xuat"]);
    if (name) rows.push(...parseXuatSheet(wb.Sheets[name], startRow));
  }
  return rows.filter((r) => r.doc_date && r.product_code && Number(r.qty_total || 0) > 0);
}

function findSheet(wb, names) {
  return wb.SheetNames.find((n) => names.some((x) => normalizeVietnamese(n) === normalizeVietnamese(x))) ||
    wb.SheetNames.find((n) => names.some((x) => normalizeVietnamese(n).includes(normalizeVietnamese(x))));
}

function sheetToRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
}


function normalizeHeaderKey(v) {
  return normalizeVietnamese(v).replace(/[^A-Z0-9]/g, "");
}

function buildHeaderMap(row) {
  const map = {};
  (row || []).forEach((h, i) => {
    const key = normalizeHeaderKey(h);
    if (key && map[key] === undefined) map[key] = i;
  });
  return map;
}

function headerIndex(map, names) {
  for (const name of names) {
    const key = normalizeHeaderKey(name);
    if (map[key] !== undefined) return map[key];
  }
  return -1;
}

function headerValue(row, map, names) {
  const idx = headerIndex(map, names);
  return idx >= 0 ? row[idx] : "";
}

function headerText(row, map, names) {
  return clean(headerValue(row, map, names));
}

function headerNum(row, map, names) {
  return num(headerValue(row, map, names));
}

function findHeaderConfig(rows, startRow) {
  const candidates = [];
  const a = Math.max(0, startRow - 1);
  const b = Math.max(0, startRow - 2);
  candidates.push(a);
  if (b !== a) candidates.push(b);
  // Dự phòng cho file mẫu: nếu người dùng để startRow sai, vẫn dò 10 dòng đầu.
  for (let i = 0; i < Math.min(10, rows.length); i++) if (!candidates.includes(i)) candidates.push(i);

  for (const idx of candidates) {
    const map = buildHeaderMap(rows[idx] || []);
    const hasNgay = headerIndex(map, ["Ngày", "Ngay", "Date", "Doc date"]) >= 0;
    const hasMa = headerIndex(map, ["Mã hàng", "Ma hang", "Product code", "Code"]) >= 0;
    const hasQty = headerIndex(map, ["Tổng SL", "Tong SL", "Qty total", "Số lượng", "So luong"]) >= 0;
    if (hasNgay && hasMa && hasQty) return { headerRow: idx, map };
  }
  return null;
}

function monthFromIsoDate(iso) {
  const m = String(iso || "").match(/^\d{4}-(\d{2})-/);
  return m ? Number(m[1]) : null;
}

function firstNhapPriceFromHeaders(row, map) {
  for (let m = 1; m <= 12; m++) {
    const v = headerNum(row, map, [`ĐG nhập T${m} USD`, `DG nhập T${m} USD`, `Đơn giá nhập T${m} USD`, `Don gia nhap T${m} USD`]);
    if (v > 0) return { month: m, usd: v };
  }
  return null;
}

function firstXuatPriceFromHeaders(row, map) {
  for (let m = 1; m <= 12; m++) {
    const usd = headerNum(row, map, [`ĐG xuất T${m} USD`, `DG xuất T${m} USD`, `Đơn giá xuất T${m} USD`, `Don gia xuat T${m} USD`]);
    const vnd = headerNum(row, map, [`ĐG xuất T${m} VND`, `DG xuất T${m} VND`, `Đơn giá xuất T${m} VND`, `Don gia xuat T${m} VND`]);
    if (usd > 0 || vnd > 0) return { month: m, usd: usd || null, vnd: vnd || null };
  }
  return null;
}

function parseTongHopProductsSheet(sheet, startRow) {
  const a = sheetToRows(sheet);
  const rows = [];
  // TongHopNX trong file hiện tại: dòng tiêu đề nằm quanh dòng 4-5, dữ liệu bắt đầu từ dòng 7.
  // Vẫn cho startRow = 1 để app tự bỏ qua dòng tiêu đề/TOTAL.
  for (let i = Math.max(0, startRow - 1); i < a.length; i++) {
    const r = a[i] || [];
    const productCode = clean(r[4]) || clean(r[1]);
    if (!productCode || isTotalRow(productCode) || productCode.toUpperCase() === "MÃ HÀNG") continue;
    const productName = clean(r[5]);
    const unit = clean(r[6]) || "PCS";
    const sltnTotal = num(r[7]);
    const sltnSl = num(r[8]);
    const sltnMau = num(r[9]);
    if (!sltnTotal && !sltnSl && !sltnMau && !productName) continue;
    rows.push({
      kind: "PRODUCT",
      source_sheet: "TONGHOPNX",
      source_row: i + 1,
      product_code: productCode,
      product_name: productName,
      unit,
      customer_name: clean(r[3]),
      item_group: clean(r[2]),
      sltn_total: sltnTotal,
      sltn_sl: sltnSl,
      sltn_mau: sltnMau,
      raw_json: compactRaw(r),
    });
  }
  return rows;
}

function parseNhapSheet(sheet, startRow) {
  const a = sheetToRows(sheet);
  const cfg = findHeaderConfig(a, startRow);
  if (cfg) return parseNhapSheetByHeaderRows(a, cfg, startRow);
  return parseNhapSheetByPositionRows(a, startRow);
}

function parseNhapSheetByHeaderRows(a, cfg, startRow) {
  const rows = [];
  const map = cfg.map;
  const dataStart = Math.max(cfg.headerRow + 1, startRow > cfg.headerRow + 1 ? startRow - 1 : cfg.headerRow + 1);
  for (let i = dataStart; i < a.length; i++) {
    const r = a[i] || [];
    const productCode = headerText(r, map, ["Mã hàng", "Ma hang", "Product code", "Code"]);
    if (!productCode || isTotalRow(productCode)) continue;
    const docDate = excelDateToIso(headerValue(r, map, ["Ngày", "Ngay", "Date", "Doc date"]));
    const unitPriceDirectUsd = headerNum(r, map, ["ĐG USD", "DG USD", "Đơn giá USD", "Don gia USD", "Unit price USD"]);
    const unitPriceDirectVnd = headerNum(r, map, ["ĐG VND", "DG VND", "Đơn giá VND", "Don gia VND", "Unit price VND"]);
    const monthlyPrice = firstNhapPriceFromHeaders(r, map);
    const row = {
      source_sheet: "NHAP",
      source_row: i + 1,
      doc_type: "IMPORT",
      doc_date: docDate,
      description: headerText(r, map, ["Diễn giải", "Dien giai", "Description"]) || "NHẬP",
      product_code: productCode,
      product_name: headerText(r, map, ["Tên hàng", "Ten hang", "Product name", "Name"]),
      unit: headerText(r, map, ["ĐVT", "DVT", "Unit"]) || "PCS",
      qty_total: headerNum(r, map, ["Tổng SL", "Tong SL", "Qty total", "Số lượng", "So luong"]),
      unit_price_usd: unitPriceDirectUsd || monthlyPrice?.usd || null,
      unit_price_vnd: unitPriceDirectVnd || null,
      amount_usd: headerNum(r, map, ["TT USD", "Thành tiền USD", "Thanh tien USD", "Amount USD"]),
      amount_vnd: headerNum(r, map, ["TT VND", "Thành tiền VND", "Thanh tien VND", "Amount VND"]),
      ton_dau_ky_kho: headerNum(r, map, ["Tồn ĐK KHO", "Ton DK KHO", "Opening KHO"]),
      ton_dau_ky_kho_tk: headerNum(r, map, ["Tồn ĐK KHO TK", "Ton DK KHO TK", "Opening KHO TK"]),
      ton_dau_ky_km: headerNum(r, map, ["Tồn ĐK KM", "Ton DK KM", "Opening KM"]),
      ton_dau_ky_tk: headerNum(r, map, ["Tồn ĐK TK", "Ton DK TK", "Opening TK"]),
      ton_dau_ky_top: headerNum(r, map, ["Tồn ĐK TOP", "Ton DK TOP", "Opening TOP"]),
      nhap_pstk_kho: headerNum(r, map, ["Nhập PSTK KHO", "Nhap PSTK KHO", "Nhập KHO", "Nhap KHO", "Qty KHO"]),
      nhap_pstk_kho_tk: headerNum(r, map, ["Nhập PSTK KHO TK", "Nhap PSTK KHO TK", "Nhập KHO TK", "Nhap KHO TK", "Qty KHO TK"]),
      nhap_pstk_km: headerNum(r, map, ["Nhập PSTK KM", "Nhap PSTK KM", "Nhập KM", "Nhap KM", "Qty KM"]),
      nhap_pstk_tk: headerNum(r, map, ["Nhập PSTK TK", "Nhap PSTK TK", "Nhập TK", "Nhap TK", "Qty TK"]),
      nhap_pstk_top: headerNum(r, map, ["Nhập PSTK TOP", "Nhap PSTK TOP", "Nhập TOP", "Nhap TOP", "Qty TOP"]),
      raw_json: compactRaw(r),
    };
    if (!row.qty_total) row.qty_total = sumNums([row.ton_dau_ky_kho, row.ton_dau_ky_kho_tk, row.ton_dau_ky_km, row.ton_dau_ky_tk, row.ton_dau_ky_top, row.nhap_pstk_kho, row.nhap_pstk_kho_tk, row.nhap_pstk_km, row.nhap_pstk_tk, row.nhap_pstk_top]);
    row.price_month = monthlyPrice?.month || monthFromIsoDate(row.doc_date);
    if (!row.amount_usd && row.qty_total && row.unit_price_usd) row.amount_usd = roundMoney(row.qty_total * row.unit_price_usd, 2);
    if (!row.amount_vnd && row.qty_total && row.unit_price_vnd) row.amount_vnd = roundMoney(row.qty_total * row.unit_price_vnd, 0);
    rows.push(row);
  }
  return rows;
}

function parseNhapSheetByPositionRows(a, startRow) {
  const rows = [];
  for (let i = startRow - 1; i < a.length; i++) {
    const r = a[i] || [];
    const productCode = clean(r[2]);
    if (!productCode || isTotalRow(productCode)) continue;
    const docDate = excelDateToIso(r[0]);
    const row = {
      source_sheet: "NHAP",
      source_row: i + 1,
      doc_type: "IMPORT",
      doc_date: docDate,
      description: clean(r[1]) || "NHẬP",
      product_code: productCode,
      product_name: clean(r[3]),
      unit: clean(r[4]) || "PCS",
      qty_total: num(r[5]) || sumNums([r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15]]),
      ton_dau_ky_kho: num(r[6]),
      ton_dau_ky_kho_tk: num(r[7]),
      ton_dau_ky_km: num(r[8]),
      ton_dau_ky_tk: num(r[9]),
      ton_dau_ky_top: num(r[10]),
      nhap_pstk_kho: num(r[11]),
      nhap_pstk_kho_tk: num(r[12]),
      nhap_pstk_km: num(r[13]),
      nhap_pstk_tk: num(r[14]),
      nhap_pstk_top: num(r[15]),
      amount_usd: num(r[28]),
      raw_json: compactRaw(r),
    };
    const p = firstPriceMonth(r, 16, 27);
    if (p) { row.price_month = p.month; row.unit_price_usd = p.value; }
    rows.push(row);
  }
  return rows;
}

function parseXuatSheet(sheet, startRow) {
  const a = sheetToRows(sheet);
  const cfg = findHeaderConfig(a, startRow);
  if (cfg) return parseXuatSheetByHeaderRows(a, cfg, startRow);
  return parseXuatSheetByPositionRows(a, startRow);
}

function parseXuatSheetByHeaderRows(a, cfg, startRow) {
  const rows = [];
  const map = cfg.map;
  const dataStart = Math.max(cfg.headerRow + 1, startRow > cfg.headerRow + 1 ? startRow - 1 : cfg.headerRow + 1);
  for (let i = dataStart; i < a.length; i++) {
    const r = a[i] || [];
    const productCode = headerText(r, map, ["Mã hàng", "Ma hang", "Product code", "Code"]);
    if (!productCode || isTotalRow(productCode)) continue;
    const docDate = excelDateToIso(headerValue(r, map, ["Ngày", "Ngay", "Date", "Doc date"]));
    const unitPriceDirectUsd = headerNum(r, map, ["ĐG USD", "DG USD", "Đơn giá USD", "Don gia USD", "Unit price USD"]);
    const unitPriceDirectVnd = headerNum(r, map, ["ĐG VND", "DG VND", "Đơn giá VND", "Don gia VND", "Unit price VND"]);
    const monthlyPrice = firstXuatPriceFromHeaders(r, map);
    const row = {
      source_sheet: "XUAT",
      source_row: i + 1,
      doc_type: "EXPORT",
      doc_date: docDate,
      invoice_no: headerText(r, map, ["Số hóa đơn", "So hoa don", "Invoice no", "Invoice"]),
      description: headerText(r, map, ["Diễn giải", "Dien giai", "Description"]) || "XUẤT",
      product_code: productCode,
      product_name: headerText(r, map, ["Tên hàng", "Ten hang", "Product name", "Name"]),
      unit: headerText(r, map, ["ĐVT", "DVT", "Unit"]) || "PCS",
      qty_total: headerNum(r, map, ["Tổng SL", "Tong SL", "Qty total", "Số lượng", "So luong"]),
      unit_price_usd: unitPriceDirectUsd || monthlyPrice?.usd || null,
      unit_price_vnd: unitPriceDirectVnd || monthlyPrice?.vnd || null,
      amount_usd: headerNum(r, map, ["TT USD", "Thành tiền USD", "Thanh tien USD", "Amount USD"]),
      amount_vnd: headerNum(r, map, ["TT VND", "Thành tiền VND", "Thanh tien VND", "Amount VND"]),
      xuat_dau_ky_tp: headerNum(r, map, ["Xuất ĐK TP", "Xuat DK TP", "Opening out TP"]),
      xuat_dau_ky_chuyen_kho_tk: headerNum(r, map, ["Xuất ĐK Chuyển kho TK", "Xuat DK Chuyen kho TK", "Opening out Chuyen kho TK"]),
      xuat_dau_ky_kho_tk: headerNum(r, map, ["Xuất ĐK KHO TK", "Xuat DK KHO TK", "Opening out KHO TK"]),
      xuat_dau_ky_mau: headerNum(r, map, ["Xuất ĐK Mẫu", "Xuat DK Mau", "Opening out Mau"]),
      xuat_pstk_tp: headerNum(r, map, ["Xuất PSTK TP", "Xuat PSTK TP", "Xuất TP", "Xuat TP", "Qty TP"]),
      xuat_pstk_chuyen_kho_tk: headerNum(r, map, ["Xuất PSTK Chuyển kho TK", "Xuat PSTK Chuyen kho TK", "Chuyển kho TK", "Chuyen kho TK", "Qty Chuyen kho TK"]),
      xuat_pstk_kho_tk: headerNum(r, map, ["Xuất PSTK KHO TK", "Xuat PSTK KHO TK", "Xuất KHO TK", "Xuat KHO TK", "Qty KHO TK"]),
      xuat_pstk_mau: headerNum(r, map, ["Xuất PSTK Mẫu", "Xuat PSTK Mau", "Xuất Mẫu", "Xuat Mau", "Qty Mau"]),
      raw_json: compactRaw(r),
    };
    if (!row.qty_total) row.qty_total = sumNums([row.xuat_dau_ky_tp, row.xuat_dau_ky_chuyen_kho_tk, row.xuat_dau_ky_kho_tk, row.xuat_dau_ky_mau, row.xuat_pstk_tp, row.xuat_pstk_chuyen_kho_tk, row.xuat_pstk_kho_tk, row.xuat_pstk_mau]);
    row.price_month = monthlyPrice?.month || monthFromIsoDate(row.doc_date);
    if (!row.amount_usd && row.qty_total && row.unit_price_usd) row.amount_usd = roundMoney(row.qty_total * row.unit_price_usd, 2);
    if (!row.amount_vnd && row.qty_total && row.unit_price_vnd) row.amount_vnd = roundMoney(row.qty_total * row.unit_price_vnd, 0);
    rows.push(row);
  }
  return rows;
}

function parseXuatSheetByPositionRows(a, startRow) {
  const rows = [];
  for (let i = startRow - 1; i < a.length; i++) {
    const r = a[i] || [];
    const productCode = clean(r[3]);
    if (!productCode || isTotalRow(productCode)) continue;
    const docDate = excelDateToIso(r[0]);
    const row = {
      source_sheet: "XUAT",
      source_row: i + 1,
      doc_type: "EXPORT",
      doc_date: docDate,
      invoice_no: clean(r[1]),
      description: clean(r[2]) || "XUẤT",
      product_code: productCode,
      product_name: clean(r[4]),
      unit: clean(r[5]) || "PCS",
      qty_total: num(r[6]) || sumNums([r[7], r[8], r[9], r[10], r[12], r[13], r[14], r[15]]),
      xuat_dau_ky_tp: num(r[7]),
      xuat_dau_ky_chuyen_kho_tk: num(r[8]),
      xuat_dau_ky_kho_tk: num(r[9]),
      xuat_dau_ky_mau: num(r[10]) || num(r[11]),
      xuat_pstk_tp: num(r[12]),
      xuat_pstk_chuyen_kho_tk: num(r[13]),
      xuat_pstk_kho_tk: num(r[14]),
      xuat_pstk_mau: num(r[15]),
      amount_vnd: num(r[40]) || num(r[41]),
      raw_json: compactRaw(r),
    };
    const p = firstXuatPrice(r);
    if (p) { row.price_month = p.month; row.unit_price_usd = p.usd; row.unit_price_vnd = p.vnd; }
    rows.push(row);
  }
  return rows;
}

function firstPriceMonth(row, from, to) {
  for (let c = from; c <= to; c++) {
    const v = num(row[c]);
    if (v > 0) return { month: c - from + 1, value: v };
  }
  return null;
}

function firstXuatPrice(row) {
  // XUAT: từ cột Q trở đi là từng tháng USD/VND: Q/R, S/T, U/V...
  for (let m = 1, c = 16; m <= 12; m++, c += 2) {
    const usd = num(row[c]);
    const vnd = num(row[c + 1]);
    if (usd > 0 || vnd > 0) return { month: m, usd: usd || null, vnd: vnd || null };
  }
  return null;
}

function compactRaw(row) {
  const obj = {};
  row.forEach((v, i) => { if (v !== "" && v !== null && v !== undefined) obj[`c${i + 1}`] = v; });
  return obj;
}

// =========================================================
// Periods / Audit / Users
// =========================================================

function bindPeriods() { $("periodsReloadBtn").addEventListener("click", loadPeriods); }

async function loadPeriods() {
  try {
    const data = await api(`/api/periods${qs({ year: state.year })}`);
    $("periodsTbody").innerHTML = data.rows.map((r) => `<tr>
      <td><strong>${esc(r.id)}</strong></td><td>${esc(displayDate(r.start_date))}</td><td>${esc(displayDate(r.end_date))}</td>
      <td><span class="badge ${r.status === "locked" ? "danger" : "success"}">${r.status === "locked" ? "Đã khóa" : "Đang mở"}</span></td>
      <td>${esc(displayDateTime(r.locked_at))}</td><td>${esc(r.note)}</td>
      <td class="right">${r.status === "locked" ? `<button class="tiny admin-only" data-unlock-period="${esc(r.id)}">Mở khóa</button>` : `<button class="tiny danger admin-only" data-lock-period="${esc(r.id)}">Khóa</button>`}</td>
    </tr>`).join("") || emptyRow(7);
    $$('[data-lock-period]').forEach((b) => b.addEventListener("click", () => lockPeriod(b.dataset.lockPeriod)));
    $$('[data-unlock-period]').forEach((b) => b.addEventListener("click", () => unlockPeriod(b.dataset.unlockPeriod)));
    applyRoleVisibility();
  } catch (err) { toast(err.message, "error"); }
}

async function lockPeriod(id) {
  const note = prompt(`Ghi chú khóa kỳ ${id}:`, "Đã chốt số liệu");
  if (note === null) return;
  try { await api(`/api/periods/${encodeURIComponent(id)}/lock`, { method: "POST", body: { note } }); toast("Đã khóa kỳ", "success"); loadPeriods(); } catch (err) { toast(err.message, "error"); }
}

async function unlockPeriod(id) {
  if (!confirm(`Mở khóa kỳ ${id}?`)) return;
  try { await api(`/api/periods/${encodeURIComponent(id)}/unlock`, { method: "POST", body: {} }); toast("Đã mở khóa kỳ", "success"); loadPeriods(); } catch (err) { toast(err.message, "error"); }
}

function bindAudit() {
  $("auditSearchBtn").addEventListener("click", () => { state.pages.audit = 1; loadAudit(); });
  $("auditSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { state.pages.audit = 1; loadAudit(); } });
  bindPager("audit", loadAudit);
}

async function loadAudit() {
  try {
    const data = await api(`/api/audit${qs({ q: $("auditSearch").value.trim(), page: state.pages.audit, limit: PAGE_LIMIT })}`);
    $("auditTbody").innerHTML = data.rows.map((r) => `<tr>
      <td>${esc(displayDateTime(r.created_at))}</td><td>${esc(r.username)}</td><td>${esc(r.action)}</td><td>${esc(r.entity_type)}</td>
      <td>${esc(r.period_id)}</td><td>${esc(r.product_code)}</td><td>${esc(r.ip_address)}</td>
    </tr>`).join("") || emptyRow(7);
    $("auditPage").textContent = data.page;
    setPagerState("audit", data);
  } catch (err) { toast(err.message, "error"); }
}

function bindUsers() {
  $("userAddBtn").addEventListener("click", () => openUserDialog());
  $("userForm").addEventListener("submit", saveUser);
}

async function loadUsers() {
  try {
    const data = await api("/api/users");
    $("usersTbody").innerHTML = data.rows.map((r) => `<tr>
      <td><strong>${esc(r.username)}</strong></td><td>${esc(r.display_name)}</td><td>${esc(r.role)}</td>
      <td><span class="badge ${r.is_active ? "success" : "danger"}">${r.is_active ? "Active" : "Khóa"}</span></td>
      <td>${esc(displayDateTime(r.last_login_at))}</td>
      <td class="right"><button class="tiny" data-edit-user='${attrJson(r)}'>Sửa</button> <button class="tiny" data-reset-pass="${esc(r.id)}">Đổi mật khẩu</button></td>
    </tr>`).join("") || emptyRow(6);
    $$('[data-edit-user]').forEach((b) => b.addEventListener("click", () => openUserDialog(safeJson(b.dataset.editUser))));
    $$('[data-reset-pass]').forEach((b) => b.addEventListener("click", () => resetPassword(b.dataset.resetPass)));
  } catch (err) { toast(err.message, "error"); }
}

function openUserDialog(r = null) {
  $("userDialogTitle").textContent = r ? "Sửa tài khoản" : "Thêm tài khoản";
  $("userId").value = r?.id || "";
  $("userUsername").value = r?.username || "";
  $("userUsername").disabled = !!r;
  $("userDisplayName").value = r?.display_name || "";
  $("userRole").value = r?.role || "staff";
  $("userActive").value = r?.is_active === 0 ? "0" : "1";
  $("userPassword").value = "";
  $("userPasswordWrap").classList.toggle("hidden", !!r);
  $("userDialog").showModal();
}

async function saveUser(e) {
  e.preventDefault();
  try {
    const id = $("userId").value;
    const payload = {
      username: $("userUsername").value.trim(),
      display_name: $("userDisplayName").value.trim() || $("userUsername").value.trim(),
      role: $("userRole").value,
      is_active: $("userActive").value === "1",
    };
    if (id) await api(`/api/users/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
    else {
      payload.password = $("userPassword").value;
      if (!payload.password) throw new Error("Vui lòng nhập mật khẩu");
      await api("/api/users", { method: "POST", body: payload });
    }
    closeDialog("userDialog");
    toast("Đã lưu tài khoản", "success");
    loadUsers();
  } catch (err) { toast(err.message, "error"); }
}

async function resetPassword(id) {
  const password = prompt("Nhập mật khẩu mới:");
  if (!password) return;
  try { await api(`/api/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: { password } }); toast("Đã đổi mật khẩu", "success"); } catch (err) { toast(err.message, "error"); }
}

// =========================================================
// Helpers
// =========================================================

function bindDialogs() {
  $$('[data-close-dialog]').forEach((btn) => btn.addEventListener("click", () => btn.closest("dialog")?.close()));
  $$('dialog').forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
}

function closeDialog(id) { $(id)?.close(); }

function setButtonLoading(btn, loading, text = "Đang xử lý...") {
  if (!btn) return;
  if (loading) {
    btn.dataset.oldText = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.oldText || btn.textContent;
    btn.disabled = false;
  }
}


function bindPager(kind, loader) {
  $(`${kind}Prev`)?.addEventListener("click", () => { if (state.pages[kind] > 1) { state.pages[kind]--; loader(); } });
  $(`${kind}Next`)?.addEventListener("click", () => { state.pages[kind]++; loader(); });
}

function setPagerState(kind, data) {
  const prev = $(`${kind}Prev`);
  const next = $(`${kind}Next`);
  if (prev) prev.disabled = data.page <= 1;
  if (next) next.disabled = !data.has_more;
  applyRoleVisibility();
}

function bucketLabel(code) {
  const b = state.buckets.find((x) => x.code === code);
  return b?.name || code.replaceAll("_", " ");
}

function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("toastHost").appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 250); }, 4200);
}

function setProgress(text, pct) {
  const p = $("importProgress");
  p.classList.remove("hidden");
  p.querySelector("span").style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
  p.dataset.text = text;
}
function hideProgress() { $("importProgress").classList.add("hidden"); }

function emptyRow(cols, text = "Không có dữ liệu") { return `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`; }
function esc(v) { return String(v ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function attrJson(v) { return esc(JSON.stringify(v || {})); }
function safeJson(s) { try { return JSON.parse(s || "null"); } catch { return null; } }
function fmt(v) { const n = Number(v || 0); return Number.isFinite(n) ? n.toLocaleString("vi-VN", { maximumFractionDigits: 2 }) : "0"; }
function fmtMoney(v, maxDigits = 2) { const n = Number(v || 0); return Number.isFinite(n) ? n.toLocaleString("vi-VN", { minimumFractionDigits: 0, maximumFractionDigits: maxDigits }) : "0"; }
function roundMoney(v, digits = 2) { const n = Number(v || 0); if (!Number.isFinite(n)) return 0; const f = 10 ** digits; return Math.round(n * f) / f; }
function num(v) { if (v === null || v === undefined || v === "" || v === "-" || String(v).startsWith("0x")) return 0; const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : 0; }
function nullableNumber(v) { const n = num(v); return n || null; }
function clean(v) { if (v === null || v === undefined) return ""; const s = String(v).trim(); return s.startsWith("0x") ? "" : s; }
function sumNums(list) { return list.reduce((sum, x) => sum + num(x), 0); }
function isTotalRow(v) { const s = clean(v).toUpperCase(); return !s || s.includes("TOTAL") || s.includes("TỔNG"); }
function today() { return new Date().toISOString().slice(0, 10); }
function displayDate(v) { return v ? String(v).slice(0, 10).split("-").reverse().join("/") : ""; }
function displayDateTime(v) { return v ? new Date(v).toLocaleString("vi-VN") : ""; }
function groupBy(arr, fn) { return arr.reduce((m, x) => { const k = fn(x); (m[k] ||= []).push(x); return m; }, {}); }
function normalizeVietnamese(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, ""); }

function excelDateToIso(v) {
  if (!v && v !== 0) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const utcDays = Math.floor(v - 25569);
    return new Date(utcDays * 86400 * 1000).toISOString().slice(0, 10);
  }
  const s = clean(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function exportCsv(filename, rows) {
  if (!rows || !rows.length) { toast("Không có dữ liệu để xuất", "warn"); return; }
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function csvCell(v) { const s = String(v ?? "").replace(/"/g, '""'); return /[",\n]/.test(s) ? `"${s}"` : s; }
