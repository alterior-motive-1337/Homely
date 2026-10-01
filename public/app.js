const content = document.querySelector("#content");
const pageTitle = document.querySelector("#page-title");
const nav = document.querySelector("#nav");
const assetDialog = document.querySelector("#asset-dialog");
const assetDetail = document.querySelector("#asset-detail");
const actionDialog = document.querySelector("#action-dialog");
const actionDetail = document.querySelector("#action-detail");
const toast = document.querySelector("#toast");
const runtimeStatus = document.querySelector("#runtime-status");
const runtimeStatusText = document.querySelector("#runtime-status-text");
const logoutButton = document.querySelector("#logout-button");

document.querySelector("#today").textContent = new Intl.DateTimeFormat("en-ZA", {
  day: "2-digit", month: "short", year: "numeric"
}).format(new Date());

const state = {
  view: "overview",
  assets: [],
  pendingTransactionId: null,
  agentMessages: [],
  agentPreviousResponseId: null,
  agentStatus: null,
  integrations: null
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

function documentHref(doc) {
  const value = String(doc?.web_view_link ?? doc?.local_path ?? "").trim();
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === "https:" || url.protocol === "http:") return value;
  } catch {}
  return null;
}

function documentLink(doc) {
  const href = documentHref(doc);
  return href
    ? `<a class="doc-link" href="${esc(href)}" target="_blank" rel="noreferrer">${esc(doc.title)}</a>`
    : esc(doc.title);
}

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

function loading(label = "Loading home state…") {
  content.innerHTML = '<div class="loading-state"><span class="loading-pulse" aria-hidden="true"></span><span>' + esc(label) + '</span></div>';
}

function setRuntimeStatus(integrations) {
  if (!runtimeStatus || !runtimeStatusText) return;
  const backup = integrations?.backup;
  let tone = "good";
  let label = "Cloud runtime active";

  if (backup?.enabled) {
    if (!backup.connected) {
      tone = "attention";
      label = "Backup not connected";
    } else if (backup.lastError) {
      tone = "failed";
      label = "Backup degraded";
    } else if (backup.lastBackupAt) {
      label = "Drive backup active";
    } else {
      tone = "attention";
      label = "Drive backup ready";
    }
  }

  runtimeStatus.dataset.tone = tone;
  runtimeStatusText.textContent = label;
  runtimeStatus.title = backup?.lastBackupAt ? "Last off-site backup: " + fmtDateTime(backup.lastBackupAt) : label;
}

