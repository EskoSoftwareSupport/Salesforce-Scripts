// ==UserScript==
// @name         01 SFDC Classic Validation Queue And dispatching
// @namespace    com.esko.l1validation.timer.highlight.dispatching
// @version      1.0.0
// @description  SLA countdown timer, milestone breach highlighting and FIRST/SECOND/NIGHT shift indicators for Salesforce Classic Level 1 Validation queues and dispatching assistance
// @author       Esko Software Support
//
// @downloadURL  https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.ValidationQueueAndDispatching.user.js
// @updateURL    https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.ValidationQueueAndDispatching.user.js
//
// @match        https://esko.my.salesforce.com/*
// @match        https://esko--accept.cs83.my.salesforce.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // NOTE: this script intentionally runs in every matching frame
    // (top window AND iframes), because Salesforce Console renders
    // list-view/report grids inside their own iframe here - the row
    // processing (processRows/processPriorityView/getViewName) has
    // to run inside that frame's own document to see the grid at
    // all. Only the dashboard-tab countdown/refresh logic (which
    // reaches into other frames from a single instance) is
    // restricted to the top frame below, to avoid duplicates.

    var VIEW_PREFIX = "CS: Level 1 Validation";

    var DATE_HEADER_TITLE = "Date/Time Opened";

    var BREACH_HEADER_TITLES = [
        "Approaching Milestone breach",
        "Approching Milestone breach"
    ];

    var ACTION_REQUIRED_HEADER = "Action Required";
    var BUSINESS_HOURS_HEADER = "Business Hours Name";

    var THRESHOLD_MINUTES = 30;
    var REFRESH_INTERVAL_MS = 1000;

    // ------------------------------------------------------------------
    // "CS: Level1" priority sequencing
    // ------------------------------------------------------------------

    var PRIORITY_VIEW_PREFIX = "CS: Level1";

    // Set to true temporarily if the priority sequencing ever needs
    // troubleshooting again - this prints the per-view diagnostic
    // reasons and a full per-row ranking snapshot to the console
    // (tagged "[L1 Priority]"). Leave false for normal use.
    var L1_PRIORITY_DEBUG = false;

    var CONTRACT_STATUS_HEADER = "Contract Status";
    var PROBLEM_URGENCY_HEADER = "Problem Urgency";
    var CASE_NUMBER_HEADER = "Case Number";

    var DATE_OPENED_HEADER_TITLES = [
        "Date/Time Opened",
        "Date Opened"
    ];

    var CA_STATUS_VALUE = "CA";

    // Known fallback column key for Problem Urgency, taken directly
    // from a real cell's class (x-grid3-col-00ND0000006Dar9), used
    // only if the header-title lookup below doesn't find it.
    var PROBLEM_URGENCY_COLUMN_KEY_FALLBACK =
        "00ND0000006Dar9";

    // Known fallback column key for Case Number, taken directly
    // from a real cell's class (x-grid3-col-CASES_CASE_NUMBER).
    var CASE_NUMBER_COLUMN_KEY_FALLBACK =
        "CASES_CASE_NUMBER";

    // Known fallback column key for Action Required (in the
    // "CS: Level1..." view specifically), taken directly from a
    // real cell's class (x-grid3-col-00ND0000006DaqB). This is the
    // column the priority badge is placed in.
    var ACTION_REQUIRED_COLUMN_KEY_FALLBACK =
        "00ND0000006DaqB";

    // Contract Status values with a dedicated row in the table.
    // Anything else falls into the "*all other" bucket.
    var KNOWN_CONTRACT_STATUSES = [
        "IAASHIGH",
        "SWPREM24_7",
        "IAASMEDIUM",
        "SWPREM24_5"
    ];

    var PRIORITY_TABLE = {
        IAASHIGH: {
            DOWN: 1,
            CRITICAL: 2,
            NORMAL: 9,
            LOW: 10
        },
        SWPREM24_7: {
            DOWN: 3,
            CRITICAL: 4,
            NORMAL: 11,
            LOW: 12
        },
        IAASMEDIUM: {
            DOWN: 5,
            CRITICAL: 6,
            NORMAL: 13,
            LOW: 14
        },
        SWPREM24_5: {
            DOWN: 7,
            CRITICAL: 8,
            NORMAL: 15,
            LOW: 16
        },
        OTHER: {
            DOWN: 17,
            CRITICAL: 18,
            NORMAL: 19,
            LOW: 20
        }
    };

    var PRIORITY_BADGE_CLASS = "l1-priority-seq-badge";
    var CA_STOP_EMOJI = "\uD83D\uDED1";

    var DASHBOARD_BTN_ID = "l1-dispatch-dropdown-widget";
    var DASHBOARD_LABEL = "Level - 1 Dispatching Dashboard";

    var DASHBOARD_OPTIONS = [
        {
            label: "Ojas",
            url: "https://esko.my.salesforce.com/console#%2F01ZTe000000DW8X"
        },
        {
            label: "Tejas",
            url: "https://esko.my.salesforce.com/console#%2F01ZTe000000DVSb"
        },
        {
            label: "Chetas",
            url: "https://esko.my.salesforce.com/console#%2F01ZTe000000DWDN"
        }
    ];

    var DASHBOARD_MIN_REFRESH_MINUTES = 2;
    var dashboardRefreshIntervalMinutes = DASHBOARD_MIN_REFRESH_MINUTES;
    var dashboardRefreshIntervalMs =
        dashboardRefreshIntervalMinutes * 60 * 1000;
    var nextDashboardRefreshAt =
        Date.now() + dashboardRefreshIntervalMs;

    var DASHBOARD_COUNTDOWN_ID =
        "l1-dispatch-countdown";

    function extractRecordId(url) {

        var decoded =
            decodeURIComponent(url || "");

        var match =
            decoded.match(
                /\/([A-Za-z0-9]{15,18})$/
            );

        return match ? match[1] : null;
    }

    (function attachRecordIds() {

        for (
            var i = 0;
            i < DASHBOARD_OPTIONS.length;
            i++
        ) {
            DASHBOARD_OPTIONS[i].recordId =
                extractRecordId(
                    DASHBOARD_OPTIONS[i].url
                );
        }

    })();

    function cleanText(value) {
        return (value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function getViewName() {
        var select = document.querySelector("select");

        if (!select || select.selectedIndex < 0) {
            return "";
        }

        return cleanText(
            select.options[select.selectedIndex].textContent
        );
    }

    function isTargetView() {
        return getViewName().indexOf(VIEW_PREFIX) === 0;
    }

    function getColumnKeyByHeaderTitle(headerTitle) {

        var headers =
            document.querySelectorAll(
                "div.x-grid3-hd-inner"
            );

        for (var i = 0; i < headers.length; i++) {

            var header = headers[i];

            var title =
                cleanText(
                    header.getAttribute("title")
                );

            var text =
                cleanText(
                    header.textContent
                );

            if (
                title.toUpperCase() ===
                    headerTitle.toUpperCase() ||
                text
                    .toUpperCase()
                    .indexOf(
                        headerTitle.toUpperCase()
                    ) !== -1
            ) {

                var classes =
                    header.className.split(/\s+/);

                for (var j = 0; j < classes.length; j++) {

                    var cls = classes[j];

                    if (
                        cls.indexOf("x-grid3-hd-") === 0 &&
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

    function getDateColumnKey() {
        return getColumnKeyByHeaderTitle(
            DATE_HEADER_TITLE
        );
    }

    function getBreachColumnKey() {

        for (
            var i = 0;
            i < BREACH_HEADER_TITLES.length;
            i++
        ) {

            var key =
                getColumnKeyByHeaderTitle(
                    BREACH_HEADER_TITLES[i]
                );

            if (key) {
                return key;
            }
        }

        return null;
    }

    function parseSalesforceDateTime(rawValue) {

        var text = cleanText(rawValue);

        if (!text) {
            return null;
        }

        var match = text.match(
            /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
        );

        if (!match) {

            var fallback =
                new Date(text);

            return isNaN(fallback.getTime())
                ? null
                : fallback;
        }

        var month = parseInt(match[1], 10);
        var day = parseInt(match[2], 10);
        var year = parseInt(match[3], 10);
        var hour = parseInt(match[4], 10);
        var minute = parseInt(match[5], 10);
        var ampm = match[6].toUpperCase();

        if (year < 100) {
            year += 2000;
        }

        if (ampm === "PM" && hour < 12) {
            hour += 12;
        }

        if (ampm === "AM" && hour === 12) {
            hour = 0;
        }

        return new Date(
            year,
            month - 1,
            day,
            hour,
            minute,
            0
        );
    }

    function formatRemainingTime(ms) {

        var totalSeconds =
            Math.floor(ms / 1000);

        if (totalSeconds <= 0) {
            return "00:00";
        }

        var minutes =
            Math.floor(totalSeconds / 60);

        var seconds =
            totalSeconds % 60;

        return (
            (minutes < 10 ? "0" : "") +
            minutes +
            ":" +
            (seconds < 10 ? "0" : "") +
            seconds
        );
    }

    function getSlaColour(remainingMs) {

        var totalSeconds =
            Math.floor(remainingMs / 1000);

        if (totalSeconds <= 0) {
            return { bg: "#dc3545", fg: "#ffffff" };
        }

        if (totalSeconds >= 25 * 60) {
            return { bg: "#006400", fg: "#ffffff" };
        }

        if (totalSeconds >= 20 * 60) {
            return { bg: "#90EE90", fg: "#000000" };
        }

        if (totalSeconds >= 10 * 60) {
            return { bg: "#ffc107", fg: "#000000" };
        }

        return { bg: "#f8d7da", fg: "#000000" };
    }

    function getShiftValue(businessHoursName) {

        var now = new Date();

        var currentMinutes =
            (now.getHours() * 60) +
            now.getMinutes();

        if (currentMinutes >= 210 &&
            currentMinutes <= 719) {
            return "FIRST";
        }

        if (currentMinutes >= 720 &&
            currentMinutes <= 1109) {
            return "SECOND";
        }

        if (currentMinutes >= 1110 &&
            currentMinutes <= 1259) {

            if (
                cleanText(
                    businessHoursName
                ).toUpperCase() === "EMEA"
            ) {
                return "SECOND";
            }

            return "NIGHT";
        }

        return "NIGHT";
    }

    function findCell(row, key) {

        return (
            row.querySelector(
                ".x-grid3-col-" + key
            ) ||
            row.querySelector(
                ".x-grid3-td-" +
                key +
                " .x-grid3-cell-inner"
            ) ||
            row.querySelector(
                ".x-grid3-td-" + key
            )
        );
    }

    function styleDateCell(
        dateCell,
        remainingMs,
        ageMinutes
    ) {

        var c =
            getSlaColour(remainingMs);

        dateCell.style.backgroundColor =
            c.bg;

        dateCell.style.color =
            c.fg;

        dateCell.style.fontWeight =
            "bold";

        if (remainingMs <= 0) {

            dateCell.title =
                "Opened " +
                Math.floor(ageMinutes) +
                " mins ago (breached)";
        }
    }

    function upsertTimer(
        cell,
        remainingMs
    ) {

        var timer =
            cell.querySelector(
                ".l1-countdown"
            );

        if (!timer) {

            timer =
                document.createElement(
                    "span"
                );

            timer.className =
                "l1-countdown";

            timer.style.marginLeft =
                "6px";

            timer.style.padding =
                "1px 5px";

            timer.style.borderRadius =
                "3px";

            timer.style.fontSize =
                "11px";

            timer.style.fontWeight =
                "bold";

            cell.appendChild(timer);
        }

        var c =
            getSlaColour(remainingMs);

        timer.textContent =
            formatRemainingTime(
                remainingMs
            );

        timer.style.backgroundColor =
            c.bg;

        timer.style.color =
            c.fg;
    }

    function processRows() {

        if (!isTargetView()) {
            return;
        }

        var dateKey =
            getDateColumnKey();

        var breachKey =
            getBreachColumnKey();

        var actionKey =
            getColumnKeyByHeaderTitle(
                ACTION_REQUIRED_HEADER
            );

        var businessHoursKey =
            getColumnKeyByHeaderTitle(
                BUSINESS_HOURS_HEADER
            );

        if (
            !dateKey ||
            !breachKey ||
            !actionKey ||
            !businessHoursKey
        ) {
            return;
        }

        var header =
            document.querySelector(
                ".x-grid3-hd-" +
                actionKey
            );

        if (header) {
            header.style.width =
                "130px";
        }

        var rows =
            document.querySelectorAll(
                ".x-grid3-row"
            );

        var now =
            new Date();

        for (
            var i = 0;
            i < rows.length;
            i++
        ) {

            var row = rows[i];

            var dateCell =
                findCell(row, dateKey);

            var breachCell =
                findCell(row, breachKey);

            var actionCell =
                findCell(row, actionKey);

            var businessHoursCell =
                findCell(
                    row,
                    businessHoursKey
                );

            if (
                !dateCell ||
                !breachCell ||
                !actionCell ||
                !businessHoursCell
            ) {
                continue;
            }

            var opened =
                parseSalesforceDateTime(
                    dateCell.textContent
                );

            if (!opened) {
                continue;
            }

            var breachTime =
                new Date(
                    opened.getTime() +
                    THRESHOLD_MINUTES *
                    60000
                );

            var remaining =
                breachTime - now;

            var age =
                (now - opened) /
                60000;

            styleDateCell(
                dateCell,
                remaining,
                age
            );

            upsertTimer(
                breachCell,
                remaining
            );

            var shift =
                getShiftValue(
                    businessHoursCell.textContent
                );

            var badge =
                actionCell.querySelector(
                    ".shift-badge"
                );

            if (!badge) {

                badge =
                    document.createElement(
                        "span"
                    );

                badge.className =
                    "shift-badge";

                badge.style.marginLeft =
                    "2px";

                badge.style.padding =
                    "1px 4px";

                badge.style.borderRadius =
                    "3px";

                badge.style.fontSize =
                    "10px";

                badge.style.fontWeight =
                    "bold";

                badge.style.display =
                    "inline-block";

                actionCell.appendChild(
                    badge
                );
            }

            badge.textContent =
                shift;

if (shift === "FIRST") {

    badge.style.backgroundColor = "#FFC107";
    badge.style.color = "#000000";

}
else if (shift === "SECOND") {

    badge.style.backgroundColor = "#FF7A59";
    badge.style.color = "#000000";

}
else if (shift === "NIGHT") {

    badge.style.backgroundColor = "#000000";
    badge.style.color = "#FFFFFF";

}


            actionCell.style.whiteSpace =
                "nowrap";
        }
    }

    // ------------------------------------------------------------------
    // "CS: Level1" priority sequencing
    // ------------------------------------------------------------------

    function resolveContractStatusBucket(rawStatus) {

        var status =
            cleanText(rawStatus).toUpperCase();

        if (status === CA_STATUS_VALUE) {
            return "CA";
        }

        for (
            var i = 0;
            i < KNOWN_CONTRACT_STATUSES.length;
            i++
        ) {

            if (
                status ===
                KNOWN_CONTRACT_STATUSES[i]
            ) {
                return KNOWN_CONTRACT_STATUSES[i];
            }
        }

        return "OTHER";
    }

    function resolveUrgencyBucket(rawUrgency) {

        var urgency =
            cleanText(rawUrgency).toUpperCase();

        if (
            urgency === "DOWN" ||
            urgency === "CRITICAL" ||
            urgency === "NORMAL" ||
            urgency === "LOW"
        ) {
            return urgency;
        }

        // Unrecognised urgency value - fall back to the
        // lowest-priority bucket rather than skipping the row.
        return "LOW";
    }

    function getBasePriority(
        statusBucket,
        urgencyBucket
    ) {

        var row =
            PRIORITY_TABLE[statusBucket] ||
            PRIORITY_TABLE.OTHER;

        return (
            row[urgencyBucket] !== undefined
                ? row[urgencyBucket]
                : row.LOW
        );
    }

    function getCellOwnText(cell) {

        var badge =
            cell.querySelector(
                "." + PRIORITY_BADGE_CLASS
            );

        // No badge in this cell (yet) - textContent is already
        // clean, no need to clone anything.
        if (!badge) {
            return cell.textContent;
        }

        // The cell may already contain our own priority badge
        // (e.g. this cell was labelled on a previous tick).
        // cell.textContent would include the badge's own digits,
        // corrupting the value on every read after the first one.
        // Work off a clone with the badge stripped out instead.
        var clone = cell.cloneNode(true);

        var clonedBadges =
            clone.querySelectorAll(
                "." + PRIORITY_BADGE_CLASS
            );

        for (
            var i = 0;
            i < clonedBadges.length;
            i++
        ) {

            clonedBadges[i].parentNode.removeChild(
                clonedBadges[i]
            );
        }

        return clone.textContent;
    }

    function applyPriorityBadge(
        cell,
        text,
        bgColor,
        fgColor
    ) {

        if (!cell) {
            return;
        }

        var badge =
            cell.querySelector(
                "." + PRIORITY_BADGE_CLASS
            );

        if (!badge) {

            badge =
                document.createElement("span");

            badge.className =
                PRIORITY_BADGE_CLASS;

            badge.style.marginRight = "6px";
            badge.style.padding = "1px 6px";
            badge.style.borderRadius = "10px";
            badge.style.fontSize = "11px";
            badge.style.fontWeight = "bold";
            badge.style.display =
                "inline-block";

            cell.insertBefore(
                badge,
                cell.firstChild
            );
        }

        if (badge.textContent !== text) {
            badge.textContent = text;
        }

        var resolvedBg = bgColor || "#dbe4ee";
        var resolvedFg = fgColor || "#1a1a1a";

        // Rank (and therefore color) can change from tick to tick
        // as cases are opened/closed, so re-apply colors every time
        // rather than only at creation - but skip the write if
        // nothing actually changed, to avoid unnecessary reflow.
        if (badge.style.backgroundColor !== resolvedBg) {
            badge.style.backgroundColor = resolvedBg;
        }

        if (badge.style.color !== resolvedFg) {
            badge.style.color = resolvedFg;
        }
    }

    function getPriorityBadgeColors(rank, total) {

        // Rank 1 gets the brightest/most saturated red; the last
        // rank gets the lightest red. Interpolate lightness across
        // the group so the gradient always spans the full range
        // regardless of how many cases are in the list.
        if (total <= 1) {

            return {
                bg: "hsl(0, 82%, 45%)",
                fg: "#ffffff"
            };
        }

        var t =
            (rank - 1) / (total - 1);

        var lightness =
            45 + (t * 40);

        return {
            bg: "hsl(0, 82%, " + lightness + "%)",
            fg: lightness > 68 ? "#7a1a1a" : "#ffffff"
        };
    }

    var priorityViewLastDiagnostic = null;
    var priorityViewLastSnapshot = null;

    var priorityColumnCache = {
        viewName: null,
        statusKey: null,
        urgencyKey: null,
        dateKey: null,
        caseNumberKey: null,
        actionRequiredKey: null
    };

    function logPriorityDiagnostic(reason) {

        if (!L1_PRIORITY_DEBUG) {
            return;
        }

        if (priorityViewLastDiagnostic === reason) {
            return;
        }

        priorityViewLastDiagnostic = reason;

        console.warn(
            "[L1 Priority] " + reason
        );
    }

    function resolveVerifiedColumnKey(
        sampleRow,
        headerTitles,
        fallbackKey
    ) {

        var firstHeaderMatch = null;

        for (
            var i = 0;
            i < headerTitles.length;
            i++
        ) {

            var key =
                getColumnKeyByHeaderTitle(
                    headerTitles[i]
                );

            if (!key) {
                continue;
            }

            if (firstHeaderMatch === null) {
                firstHeaderMatch = key;
            }

            // Only accept this key if it actually resolves to a
            // real cell in a real row - a header can exist without
            // a matching per-row cell (e.g. a hidden/non-rendered
            // column), which previously caused the cached key to
            // get permanently stuck on a column with no cells.
            if (findCell(sampleRow, key)) {
                return key;
            }
        }

        if (
            fallbackKey &&
            findCell(sampleRow, fallbackKey)
        ) {
            return fallbackKey;
        }

        // Nothing verified against a real cell - fall back to
        // whatever matched by header text (if anything), or the
        // raw fallback key, so callers still get a sensible key to
        // report in diagnostics rather than null.
        return firstHeaderMatch || fallbackKey || null;
    }

    function processPriorityView() {

        var viewName = getViewName();

        if (viewName.indexOf(PRIORITY_VIEW_PREFIX) !== 0) {

            logPriorityDiagnostic(
                "Current view name is '" +
                viewName +
                "' - does not start with '" +
                PRIORITY_VIEW_PREFIX +
                "'."
            );

            return;
        }

        var rows =
            document.querySelectorAll(
                ".x-grid3-row"
            );

        if (rows.length === 0) {
            logPriorityDiagnostic(
                "No grid rows (.x-grid3-row) are " +
                "present yet."
            );
            return;
        }

        var sampleRow = rows[0];

        // Re-resolve the column keys only when the view has
        // changed (or we don't have them cached yet). Re-deriving
        // them from the header text on every single tick was
        // letting a transient/partial header re-render pick a
        // different matching column from one tick to the next.
        // Each candidate is now verified against a real cell in
        // sampleRow before being cached, so a header that exists
        // without a matching per-row cell can no longer get stuck
        // as the cached key.
        if (priorityColumnCache.viewName !== viewName) {

            priorityColumnCache.viewName = viewName;

            priorityColumnCache.statusKey =
                resolveVerifiedColumnKey(
                    sampleRow,
                    [CONTRACT_STATUS_HEADER],
                    null
                );

            priorityColumnCache.urgencyKey =
                resolveVerifiedColumnKey(
                    sampleRow,
                    [PROBLEM_URGENCY_HEADER],
                    PROBLEM_URGENCY_COLUMN_KEY_FALLBACK
                );

            priorityColumnCache.dateKey =
                resolveVerifiedColumnKey(
                    sampleRow,
                    DATE_OPENED_HEADER_TITLES,
                    null
                );

            priorityColumnCache.caseNumberKey =
                resolveVerifiedColumnKey(
                    sampleRow,
                    [CASE_NUMBER_HEADER],
                    CASE_NUMBER_COLUMN_KEY_FALLBACK
                );

            priorityColumnCache.actionRequiredKey =
                resolveVerifiedColumnKey(
                    sampleRow,
                    [ACTION_REQUIRED_HEADER],
                    ACTION_REQUIRED_COLUMN_KEY_FALLBACK
                );
        }

        var statusKey =
            priorityColumnCache.statusKey;

        var urgencyKey =
            priorityColumnCache.urgencyKey;

        var dateKey =
            priorityColumnCache.dateKey;

        var caseNumberKey =
            priorityColumnCache.caseNumberKey;

        var actionRequiredKey =
            priorityColumnCache.actionRequiredKey;

        if (!statusKey) {
            logPriorityDiagnostic(
                "Could not find the 'Contract Status' " +
                "column header - check the exact header " +
                "text/title in this view."
            );
            return;
        }

        if (!urgencyKey) {
            logPriorityDiagnostic(
                "Could not find the 'Problem Urgency' " +
                "column header, and the fallback column " +
                "key didn't match either."
            );
            return;
        }

        if (!dateKey) {
            logPriorityDiagnostic(
                "Could not find a Date Opened column " +
                "header - check the exact header " +
                "text/title in this view."
            );
            return;
        }

        var entries = [];

        for (var i = 0; i < rows.length; i++) {

            var row = rows[i];

            var statusCell =
                findCell(row, statusKey);

            var urgencyCell =
                findCell(row, urgencyKey);

            var dateCell =
                findCell(row, dateKey);

            var caseNumberCell =
                caseNumberKey
                    ? findCell(row, caseNumberKey)
                    : null;

            var actionRequiredCell =
                actionRequiredKey
                    ? findCell(row, actionRequiredKey)
                    : null;

            // Prefer the Case Number cell for the badge (per
            // request); fall back to Action Required, then to the
            // urgency cell as a last resort. None of these are used
            // for any bucket/priority logic, so our badge can never
            // contaminate a later read of them.
            var badgeCell =
                caseNumberCell ||
                actionRequiredCell ||
                urgencyCell;

            if (
                !statusCell ||
                !urgencyCell ||
                !dateCell
            ) {
                continue;
            }

            var rawStatus =
                cleanText(
                    getCellOwnText(statusCell)
                );

            var rawUrgency =
                cleanText(
                    getCellOwnText(urgencyCell)
                );

            var rawDate =
                cleanText(
                    getCellOwnText(dateCell)
                );

            var statusBucket =
                resolveContractStatusBucket(
                    rawStatus
                );

            if (statusBucket === "CA") {

                entries.push({
                    isCA: true,
                    badgeCell: badgeCell,
                    rawStatus: rawStatus,
                    rawUrgency: rawUrgency,
                    rawDate: rawDate
                });

                continue;
            }

            var urgencyBucket =
                resolveUrgencyBucket(
                    rawUrgency
                );

            var opened =
                parseSalesforceDateTime(
                    rawDate
                );

            entries.push({
                isCA: false,
                badgeCell: badgeCell,
                rawStatus: rawStatus,
                rawUrgency: rawUrgency,
                rawDate: rawDate,
                statusBucket: statusBucket,
                urgencyBucket: urgencyBucket,
                basePriority:
                    getBasePriority(
                        statusBucket,
                        urgencyBucket
                    ),
                openedTime:
                    opened
                        ? opened.getTime()
                        : Number.MAX_SAFE_INTEGER
            });
        }

        if (entries.length === 0) {
            logPriorityDiagnostic(
                "Columns were found (status=" +
                statusKey +
                ", urgency=" +
                urgencyKey +
                ", date=" +
                dateKey +
                ") but no row cells matched " +
                "those keys - the per-row cell class " +
                "names may differ from the header " +
                "class names."
            );
            return;
        }

        var rankable = [];

        for (var k = 0; k < entries.length; k++) {

            if (!entries[k].isCA) {
                rankable.push(entries[k]);
            }
        }

        // Sort by the table priority first; when two or more cases
        // land on the same priority, the one opened earliest wins
        // the lower (earlier) sequence number.
        rankable.sort(function (a, b) {

            if (a.basePriority !== b.basePriority) {
                return a.basePriority - b.basePriority;
            }

            return a.openedTime - b.openedTime;
        });

        var diagnosticRows = [];

        for (var d = 0; d < rankable.length; d++) {

            diagnosticRows.push({
                rank: d + 1,
                status_raw: rankable[d].rawStatus,
                status_bucket: rankable[d].statusBucket,
                urgency_raw: rankable[d].rawUrgency,
                urgency_bucket: rankable[d].urgencyBucket,
                basePriority: rankable[d].basePriority,
                date_raw: rankable[d].rawDate
            });
        }

        for (var e = 0; e < entries.length; e++) {

            if (entries[e].isCA) {

                diagnosticRows.push({
                    rank: "\uD83D\uDED1 (CA)",
                    status_raw: entries[e].rawStatus,
                    status_bucket: "CA",
                    urgency_raw: entries[e].rawUrgency,
                    urgency_bucket: "-",
                    basePriority: "-",
                    date_raw: entries[e].rawDate
                });
            }
        }

        var diagnosticSignature =
            JSON.stringify(diagnosticRows);

        var shouldLogSnapshot =
            L1_PRIORITY_DEBUG &&
            diagnosticSignature !==
            priorityViewLastSnapshot;

        if (shouldLogSnapshot) {
            priorityViewLastSnapshot =
                diagnosticSignature;
        }

        for (var m = 0; m < rankable.length; m++) {

            var badgeColors =
                getPriorityBadgeColors(
                    m + 1,
                    rankable.length
                );

            applyPriorityBadge(
                rankable[m].badgeCell,
                String(m + 1),
                badgeColors.bg,
                badgeColors.fg
            );
        }

        for (var n = 0; n < entries.length; n++) {

            if (entries[n].isCA) {

                applyPriorityBadge(
                    entries[n].badgeCell,
                    CA_STOP_EMOJI
                );
            }
        }

        if (shouldLogSnapshot) {

            var diagnosticLines = [
                "[L1 Priority] Ranking snapshot " +
                "(statusKey=" + statusKey +
                ", urgencyKey=" + urgencyKey +
                ", dateKey=" + dateKey +
                ", caseNumberKey=" + caseNumberKey +
                ", actionRequiredKey=" + actionRequiredKey +
                "):"
            ];

            for (
                var p = 0;
                p < diagnosticRows.length;
                p++
            ) {

                var r = diagnosticRows[p];

                diagnosticLines.push(
                    "  rank=" + r.rank +
                    " | status_raw='" + r.status_raw +
                    "' status_bucket=" + r.status_bucket +
                    " | urgency_raw='" + r.urgency_raw +
                    "' urgency_bucket=" + r.urgency_bucket +
                    " | basePriority=" + r.basePriority +
                    " | date_raw='" + r.date_raw + "'"
                );
            }

            var badgeCountInThisDoc =
                document.querySelectorAll(
                    "." + PRIORITY_BADGE_CLASS
                ).length;

            diagnosticLines.push(
                "  --> badges now present in THIS " +
                "document (the one this script " +
                "instance is running in): " +
                badgeCountInThisDoc +
                " (window.location=" +
                window.location.href + ")"
            );

            console.log(
                diagnosticLines.join("\n")
            );
        }
    }

    // ------------------------------------------------------------------
    // Level - 1 Dispatching Dashboard dropdown
    // ------------------------------------------------------------------

    function findCsLeadFormButton() {

        var positioners =
            document.querySelectorAll(
                ".sd_widget_btn_text_positioner"
            );

        for (var i = 0; i < positioners.length; i++) {

            if (
                cleanText(
                    positioners[i].textContent
                ) === "CS Lead Form"
            ) {
                return positioners[i].closest(
                    "button"
                );
            }
        }

        return null;
    }

    function createMenuItem(label, onClick) {

        var item =
            document.createElement("div");

        item.textContent = label;
        item.style.padding = "6px 10px";
        item.style.fontSize = "12px";
        item.style.cursor = "pointer";
        item.style.whiteSpace = "nowrap";
        item.style.color = "#1a1a1a";
        item.style.backgroundColor = "#ffffff";

        item.addEventListener(
            "mouseenter",
            function () {
                item.style.backgroundColor =
                    "#0070d2";
                item.style.color = "#ffffff";
            }
        );

        item.addEventListener(
            "mouseleave",
            function () {
                item.style.backgroundColor =
                    "#ffffff";
                item.style.color = "#1a1a1a";
            }
        );

        item.addEventListener(
            "click",
            function (e) {
                e.stopPropagation();
                onClick();
            }
        );

        return item;
    }

    function findOpenDashboardOption() {

        var frames =
            collectFrames(window, []);

        for (var i = 0; i < frames.length; i++) {

            var frameHref = "";

            try {
                frameHref =
                    frames[i].location.href;
            } catch (e) {
                continue;
            }

            for (
                var j = 0;
                j < DASHBOARD_OPTIONS.length;
                j++
            ) {

                var recordId =
                    DASHBOARD_OPTIONS[j]
                        .recordId;

                if (
                    recordId &&
                    frameHref.indexOf(
                        recordId
                    ) !== -1
                ) {
                    return DASHBOARD_OPTIONS[j];
                }
            }
        }

        return null;
    }

    function renderDashboardMenu(menu) {

        menu.innerHTML = "";

        var openOption =
            findOpenDashboardOption();

        if (openOption) {

            var message =
                document.createElement("div");

            message.textContent =
                "A dashboard (" +
                openOption.label +
                ") is already open. Close it to open another.";

            message.style.padding = "8px 10px";
            message.style.fontSize = "12px";
            message.style.color = "#5c6773";
            message.style.whiteSpace =
                "normal";
            message.style.lineHeight = "1.4";

            menu.appendChild(message);

        } else {

            DASHBOARD_OPTIONS.forEach(function (option) {

                menu.appendChild(
                    createMenuItem(
                        option.label,
                        function () {
                            menu.style.display =
                                "none";
                            openDispatchUrl(
                                option.url
                            );
                        }
                    )
                );
            });
        }

        var separator =
            document.createElement("div");

        separator.style.borderTop =
            "1px solid #d8dde3";

        menu.appendChild(separator);

        menu.appendChild(
            createMenuItem(
                "Set Refresh interval",
                function () {
                    menu.style.display = "none";
                    promptForRefreshInterval();
                }
            )
        );
    }

    function ensureDashboardDropdown() {

        if (
            document.getElementById(
                DASHBOARD_BTN_ID
            )
        ) {
            return;
        }

        var csLeadBtn =
            findCsLeadFormButton();

        if (!csLeadBtn || !csLeadBtn.parentNode) {
            return;
        }

        var wrapper =
            document.createElement("span");

        wrapper.id = DASHBOARD_BTN_ID;
        wrapper.style.position = "relative";
        wrapper.style.display = "inline-block";
        wrapper.style.marginRight = "6px";

        var toggleBtn =
            document.createElement("button");

        toggleBtn.type = "button";
        toggleBtn.textContent =
            DASHBOARD_LABEL + " \u25BE";

        toggleBtn.style.padding = "3px 8px";
        toggleBtn.style.fontSize = "12px";
        toggleBtn.style.cursor = "pointer";
        toggleBtn.style.border =
            "1px solid #a4b1bd";
        toggleBtn.style.borderRadius = "3px";
        toggleBtn.style.backgroundColor =
            "#f0f2f5";

        var menu =
            document.createElement("div");

        menu.style.display = "none";
        menu.style.position = "absolute";
        menu.style.bottom = "100%";
        menu.style.left = "0";
        menu.style.backgroundColor = "#ffffff";
        menu.style.border =
            "1px solid #a4b1bd";
        menu.style.borderRadius = "3px";
        menu.style.boxShadow =
            "0 2px 6px rgba(0,0,0,0.2)";
        menu.style.zIndex = "99999";
        menu.style.minWidth = "150px";
        menu.style.maxWidth = "230px";

        renderDashboardMenu(menu);

        toggleBtn.addEventListener(
            "click",
            function (e) {
                e.stopPropagation();

                var opening =
                    menu.style.display === "none";

                if (opening) {
                    renderDashboardMenu(menu);
                }

                menu.style.display =
                    opening ? "block" : "none";
            }
        );

        document.addEventListener(
            "click",
            function () {
                menu.style.display = "none";
            }
        );

        wrapper.appendChild(menu);
        wrapper.appendChild(toggleBtn);

        csLeadBtn.parentNode.insertBefore(
            wrapper,
            csLeadBtn
        );
    }

    function waitFor(
        conditionFn,
        callback,
        timeoutMs
    ) {

        var waited = 0;
        var interval = 100;

        var timer = setInterval(function () {

            var result = conditionFn();

            if (result) {
                clearInterval(timer);
                callback(result);
                return;
            }

            waited += interval;

            if (waited >= (timeoutMs || 8000)) {
                clearInterval(timer);
            }

        }, interval);
    }

    function findNewTabButton() {

        var candidates =
            document.querySelectorAll(
                "a.x-tab-right"
            );

        var found = null;

        for (var i = 0; i < candidates.length; i++) {

            var a = candidates[i];

            var textSpan =
                a.querySelector(
                    ".x-tab-strip-text"
                );

            var text =
                textSpan
                    ? cleanText(
                          textSpan.textContent
                      )
                    : "";

            if (text === "") {
                found = a;
            }
        }

        return found;
    }

    function findUrlInput() {

        var inputs =
            document.querySelectorAll(
                'input[type="text"].x-form-text'
            );

        var candidate = null;

        for (var i = 0; i < inputs.length; i++) {

            var input = inputs[i];

            if (input.offsetParent === null) {
                continue;
            }

            candidate = input;
        }

        return candidate;
    }

    function findGoButton() {

        var buttons =
            document.querySelectorAll(
                "button.x-btn-text"
            );

        var candidate = null;

        for (var i = 0; i < buttons.length; i++) {

            var button = buttons[i];

            if (
                cleanText(
                    button.textContent
                ) === "Go!" &&
                button.offsetParent !== null
            ) {
                candidate = button;
            }
        }

        return candidate;
    }

    function setInputValue(input, value) {

        var nativeSetter =
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
            ).set;

        nativeSetter.call(input, value);

        input.dispatchEvent(
            new Event("input", { bubbles: true })
        );

        input.dispatchEvent(
            new Event("keyup", { bubbles: true })
        );

        input.dispatchEvent(
            new Event("change", { bubbles: true })
        );
    }

    function openDispatchUrl(url) {

        var plusTab =
            findNewTabButton();

        if (!plusTab) {

            console.warn(
                "[L1 Dispatch] Could not find the '+' new tab button."
            );

            return;
        }

        plusTab.click();

        waitFor(
            findUrlInput,
            function (input) {

                input.focus();

                setInputValue(input, url);

                waitFor(
                    findGoButton,
                    function (goBtn) {
                        goBtn.click();
                    },
                    4000
                );
            },
            8000
        );
    }

    function promptForRefreshInterval() {

        var input =
            window.prompt(
                "Enter dashboard refresh interval in minutes (minimum " +
                DASHBOARD_MIN_REFRESH_MINUTES +
                "):",
                String(dashboardRefreshIntervalMinutes)
            );

        if (input === null) {
            return;
        }

        var minutes =
            parseFloat(input);

        if (
            isNaN(minutes) ||
            minutes < DASHBOARD_MIN_REFRESH_MINUTES
        ) {

            window.alert(
                "Refresh interval must be at least " +
                DASHBOARD_MIN_REFRESH_MINUTES +
                " minutes."
            );

            return;
        }

        dashboardRefreshIntervalMinutes = minutes;

        dashboardRefreshIntervalMs =
            minutes * 60 * 1000;

        nextDashboardRefreshAt =
            Date.now() + dashboardRefreshIntervalMs;
    }

    // ------------------------------------------------------------------
    // Auto-refresh for open dispatching dashboards
    // ------------------------------------------------------------------

    function collectFrames(win, frames) {

        frames.push(win);

        var childFrames;

        try {
            childFrames = win.frames;
        } catch (e) {
            return frames;
        }

        for (var i = 0; i < childFrames.length; i++) {

            try {
                collectFrames(
                    childFrames[i],
                    frames
                );
            } catch (e) {
                // Cross-origin frame, skip it.
            }
        }

        return frames;
    }

    function clickElement(el) {

        try {
            el.click();
            return;
        } catch (e) {
            // fall through to manual dispatch
        }

        try {

            var doc =
                el.ownerDocument ||
                document;

            var evt =
                doc.createEvent(
                    "MouseEvents"
                );

            evt.initEvent(
                "click",
                true,
                true
            );

            el.dispatchEvent(evt);

        } catch (e2) {
            // Give up silently, nothing more we can do.
        }
    }

    function findButtonBarContainer(frameDoc) {

        var byId =
            frameDoc.getElementById(
                "thePage:j_id48"
            );

        if (byId) {
            return byId;
        }

        return frameDoc.querySelector(
            ".buttonBarContainer"
        );
    }

    function ensureCountdownDisplay(frameDoc) {

        var existing =
            frameDoc.getElementById(
                DASHBOARD_COUNTDOWN_ID
            );

        // Element already exists and is still attached to the
        // document - reuse it. Re-querying/recreating this every
        // tick is what caused the visible flicker.
        if (existing && frameDoc.body &&
            frameDoc.body.contains(existing)) {
            return existing;
        }

        var container =
            findButtonBarContainer(frameDoc);

        if (!container || !container.parentNode) {
            return null;
        }

        var countdown =
            existing ||
            frameDoc.createElement("div");

        countdown.id = DASHBOARD_COUNTDOWN_ID;

        countdown.style.marginTop = "4px";
        countdown.style.padding = "3px 8px";
        countdown.style.fontSize = "12px";
        countdown.style.fontWeight = "bold";
        countdown.style.color = "#3b4859";
        countdown.style.backgroundColor =
            "#f0f2f5";
        countdown.style.border =
            "1px solid #a4b1bd";
        countdown.style.borderRadius = "3px";
        countdown.style.display =
            "inline-block";

        if (!countdown.textContent) {
            countdown.textContent =
                "Next refresh in --:--";
        }

        container.parentNode.insertBefore(
            countdown,
            container.nextSibling
        );

        return countdown;
    }

    function updateCountdownDisplay(
        frameDoc,
        remainingMs
    ) {

        var countdown =
            frameDoc.getElementById(
                DASHBOARD_COUNTDOWN_ID
            );

        if (!countdown) {
            return;
        }

        var newText =
            "Next refresh in " +
            formatRemainingTime(remainingMs);

        // Only touch the DOM if the text actually changed, to
        // avoid unnecessary reflow/repaint on every tick.
        if (countdown.textContent !== newText) {
            countdown.textContent = newText;
        }
    }

    function findRefreshButton(frameDoc) {

        var byId =
            frameDoc.getElementById(
                "refreshButton"
            );

        if (byId) {
            return byId;
        }

        var label =
            frameDoc.getElementById(
                "refreshLabel"
            );

        if (label && label.parentNode) {
            return label.parentNode;
        }

        return null;
    }

    function triggerDashboardRefresh(
        frameWin,
        frameDoc
    ) {

        // Prefer calling the dashboard's own refresh function
        // directly - the same function the "Refresh Now" link
        // and the Refresh button both invoke
        // (javascript:sfdc.dashboardView.doRefresh(false)).
        // Clicking the DOM button can fail to do anything when
        // its console tab isn't the active one, because the
        // button lives inside a hidden (display:none) tab panel
        // and Salesforce's own widget code can ignore
        // interactions on elements that aren't visible. Calling
        // the underlying function bypasses that entirely, since
        // it doesn't depend on visibility.
        try {

            if (
                frameWin.sfdc &&
                frameWin.sfdc.dashboardView &&
                typeof frameWin.sfdc.dashboardView.doRefresh ===
                    "function"
            ) {
                frameWin.sfdc.dashboardView.doRefresh(false);
                return true;
            }

        } catch (e) {
            // fall through to the DOM click fallback below
        }

        var refreshBtn =
            findRefreshButton(frameDoc);

        if (refreshBtn) {
            clickElement(refreshBtn);
            return true;
        }

        return false;
    }

    function processDashboardFrames() {

        var frames =
            collectFrames(window, []);

        var now = Date.now();

        var dueForRefresh =
            now >= nextDashboardRefreshAt;

        var remainingMs =
            nextDashboardRefreshAt - now;

        if (remainingMs < 0) {
            remainingMs = 0;
        }

        for (var i = 0; i < frames.length; i++) {

            var frameWin = frames[i];
            var frameHref = "";

            try {
                frameHref =
                    frameWin.location.href;
            } catch (e) {
                continue;
            }

            var matchedOption = null;

            for (
                var j = 0;
                j < DASHBOARD_OPTIONS.length;
                j++
            ) {

                var recordId =
                    DASHBOARD_OPTIONS[j]
                        .recordId;

                if (
                    recordId &&
                    frameHref.indexOf(
                        recordId
                    ) !== -1
                ) {
                    matchedOption =
                        DASHBOARD_OPTIONS[j];
                    break;
                }
            }

            if (!matchedOption) {
                continue;
            }

            var frameDoc;

            try {
                frameDoc = frameWin.document;
            } catch (e) {
                continue;
            }

            ensureCountdownDisplay(frameDoc);

            updateCountdownDisplay(
                frameDoc,
                remainingMs
            );

            if (dueForRefresh) {
                triggerDashboardRefresh(
                    frameWin,
                    frameDoc
                );
            }
        }

        if (dueForRefresh) {

            nextDashboardRefreshAt =
                now + dashboardRefreshIntervalMs;
        }
    }

    document.addEventListener(
        "visibilitychange",
        function () {

            if (window.top !== window.self) {
                return;
            }

            // Background browser tabs get their timers throttled
            // by the browser itself, which can make the countdown
            // fall behind and delay the refresh while this tab
            // isn't focused. Catch up immediately as soon as the
            // tab becomes visible again instead of waiting for the
            // next (possibly delayed) tick.
            if (!document.hidden) {
                processDashboardFrames();
            }
        }
    );

    setInterval(
        function () {

            processRows();
            processPriorityView();

            // Dashboard tab management (the dropdown widget and
            // the cross-frame countdown/refresh logic) only needs
            // to run once, from the top window - it already reaches
            // into the dashboard iframes itself. Running it again
            // from inside those iframes (or any other frame) would
            // recreate the duplicate-timer bug we fixed earlier.
            if (window.top === window.self) {
                ensureDashboardDropdown();
                processDashboardFrames();
            }
        },
        REFRESH_INTERVAL_MS
    );

})();
