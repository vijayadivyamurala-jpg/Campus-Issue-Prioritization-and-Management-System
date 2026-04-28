async function sendMessage(e){
    e.preventDefault();

    let name = document.getElementById("name").value.trim();
    let email = document.getElementById("email").value.trim();
    let message = document.getElementById("message").value.trim();

    let error = document.getElementById("errorMsg");
    let box = document.getElementById("box");

    error.textContent = "";

    if(name === "" || email === "" || message === ""){
        showError("Please fill all fields");
        return;
    }

    // optional email check
    if(!email.includes("@")){
        showError("Enter valid email");
        return;
    }

    try {
        const response = await fetch("/api/contact", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ name, email, message }),
        });

        const result = await response.json();
        if (!response.ok || !result.ok) {
            showError(result.message || "Unable to send message");
            return;
        }

        error.style.color = "green";
        error.textContent = result.message;
        document.getElementById("name").value = "";
        document.getElementById("email").value = "";
        document.getElementById("message").value = "";
    } catch (err) {
        showError("Unable to connect to the server");
    }
}

function showError(msg){
    let error = document.getElementById("errorMsg");
    let box = document.getElementById("box");

    error.style.color = "red";
    error.textContent = msg;

    box.classList.add("shake");
    setTimeout(()=>box.classList.remove("shake"),300);
}
