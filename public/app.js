const content = document.querySelector("#content");
const pageTitle = document.querySelector("#page-title");
const nav = document.querySelector("#nav");
const assetDialog = document.querySelector("#asset-dialog");
const assetDetail = document.querySelector("#asset-detail");
const actionDialog = document.querySelector("#action-dialog");
const actionDetail = document.querySelector("#action-detail");
const toast = document.querySelector("#toast");

document.querySelector("#today").textContent = new Intl.DateTimeFormat("en-ZA", {
  day: "2-digit", month: "short", year: "numeric"
}).format(new Date());

const state = {
  view: "overview",
  assets: [],
  pendingTransactionId: null
};

const esc = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const fmtDate = (value) => value
  ? new Intl.DateTimeFormat("en-ZA", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value))
  : "—";

const fmtDateTime = (value) => value
  ? new Intl.DateTimeFormat("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
  : "—";

const todayInput = () => new Date().toISOString().slice(0, 10);
const health = (value) => `<span class="health ${esc(value)}">${esc(value)}</span>`;

async function api(path, options = {}) {
  const init = { ...options };
  if (init.body && typeof init.body !== "string") {
    init.headers = { "content-type": "application/json", ...(init.headers ?? {}) };
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(path, init);
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(data?.error ?? `Request failed: ${response.status}`);
  return data;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function loading() {
  content.innerHTML = '<div class="empty">Loading home state…</div>';
}

function fail(error) {
  console.error(error);
  content.innerHTML = `<div class="error">${esc(error?.message ?? "Homely could not load this view.")}</div>`;
}

function timelineMarkup(items) {
  if (!items.length) return '<div class="empty">No history recorded.</div>';
  return `<div>${items.map((item) => `
    <article class="timeline-item">
      <div class="timeline-date">${fmtDate(item.occurred_at)}</div>
      <div>
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.summary ?? "")}</p>
        ${item.asset_name ? `<div class="row-meta">${esc(item.asset_name)} · ${esc(item.event_type.replaceAll("_", " "))}</div>` : ""}
      </div>
    </article>
  `).join("")}</div>`;
}

async function showOverview() {
  loading();
  try {
    const data = await api("/api/overview");
    const attentionRows = [
      ...data.attention.issues.map((item) => `
        <div class="list-row">
          <div class="row-main">
            <div class="row-copy clickable" data-asset="${esc(item.asset_id)}">
              <div class="row-title">${esc(item.title)}</div>
              <div class="row-meta">${esc(item.asset_name)} · ${esc(item.system_name)}</div>
            </div>
            <span class="badge open">${esc(item.severity)}</span>
          </div>
        </div>`),
      ...data.attention.maintenance.map((item) => `
        <div class="list-row">
          <div class="row-main">
            <div class="row-copy clickable" data-asset="${esc(item.asset_id)}">
              <div class="row-title">${esc(item.title)}</div>
              <div class="row-meta">${esc(item.asset_name)} · due ${fmtDate(item.next_due_at)}</div>
            </div>
            <span class="badge overdue">${item.days_overdue}d overdue</span>
          </div>
        </div>`)
    ].join("");

    content.innerHTML = `
      <div class="hero">
        <div>
          <p class="eyebrow">ACTIVE PROPERTY</p>
          <div class="home-title">${esc(data.home.name)}</div>
          <p class="lede">Local, persistent property state with deterministic health. ${data.summary.systems_needing_attention} systems currently require attention.</p>
        </div>
        <div class="summary-strip">
          <div class="metric"><strong>${data.summary.systems_needing_attention}</strong><span>systems need attention</span></div>
          <div class="metric"><strong>${data.summary.open_issues}</strong><span>active issues</span></div>
          <div class="metric"><strong>${data.summary.overdue_maintenance}</strong><span>overdue maintenance</span></div>
        </div>
      </div>
      <section class="section">
        <div class="section-head">
          <h2>Home health</h2>
          <span class="section-note">Derived from recorded state</span>
        </div>
        <div class="system-grid">
          ${data.systems.map((system) => `
            <article class="system">
              <div class="system-top"><h3>${esc(system.name)}</h3>${health(system.health)}</div>
              <p>${system.asset_count} recorded asset${system.asset_count === 1 ? "" : "s"}</p>
            </article>
          `).join("")}
        </div>
      </section>
      <div class="two-col">
        <section class="section">
          <div class="section-head"><h2>Needs attention</h2></div>
          <div class="list">${attentionRows || '<div class="empty">Nothing requires attention.</div>'}</div>
        </section>
        <section class="section">
          <div class="section-head"><h2>Upcoming</h2><span class="section-note">Next 30 days</span></div>
          <div class="list">
            ${data.upcoming.map((item) => `
              <div class="list-row">
                <div class="row-main">
                  <div class="row-copy clickable" data-asset="${esc(item.asset_id)}">
                    <div class="row-title">${esc(item.title)}</div>
                    <div class="row-meta">${esc(item.asset_name)} · ${fmtDate(item.next_due_at)}</div>
                  </div>
                  <span class="badge">${item.days_until}d</span>
                </div>
              </div>
            `).join("") || '<div class="empty">No maintenance due in the next 30 days.</div>'}
          </div>
        </section>
      </div>
      <section class="section">
        <div class="section-head"><h2>Recent history</h2></div>
        ${timelineMarkup(data.recent)}
      </section>
    `;
    wireAssetLinks();
  } catch (error) { fail(error); }
}

async function showAssets() {
  loading();
  try {
    state.assets = await api("/api/assets");
    content.innerHTML = `
      <div class="asset-toolbar">
        <input id="asset-search" class="search" type="search" placeholder="Search assets, systems, locations…" aria-label="Search assets">
      </div>
      <div id="asset-results"></div>
    `;
    renderAssets(state.assets);
    document.querySelector("#asset-search").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      renderAssets(state.assets.filter((asset) =>
        [asset.name, asset.system_name, asset.location, asset.manufacturer, asset.model]
          .some((value) => String(value ?? "").toLowerCase().includes(query))
      ));
    });
  } catch (error) { fail(error); }
}

