document.getElementById("completeResetForm").addEventListener("submit", async function (event) {
    event.preventDefault();

    const accountType = document.getElementById("accountType").value;
    const email = document.getElementById("resetEmail").value.trim();
    const otp = document.getElementById("resetOtp").value.trim();
    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (!email || !email.includes("@")) {
        return showResetMessage("Enter a valid registered email address.");
    }
    if (!otp || !/^\d{6}$/.test(otp)) {
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
        accountType,
        email,
        otp,
        newPassword,
    });

    showResetMessage(result.message, result.ok);
    if (result.ok) {
        document.getElementById("completeResetForm").reset();
        setTimeout(() => {
            window.location.href = "user.html";
        }, 1800);
    }
});

function showResetMessage(message, ok = false) {
    const resetMsg = document.getElementById("resetMsg");
    resetMsg.textContent = message;
    resetMsg.classList.toggle("success", ok);
}
