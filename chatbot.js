(function mountChatbot() {
    if (window.__campusBotMounted) {
        return;
    }

    window.__campusBotMounted = true;
    const session = typeof CampusApp !== "undefined" ? CampusApp.getSession() : null;
    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    const adminPages = ["admin_dashboard.html", "admin_issues.html", "issue_stage.html", "department_dashboard.html", "email_log.html"];
    const memberDashboardPages = ["student_dashboard.html", "staff_dashboard.html"];
    const isAdminContext = session?.role === "admin" && adminPages.includes(currentPage);
    const isTrackingContext = ["tracking.html"].includes(currentPage);
    const isReportContext = ["report_issue.html"].includes(currentPage);
    const isMemberDashboardContext =
        ["student", "staff"].includes(session?.role || "") && memberDashboardPages.includes(currentPage);

    const botConfig = isAdminContext
        ? {
              badge: "Admin Operations Guide",
              intro: "Ask about queues, departments, priority scoring, status updates, or email logs.",
              welcome:
                  "Hello. I can help you manage complaints, assign departments, calculate priority, and move issues through the admin workflow.",
              suggestions: [
                  { label: "Priority scoring", message: "How do I assign priority?" },
                  { label: "Department flow", message: "How do I assign a department?" },
                  { label: "Issue status", message: "How do I move an issue to resolved?" },
              ],
              portal: "admin",
          }
        : isTrackingContext
        ? {
              badge: "Tracking Guide",
              intro: "Ask about live status, progress steps, departments, or what your current issue state means.",
              welcome:
                  "Hello. I can help you understand your live tracking page, complaint status, department assignment, and what happens at each stage.",
              suggestions: [
                  { label: "Status meaning", message: "What does my current status mean?" },
                  { label: "Department info", message: "Why is my issue assigned to a department?" },
                  { label: "Next update", message: "What happens after In Progress?" },
              ],
              portal: "tracking",
          }
        : isReportContext
        ? {
              badge: "Reporting Guide",
              intro: "Ask about how to file a complaint, required details, photos, or what happens after submission.",
              welcome:
                  "Hello. I can help you fill out the complaint form correctly and explain what happens after you submit an issue.",
              suggestions: [
                  { label: "How to report", message: "How do I report an issue?" },
                  { label: "Photo upload", message: "Can I upload a photo?" },
                  { label: "After submit", message: "What happens after I submit a complaint?" },
              ],
              portal: "user",
          }
        : isMemberDashboardContext
        ? {
              badge: "Dashboard Guide",
              intro: "Ask about your dashboard, reporting an issue, checking status, or what to do next.",
              welcome:
                  "Hello. I can help you use your dashboard, report a complaint, open live tracking, and understand your issue summary.",
              suggestions: [
                  { label: "Report issue", message: "How do I report an issue from here?" },
                  { label: "Track status", message: "How do I check my complaint status?" },
                  { label: "Issue summary", message: "What does the issue summary show?" },
              ],
              portal: "member",
          }
        : {
              badge: "Campus Support Guide",
              intro: "Ask about login, complaint flow, departments, contact details, or what to do next.",
              welcome:
                  "Hello. I can help you understand the portal, where to go next, and how the campus complaint process works.",
              suggestions: [
                  { label: "Login help", message: "How do I log in?" },
                  { label: "Next steps", message: "What happens after I submit a complaint?" },
                  { label: "Contact support", message: "How can I contact support?" },
              ],
              portal: "user",
          };
    const suggestionMarkup = botConfig.suggestions
        .map(
            (item) =>
                `<button type="button" class="chatbot-chip" data-message="${item.message}">${item.label}</button>`
        )
        .join("");

    const toggle = document.createElement("button");
    toggle.className = "chatbot-toggle";
    toggle.type = "button";
    toggle.innerHTML = `
        <span class="chatbot-toggle-mark">CV</span>
        <span class="chatbot-toggle-text">Cora</span>
    `;

    const panel = document.createElement("section");
    panel.className = "chatbot-panel";
    panel.innerHTML = `
        <div class="chatbot-head">
            <div>
                <span class="chatbot-badge">${botConfig.badge}</span>
                <h3>Cora</h3>
                <p>${botConfig.intro}</p>
            </div>
            <button type="button" class="chatbot-close" aria-label="Close assistant">&times;</button>
        </div>
        <div class="chatbot-messages" id="chatbotMessages">
            <div class="chatbot-msg bot">
                <strong>Cora</strong>
                <span>${botConfig.welcome}</span>
            </div>
        </div>
        <div class="chatbot-suggestions">
            ${suggestionMarkup}
        </div>
        <form class="chatbot-form" id="chatbotForm">
            <input id="chatbotInput" type="text" placeholder="Ask Cora something..." />
            <button type="submit" class="primary-btn">Send</button>
        </form>
    `;

    document.body.appendChild(toggle);
    document.body.appendChild(panel);

    toggle.addEventListener("click", () => {
        panel.classList.toggle("open");
    });

    panel.querySelector(".chatbot-close").addEventListener("click", () => {
        panel.classList.remove("open");
    });

    panel.querySelectorAll(".chatbot-chip").forEach((chip) => {
        chip.addEventListener("click", async () => {
            const message = chip.dataset.message;
            appendMessage("user", message);
            const reply = await CampusApp.askChatbot(message, {
                role: session?.role || "",
                page: currentPage,
                portal: botConfig.portal,
            });
            appendMessage("bot", reply);
        });
    });

    panel.querySelector("#chatbotForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = panel.querySelector("#chatbotInput");
        const message = input.value.trim();
        if (!message) {
            return;
        }

        appendMessage("user", message);
        input.value = "";

        const reply = await CampusApp.askChatbot(message, {
            role: session?.role || "",
            page: currentPage,
            portal: botConfig.portal,
        });
        appendMessage("bot", reply);
    });

    function appendMessage(role, text) {
        const messages = panel.querySelector("#chatbotMessages");
        const item = document.createElement("div");
        item.className = `chatbot-msg ${role}`;
        if (role === "bot") {
            item.innerHTML = `<strong>Cora</strong><span>${text}</span>`;
        } else {
            item.innerHTML = `<strong>You</strong><span>${text}</span>`;
        }
        messages.appendChild(item);
        messages.scrollTop = messages.scrollHeight;
    }
})();

