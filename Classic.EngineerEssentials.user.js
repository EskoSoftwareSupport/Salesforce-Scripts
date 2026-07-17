// ==UserScript==
// @name         03 SFDC Classic Engineer Essentials
// @namespace    com.esko.salesforce.defaultforall
// @version      1.5.0
// @description  Customer Chat Monitor with beep alert + Action Required Alert Icon + Description_local validation before closing cases + Billable/Problem record type advisory banner + floating "My New Cases" / "Action Required" count bubbles with hover tooltips + Problem Urgency highlight panel color and badge + Problem Urgency list-view row coloring + Click-to-Call phone icons (dials via Microsoft Teams)
// @author       Esko Software Support
//
// @downloadURL  https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.EngineerEssentials.user.js
// @updateURL    https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.EngineerEssentials.user.js
//
// @match        https://esko.my.salesforce.com/*
// @match        https://esko--accept.cs83.my.salesforce.com/*
// @match        https://*.my.salesforce.com/*
// @match        https://*.salesforce.com/*
// @match        https://*.force.com/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTYuNjIgMTAuNzljMS40NCAyLjgzIDMuNzYgNS4xNCA2LjU5IDYuNTlsMi4yLTIuMmMuMjctLjI3LjY3LS4zNiAxLjAyLS4yNCAxLjEyLjM3IDIuMzMuNTcgMy41Ny41N2E5NiAwIDAgMSAxIDF2My41YzAgLjU1LS40NSAxLTEgMUMxMC4wNyAyMSAzIDEzLjkzIDMgNS41YzAtLjU1LjQ1LTEgMS0xSDcuNWMuNTUgMCAxIC40NSAxIDEgMCAxLjI1LjIgMi40Ni41NyAzLjU3LjExLjM1LjAzLjc1LS4yNCAxLjAybC0yLjIgMi4yeiIgZmlsbD0iIzQ2NGVmMSIvPjwvc3ZnPg==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /********************************************************************
     * LIGHTNING GUARD
     *
     * Several matched domains (my.salesforce.com, force.com) can also
     * serve Lightning Experience. Everything below targets Salesforce
     * Classic markup (x-grid3-* grid cells, Enhanced List iframes,
     * classic field ids, etc.), so bail out immediately if Lightning is
     * what's loaded — this also prevents the "My New Cases" bubble from
     * firing background iframe requests where they'd serve no purpose.
     ********************************************************************/

    const isLightningExperience =
        location.hostname.includes('lightning.force.com') ||
        location.pathname.startsWith('/one/one.app') ||
        location.pathname.startsWith('/lightning/') ||
        !!document.querySelector('body.lightningExperienceTheme') ||
        typeof window.$A !== 'undefined';

    if (isLightningExperience) {
        console.log('[SFDC Classic Engineer Essentials] Lightning Experience detected — script will not run here.');
        return;
    }


    /*###################################################################
     # PART 1 — CHAT MONITOR / ACTION-REQUIRED ICON / DESCRIPTION_LOCAL
     # VALIDATION  (original SFDC Classic Engineer Essentials logic)
     ###################################################################*/

    /********************************************************************
     * CONFIG
     ********************************************************************/

    const TAKE_ACTION_ICON_EMOJI = "🚨";

    const CHAT_BANNER_ID = "customer-chat-banner";

    const ACTION_REQUIRED_HEADER = "Action Required";
    const ACTION_ICON_CLASS = "action-required-alert-icon";
    const ACTION_STYLE_ID = "default-for-all-style";

    const STATUS_ID = 'cas7';
    const DESCRIPTION_ID = '00N57000006DwrR';
    const WARNING_ID = 'desc-local-warning';

    // Billable picklist: bare field id, same convention as STATUS_ID/
    // DESCRIPTION_ID above (Salesforce swaps each field's read-only
    // "<id>_ileinner" div for a bare-id form input while the page is in
    // inline edit mode). Case Record Type is never inline-editable, so it
    // always stays as the read-only "RecordType_ileinner" div, with or
    // without edit mode active.
    const BILLABLE_ID = '00ND0000006DaqD';
    // Case Record Type has no stable id in edit mode - it's rendered as
    // plain, unlabelled text ("<td class="dataCol col02">Problem</td>"),
    // so it must be located by its column label ("Case Record Type")
    // instead of getElementById.
    const RECORD_TYPE_LABEL_TEXT = 'Case Record Type';
    const BILLABLE_WARNING_ID = 'billable-warning';
    const BILLABLE_WARNING_TEXT =
        'This problem case is marked as billable are you sure its billable? ';

    const STATUS_SYNOPSIS_HEADER = "Status Synopsis";
    const SYNOPSIS_WRAPPER_CLASS = "status-synopsis-wrapper";
    const SYNOPSIS_CONTENT_CLASS = "status-synopsis-content";
    const SYNOPSIS_TOGGLE_CLASS = "status-synopsis-toggle";
    const SYNOPSIS_EXPANDED_CLASS = "expanded";
    const SYNOPSIS_PROCESSED_ATTR = "synopsisProcessed";

    const PROBLEM_URGENCY_HEADER = "Problem urgency";
    const PROBLEM_URGENCY_ROW_ATTR = "urgencyRowColored";
    // Same palette used for the case-detail highlight panel (Part 3).
    const PROBLEM_URGENCY_ROW_COLORS = {
        down: "#f2b1b1",
        critical: "#fae1a5",
        normal: "#b5d8f7",
        low: "#e0dede"
    };

    const CHAT_STATUS_CHECK_INTERVAL_MS = 10000;
    const ACTION_REQUIRED_CHECK_INTERVAL_MS = 5000;
    const PROBLEM_URGENCY_ROW_CHECK_INTERVAL_MS = 5000;
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
                font-size: 16px;
                line-height: 1;
                vertical-align: middle;
                display: inline-block;
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

    function getColumnKeyByHeaderTitleCI(headerTitle) {
        // Same lookup as getColumnKeyByHeaderTitle, but case-insensitive.
        // Salesforce list-view column headers take the field's configured
        // label, which may not match the exact casing used elsewhere
        // (e.g. the case detail page shows "Problem urgency").

        const target = headerTitle.toLowerCase();

        const headers =
            document.querySelectorAll(
                "div.x-grid3-hd-inner"
            );

        for (const header of headers) {

            const title =
                cleanText(header.getAttribute("title")).toLowerCase();

            const text =
                cleanText(header.textContent).toLowerCase();

            if (
                title === target ||
                text.includes(target)
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

        const icon =
            document.createElement("span");

        icon.className = ACTION_ICON_CLASS;
        icon.textContent = TAKE_ACTION_ICON_EMOJI;
        icon.title = "Action Required";

        actionCell.appendChild(icon);
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
     * PROBLEM URGENCY ROW COLOR (LIST VIEWS)
     ********************************************************************/

    function applyProblemUrgencyRowColor(row, bg) {

        row.style.setProperty("background-color", bg, "important");
        row.dataset[PROBLEM_URGENCY_ROW_ATTR] = "true";

        // The Ext JS grid renders each cell as its own <td>/div with its
        // own background (e.g. alternating-row striping), which can mask
        // a color set only on the row wrapper. Paint every cell too so
        // the whole row reads as one solid color.
        row.querySelectorAll("td, .x-grid3-cell-inner").forEach(cell => {
            cell.style.setProperty("background-color", bg, "important");
        });
    }

    function clearProblemUrgencyRowColor(row) {

        if (row.dataset[PROBLEM_URGENCY_ROW_ATTR] !== "true") {
            return;
        }

        delete row.dataset[PROBLEM_URGENCY_ROW_ATTR];
        row.style.removeProperty("background-color");

        row.querySelectorAll("td, .x-grid3-cell-inner").forEach(cell => {
            cell.style.removeProperty("background-color");
        });
    }

    function processProblemUrgencyRows() {

        const urgencyKey =
            getColumnKeyByHeaderTitleCI(
                PROBLEM_URGENCY_HEADER
            );

        if (!urgencyKey) {
            return;
        }

        document
            .querySelectorAll(".x-grid3-row")
            .forEach(row => {

                const urgencyCell =
                    findCell(row, urgencyKey);

                if (!urgencyCell) {
                    return;
                }

                const urgencyValue =
                    cleanText(urgencyCell.textContent).toLowerCase();

                const bg =
                    PROBLEM_URGENCY_ROW_COLORS[urgencyValue];

                if (bg) {
                    applyProblemUrgencyRowColor(row, bg);
                } else {
                    clearProblemUrgencyRowColor(row);
                }
            });
    }

    /********************************************************************
     * DESCRIPTION_LOCAL VALIDATION BEFORE CLOSING CASE
     ********************************************************************/

    function getRecordTypeText() {
        // Find the labelCol cell whose text matches "Case Record Type",
        // then read the very next cell (its value). This mirrors the
        // labelCol/dataCol pattern used throughout the classic page
        // layout, since Record Type has no stable id of its own here.
        const labelCells =
            document.querySelectorAll('td.labelCol, th.labelCol');

        for (const cell of labelCells) {

            const labelText =
                cleanText(cell.textContent);

            if (labelText === RECORD_TYPE_LABEL_TEXT) {

                const valueCell =
                    cell.nextElementSibling;

                if (valueCell) {
                    return cleanText(valueCell.textContent);
                }
            }
        }

        return null;
    }

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

        /**************************************************************
         * BILLABLE / PROBLEM RECORD TYPE ADVISORY BANNER
         *
         * Advisory only - unlike the Description_local check above,
         * this does not block Save. It just flags a combination worth
         * double-checking: closing a Problem-type case while Billable
         * is set to Yes.
         **************************************************************/

        const billableField =
            document.getElementById(BILLABLE_ID);

        const isBillableYes =
            !!billableField &&
            cleanText(billableField.value).toLowerCase() === 'yes';

        const recordTypeText =
            getRecordTypeText();

        const isProblemRecordType =
            !!recordTypeText &&
            recordTypeText.toLowerCase().startsWith('problem');

        let billableWarning =
            document.getElementById(BILLABLE_WARNING_ID);

        if (!billableWarning) {

            billableWarning =
                document.createElement('div');

            billableWarning.id = BILLABLE_WARNING_ID;

            billableWarning.style.background = '#fff3cd';
            billableWarning.style.border = '2px solid #ffb400';
            billableWarning.style.color = '#7a5b00';
            billableWarning.style.padding = '10px';
            billableWarning.style.marginBottom = '8px';
            billableWarning.style.fontWeight = 'bold';
            billableWarning.style.fontSize = '13px';
            billableWarning.style.display = 'none';
            billableWarning.style.borderRadius = '4px';

            statusField.parentNode.insertBefore(
                billableWarning,
                statusField
            );
        }

        if (isClosed && isBillableYes && isProblemRecordType) {

            billableWarning.innerHTML =
                '⚠ ' + BILLABLE_WARNING_TEXT;

            billableWarning.style.display = 'block';

            if (billableField) {
                billableField.style.border = '2px solid #ffb400';
                billableField.style.backgroundColor = '#fff3cd';
            }

        } else {

            billableWarning.style.display = 'none';

            if (billableField) {
                billableField.style.border = '';
                billableField.style.backgroundColor = '';
            }
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

        // Hooked independently from the block above: the Billable
        // picklist is a separate inline-edit field that may enter/exit
        // the DOM at a different time than Status/Description_local
        // (e.g. it's further down the page layout), so it gets its own
        // "already hooked" flag rather than sharing statusField's.
        const billableField =
            document.getElementById(BILLABLE_ID);

        if (billableField && !billableField.dataset.defaultForAllHooked) {

            billableField.dataset.defaultForAllHooked = 'true';

            billableField.addEventListener(
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
    processProblemUrgencyRows();
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
        processProblemUrgencyRows,
        PROBLEM_URGENCY_ROW_CHECK_INTERVAL_MS
    );

    setInterval(
        initializeDescriptionValidation,
        DESCRIPTION_VALIDATION_CHECK_INTERVAL_MS
    );

    /*###################################################################
     # PART 2 — "MY NEW CASES" / "ACTION REQUIRED" FLOATING COUNT BUBBLES
     # (merged in from: Salesforce My New Cases Counter)
     ###################################################################*/

  // ---- Configuration ---------------------------------------------------
  const LIST_VIEW_LABEL = 'My Support Cases'; // change if you rename the view
  const ALLOWED_STATUSES = ['new', 'new - incomplete']; // case-insensitive
  // Case's Classic "key prefix" — the first 3 chars of every Case record Id
  // and the object's tab URL (https://yourInstance/500). Fixed across all orgs.
  const OBJECT_KEY_PREFIX = '500';
  const POLL_INTERVAL_MS = 10000;
  // How long to wait after the iframe's "load" event before reading its
  // DOM, to give the Enhanced List's async row-fetch time to finish.
  const RENDER_SETTLE_MS = 2000;
  const LOAD_TIMEOUT_MS = 10000;
  // -----------------------------------------------------------------------

  const STORAGE_KEY = `sf_myNewCases_listViewId_v3_${location.hostname}`;

  let bubbleEl = null;
  let listViewId = localStorage.getItem(STORAGE_KEY) || null;
  let isPolling = false;

  // ---- UI ----------------------------------------------------------------

  const VIEW_SETTINGS_URL = 'https://packagingandcolor.atlassian.net/wiki/x/OAB1hg';
  let bubbleMode = 'normal'; // 'normal' | 'missingView'

  function handleBubbleClick() {
    if (bubbleMode === 'missingView') {
      window.open(VIEW_SETTINGS_URL, '_blank');
    } else {
      openListView();
    }
  }

  function createBubble() {
    if (bubbleEl) return bubbleEl;
    bubbleEl = document.createElement('div');
    bubbleEl.id = 'sf-my-new-cases-bubble';
    Object.assign(bubbleEl.style, {
      position: 'fixed',
      top: '14px',
      right: '170px',
      height: '32px',
      padding: '0 14px',
      borderRadius: '16px',
      background: '#ffffff',
      color: '#0176d3',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      fontFamily: 'Salesforce Sans, Arial, sans-serif',
      fontSize: '13px',
      fontWeight: '700',
      boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
      zIndex: 999999,
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      transition: 'background 0.2s ease',
    });
    bubbleEl.title = `${LIST_VIEW_LABEL} — click to open list view`;
    bubbleEl.textContent = '… New Case(s)';
    bubbleEl.addEventListener('click', handleBubbleClick);
    bubbleEl.addEventListener('mouseenter', showCaseTooltip);
    bubbleEl.addEventListener('mouseleave', hideCaseTooltip);
    document.body.appendChild(bubbleEl);
    return bubbleEl;
  }

  function setBubbleText(text, isError) {
    const el = createBubble();
    bubbleMode = 'normal';
    el.textContent = isError ? '! New Case(s)' : `${text} New Case(s)`;
    el.style.color = isError ? '#c23934' : '#0176d3';
    el.title = isError ? `${LIST_VIEW_LABEL} — click to open list view` : '';
    el.style.display = 'flex';
  }

  function setMissingViewState() {
    const el = createBubble();
    bubbleMode = 'missingView';
    el.textContent = '⚠️ View Settings';
    el.style.color = '#c23934';
    el.title = 'Click to open the setup guide for the missing list view';
    el.style.display = 'flex';
  }

  function hideBubble() {
    const el = createBubble();
    el.style.display = 'none';
  }

  // ---- Second bubble: Action Required count -----------------------

  let actionBubbleEl = null;

  function createActionBubble() {
    if (actionBubbleEl) return actionBubbleEl;
    actionBubbleEl = document.createElement('div');
    actionBubbleEl.id = 'sf-action-required-bubble';
    Object.assign(actionBubbleEl.style, {
      position: 'fixed',
      top: '14px',
      right: '170px',
      height: '32px',
      padding: '0 14px',
      borderRadius: '16px',
      background: '#ffffff',
      color: '#b1712c',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      fontFamily: 'Salesforce Sans, Arial, sans-serif',
      fontSize: '13px',
      fontWeight: '700',
      boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
      zIndex: 999999,
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap',
    });
    actionBubbleEl.title = '';
    actionBubbleEl.textContent = '… Action Required';
    actionBubbleEl.addEventListener('click', openListView);
    actionBubbleEl.addEventListener('mouseenter', showActionTooltip);
    actionBubbleEl.addEventListener('mouseleave', hideActionTooltip);
    document.body.appendChild(actionBubbleEl);
    return actionBubbleEl;
  }

  function setActionBubbleText(text) {
    const el = createActionBubble();
    el.textContent = `${text} Action Required`;
    el.style.display = 'flex';
  }

  function hideActionBubble() {
    const el = createActionBubble();
    el.style.display = 'none';
  }

  // ---- Hover tooltip: table of case details ------------------------

  const TOOLTIP_COLUMNS = ['Case Number', 'Customer Code', 'Problem urgency', 'Purposecode Description'];
  const ACTION_TOOLTIP_COLUMNS = TOOLTIP_COLUMNS.concat(['Status']);
  const ACTION_REQUIRED_COLUMN = 'Action Required';
  // Extracted for filtering purposes but not shown as its own tooltip column.
  const EXTRACT_COLUMNS = TOOLTIP_COLUMNS.concat(['Status', ACTION_REQUIRED_COLUMN]);
  let lastCaseRows = [];
  let lastActionRows = [];
  let tooltipEl = null;

  function isTruthyCell(cell) {
    if (!cell) return false;
    const checkbox = cell.querySelector('input[type="checkbox"]');
    if (checkbox) return checkbox.checked || checkbox.hasAttribute('checked');
    const img = cell.querySelector('img');
    if (img) {
      const alt = (img.getAttribute('alt') || '').trim().toLowerCase();
      const src = (img.getAttribute('src') || '').toLowerCase();
      // Check "unchecked" conditions FIRST — "Not Checked" contains the
      // substring "checked", so testing for "checked" first gives a false positive.
      if (src.includes('checkbox_unchecked') || alt === 'not checked' || alt === 'unchecked' || alt === 'false') {
        return false;
      }
      if (src.includes('checkbox_checked') || alt === 'checked' || alt === 'true') {
        return true;
      }
      return false;
    }
    const text = cell.textContent.trim().toLowerCase();
    return text === 'true' || text === 'checked' || text === 'yes' || text === '1';
  }

  function createTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'sf-my-new-cases-tooltip';
    Object.assign(tooltipEl.style, {
      position: 'fixed',
      display: 'none',
      background: '#ffffff',
      color: '#080707',
      border: '1px solid #d8dde6',
      borderRadius: '8px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
      padding: '10px 12px',
      fontFamily: 'Salesforce Sans, Arial, sans-serif',
      fontSize: '12px',
      zIndex: 1000000,
      maxWidth: '560px',
      maxHeight: '320px',
      overflow: 'auto',
    });
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const URGENCY_ROW_COLORS = {
    down: '#fde3e1', // light red
    critical: '#fdecd1', // light amber
    normal: '#e2f0fd', // light blue
    low: '#eeeeee', // light gray
  };

  function buildTooltipTableHtml(rows, columns) {
    const cols = columns || TOOLTIP_COLUMNS;
    const headCells = cols.map(
      (c) =>
        `<th style="text-align:left;padding:4px 10px;border-bottom:1px solid #d8dde6;white-space:nowrap;font-weight:700;">${escapeHtml(
          c
        )}</th>`
    ).join('');
    const bodyRows = rows
      .map((r) => {
        const urgencyKey = String(r['Problem urgency'] || '').trim().toLowerCase();
        const rowBg = URGENCY_ROW_COLORS[urgencyKey] || '';
        const rowStyle = rowBg ? ` style="background:${rowBg};"` : '';
        const cells = cols.map(
          (c) =>
            `<td style="padding:4px 10px;border-bottom:1px solid #f1f1f1;white-space:nowrap;">${escapeHtml(
              r[c]
            )}</td>`
        ).join('');
        return `<tr${rowStyle}>${cells}</tr>`;
      })
      .join('');
    return `<table style="border-collapse:collapse;width:100%;">
      <thead><tr>${headCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
  }

  function showCaseTooltip() {
    if (!lastCaseRows.length || !bubbleEl) return;
    const tip = createTooltip();
    tip.innerHTML = buildTooltipTableHtml(lastCaseRows);
    tip.style.display = 'block';
    const bubbleRect = bubbleEl.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = bubbleRect.right - tipRect.width;
    if (left < 8) left = 8;
    tip.style.top = `${Math.round(bubbleRect.bottom + 6)}px`;
    tip.style.left = `${Math.round(left)}px`;
  }

  function hideCaseTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function showActionTooltip() {
    if (!lastActionRows.length || !actionBubbleEl) return;
    const tip = createTooltip();
    tip.innerHTML = buildTooltipTableHtml(lastActionRows, ACTION_TOOLTIP_COLUMNS);
    tip.style.display = 'block';
    const bubbleRect = actionBubbleEl.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = bubbleRect.right - tipRect.width;
    if (left < 8) left = 8;
    tip.style.top = `${Math.round(bubbleRect.bottom + 6)}px`;
    tip.style.left = `${Math.round(left)}px`;
  }

  function hideActionTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function extractCaseRows(candidateDocs) {
    for (const doc of candidateDocs) {
      let resultsTable = null;
      let headerRow = null;
      let colIndex = {};

      for (const table of doc.querySelectorAll('table')) {
        for (const tr of table.querySelectorAll('tr')) {
          const cells = Array.from(tr.children);
          if (cells.length < 2) continue;
          const localIndex = {};
          cells.forEach((cell, idx) => {
            const label = cell.textContent.trim().toLowerCase();
            EXTRACT_COLUMNS.forEach((col) => {
              if (label === col.toLowerCase()) localIndex[col] = idx;
            });
          });
          // Treat this as the header row once it matches at least 2 of our
          // target columns — independent of any class names or link markup.
          if (Object.keys(localIndex).length >= 2) {
            resultsTable = table;
            headerRow = tr;
            colIndex = localIndex;
            break;
          }
        }
        if (resultsTable) break;
      }

      if (!resultsTable || !headerRow) continue;

      const headerCellCount = headerRow.children.length;
      const dataRows = Array.from(resultsTable.querySelectorAll('tr')).filter((tr) => {
        if (tr === headerRow) return false;
        // Real data rows should have roughly as many cells as the header row.
        return tr.children.length >= Math.max(2, headerCellCount - 1);
      });
      if (!dataRows.length) continue;

      const extracted = dataRows.map((tr) => {
        const cells = Array.from(tr.children);
        const obj = {};
        EXTRACT_COLUMNS.forEach((col) => {
          const idx = colIndex[col];
          const cellEl = idx != null ? cells[idx] : null;
          if (col === ACTION_REQUIRED_COLUMN) {
            obj[col] = isTruthyCell(cellEl);
          } else {
            obj[col] = cellEl ? cellEl.textContent.trim() : '';
          }
        });
        return obj;
      });
      console.log('[My New Cases Bubble] Extracted', extracted.length, 'row(s) for tooltip, columns found:', Object.keys(colIndex));
      return extracted;
    }
    console.warn('[My New Cases Bubble] extractCaseRows found no results table in any candidate document');
    return [];
  }

  // ---- Alert: shake + beep when there are new cases -----------------

  let audioCtx = null;
  function ensureAudioContext() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        audioCtx = null;
      }
    }
    return audioCtx;
  }
  // Browsers require a user gesture before audio can play; this primes
  // the AudioContext on the first click/keypress anywhere on the page.
  document.addEventListener('click', ensureAudioContext, { once: true });
  document.addEventListener('keydown', ensureAudioContext, { once: true });

  function playAlertSound() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const beepAt = (startTime) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.15);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.15);
    };

    beepAt(ctx.currentTime);
    beepAt(ctx.currentTime + 0.2);
  }

  function injectShakeStyle() {
    if (document.getElementById('sf-my-new-cases-shake-style')) return;
    const style = document.createElement('style');
    style.id = 'sf-my-new-cases-shake-style';
    style.textContent = `
@keyframes sfMyNewCasesShake {
  0% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
  100% { transform: translateX(0); }
}
.sf-my-new-cases-shake {
  animation: sfMyNewCasesShake 0.4s ease-in-out;
}`;
    document.head.appendChild(style);
  }

  function shakeBubble() {
    const el = createBubble();
    injectShakeStyle();
    el.classList.remove('sf-my-new-cases-shake');
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add('sf-my-new-cases-shake');
  }

  function positionBubbles() {
    try {
      const anchor = document.getElementById('tsid');
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return; // not laid out yet

      const top = `${Math.round(rect.top)}px`;
      const height = `${Math.round(rect.height)}px`;
      const nearRight = Math.round(window.innerWidth - rect.left + 5);

      const mainEl = createBubble();
      mainEl.style.top = top;
      mainEl.style.height = height;
      mainEl.style.left = 'auto';
      mainEl.style.right = `${nearRight}px`;

      const actionEl = createActionBubble();
      actionEl.style.top = top;
      actionEl.style.height = height;
      actionEl.style.left = 'auto';

      if (mainEl.style.display !== 'none') {
        // Sit just to the left of the main bubble, with its own 5px gap.
        const mainWidth = Math.round(mainEl.getBoundingClientRect().width);
        actionEl.style.right = `${nearRight + mainWidth + 5}px`;
      } else {
        // Main bubble isn't showing — take its spot instead.
        actionEl.style.right = `${nearRight}px`;
      }
    } catch (e) {
      console.warn('[My New Cases Bubble] positionBubbles failed', e);
    }
  }

  function openListView() {
    if (!listViewId) return;
    const url = `${location.origin}/${OBJECT_KEY_PREFIX}?fcf=${listViewId}`;
    window.open(url, '_blank');
  }

  // ---- Hidden-iframe page loader ----------------------------------------
  // Loads a Salesforce page in a real (but invisible) iframe so its
  // JavaScript actually runs — required because Enhanced List Views
  // populate their rows via an async call after the initial HTML loads.

  function loadHiddenPage(url) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, {
        position: 'fixed',
        width: '1px',
        height: '1px',
        left: '-9999px',
        top: '-9999px',
        border: '0',
        opacity: '0',
      });

      let settled = false;
      const cleanup = () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      };
      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Timed out loading ${url}`));
      }, LOAD_TIMEOUT_MS);

      iframe.addEventListener('load', () => {
        // Give the Enhanced List's async row-fetch time to finish.
        setTimeout(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          try {
            resolve(iframe.contentDocument);
          } catch (e) {
            reject(e);
          } finally {
            cleanup();
          }
        }, RENDER_SETTLE_MS);
      });

      document.body.appendChild(iframe);
      iframe.src = url;
    });
  }

  // ---- List view discovery & counting ----------------------------------

  async function findListViewId() {
    // The Case tab home page ("/500/o") contains the list-view picker
    // <select name="fcf">, whose option values are the list view Ids.
    const doc = await loadHiddenPage(`${location.origin}/${OBJECT_KEY_PREFIX}/o`);

    let select = doc.querySelector('select[name="fcf"], select#fcf');
    let options = select ? Array.from(select.options) : [];

    if (!options.length) {
      options = Array.from(doc.querySelectorAll('option'));
    }

    const match = options.find(
      (opt) => opt.textContent.trim().toLowerCase() === LIST_VIEW_LABEL.trim().toLowerCase()
    );

    if (!match || !match.value) {
      throw new Error(`List view "${LIST_VIEW_LABEL}" not found`);
    }
    console.log('[My New Cases Bubble] Resolved list view:', match.textContent.trim(), '->', match.value);
    return match.value;
  }

  function collectCandidateDocuments(rootDoc) {
    // Some Salesforce Classic themes render the Enhanced List's rows and
    // pagination text inside a nested iframe, not the top-level document.
    // Gather the root plus any same-origin nested iframe documents.
    const docs = [rootDoc];
    try {
      rootDoc.querySelectorAll('iframe').forEach((frame) => {
        try {
          if (frame.contentDocument) docs.push(frame.contentDocument);
        } catch (e) {
          // cross-origin frame — can't read it, skip
        }
      });
    } catch (e) {
      // ignore
    }
    return docs;
  }

  async function getListViewCount(id) {
    const rootDoc = await loadHiddenPage(`${location.origin}/${OBJECT_KEY_PREFIX}?fcf=${id}`);
    const candidateDocs = collectCandidateDocuments(rootDoc);
    console.log('[My New Cases Bubble] Searching', candidateDocs.length, 'document(s) for the count');

    // Salesforce doesn't error on a stale/deleted fcf Id — it silently
    // falls back to some other view instead. Guard against that by
    // confirming the page's view picker still shows "My New Cases" as
    // selected before trusting anything else on the page.
    let matchedLabel = null;
    for (const doc of candidateDocs) {
      const select = doc.querySelector('select[name="fcf"], select#fcf');
      if (select && select.selectedIndex >= 0 && select.options[select.selectedIndex]) {
        matchedLabel = select.options[select.selectedIndex].textContent.trim();
        break;
      }
    }
    if (matchedLabel && matchedLabel.toLowerCase() !== LIST_VIEW_LABEL.trim().toLowerCase()) {
      console.warn('[My New Cases Bubble] Loaded view is actually:', matchedLabel);
      throw new Error(`List view "${LIST_VIEW_LABEL}" not found`);
    }

    // The view now contains cases in every status, so the page's own
    // "X of Y" total (or row count) no longer represents what we want.
    // Extract every row, then keep only Status = New / New - Incomplete.
    const allRows = extractCaseRows(candidateDocs);
    const rows = allRows.filter((r) =>
      ALLOWED_STATUSES.includes(String(r['Status'] || '').trim().toLowerCase())
    );
    const actionRows = allRows.filter((r) => r[ACTION_REQUIRED_COLUMN] === true);
    console.log(
      '[My New Cases Bubble]',
      allRows.length,
      'total row(s) in view,',
      rows.length,
      'matching New / New - Incomplete status,',
      actionRows.length,
      'with Action Required'
    );
    return { count: rows.length, rows, actionCount: actionRows.length, actionRows };
  }

  // ---- Main loop -------------------------------------------------------

  async function refresh() {
    if (isPolling) return; // avoid overlapping iframe loads
    isPolling = true;
    try {
      if (!listViewId) {
        listViewId = await findListViewId();
        localStorage.setItem(STORAGE_KEY, listViewId);
      }
      const { count, rows, actionCount, actionRows } = await getListViewCount(listViewId);

      if (count > 0) {
        setBubbleText(String(count), false);
        lastCaseRows = rows;
        shakeBubble();
        playAlertSound();
      } else {
        hideBubble();
        hideCaseTooltip();
        lastCaseRows = [];
      }

      if (actionCount > 0) {
        setActionBubbleText(String(actionCount));
        lastActionRows = actionRows;
      } else {
        hideActionBubble();
        hideActionTooltip();
        lastActionRows = [];
      }

      positionBubbles();
    } catch (err) {
      console.warn('[My New Cases Bubble]', err);
      hideCaseTooltip();
      lastCaseRows = [];
      hideActionBubble();
      hideActionTooltip();
      lastActionRows = [];
      if (String(err.message).includes('not found')) {
        listViewId = null;
        localStorage.removeItem(STORAGE_KEY);
        setMissingViewState();
      } else {
        setBubbleText('!', true);
      }
      positionBubbles();
    } finally {
      isPolling = false;
    }
  }

  function start() {
    createBubble();
    createActionBubble();
    positionBubbles();
    setTimeout(positionBubbles, 1000);
    setTimeout(positionBubbles, 3000);
    window.addEventListener('resize', positionBubbles);
    refresh();
    setInterval(refresh, POLL_INTERVAL_MS);
  }

  // Part 2 must only run in the top-level window. Without @noframes, this
  // script now also loads inside: (a) Salesforce's own nested "Enhanced
  // List" grid iframe — which Part 1 above needs, so we can't block frames
  // entirely — and (b) the short-lived hidden iframes loadHiddenPage()
  // creates for polling. Letting Part 2 run in either would spawn
  // duplicate bubbles and/or recursively re-trigger its own iframe loads.
  if (window.top === window.self) {
    if (document.body) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    }
  }

})();

