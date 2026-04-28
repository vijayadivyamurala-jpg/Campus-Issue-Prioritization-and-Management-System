function togglePassword(){
    const pass = document.getElementById("password");
    const toggle = document.querySelector(".toggle-eye");
    const reveal = pass.type === "password";
    pass.type = reveal ? "text" : "password";
    toggle.textContent = reveal ? "Hide" : "Show";
}

document.getElementById("adminForm").addEventListener("submit", async function(e){
    e.preventDefault();
    const result = await CampusApp.loginAdmin(
        document.getElementById("adminId").value.trim(),
        document.getElementById("password").value
    );
    const error = document.getElementById("errorMsg");
    const box = document.getElementById("box");

    if(!result.ok){
        error.textContent = result.message;
        box.classList.add("shake");
        setTimeout(() => box.classList.remove("shake"), 300);
        return;
    }

    window.location.href = "admin_dashboard.html";
});

document.getElementById("resetForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const adminId = document.getElementById("resetAdminId").value.trim();
    const password = document.getElementById("resetPasswordField").value;
    const confirmPassword = document.getElementById("resetConfirmPasswordField").value;

    if (!adminId || !password || !confirmPassword) {
        return showResetMessage("Please fill all reset fields.");
    }
    if (password !== confirmPassword) {
        return showResetMessage("Passwords do not match.");
    }

    const result = await CampusApp.resetPassword({
        accountType: "admin",
        adminId,
        newPassword: password,
    });
    showResetMessage(result.message, result.ok);

    if (result.ok) {
        document.getElementById("adminId").value = adminId;
        document.getElementById("password").value = "";
        document.getElementById("resetForm").reset();
    }
});

function toggleResetPanel(forceState) {
    const panel = document.getElementById("resetPanel");
    const shouldShow = typeof forceState === "boolean" ? forceState : panel.hidden;
    panel.hidden = !shouldShow;
    document.getElementById("resetMsg").textContent = "";
    document.getElementById("resetMsg").classList.remove("success");
}

function showResetMessage(message, ok = false) {
    const resetMsg = document.getElementById("resetMsg");
    resetMsg.textContent = message;
    resetMsg.classList.toggle("success", ok);
}