function renderAssets(assets) {
  document.querySelector("#asset-results").innerHTML = `
    <table class="asset-table">
      <thead><tr><th>Asset</th><th>Health</th><th>System</th><th>Location</th><th>Model</th></tr></thead>
      <tbody>
        ${assets.map((asset) => `
          <tr data-asset="${esc(asset.id)}">
            <td>${esc(asset.name)}</td>
            <td>${health(asset.health)}</td>
            <td>${esc(asset.system_name)}</td>
            <td>${esc(asset.location ?? "—")}</td>
            <td>${esc(asset.model ?? "—")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  wireAssetLinks();
}

async function showIssues() {
  loading();
  try {
    const items = await api("/api/issues");
    content.innerHTML = `
      <section class="section">
        <div class="section-head">
          <div><h2>Issue register</h2><span class="section-note">Resolved history is retained</span></div>
          <div class="section-actions"><button class="button primary" id="report-issue">Report issue</button></div>
        </div>
        <div class="list">
          ${items.map((item) => {
            const active = !["RESOLVED", "CLOSED"].includes(item.status);
            return `
              <div class="list-row">
                <div class="row-main">
                  <div class="row-copy clickable" data-asset="${esc(item.asset_id)}">
                    <div class="row-title">${esc(item.title)}</div>
                    <div class="row-meta">${esc(item.asset_name)} · detected ${fmtDate(item.detected_at)}</div>
                    <div class="row-meta">${esc(item.description ?? "")}</div>
                  </div>
                  <div class="row-actions">
                    <span class="badge ${active ? "open" : ""}">${esc(item.status)}</span>
                    ${active ? `<button class="button small" data-resolve="${esc(item.id)}" data-title="${esc(item.title)}">Resolve</button>` : ""}
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    `;
    document.querySelector("#report-issue").addEventListener("click", openIssueForm);
    document.querySelectorAll("[data-resolve]").forEach((button) =>
      button.addEventListener("click", () => openResolveForm(button.dataset.resolve, button.dataset.title))
    );
    wireAssetLinks();
  } catch (error) { fail(error); }
}

async function showMaintenance() {
  loading();
  try {
    const items = await api("/api/maintenance");
    content.innerHTML = `
      <section class="section">
        <div class="section-head">
          <div><h2>Maintenance obligations</h2><span class="section-note">Deterministic due dates</span></div>
          <div class="section-actions"><button class="button primary" id="plan-maintenance">Plan maintenance</button></div>
        </div>
        <div class="list">
          ${items.map((item) => `
            <div class="list-row">
              <div class="row-main">
                <div class="row-copy clickable" data-asset="${esc(item.asset_id)}">
                  <div class="row-title">${esc(item.title)}</div>
                  <div class="row-meta">${esc(item.asset_name)} · due ${fmtDate(item.next_due_at)}</div>
                  <div class="row-meta">Last completed: ${fmtDate(item.last_completed_at)}${item.interval_days ? ` · every ${item.interval_days} days` : " · one-off"}</div>
                </div>
                <div class="row-actions">
                  <span class="badge ${item.due_state === "OVERDUE" ? "overdue" : ""}">${esc(item.due_state)}</span>
                  <button class="button small" data-complete="${esc(item.id)}" data-title="${esc(item.title)}">Complete</button>
                </div>
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    `;
    document.querySelector("#plan-maintenance").addEventListener("click", openMaintenanceForm);
    document.querySelectorAll("[data-complete]").forEach((button) =>
      button.addEventListener("click", () => openCompleteForm(button.dataset.complete, button.dataset.title))
    );
    wireAssetLinks();
  } catch (error) { fail(error); }
}

async function showTimeline() {
  loading();
  try {
    content.innerHTML = `
      <section class="section">
        <div class="section-head"><h2>House timeline</h2><span class="section-note">Unified property history</span></div>
        ${timelineMarkup(await api("/api/timeline"))}
      </section>
    `;
  } catch (error) { fail(error); }
}

async function showTransactions() {
  loading();
  try {
    const items = await api("/api/transactions");
    content.innerHTML = `
      <section class="section">
        <div class="section-head">
          <div><h2>Transactions</h2><span class="section-note">Proposals, approvals, changes and reversals</span></div>
        </div>
        <div class="transaction-list">
          ${items.map((item) => {
            const canUndo = item.status === "COMMITTED" && item.action_type !== "UNDO";
            return `
              <article class="transaction-row">
                <div>
                  <div class="row-main">
                    <div class="transaction-title">${esc(item.action_type.replaceAll("_", " "))}</div>
                    <span class="status ${esc(item.status)}">${esc(item.status)}</span>
                  </div>
                  <div class="row-meta">${esc(item.reason)} · ${fmtDateTime(item.created_at)} · ${item.change_count} recorded change${Number(item.change_count) === 1 ? "" : "s"}</div>
                  <div class="transaction-id">${esc(item.id)}</div>
                </div>
                <div class="row-actions">
                  ${canUndo ? `<button class="button danger small" data-undo="${esc(item.id)}" data-reason="${esc(item.reason)}">Undo</button>` : ""}
                </div>
              </article>
            `;
          }).join("") || '<div class="empty">No transactions recorded yet.</div>'}
        </div>
      </section>
    `;
    document.querySelectorAll("[data-undo]").forEach((button) =>
      button.addEventListener("click", () => openUndoConfirmation(button.dataset.undo, button.dataset.reason))
    );
  } catch (error) { fail(error); }
}

async function openAsset(assetId) {
  try {
    const asset = await api(`/api/assets/${encodeURIComponent(assetId)}`);
    assetDetail.innerHTML = `
      <div class="asset-detail-head">
        <p class="eyebrow">${esc(asset.system_name)}</p>
        <h2>${esc(asset.name)}</h2>
        ${health(asset.health)}
        <div class="row-meta">${esc(asset.location ?? "Location not recorded")}</div>
      </div>
      <div class="detail-grid">
        ${field("Manufacturer", asset.manufacturer)}
        ${field("Model", asset.model)}
        ${field("Serial number", asset.serial_number)}
        ${field("Installed", fmtDate(asset.installation_date))}
        ${field("Contractor", asset.contractor)}
        ${field("Warranty ends", fmtDate(asset.warranty_end))}
      </div>
      ${asset.notes ? `<section class="detail-section"><h3>Notes</h3><div class="muted">${esc(asset.notes)}</div></section>` : ""}
      <section class="detail-section">
        <h3>Issues</h3>
        <div class="list">
          ${asset.issues.map((issue) => `<div class="list-row"><div class="row-main"><div><div class="row-title">${esc(issue.title)}</div><div class="row-meta">${fmtDate(issue.detected_at)} · ${esc(issue.severity)}</div></div><span class="badge">${esc(issue.status)}</span></div></div>`).join("") || '<div class="empty">No issues recorded.</div>'}
        </div>
      </section>
      <section class="detail-section">
        <h3>Documents</h3>
        <div class="list">
          ${asset.documents.map((doc) => `<div class="list-row"><a class="doc-link" href="${esc(doc.local_path ?? "#")}" target="_blank" rel="noreferrer">${esc(doc.title)}</a><div class="row-meta">${esc(doc.type)} · ${esc(doc.provider)}</div></div>`).join("") || '<div class="empty">No documents attached.</div>'}
        </div>
      </section>
      <section class="detail-section"><h3>History</h3>${timelineMarkup(asset.history)}</section>
    `;
    assetDialog.showModal();
  } catch (error) { notify(error.message); }
}

function field(label, value) {
  return `<div class="detail-field"><span>${esc(label)}</span><strong>${esc(value ?? "—")}</strong></div>`;
}

function wireAssetLinks() {
  document.querySelectorAll("[data-asset]").forEach((element) => {
    element.addEventListener("click", () => openAsset(element.dataset.asset));
  });
}

async function assetOptions() {
  if (!state.assets.length) state.assets = await api("/api/assets");
  return state.assets.map((asset) =>
    `<option value="${esc(asset.id)}">${esc(asset.system_name)} — ${esc(asset.name)}</option>`
  ).join("");
}

function openAction(html) {
  state.pendingTransactionId = null;
  actionDetail.innerHTML = html;
  actionDialog.showModal();
}

async function closeAction({ rejectPending = true } = {}) {
  const pending = state.pendingTransactionId;
  state.pendingTransactionId = null;
  if (rejectPending && pending) {
    try { await api(`/api/transactions/${encodeURIComponent(pending)}/reject`, { method: "POST" }); }
    catch (error) { console.error(error); }
  }
  if (actionDialog.open) actionDialog.close();
}

async function openIssueForm() {
  const options = await assetOptions();
  openAction(`
    <p class="eyebrow">STRUCTURED ACTION</p>
    <h2>Report issue</h2>
    <div class="muted">Nothing changes until you review and approve the transaction.</div>
    <form class="action-form" id="issue-form">
      <div class="form-grid">
        <div class="field full"><label>Asset</label><select name="assetId" required>${options}</select></div>
        <div class="field full"><label>Issue title</label><input name="title" maxlength="160" required placeholder="Kitchen tap losing pressure"></div>
        <div class="field"><label>Severity</label><select name="severity"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></div>
        <div class="field"><label>Detected</label><input type="date" name="detectedAt" value="${todayInput()}" required></div>
        <div class="field full"><label>Description</label><textarea name="description" placeholder="What is happening?"></textarea></div>
      </div>
      <div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="button primary">Preview</button></div>
    </form>
  `);
  document.querySelector("[data-cancel]").addEventListener("click", () => closeAction());
  document.querySelector("#issue-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title"));
    await createPreview("REPORT_ISSUE", {
      assetId: data.get("assetId"),
      title,
      severity: data.get("severity"),
      detectedAt: data.get("detectedAt"),
      description: data.get("description")
    }, `Homeowner reported "${title}" through the structured issue form.`);
  });
}

async function openMaintenanceForm() {
  const options = await assetOptions();
  openAction(`
    <p class="eyebrow">STRUCTURED ACTION</p>
    <h2>Plan maintenance</h2>
    <div class="muted">Create a one-off obligation or an optional recurring interval.</div>
    <form class="action-form" id="maintenance-form">
      <div class="form-grid">
        <div class="field full"><label>Asset</label><select name="assetId" required>${options}</select></div>
        <div class="field full"><label>Maintenance title</label><input name="title" maxlength="160" required placeholder="Inspect camera network connection"></div>
        <div class="field"><label>Due date</label><input type="date" name="nextDueAt" value="${todayInput()}" required></div>
        <div class="field"><label>Repeat every (days)</label><input type="number" name="intervalDays" min="1" max="3650" placeholder="Optional"></div>
      </div>
      <div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="button primary">Preview</button></div>
    </form>
  `);
  document.querySelector("[data-cancel]").addEventListener("click", () => closeAction());
  document.querySelector("#maintenance-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title"));
    await createPreview("CREATE_MAINTENANCE", {
      assetId: data.get("assetId"),
      title,
      nextDueAt: data.get("nextDueAt"),
      intervalDays: data.get("intervalDays") || null
    }, `Homeowner planned "${title}" through the structured maintenance form.`);
  });
}

function openResolveForm(issueId, title) {
  openAction(`
    <p class="eyebrow">STRUCTURED ACTION</p>
    <h2>Resolve issue</h2>
    <div class="muted">${esc(title)}</div>
    <form class="action-form" id="resolve-form">
      <div class="field"><label>Resolution note</label><textarea name="resolution" required placeholder="What fixed or closed this issue?"></textarea></div>
      <div class="field"><label>Resolved date</label><input type="date" name="resolvedAt" value="${todayInput()}" required></div>
      <div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="button primary">Preview</button></div>
    </form>
  `);
  document.querySelector("[data-cancel]").addEventListener("click", () => closeAction());
  document.querySelector("#resolve-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await createPreview("RESOLVE_ISSUE", {
      issueId,
      resolution: data.get("resolution"),
      resolvedAt: data.get("resolvedAt")
    }, `Homeowner approved resolution of "${title}".`);
  });
}

function openCompleteForm(maintenanceId, title) {
  openAction(`
    <p class="eyebrow">STRUCTURED ACTION</p>
    <h2>Complete maintenance</h2>
    <div class="muted">${esc(title)}</div>
    <form class="action-form" id="complete-form">
      <div class="field"><label>Completion date</label><input type="date" name="completedAt" value="${todayInput()}" required></div>
      <div class="field"><label>Completion note</label><textarea name="note" placeholder="Optional notes or findings"></textarea></div>
      <div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="button primary">Preview</button></div>
    </form>
  `);
  document.querySelector("[data-cancel]").addEventListener("click", () => closeAction());
  document.querySelector("#complete-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await createPreview("COMPLETE_MAINTENANCE", {
      maintenanceId,
      completedAt: data.get("completedAt"),
      note: data.get("note")
    }, `Homeowner recorded completion of "${title}".`);
  });
}

async function createPreview(actionType, payload, reason) {
  try {
    const result = await api("/api/transactions/preview", {
      method: "POST",
      body: { actionType, payload, reason }
    });
    state.pendingTransactionId = result.transaction.id;
    renderPreview(result);
  } catch (error) {
    notify(error.message);
  }
}

function renderPreview(result) {
  actionDetail.innerHTML = `
    <p class="eyebrow">PROPOSED TRANSACTION</p>
    <div class="proposal">
      <h3>${esc(result.preview.title)}</h3>
      <div class="muted">${esc(result.preview.summary)}</div>
      <div class="proposal-reason"><strong>Reason</strong><br>${esc(result.transaction.reason)}</div>
      <ul class="effect-list">${result.preview.effects.map((effect) => `<li>${esc(effect)}</li>`).join("")}</ul>
      <div class="transaction-id">${esc(result.transaction.id)}</div>
      <div class="form-actions">
        <button class="button" id="reject-action">Reject</button>
        <button class="button primary" id="approve-action">Approve & commit</button>
      </div>
    </div>
  `;
  document.querySelector("#reject-action").addEventListener("click", async () => {
    const id = state.pendingTransactionId;
    if (id) await api(`/api/transactions/${encodeURIComponent(id)}/reject`, { method: "POST" });
    state.pendingTransactionId = null;
    await closeAction({ rejectPending: false });
    notify("Proposal rejected. No home state changed.");
    if (state.view === "transactions") await selectView("transactions");
  });
  document.querySelector("#approve-action").addEventListener("click", async () => {
    const id = state.pendingTransactionId;
    if (!id) return;
    try {
      await api(`/api/transactions/${encodeURIComponent(id)}/commit`, { method: "POST" });
      state.pendingTransactionId = null;
      await closeAction({ rejectPending: false });
      await selectView(state.view);
      notify("Committed. Home state and timeline updated.");
    } catch (error) {
      notify(error.message);
    }
  });
}

function openUndoConfirmation(transactionId, reason) {
  openAction(`
    <p class="eyebrow">REVERSAL</p>
    <h2>Undo transaction?</h2>
    <div class="proposal-reason"><strong>Original reason</strong><br>${esc(reason)}</div>
    <div class="muted">Homely will reverse the recorded state changes only if the affected entities have not changed since this transaction. The audit record will remain.</div>
    <div class="form-actions">
      <button class="button" data-cancel>Cancel</button>
      <button class="button danger" id="confirm-undo">Undo transaction</button>
    </div>
  `);
  document.querySelector("[data-cancel]").addEventListener("click", () => closeAction({ rejectPending: false }));
  document.querySelector("#confirm-undo").addEventListener("click", async () => {
    try {
      await api(`/api/transactions/${encodeURIComponent(transactionId)}/undo`, { method: "POST" });
      await closeAction({ rejectPending: false });
      await selectView(state.view);
      notify("Transaction reversed. Audit history retained.");
    } catch (error) {
      notify(error.message);
    }
  });
}

const views = {
  overview: ["Overview", showOverview],
  assets: ["Assets", showAssets],
  issues: ["Issues", showIssues],
  maintenance: ["Maintenance", showMaintenance],
  timeline: ["Timeline", showTimeline],
  transactions: ["Transactions", showTransactions]
};

async function selectView(view) {
  const entry = views[view] ?? views.overview;
  state.view = view in views ? view : "overview";
  pageTitle.textContent = entry[0];
  document.querySelectorAll(".nav-item").forEach((item) =>
    item.classList.toggle("active", item.dataset.view === state.view)
  );
  await entry[1]();
}

nav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) selectView(button.dataset.view);
});

document.querySelector("#dialog-close").addEventListener("click", () => assetDialog.close());
document.querySelector("#action-dialog-close").addEventListener("click", () => closeAction());
actionDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeAction();
});

selectView("overview");
