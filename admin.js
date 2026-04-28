const adminSession = CampusApp.requireRole("admin");
const priorityDrafts = {};
const issueDepartments = [
    "Electrical Maintenance",
    "Civil Maintenance",
    "IT Support",
    "Academic Facilities",
    "Hostel Administration",
    "Housekeeping",
    "Campus Security",
    "General Administration",
];

if (adminSession) {
    const adminName = document.getElementById("adminName");
    if (adminName) {
        adminName.textContent = adminSession.name;
    }

    refreshAdminView();
    window.addEventListener("storage", () => refreshAdminView());
    window.setInterval(refreshAdminView, 5000);
}

function renderAdminStatus(status) {
    if (status === "Resolved") {
        return '<span class="status-badge status-resolved">Resolved</span>';
    }

    if (status === "In Progress") {
        return '<span class="status-badge status-progress">In Progress</span>';
    }

    return '<span class="status-badge status-new">New</span>';
}

function getPrioritySortValue(issue) {
    if (issue.priority === "High") {
        return 300 + Number(issue.priorityScore || 0);
    }
    if (issue.priority === "Medium") {
        return 200 + Number(issue.priorityScore || 0);
    }
    if (issue.priority === "Low") {
        return 100 + Number(issue.priorityScore || 0);
    }
    return 0;
}

function sortIssuesByPriority(issues) {
    return [...issues].sort((left, right) => {
        const priorityDiff = getPrioritySortValue(right) - getPrioritySortValue(left);
        if (priorityDiff !== 0) {
            return priorityDiff;
        }
        return new Date(left.createdAt) - new Date(right.createdAt);
    });
}

function getSearchValue(id) {
    const element = document.getElementById(id);
    return element ? element.value.trim().toLowerCase() : "";
}

function filterIssuesById(issues, searchValue) {
    if (!searchValue) {
        return issues;
    }

    return issues.filter((issue) => issue.id.toLowerCase().includes(searchValue));
}

function filterIssuesByDepartment(issues, departmentValue) {
    if (!departmentValue) {
        return issues;
    }

    if (departmentValue === "__unassigned__") {
        return issues.filter((issue) => !issue.assignedDepartment);
    }

    return issues.filter((issue) => issue.assignedDepartment === departmentValue);
}

function renderActions(issue) {
    if (issue.status === "Resolved") {
        return '<div class="action-row"><span class="helper-text">Completed</span></div>';
    }

    if (issue.status === "In Progress") {
        return `
            <div class="action-row">
                <span class="helper-text">Department: ${issue.assignedDepartment || "Assigned"}</span>
                <span class="helper-text">Priority: ${issue.priority}</span>
                <span class="helper-text">Department updates the status from its queue.</span>
            </div>`;
    }

    const options = issueDepartments
        .map((department) => `<option value="${department}" ${issue.assignedDepartment === department ? "selected" : ""}>${department}</option>`)
        .join("");

    const factors = priorityDrafts[issue.id] || issue.priorityFactors || {};

    return `
        <div class="action-row">
            <select class="department-select" onchange="assignDepartment('${issue.id}', this.value)">
                <option value="">Assign department</option>
                ${options}
            </select>
            <div class="factor-group">
                <label for="urgency-${issue.id}">Urgency (U)</label>
                <select class="factor-select" id="urgency-${issue.id}" onchange="updatePriorityDraft('${issue.id}')">
                    ${renderFactorOptions(factors.urgency)}
                </select>
            </div>
            <div class="factor-group">
                <label for="severity-${issue.id}">Severity (S)</label>
                <select class="factor-select" id="severity-${issue.id}" onchange="updatePriorityDraft('${issue.id}')">
                    ${renderFactorOptions(factors.severity)}
                </select>
            </div>
            <div class="factor-group">
                <label for="impact-${issue.id}">Impact (I)</label>
                <select class="factor-select" id="impact-${issue.id}" onchange="updatePriorityDraft('${issue.id}')">
                    ${renderFactorOptions(factors.impact)}
                </select>
            </div>
            <button class="ghost-btn" onclick="assignPriority('${issue.id}')">Assign priority</button>
            <span class="helper-text">After review, the department moves this issue forward.</span>
        </div>`;
}