/*###################################################################
 # PART 3 — PROBLEM URGENCY HIGHLIGHT PANEL COLOR + BADGE
 #
 # Tints the case highlight panel (.efhpContainer) and shows a
 # "<Urgency> Case" badge next to "Customer", based on the Problem
 # Urgency picklist field (Down / Critical / Normal / Low). Runs as
 # its own top-level IIFE (rather than nested in Part 1/2's IIFE)
 # since it drives its own recursive same-origin frame walk and top
 # frame gating, independent of Part 1/2's logic.
 ###################################################################*/

(function () {
    'use strict';

    const DEBUG = true;

    const BADGE_BASE_CLASS = 'ue-case-badge';

    // One entry per Problem Urgency picklist value we care about.
    // panelBg: soft tint applied to the whole highlight panel (.efhpContainer).
    // badgeBg/badgeColor/badgeLabel: bright badge shown next to "Customer".
    // "Salesforce Blue" here is the Lightning Design System brand blue (#0070D2).
    const URGENCY_CONFIG = {
        down:     { panelBg: '#f2b1b1', badgeClass: 'ue-badge-down',     badgeBg: '#e00000', badgeColor: '#ffffff', badgeLabel: 'Down Case' },
        critical: { panelBg: '#fae1a5', badgeClass: 'ue-badge-critical', badgeBg: '#ffb400', badgeColor: '#000000', badgeLabel: 'Critical Case' },
        normal:   { panelBg: '#b5d8f7', badgeClass: 'ue-badge-normal',   badgeBg: '#0070d2', badgeColor: '#ffffff', badgeLabel: 'Normal Case' },
        low:      { panelBg: '#e0dede', badgeClass: 'ue-badge-low',      badgeBg: '#9e9e9e', badgeColor: '#000000', badgeLabel: 'Low Case' }
    };

    // The Problem Urgency custom field's permanent internal ID in this org.
    // Salesforce renders its inline-edit value as <div id="00ND0000006Dar9_ileinner">Down</div>
    const PROBLEM_URGENCY_FIELD_ID = '00ND0000006Dar9';

    function log(...args) {
        if (DEBUG) console.log('[UrgencyBadge]', window.location.href, ...args);
    }

    // Only the top-most frame drives the logic. It recursively walks into
    // same-origin nested iframes (console apps nest several apex pages in
    // iframes) to find the Problem Urgency field and the Customer row,
    // wherever each happens to live.
    if (window !== window.top) {
        return;
    }

    log('top frame active, watching for case view');

    // Inject badge styling into a given document if not already present there.
    // Each iframe is a separate document with its own style scope.
    const styledDocs = new WeakSet();
    function ensureStyleInjected(doc) {
        if (styledDocs.has(doc)) return;
        styledDocs.add(doc);
        try {
            const variantRules = Object.values(URGENCY_CONFIG).map((cfg) => `
                .${cfg.badgeClass} {
                    background-color: ${cfg.badgeBg} !important;
                    color: ${cfg.badgeColor} !important;
                }
            `).join('\n');

            const style = doc.createElement('style');
            style.textContent = `
                .${BADGE_BASE_CLASS} {
                    display: inline-block;
                    font-weight: bold;
                    font-size: 11px;
                    line-height: 1;
                    padding: 3px 8px;
                    border-radius: 3px;
                    margin-left: 8px;
                    vertical-align: middle;
                }
                ${variantRules}
            `;
            (doc.head || doc.documentElement).appendChild(style);
        } catch (e) {
            log('failed to inject style into a document', e);
        }
    }

    // Recursively collect all reachable documents (top + same-origin nested iframes)
    function collectDocuments(doc, out) {
        out.push(doc);
        let iframes;
        try {
            iframes = doc.querySelectorAll('iframe');
        } catch (e) {
            return;
        }
        iframes.forEach((frame) => {
            try {
                const innerDoc = frame.contentDocument;
                if (innerDoc) {
                    collectDocuments(innerDoc, out);
                }
            } catch (e) {
                // Cross-origin iframe (e.g. *.vf.force.com) - can't access, skip it.
            }
        });
    }

    // Extract a Salesforce Case ID (15 or 18 char, starts with "500") from a URL.
    function extractCaseId(url) {
        if (!url) return null;
        const match = url.match(/\b500[a-zA-Z0-9]{12,15}\b/);
        return match ? match[0].substring(0, 15) : null; // normalize to 15-char form
    }

    // Walk the frame tree, tracking the "current" case ID as we descend
    // (inherited from the nearest ancestor frame whose URL contains one).
    // Every Problem Urgency field found, and every frame that contains a
    // .efhpContainer element (the highlight panel - the top banner with
    // Customer / Case Title / Description), gets tagged with that case ID.
    // Within that panel we also grab the "Customer" label for the badge.
    // This way we only ever color/badge the panel that belongs to the case
    // whose urgency we actually read - even when Console has several case
    // tabs open at once in separate parallel iframe trees.
    function walk(doc, inheritedCaseId, urgencyByCase, workAreaByCase) {
        let caseId = inheritedCaseId;
        try {
            const found = extractCaseId(doc.location.href);
            if (found) caseId = found;
        } catch (e) {
            // ignore
        }

        try {
            const urgencyEl = doc.getElementById(PROBLEM_URGENCY_FIELD_ID + '_ileinner');
            if (urgencyEl && caseId) {
                const val = urgencyEl.textContent.replace(/\u00A0/g, ' ').trim();
                urgencyByCase[caseId] = val;
                log('case', caseId, 'urgency =', JSON.stringify(val));
            }
        } catch (e) { /* ignore */ }

        try {
            const containerEl = doc.querySelector('.efhpContainer');
            if (containerEl && caseId) {
                const labelEl = containerEl.querySelector('.efhpLabel[title="Customer"]');
                (workAreaByCase[caseId] = workAreaByCase[caseId] || []).push({
                    containerEl: containerEl,
                    labelEl: labelEl
                });
            }
        } catch (e) { /* ignore */ }

        let iframes;
        try {
            iframes = doc.querySelectorAll('iframe');
        } catch (e) {
            return;
        }
        iframes.forEach((frame) => {
            try {
                const innerDoc = frame.contentDocument;
                if (innerDoc) {
                    walk(innerDoc, caseId, urgencyByCase, workAreaByCase);
                }
            } catch (e) {
                // Cross-origin iframe - skip.
            }
        });
    }

    const COLOR_ATTR = 'data-urgency-colored';

    function applyPanelColor(containerEl, config) {
        try {
            containerEl.style.setProperty('background-color', config.panelBg, 'important');
            containerEl.setAttribute(COLOR_ATTR, 'true');
        } catch (e) {
            log('failed to color a panel element', e);
        }
    }

    function clearPanelColor(containerEl) {
        try {
            if (containerEl.getAttribute(COLOR_ATTR) === 'true') {
                containerEl.style.removeProperty('background-color');
                containerEl.removeAttribute(COLOR_ATTR);
            }
        } catch (e) { /* ignore */ }
    }

    function applyBadge(labelEl, config) {
        if (!labelEl) return;
        const doc = labelEl.ownerDocument;
        ensureStyleInjected(doc);

        let badge = labelEl.querySelector('.' + BADGE_BASE_CLASS);
        if (!badge) {
            badge = doc.createElement('span');
            badge.className = BADGE_BASE_CLASS;
            labelEl.appendChild(badge);
        }
        badge.className = BADGE_BASE_CLASS + ' ' + config.badgeClass;
        badge.textContent = config.badgeLabel;
    }

    function removeBadge(labelEl) {
        if (!labelEl) return;
        const existing = labelEl.querySelector('.' + BADGE_BASE_CLASS);
        if (existing) existing.remove();
    }

    function checkAndApply() {
        const urgencyByCase = {};
        const workAreaByCase = {};
        walk(document, null, urgencyByCase, workAreaByCase);

        const caseIds = Object.keys(workAreaByCase);
        if (caseIds.length === 0) {
            log('no highlight panel found in any reachable frame yet');
        }

        caseIds.forEach((caseId) => {
            const urgency = urgencyByCase[caseId];
            const key = urgency ? urgency.trim().toLowerCase() : null;
            const config = key ? URGENCY_CONFIG[key] : null;

            workAreaByCase[caseId].forEach(({ containerEl, labelEl }) => {
                if (config) {
                    applyPanelColor(containerEl, config);
                    applyBadge(labelEl, config);
                } else {
                    clearPanelColor(containerEl);
                    removeBadge(labelEl);
                }
            });
        });
    }

    let debounceTimer = null;
    function scheduleCheck() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(checkAndApply, 400);
    }

    scheduleCheck();

    // Watch the top document for changes (new tabs/case switches load new
    // iframes into the DOM). We also attach observers to nested same-origin
    // documents as they're discovered, since console apps swap iframe
    // contents in place without necessarily re-triggering the top observer.
    const observedDocs = new WeakSet();
    function watchDocument(doc) {
        if (observedDocs.has(doc)) return;
        observedDocs.add(doc);
        try {
            const obs = new MutationObserver(scheduleCheck);
            obs.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
        } catch (e) {
            // ignore
        }
    }

    function watchAllReachableDocuments() {
        const docs = [];
        collectDocuments(document, docs);
        docs.forEach(watchDocument);
    }

    watchAllReachableDocuments();
    // Re-scan periodically for newly created iframes (console tab switches),
    // since a brand-new iframe won't be covered by existing observers.
    setInterval(() => {
        watchAllReachableDocuments();
        scheduleCheck();
    }, 2000);

})();


