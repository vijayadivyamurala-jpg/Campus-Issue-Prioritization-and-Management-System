const trackingSession = CampusApp.requireRole(["student", "staff"]);

if (trackingSession) {
    const dashboardPath = CampusApp.getDashboardPath(trackingSession.role);
    document.getElementById("trackingDashboardLink").href = dashboardPath;
    document.getElementById("trackingRole").textContent = trackingSession.role === "student" ? "Student live tracking" : "Staff live tracking";
    refreshTracking();
    window.addEventListener("storage", () => refreshTracking());
    window.setInterval(refreshTracking, 5000);
}

async function refreshTracking() {
    const issues = await CampusApp.getUserIssues(trackingSession.email);
    document.getElementById("trackingSync").textContent = `Last synced ${CampusApp.formatDate(new Date().toISOString())}`;

    const list = document.getElementById("trackingList");
    if (!issues.length) {
        list.innerHTML = '<section class="panel"><div class="empty-state">No issues submitted yet. Report an issue to start live tracking.</div></section>';
        return;
    }

    list.innerHTML = issues
        .map((issue) => {
            const progress = getProgressWidth(issue.status);
            const history = (issue.history || [])
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

            return `
                <section class="panel tracking-card">
                    <div class="tracking-card-head">
                        <div>
                            <h3>${issue.id}</h3>
                            <p>${issue.category} | ${issue.location}</p>
                        </div>
                        ${renderStatus(issue.status)}
                    </div>
                    <div class="progress-line-wrap">
                        <div class="progress-line">
                            <div class="progress-line-fill" style="width:${progress}%"></div>
                        </div>
                        <div class="progress-points">
                            <span class="${getPointClass(issue.status, 'New')}">New</span>
                            <span class="${getPointClass(issue.status, 'In Progress')}">In Progress</span>
                            <span class="${getPointClass(issue.status, 'Resolved')}">Resolved</span>
                        </div>
                    </div>
                    <div class="tracking-meta">
                        <p><strong>Priority:</strong> ${issue.priority}</p>
                        <p><strong>Department:</strong> ${issue.assignedDepartment || "Pending admin assignment"}</p>
                        <p><strong>Description:</strong> ${issue.description}</p>
                    </div>
                    <div class="tracking-history">
                        <h4>Live updates</h4>
                        ${history}
                    </div>
                </section>`;
        })
        .join("");
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

function renderStatus(status) {
    if (status === "Resolved") {
        return '<span class="status-badge status-resolved">Resolved</span>';
    }
    if (status === "In Progress") {
        return '<span class="status-badge status-progress">In Progress</span>';
    }
    return '<span class="status-badge status-new">New</span>';
}

function logoutUser() {
    CampusApp.logout();
    window.location.href = "index.html";
}