async function refreshRuntimeStatus() {
  try {
    const integrations = await api("/api/integrations/status");
    state.integrations = integrations;
    setRuntimeStatus(integrations);
    return integrations;
  } catch (error) {
    if (runtimeStatus) runtimeStatus.dataset.tone = "failed";
    if (runtimeStatusText) runtimeStatusText.textContent = "Cloud status unavailable";
    console.error(error);
    return null;
  }
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
    const totalAssets = data.systems.reduce((sum, system) => sum + Number(system.asset_count ?? 0), 0);
    const attentionItems = [
      ...data.attention.issues.map((item) => ({
        kind: "ISSUE",
        title: item.title,
        meta: `${item.asset_name} · ${item.system_name}`,
        assetId: item.asset_id,
        status: item.severity
      })),
      ...data.attention.maintenance.map((item) => ({
        kind: "DUE",
        title: item.title,
        meta: `${item.asset_name} · ${item.days_overdue}d overdue`,
        assetId: item.asset_id,
        status: "OVERDUE"
      }))
    ].slice(0, 4);

    content.innerHTML = `
      <div class="overview-onepage">
        <header class="overview-identity">
          <div>
            <p class="eyebrow">ACTIVE PROPERTY</p>
            <div class="overview-home-name">${esc(data.home.name)}</div>
          </div>
          <div class="overview-actions">
            <button class="text-action" data-route-view="work" data-route-tab="issues">+ issue</button>
            <button class="text-action" data-route-view="work" data-route-tab="maintenance">+ maintenance</button>
            <button class="text-action strong" data-route-view="agent">ask Homely</button>
          </div>
        </header>

        <section class="overview-metrics" aria-label="Home status">
          <div><span>Attention</span><strong>${data.summary.systems_needing_attention}</strong></div>
          <div><span>Open issues</span><strong>${data.summary.open_issues}</strong></div>
          <div><span>Overdue</span><strong>${data.summary.overdue_maintenance}</strong></div>
          <div><span>Assets</span><strong>${totalAssets}</strong></div>
        </section>

        <div class="overview-grid">
          <section class="overview-column overview-priority">
            <div class="overview-section-head">
              <h2>Needs attention</h2>
              <button class="bare-link" data-route-view="work" data-route-tab="issues">Work</button>
            </div>
            <div class="overview-rows">
              ${attentionItems.map((item) => `
                <button class="overview-row" data-asset="${esc(item.assetId)}">
                  <span class="overview-kind">${esc(item.kind)}</span>
                  <span class="overview-row-copy">
                    <strong>${esc(item.title)}</strong>
                    <small>${esc(item.meta)}</small>
                  </span>
                  <span class="overview-row-status">${esc(item.status)}</span>
                </button>
              `).join("") || '<div class="overview-empty">Nothing requires attention.</div>'}
            </div>
          </section>

          <section class="overview-column">
            <div class="overview-section-head">
              <h2>Upcoming</h2>
              <button class="bare-link" data-route-view="work" data-route-tab="maintenance">30 days</button>
            </div>
            <div class="overview-rows">
              ${data.upcoming.slice(0, 4).map((item) => `
                <button class="overview-row" data-asset="${esc(item.asset_id)}">
                  <span class="overview-kind">${Math.max(0, Number(item.days_until))}D</span>
                  <span class="overview-row-copy">
                    <strong>${esc(item.title)}</strong>
                    <small>${esc(item.asset_name)} · ${fmtDate(item.next_due_at)}</small>
                  </span>
                </button>
              `).join("") || '<div class="overview-empty">Nothing due soon.</div>'}
            </div>
          </section>

          <section class="overview-column overview-health">
            <div class="overview-section-head">
              <h2>Systems</h2>
              <button class="bare-link" data-route-view="assets">Assets</button>
            </div>
            <div class="health-matrix">
              ${data.systems.map((system) => `
                <div class="health-matrix-row">
                  <span>${esc(system.name)}</span>
                  ${health(system.health)}
                </div>
              `).join("")}
            </div>
          </section>
        </div>

        <section class="overview-recent">
          <div class="overview-section-head">
            <h2>Recent</h2>
            <button class="bare-link" data-route-view="history" data-route-tab="timeline">History</button>
          </div>
          <div class="recent-strip">
            ${data.recent.slice(0, 3).map((item) => `
              <div class="recent-item">
                <time>${fmtDate(item.occurred_at)}</time>
                <span>${esc(item.title)}</span>
              </div>
            `).join("") || '<div class="overview-empty">No recent activity.</div>'}
          </div>
        </section>
      </div>
    `;

    wireAssetLinks();
    document.querySelectorAll("[data-route-view]").forEach((button) => {
      button.addEventListener("click", () => navigateTo(button.dataset.routeView, button.dataset.routeTab ?? null));
    });
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
    const items = await api("/api/timeline");
    const eventTypes = [...new Set(items.map((item) => item.event_type))].sort();
    content.innerHTML = `
      <section class="section">
        <div class="section-head"><h2>House timeline</h2><span class="section-note">Unified property history</span></div>
        <div class="asset-toolbar">
          <input id="timeline-search" class="search" type="search" placeholder="Search history…" aria-label="Search timeline">
          <select id="timeline-type" class="search" aria-label="Filter timeline by event type">
            <option value="">All event types</option>
            ${eventTypes.map((type) => `<option value="${esc(type)}">${esc(type.replaceAll("_", " "))}</option>`).join("")}
          </select>
        </div>
        <div id="timeline-results"></div>
      </section>
    `;

    const render = () => {
      const query = document.querySelector("#timeline-search").value.trim().toLowerCase();
      const type = document.querySelector("#timeline-type").value;
      const filtered = items.filter((item) => {
        const matchesType = !type || item.event_type === type;
        const haystack = [item.title, item.summary, item.asset_name, item.event_type].map((value) => String(value ?? "").toLowerCase()).join(" ");
        return matchesType && (!query || haystack.includes(query));
      });
      document.querySelector("#timeline-results").innerHTML = timelineMarkup(filtered);
    };

    document.querySelector("#timeline-search").addEventListener("input", render);
    document.querySelector("#timeline-type").addEventListener("change", render);
    render();
  } catch (error) { fail(error); }
}

