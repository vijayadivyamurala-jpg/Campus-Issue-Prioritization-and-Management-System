const CampusApp = (() => {
    const SESSION_KEY = "campus_session";

    function readSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function writeSession(session) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }

    async function api(path, options = {}) {
        const response = await fetch(path, {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
            ...options,
        });

        const data = await response.json().catch(() => ({ ok: false, message: "Unexpected server response." }));
        if (!response.ok) {
            return data;
        }
        return data;
    }

    async function registerUser(role, user) {
        return api("/api/register", {
            method: "POST",
            body: JSON.stringify({ role, ...user }),
        });
    }

    async function loginUser(role, email, password) {
        const result = await api("/api/login", {
            method: "POST",
            body: JSON.stringify({ role, email, password }),
        });

        if (result.ok) {
            writeSession(result.session);
        }

        return result;
    }

    async function loginAdmin(adminId, password) {
        const result = await api("/api/admin/login", {
            method: "POST",
            body: JSON.stringify({ adminId, password }),
        });

        if (result.ok) {
            writeSession(result.session);
        }

        return result;
    }

    async function resetPassword(details) {
        return api("/api/reset-password", {
            method: "POST",
            body: JSON.stringify(details),
        });
    }

    async function requestPasswordReset(details) {
        return api("/api/password-reset/request", {
            method: "POST",
            body: JSON.stringify(details),
        });
    }

    async function completePasswordReset(details) {
        return api("/api/password-reset/complete", {
            method: "POST",
            body: JSON.stringify(details),
        });
    }

    function getSession() {
        return readSession();
    }

    function logout() {
        localStorage.removeItem(SESSION_KEY);
    }

    function requireRole(allowedRoles) {
        const session = getSession();
        const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

        if (!session || !roles.includes(session.role)) {
            window.location.href = "index.html";
            return null;
        }

        return session;
    }

    function getDashboardPath(role) {
        if (role === "student") {
            return "student_dashboard.html";
        }
        if (role === "staff") {
            return "staff_dashboard.html";
        }
        return "admin_dashboard.html";
    }

    function getDepartmentDashboardPath(role) {
        return role === "admin" ? "department_dashboard.html" : "";
    }

    function formatDate(value) {
        if (!value) {
            return "-";
        }
        return new Date(value).toLocaleString("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
        });
    }

    function toQuery(filters = {}) {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                params.set(key, value);
            }
        });
        const query = params.toString();
        return query ? `?${query}` : "";
    }

    async function getIssues(filters = {}) {
        const result = await api(`/api/issues${toQuery(filters)}`);
        return result.ok ? result.issues : [];
    }

    async function getUserIssues(email) {
        return getIssues({ reporter_email: email });
    }

    async function getDepartmentIssues(department) {
        return getIssues({ assigned_department: department });
    }

    async function getResolvedIssues() {
        const result = await api("/api/issues/resolved");
        return result.ok ? result.issues : [];
    }

    async function getEmailLog() {
        const result = await api("/api/email-log");
        return result.ok ? result.emails : [];
    }

    async function createIssue(payload) {
        const result = await api("/api/issues", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        return result.issue;
    }

    async function updateIssueStatus(id, status, actor = "department") {
        const result = await api(`/api/issues/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status, actor }),
        });
        if (!result.ok) {
            throw new Error(result.message || "Unable to update issue status.");
        }
        return result.issue;
    }

    async function assignIssue(id, assignedDepartment) {
        const result = await api(`/api/issues/${id}/department`, {
            method: "PATCH",
            body: JSON.stringify({ assignedDepartment }),
        });
        return result.issue;
    }

    async function assignPriorityByFactors(id, factors) {
        const result = await api(`/api/issues/${id}/priority`, {
            method: "PATCH",
            body: JSON.stringify(factors),
        });
        return result.issue;
    }

    async function askChatbot(message, context = {}) {
        const result = await api("/api/chatbot", {
            method: "POST",
            body: JSON.stringify({ message, context }),
        });
        return result.reply || "I can help with issue reporting and live tracking.";
    }

    function getIssueStats(issues = []) {
        return {
            total: issues.length,
            new: issues.filter((issue) => issue.status === "New").length,
            inProgress: issues.filter((issue) => issue.status === "In Progress").length,
            resolved: issues.filter((issue) => issue.status === "Resolved").length,
        };
    }

    return {
        registerUser,
        loginUser,
        loginAdmin,
        resetPassword,
        requestPasswordReset,
        completePasswordReset,
        getSession,
        logout,
        requireRole,
        getIssues,
        getUserIssues,
        getDepartmentIssues,
        getResolvedIssues,
        getEmailLog,
        createIssue,
        updateIssueStatus,
        assignIssue,
        assignPriorityByFactors,
        askChatbot,
        getIssueStats,
        formatDate,
        getDashboardPath,
        getDepartmentDashboardPath,
    };
})();