/*###################################################################
 # PART 4 — CLICK-TO-CALL (MICROSOFT TEAMS)
 #
 # Merged in from "Salesforce Classic Click-to-Call (Microsoft Teams)"
 # (standalone script, formerly its own .user.js). Kept as its own
 # self-contained IIFE, appended after Parts 1-3, so it runs
 # independently of — and after — everything above:
 #   - It has its own top-level "use strict" scope, so none of its
 #     identifiers (CONFIG, STYLE, etc.) can collide with Parts 1-3.
 #   - It deliberately does NOT go through the LIGHTNING GUARD above:
 #     the original script targeted Classic pages *and* embedded
 #     Visualforce/Lightning Console panels, so gating it behind the
 #     Classic-only guard would silently disable it where it used to
 #     work. If Click-to-Call should also stop running in Lightning,
 #     add the same isLightningExperience check inside this IIFE.
 ###################################################################*/

(function () {
  'use strict';

  /* ----------------------------------------------------------------
   * CONFIG
   * ---------------------------------------------------------------- */
  const CONFIG = {
    // Default country code to prepend if the number looks local (no + / 00 prefix).
    // Set to '' if you don't want auto-prefixing.
    defaultCountryCode: '+1',
    iconTitle: 'Call via Microsoft Teams',
    scanIntervalMs: 800, // periodic re-scan, cheap safety net alongside MutationObserver
    // Set true temporarily to console.log what's being found, and render
    // the icon in a way that can't be hidden by clipping/positioning, so
    // we can tell "not detected" apart from "detected but invisible".
    DEBUG: false,
  };

  const PROCESSED_ATTR = 'data-sftc-processed';
  const ICON_CLASS = 'sftc-call-icon';

  /* ----------------------------------------------------------------
   * STYLES
   * ---------------------------------------------------------------- */
  const style = document.createElement('style');
  style.textContent = `
    .${ICON_CLASS} {
      position: absolute;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      opacity: 0.85;
      transition: opacity 0.15s ease, transform 0.15s ease;
      white-space: nowrap;
      z-index: 2147483000;
    }
    .${ICON_CLASS}:hover {
      opacity: 1;
      transform: scale(1.2);
    }
    .${ICON_CLASS}.sftc-debug {
      position: absolute;
      background: #ff0000;
      color: #ffffff;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 13px;
      opacity: 1;
      box-shadow: 0 0 0 2px #000;
    }

    .${ICON_CLASS}.sftc-inline-icon {
      position: static;
      display: inline-flex;
      vertical-align: middle;
      margin-left: 4px;
    }
    .sftc-sig-number {
      /* marker wrapper around a matched signature phone number; no visual styling needed */
    }

    #sftc-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    }
    #sftc-modal {
      background: #ffffff;
      border-radius: 10px;
      width: 340px;
      max-width: 90vw;
      padding: 20px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    }
    #sftc-modal h3 {
      margin: 0 0 12px 0;
      font-size: 16px;
      color: #16325c;
    }
    #sftc-modal label {
      display: block;
      font-size: 12px;
      color: #54698d;
      margin-bottom: 4px;
    }
    #sftc-number-input {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      font-size: 14px;
      border: 1px solid #c9c9c9;
      border-radius: 6px;
      margin-bottom: 16px;
    }
    #sftc-number-input:focus {
      outline: none;
      border-color: #0176d3;
      box-shadow: 0 0 0 2px rgba(1,118,211,0.2);
    }
    #sftc-btn-row {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    #sftc-btn-row button {
      padding: 8px 16px;
      font-size: 13px;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
    }
    #sftc-cancel-btn {
      background: #ffffff;
      border-color: #c9c9c9;
      color: #16325c;
    }
    #sftc-cancel-btn:hover {
      background: #f3f3f3;
    }
    #sftc-call-btn {
      background: #0176d3;
      color: #ffffff;
    }
    #sftc-call-btn:hover {
      background: #014f96;
    }
    #sftc-error {
      color: #c23934;
      font-size: 12px;
      margin: -10px 0 12px 0;
      display: none;
    }
  `;
  document.head.appendChild(style);

  const PHONE_ICON_GLYPH = '📞';

  /* ----------------------------------------------------------------
   * HELPERS
   * ---------------------------------------------------------------- */

  // Basic phone-number *shape* sniff: digits, spaces, dashes, parens, leading +
  const PHONE_REGEX = /^\+?[0-9()\-.\s]{7,20}$/;

  // Labels we treat as "this cell is a phone number". Deliberately excludes
  // "Fax" — you don't dial a fax line via Teams. Add/remove as needed for
  // custom fields in your org (e.g. "Assistant Phone", "Emergency Contact").
  const PHONE_LABEL_REGEX = /\b(phone|mobile|cell)\b/i;
  const EXCLUDE_LABEL_REGEX = /\bfax\b|\bextension\b|\bext\.?\b/i;
  const MAX_LABEL_LENGTH = 40;

  function looksLikePhoneNumber(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (!trimmed || trimmed === '\u00A0') return false;
    const digitCount = (trimmed.match(/\d/g) || []).length;
    return digitCount >= 7 && PHONE_REGEX.test(trimmed);
  }

  function isPhoneLabel(labelText) {
    if (!labelText) return false;
    const t = labelText.trim();
    if (!t) return false;
    if (EXCLUDE_LABEL_REGEX.test(t)) return false;
    return PHONE_LABEL_REGEX.test(t);
  }

  function normalizeForTel(raw) {
    let num = raw.trim();
    // strip everything except leading + and digits
    num = num.replace(/(?!^\+)[^\d]/g, '');
    if (!num.startsWith('+')) {
      if (CONFIG.defaultCountryCode) {
        num = CONFIG.defaultCountryCode + num.replace(/^0+/, '');
      } else {
        num = '+' + num;
      }
    }
    return num;
  }

  // Classic (and embedded Visualforce/Lightning panels) render field
  // label/value pairs in all sorts of markup: <td class="labelCol">,
  // <div class="field-label">, plain <span> grids, etc. Rather than
  // depending on specific class names (fragile across orgs/custom pages),
  // we match on the *label text itself* and then locate its paired value
  // structurally.
  function findPhoneElements(root) {
    const results = [];
    const seen = new Set();

    function add(el) {
      if (el && !el.hasAttribute(PROCESSED_ATTR) && !seen.has(el)) {
        seen.add(el);
        results.push(el);
      }
    }

    function inOwnUi(el) {
      return !!(el.closest && (el.closest('#sftc-overlay') || el.closest('.' + ICON_CLASS)));
    }

    // 1) Orgs with Open CTI / softphone / click-to-dial enabled render
    //    phone fields as <a href="tel:...">.
    root.querySelectorAll('a[href^="tel:"]').forEach((el) => {
      if (!inOwnUi(el)) add(el);
    });

    // 2) Generic label -> value pairing. A "label" is a leaf element
    //    (no element children, just text) whose own text matches a phone
    //    label. We climb through single-child wrapper elements to find the
    //    row/cell this label actually occupies, then take the next
    //    non-empty sibling as the value.
    const labelCandidates = root.querySelectorAll('td, th, div, span, label, dt, strong, b, p');
    labelCandidates.forEach((labelEl) => {
      if (inOwnUi(labelEl)) return;
      if (labelEl.children.length > 0) return; // leaf elements only
      const text = labelEl.textContent.trim();
      if (!text || text.length > MAX_LABEL_LENGTH) return;
      if (!isPhoneLabel(text)) return;

      if (CONFIG.DEBUG) console.log('[sftc] label match:', JSON.stringify(text), labelEl);

      const valueEl = findValueSibling(labelEl);
      if (!valueEl || inOwnUi(valueEl)) {
        if (CONFIG.DEBUG) console.log('[sftc]   -> no value sibling found for', JSON.stringify(text));
        return;
      }

      const innerLink = valueEl.querySelector && valueEl.querySelector('a[href^="tel:"]');
      if (innerLink) {
        if (CONFIG.DEBUG) console.log('[sftc]   -> found tel: link inside value', innerLink);
        add(innerLink);
        return;
      }
      if (looksLikePhoneNumber(valueEl.textContent)) {
        if (CONFIG.DEBUG) console.log('[sftc]   -> value matched phone shape:', JSON.stringify(valueEl.textContent), valueEl);
        add(valueEl);
      } else if (CONFIG.DEBUG) {
        console.log('[sftc]   -> value found but did not look like a phone number:', JSON.stringify(valueEl.textContent), valueEl);
      }
    });

    // 3) List views / related lists: <th>Phone</th> column header, then
    //    matching <td> in each row by column index.
    root.querySelectorAll('table').forEach((table) => {
      const headerRow = table.querySelector('thead tr, tr.headerRow');
      if (!headerRow) return;
      const headerCells = Array.from(headerRow.children);
      const phoneColIndexes = [];
      headerCells.forEach((th, idx) => {
        if (isPhoneLabel(th.textContent)) phoneColIndexes.push(idx);
      });
      if (phoneColIndexes.length === 0) return;

      const bodyRows = table.querySelectorAll('tbody tr, tr.dataRow');
      bodyRows.forEach((row) => {
        const cells = Array.from(row.children);
        phoneColIndexes.forEach((idx) => {
          const cell = cells[idx];
          if (!cell || inOwnUi(cell)) return;
          const innerLink = cell.querySelector('a[href^="tel:"]');
          if (innerLink) {
            add(innerLink);
            return;
          }
          if (looksLikePhoneNumber(cell.textContent)) add(cell);
        });
      });
    });

    return results;
  }

  // Climb through wrapper elements that exist purely to hold this one
  // label (parent has exactly one child), to find the element that
  // actually occupies a "cell" position in the row/grid.
  function findLabelCellNode(el) {
    let node = el;
    while (
      node.parentElement &&
      node.parentElement !== document.body &&
      node.parentElement.children.length === 1
    ) {
      node = node.parentElement;
    }
    return node;
  }

  function findValueSibling(labelEl) {
    const cellNode = findLabelCellNode(labelEl);
    let sib = cellNode.nextElementSibling;
    while (sib && !sib.textContent.trim()) {
      sib = sib.nextElementSibling;
    }
    return sib;
  }

  function extractNumberFromElement(el) {
    if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href').toLowerCase().startsWith('tel:')) {
      const href = el.getAttribute('href');
      return decodeURIComponent(href.replace(/^tel:/i, ''));
    }
    return el.textContent.trim();
  }

  // Salesforce often pads value cells to a fixed column width far wider
  // than the text they contain (e.g. a 370px-wide cell holding a 14-char
  // number). Measuring the cell's own bounding box for icon placement puts
  // the icon way past the visible text — sometimes past the edge of the
  // frame entirely. Measuring a Range around the actual text content gives
  // the real rendered extent of the text instead.
  function getTextRect(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = range.getClientRects();
      if (rects.length > 0) {
        return rects[rects.length - 1];
      }
    } catch (e) {
      // fall through to element rect
    }
    return el.getBoundingClientRect();
  }

  function injectIcon(el) {
    el.setAttribute(PROCESSED_ATTR, 'true');

    const number = extractNumberFromElement(el);
    // Loosen the shape check here vs. detection time: label-matched <td>
    // cells were already confirmed by looksLikePhoneNumber before being
    // added, tel: links may include separators our regex didn't fully
    // anticipate. Just make sure we ended up with *some* digits.
    if ((number.match(/\d/g) || []).length < 7) return;

    if (CONFIG.DEBUG) console.log('[sftc] injecting icon for number:', number, el, 'in frame:', window.location.href, 'top frame?', window === window.top);

    const icon = document.createElement('span');
    icon.className = ICON_CLASS + (CONFIG.DEBUG ? ' sftc-debug' : '');
    icon.title = CONFIG.iconTitle;
    icon.textContent = CONFIG.DEBUG ? 'CALL: ' + number : PHONE_ICON_GLYPH;
    icon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCallModal(number);
    });

    // Anchored to <body> with document-coordinate math, rather than
    // appended inside the value cell with CSS positioning relative to it.
    // "position: relative" on a <td> is a known unreliable containing
    // block for absolutely-positioned children across browsers and
    // Salesforce's own CSS overrides — it produced icons landing at the
    // wrong offset (overlapping mid-text) rather than after the number.
    // Anchoring to body and computing pixel coordinates directly sidesteps
    // that entirely.
    document.body.appendChild(icon);

    const positionIcon = () => {
      // Measure BEFORE the icon is considered part of any range (it never
      // is here, since it's a sibling of el's subtree, not a child of el)
      // — this keeps the text measurement uncontaminated.
      const textRect = getTextRect(el);
      icon.style.top = textRect.top + window.scrollY + textRect.height / 2 - 9 + 'px';
      let left = textRect.right + window.scrollX + 6;
      // Clamp so the icon can't render past the frame's own visible width
      // (Salesforce panels are often exactly viewport-width with no
      // horizontal scroll, so anything past this edge is invisible).
      const maxLeft = document.documentElement.clientWidth - 26;
      if (left > maxLeft) left = maxLeft;
      icon.style.left = left + 'px';
      if (CONFIG.DEBUG) {
        console.log('[sftc] icon placed at', icon.style.top, icon.style.left, 'text rect:', textRect, 'frame size:', window.innerWidth, window.innerHeight);
      }
    };
    positionIcon();
    // Re-position on scroll/resize in case the panel scrolls or reflows.
    window.addEventListener('scroll', positionIcon, true);
    window.addEventListener('resize', positionIcon);

    if (CONFIG.DEBUG && !window.__sftcAlerted) {
      // Ultimate diagnostic, kept behind DEBUG: alert() shows a native
      // dialog at the browser level regardless of whether this frame is
      // currently the visible Console tab or a hidden background one.
      window.__sftcAlerted = true;
      alert('[sftc DEBUG] Found number ' + number + ' in frame: ' + window.location.href + (window === window.top ? ' (TOP frame)' : ' (IFRAME)'));
    }
  }

  function scanForPhoneNumbers() {
    const candidates = findPhoneElements(document);
    if (CONFIG.DEBUG && candidates.length > 0) {
      console.log('[sftc] scan found', candidates.length, 'new candidate(s)');
    }
    candidates.forEach(injectIcon);
    scanTextNodesForSignaturePhones(document);
  }

  /* ----------------------------------------------------------------
   * EMAIL / FREE-TEXT SIGNATURE SCANNING
   *
   * Phone numbers also show up inline in free text — email signatures,
   * case comments, chatter posts — like "Mob. 937.260.9423" or
   * "Mob.: 9818399083". These aren't in a labelled table cell, so the
   * label/value pairing above doesn't apply. Instead we look for a
   * recognizable label word directly followed by a number, directly in
   * the text itself. Requiring the label is what keeps this from matching
   * unrelated numbers in the same text (GST numbers, addresses, order
   * numbers, zip codes, etc.).
   * ---------------------------------------------------------------- */

  const SIGNATURE_PHONE_REGEX =
    /\b(?:Mob(?:ile)?|Phone|Tel(?:ephone)?|Cell|Ph|Contact(?:\s*(?:No\.?|Number))?)[\s:.]*([+]?[0-9][0-9()\-.\s]{5,18}[0-9)])/gi;

  function scanTextNodesForSignaturePhones(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'INPUT') {
          return NodeFilter.FILTER_REJECT;
        }
        if (
          parent.closest &&
          (parent.closest('#sftc-overlay') || parent.closest('.' + ICON_CLASS) || parent.closest('.sftc-sig-number'))
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        // Quick pre-filter: skip nodes with no digits at all before running the full regex.
        if (!node.nodeValue || !/\d/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    textNodes.forEach((node) => {
      const text = node.nodeValue;
      SIGNATURE_PHONE_REGEX.lastIndex = 0;
      const matches = [];
      let m;
      while ((m = SIGNATURE_PHONE_REGEX.exec(text))) {
        const numberText = m[1];
        if (!looksLikePhoneNumber(numberText)) continue;
        const fullMatch = m[0];
        const numOffsetInFull = fullMatch.lastIndexOf(numberText);
        const start = m.index + numOffsetInFull;
        const end = start + numberText.length;
        matches.push({ start, end, numberText });
      }
      if (matches.length === 0) return;

      // Process in reverse so earlier offsets in this node stay valid as
      // we split it up.
      matches
        .reverse()
        .forEach(({ start, end, numberText }) => wrapSignatureNumber(node, start, end, numberText));
    });
  }

  function wrapSignatureNumber(textNode, start, end, numberText) {
    // Split the text node into [before][number][after], then wrap the
    // number portion and insert the icon right after it — since this
    // becomes a real part of the text flow, the browser positions it
    // correctly with no coordinate math needed.
    const afterStart = textNode.splitText(start); // textNode now ends at `start`; afterStart begins there
    const rest = afterStart.splitText(end - start); // afterStart now holds exactly the number substring

    const wrapper = document.createElement('span');
    wrapper.className = 'sftc-sig-number';
    afterStart.parentNode.insertBefore(wrapper, afterStart);
    wrapper.appendChild(afterStart);

    const icon = document.createElement('span');
    icon.className = ICON_CLASS + ' sftc-inline-icon';
    icon.title = CONFIG.iconTitle;
    icon.textContent = PHONE_ICON_GLYPH;
    icon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCallModal(numberText);
    });
    wrapper.parentNode.insertBefore(icon, rest);
  }

  /* ----------------------------------------------------------------
   * MODAL
   * ---------------------------------------------------------------- */

  function closeModal() {
    const overlay = document.getElementById('sftc-overlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', onEscKey);
  }

  function onEscKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  function openCallModal(rawNumber) {
    closeModal(); // ensure only one instance

    const overlay = document.createElement('div');
    overlay.id = 'sftc-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    overlay.innerHTML = `
      <div id="sftc-modal" role="dialog" aria-modal="true" aria-labelledby="sftc-title">
        <h3 id="sftc-title">Call Contact</h3>
        <label for="sftc-number-input">Phone number</label>
        <input id="sftc-number-input" type="text" value="${rawNumber.replace(/"/g, '&quot;')}" />
        <div id="sftc-error">Please enter a valid phone number.</div>
        <div id="sftc-btn-row">
          <button id="sftc-cancel-btn" type="button">Cancel</button>
          <button id="sftc-call-btn" type="button">Call</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onEscKey);

    const input = document.getElementById('sftc-number-input');
    input.focus();
    input.select();

    document.getElementById('sftc-cancel-btn').addEventListener('click', closeModal);

    document.getElementById('sftc-call-btn').addEventListener('click', () => {
      const value = input.value.trim();
      const errorEl = document.getElementById('sftc-error');
      if (!looksLikePhoneNumber(value)) {
        errorEl.style.display = 'block';
        return;
      }
      errorEl.style.display = 'none';
      dialViaTeams(value);
      closeModal();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('sftc-call-btn').click();
    });
  }

  /* ----------------------------------------------------------------
   * TEAMS DIALING
   *
   * We use the Teams *web* deep link rather than the raw msteams: URI.
   * When Teams desktop is installed, the OS/browser protocol handler
   * registered by Teams intercepts this URL and opens the native app on
   * both macOS and Windows, so no OS branching is required. If Teams
   * isn't installed, the link falls back to teams.microsoft.com in browser.
   * ---------------------------------------------------------------- */

  function dialViaTeams(rawNumber) {
    const e164 = normalizeForTel(rawNumber);
    // "4:" prefix tells Teams this is a PSTN phone number (not a user UPN)
    const teamsUrl =
      'https://teams.microsoft.com/l/call/0/0?users=4:' +
      encodeURIComponent(e164) +
      '&withVideo=false';

    // Opening in a new tab lets the OS protocol handler take over cleanly
    // on both Mac and Windows without navigating away from Salesforce.
    window.open(teamsUrl, '_blank', 'noopener,noreferrer');
  }

  /* ----------------------------------------------------------------
   * OBSERVE SALESFORCE'S SPA DOM (Lightning re-renders constantly)
   * ---------------------------------------------------------------- */

  const observer = new MutationObserver(() => {
    scanForPhoneNumbers();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Safety-net periodic scan in case some updates dodge the observer
  // (e.g. attribute-only href changes on tel: links after component reuse).
  setInterval(scanForPhoneNumbers, CONFIG.scanIntervalMs);

  // Initial scan
  scanForPhoneNumbers();
})();
