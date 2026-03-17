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
    const paperPanel = $("#paper-panel");
    const paperTextContent = $("#paper-text-content");
    const panelCloseBtn = $("#panel-close-btn");

    let currentPaper = null;
    let currentResults = [];
    let currentReview = {};
    let saveTimer = null;
    let paperTextCache = {}; // paperId -> sections

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
        currentReview = reviewRes.ok ? await reviewRes.json() : { reviewer: "", status: "not_started", results: {}, claims: {} };

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
        const { paperId, runId } = currentPaper;
        const payload = {
            reviewer: reviewerInput.value,
            status: currentReview.status || "in_progress",
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
        currentReview.status = "complete";
        const { paperId, runId } = currentPaper;
        await fetch(`/api/papers/${paperId}/${runId}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                reviewer: reviewerInput.value,
                status: "complete",
                results: {},
                claims: {},
            }),
        });
        markCompleteBtn.textContent = "Completed!";
        setTimeout(() => { markCompleteBtn.textContent = "Mark Complete"; }, 2000);
    });

    // --- Reviewer name save ---

    reviewerInput.addEventListener("change", () => {
        if (currentPaper) scheduleSave(null);
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

    function esc(s) {
        if (!s) return "";
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function escAttr(s) {
        return esc(s).replace(/"/g, "&quot;");
    }

    // --- Init ---

    loadPapers();
})();
