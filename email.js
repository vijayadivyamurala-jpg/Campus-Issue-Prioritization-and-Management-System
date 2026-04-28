const currentSession = CampusApp.requireRole(["student", "staff"]);

if (currentSession) {
    const dashboardPath = CampusApp.getDashboardPath(currentSession.role);
    document.getElementById("name").value = currentSession.name || "";
    document.getElementById("email").value = currentSession.email || "";
    document.getElementById("dashboardLink").href = dashboardPath;
    document.getElementById("backToDashboard").href = dashboardPath;
    document.getElementById("portalRole").textContent = currentSession.role === "student" ? "Student issue reporting" : "Staff issue reporting";
}

document.getElementById("issueForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const category = document.getElementById("category").value;
    const location = document.getElementById("location").value.trim();
    const description = document.getElementById("description").value.trim();
    const photoFile = document.getElementById("issuePhoto").files[0];
    const message = document.getElementById("formMessage");

    if (!category || !location || !description) {
        message.className = "error-text";
        message.textContent = "Please fill category, location, and description.";
        return;
    }

    const photo = photoFile ? await fileToDataUrl(photoFile) : "";

    const issue = await CampusApp.createIssue({
        reporterName: currentSession.name,
        reporterEmail: currentSession.email,
        reporterRole: currentSession.role,
        category,
        location,
        description,
        photo,
        photoName: photoFile ? photoFile.name : "",
    });

    message.className = "success-text";
    message.textContent = `${issue.id} submitted. It is now waiting for admin priority scoring and department assignment. Receipt email queued for ${issue.reporterEmail}.`;
    document.getElementById("issueForm").reset();
    document.getElementById("name").value = currentSession.name || "";
    document.getElementById("email").value = currentSession.email || "";
});

function logoutUser() {
    CampusApp.logout();
    window.location.href = "index.html";
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}
