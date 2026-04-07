(() => {
    const $ = (sel) => document.querySelector(sel);
    const paperListView = $("#paper-list-view");
    const runsListView = $("#runs-list-view");
    const reviewView = $("#review-view");
    const papersTbody = $("#papers-tbody");
    const runsTbody = $("#runs-tbody");
    const runsPaperTitle = $("#runs-paper-title");
    const resultsContainer = $("#results-container");
    const reviewTitle = $("#review-title");
    const progressText = $("#progress-text");
    const reviewerDisplay = $("#reviewer-display");
    const markCompleteBtn = $("#mark-complete-btn");
    const paperPanel = $("#paper-panel");
    const paperTextContent = $("#paper-text-content");
    const panelCloseBtn = $("#panel-close-btn");

    // Name modal (on load)
    const nameModal = $("#name-modal");
    const nameModalInput = $("#name-modal-input");
    const nameModalBtn = $("#name-modal-btn");

    // Reviewer modal (continue/restart)
    const modal = $("#reviewer-modal");
    const modalTitle = $("#modal-title");
    const modalNameSection = $("#modal-name-section");
    const modalInput = $("#modal-reviewer-input");
    const modalExisting = $("#modal-existing");
    const modalDefaultActions = $("#modal-default-actions");
    const modalContinueBtn = $("#modal-continue-btn");
    const modalNewBtn = $("#modal-new-btn");
    const modalStartBtn = $("#modal-start-btn");
    const modalError = $("#modal-error");

    // Comparison elements
    const comparisonComment = $("#comparison-comment");
    const comparisonSaveStatus = $("#comparison-save-status");

    let currentPaper = null;
    let currentResults = [];
    let currentReview = {};
    let currentReviewer = "";
    let saveTimer = null;
    let paperTextCache = {}; // paperId -> sections
    let pendingPaper = null; // paper waiting for modal
    let allPapersFlat = []; // flat list from API
    let currentPaperForRuns = null; // { paper_id, title, runs[] }
    let comparisonSaveTimer = null;

    // --- Navigation ---

    function showPaperList() {
        reviewView.classList.add("hidden");
        runsListView.classList.add("hidden");
        paperListView.classList.remove("hidden");
        currentPaper = null;
        loadPapers();
    }

    function showRunsList(paperData, pushHistory = true) {
        currentPaperForRuns = paperData;
        if (pushHistory) {
            history.pushState({ view: "runs", paperData }, "", location.pathname);
        }
        runsPaperTitle.textContent = paperData.title;
        runsTbody.innerHTML = "";
        paperData.runs.forEach((p) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="run-cell">${esc(p.run_id)}${p.metrics ? `<span class="metrics-tooltip">${formatMetrics(p.metrics)}</span>` : ""}</td>
                <td>${p.claims_count}</td>
                <td>${p.results_count}</td>
                <td><span class="badge badge-${p.review_status}">${p.review_status.replace("_", " ")}</span></td>
            `;
            tr.addEventListener("click", () => openReviewerModal(p.paper_id, p.run_id, p.title));
            runsTbody.appendChild(tr);
        });
        paperListView.classList.add("hidden");
        reviewView.classList.add("hidden");
        runsListView.classList.remove("hidden");
        initComparison(paperData);
    }




    async function openReviewerModal(paperId, runId, title) {
        pendingPaper = { paperId, runId, title };
        const res = await fetch(`/api/papers/${paperId}/${runId}/review?reviewer=${encodeURIComponent(currentReviewer)}`);
        if (res.ok) {
            // Existing review found — ask continue or restart
            modalTitle.textContent = "Resume review?";
            modalNameSection.classList.add("hidden");
            modalExisting.classList.remove("hidden");
            modalDefaultActions.classList.add("hidden");
            modalError.classList.add("hidden");
            modal.classList.remove("hidden");
        } else {
            // No existing review — go straight in
            enterReview(false);
        }
    }

    modalContinueBtn.addEventListener("click", () => enterReview(true));
    modalNewBtn.addEventListener("click", () => enterReview(false));

    function enterReview(loadExisting) {
        modal.classList.add("hidden");

        const { paperId, runId, title } = pendingPaper;
        history.pushState({ view: "review", paperId, runId, title }, "", location.pathname);
        paperListView.classList.add("hidden");
        runsListView.classList.add("hidden");
        reviewView.classList.remove("hidden");
        currentPaper = { paperId, runId, title };
        reviewTitle.textContent = title;
        reviewerDisplay.textContent = `Reviewer: ${currentReviewer}`;
        loadReview(loadExisting);
    }

    window.addEventListener("popstate", (e) => {
        const state = e.state;
        if (!state || state.view === "papers") {
            reviewView.classList.add("hidden");
            runsListView.classList.add("hidden");
            paperListView.classList.remove("hidden");
            currentPaper = null;
            if (allPapersFlat.length === 0) loadPapers();
        } else if (state.view === "runs") {
            showRunsList(state.paperData, false);
        } else if (state.view === "review") {
            // Only restore if we still have the same session state
            if (currentReviewer && currentPaper &&
                currentPaper.paperId === state.paperId &&
                currentPaper.runId === state.runId) {
                paperListView.classList.add("hidden");
                runsListView.classList.add("hidden");
                reviewView.classList.remove("hidden");
            } else {
                // Session lost (e.g. page reload) — fall back to runs list
                const runs = allPapersFlat.filter((p) => p.paper_id === state.paperId);
                if (runs.length > 0 && currentPaperForRuns) {
                    showRunsList(currentPaperForRuns, false);
                } else {
                    reviewView.classList.add("hidden");
                    runsListView.classList.add("hidden");
                    paperListView.classList.remove("hidden");
                    if (allPapersFlat.length === 0) loadPapers();
                }
            }
        }
    });

    // --- Paper List ---

    async function loadPapers() {
        const query = currentReviewer ? `?reviewer=${encodeURIComponent(currentReviewer)}` : "";
        const res = await fetch(`/api/papers${query}`);
        allPapersFlat = await res.json();

        // Group runs by paper_id
        const papersMap = new Map();
        allPapersFlat.forEach((p) => {
            if (!papersMap.has(p.paper_id)) {
                papersMap.set(p.paper_id, { paper_id: p.paper_id, title: p.title, runs: [] });
            }
            papersMap.get(p.paper_id).runs.push(p);
        });

        papersTbody.innerHTML = "";
        papersMap.forEach((paper) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="title-cell" title="${esc(paper.title)}">${esc(paper.title)}</td>
                <td>${esc(paper.paper_id)}</td>
                <td>${paper.runs.length}</td>
            `;
            tr.addEventListener("click", () => showRunsList(paper));
            papersTbody.appendChild(tr);
        });
    }

    // --- Comparison ---

    function initComparison(paperData) {
        comparisonComment.value = "";
        comparisonSaveStatus.textContent = "";
        renderRankingList(paperData.runs.map((r) => r.run_id));
        fetchAndApplyComparison(paperData.paper_id, currentReviewer);
    }

    async function fetchAndApplyComparison(paperId, reviewer) {
        const res = await fetch(`/api/papers/${paperId}/comparison?reviewer=${encodeURIComponent(reviewer)}`);
        if (!res.ok) return;
        const data = await res.json();
        // Reorder ranking list to match saved order, appending any new runs at the end
        const savedOrder = data.ranking || [];
        const allRunIds = currentPaperForRuns.runs.map((r) => r.run_id);
        const ordered = [
            ...savedOrder.filter((id) => allRunIds.includes(id)),
            ...allRunIds.filter((id) => !savedOrder.includes(id)),
        ];
        renderRankingList(ordered);
        comparisonComment.value = data.comment || "";
    }

    function renderRankingList(runIds) {
        const list = $("#ranking-list");
        list.innerHTML = "";
        runIds.forEach((runId, i) => {
            const item = document.createElement("div");
            item.className = "rank-item";
            item.draggable = true;
            item.dataset.runId = runId;
            item.innerHTML = `<span class="drag-handle">⠿</span><span class="rank-num">#${i + 1}</span><span class="rank-run-label">${esc(runId)}</span>`;
            list.appendChild(item);
        });
        setupDragAndDrop(list);
    }

    function setupDragAndDrop(list) {
        let dragging = null;

        list.addEventListener("dragstart", (e) => {
            dragging = e.target.closest(".rank-item");
            if (dragging) dragging.classList.add("dragging");
        });

        list.addEventListener("dragend", () => {
            if (dragging) dragging.classList.remove("dragging");
            dragging = null;
            updateRankNumbers();
            scheduleComparisonSave();
        });

        list.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (!dragging) return;
            const target = e.target.closest(".rank-item");
            if (!target || target === dragging) return;
            const rect = target.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                list.insertBefore(dragging, target);
            } else {
                list.insertBefore(dragging, target.nextSibling);
            }
        });
    }

    function updateRankNumbers() {
        $("#ranking-list").querySelectorAll(".rank-item").forEach((item, i) => {
            item.querySelector(".rank-num").textContent = `#${i + 1}`;
        });
    }

    function scheduleComparisonSave() {
        comparisonSaveStatus.textContent = "saving...";
        clearTimeout(comparisonSaveTimer);
        comparisonSaveTimer = setTimeout(doSaveComparison, 600);
    }

    async function doSaveComparison() {
        if (!currentReviewer || !currentPaperForRuns) return;

        const ranking = [...$("#ranking-list").querySelectorAll(".rank-item")].map((el) => el.dataset.runId);
        const res = await fetch(`/api/papers/${currentPaperForRuns.paper_id}/comparison`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reviewer: currentReviewer, ranking, comment: comparisonComment.value }),
        });
        if (res.ok) {
            comparisonSaveStatus.textContent = "saved";
            setTimeout(() => { comparisonSaveStatus.textContent = ""; }, 1500);
        }
    }

    comparisonComment.addEventListener("input", scheduleComparisonSave);

    // --- Review View ---

    async function loadReview(loadExisting = true) {
        const { paperId, runId } = currentPaper;

        const resultsRes = await fetch(`/api/papers/${paperId}/${runId}/results`);
        currentResults = await resultsRes.json();

        if (loadExisting && currentReviewer) {
            const reviewRes = await fetch(`/api/papers/${paperId}/${runId}/review?reviewer=${encodeURIComponent(currentReviewer)}`);
            currentReview = reviewRes.ok ? await reviewRes.json() : { reviewer: currentReviewer, status: "not_started", results: {}, claims: {} };
        } else {
            currentReview = { reviewer: currentReviewer, status: "not_started", results: {}, claims: {} };
        }

        renderResults();
        updateProgress();
    }

    function renderResults() {
        resultsContainer.innerHTML = "";
        currentResults.forEach((r) => {
            const rv = currentReview.results?.[r.result_id] || {};
            const card = document.createElement("div");
            card.className = "result-card" + (rv.agreement ? " reviewed" : "") + (rv.flagged ? " flagged" : "");
            card.dataset.rid = r.result_id;

            const claimsHtml = r.claims.map((c) => {
                const cr = currentReview.claims?.[c.claim_id] || {};
                return `
                <div class="claim-item ${cr.agreement ? "claim-reviewed" : ""}" data-cid="${c.claim_id}">
                    <div class="claim-header">
                        <span class="claim-id">${esc(c.claim_id)}</span>
                        ${c.section ? `<span class="claim-section">${esc(c.section)}</span>` : ""}
                        <span class="claim-type-badge">${esc(c.claim_type)}</span>
                    </div>
                    <div class="claim-text">${esc(c.claim)}</div>
                    <div class="claim-evidence">
                        ${c.evidence_type.map((t) => `<span class="claim-evidence-type">${esc(t)}</span>`).join("")}
                        <span class="claim-evidence-text">${esc(c.evidence)}</span>
                    </div>
                    <div class="claim-controls">
                        <button class="btn btn-sm btn-claim-accept ${cr.agreement === "accept" ? "active-agree" : ""}" data-cid="${c.claim_id}" data-action="accept">Accept</button>
                        <button class="btn btn-sm btn-claim-oppose ${cr.agreement === "oppose" ? "active-disagree" : ""}" data-cid="${c.claim_id}" data-action="oppose">Oppose</button>
                        ${c.source_type.includes("TEXT") ? `<button class="btn btn-sm btn-view-source" data-source="${escAttr(c.source)}">View in paper</button>` : ""}
                        <input class="claim-comment" type="text" placeholder="Comment..." data-cid="${c.claim_id}" value="${esc(cr.comment || "")}">
                    </div>
                </div>
                `;
            }).join("");

            card.innerHTML = `
                <div class="result-header">
                    <span class="result-id">${esc(r.result_id.replace(/^R(\d+)$/, "Result $1"))}</span>
                    <span class="badge badge-${r.evaluation_type.toLowerCase()}">${r.evaluation_type}</span>
                    <span class="badge badge-${r.result_type.toLowerCase()}">${r.result_type}</span>
                </div>
                <div class="result-summary">${esc(r.result)}</div>
                <div class="result-evaluation">${esc(r.evaluation)}</div>
                <button class="claims-toggle" data-rid="${r.result_id}">Show ${r.claims.length} claims</button>
                <div class="claims-list hidden" id="claims-${r.result_id}">${claimsHtml}</div>
                <div class="review-controls">
                    <button class="btn btn-agree ${rv.agreement === "agree" ? "active-agree" : ""}" data-rid="${r.result_id}" data-action="agree">Agree</button>
                    <button class="btn btn-disagree ${rv.agreement === "disagree" ? "active-disagree" : ""}" data-rid="${r.result_id}" data-action="disagree">Disagree</button>
                    <button class="btn btn-flag ${rv.flagged ? "active-flag" : ""}" data-rid="${r.result_id}" data-action="flag">Flag</button>
                    <span class="save-indicator" id="save-ind-${r.result_id}"></span>
                </div>
                <div class="override-row ${rv.agreement === "disagree" ? "" : "hidden"}" id="overrides-${r.result_id}">
                    <label>Eval: <select data-rid="${r.result_id}" data-field="override_evaluation_type">
                        <option value="">--</option>
                        <option value="SUPPORTED" ${rv.override_evaluation_type === "SUPPORTED" ? "selected" : ""}>SUPPORTED</option>
                        <option value="UNSUPPORTED" ${rv.override_evaluation_type === "UNSUPPORTED" ? "selected" : ""}>UNSUPPORTED</option>
                    </select></label>
                    <label>Significance: <select data-rid="${r.result_id}" data-field="override_result_type">
                        <option value="">--</option>
                        <option value="MAJOR" ${rv.override_result_type === "MAJOR" ? "selected" : ""}>MAJOR</option>
                        <option value="MINOR" ${rv.override_result_type === "MINOR" ? "selected" : ""}>MINOR</option>
                    </select></label>
                </div>
                <div class="comment-row">
                    <textarea placeholder="Add comment..." data-rid="${r.result_id}" data-field="comment">${esc(rv.comment || "")}</textarea>
                </div>
            `;
            resultsContainer.appendChild(card);
        });

        // Overall comment card
        const overallCard = document.createElement("div");
        overallCard.className = "overall-comment-card";
        overallCard.innerHTML = `
            <h3 class="overall-comment-heading">Overall Review</h3>
            <p class="overall-comment-hint">Write your overall assessment of this run — quality, completeness, any general observations.</p>
            <textarea id="overall-comment-textarea" placeholder="Add your overall review here...">${esc(currentReview.overall_comment || "")}</textarea>
            <span class="save-indicator" id="overall-comment-save-ind"></span>
        `;
        resultsContainer.appendChild(overallCard);

        document.getElementById("overall-comment-textarea").addEventListener("input", (e) => {
            currentReview.overall_comment = e.target.value;
            scheduleOverallCommentSave();
        });

        // Event delegation
        resultsContainer.addEventListener("click", handleClick);
        resultsContainer.addEventListener("change", handleChange);
        resultsContainer.addEventListener("input", handleInput);
    }

    function handleClick(e) {
        const btn = e.target.closest("button");
        if (!btn) return;

        // Claims toggle
        if (btn.classList.contains("claims-toggle")) {
            const rid = btn.dataset.rid;
            const list = document.getElementById(`claims-${rid}`);
            const hidden = list.classList.toggle("hidden");
            btn.textContent = hidden
                ? `Show ${list.children.length} claims`
                : `Hide ${list.children.length} claims`;
            return;
        }

        // View in paper
        if (btn.classList.contains("btn-view-source")) {
            showSourceInPanel(btn.dataset.source);
            return;
        }

        // Claim-level accept/oppose
        const cid = btn.dataset.cid;
        if (cid && (btn.dataset.action === "accept" || btn.dataset.action === "oppose")) {
            const action = btn.dataset.action;
            const cr = getOrCreateClaimReview(cid);
            cr.agreement = cr.agreement === action ? null : action;

            const item = btn.closest(".claim-item");
            item.querySelector(".btn-claim-accept").classList.toggle("active-agree", cr.agreement === "accept");
            item.querySelector(".btn-claim-oppose").classList.toggle("active-disagree", cr.agreement === "oppose");
            item.classList.toggle("claim-reviewed", !!cr.agreement);

            scheduleClaimSave(cid);
            return;
        }

        const rid = btn.dataset.rid;
        const action = btn.dataset.action;
        if (!rid || !action) return;

        const rv = getOrCreateReview(rid);

        if (action === "agree" || action === "disagree") {
            rv.agreement = rv.agreement === action ? null : action;
            const card = btn.closest(".result-card");
            card.querySelector(".btn-agree").classList.toggle("active-agree", rv.agreement === "agree");
            card.querySelector(".btn-disagree").classList.toggle("active-disagree", rv.agreement === "disagree");
            card.classList.toggle("reviewed", !!rv.agreement);

            const overrides = document.getElementById(`overrides-${rid}`);
            overrides.classList.toggle("hidden", rv.agreement !== "disagree");
            if (rv.agreement !== "disagree") {
                rv.override_evaluation_type = null;
                rv.override_result_type = null;
            }
        } else if (action === "flag") {
            rv.flagged = !rv.flagged;
            btn.classList.toggle("active-flag", rv.flagged);
            btn.closest(".result-card").classList.toggle("flagged", rv.flagged);
        }

        scheduleSave(rid);
    }

    function handleChange(e) {
        const sel = e.target;
        if (!sel.dataset.rid || !sel.dataset.field) return;
        const rv = getOrCreateReview(sel.dataset.rid);
        rv[sel.dataset.field] = sel.value || null;
        scheduleSave(sel.dataset.rid);
    }

    function handleInput(e) {
        const el = e.target;
        // Claim comment input
        if (el.classList.contains("claim-comment") && el.dataset.cid) {
            const cr = getOrCreateClaimReview(el.dataset.cid);
            cr.comment = el.value;
            scheduleClaimSave(el.dataset.cid);
            return;
        }
        // Result comment textarea
        if (el.tagName !== "TEXTAREA" || !el.dataset.rid) return;
        const rv = getOrCreateReview(el.dataset.rid);
        rv.comment = el.value;
        scheduleSave(el.dataset.rid);
    }

    function getOrCreateReview(rid) {
        if (!currentReview.results) currentReview.results = {};
        if (!currentReview.results[rid]) {
            currentReview.results[rid] = {
                agreement: null,
                override_evaluation_type: null,
                override_result_type: null,
                comment: "",
                flagged: false,
            };
        }
        return currentReview.results[rid];
    }

    function getOrCreateClaimReview(cid) {
        if (!currentReview.claims) currentReview.claims = {};
        if (!currentReview.claims[cid]) {
            currentReview.claims[cid] = { agreement: null, comment: "" };
        }
        return currentReview.claims[cid];
    }

    // --- Auto-save with debounce ---

    let claimSaveTimer = null;
    let overallCommentSaveTimer = null;

    function scheduleOverallCommentSave() {
        const ind = document.getElementById("overall-comment-save-ind");
        if (ind) ind.textContent = "saving...";
        clearTimeout(overallCommentSaveTimer);
        overallCommentSaveTimer = setTimeout(async () => {
            await doSave(null, null);
            const ind2 = document.getElementById("overall-comment-save-ind");
            if (ind2) {
                ind2.textContent = "saved";
                setTimeout(() => { ind2.textContent = ""; }, 1500);
            }
        }, 600);
    }

    function scheduleSave(rid) {
        const ind = document.getElementById(`save-ind-${rid}`);
        if (ind) ind.textContent = "saving...";
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => doSave(rid, null), 600);
    }

    function scheduleClaimSave(cid) {
        clearTimeout(claimSaveTimer);
        claimSaveTimer = setTimeout(() => doSave(null, cid), 600);
    }

    async function doSave(rid, cid) {
        if (!currentReviewer) return;
        const { paperId, runId } = currentPaper;
        // Any save action means the review is at least in progress
        if (!currentReview.status || currentReview.status === "not_started") {
            currentReview.status = "in_progress";
        }
        const payload = {
            reviewer: currentReviewer,
            status: currentReview.status,
            overall_comment: currentReview.overall_comment || "",
            results: {},
            claims: {},
        };
        if (rid && currentReview.results?.[rid]) {
            payload.results[rid] = currentReview.results[rid];
        }
        if (cid && currentReview.claims?.[cid]) {
            payload.claims[cid] = currentReview.claims[cid];
        }

        const res = await fetch(`/api/papers/${paperId}/${runId}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (res.ok) {
            const saved = await res.json();
            currentReview = saved;
            if (rid) {
                const ind = document.getElementById(`save-ind-${rid}`);
                if (ind) {
                    ind.textContent = "saved";
                    setTimeout(() => { ind.textContent = ""; }, 1500);
                }
            }
        }
        updateProgress();
    }

    // --- Progress ---

    function updateProgress() {
        const total = currentResults.length;
        const reviewed = Object.values(currentReview.results || {}).filter((r) => r.agreement).length;
        progressText.textContent = `${reviewed}/${total} reviewed`;
    }

    // --- Mark Complete ---

    markCompleteBtn.addEventListener("click", async () => {
        if (!currentReviewer) return;
        currentReview.status = "complete";
        const { paperId, runId } = currentPaper;
        await fetch(`/api/papers/${paperId}/${runId}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                reviewer: currentReviewer,
                status: "complete",
                results: {},
                claims: {},
            }),
        });
        markCompleteBtn.textContent = "Completed!";
        setTimeout(() => { markCompleteBtn.textContent = "Mark Complete"; }, 2000);
    });

    // --- Paper Text Panel ---

    panelCloseBtn.addEventListener("click", () => {
        paperPanel.classList.add("hidden");
    });

    async function loadPaperText(paperId) {
        if (paperTextCache[paperId]) return paperTextCache[paperId];
        const res = await fetch(`/api/papers/${paperId}/text`);
        if (!res.ok) return null;
        const sections = await res.json();
        paperTextCache[paperId] = sections;
        return sections;
    }

    function renderPaperText(sections) {
        paperTextContent.innerHTML = sections.map((s) =>
            `<div class="paper-section">
                <h3 class="paper-section-title">${esc(s.section)}</h3>
                ${s.paragraphs.map((p) => `<p class="paper-para">${esc(p)}</p>`).join("")}
            </div>`
        ).join("");
    }

    function highlightSource(sourceText) {
        // Clear previous highlights
        paperTextContent.querySelectorAll(".highlight").forEach((el) => {
            el.replaceWith(el.textContent);
        });
        // Normalize for matching
        paperTextContent.querySelectorAll("p").forEach((p) => p.normalize());

        if (!sourceText) return;

        // Try to find and highlight the source text in the paper
        const needle = sourceText.trim();
        const paras = paperTextContent.querySelectorAll(".paper-para");
        let found = false;

        for (const p of paras) {
            const idx = p.textContent.indexOf(needle);
            if (idx === -1) continue;

            // Walk text nodes to find the range
            const range = document.createRange();
            let charCount = 0;
            let startNode = null, startOffset = 0, endNode = null, endOffset = 0;

            const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                const nodeLen = node.length;
                if (!startNode && charCount + nodeLen > idx) {
                    startNode = node;
                    startOffset = idx - charCount;
                }
                if (startNode && charCount + nodeLen >= idx + needle.length) {
                    endNode = node;
                    endOffset = idx + needle.length - charCount;
                    break;
                }
                charCount += nodeLen;
            }

            if (startNode && endNode) {
                range.setStart(startNode, startOffset);
                range.setEnd(endNode, endOffset);
                const mark = document.createElement("mark");
                mark.className = "highlight";
                range.surroundContents(mark);
                mark.scrollIntoView({ behavior: "smooth", block: "center" });
                found = true;
                break;
            }
        }

        // Fallback: fuzzy match on first 60 chars
        if (!found && needle.length > 60) {
            const shortNeedle = needle.substring(0, 60);
            for (const p of paras) {
                if (p.textContent.includes(shortNeedle)) {
                    p.classList.add("highlight-para");
                    p.scrollIntoView({ behavior: "smooth", block: "center" });
                    break;
                }
            }
        }
    }

    async function showSourceInPanel(sourceText) {
        const { paperId } = currentPaper;
        const sections = await loadPaperText(paperId);
        if (!sections) return;

        paperPanel.classList.remove("hidden");
        renderPaperText(sections);

        // Small delay so DOM is ready
        requestAnimationFrame(() => highlightSource(sourceText));
    }

    // --- Helpers ---

    function formatMetrics(m) {
        const lines = [];
        if (m.extract) {
            lines.push(
                `Extract`,
                `  Model: ${esc(m.extract.model)}`,
                `  Cost: $${m.extract.total_cost.toFixed(2)}`,
                `  Time: ${m.extract.processing_time_sec.toFixed(0)}s`,
            );
        }
        if (m.eval) {
            lines.push(
                `Eval`,
                `  Model: ${esc(m.eval.model)}`,
                `  Cost: $${m.eval.total_cost.toFixed(2)}`,
                `  Time: ${m.eval.processing_time_sec.toFixed(0)}s`,
            );
        }
        if (m.extract && m.eval) {
            const totalCost = m.extract.total_cost + m.eval.total_cost;
            const totalTime = m.extract.processing_time_sec + m.eval.processing_time_sec;
            lines.push(`Total: $${totalCost.toFixed(2)} / ${totalTime.toFixed(0)}s`);
        }
        return lines.join("\n");
    }

    function esc(s) {
        if (!s) return "";
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function escAttr(s) {
        return esc(s).replace(/"/g, "&quot;");
    }

    // --- Refresh ---

    const refreshBtn = $("#refresh-btn");
    refreshBtn.addEventListener("click", async () => {
        refreshBtn.classList.add("spinning");
        await fetch("/api/papers/refresh", { method: "POST" });
        await loadPapers();
        refreshBtn.classList.remove("spinning");
    });

    // --- Name Modal ---

    nameModalInput.addEventListener("input", () => {
        nameModalBtn.disabled = !nameModalInput.value.trim();
    });

    nameModalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && nameModalInput.value.trim()) submitName();
    });

    nameModalBtn.addEventListener("click", submitName);

    function submitName() {
        const name = nameModalInput.value.trim();
        if (!name) return;
        currentReviewer = name;
        nameModal.classList.add("hidden");
        loadPapers();
    }

    // --- Init ---

    history.replaceState({ view: "papers" }, "", location.pathname);
    nameModalInput.focus();
})();
