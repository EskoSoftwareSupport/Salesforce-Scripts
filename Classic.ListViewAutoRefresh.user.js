// ==UserScript==
// @name        02 SFDC Classic List View Auto Refresh
// @namespace   com.esko.salesforce.autorefresh
// @version     1.0.0
// @description  Auto refresh Salesforce Classic list views
// @author       Esko Software Support
// @downloadURL https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.ListViewAutoRefresh.user.js
// @updateURL   https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.ListViewAutoRefresh.user.js
// @match       https://esko.my.salesforce.com/*
// @match       https://esko--accept.cs83.my.salesforce.com/*
// @grant       none
// ==/UserScript==

(function () {
    'use strict';

    let isPaused = false;
    let countdown = 0;

    function getInterval() {
        return parseInt(localStorage.getItem("sf_refresh_interval")) || 30;
    }

    function setIntervalValue() {
        const current = getInterval();
        const val = prompt("Enter refresh interval (seconds):", current);

        if (val && !isNaN(val)) {
            localStorage.setItem("sf_refresh_interval", val);
            countdown = parseInt(val);
            alert("Refresh interval set to " + val + " seconds");
        }
    }

    function injectControls() {
        const refreshBtn = document.querySelector(".refreshListButton");
        if (!refreshBtn) return;

        const old = document.getElementById("customControls");
        if (old) old.remove();

        const container = document.createElement("span");
        container.id = "customControls";
        container.style.marginLeft = "6px";

        // ⚙ Settings
        const configBtn = document.createElement("input");
        configBtn.type = "button";
        configBtn.value = "⚙";
        configBtn.className = refreshBtn.className;
        configBtn.title = "Set refresh interval";
        configBtn.onclick = setIntervalValue;

        // ▶ / ● Toggle Button
        const toggleBtn = document.createElement("input");
        toggleBtn.type = "button";
        toggleBtn.className = refreshBtn.className;
        toggleBtn.style.marginLeft = "4px";
        toggleBtn.style.color = "white";
        toggleBtn.style.border = "none";
        toggleBtn.style.padding = "2px 10px";
        toggleBtn.style.cursor = "pointer";
        toggleBtn.style.fontWeight = "bold";

        function updateToggleUI() {
            if (!isPaused) {
                // ✅ Active → Green + Play
                toggleBtn.value = "▶";
                toggleBtn.style.backgroundColor = "#28a745";
                toggleBtn.title = "Auto-refresh active (click to pause)";
            } else {
                // ❌ Paused → Red + Circle
                toggleBtn.value = "●";
                toggleBtn.style.backgroundColor = "#dc3545";
                toggleBtn.title = "Auto-refresh paused (click to resume)";
            }
        }

        toggleBtn.onclick = () => {
            isPaused = !isPaused;
            updateToggleUI();
        };

        updateToggleUI();

        // ⏳ Countdown
        const timerSpan = document.createElement("span");
        timerSpan.id = "refreshTimer";
        timerSpan.style.marginLeft = "8px";
        timerSpan.style.fontWeight = "bold";
        timerSpan.style.color = "#444";
        timerSpan.innerText = `Next: ${countdown}s`;

        container.appendChild(configBtn);
        container.appendChild(toggleBtn);
        container.appendChild(timerSpan);

        refreshBtn.parentNode.insertBefore(container, refreshBtn.nextSibling);
    }

    function startTimer(instanceKey) {
        countdown = getInterval();

        setInterval(() => {
            if (!isPaused) {
                countdown--;

                const timerEl = document.getElementById("refreshTimer");
                if (timerEl) {
                    timerEl.innerText = `Next: ${countdown}s`;
                }

                if (countdown <= 0) {
                    ListViewport.instances[instanceKey].refreshList();
                    countdown = getInterval();
                }
            }
        }, 1000);
    }

    function run() {
        if (typeof ListViewport !== "undefined" && ListViewport.instances) {

            const key = Object.keys(ListViewport.instances)[0];
            if (!key) {
                setTimeout(run, 2000);
                return;
            }

            startTimer(key);

            // Keep UI alive after refresh
            setInterval(injectControls, 2000);

            return;
        }

        setTimeout(run, 2000);
    }

    run();
})();
