// ==UserScript==
// @name         SFDC Classic Resolution Time Left Calculator
// @namespace    com.esko.salesforce.resolutiontimeleftcalculator
// @version      1.0.0
// @description  Adds a "Calculate Resolution Time Left" button next to the case feed toggle that runs the ResolutionTime-DonotDelete report for the current case and shows the results
// @author       Esko Software Support
//
// @downloadURL  https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.ResolutionTimeLeftCalculator.user.js.user.js
// @updateURL    https://raw.githubusercontent.com/EskoSoftwareSupport/Salesforce-Scripts/main/Classic.ResolutionTimeLeftCalculator.user.js.user.js
//
// @match        https://esko.my.salesforce.com/console*
// @match        https://esko.my.salesforce.com/console*
// @match        https://esko--accept.cs83.my.salesforce.com/console*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // CONFIG — everything you're likely to need to tweak lives here.
  // Open DevTools on a case record inside the console app and confirm
  // these selectors match your org/theme before relying on this script.
  // ------------------------------------------------------------------
  const CONFIG = {
    // Set to true while getting selectors right. Makes the report iframe
    // visible on-screen (top-right corner) and logs every step + a dump of
    // candidate elements to the console with a "[CaseHistory]" prefix, so
    // you can see exactly where the flow is and copy diagnostics back out.
    DEBUG: false,

    reportUrl: 'https://esko.my.salesforce.com/00OTe0000030Dl8',
    // ^ Using the plain report URL (not the #%2F console hash form) is what
    //   we load into the hidden iframe — it's the same report, just without
    //   the console chrome, which is easier to script against.

    // Case number container on the case detail page, e.g.
    // <div id="cas2_ileinner">02077272&nbsp;<a>[View Hierarchy]</a></div>
    // The numeric id prefix ("cas2") varies, so match on the stable suffix.
    caseNumberContainerSelector: '[id$="_ileinner"]',

    // Feed/Details view toggle on the case detail page. Its id suffix is
    // the case's record id and varies per case/tab, e.g.
    // <div id="efpViews_500Te00000biPVN" class="efpPanelSelect ...">
    // Our button gets inserted immediately before this element.
    feedViewToggleSelector: '[id^="efpViews_"]',

    // Class + label for the injected trigger button.
    buttonClass: 'sf-calc-resolution-btn',
    buttonLabel: 'Calculate Resolution Time Left',

    // Problem Urgency field container on the case detail page, e.g.
    // <div id="00ND0000006Dar9_ileinner">Normal</div>
    // This custom field's id is stable across cases/orgs the same way a
    // standard field's id would be, so we match it exactly (attribute
    // selector, since CSS ids can't start with a digit unescaped).
    urgencyFieldSelector: '[id="00ND0000006Dar9_ileinner"]',

    // Target resolution time (in minutes) per Problem Urgency value.
    targetResolutionMinsByUrgency: {
      'Down': 480,
      'Critical': 960,
      'Normal': 2400,
      'Low': 3360,
    },

    // "Operational" checkbox image on the case detail page, e.g.
    // <img src="/img/checkbox_unchecked.gif" alt="Not Checked" ... id="00N57000006Z2tq_chkbox">
    operationalCheckboxSelector: '[id="00N57000006Z2tq_chkbox"]',

    // Case Status field container, e.g. <div id="cas7_ileinner">Waiting - Customer</div>
    statusFieldSelector: '[id="cas7_ileinner"]',

    // If the Operational checkbox is checked, OR the status is one of
    // these, the timer shows a static ResolutionTimeLeft value instead of
    // ticking down.
    freezeCountdownStatuses: ['Closed', 'Waiting - Customer'],

    // Case Record Type field, e.g.
    // <div id="RecordType_ileinner">Problem&nbsp;<a>[Change]</a></div>
    // Resolution time calculation only applies to "Problem" cases.
    recordTypeFieldSelector: '[id="RecordType_ileinner"]',
    requiredRecordType: 'Problem',
    recordTypeBlockedMessage: 'Resolution time only applicable to Problem cases',

    // "Customize" button that opens the report builder / edit page. It's a
    // full form submit (document.report.submit()) to the report's /e edit
    // URL.
    // <input value="Customize" class="btn" name="eirb" ... type="submit">
    editFiltersLinkSelector: 'input[name="eirb"], input.btn[value="Customize"]',

    // On the filter-edit page: each filter row has its own inline "Edit"
    // link. IDs like "ext-gen47" are ExtJS-generated and change on every
    // load, so we match by class and then disambiguate by row text.
    filterRowEditLinkSelector: 'a.fLink.editLink',
    // Text used to identify the Case Number row among all filter rows.
    caseNumberRowText: 'Case Number',

    // Value input revealed after clicking a row's Edit link.
    // <input ... name="pv" class="x-form-text x-form-field pv">
    filterValueInputSelector: 'input.pv, input[name="pv"]',

    // Run Report button — id is ExtJS-generated, class is stable.
    // <button ... class=" x-btn-text run-report-btn-icon">Run Report</button>
    runReportButtonSelector: 'button.run-report-btn-icon, .run-report-btn-icon',

    // Rendered report results table.
    // <table class="reportTable tabularReportTable" ...>
    reportTableSelector: 'table.reportTable, table.tabularReportTable',

    // How long to wait (ms) for each async step before giving up.
    timeoutMs: 20000,
    pollIntervalMs: 300,
    // Grace period to see if a click triggers a fresh page load (full
    // navigation) vs. an in-place DOM update (AJAX), for clicks where we're
    // NOT sure which will happen. Classic full-page navigations can take a
    // few seconds under real load, so this is intentionally generous.
    navigationGraceMs: 3000,
    // Timeout for clicks we KNOW cause a full navigation (form submits).
    navigationTimeoutMs: 20000,
    // How often (ms) to scan the page for feed-view toggles that need a
    // button injected next to them. Console keeps multiple case tabs
    // mounted at once, so this naturally supports several open case tabs.
    buttonScanIntervalMs: 1000,
  };

  // ------------------------------------------------------------------
  // Small DOM helpers
  // ------------------------------------------------------------------
  function waitFor(checkFn, timeoutMs = CONFIG.timeoutMs, intervalMs = CONFIG.pollIntervalMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        let result;
        try {
          result = checkFn();
        } catch (e) {
          result = null;
        }
        if (result) {
          clearInterval(timer);
          resolve(result);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error('Timed out waiting for condition: ' + checkFn.toString()));
        }
      }, intervalMs);
    });
  }

  function log(...args) {
    if (CONFIG.DEBUG) console.log('[CaseHistory]', ...args);
  }

  // Dumps every link on the page whose text or class hints it might be an
  // "Edit" affordance, so we can see what's actually there when our
  // selector comes up empty.
  function dumpEditCandidates(fdoc, label) {
    if (!CONFIG.DEBUG) return;
    let href = '(unknown)';
    try { href = fdoc.location.href; } catch (e) { /* document mid-transition */ }
    const candidates = Array.from(fdoc.querySelectorAll('a, button')).filter((el) => {
      const text = (el.textContent || '').trim();
      const cls = el.className || '';
      return /edit/i.test(text) || /edit/i.test(cls) || /fLink/i.test(cls);
    });
    console.groupCollapsed(`[CaseHistory] ${label} — url: ${href}`);
    console.log('title:', fdoc.title);
    console.log(`found ${candidates.length} edit-ish element(s):`);
    candidates.forEach((el, i) => {
      console.log(
        `  [${i}] <${el.tagName.toLowerCase()}> class="${el.className}" text="${(el.textContent || '').trim().slice(0, 40)}"`,
        el
      );
    });
    console.groupEnd();
  }

  // Clicks an element that MIGHT trigger a full iframe navigation (classic
  // Salesforce mixes full-page submits and in-place AJAX for similar-looking
  // actions). Waits briefly to see which happens, then hands back the
  // (possibly new) document to keep working with.
  function clickAndSettle(frame, el, graceMs = CONFIG.navigationGraceMs) {
    return new Promise((resolve) => {
      let settled = false;
      const onLoad = () => {
        if (settled) return;
        settled = true;
        frame.removeEventListener('load', onLoad);
        resolve(frame.contentDocument);
      };
      frame.addEventListener('load', onLoad);
      el.click();
      setTimeout(() => {
        if (settled) return;
        settled = true;
        frame.removeEventListener('load', onLoad);
        resolve(frame.contentDocument); // no navigation happened; same doc
      }, graceMs);
    });
  }

  // Clicks an element we KNOW causes a full page navigation (e.g. a
  // document.forms[...].submit() call), and waits for the resulting 'load'
  // event rather than racing a short grace period against it — Classic
  // full-page navigations can take several seconds under real load.
  function clickAndNavigate(frame, el, timeoutMs = CONFIG.navigationTimeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        frame.removeEventListener('load', onLoad);
        reject(new Error('Timed out waiting for navigation after click'));
      }, timeoutMs);
      const onLoad = () => {
        clearTimeout(timer);
        frame.removeEventListener('load', onLoad);
        resolve(frame.contentDocument);
      };
      frame.addEventListener('load', onLoad);
      el.click();
    });
  }

  // ------------------------------------------------------------------
  // Step 1: figure out the case number for a given case document
  // ------------------------------------------------------------------
  // Recursively collects same-origin documents reachable from `doc`
  // (the top console page, plus every nested same-origin iframe).
  function collectAllDocs(doc, acc) {
    acc.push(doc);
    const frames = Array.from(doc.querySelectorAll('iframe'));
    for (const frame of frames) {
      try {
        const fdoc = frame.contentDocument;
        if (fdoc) collectAllDocs(fdoc, acc);
      } catch (e) {
        // cross-origin frame; skip
      }
    }
    return acc;
  }

  // Reads the case number from a SPECIFIC document (e.g. the document that
  // owns a particular button), rather than guessing which of possibly
  // several open case tabs is "the" current one.
  function getCaseNumberFromDoc(doc) {
    const container = doc.querySelector(CONFIG.caseNumberContainerSelector);
    if (!container) return null;

    // First text node is the case number itself, before the
    // "[View Hierarchy]" link — e.g. "02077272\u00A0".
    const firstTextNode = Array.from(container.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.replace(/\u00A0/g, '').trim()
    );
    if (!firstTextNode) return null;
    const value = firstTextNode.textContent.replace(/\u00A0/g, '').trim();
    return value || null;
  }

  // Reads the Problem Urgency value from a SPECIFIC document (same case
  // tab as a given button).
  function getUrgencyFromDoc(doc) {
    const el = doc.querySelector(CONFIG.urgencyFieldSelector);
    if (!el) return null;
    const value = (el.textContent || '').trim();
    return value || null;
  }

  // Reads the Case Status value from a SPECIFIC document.
  function getStatusFromDoc(doc) {
    const el = doc.querySelector(CONFIG.statusFieldSelector);
    if (!el) return null;
    const value = (el.textContent || '').trim();
    return value || null;
  }

  // Reads the Operational checkbox state from a SPECIFIC document. Classic
  // renders checkboxes as an <img> whose alt text (and filename) flips
  // between checked/unchecked — alt text is the more reliable of the two
  // since filenames can vary by theme.
  function isOperationalChecked(doc) {
    const img = doc.querySelector(CONFIG.operationalCheckboxSelector);
    if (!img) return false;
    const alt = (img.getAttribute('alt') || '').trim().toLowerCase();
    if (alt === 'checked') return true;
    if (alt === 'not checked') return false;
    // Fallback if alt text is missing/unexpected: infer from the filename.
    const src = img.getAttribute('src') || '';
    return /checkbox_checked/i.test(src);
  }

  // Reads the Case Record Type value from a SPECIFIC document. Same shape
  // as the case number field: a text node followed by a link (here,
  // "[Change]"), so we take the first non-empty text node.
  function getRecordTypeFromDoc(doc) {
    const container = doc.querySelector(CONFIG.recordTypeFieldSelector);
    if (!container) return null;
    const firstTextNode = Array.from(container.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.replace(/\u00A0/g, '').trim()
    );
    if (!firstTextNode) return null;
    const value = firstTextNode.textContent.replace(/\u00A0/g, '').trim();
    return value || null;
  }

  // ------------------------------------------------------------------
  // Step 2: load the report in a hidden iframe, apply the filter, run it
  // ------------------------------------------------------------------
  // Finds the row-level "Edit" link that belongs to the Case Number filter,
  // among potentially several filter rows on the edit page.
  function findCaseNumberEditLink(doc) {
    const links = Array.from(doc.querySelectorAll(CONFIG.filterRowEditLinkSelector));
    if (links.length === 0) return null;

    const match = links.find((link) => {
      const row = link.closest('tr, li, .x-grid3-row, div');
      return row && row.textContent.includes(CONFIG.caseNumberRowText);
    });

    // Fall back to the first edit link if we couldn't confidently match a
    // row by text — better to try something than silently fail, but this
    // is the spot to double check if filtering ever hits the wrong field.
    return match || links[0];
  }

  function loadFilteredReport(caseNumber) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.style.cssText = CONFIG.DEBUG
        ? 'position:fixed;top:8px;right:8px;width:480px;height:600px;z-index:999998;border:3px solid #ff5c5c;background:#fff;'
        : 'position:fixed;top:0;left:0;width:1024px;height:768px;opacity:0;pointer-events:none;z-index:-1;';
      // ^ Hidden mode keeps REAL, on-screen dimensions (just invisible via
      //   opacity + a negative z-index) rather than shrinking to 1x1 or
      //   moving far off-screen. Salesforce's report builder uses ExtJS,
      //   which computes grid/column layout from the container's actual
      //   pixel size at render time — a near-zero-size container can make
      //   ExtJS silently fail to lay out the filter grid or results table.
      //   Keeping it within the viewport also avoids any off-screen
      //   throttling some browsers apply to elements positioned far outside
      //   the visible area.
      frame.src = CONFIG.reportUrl;
      document.body.appendChild(frame);
      log('report iframe created, loading', CONFIG.reportUrl);

      frame.addEventListener('load', async () => {
        // NOTE: { once: true } below is critical — without it, every
        // subsequent navigation inside this iframe (Customize click, Run
        // Report click, etc.) would re-trigger this ENTIRE handler again,
        // running a second orchestration concurrently with the first and
        // producing exactly the kind of race/timeout/null errors seen
        // during earlier debugging.
        try {
          let fdoc = frame.contentDocument;
          log('report view loaded:', fdoc.location.href);

          // 1) Click "Customize" — this is a full form submit
          //    (document.report.submit()) that navigates the iframe to the
          //    filter-edit / report-builder page. We KNOW this navigates,
          //    so wait for the load event directly rather than racing a
          //    short grace period (which was resolving too early and
          //    leaving us on the stale pre-navigation document).
          const editFiltersLink = await waitFor(() =>
            fdoc.querySelector(CONFIG.editFiltersLinkSelector)
          );
          log('found Customize button, clicking', editFiltersLink);
          fdoc = await clickAndNavigate(frame, editFiltersLink);
          log('navigated after Customize click:', fdoc.location.href);
          dumpEditCandidates(fdoc, 'after clicking Customize');

          // 2) On the filter-edit page, find the Case Number row's inline
          //    Edit link and click it to reveal the value input.
          let rowEditLink;
          try {
            rowEditLink = await waitFor(() => findCaseNumberEditLink(fdoc));
          } catch (e) {
            dumpEditCandidates(fdoc, 'TIMED OUT looking for Case Number row edit link');
            throw e;
          }
          log('found Case Number row edit link, clicking', rowEditLink);
          fdoc = await clickAndSettle(frame, rowEditLink);

          // 3) Clear the field, then set the new value. ExtJS fields often
          //    track raw keystroke-driven events rather than just "change",
          //    so we fire a fuller sequence to make sure its internal state
          //    (and the eventual Run Report submit) picks up the new value.
          const valueInput = await waitFor(() => fdoc.querySelector(CONFIG.filterValueInputSelector));
          log('found value input, current value:', valueInput.value);
          valueInput.focus();
          valueInput.value = '';
          valueInput.dispatchEvent(new Event('input', { bubbles: true }));
          valueInput.value = caseNumber;
          valueInput.dispatchEvent(new Event('input', { bubbles: true }));
          valueInput.dispatchEvent(new Event('keyup', { bubbles: true }));
          valueInput.dispatchEvent(new Event('change', { bubbles: true }));
          valueInput.blur();
          valueInput.dispatchEvent(new Event('blur', { bubbles: true }));
          log('value input now set to:', valueInput.value);

          // 4) Run the report — applies the filter and navigates back to
          //    the results view.
          const runBtn = await waitFor(() => fdoc.querySelector(CONFIG.runReportButtonSelector));
          log('found Run Report button, clicking', runBtn);
          fdoc = await clickAndSettle(frame, runBtn);

          // 5) Wait for the results table to render.
          const table = await waitFor(() => fdoc.querySelector(CONFIG.reportTableSelector));
          log('report table found', table);

          resolve({ frame, table });
        } catch (err) {
          log('FAILED:', err.message);
          if (!CONFIG.DEBUG) document.body.removeChild(frame);
          reject(err);
        }
      }, { once: true });
    });
  }


  // ------------------------------------------------------------------
  // Parses the report table and computes elapsed time (in hours) from it.
  //
  //   TotalOperationalTime = sum of "Workaround Duration (business Hours)"
  //   TotalDuration         = sum of "Duration since last change (BH)"
  //   TotalWaitTime         = sum of "Duration since last change (BH)" for
  //                           rows where Previous Status = "Waiting -
  //                           Customer" AND Workaround Duration = 0
  //                           (i.e. the duration of that row IS the wait
  //                           time being counted)
  //   Elapsed Time (mins)   = TotalDuration - (TotalOperationalTime + TotalWaitTime)
  //
  // Column matching is done by header text rather than fixed position, so
  // this keeps working if the report's column order changes.
  // ------------------------------------------------------------------
  const COLUMN_MATCHERS = {
    operational: (text) => text.includes('workaround duration'),
    duration: (text) => text.includes('duration since last change'),
    previousStatus: (text) => text.includes('previous status'),
  };

  function parseNum(text) {
    const n = parseFloat((text || '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }

  function computeElapsedTime(tableEl) {
    const headerCells = Array.from(tableEl.querySelectorAll('tr.headerRow th'));
    const colIndex = {};
    headerCells.forEach((th, i) => {
      const text = (th.textContent || '').trim().toLowerCase();
      for (const [key, matches] of Object.entries(COLUMN_MATCHERS)) {
        if (matches(text)) colIndex[key] = i;
      }
    });

    const missing = Object.keys(COLUMN_MATCHERS).filter((k) => !(k in colIndex));
    if (missing.length > 0) {
      throw new Error('Report table is missing expected column(s): ' + missing.join(', '));
    }

    const dataRows = Array.from(tableEl.querySelectorAll('tr')).filter((row) => {
      if (row.classList.contains('headerRow')) return false;
      if (row.classList.contains('grandTotal')) return false;
      return row.querySelectorAll('td').length > 0;
    });

    let totalOperationalTime = 0;
    let totalDuration = 0;
    let totalWaitTime = 0;

    for (const row of dataRows) {
      const cells = row.querySelectorAll('td');
      const operational = parseNum(cells[colIndex.operational] && cells[colIndex.operational].textContent);
      const duration = parseNum(cells[colIndex.duration] && cells[colIndex.duration].textContent);
      const previousStatus = ((cells[colIndex.previousStatus] && cells[colIndex.previousStatus].textContent) || '').trim();

      totalOperationalTime += operational;
      totalDuration += duration;

      if (previousStatus === 'Waiting - Customer' && operational === 0) {
        totalWaitTime += duration;
      }
    }

    const elapsedMins = totalDuration - (totalOperationalTime + totalWaitTime);

    return { elapsedMins, totalOperationalTime, totalDuration, totalWaitTime };
  }

  // ------------------------------------------------------------------
  // Step 4: countdown timer display (replaces the old balloon)
  // ------------------------------------------------------------------
  // Formats as HH:MM:SS with total (uncapped) hours — no day rollover.
  // A "day" in this context means 8 business hours, not 24, so splitting
  // into calendar days (e.g. "1d 13:20:00") was misleading; total hours
  // avoids that ambiguity.
  function formatCountdown(totalSeconds) {
    const sign = totalSeconds < 0 ? '-' : '';
    const abs = Math.abs(Math.round(totalSeconds));
    const hours = Math.floor(abs / 3600);
    const minutes = Math.floor((abs % 3600) / 60);
    const seconds = abs % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${sign}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  function stopCountdown(valueEl) {
    if (valueEl._intervalId) {
      clearInterval(valueEl._intervalId);
      valueEl._intervalId = null;
    }
  }

  // Starts (or restarts) a live countdown on the Resolution Time Left
  // value element, ticking every second. Goes negative (and switches to
  // an "overdue" style) once time runs out, rather than stopping at zero.
  // Green play emoji = actively running.
  function setResolutionRunning(valueEl, boxEl, resolutionTimeLeftMins) {
    stopCountdown(valueEl);
    boxEl.classList.remove('sf-countdown-frozen');
    boxEl.title = '';
    let remainingSeconds = resolutionTimeLeftMins * 60;

    const render = () => {
      valueEl.textContent = '🟢▶️ ' + formatCountdown(remainingSeconds);
      boxEl.classList.toggle('sf-countdown-overdue', remainingSeconds <= 0);
    };
    render();

    valueEl._intervalId = setInterval(() => {
      remainingSeconds -= 1;
      render();
    }, 1000);
  }

  // Shows ResolutionTimeLeft as a static (non-ticking) value — used when
  // the Operational checkbox is checked or the case is in a status where
  // the clock shouldn't be running (e.g. Waiting - Customer). Paused emoji,
  // unchanged from before.
  function setResolutionPaused(valueEl, boxEl, resolutionTimeLeftMins, reason) {
    stopCountdown(valueEl);
    const totalSeconds = resolutionTimeLeftMins * 60;
    valueEl.textContent = '⏸️ ' + formatCountdown(totalSeconds);
    boxEl.classList.toggle('sf-countdown-overdue', totalSeconds <= 0);
    boxEl.classList.add('sf-countdown-frozen');
    boxEl.title = 'Countdown paused: ' + reason;
  }

  // Case is Closed: red stop emoji, static value.
  function setResolutionStopped(valueEl, boxEl, resolutionTimeLeftMins) {
    stopCountdown(valueEl);
    const totalSeconds = resolutionTimeLeftMins * 60;
    valueEl.textContent = '🔴🛑 ' + formatCountdown(totalSeconds);
    boxEl.classList.toggle('sf-countdown-overdue', totalSeconds <= 0);
    boxEl.classList.add('sf-countdown-frozen');
    boxEl.title = 'Case is Closed — countdown stopped';
  }

  // Elapsed Time is always a static snapshot from the report data — it
  // doesn't tick live, so no emoji/running state, just the value.
  function setElapsedTime(valueEl, elapsedMins) {
    valueEl.textContent = formatCountdown(elapsedMins * 60);
  }

  function setTimerError(resolutionValueEl, resolutionBoxEl, elapsedValueEl, message) {
    stopCountdown(resolutionValueEl);
    resolutionBoxEl.classList.remove('sf-countdown-frozen');
    resolutionValueEl.textContent = '⚠️ Error';
    resolutionBoxEl.title = message;
    resolutionBoxEl.classList.add('sf-countdown-overdue');
    elapsedValueEl.textContent = '';
    console.warn('[Case History Bubble]', message);
  }

  // ------------------------------------------------------------------
  // Step 5: inject the trigger button + timer boxes next to each case's
  // feed toggle
  // ------------------------------------------------------------------
  function injectButtonStyles(doc) {
    if (doc.getElementById('sf-calc-btn-styles')) return;
    const style = doc.createElement('style');
    style.id = 'sf-calc-btn-styles';
    style.textContent = `
      .sf-calc-wrapper {
        display: inline-flex;
        align-items: stretch;
        float: left;
        margin-right: 12px;
        gap: 8px;
      }
      .${CONFIG.buttonClass} {
        display: inline-block;
        vertical-align: middle;
        margin: 3px 0 0 0;
        padding: 7px 15px;
        font: bold 16.5px/24px -apple-system, Arial, sans-serif;
        color: #04844b;
        background: #fff;
        border: 1px solid #04844b;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
      }
      .${CONFIG.buttonClass}:hover { background: #eafaf1; }
      .${CONFIG.buttonClass}[disabled] { opacity: 0.6; cursor: default; }
      .${CONFIG.buttonClass}.sf-calc-btn-blocked {
        color: #706e6b;
        background: #f3f2f2;
        border-color: #c9c7c5;
        opacity: 1;
        cursor: not-allowed;
      }
      .sf-timer-box {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        vertical-align: middle;
        margin: 3px 0 0 0;
        padding: 4px 12px;
        background: #eafaf1;
        border: 1px solid #04844b;
        border-radius: 4px;
        white-space: nowrap;
        min-width: 142px;
        text-align: center;
      }
      .sf-timer-box:empty,
      .sf-timer-box.sf-timer-box-empty { display: none; }
      .sf-timer-title {
        font: bold 10.5px/1.3 -apple-system, Arial, sans-serif;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: #444;
        margin-bottom: 2px;
      }
      .sf-timer-value {
        font: bold 18px/24px 'SFMono-Regular', Consolas, monospace;
        color: #04844b;
      }
      .sf-timer-box.sf-countdown-frozen { border-color: #0176d3; background: #eef4ff; }
      .sf-timer-box.sf-countdown-frozen .sf-timer-value { color: #0176d3; }
      .sf-timer-box.sf-countdown-overdue { border-color: #c23934; background: #fdecea; }
      .sf-timer-box.sf-countdown-overdue .sf-timer-value { color: #c23934; }
    `;
    doc.head.appendChild(style);
  }

  async function handleCalcClick(btn, resolutionBoxEl, resolutionValueEl, elapsedBoxEl, elapsedValueEl, doc) {
    if (btn.disabled) return;
    btn.dataset.busy = 'true';

    const caseNumber = getCaseNumberFromDoc(doc);
    if (!caseNumber) {
      const original = CONFIG.buttonLabel;
      btn.textContent = 'Case number not found';
      delete btn.dataset.busy;
      setTimeout(() => { btn.textContent = original; }, 3000);
      return;
    }

    stopCountdown(resolutionValueEl);
    resolutionValueEl.textContent = '';
    resolutionBoxEl.classList.remove('sf-countdown-overdue', 'sf-countdown-frozen');
    resolutionBoxEl.title = '';
    resolutionBoxEl.classList.add('sf-timer-box-empty');
    elapsedValueEl.textContent = '';
    elapsedBoxEl.classList.add('sf-timer-box-empty');

    btn.disabled = true;
    btn.textContent = 'Calculating…';

    try {
      const { table } = await loadFilteredReport(caseNumber);
      const { elapsedMins, totalOperationalTime, totalDuration, totalWaitTime } = computeElapsedTime(table);

      const urgency = getUrgencyFromDoc(doc);
      if (!urgency) throw new Error('Could not find Problem Urgency field');
      const targetResolutionMins = CONFIG.targetResolutionMinsByUrgency[urgency];
      if (targetResolutionMins == null) {
        throw new Error('Unrecognized Problem Urgency value: "' + urgency + '"');
      }
      const resolutionTimeLeftMins = targetResolutionMins - elapsedMins;

      const operationalChecked = isOperationalChecked(doc);
      const status = getStatusFromDoc(doc);
      const shouldFreeze = operationalChecked || CONFIG.freezeCountdownStatuses.includes(status);

      log('computed', {
        elapsedMins, totalOperationalTime, totalDuration, totalWaitTime,
        urgency, targetResolutionMins, resolutionTimeLeftMins,
        operationalChecked, status, shouldFreeze,
      });

      resolutionBoxEl.classList.remove('sf-timer-box-empty');
      elapsedBoxEl.classList.remove('sf-timer-box-empty');
      setElapsedTime(elapsedValueEl, elapsedMins);

      if (status === 'Closed') {
        setResolutionStopped(resolutionValueEl, resolutionBoxEl, resolutionTimeLeftMins);
      } else if (shouldFreeze) {
        const reason = operationalChecked
          ? 'Operational checkbox is checked'
          : `status is "${status}"`;
        setResolutionPaused(resolutionValueEl, resolutionBoxEl, resolutionTimeLeftMins, reason);
      } else {
        setResolutionRunning(resolutionValueEl, resolutionBoxEl, resolutionTimeLeftMins);
      }
      btn.textContent = CONFIG.buttonLabel;
    } catch (err) {
      resolutionBoxEl.classList.remove('sf-timer-box-empty');
      elapsedBoxEl.classList.add('sf-timer-box-empty');
      setTimerError(resolutionValueEl, resolutionBoxEl, elapsedValueEl, 'Could not calculate resolution time left: ' + err.message);
      btn.textContent = 'Failed — click to retry';
    } finally {
      btn.disabled = false;
      delete btn.dataset.busy;
    }
  }

  function createCalcWidget(doc) {
    injectButtonStyles(doc);

    const wrapper = doc.createElement('span');
    wrapper.className = 'sf-calc-wrapper';

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = CONFIG.buttonClass;
    btn.textContent = CONFIG.buttonLabel;

    const resolutionBox = doc.createElement('span');
    resolutionBox.className = 'sf-timer-box sf-timer-box-empty';
    const resolutionTitle = doc.createElement('span');
    resolutionTitle.className = 'sf-timer-title';
    resolutionTitle.textContent = 'Resolution Time Left';
    const resolutionValue = doc.createElement('span');
    resolutionValue.className = 'sf-timer-value';
    resolutionBox.appendChild(resolutionTitle);
    resolutionBox.appendChild(resolutionValue);

    const elapsedBox = doc.createElement('span');
    elapsedBox.className = 'sf-timer-box sf-timer-box-empty';
    const elapsedTitle = doc.createElement('span');
    elapsedTitle.className = 'sf-timer-title';
    elapsedTitle.textContent = 'Elapsed Time';
    const elapsedValue = doc.createElement('span');
    elapsedValue.className = 'sf-timer-value';
    elapsedBox.appendChild(elapsedTitle);
    elapsedBox.appendChild(elapsedValue);

    btn.addEventListener('click', () =>
      handleCalcClick(btn, resolutionBox, resolutionValue, elapsedBox, elapsedValue, doc)
    );

    wrapper.appendChild(btn);
    wrapper.appendChild(resolutionBox);
    wrapper.appendChild(elapsedBox);
    return wrapper;
  }

  // Enables/disables a case's button based on its Record Type, re-checked
  // on every scan (not just at injection time) since the field may not
  // have rendered yet the first time we saw this tab. Skips a button
  // that's mid-calculation so it doesn't clobber "Calculating…"/error text.
  function syncRecordTypeGuard(doc, wrapper) {
    const btn = wrapper.querySelector('.' + CONFIG.buttonClass);
    if (!btn || btn.dataset.busy === 'true') return;

    const recordType = getRecordTypeFromDoc(doc);
    const blocked = recordType !== null && recordType !== CONFIG.requiredRecordType;

    if (blocked) {
      btn.disabled = true;
      btn.textContent = CONFIG.recordTypeBlockedMessage;
      btn.classList.add('sf-calc-btn-blocked');
    } else if (btn.classList.contains('sf-calc-btn-blocked')) {
      // Record type is now valid (or the field hasn't loaded yet) —
      // restore the normal clickable state.
      btn.disabled = false;
      btn.textContent = CONFIG.buttonLabel;
      btn.classList.remove('sf-calc-btn-blocked');
    }
  }

  // Scans every reachable same-origin document for a feed-view toggle that
  // doesn't already have our widget next to it, and inserts one. Console
  // keeps multiple case tabs mounted in the DOM simultaneously, each with
  // its own toggle element (id suffix = that case's record id), so this
  // naturally gives every open case tab its own independent button + timer.
  function injectButtons() {
    let docs;
    try {
      docs = collectAllDocs(document, []);
    } catch (e) {
      return;
    }

    for (const doc of docs) {
      let target;
      try {
        target = doc.querySelector(CONFIG.feedViewToggleSelector);
      } catch (e) {
        continue;
      }
      if (!target || !target.parentElement) continue;

      let wrapper = target.previousElementSibling;
      const alreadyInjected = wrapper && wrapper.classList && wrapper.classList.contains('sf-calc-wrapper');

      if (!alreadyInjected) {
        wrapper = createCalcWidget(doc);
        target.parentElement.insertBefore(wrapper, target);
        log('injected widget for case', getCaseNumberFromDoc(doc));
      }

      syncRecordTypeGuard(doc, wrapper);
    }
  }

  // ------------------------------------------------------------------
  // Orchestration
  // ------------------------------------------------------------------
  injectButtons();
  setInterval(injectButtons, CONFIG.buttonScanIntervalMs);
})();