function renderIssueManagementCard(issue, compact = false) {
    const allowActions = !compact;
    return `
        <article class="issue-manage-card">
            <div class="issue-manage-head">
                <div>
                    <h5>${issue.id}</h5>
                    <p>${issue.category} | ${issue.location}</p>
                </div>
                ${renderAdminStatus(issue.status)}
            </div>
            <div class="issue-manage-meta">
                <p><strong>Reporter:</strong> ${issue.reporterName}</p>
                <p><strong>Email:</strong> ${issue.reporterEmail}</p>
                <p><strong>Department:</strong> ${issue.assignedDepartment || "Pending assignment"}</p>
                <p><strong>Priority:</strong> ${issue.priority}</p>
                <p><strong>Score:</strong> ${issue.priorityScore || 0}</p>
                <p><strong>Factors:</strong> U:${issue.priorityFactors?.urgency ?? "-"} S:${issue.priorityFactors?.severity ?? "-"} I:${issue.priorityFactors?.impact ?? "-"}</p>
                <p><strong>Description:</strong> ${issue.description}</p>
            </div>
            ${allowActions ? renderActions(issue) : ""}
        </article>`;
}

function renderIssuePreviewSection(issues, stageKey, emptyMessage) {
    if (!issues.length) {
        return `<div class="empty-state">${emptyMessage}</div>`;
    }

    const preview = issues.slice(0, 3).map((issue) => renderIssueManagementCard(issue, true)).join("");
    const viewMore =
        issues.length > 3
            ? `<button class="ghost-btn stage-more-btn" onclick="openIssueStagePage('${stageKey}')">View more</button>`
            : "";

    return `${preview}${viewMore}`;
}

function renderFactorOptions(selectedValue) {
    return [1, 2, 3, 4, 5]
        .map((value) => `<option value="${value}" ${Number(selectedValue || 1) === value ? "selected" : ""}>Score ${value}</option>`)
        .join("");
}

async function assignDepartment(id, department) {
    await CampusApp.assignIssue(id, department);
    refreshAdminView();
}

async function recalculate(id) {
    await CampusApp.recalculatePriority(id);
    refreshAdminView();
}

async function assignPriority(id) {
    const factors = {
        urgency: Number(document.getElementById(`urgency-${id}`).value),
        severity: Number(document.getElementById(`severity-${id}`).value),
        impact: Number(document.getElementById(`impact-${id}`).value),
    };

    await CampusApp.assignPriorityByFactors(id, factors);
    delete priorityDrafts[id];
    refreshAdminView();
}

function updatePriorityDraft(id) {
    priorityDrafts[id] = {
        urgency: Number(document.getElementById(`urgency-${id}`).value),
        severity: Number(document.getElementById(`severity-${id}`).value),
        impact: Number(document.getElementById(`impact-${id}`).value),
    };
}

function openIssueStagePage(stage) {
    const params = new URLSearchParams({ stage });
    const departmentFilter = document.getElementById("adminDepartmentFilter");
    if (departmentFilter && departmentFilter.value) {
        params.set("department", departmentFilter.value);
    }
    window.location.href = `issue_stage.html?${params.toString()}`;
}

function openResolvedIssuesPage() {
    window.location.href = "resolved_issues.html";
}

function updateIssueStageDepartmentFilter() {
    const stageKey = new URLSearchParams(window.location.search).get("stage") || "";
    const departmentValue = document.getElementById("issueStageDepartmentFilter")?.value || "";
    const params = new URLSearchParams();

    if (stageKey) {
        params.set("stage", stageKey);
    }
    if (departmentValue) {
        params.set("department", departmentValue);
    }

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
    refreshAdminView();
}

function getStageConfig(stageKey) {
    if (stageKey === "new") {
        return {
            status: "New",
            title: "New issues",
            subtitle: "Review newly reported complaints waiting for admin action.",
            panelTitle: "All new complaints",
            panelCopy: "These issues are waiting for department assignment and priority review.",
            empty: "No new issues right now.",
        };
    }
    if (stageKey === "progress") {
        return {
            status: "In Progress",
            title: "In-progress issues",
            subtitle: "Track all complaints that are currently under active work.",
            panelTitle: "All active complaints",
            panelCopy: "These issues are already assigned and being worked on.",
            empty: "No in-progress issues right now.",
        };
    }
    if (stageKey === "resolved") {
        return {
            status: "Resolved",
            title: "Resolved issues",
            subtitle: "Review all completed complaints and their final details.",
            panelTitle: "All resolved complaints",
            panelCopy: "These issues have already been completed and closed.",
            empty: "No resolved issues right now.",
        };
    }
    return null;
}

