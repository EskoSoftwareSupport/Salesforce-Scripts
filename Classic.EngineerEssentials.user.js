// ==UserScript==
// @name         SFDC Classic Engineer Essentials
// @namespace    com.esko.salesforce.defaultforall
// @version      1.0.2
// @description  Customer Chat Monitor with beep alert + Action Required Alert Icon + Description_local validation before closing cases
// @author       Esko Software Support
//
// @downloadURL  https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.EngineerEssentials.user.js
// @updateURL    https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.EngineerEssentials.user.js
//
// @match        https://esko.my.salesforce.com/*
// @match        https://esko--accept.cs83.my.salesforce.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /********************************************************************
     * CONFIG
     ********************************************************************/

    const TAKE_ACTION_ICON_URL =
        "https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/assets/ActionRequired.png";

    const CHAT_BANNER_ID = "customer-chat-banner";

    const ACTION_REQUIRED_HEADER = "Action Required";
    const ACTION_ICON_CLASS = "action-required-alert-icon";
    const ACTION_STYLE_ID = "default-for-all-style";

    const STATUS_ID = 'cas7';
    const DESCRIPTION_ID = '00N57000006DwrR';
    const WARNING_ID = 'desc-local-warning';

    const STATUS_SYNOPSIS_HEADER = "Status Synopsis";
    const SYNOPSIS_WRAPPER_CLASS = "status-synopsis-wrapper";
    const SYNOPSIS_CONTENT_CLASS = "status-synopsis-content";
    const SYNOPSIS_TOGGLE_CLASS = "status-synopsis-toggle";
    const SYNOPSIS_EXPANDED_CLASS = "expanded";
    const SYNOPSIS_PROCESSED_ATTR = "synopsisProcessed";

    const CHAT_STATUS_CHECK_INTERVAL_MS = 10000;
    const ACTION_REQUIRED_CHECK_INTERVAL_MS = 5000;
    const STATUS_SYNOPSIS_CHECK_INTERVAL_MS = 5000;
    const DESCRIPTION_VALIDATION_CHECK_INTERVAL_MS = 1000;
    const OFFLINE_BEEP_INTERVAL_MS = 5000;
    const BEEP_DURATION_MS = 250;
    const BEEP_FREQUENCY_HZ = 1000;
    const BEEP_VOLUME = 0.15;

    let offlineStartTime = null;
    let previouslyOffline = false;

    let beepInterval = null;
    let audioContext = null;

    injectStyles();

    /********************************************************************
     * STYLES
     ********************************************************************/

    function injectStyles() {

        if (document.getElementById(ACTION_STYLE_ID)) {
            return;
        }

        const style = document.createElement("style");
        style.id = ACTION_STYLE_ID;

        style.textContent = `

            /* ---------------------------------------------------------
               CUSTOMER CHAT BANNER
            --------------------------------------------------------- */

            @keyframes chatBlink {
                0%   { opacity:1; }
                50%  { opacity:0.45; }
                100% { opacity:1; }
            }

            #${CHAT_BANNER_ID} {
                position: fixed;
                top: 12px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 999999;
                padding: 12px 24px;
                border-radius: 6px;
                font-size: 16px;
                font-weight: bold;
                box-shadow: 0 4px 12px rgba(0,0,0,.35);
                text-align: center;
                min-width: 420px;
            }

            #${CHAT_BANNER_ID}.offline {
                background: #DC3545;
                color: white;
                animation: chatBlink 1s infinite;
            }

            #${CHAT_BANNER_ID}.online {
                background: #28A745;
                color: white;
            }

            #${CHAT_BANNER_ID} small {
                display: block;
                margin-top: 4px;
                font-size: 12px;
                font-weight: normal;
            }

            /* ---------------------------------------------------------
               ACTION REQUIRED ICON
            --------------------------------------------------------- */

            @keyframes actionRequiredFlash {
                0%,100% {
                    opacity: 1;
                    transform: scale(1);
                }

                50% {
                    opacity: 0.2;
                    transform: scale(1.25);
                }
            }

            .${ACTION_ICON_CLASS} {
                margin-left: 4px;
                height: 18px;
                width: auto;
                vertical-align: middle;
                animation: actionRequiredFlash 0.8s infinite;
                cursor: pointer;
            }

            /* ---------------------------------------------------------
               STATUS SYNOPSIS COLLAPSE / EXPAND
            --------------------------------------------------------- */

            .${SYNOPSIS_WRAPPER_CLASS} {
                display: flex;
                align-items: flex-start;
                gap: 6px;
                width: 100%;
            }

            .${SYNOPSIS_TOGGLE_CLASS} {
                flex: 0 0 auto;
                display: inline-block;
                width: 14px;
                line-height: 16px;
                text-align: center;
                cursor: pointer;
                user-select: none;
                color: #015ba7;
                font-size: 11px;
                margin-top: 1px;
                transform: rotate(0deg);
                transition: transform 0.15s ease-in-out;
            }

            .${SYNOPSIS_WRAPPER_CLASS}.${SYNOPSIS_EXPANDED_CLASS} .${SYNOPSIS_TOGGLE_CLASS} {
                transform: rotate(90deg);
            }

            .${SYNOPSIS_CONTENT_CLASS} {
                flex: 1 1 auto;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 1;
                -webkit-box-orient: vertical;
                white-space: normal;
            }

            .${SYNOPSIS_WRAPPER_CLASS}.${SYNOPSIS_EXPANDED_CLASS} .${SYNOPSIS_CONTENT_CLASS} {
                display: block;
                -webkit-line-clamp: unset;
                overflow: visible;
            }
        `;

        document.head.appendChild(style);
    }

    /********************************************************************
     * CUSTOMER CHAT MONITOR
     ********************************************************************/

    function getVisibleChatButton() {

        const buttons =
            document.querySelectorAll("button.x-btn-text");

        for (const btn of buttons) {

            const text =
                (btn.innerText || "").trim();

            if (
                text.indexOf("Chat") === 0 &&
                btn.offsetParent !== null
            ) {
                return btn;
            }
        }

        return null;
    }

    function getChatStatus() {

        const btn = getVisibleChatButton();

        if (!btn) {
            return "UNKNOWN";
        }

        if (btn.className.includes("liveAgentOffline")) {
            return "OFFLINE";
        }

        if (btn.className.includes("liveAgentOnline")) {
            return "ONLINE";
        }

        return "UNKNOWN";
    }

    function formatDuration(ms) {

        const mins = Math.floor(ms / 60000);
        const hrs = Math.floor(mins / 60);

        if (hrs > 0) {
            return hrs + "h " + (mins % 60) + "m";
        }

        return mins + "m";
    }

    function createChatBanner() {

        let banner =
            document.getElementById(CHAT_BANNER_ID);

        if (!banner) {

            banner = document.createElement("div");
            banner.id = CHAT_BANNER_ID;

            document.body.appendChild(banner);
        }

        return banner;
    }

    /********************************************************************
     * OFFLINE BEEP ALERT
     ********************************************************************/

    function unlockAudioContext() {

        try {

            if (!audioContext) {
                audioContext =
                    new (
                        window.AudioContext ||
                        window.webkitAudioContext
                    )();
            }

            if (audioContext.state === "suspended") {
                audioContext.resume();
            }

        } catch (err) {
            console.log("Audio unlock failed", err);
        }
    }

    function playBeep() {

        try {

            unlockAudioContext();

            if (!audioContext || audioContext.state === "suspended") {
                return;
            }

            const oscillator =
                audioContext.createOscillator();

            const gainNode =
                audioContext.createGain();

            oscillator.type = "sine";
            oscillator.frequency.value = BEEP_FREQUENCY_HZ;

            gainNode.gain.setValueAtTime(
                BEEP_VOLUME,
                audioContext.currentTime
            );

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.start();

            setTimeout(() => {
                oscillator.stop();
                oscillator.disconnect();
                gainNode.disconnect();
            }, BEEP_DURATION_MS);

        } catch (err) {
            console.log("Beep failed", err);
        }
    }

    function startOfflineBeep() {

        if (beepInterval) {
            return;
        }

        playBeep();

        beepInterval = setInterval(() => {
            playBeep();
        }, OFFLINE_BEEP_INTERVAL_MS);
    }

    function stopOfflineBeep() {

        if (beepInterval) {
            clearInterval(beepInterval);
            beepInterval = null;
        }
    }

    document.addEventListener(
        "click",
        unlockAudioContext,
        true
    );

    document.addEventListener(
        "keydown",
        unlockAudioContext,
        true
    );

    function showOfflineBanner() {

        const banner = createChatBanner();

        banner.className = "offline";

        const duration =
            offlineStartTime
                ? formatDuration(
                    Date.now() - offlineStartTime
                )
                : "0m";

        banner.innerHTML = `
            ⚠ PLEASE GO ONLINE FOR CUSTOMER CHAT
            <small>
                Offline for: ${duration}
            </small>
        `;
    }

    function showOnlineBanner() {

        const banner = createChatBanner();

        banner.className = "online";

        banner.innerHTML =
            "✅ Customer chat is ONLINE";

        setTimeout(() => {

            const current =
                document.getElementById(CHAT_BANNER_ID);

            if (
                current &&
                current.className === "online"
            ) {
                current.remove();
            }
        }, 3000);
    }

    function removeChatBanner() {

        const banner =
            document.getElementById(CHAT_BANNER_ID);

        if (banner) {
            banner.remove();
        }
    }

    function checkChatStatus() {

        const status =
            getChatStatus();

        if (status === "OFFLINE") {

            if (!offlineStartTime) {
                offlineStartTime =
                    Date.now();
            }

            previouslyOffline = true;

            showOfflineBanner();
            startOfflineBeep();

            return;
        }

        if (status === "ONLINE") {

            if (previouslyOffline) {

                showOnlineBanner();

                previouslyOffline = false;

            } else {

                removeChatBanner();
            }

            stopOfflineBeep();
            offlineStartTime = null;

            return;
        }

        removeChatBanner();
        stopOfflineBeep();
    }

    /********************************************************************
     * ACTION REQUIRED ICON
     ********************************************************************/

    function cleanText(value) {

        return (value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function getColumnKeyByHeaderTitle(headerTitle) {

        const headers =
            document.querySelectorAll(
                "div.x-grid3-hd-inner"
            );

        for (const header of headers) {

            const title =
                cleanText(header.getAttribute("title"));

            const text =
                cleanText(header.textContent);

            if (
                title === headerTitle ||
                text.includes(headerTitle)
            ) {

                const classes =
                    header.className.split(/\s+/);

                for (const cls of classes) {

                    if (
                        cls.startsWith("x-grid3-hd-") &&
                        cls !== "x-grid3-hd-inner"
                    ) {
                        return cls.replace(
                            "x-grid3-hd-",
                            ""
                        );
                    }
                }
            }
        }

        return null;
    }

    function findCell(row, key) {

        return (
            row.querySelector(".x-grid3-col-" + key) ||
            row.querySelector(
                ".x-grid3-td-" + key + " .x-grid3-cell-inner"
            ) ||
            row.querySelector(".x-grid3-td-" + key)
        );
    }

    /********************************************************************
     * STATUS SYNOPSIS COLLAPSE / EXPAND
     ********************************************************************/

    function collapseStatusSynopsisCell(cell) {

        if (cell.dataset[SYNOPSIS_PROCESSED_ATTR] === 'true') {
            return;
        }

        const originalHTML = cell.innerHTML;

        cell.dataset[SYNOPSIS_PROCESSED_ATTR] = 'true';
        cell.innerHTML = '';
        cell.style.whiteSpace = 'normal';

        const wrapper =
            document.createElement('div');

        wrapper.className = SYNOPSIS_WRAPPER_CLASS;

        const toggle =
            document.createElement('span');

        toggle.className = SYNOPSIS_TOGGLE_CLASS;
        toggle.textContent = '▶';
        toggle.title = 'Expand / collapse Status Synopsis';

        const content =
            document.createElement('div');

        content.className = SYNOPSIS_CONTENT_CLASS;
        content.innerHTML = originalHTML;

        toggle.addEventListener('click', function (e) {

            e.preventDefault();
            e.stopPropagation();

            wrapper.classList.toggle(
                SYNOPSIS_EXPANDED_CLASS
            );
        });

        wrapper.appendChild(toggle);
        wrapper.appendChild(content);

        cell.appendChild(wrapper);
    }

    function processStatusSynopsisRows() {

        const synopsisKey =
            getColumnKeyByHeaderTitle(
                STATUS_SYNOPSIS_HEADER
            );

        if (!synopsisKey) {
            return;
        }

        document
            .querySelectorAll(".x-grid3-row")
            .forEach(row => {

                const synopsisCell =
                    findCell(row, synopsisKey);

                if (!synopsisCell) {
                    return;
                }

                collapseStatusSynopsisCell(
                    synopsisCell
                );
            });
    }

    /********************************************************************
     * ACTION REQUIRED ICON (ROW PROCESSING)
     ********************************************************************/

    function isActionRequiredChecked(actionCell) {

        const checkboxInput =
            actionCell?.querySelector(
                "input[type='checkbox']"
            );

        if (checkboxInput) {
            return checkboxInput.checked;
        }

        const checkboxImage =
            actionCell?.querySelector("img");

        if (!checkboxImage) {
            return false;
        }

        const combined =
            (
                (checkboxImage.src || "") +
                " " +
                (checkboxImage.alt || "") +
                " " +
                (checkboxImage.title || "") +
                " " +
                (checkboxImage.className || "")
            ).toLowerCase();

        if (
            combined.includes("unchecked") ||
            combined.includes("not checked")
        ) {
            return false;
        }

        return combined.includes("checked");
    }

    function removeActionIcon(actionCell) {

        actionCell
            ?.querySelector("." + ACTION_ICON_CLASS)
            ?.remove();

        actionCell
            ?.querySelector(".action-required-alert-fallback")
            ?.remove();
    }

    function upsertActionIcon(actionCell) {

        if (
            actionCell.querySelector(
                "." + ACTION_ICON_CLASS
            )
        ) {
            return;
        }

        actionCell.style.whiteSpace = "nowrap";
        actionCell.style.overflow = "visible";

        const img =
            document.createElement("img");

        img.className = ACTION_ICON_CLASS;
        img.src = TAKE_ACTION_ICON_URL;
        img.title = "Action Required";
        img.alt = "Action Required";

        img.onerror = function () {

            img.remove();

            const fallback =
                document.createElement("span");

            fallback.className =
                "action-required-alert-fallback";

            fallback.textContent = "⚠";

            fallback.style.marginLeft = "4px";
            fallback.style.color = "#dc3545";
            fallback.style.animation =
                "actionRequiredFlash 0.8s infinite";

            actionCell.appendChild(fallback);
        };

        actionCell.appendChild(img);
    }

    function processActionRequiredRows() {

        const actionRequiredKey =
            getColumnKeyByHeaderTitle(
                ACTION_REQUIRED_HEADER
            );

        if (!actionRequiredKey) {
            return;
        }

        document
            .querySelectorAll(".x-grid3-row")
            .forEach(row => {

                const actionCell =
                    findCell(
                        row,
                        actionRequiredKey
                    );

                if (!actionCell) {
                    return;
                }

                if (
                    isActionRequiredChecked(
                        actionCell
                    )
                ) {
                    upsertActionIcon(
                        actionCell
                    );
                } else {
                    removeActionIcon(
                        actionCell
                    );
                }
            });
    }

    /********************************************************************
     * DESCRIPTION_LOCAL VALIDATION BEFORE CLOSING CASE
     ********************************************************************/

    function validateCase() {

        const statusField =
            document.getElementById(STATUS_ID);

        const descriptionField =
            document.getElementById(DESCRIPTION_ID);

        if (!statusField || !descriptionField) {
            return;
        }

        const isClosed =
            statusField.value === 'Closed';

        const descriptionEmpty =
            descriptionField.value.trim() === '';

        const saveButtons = Array.from(
            document.querySelectorAll('input,button')
        ).filter(btn => {

            const text =
                (btn.value || btn.innerText || '').trim();

            return (
                text === 'Save' ||
                text === 'Save & New'
            );
        });

        let warning =
            document.getElementById(WARNING_ID);

        if (!warning) {

            warning =
                document.createElement('div');

            warning.id = WARNING_ID;

            warning.style.background = '#ffecec';
            warning.style.border = '2px solid #ff7070';
            warning.style.color = '#c00000';
            warning.style.padding = '10px';
            warning.style.marginBottom = '8px';
            warning.style.fontWeight = 'bold';
            warning.style.fontSize = '13px';
            warning.style.display = 'none';
            warning.style.borderRadius = '4px';

            statusField.parentNode.insertBefore(
                warning,
                statusField
            );
        }

        if (isClosed && descriptionEmpty) {

            warning.innerHTML =
                '⚠ Cannot close case. Description_local must be updated before setting Status to Closed.';

            warning.style.display = 'block';

            descriptionField.style.border =
                '2px solid red';

            descriptionField.style.backgroundColor =
                '#fff0f0';

            saveButtons.forEach(btn => {
                btn.style.display = 'none';
                btn.disabled = true;
            });

        } else {

            warning.style.display = 'none';

            descriptionField.style.border = '';
            descriptionField.style.backgroundColor = '';

            saveButtons.forEach(btn => {
                btn.style.display = '';
                btn.disabled = false;
            });
        }
    }

    function initializeDescriptionValidation() {

        const statusField =
            document.getElementById(STATUS_ID);

        const descriptionField =
            document.getElementById(DESCRIPTION_ID);

        if (!statusField || !descriptionField) {
            return false;
        }

        if (!statusField.dataset.defaultForAllHooked) {

            statusField.dataset.defaultForAllHooked =
                'true';

            statusField.addEventListener(
                'change',
                validateCase
            );

            descriptionField.addEventListener(
                'input',
                validateCase
            );

            descriptionField.addEventListener(
                'keyup',
                validateCase
            );

            descriptionField.addEventListener(
                'change',
                validateCase
            );
        }

        validateCase();
        return true;
    }

    /********************************************************************
     * START
     ********************************************************************/

    processStatusSynopsisRows();
    checkChatStatus();
    processActionRequiredRows();
    initializeDescriptionValidation();

    setInterval(
        processStatusSynopsisRows,
        STATUS_SYNOPSIS_CHECK_INTERVAL_MS
    );

    setInterval(
        checkChatStatus,
        CHAT_STATUS_CHECK_INTERVAL_MS
    );

    setInterval(
        processActionRequiredRows,
        ACTION_REQUIRED_CHECK_INTERVAL_MS
    );

    setInterval(
        initializeDescriptionValidation,
        DESCRIPTION_VALIDATION_CHECK_INTERVAL_MS
    );

})();
