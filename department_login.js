let otpRequested = false;

document.getElementById("departmentLoginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
        return showError("Please fill all fields.");
    }

    if (!email.endsWith("@cvr.ac.in")) {
        return showError("Enter a valid department email.");
    }

    const result = await CampusApp.loginUser("staff", email, password);
    if (!result.ok) {
        return showError(result.message);
    }

    if (!result.session.department) {
        CampusApp.logout();
        return showError("This account is not assigned to a department yet.");
    }

    window.location.href = "department_dashboard.html";
});

document.getElementById("resetForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const email = document.getElementById("resetEmail").value.trim();
    const otp = document.getElementById("resetOtp").value.trim();
    const newPassword = document.getElementById("resetNewPassword").value;
    const confirmPassword = document.getElementById("resetConfirmPassword").value;

    if (!email) {
        return showResetMessage("Enter your registered department email.");
    }

    if (!email.endsWith("@cvr.ac.in")) {
        return showResetMessage("Enter a valid department email.");
    }

    if (!otpRequested) {
        const result = await CampusApp.requestPasswordReset({
            accountType: "department",
            email,
        });
        showResetMessage(result.message, result.ok);

        if (result.ok) {
            otpRequested = true;
            setOtpStage(true);
            document.getElementById("email").value = email;
            document.getElementById("password").value = "";
            document.getElementById("resetOtp").focus();
        }
        return;
    }

    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
        return showResetMessage("Enter the 6-digit OTP sent to your email.");
    }
    if (!newPassword || !confirmPassword) {
        return showResetMessage("Please fill both password fields.");
    }
    if (newPassword.length < 4) {
        return showResetMessage("Use a password with at least 4 characters.");
    }
    if (newPassword !== confirmPassword) {
        return showResetMessage("Passwords do not match.");
    }

    const result = await CampusApp.completePasswordReset({
        accountType: "department",
        email,
        otp,
        newPassword,
    });
    showResetMessage(result.message, result.ok);

    if (result.ok) {
        otpRequested = false;
        document.getElementById("resetForm").reset();
        setOtpStage(false);
    }
});

function togglePassword() {
    const pass = document.getElementById("password");
    const toggle = document.querySelector(".toggle-eye");
    const reveal = pass.type === "password";
    pass.type = reveal ? "text" : "password";
    toggle.textContent = reveal ? "Hide" : "Show";
}

function toggleResetPanel(forceState) {
    const panel = document.getElementById("resetPanel");
    const shouldShow = typeof forceState === "boolean" ? forceState : panel.hidden;
    panel.hidden = !shouldShow;
    if (!shouldShow) {
        otpRequested = false;
        document.getElementById("resetForm").reset();
        setOtpStage(false);
    }
    clearResetMessage();
}

function showError(message) {
    const error = document.getElementById("errorMsg");
    const box = document.getElementById("box");
    error.textContent = message;
    box.classList.add("shake");
    setTimeout(() => box.classList.remove("shake"), 300);
}

function showResetMessage(message, ok = false) {
    const resetMsg = document.getElementById("resetMsg");
    resetMsg.textContent = message;
    resetMsg.classList.toggle("success", ok);
}

function clearResetMessage() {
    const resetMsg = document.getElementById("resetMsg");
    resetMsg.textContent = "";
    resetMsg.classList.remove("success");
}

function setOtpStage(enabled) {
    document.getElementById("otpField").hidden = !enabled;
    document.getElementById("newPasswordField").hidden = !enabled;
    document.getElementById("confirmPasswordField").hidden = !enabled;
    document.getElementById("resetSubmitBtn").textContent = enabled ? "Verify OTP & Reset Password" : "Send OTP";
}
