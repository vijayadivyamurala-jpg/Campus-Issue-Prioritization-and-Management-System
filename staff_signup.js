const pattern = /@cvr\.ac\.in$/;

document.getElementById("signupForm").addEventListener("submit", async function(e){
    e.preventDefault();
    const fname = document.getElementById("fname").value.trim();
    const lname = document.getElementById("lname").value.trim();
    const email = document.getElementById("email").value.trim();
    const department = document.getElementById("dept").value.trim();
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirm").value;

    if(!fname || !lname || !email || !department || !password || !confirm){
        return showError("Please fill all required fields.");
    }
    if(!pattern.test(email)){
        return showError("Use a valid staff email ending with @cvr.ac.in.");
    }
    if(password.length < 5){
        return showError("Password must be at least 5 characters.");
    }
    if(password !== confirm){
        return showError("Passwords do not match.");
    }

    const result = await CampusApp.registerUser("staff", { fname, lname, email, password, department });
    if(!result.ok){
        return showError(result.message);
    }

    alert("Staff account created successfully.");
    window.location.href = "staff_login.html";
});

function showError(message){
    const error = document.getElementById("errorMsg");
    const box = document.getElementById("box");
    error.textContent = message;
    box.classList.add("shake");
    setTimeout(() => box.classList.remove("shake"), 300);
}
