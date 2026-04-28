const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorMsg = document.getElementById("errorMsg");
const loginBtn = document.getElementById("loginBtn");

// Toggle password
function togglePassword(){
    passwordInput.type =
        passwordInput.type === "password" ? "text" : "password";
}

// Submit
form.addEventListener("submit", function(e){
    e.preventDefault();

    let email = emailInput.value.trim();
    let password = passwordInput.value.trim();

    errorMsg.textContent = "";

    if(email === "" || password === ""){
        showError("Please fill in all fields");
        return;
    }

    if(!email.includes("@")){
        showError("Enter a valid email");
        return;
    }

    if(email !== "student@campus.com" || password !== "12345"){
        showError("Invalid email or password");
        return;
    }

    loginBtn.textContent = "Logging in...";
    loginBtn.classList.add("loading");

    setTimeout(() => {
        window.location.href = "student_dashboard.html";
    }, 1200);
});

// Error function
function showError(message){
    errorMsg.textContent = message;

    form.classList.add("shake");

    setTimeout(() => {
        form.classList.remove("shake");
    }, 400);
}

// Navigation
function goSignup(){
    window.location.href = "student_signup.html";
}

function goHome(){
    window.location.href = "index.html";
}