async function openDriveImport(file) {
  const options = await assetOptions();
  openAction(`
    <p class="eyebrow">GOOGLE DRIVE IMPORT</p>
    <h2>Attach selected document</h2>
    <div class="muted">${esc(file.name)} · ${esc(file.mimeType ?? "unknown type")}</div>
    <form class="action-form" id="drive-import-form">
      <div class="form-grid">
        <div class="field full"><label>Asset</label><select name="assetId" required>${options}</select></div>
        <div class="field"><label>Document type</label>
          <select name="documentType">
            <option>WARRANTY</option><option>MANUAL</option><option>INVOICE</option><option>RECEIPT</option>
            <option>INSPECTION</option><option>PHOTO</option><option>REPORT</option><option selected>OTHER</option>
          </select>
        </div>
        <div class="field"><label>Title</label><input name="title" maxlength="240" value="${esc(file.name)}" required></div>
      </div>
      <div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="button primary">Preview association</button></div>
    </form>
  `);
  document.querySelector("[data-cancel]").addEventListener("click", () => closeAction());
  document.querySelector("#drive-import-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await createPreview("ATTACH_DOCUMENT", {
      assetId: data.get("assetId"),
      title: data.get("title"),
      documentType: data.get("documentType"),
      providerFileId: file.id,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink
    }, `Homeowner selected "${file.name}" in Google Drive and chose an explicit asset association.`);
  });
}

async function showDocuments() {
  loading();
  try {
    const [items, integrations] = await Promise.all([
      api("/api/documents"),
      api("/api/integrations/status")
    ]);
    const drive = integrations.googleDrive;
    const driveStatus = !drive.enabled
      ? "Disabled"
      : !drive.configured
        ? "Not configured"
        : drive.connected
          ? "Connected"
          : "Ready to connect";

    content.innerHTML = `
      <section class="section">
        <div class="section-head">
          <div><h2>Documents</h2><span class="section-note">Evidence remains separate from its storage provider</span></div>
          <div class="section-actions">
            <span class="badge">${esc(driveStatus)}</span>
            ${drive.enabled && drive.configured
              ? drive.connected
                ? `<button class="button" id="drive-select">Select from Drive</button><button class="button small" id="drive-disconnect">Disconnect</button>`
                : `<button class="button" id="drive-connect">Connect Google Drive</button>`
              : ""}
          </div>
        </div>
        <div class="drive-note">
          <strong>Google Drive</strong>
          <span>${drive.enabled
            ? drive.configured
              ? drive.connected
                ? "Per-file access only. Select a file explicitly before Homely can associate it."
                : "Configured with drive.file scope. Connect the dedicated Homely Google account to select files."
              : "Enable Drive only after OAuth credentials are configured."
            : "Optional integration is off. Existing Homely document metadata remains available."}</span>
        </div>
        <div class="asset-toolbar">
          <input id="document-search" class="search" type="search" placeholder="Search warranties, invoices, manuals…" aria-label="Search documents">
        </div>
        <div id="document-results"></div>
      </section>
    `;

    const render = (documents) => {
      document.querySelector("#document-results").innerHTML = `
        <table class="asset-table">
          <thead><tr><th>Document</th><th>Type</th><th>Provider</th><th>Related asset</th><th>System</th></tr></thead>
          <tbody>
            ${documents.map((doc) => `
              <tr>
                <td>${documentLink(doc)}</td>
                <td>${esc(doc.type)}</td>
                <td>${esc(doc.provider)}</td>
                <td>${doc.asset_id ? `<button class="button small" data-asset="${esc(doc.asset_id)}">${esc(doc.asset_name ?? "Asset")}</button>` : "—"}</td>
                <td>${esc(doc.system_name ?? "—")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
      wireAssetLinks();
    };

    render(items);
    document.querySelector("#document-search").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      render(items.filter((doc) =>
        [doc.title, doc.type, doc.provider, doc.asset_name, doc.system_name, doc.issue_title]
          .some((value) => String(value ?? "").toLowerCase().includes(query))
      ));
    });

    document.querySelector("#drive-connect")?.addEventListener("click", () => {
      window.location.href = "/api/google-drive/connect";
    });
    document.querySelector("#drive-select")?.addEventListener("click", () => {
      window.location.href = "/api/google-drive/connect";
    });
    document.querySelector("#drive-disconnect")?.addEventListener("click", async () => {
      await api("/api/google-drive/disconnect", { method: "POST" });
      notify("Google Drive disconnected. Existing Homely document metadata was preserved.");
      await selectView("assets");
    });

    const params = new URLSearchParams(window.location.search);
    const driveError = params.get("driveError");
    const picked = params.get("drivePicked");
    if (driveError) {
      history.replaceState({}, "", "/?view=assets&tab=documents");
      notify("Google Drive selection was cancelled or failed.");
    } else if (picked && drive.connected) {
      history.replaceState({}, "", "/?view=assets&tab=documents");
      const files = await api("/api/google-drive/files?ids=" + encodeURIComponent(picked));
      if (files.length) await openDriveImport(files[0]);
    } else if (params.get("driveConnected")) {
      history.replaceState({}, "", "/?view=assets&tab=documents");
      notify("Google Drive connected. Select a file to attach it to Homely.");
    }
  } catch (error) { fail(error); }
}

