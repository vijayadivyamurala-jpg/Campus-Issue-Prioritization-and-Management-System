function goStudentLogin(){
    window.location.href = "student_login.html";
}

function goStudentSignup(){
    window.location.href = "student_signup.html";
}

function goStaffLogin(){
    window.location.href = "staff_login.html";
}

function goStaffSignup(){
    window.location.href = "staff_signup.html";
}

function goHome(){
    let loggedIn = localStorage.getItem("loggedIn");

    if(loggedIn !== "true"){
        alert("Please login or sign up first to access Home");
        return;
    }

    window.location.href = "home.html"; // or dashboard
}