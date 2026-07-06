// ==UserScript==
// @name         SFDC Classic - Level1 Validation Queue
// @namespace    com.esko.l1validation.timer.highlight
// @version      1.0.0
// @description  SLA countdown timer, milestone breach highlighting and FIRST/SECOND/NIGHT shift indicators for Salesforce Classic Level 1 Validation queues
// @author       Esko Software Support
//
// @downloadURL  https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.ValidationQueue.user.js
// @updateURL    https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.ValidationQueue.user.js
//
// @match        https://esko.my.salesforce.com/*
// @match        https://esko--accept.cs83.my.salesforce.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

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
                title === headerTitle ||
                text.indexOf(headerTitle) !== -1
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

    setInterval(
        processRows,
        REFRESH_INTERVAL_MS
    );

})();