function agentMessageMarkup(message) {
  const proposals = Array.isArray(message.proposals) ? message.proposals : [];
  return `
    <article class="agent-message ${esc(message.role)}">
      <div class="agent-role">${message.role === "user" ? "You" : "Homely"}</div>
      <div class="agent-copy">${esc(message.text)}</div>
      ${proposals.map((proposal) => `
        <div class="agent-proposal" data-agent-proposal="${esc(proposal.transactionId)}">
          <div class="row-main">
            <div>
              <div class="row-title">${esc(proposal.preview.title)}</div>
              <div class="row-meta">${esc(proposal.preview.summary)}</div>
            </div>
            <span class="status ${esc(proposal.status ?? "PROPOSED")}">${esc(proposal.status ?? "PROPOSED")}</span>
          </div>
          <div class="proposal-reason"><strong>Reason</strong><br>${esc(proposal.reason)}</div>
          <ul class="effect-list">${proposal.preview.effects.map((effect) => `<li>${esc(effect)}</li>`).join("")}</ul>
          ${(proposal.status ?? "PROPOSED") === "PROPOSED" ? `
            <div class="form-actions">
              <button class="button small" data-agent-reject="${esc(proposal.transactionId)}">Reject</button>
              <button class="button primary small" data-agent-approve="${esc(proposal.transactionId)}">Approve & commit</button>
            </div>
          ` : ""}
        </div>
      `).join("")}
    </article>
  `;
}

function renderAgentConversation() {
  const target = document.querySelector("#agent-conversation");
  if (!target) return;
  target.innerHTML = state.agentMessages.length
    ? state.agentMessages.map(agentMessageMarkup).join("")
    : `<div class="empty">Ask about this home's condition, history, maintenance or a recurring problem.</div>`;

  target.querySelectorAll("[data-agent-approve]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.agentApprove;
      try {
        await api(`/api/transactions/${encodeURIComponent(id)}/commit`, { method: "POST" });
        void refreshRuntimeStatus();
        for (const message of state.agentMessages) {
          const proposal = message.proposals?.find((item) => item.transactionId === id);
          if (proposal) proposal.status = "COMMITTED";
        }
        renderAgentConversation();
        await renderAgentHomeState();
        notify("Agent proposal committed. Home state and timeline updated.");
      } catch (error) {
        notify(error.message);
      }
    });
  });

  target.querySelectorAll("[data-agent-reject]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.agentReject;
      try {
        await api(`/api/transactions/${encodeURIComponent(id)}/reject`, { method: "POST" });
        for (const message of state.agentMessages) {
          const proposal = message.proposals?.find((item) => item.transactionId === id);
          if (proposal) proposal.status = "REJECTED";
        }
        renderAgentConversation();
        notify("Proposal rejected. No home state changed.");
      } catch (error) {
        notify(error.message);
      }
    });
  });

  target.scrollTop = target.scrollHeight;
}