async function renderIssueStagePage(issues) {
    const stageList = document.getElementById("issueStageList");
    if (!stageList) {
        return;
    }

    const stageKey = new URLSearchParams(window.location.search).get("stage");
    const config = getStageConfig(stageKey);
    if (!config) {
        stageList.innerHTML = '<div class="empty-state">Invalid issue stage.</div>';
        return;
    }

    document.getElementById("issueStageTitle").textContent = config.title;
    document.getElementById("issueStageSubtitle").textContent = config.subtitle;
    document.getElementById("issueStagePanelTitle").textContent = config.panelTitle;
    document.getElementById("issueStagePanelCopy").textContent = config.panelCopy;

    const stageDepartmentFilter = document.getElementById("issueStageDepartmentFilter");
    const departmentFromQuery = new URLSearchParams(window.location.search).get("department") || "";
    if (stageDepartmentFilter && stageDepartmentFilter.value !== departmentFromQuery) {
        stageDepartmentFilter.value = departmentFromQuery;
    }

    const searchValue = getSearchValue("issueStageSearch");
    const departmentValue = stageDepartmentFilter ? stageDepartmentFilter.value : "";
    const matching = filterIssuesById(
        filterIssuesByDepartment(
            sortIssuesByPriority(issues.filter((issue) => issue.status === config.status)),
            departmentValue
        ),
        searchValue
    );
    document.getElementById("issueStageSync").textContent = `Last synced ${CampusApp.formatDate(new Date().toISOString())}`;
    stageList.innerHTML = matching.length
        ? matching.map((issue) => renderIssueManagementCard(issue)).join("")
        : `<div class="empty-state">${
            searchValue
                ? "No issues match that issue ID in this stage."
                : departmentValue
                ? "No issues match that department in this stage."
                : config.empty
        }</div>`;
}

