// ==UserScript==
// @name         SFDC Classic Engineer Essentials
// @namespace    com.esko.salesforce.defaultforall
// @version      1.3.0
// @description  Customer Chat Monitor with beep alert + Action Required Alert Icon + Description_local validation before closing cases + floating "My New Cases" / "Action Required" count bubbles with hover tooltips + Problem Urgency highlight panel color and badge + Problem Urgency list-view row coloring
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
