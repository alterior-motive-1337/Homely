const content = document.querySelector("#content");
const title = document.querySelector("#page-title");
const nav = document.querySelector("#nav");
const dialog = document.querySelector("#asset-dialog");
const detail = document.querySelector("#asset-detail");

document.querySelector("#today").textContent = new Intl.DateTimeFormat("en-ZA", {
  day: "2-digit",
  month: "short",
  year: "numeric"
}).format(new Date());

const state = {
  view: "overview",
  assets: []
};

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const fmtDate = (value) => value
  ? new Intl.DateTimeFormat("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date(value))
  : "—";

const health = (value) =>
  `<span class="health ${escapeHtml(value)}">${escapeHtml(value)}</span>`;

async function api(path, options = {}) {
  const init = { ...options };
  if (init.body && typeof init.body !== "string") {
    init.headers = { ...(init.headers ?? {}), "content-type": "application/json" };
    init.body = JSON.stringify(init.body);
  }

  const response = await fetch(path, init);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "object" && payload?.error
      ? payload.error
      : `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function loading() {
  content.innerHTML = '<div class="empty">Loading home state…</div>';
}

function fail(error) {
  console.error(error);
  content.innerHTML = `<div class="error">${escapeHtml(error?.message ?? "Homely could not load this view.")}</div>`;
}

async function ensureAssets() {
  if (!state.assets.length) state.assets = await api("/api/assets");
  return state.assets;
}

function assetOptions(assets, selected = "") {
  return [
    '<option value="">Choose an asset…</option>',
    ...assets.map((asset) =>
      `<option value="${escapeHtml(asset.id)}" ${asset.id === selected ? "selected" : ""}>${escapeHtml(asset.system_name)} — ${escapeHtml(asset.name)}</option>`
    )
  ].join("");
}

function timelineMarkup(items) {
  if (!items.length) return '<div class="empty">No history recorded.</div>';

  return `<div>${items.map((item) => `
    <article class="timeline-item">
      <div class="timeline-date">${fmtDate(item.occurred_at)}</div>
      <div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.summary ?? "")}</p>
        ${item.asset_name
          ? `<div class="row-meta">${escapeHtml(item.asset_name)} · ${escapeHtml(item.event_type.replaceAll("_", " "))}</div>`
          : ""}
      </div>
    </article>
  `).join("")}</div>`;
}

function wireAssetLinks() {
  document.querySelectorAll("[data-asset]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, textarea")) return;
      openAsset(element.dataset.asset);
    });
  });
}

async function showOverview() {
  loading();
  try {
    const data = await api("/api/overview");
    const attentionRows = [
      ...data.attention.issues.map((item) => `
        <div class="list-row clickable" data-asset="${escapeHtml(item.asset_id)}">
          <div class="row-main">
            <div>
              <div class="row-title">${escapeHtml(item.title)}</div>
              <div class="row-meta">${escapeHtml(item.asset_name)} · ${escapeHtml(item.system_name)}</div>
            </div>
            <span class="badge open">${escapeHtml(item.severity)}</span>
          </div>
        </div>`),
      ...data.attention.maintenance.map((item) => `
        <div class="list-row clickable" data-asset="${escapeHtml(item.asset_id)}">
          <div class="row-main">
            <div>
              <div class="row-title">${escapeHtml(item.title)}</div>
              <div class="row-meta">${escapeHtml(item.asset_name)} · due ${fmtDate(item.next_due_at)}</div>
            </div>
            <span class="badge overdue">${item.days_overdue}d overdue</span>
          </div>
        </div>`)
    ].join("");

    content.innerHTML = `
      <div class="hero">
        <div>
          <p class="eyebrow">ACTIVE PROPERTY</p>
          <div class="home-title">${escapeHtml(data.home.name)}</div>
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
              <div class="system-top">
                <h3>${escapeHtml(system.name)}</h3>
                ${health(system.health)}
              </div>
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
          <div class="section-head"><h2>Upcoming</h2><span class="section-note">Recurring maintenance · next 30 days</span></div>
          <div class="list">
            ${data.upcoming.map((item) => `
              <div class="list-row clickable" data-asset="${escapeHtml(item.asset_id)}">
                <div class="row-main">
                  <div>
                    <div class="row-title">${escapeHtml(item.title)}</div>
                    <div class="row-meta">${escapeHtml(item.asset_name)} · ${fmtDate(item.next_due_at)}</div>
                  </div>
                  <span class="badge">${item.days_until}d</span>
                </div>
              </div>
            `).join("") || '<div class="empty">No recurring maintenance due in the next 30 days.</div>'}
          </div>
        </section>
      </div>

      <section class="section">
        <div class="section-head"><h2>Recent history</h2></div>
        ${timelineMarkup(data.recent)}
      </section>
    `;
    wireAssetLinks();
  } catch (error) {
    fail(error);
  }
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

    renderAssetRows(state.assets);

    document.querySelector("#asset-search").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      const filtered = state.assets.filter((asset) =>
        [asset.name, asset.system_name, asset.location, asset.manufacturer, asset.model]
          .some((value) => String(value ?? "").toLowerCase().includes(query))
      );
      renderAssetRows(filtered);
    });
  } catch (error) {
    fail(error);
  }
}

function renderAssetRows(assets) {
  const target = document.querySelector("#asset-results");
  target.innerHTML = `
    <table class="asset-table">
      <thead>
        <tr><th>Asset</th><th>Health</th><th>System</th><th>Location</th><th>Model</th></tr>
      </thead>
      <tbody>
        ${assets.map((asset) => `
          <tr data-asset="${escapeHtml(asset.id)}">
            <td>${escapeHtml(asset.name)}</td>
            <td>${health(asset.health)}</td>
            <td>${escapeHtml(asset.system_name)}</td>
            <td>${escapeHtml(asset.location ?? "—")}</td>
            <td>${escapeHtml(asset.model ?? "—")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  wireAssetLinks();
}

function proposalMarkup(transaction) {
  const after = transaction.after ?? {};
  const actionName = transaction.action_type === "REPORT_ISSUE"
    ? "Report issue"
    : "Create maintenance task";

  return `
    <article class="proposal" data-proposal="${escapeHtml(transaction.id)}">
      <p class="eyebrow">PROPOSED ACTION</p>
      <div class="proposal-head">
        <div>
          <h3>${actionName}</h3>
          <div class="row-meta">${escapeHtml(after.title ?? "")}</div>
        </div>
        <span class="badge">${escapeHtml(transaction.status)}</span>
      </div>
      <div class="proposal-reason">
        <span>Reason</span>
        <p>${escapeHtml(transaction.reason)}</p>
      </div>
      <dl class="proposal-diff">
        <div><dt>Asset</dt><dd>${escapeHtml(after.asset_id ?? "—")}</dd></div>
        ${after.severity ? `<div><dt>Severity</dt><dd>${escapeHtml(after.severity)}</dd></div>` : ""}
        ${after.due_at ? `<div><dt>Due</dt><dd>${fmtDate(after.due_at)}</dd></div>` : ""}
        <div><dt>Result</dt><dd>${escapeHtml(transaction.entity_type)} will be created</dd></div>
      </dl>
      <div class="proposal-actions">
        <button class="button primary" data-action="approve">Approve</button>
        <button class="button" data-action="reject">Reject</button>
      </div>
    </article>
  `;
}

function wireProposal(transaction, refresh) {
  const proposal = document.querySelector(`[data-proposal="${CSS.escape(transaction.id)}"]`);
  if (!proposal) return;

  proposal.querySelector('[data-action="approve"]').addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Committing…";
    try {
      await api(`/api/transactions/${encodeURIComponent(transaction.id)}/commit`, { method: "POST" });
      state.assets = [];
      await refresh();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Approve";
      showInlineError(proposal, error);
    }
  });

  proposal.querySelector('[data-action="reject"]').addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api(`/api/transactions/${encodeURIComponent(transaction.id)}/reject`, { method: "POST" });
      await refresh();
    } catch (error) {
      button.disabled = false;
      showInlineError(proposal, error);
    }
  });
}

function showInlineError(container, error) {
  const existing = container.querySelector(".inline-error");
  if (existing) existing.remove();
  const message = document.createElement("div");
  message.className = "inline-error";
  message.textContent = error?.message ?? "The action could not be completed.";
  container.append(message);
}

async function showIssues() {
  loading();
  try {
    const [items, assets] = await Promise.all([
      api("/api/issues"),
      ensureAssets()
    ]);

    content.innerHTML = `
      <section class="compose">
        <div class="section-head">
          <h2>Report an issue</h2>
          <span class="section-note">Preview before anything changes</span>
        </div>
        <form id="issue-form" class="compose-form">
          <label class="field">
            <span>Asset</span>
            <select name="assetId" required>${assetOptions(assets)}</select>
          </label>
          <label class="field">
            <span>Issue</span>
            <input name="title" required maxlength="120" placeholder="Kitchen tap losing pressure">
          </label>
          <label class="field">
            <span>Severity</span>
            <select name="severity">
              <option value="LOW">Low</option>
              <option value="MEDIUM" selected>Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </label>
          <label class="field field-wide">
            <span>Description</span>
            <textarea name="description" rows="3" placeholder="What did you observe?"></textarea>
          </label>
          <div class="field-actions">
            <button class="button primary" type="submit">Preview issue</button>
          </div>
        </form>
        <div id="issue-proposal"></div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Issue register</h2>
          <span class="section-note">Resolved history is retained</span>
        </div>
        <div class="list">
          ${items.map((item) => `
            <div class="list-row clickable" data-asset="${escapeHtml(item.asset_id)}">
              <div class="row-main">
                <div>
                  <div class="row-title">${escapeHtml(item.title)}</div>
                  <div class="row-meta">${escapeHtml(item.asset_name)} · detected ${fmtDate(item.detected_at)}</div>
                  <div class="row-meta">${escapeHtml(item.description ?? "")}</div>
                </div>
                <span class="badge ${["OPEN", "IN_PROGRESS", "MONITORING"].includes(item.status) ? "open" : ""}">${escapeHtml(item.status)}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    `;

    wireAssetLinks();

    document.querySelector("#issue-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form).entries());
      const target = document.querySelector("#issue-proposal");
      target.innerHTML = '<div class="empty compact">Preparing action preview…</div>';

      try {
        const transaction = await api("/api/actions/preview", {
          method: "POST",
          body: {
            type: "REPORT_ISSUE",
            assetId: data.assetId,
            title: data.title,
            severity: data.severity,
            description: data.description
          }
        });
        target.innerHTML = proposalMarkup(transaction);
        wireProposal(transaction, showIssues);
      } catch (error) {
        target.innerHTML = `<div class="inline-error">${escapeHtml(error.message)}</div>`;
      }
    });
  } catch (error) {
    fail(error);
  }
}

async function showMaintenance() {
  loading();
  try {
    const [rules, tasks, assets] = await Promise.all([
      api("/api/maintenance"),
      api("/api/maintenance-tasks"),
      ensureAssets()
    ]);

    content.innerHTML = `
      <section class="compose">
        <div class="section-head">
          <h2>Create a maintenance action</h2>
          <span class="section-note">Human approval required</span>
        </div>
        <form id="maintenance-form" class="compose-form">
          <label class="field">
            <span>Asset</span>
            <select name="assetId" required>${assetOptions(assets)}</select>
          </label>
          <label class="field">
            <span>Task</span>
            <input name="title" required maxlength="120" placeholder="Inspect Camera 4 network path">
          </label>
          <label class="field">
            <span>Due date</span>
            <input name="dueAt" type="date">
          </label>
          <label class="field field-wide">
            <span>Reason</span>
            <textarea name="reason" rows="3" required placeholder="Why should this work be scheduled?"></textarea>
          </label>
          <div class="field-actions">
            <button class="button primary" type="submit">Preview action</button>
          </div>
        </form>
        <div id="maintenance-proposal"></div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Planned actions</h2>
          <span class="section-note">${tasks.filter((task) => task.status !== "COMPLETED").length} active</span>
        </div>
        <div class="list">
          ${tasks.length ? tasks.map((task) => `
            <div class="list-row clickable" data-asset="${escapeHtml(task.asset_id)}">
              <div class="row-main">
                <div>
                  <div class="row-title">${escapeHtml(task.title)}</div>
                  <div class="row-meta">${escapeHtml(task.asset_name)} · due ${fmtDate(task.due_at)}</div>
                  <div class="row-meta">${escapeHtml(task.reason ?? "")}</div>
                </div>
                <span class="badge">${escapeHtml(task.status)}</span>
              </div>
            </div>
          `).join("") : '<div class="empty">No one-off maintenance actions are currently planned.</div>'}
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Recurring maintenance</h2>
          <span class="section-note">Deterministic due dates</span>
        </div>
        <div class="list">
          ${rules.map((item) => `
            <div class="list-row clickable" data-asset="${escapeHtml(item.asset_id)}">
              <div class="row-main">
                <div>
                  <div class="row-title">${escapeHtml(item.title)}</div>
                  <div class="row-meta">${escapeHtml(item.asset_name)} · due ${fmtDate(item.next_due_at)}</div>
                  <div class="row-meta">Last completed: ${fmtDate(item.last_completed_at)}${item.interval_days ? ` · every ${item.interval_days} days` : ""}</div>
                </div>
                <span class="badge ${item.due_state === "OVERDUE" ? "overdue" : ""}">${escapeHtml(item.due_state)}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    `;

    wireAssetLinks();

    document.querySelector("#maintenance-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form).entries());
      const target = document.querySelector("#maintenance-proposal");
      target.innerHTML = '<div class="empty compact">Preparing action preview…</div>';

      try {
        const transaction = await api("/api/actions/preview", {
          method: "POST",
          body: {
            type: "CREATE_MAINTENANCE_TASK",
            assetId: data.assetId,
            title: data.title,
            dueAt: data.dueAt,
            reason: data.reason
          }
        });
        target.innerHTML = proposalMarkup(transaction);
        wireProposal(transaction, showMaintenance);
      } catch (error) {
        target.innerHTML = `<div class="inline-error">${escapeHtml(error.message)}</div>`;
      }
    });
  } catch (error) {
    fail(error);
  }
}

async function showTimeline() {
  loading();
  try {
    const items = await api("/api/timeline");
    content.innerHTML = `
      <section class="section">
        <div class="section-head">
          <h2>House timeline</h2>
          <span class="section-note">Unified property history</span>
        </div>
        ${timelineMarkup(items)}
      </section>
    `;
  } catch (error) {
    fail(error);
  }
}

async function showTransactions() {
  loading();
  try {
    const transactions = await api("/api/transactions");
    content.innerHTML = `
      <section class="section">
        <div class="section-head">
          <h2>Action audit</h2>
          <span class="section-note">Proposals, commits and reversals remain visible</span>
        </div>
        <div class="list">
          ${transactions.length ? transactions.map((transaction) => `
            <article class="list-row transaction-row">
              <div class="row-main">
                <div>
                  <div class="row-title">${escapeHtml(transaction.action_type.replaceAll("_", " "))}</div>
                  <div class="row-meta">${escapeHtml(transaction.reason)}</div>
                  <div class="row-meta">${escapeHtml(transaction.id)} · ${fmtDate(transaction.created_at)}</div>
                </div>
                <div class="transaction-actions">
                  <span class="badge status-${escapeHtml(transaction.status.toLowerCase())}">${escapeHtml(transaction.status)}</span>
                  ${transaction.status === "COMMITTED"
                    ? `<button class="button small" data-undo="${escapeHtml(transaction.id)}">Undo</button>`
                    : ""}
                </div>
              </div>
            </article>
          `).join("") : '<div class="empty">No actions have been proposed yet.</div>'}
        </div>
      </section>
    `;

    document.querySelectorAll("[data-undo]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Undoing…";
        try {
          await api(`/api/transactions/${encodeURIComponent(button.dataset.undo)}/undo`, { method: "POST" });
          state.assets = [];
          await showTransactions();
        } catch (error) {
          button.disabled = false;
          button.textContent = "Undo";
          showInlineError(button.closest(".transaction-row"), error);
        }
      });
    });
  } catch (error) {
    fail(error);
  }
}

async function openAsset(assetId) {
  try {
    const asset = await api(`/api/assets/${encodeURIComponent(assetId)}`);

    detail.innerHTML = `
      <div class="asset-detail-head">
        <p class="eyebrow">${escapeHtml(asset.system_name)}</p>
        <h2>${escapeHtml(asset.name)}</h2>
        ${health(asset.health)}
        <div class="row-meta">${escapeHtml(asset.location ?? "Location not recorded")}</div>
      </div>

      <div class="detail-grid">
        ${field("Manufacturer", asset.manufacturer)}
        ${field("Model", asset.model)}
        ${field("Serial number", asset.serial_number)}
        ${field("Installed", fmtDate(asset.installation_date))}
        ${field("Contractor", asset.contractor)}
        ${field("Warranty ends", fmtDate(asset.warranty_end))}
      </div>

      ${asset.notes
        ? `<section class="detail-section"><h3>Notes</h3><div class="muted">${escapeHtml(asset.notes)}</div></section>`
        : ""}

      <section class="detail-section">
        <h3>Issues</h3>
        <div class="list">
          ${asset.issues.map((issue) => `
            <div class="list-row">
              <div class="row-main">
                <div>
                  <div class="row-title">${escapeHtml(issue.title)}</div>
                  <div class="row-meta">${fmtDate(issue.detected_at)} · ${escapeHtml(issue.severity)}</div>
                </div>
                <span class="badge">${escapeHtml(issue.status)}</span>
              </div>
            </div>
          `).join("") || '<div class="empty">No issues recorded.</div>'}
        </div>
      </section>

      <section class="detail-section">
        <h3>Planned maintenance</h3>
        <div class="list">
          ${asset.maintenance_tasks.map((task) => `
            <div class="list-row">
              <div class="row-title">${escapeHtml(task.title)}</div>
              <div class="row-meta">Due ${fmtDate(task.due_at)} · ${escapeHtml(task.status)}</div>
            </div>
          `).join("") || '<div class="empty">No one-off maintenance actions planned.</div>'}
        </div>
      </section>

      <section class="detail-section">
        <h3>Documents</h3>
        <div class="list">
          ${asset.documents.map((doc) => `
            <div class="list-row">
              <a class="doc-link" href="${escapeHtml(doc.local_path ?? "#")}" target="_blank" rel="noreferrer">${escapeHtml(doc.title)}</a>
              <div class="row-meta">${escapeHtml(doc.type)} · ${escapeHtml(doc.provider)}</div>
            </div>
          `).join("") || '<div class="empty">No documents attached.</div>'}
        </div>
      </section>

      <section class="detail-section">
        <h3>History</h3>
        ${timelineMarkup(asset.history)}
      </section>
    `;

    dialog.showModal();
  } catch (error) {
    console.error(error);
  }
}

function field(label, value) {
  return `<div class="detail-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "—")}</strong></div>`;
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
  state.view = view;
  title.textContent = entry[0];
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  await entry[1]();
}

nav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) selectView(button.dataset.view);
});

document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());

selectView("overview");
