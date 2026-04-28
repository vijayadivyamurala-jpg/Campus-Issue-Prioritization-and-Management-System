function sendMessage(e){
    e.preventDefault();

    let name = document.getElementById("name").value.trim();
    let email = document.getElementById("email").value.trim();
    let msg = document.getElementById("msg").value.trim();
    let status = document.getElementById("statusMsg");

    if(name === "" || email === "" || msg === ""){
        status.style.color = "red";
        status.textContent = "Please fill all fields";
        return;
    }

    status.style.color = "green";
    status.textContent = "Message sent successfully!";
}