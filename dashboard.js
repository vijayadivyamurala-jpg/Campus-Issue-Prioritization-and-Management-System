const session = CampusApp.requireRole(["student", "staff"]);

if (session) {
    document.getElementById("roleLabel").textContent = session.role === "student" ? "Student portal" : "Staff portal";
    document.getElementById("userName").textContent = session.name || session.email;
    document.getElementById("userMeta").textContent =
        session.role === "staff" && session.department
            ? `${session.email} | ${session.department}`
            : session.email;

    document.getElementById("welcomeLine").textContent = `Welcome back, ${session.name || "user"}.`;
    refreshDashboard();
    window.addEventListener("storage", () => refreshDashboard());
    window.setInterval(refreshDashboard, 5000);
}

function renderStatus(status) {
    if (status === "Resolved") {
        return '<span class="status-badge status-resolved">Resolved</span>';
    }

    if (status === "In Progress") {
        return '<span class="status-badge status-progress">In Progress</span>';
    }

    return '<span class="status-badge status-new">New</span>';
}

async function refreshDashboard() {
    const issues = await CampusApp.getUserIssues(session.email);
    const stats = CampusApp.getIssueStats(issues);

    document.getElementById("totalIssues").textContent = stats.total;
    document.getElementById("newIssues").textContent = stats.new;
    document.getElementById("activeIssues").textContent = stats.inProgress;
    document.getElementById("resolvedIssues").textContent = stats.resolved;
    document.getElementById("lastSync").textContent = `Last synced ${CampusApp.formatDate(new Date().toISOString())}`;

    const tableBody = document.getElementById("issuesTableBody");
    if (issues.length === 0) {
        tableBody.innerHTML =
            '<tr><td colspan="7" class="empty-state">No issues submitted yet. Use "Report an issue" to create your first ticket.</td></tr>';
        return;
    }

    tableBody.innerHTML = issues
        .map(
            (issue) => `
            <tr>
                <td>${issue.id}</td>
                <td>${issue.category}</td>
                <td>${issue.location}</td>
                <td>${issue.priority}</td>
                <td>${renderStatus(issue.status)}</td>
                <td><div class="helper-text">Department: ${issue.assignedDepartment || "Pending admin assignment"}</div></td>
                <td>${CampusApp.formatDate(issue.updatedAt)}</td>
            </tr>`
        )
        .join("");
}

function logoutUser() {
    CampusApp.logout();
    window.location.href = "index.html";
}
