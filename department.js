const departmentSession = CampusApp.requireRole("admin");
window.__departmentIssuesCache = [];

if (departmentSession) {
    refreshDepartmentDashboard();
    window.addEventListener("storage", () => refreshDepartmentDashboard());
    window.setInterval(refreshDepartmentDashboard, 5000);
}

function departmentPriorityValue(issue) {
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

function sortDepartmentIssues(issues) {
    return [...issues].sort((a, b) => {
        const diff = departmentPriorityValue(b) - departmentPriorityValue(a);
        if (diff !== 0) {
            return diff;
        }
        return new Date(a.createdAt) - new Date(b.createdAt);
    });
}

function filterDepartmentIssuesById(issues) {
    const searchInput = document.getElementById("departmentIssueSearch");
    const searchValue = searchInput ? searchInput.value.trim().toLowerCase() : "";

    if (!searchValue) {
        return issues;
    }

    return issues.filter((issue) => issue.id.toLowerCase().includes(searchValue));
}

async function refreshDepartmentDashboard() {
    const department = document.getElementById("departmentFilter").value;
    const issues = filterDepartmentIssuesById(sortDepartmentIssues(await CampusApp.getDepartmentIssues(department)));
    window.__departmentIssuesCache = issues;
    const stats = CampusApp.getIssueStats(issues);

    document.getElementById("departmentSync").textContent = `Last synced ${CampusApp.formatDate(new Date().toISOString())}`;
    document.getElementById("deptTotal").textContent = stats.total;
    document.getElementById("deptNew").textContent = stats.new;
    document.getElementById("deptProgress").textContent = stats.inProgress;
    document.getElementById("deptResolved").textContent = stats.resolved;

    const list = document.getElementById("departmentIssuesList");
    if (!issues.length) {
        const searchInput = document.getElementById("departmentIssueSearch");
        const searchValue = searchInput ? searchInput.value.trim() : "";
        list.innerHTML = `<section class="panel"><div class="empty-state">${
            searchValue
                ? "No assigned issues match that issue ID."
                : "No user-reported issues are assigned to this department right now."
        }</div></section>`;
        return;
    }

    list.innerHTML = issues
        .map(
            (issue) => `
            <section class="panel tracking-card department-track-card">
                <div class="tracking-card-head">
                    <div>
                        <h3>${issue.id}</h3>
                        <p>${issue.category} | ${issue.location}</p>
                    </div>
                    ${renderDepartmentStatus(issue.status)}
                </div>
                <div class="progress-line-wrap">
                    <div class="progress-line">
                        <div class="progress-line-fill" style="width:${getProgressWidth(issue.status)}%"></div>
                    </div>
                    <div class="progress-points">
                        <span class="${getPointClass(issue.status, "New")}">New</span>
                        <span class="${getPointClass(issue.status, "In Progress")}">In Progress</span>
                        <span class="${getPointClass(issue.status, "Resolved")}">Resolved</span>
                    </div>
                </div>
                <div class="tracking-meta">
                    <p><strong>Reporter:</strong> ${issue.reporterName} (${issue.reporterEmail})</p>
                    <p><strong>Department:</strong> ${issue.assignedDepartment || "Pending assignment"}</p>
                    <p><strong>Priority:</strong> ${issue.priority} | Score ${issue.priorityScore || 0}</p>
                    <p><strong>Factors:</strong> U:${issue.priorityFactors?.urgency ?? "-"} S:${issue.priorityFactors?.severity ?? "-"} I:${issue.priorityFactors?.impact ?? "-"}</p>
                    <p><strong>Description:</strong> ${issue.description}</p>
                </div>
                <div class="action-row">
                    ${renderDepartmentAction(issue)}
                </div>
                <div class="tracking-history">
                    <h4>Live updates</h4>
                    ${renderHistory(issue.history)}
                </div>
            </section>`
        )
        .join("");
}

function renderDepartmentStatus(status) {
    if (status === "Resolved") {
        return '<span class="status-badge status-resolved">Resolved</span>';
    }
    if (status === "In Progress") {
        return '<span class="status-badge status-progress">In Progress</span>';
    }
    return '<span class="status-badge status-new">New</span>';
}

function renderDepartmentAction(issue) {
    if (issue.status === "Resolved") {
        return '<span class="helper-text">Closed</span>';
    }
    if (issue.status === "In Progress") {
        if (issue.priority !== "High" && hasBlockingHighPriorityIssue(issue)) {
            return '<span class="helper-text">Resolve all open high-priority issues first.</span>';
        }
        return `<button class="secondary-btn" onclick="setDepartmentStatus('${issue.id}', 'Resolved')">Resolve</button>`;
    }
    if (hasHigherPriorityNewIssue(issue)) {
        return '<span class="helper-text">Start the higher-priority new issue first.</span>';
    }
    return `<button class="secondary-btn" onclick="setDepartmentStatus('${issue.id}', 'In Progress')">Start work</button>`;
}

async function setDepartmentStatus(id, status) {
    try {
        await CampusApp.updateIssueStatus(id, status, "department");
        refreshDepartmentDashboard();
    } catch (error) {
        window.alert(error.message || "Unable to update issue status.");
    }
}

function hasBlockingHighPriorityIssue(issue) {
    const department = issue.assignedDepartment;
    if (!department) {
        return false;
    }

    return window.__departmentIssuesCache.some(
        (item) =>
            item.id !== issue.id &&
            item.assignedDepartment === department &&
            item.priority === "High" &&
            item.status !== "Resolved"
    );
}

function getDepartmentPriorityRank(issue) {
    if (issue.priority === "High") {
        return 300 + Number(issue.priorityScore || 0);
    }
    if (issue.priority === "Medium") {
        return 200 + Number(issue.priorityScore || 0);
    }
    if (issue.priority === "Low") {
        return 100 + Number(issue.priorityScore || 0);
    }
    return Number(issue.priorityScore || 0);
}

function hasHigherPriorityNewIssue(issue) {
    const department = issue.assignedDepartment;
    if (!department || issue.status !== "New") {
        return false;
    }

    const currentRank = getDepartmentPriorityRank(issue);
    return window.__departmentIssuesCache.some(
        (item) =>
            item.id !== issue.id &&
            item.assignedDepartment === department &&
            item.status === "New" &&
            getDepartmentPriorityRank(item) > currentRank
    );
}

function renderHistory(history = []) {
    const items = history
        .slice()
        .reverse()
        .map(
            (entry) => `
            <div class="history-item">
                <strong>${entry.status}</strong>
                <span>${entry.note || ""}</span>
                <small>${CampusApp.formatDate(entry.changedAt)}</small>
            </div>`
        )
        .join("");

    return items || '<div class="helper-text">No live updates yet.</div>';
}

function getProgressWidth(status) {
    if (status === "Resolved") {
        return 100;
    }
    if (status === "In Progress") {
        return 55;
    }
    return 15;
}

function getPointClass(currentStatus, pointStatus) {
    const order = ["New", "In Progress", "Resolved"];
    const currentIndex = order.indexOf(currentStatus);
    const pointIndex = order.indexOf(pointStatus);

    if (pointIndex < currentIndex) {
        return "progress-point done";
    }
    if (pointIndex === currentIndex) {
        return "progress-point current";
    }
    return "progress-point";
}

function logoutAdmin() {
    CampusApp.logout();
    window.location.href = "index.html";
}