async function renderAgentHomeState() {
  const target = document.querySelector("#agent-home-state");
  if (!target) return;
  try {
    const overview = await api("/api/overview");
    target.innerHTML = `
      <div class="agent-state-title">${esc(overview.home.name)}</div>
      <div class="agent-state-metrics">
        <div><strong>${overview.summary.systems_needing_attention}</strong><span>systems attention</span></div>
        <div><strong>${overview.summary.open_issues}</strong><span>active issues</span></div>
        <div><strong>${overview.summary.overdue_maintenance}</strong><span>overdue</span></div>
      </div>
      <div class="detail-section">
        <h3>Current system state</h3>
        <div class="list">
          ${overview.systems.map((system) => `
            <div class="list-row"><div class="row-main"><span class="row-title">${esc(system.name)}</span>${health(system.health)}</div></div>
          `).join("")}
        </div>
      </div>
    `;
  } catch (error) {
    target.innerHTML = `<div class="error">${esc(error.message)}</div>`;
  }
}

async function showAgent() {
  loading();
  try {
    const integrations = await api("/api/integrations/status");
    state.agentStatus = integrations.ai;

    if (!integrations.ai.available) {
      content.innerHTML = `
        <section class="section">
          <div class="section-head"><h2>Homely Agent</h2><span class="section-note">Optional reasoning layer</span></div>
          <div class="agent-disabled">
            <div>
              <p class="eyebrow">AGENT UNAVAILABLE</p>
              <h3>Structured Homely remains operational.</h3>
              <p>The OpenAI agent is ${integrations.ai.enabled ? "enabled but not configured" : "disabled"}. Assets, issues, maintenance, documents, timeline and transactions remain available from Homely\'s structured property state.</p>
            </div>
            <div class="agent-config">
              <span>AI_ENABLED</span><strong>${integrations.ai.enabled ? "true" : "false"}</strong>
              <span>API key</span><strong>${integrations.ai.configured ? "configured" : "not configured"}</strong>
              <span>Model</span><strong>${esc(integrations.ai.model)}</strong>
            </div>
          </div>
        </section>
      `;
      return;
    }

    content.innerHTML = `
      <div class="agent-layout">
        <aside class="agent-state" id="agent-home-state"><div class="empty">Loading current home state…</div></aside>
        <section class="agent-panel">
          <div class="section-head">
            <div><h2>Homely Agent</h2><span class="section-note">Reads real state · proposals require approval</span></div>
            <span class="badge">${esc(integrations.ai.model)}</span>
          </div>
          <div class="agent-conversation" id="agent-conversation"></div>
          <form class="agent-input" id="agent-form">
            <textarea id="agent-message" maxlength="4000" required placeholder="Ask Homely about this house…"></textarea>
            <button class="button primary" type="submit">Send</button>
          </form>
        </section>
      </div>
    `;

    await renderAgentHomeState();
    renderAgentConversation();

    document.querySelector("#agent-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.querySelector("#agent-message");
      const message = input.value.trim();
      if (!message) return;

      state.agentMessages.push({ role: "user", text: message, proposals: [] });
      input.value = "";
      renderAgentConversation();
      const submit = event.currentTarget.querySelector("button[type=submit]");
      submit.disabled = true;
      submit.textContent = "Working…";

      try {
        const response = await api("/api/agent/respond", {
          method: "POST",
          body: {
            message,
            previousResponseId: state.agentPreviousResponseId
          }
        });
        state.agentPreviousResponseId = response.responseId;
        state.agentMessages.push({
          role: "assistant",
          text: response.text,
          proposals: response.proposals.map((proposal) => ({ ...proposal, status: "PROPOSED" }))
        });
        renderAgentConversation();
      } catch (error) {
        state.agentMessages.push({
          role: "assistant",
          text: error.message,
          proposals: []
        });
        renderAgentConversation();
      } finally {
        submit.disabled = false;
        submit.textContent = "Send";
        input.focus();
      }
    });
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
          ${asset.documents.map((doc) => `<div class="list-row">${documentLink(doc)}<div class="row-meta">${esc(doc.type)} · ${esc(doc.provider)}</div></div>`).join("") || '<div class="empty">No documents attached.</div>'}
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
    if (state.view === "history") await selectView("history");
  });
  document.querySelector("#approve-action").addEventListener("click", async () => {
    const id = state.pendingTransactionId;
    if (!id) return;
    try {
      await api(`/api/transactions/${encodeURIComponent(id)}/commit`, { method: "POST" });
      void refreshRuntimeStatus();
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
      void refreshRuntimeStatus();
      await closeAction({ rejectPending: false });
      await selectView(state.view);
      notify("Transaction reversed. Audit history retained.");
    } catch (error) {
      notify(error.message);
    }
  });
}