async function refreshAdminView() {
    const issues = await CampusApp.getIssues();
    const resolvedArchive = await CampusApp.getResolvedIssues();
    const emailLog = await CampusApp.getEmailLog();
    const stats = CampusApp.getIssueStats(issues);
    const sync = document.getElementById("adminSync");

    const total = document.getElementById("totalIssues");
    const pending = document.getElementById("pendingIssues");
    const active = document.getElementById("activeIssues");
    const resolved = document.getElementById("resolvedIssues");

    if (total) {
        total.textContent = stats.total;
        pending.textContent = stats.new;
        active.textContent = stats.inProgress;
        resolved.textContent = stats.resolved;
    }

    if (sync) {
        sync.textContent = `Last synced ${CampusApp.formatDate(new Date().toISOString())}`;
    }

    const resolvedArchiveCount = document.getElementById("resolvedArchiveCount");
    if (resolvedArchiveCount) {
        resolvedArchiveCount.textContent = resolvedArchive.length;
    }

    const emailCount = document.getElementById("emailCount");
    if (emailCount) {
        emailCount.textContent = emailLog.length;
    }

    const adminSearchValue = getSearchValue("adminIssueSearch");
    const adminDepartmentValue = document.getElementById("adminDepartmentFilter")?.value || "";
    const newQueue = filterIssuesById(
        filterIssuesByDepartment(
            sortIssuesByPriority(issues.filter((issue) => issue.status === "New")),
            adminDepartmentValue
        ),
        adminSearchValue
    );
    const progressQueue = filterIssuesById(
        filterIssuesByDepartment(
            sortIssuesByPriority(issues.filter((issue) => issue.status === "In Progress")),
            adminDepartmentValue
        ),
        adminSearchValue
    );
    const resolvedQueue = filterIssuesById(
        filterIssuesByDepartment(
            sortIssuesByPriority(issues.filter((issue) => issue.status === "Resolved")),
            adminDepartmentValue
        ),
        adminSearchValue
    );

    const newIssuesBody = document.getElementById("newIssuesBody");
    if (newIssuesBody) {
        newIssuesBody.innerHTML = newQueue.length
            ? newQueue
                  .map(
                      (issue) => `
                    <tr>
                        <td>${issue.id}</td>
                        <td>${issue.reporterName}</td>
                        <td>${issue.priority}<br><span class="helper-text">${issue.priorityScore || 0}</span></td>
                    </tr>`
                  )
                  .join("")
            : '<tr><td colspan="3" class="empty-state">No new issues.</td></tr>';
    }

    const progressIssuesBody = document.getElementById("progressIssuesBody");
    if (progressIssuesBody) {
        progressIssuesBody.innerHTML = progressQueue.length
            ? progressQueue
                  .map(
                      (issue) => `
                    <tr>
                        <td>${issue.id}</td>
                        <td>${issue.assignedDepartment || "-"}</td>
                        <td>${issue.priority}<br><span class="helper-text">${issue.priorityScore || 0}</span></td>
                    </tr>`
                  )
                  .join("")
            : '<tr><td colspan="3" class="empty-state">No active issues.</td></tr>';
    }

    const resolvedIssuesBody = document.getElementById("resolvedIssuesBody");
    if (resolvedIssuesBody) {
        resolvedIssuesBody.innerHTML = resolvedQueue.length
            ? resolvedQueue
                  .map(
                      (issue) => `
                    <tr>
                        <td>${issue.id}</td>
                        <td>${issue.assignedDepartment || "-"}</td>
                        <td>${issue.priority}<br><span class="helper-text">${issue.priorityScore || 0}</span></td>
                    </tr>`
                  )
                  .join("")
            : '<tr><td colspan="3" class="empty-state">No resolved issues.</td></tr>';
    }

    const adminNewIssuesList = document.getElementById("adminNewIssuesList");
    if (adminNewIssuesList) {
        adminNewIssuesList.innerHTML = renderIssuePreviewSection(
            newQueue,
            "new",
            adminSearchValue
                ? "No new issues match that issue ID."
                : adminDepartmentValue
                ? "No new issues match that department."
                : "No new issues."
        );
    }

    const adminProgressIssuesList = document.getElementById("adminProgressIssuesList");
    if (adminProgressIssuesList) {
        adminProgressIssuesList.innerHTML = renderIssuePreviewSection(
            progressQueue,
            "progress",
            adminSearchValue
                ? "No in-progress issues match that issue ID."
                : adminDepartmentValue
                ? "No in-progress issues match that department."
                : "No active issues."
        );
    }

    const adminResolvedIssuesList = document.getElementById("adminResolvedIssuesList");
    if (adminResolvedIssuesList) {
        adminResolvedIssuesList.innerHTML = renderIssuePreviewSection(
            resolvedQueue,
            "resolved",
            adminSearchValue
                ? "No resolved issues match that issue ID."
                : adminDepartmentValue
                ? "No resolved issues match that department."
                : "No resolved issues."
        );
    }

    const emailLogBody = document.getElementById("emailLogBody");
    if (emailLogBody) {
        emailLogBody.innerHTML = emailLog.length
            ? emailLog
                  .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
                  .slice(0, 2)
                  .map(
                      (email) => `
                    <tr>
                        <td>${email.issueId}</td>
                        <td>${email.to}</td>
                        <td>${email.subject}</td>
                        <td>${email.deliveryStatus}</td>
                        <td>${CampusApp.formatDate(email.sentAt)}</td>
                    </tr>`
                  )
                  .join("")
            : '<tr><td colspan="5" class="empty-state">No notification emails logged yet.</td></tr>';
    }

    const fullEmailLogBody = document.getElementById("fullEmailLogBody");
    const emailLogSync = document.getElementById("emailLogSync");
    if (fullEmailLogBody) {
        if (emailLogSync) {
            emailLogSync.textContent = `Last synced ${CampusApp.formatDate(new Date().toISOString())}`;
        }

        fullEmailLogBody.innerHTML = emailLog.length
            ? emailLog
                  .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
                  .map(
                      (email) => `
                    <tr>
                        <td>${email.issueId}</td>
                        <td>${email.to}</td>
                        <td>${email.subject}</td>
                        <td>${email.deliveryStatus}</td>
                        <td>${CampusApp.formatDate(email.sentAt)}</td>
                    </tr>`
                  )
                  .join("")
            : '<tr><td colspan="5" class="empty-state">No notification emails logged yet.</td></tr>';
    }

    const resolvedArchiveCards = document.getElementById("resolvedArchiveCards");
    const resolvedSync = document.getElementById("resolvedSync");
    if (resolvedArchiveCards) {
        if (resolvedSync) {
            resolvedSync.textContent = `Last synced ${CampusApp.formatDate(new Date().toISOString())}`;
        }

        resolvedArchiveCards.innerHTML = resolvedArchive.length
            ? resolvedArchive
                  .map(
                      (issue) => `
                    <article class="issue-manage-card">
                        <div class="issue-manage-head">
                            <div>
                                <h5>${issue.id}</h5>
                                <p>${issue.category} | ${issue.location}</p>
                            </div>
                            <span class="status-badge status-resolved">Resolved</span>
                        </div>
                        <div class="issue-manage-meta">
                            <p><strong>Reporter:</strong> ${issue.reporterName}</p>
                            <p><strong>Email:</strong> ${issue.reporterEmail}</p>
                            <p><strong>Department:</strong> ${issue.assignedDepartment || "-"}</p>
                            <p><strong>Priority:</strong> ${issue.priority}</p>
                            <p><strong>Resolved at:</strong> ${CampusApp.formatDate(issue.resolvedAt || issue.updatedAt)}</p>
                            <p><strong>Description:</strong> ${issue.description}</p>
                        </div>
                    </article>`
                  )
                  .join("")
            : '<div class="empty-state">No resolved issues archived yet.</div>';
    }

    renderIssueStagePage(issues);
}

function logoutAdmin() {
    CampusApp.logout();
    window.location.href = "index.html";
}
