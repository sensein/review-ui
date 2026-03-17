(() => {
    const $ = (sel) => document.querySelector(sel);
    const paperListView = $("#paper-list-view");
    const reviewView = $("#review-view");
    const papersTbody = $("#papers-tbody");
    const resultsContainer = $("#results-container");
    const reviewTitle = $("#review-title");
    const progressText = $("#progress-text");
    const reviewerInput = $("#reviewer-name");
    const backBtn = $("#back-btn");
    const markCompleteBtn = $("#mark-complete-btn");

    let currentPaper = null;
    let currentResults = [];
    let currentReview = {};
    let saveTimer = null;

    // --- Navigation ---

    function showPaperList() {
        reviewView.classList.add("hidden");
        paperListView.classList.remove("hidden");
        currentPaper = null;
        loadPapers();
    }

    function showReview(paperId, runId, title) {
        paperListView.classList.add("hidden");
        reviewView.classList.remove("hidden");
        currentPaper = { paperId, runId, title };
        reviewTitle.textContent = title;
        loadReview();
    }

    backBtn.addEventListener("click", showPaperList);

    // --- Paper List ---

    async function loadPapers() {
        const res = await fetch("/api/papers");
        const papers = await res.json();
        papersTbody.innerHTML = "";
        papers.forEach((p) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="title-cell" title="${esc(p.title)}">${esc(p.title)}</td>
                <td>${esc(p.paper_id)}</td>
                <td>${esc(p.run_id)}</td>
                <td>${p.claims_count}</td>
                <td>${p.results_count}</td>
                <td><span class="badge badge-${p.review_status}">${p.review_status.replace("_", " ")}</span></td>
            `;
            tr.addEventListener("click", () => showReview(p.paper_id, p.run_id, p.title));
            papersTbody.appendChild(tr);
        });
    }

    // --- Review View ---

    async function loadReview() {
        const { paperId, runId } = currentPaper;
        const [resultsRes, reviewRes] = await Promise.all([
            fetch(`/api/papers/${paperId}/${runId}/results`),
            fetch(`/api/papers/${paperId}/${runId}/review`),
        ]);
        currentResults = await resultsRes.json();
        currentReview = reviewRes.ok ? await reviewRes.json() : { reviewer: "", status: "not_started", results: {} };

        reviewerInput.value = currentReview.reviewer || "";
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

            const claimsHtml = r.claims.map((c) => `
                <div class="claim-item">
                    <span class="claim-id">${esc(c.claim_id)}</span>
                    ${c.section ? `<span class="claim-section">${esc(c.section)}</span>` : ""}
                    <div>${esc(c.claim)}</div>
                </div>
            `).join("");

            card.innerHTML = `
                <div class="result-header">
                    <span class="result-id">${esc(r.result_id)}</span>
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

        const rid = btn.dataset.rid;
        const action = btn.dataset.action;
        if (!rid || !action) return;

        const rv = getOrCreateReview(rid);

        if (action === "agree" || action === "disagree") {
            rv.agreement = rv.agreement === action ? null : action;
            // Update button states
            const card = btn.closest(".result-card");
            card.querySelector(".btn-agree").classList.toggle("active-agree", rv.agreement === "agree");
            card.querySelector(".btn-disagree").classList.toggle("active-disagree", rv.agreement === "disagree");
            card.classList.toggle("reviewed", !!rv.agreement);

            // Show/hide overrides
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
        const ta = e.target;
        if (ta.tagName !== "TEXTAREA" || !ta.dataset.rid) return;
        const rv = getOrCreateReview(ta.dataset.rid);
        rv.comment = ta.value;
        scheduleSave(ta.dataset.rid);
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

    // --- Auto-save with debounce ---

    function scheduleSave(rid) {
        const ind = document.getElementById(`save-ind-${rid}`);
        if (ind) ind.textContent = "saving...";
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => doSave(rid), 600);
    }

    async function doSave(rid) {
        const { paperId, runId } = currentPaper;
        const payload = {
            reviewer: reviewerInput.value,
            status: currentReview.status || "in_progress",
            results: {},
        };
        // Send only the changed result
        if (rid && currentReview.results?.[rid]) {
            payload.results[rid] = currentReview.results[rid];
        }

        const res = await fetch(`/api/papers/${paperId}/${runId}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (res.ok) {
            const saved = await res.json();
            currentReview = saved;
            const ind = document.getElementById(`save-ind-${rid}`);
            if (ind) {
                ind.textContent = "saved";
                setTimeout(() => { ind.textContent = ""; }, 1500);
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
        currentReview.status = "complete";
        const { paperId, runId } = currentPaper;
        await fetch(`/api/papers/${paperId}/${runId}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                reviewer: reviewerInput.value,
                status: "complete",
                results: {},
            }),
        });
        markCompleteBtn.textContent = "Completed!";
        setTimeout(() => { markCompleteBtn.textContent = "Mark Complete"; }, 2000);
    });

    // --- Reviewer name save ---

    reviewerInput.addEventListener("change", () => {
        if (currentPaper) scheduleSave(null);
    });

    // --- Helpers ---

    function esc(s) {
        if (!s) return "";
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    // --- Init ---

    loadPapers();
})();