function activeRouteTab(allowed, fallback) {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return allowed.includes(tab) ? tab : fallback;
}

function renderViewTabs(view, tabs, active) {
  const bar = document.createElement("div");
  bar.className = "view-tabs";
  bar.setAttribute("aria-label", "Section");
  bar.innerHTML = tabs.map((tab) => `
    <button class="view-tab ${tab.id === active ? "active" : ""}" data-inner-tab="${esc(tab.id)}">${esc(tab.label)}</button>
  `).join("");
  content.prepend(bar);
  bar.querySelectorAll("[data-inner-tab]").forEach((button) => {
    button.addEventListener("click", () => navigateTo(view, button.dataset.innerTab));
  });
}

async function showAssetsHub() {
  const tab = activeRouteTab(["assets", "documents"], "assets");
  if (tab === "documents") await showDocuments();
  else await showAssets();
  renderViewTabs("assets", [
    { id: "assets", label: "Assets" },
    { id: "documents", label: "Documents" }
  ], tab);
}

async function showWork() {
  const tab = activeRouteTab(["issues", "maintenance"], "issues");
  if (tab === "maintenance") await showMaintenance();
  else await showIssues();
  renderViewTabs("work", [
    { id: "issues", label: "Issues" },
    { id: "maintenance", label: "Maintenance" }
  ], tab);
}

async function showHistory() {
  const tab = activeRouteTab(["timeline", "transactions"], "timeline");
  if (tab === "transactions") await showTransactions();
  else await showTimeline();
  renderViewTabs("history", [
    { id: "timeline", label: "Timeline" },
    { id: "transactions", label: "Transactions" }
  ], tab);
}

const views = {
  overview: ["Overview", showOverview],
  assets: ["Assets", showAssetsHub],
  work: ["Work", showWork],
  history: ["History", showHistory],
  agent: ["Agent", showAgent]
};

const legacyRoutes = {
  issues: ["work", "issues"],
  maintenance: ["work", "maintenance"],
  timeline: ["history", "timeline"],
  transactions: ["history", "transactions"],
  documents: ["assets", "documents"]
};

function normalizeRoute(view, tab = null) {
  if (legacyRoutes[view]) {
    const [nextView, nextTab] = legacyRoutes[view];
    return { view: nextView, tab: nextTab };
  }
  return { view: view in views ? view : "overview", tab };
}

async function selectView(view) {
  const entry = views[view] ?? views.overview;
  state.view = view in views ? view : "overview";
  pageTitle.textContent = entry[0];
  document.title = entry[0] + " · Homely";
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.view === state.view;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  await entry[1]();
}

function viewUrl(view, tab = null) {
  if (view === "overview") return "/";
  const params = new URLSearchParams({ view });
  if (tab) params.set("tab", tab);
  return "/?" + params.toString();
}

function navigateTo(view, tab = null, { replace = false } = {}) {
  const route = normalizeRoute(view, tab);
  const url = viewUrl(route.view, route.tab);
  if (replace) history.replaceState({ view: route.view, tab: route.tab }, "", url);
  else history.pushState({ view: route.view, tab: route.tab }, "", url);
  void selectView(route.view);
}

nav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  const defaults = { assets: "assets", work: "issues", history: "timeline" };
  navigateTo(button.dataset.view, defaults[button.dataset.view] ?? null);
});

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  const route = normalizeRoute(params.get("view") ?? "overview", params.get("tab"));
  void selectView(route.view);
});

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/auth/login";
  }
});

document.querySelector("#dialog-close").addEventListener("click", () => assetDialog.close());
document.querySelector("#action-dialog-close").addEventListener("click", () => closeAction());
actionDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeAction();
});

const initialParams = new URLSearchParams(window.location.search);
const initialRoute = normalizeRoute(initialParams.get("view") ?? "overview", initialParams.get("tab"));
if (initialParams.get("view") && initialRoute.view !== initialParams.get("view")) {
  history.replaceState({ view: initialRoute.view, tab: initialRoute.tab }, "", viewUrl(initialRoute.view, initialRoute.tab));
}
void refreshRuntimeStatus();
void selectView(initialRoute.view);
