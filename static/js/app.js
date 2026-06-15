// ==========================================================
// STATE MANAGEMENT & CONSTANTS
// ==========================================================
let currentFile = null;
let currentFilePath = null;
let activeTableName = null;
let activeQueryResults = null;
let activeQuerySql = null;
let myChart = null;

// ==========================================================
// INITIALIZATION
// ==========================================================
document.addEventListener("DOMContentLoaded", () => {
    initNavigation();
    initUploadDropzone();
    initCleaningControls();
    initQueryControls();
    initSchemaTab();
    initHistoryTab();
    checkApiStatus();
    refreshStagedTablesDropdown();
});

// ==========================================================
// UTILITIES: TOAST NOTIFICATIONS
// ==========================================================
function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    const toastMsg = document.getElementById("toast-msg");
    const toastIcon = document.getElementById("toast-icon");
    
    // Set message
    toastMsg.textContent = message;
    
    // Set classes and icons
    toast.className = "toast-notification active " + type;
    
    if (type === "success") {
        toastIcon.className = "fa-solid fa-circle-check";
    } else if (type === "danger") {
        toastIcon.className = "fa-solid fa-triangle-exclamation";
    } else {
        toastIcon.className = "fa-solid fa-circle-info";
    }
    
    // Auto hide after 3 seconds
    setTimeout(() => {
        toast.classList.remove("active");
    }, 3500);
}

// ==========================================================
// NAVIGATION SYSTEM
// ==========================================================
function initNavigation() {
    const navItems = document.querySelectorAll(".nav-item");
    const sections = document.querySelectorAll(".viewport-section");
    const sectionTitle = document.getElementById("section-title");
    const sectionSubtitle = document.getElementById("section-subtitle");
    
    const sectionMetadata = {
        "upload-section": {
            title: "Data Source Management",
            subtitle: "Upload CSV or Excel files to stage into the SQLite database engine."
        },
        "clean-section": {
            title: "Data Cleaning Pipeline",
            subtitle: "Filter, normalize, and impute your dataset before final staging."
        },
        "query-section": {
            title: "AI Analytics Query Lab",
            subtitle: "Translate natural language questions into database queries and plot insights."
        },
        "schema-section": {
            title: "SQLite Schema Explorer",
            subtitle: "Inspect physical tables, data types, and primary keys staged in SQLite."
        },
        "history-section": {
            title: "Audit History Logs",
            subtitle: "Review timeline details of uploads, cleanups, queries, and insights."
        }
    };

    navItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const targetSectionId = item.getAttribute("data-section");
            
            // Toggle active menu item
            navItems.forEach(n => n.classList.remove("active"));
            item.classList.add("active");
            
            // Toggle visible section
            sections.forEach(s => s.classList.remove("active"));
            const targetSection = document.getElementById(targetSectionId);
            if (targetSection) {
                targetSection.classList.add("active");
            }
            
            // Update Headers
            const meta = sectionMetadata[targetSectionId];
            if (meta) {
                sectionTitle.textContent = meta.title;
                sectionSubtitle.textContent = meta.subtitle;
            }

            // Special Tab Triggers
            if (targetSectionId === "schema-section") {
                loadSchemas();
            } else if (targetSectionId === "history-section") {
                loadHistory();
            }
        });
    });
}

// ==========================================================
// API CONFIG STATUS CHECK
// ==========================================================
function checkApiStatus() {
    const indicator = document.getElementById("gemini-status");
    const desc = document.getElementById("gemini-desc");
    
    fetch("/status")
        .then(r => r.json())
        .then(data => {
            if (data.gemini_active && data.gemini_valid) {
                indicator.className = "status-indicator connected";
                indicator.querySelector(".status-text").textContent = "GEMINI ACTIVE";
                desc.innerHTML = "Gemini API key is configured and responsive.";
            } else if (data.gemini_active && !data.gemini_valid) {
                indicator.className = "status-indicator error";
                indicator.querySelector(".status-text").textContent = "GEMINI KEY ERROR";
                desc.innerHTML = "Gemini API key is set, but backend validation failed. Check your GEMINI_API_KEY.";
            } else {
                indicator.className = "status-indicator fallback";
                indicator.querySelector(".status-text").textContent = "GEMINI INACTIVE";
                desc.innerHTML = "No Gemini API key configured. Set GEMINI_API_KEY to enable Gemini API features.";
            }
        })
        .catch(() => {
            indicator.className = "status-indicator fallback";
            indicator.querySelector(".status-text").textContent = "OFFLINE";
            desc.innerHTML = "Cannot connect to backend server. Verify Flask logs.";
        });
}

// ==========================================================
// GEMINI KEY HANDLER
// ==========================================================
// Gemini key input removed from UI; keep session endpoint available server-side.

// ==========================================================
// DATA SOURCE: FILE UPLOAD
// ==========================================================
function initUploadDropzone() {
    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("fileInput");
    
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    // Highlight drop zone when dragging over
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
    });
    
    // Handle dropped files
    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });
    
    // Handle file picker selection
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFileUpload(fileInput.files[0]);
        }
    });
}

function handleFileUpload(file) {
    // Validate extensions
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
        showToast("Invalid format. Please upload CSV or Excel spreadsheet.", "danger");
        return;
    }
    
    currentFile = file;
    currentFilePath = null;
    document.getElementById("tableNameInput").value = '';
    
    // Prepare UI elements
    const dropzone = document.getElementById("dropzone");
    const progressContainer = document.getElementById("upload-progress-container");
    const uploadBar = document.getElementById("upload-bar");
    const uploadPercent = document.getElementById("upload-percentage");
    const uploadFilename = document.getElementById("upload-filename");
    const uploadStatusText = document.getElementById("upload-status-text");
    const successCard = document.getElementById("upload-success-card");
    const previewCard = document.getElementById("upload-preview-card");
    
    dropzone.style.display = "none";
    successCard.style.display = "none";
    previewCard.style.display = "none";
    progressContainer.style.display = "block";
    
    uploadFilename.textContent = file.name;
    uploadStatusText.textContent = "Uploading file to pipeline...";
    uploadBar.style.width = "0%";
    uploadPercent.textContent = "0%";
    
    // Create Form Data
    const formData = new FormData();
    formData.append("file", file);
    
    // Setup AJAX Request with Progress tracking
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload", true);
    
    xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            uploadBar.style.width = percentComplete + "%";
            uploadPercent.textContent = percentComplete + "%";
            if (percentComplete === 100) {
                uploadStatusText.textContent = "File uploaded. Server processing and extracting schema metadata...";
            }
        }
    });
    
    xhr.addEventListener("load", () => {
        progressContainer.style.display = "none";
        if (xhr.status === 200) {
            try {
                const response = JSON.parse(xhr.responseText);
                currentFilePath = response.file_path || null;
                
                // Show success cards
                successCard.style.display = "flex";
                document.getElementById("success-filesize").textContent = formatBytes(file.size);
                document.getElementById("success-rows").textContent = response.summary.total_rows.toLocaleString();
                document.getElementById("success-cols").textContent = response.summary.total_columns;
                
                // Set suggested table name
                document.getElementById("tableNameInput").value = response.suggested_table;
                
                // Render column preview list
                renderMetaPreview(response.summary.columns);
                previewCard.style.display = "block";
                document.getElementById("fileInput").value = "";
                showToast("Data uploaded and parsed successfully!", "success");
            } catch (err) {
                resetUploadUI();
                showToast("Error reading server response.", "danger");
            }
        } else {
            resetUploadUI();
            try {
                const errRes = JSON.parse(xhr.responseText);
                showToast(errRes.error || "Upload failed.", "danger");
            } catch (e) {
                showToast("Upload failed due to connection error.", "danger");
            }
        }
    });
    
    xhr.addEventListener("error", () => {
        resetUploadUI();
        showToast("Upload failed due to connection issues.", "danger");
    });
    
    xhr.send(formData);
}

function resetUploadUI() {
    document.getElementById("dropzone").style.display = "block";
    document.getElementById("upload-progress-container").style.display = "none";
    document.getElementById("upload-success-card").style.display = "none";
    document.getElementById("upload-preview-card").style.display = "none";
    document.getElementById("fileInput").value = "";
    currentFile = null;
    currentFilePath = null;
}

function removeUploadedFile() {
    if (!currentFilePath) {
        showToast("No uploaded file to remove.", "danger");
        return;
    }

    fetch("/delete_upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: currentFilePath })
    })
    .then(response => response.json().then(data => ({ status: response.status, body: data })))
    .then(res => {
        if (res.status === 200) {
            resetUploadUI();
            showToast(res.body.message || "Uploaded file removed.", "success");
        } else {
            showToast(res.body.error || "Unable to remove uploaded file.", "danger");
        }
    })
    .catch(() => {
        showToast("Failed to remove uploaded file.", "danger");
    });
}

function renderMetaPreview(columns) {
    const tbody = document.querySelector("#preview-meta-table tbody");
    tbody.innerHTML = "";
    
    document.getElementById("preview-col-count").textContent = `${columns.length} Columns`;
    
    columns.forEach(col => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${col.column_name}</strong></td>
            <td><span class="badge primary">${col.data_type}</span></td>
            <td>${col.null_count.toLocaleString()}</td>
            <td>${col.null_percent}%</td>
            <td>${col.unique_values.toLocaleString()}</td>
            <td><code style="font-size:11px; color:var(--color-text-muted);">${col.sample_values.join(", ") || 'N/A'}</code></td>
        `;
        tbody.appendChild(tr);
    });
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ==========================================================
// CLEANING PIPELINE CONSOLE
// ==========================================================
function initCleaningControls() {
    const btnProceed = document.getElementById("btn-proceed-to-clean");
    const btnRunClean = document.getElementById("btn-run-cleaning");
    
    // Proceed button shifts section
    btnProceed.addEventListener("click", () => {
        const suggestedName = document.getElementById("tableNameInput").value.trim();
        if (!suggestedName) {
            showToast("Please specify a staging table name.", "danger");
            return;
        }
        
        // Switch section
        document.getElementById("nav-clean").click();
    });

    const btnRemoveUpload = document.getElementById("btn-remove-upload");
    if (btnRemoveUpload) {
        btnRemoveUpload.addEventListener("click", removeUploadedFile);
    }
    
    btnRunClean.addEventListener("click", () => {
        if (!currentFilePath) {
            showToast("No active uploaded file to clean. Please upload data first.", "danger");
            document.querySelector("[data-section='upload-section']").click();
            return;
        }
        
        const tableName = document.getElementById("tableNameInput").value.trim();
        if (!tableName) {
            showToast("Table name is required to stage data.", "danger");
            return;
        }
        
        btnRunClean.disabled = true;
        btnRunClean.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing & Staging...';
        
        // Grab values
        const operations = {
            trim_whitespace: document.getElementById("clean-trim").checked,
            convert_types: document.getElementById("clean-types").checked,
            remove_duplicates: document.getElementById("clean-dedup").checked,
            fill_missing: document.getElementById("clean-nulls").value
        };
        
        fetch("/clean", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                file_path: currentFilePath,
                table_name: tableName,
                operations: operations
            })
        })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(res => {
            btnRunClean.disabled = false;
            btnRunClean.innerHTML = '<i class="fa-solid fa-gears"></i> Execute Cleaning & Staging';
            
            if (res.status === 200) {
                showToast(res.body.message, "success");
                
                // Update active table details
                activeTableName = res.body.table_name;
                updateActiveTableBadge(activeTableName);
                
                // Hide placeholder, show success panel
                document.getElementById("clean-placeholder").style.display = "none";
                const successPanel = document.getElementById("clean-results-success");
                successPanel.style.display = "flex";
                
                document.getElementById("stage-res-table").textContent = activeTableName;
                document.getElementById("stage-res-rows").textContent = res.body.staging_info.row_count.toLocaleString();
                document.getElementById("stage-res-cols").textContent = res.body.summary.total_columns;
                
                // Reset upload cache
                currentFilePath = null;
                currentFile = null;
                document.getElementById("upload-success-card").style.display = "none";
                document.getElementById("upload-preview-card").style.display = "none";
                document.getElementById("dropzone").style.display = "block";
                
                // Refresh query structures
                refreshStagedTablesDropdown();
            } else {
                showToast(res.body.error || "Cleaning failed.", "danger");
            }
        })
        .catch(err => {
            btnRunClean.disabled = false;
            btnRunClean.innerHTML = '<i class="fa-solid fa-gears"></i> Execute Cleaning & Staging';
            showToast("Error executing cleaning script.", "danger");
        });
    });

    // Handle shift from clean results panel directly to Query tab
    document.getElementById("btn-clean-to-query").addEventListener("click", () => {
        document.getElementById("nav-query").click();
    });
}

// ==========================================================
// AI QUERY LAB & CHARTS
// ==========================================================
function refreshStagedTablesDropdown() {
    const select = document.getElementById("queryTableSelect");
    
    fetch("/schema")
        .then(r => r.json())
        .then(data => {
            select.innerHTML = "";
            const tables = Object.keys(data.tables || {});

            if (tables.length === 0) {
                select.innerHTML = '<option value="" disabled selected>No table staged</option>';
                updateActiveTableBadge(null);
                return;
            }
            
            tables.forEach(t => {
                const opt = document.createElement("option");
                opt.value = t;
                opt.textContent = t;
                if (t === activeTableName) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            });
            
            if (!activeTableName || !tables.includes(activeTableName)) {
                activeTableName = tables[0];
                select.value = activeTableName;
            }

            updateActiveTableBadge(activeTableName);
        });
}

function updateActiveTableBadge(tableName) {
    const badge = document.getElementById("active-table-badge");
    if (!badge) {
        return;
    }
    const nameElem = document.getElementById("active-table-name");
    const statusElem = document.getElementById("active-table-status");

    if (!tableName) {
        if (nameElem) nameElem.textContent = 'None';
        if (statusElem) statusElem.textContent = 'Inactive';
        badge.style.display = 'none';
        badge.classList.add('inactive-badge');
        return;
    }

    if (nameElem) nameElem.textContent = tableName;
    if (statusElem) statusElem.textContent = 'Active';
    badge.style.display = 'none';
    badge.classList.remove('inactive-badge');
}

function initQueryControls() {
    const btnExecute = document.getElementById("btn-execute-query");
    const suggestions = document.querySelectorAll(".suggestion-tag");
    const queryInput = document.getElementById("nlQueryInput");
    
    // Tabs setup
    const tabBtns = document.querySelectorAll(".tab-btn");
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            const tabId = btn.getAttribute("data-tab");
            const tabContents = document.querySelectorAll(".tab-content");
            tabContents.forEach(tc => tc.classList.remove("active"));
            document.getElementById(tabId).classList.add("active");
            
            // Re-render chart on tab select to fit container
            if (tabId === "tab-chart") {
                setTimeout(resizeChart, 100);
            }
        });
    });
    
    // Suggestion Tag injection
    suggestions.forEach(tag => {
        tag.addEventListener("click", () => {
            queryInput.value = tag.textContent;
            queryInput.focus();
        });
    });
    
    document.getElementById("queryTableSelect").addEventListener("change", (event) => {
        activeTableName = event.target.value;
        updateActiveTableBadge(activeTableName);
    });

    btnExecute.addEventListener("click", () => {
        const tableSelect = document.getElementById("queryTableSelect").value;
        const rawQuery = queryInput.value.trim();
        
        if (!tableSelect) {
            showToast("No active staged table selected. Please stage data first.", "danger");
            return;
        }
        
        if (!rawQuery) {
            showToast("Please enter a question to query.", "danger");
            return;
        }
        
        btnExecute.disabled = true;
        btnExecute.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running...';
        
        fetch("/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: rawQuery,
                table_name: tableSelect
            })
        })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(res => {
            btnExecute.disabled = false;
            btnExecute.innerHTML = '<i class="fa-solid fa-play"></i> Run Query';
            
            if (res.status === 200) {
                showToast("Query completed successfully!", "success");
                
                // Save state
                activeQueryResults = res.body.results;
                activeQuerySql = res.body.generated_sql;
                
                // Hide placeholder, show results panel
                document.getElementById("query-results-placeholder").style.display = "none";
                document.getElementById("query-results-panel").style.display = "block";
                
                // Reset active tab to Data Grid
                document.querySelector("[data-tab='tab-table']").click();
                
                // Render Data Table
                renderResultsGrid(res.body.columns, res.body.results);
                
                // Show SQL
                document.getElementById("sql-display-code").textContent = res.body.generated_sql;
                
                // Setup Chart Axes Options
                setupChartOptions(res.body.columns);
                
                // Auto trigger strategic insights loading
                loadStrategicInsights();
                
            } else {
                showToast(res.body.error || "Failed to parse query.", "danger");
                if (res.body.generated_sql) {
                    document.getElementById("query-results-placeholder").style.display = "none";
                    document.getElementById("query-results-panel").style.display = "block";
                    document.querySelector("[data-tab='tab-sql']").click();
                    document.getElementById("sql-display-code").textContent = res.body.generated_sql;
                }
            }
        })
        .catch(err => {
            btnExecute.disabled = false;
            btnExecute.innerHTML = '<i class="fa-solid fa-play"></i> Run Query';
            showToast("Network execution failed.", "danger");
        });
    });

    // CSV Exporter
    document.getElementById("btn-export-csv").addEventListener("click", () => {
        if (!activeQueryResults || activeQueryResults.length === 0) return;
        exportToCSV(activeQueryResults);
    });

    // Chart Configuration triggers
    document.getElementById("btn-update-chart").addEventListener("click", buildAnalyticalChart);
}

function renderResultsGrid(columns, results) {
    const table = document.getElementById("query-results-table");
    const theadTr = table.querySelector("thead tr");
    const tbody = table.querySelector("tbody");
    
    theadTr.innerHTML = "";
    tbody.innerHTML = "";
    
    document.getElementById("results-count-text").textContent = `${results.length} records returned`;
    
    if (results.length === 0) {
        theadTr.innerHTML = "<th>No Results</th>";
        tbody.innerHTML = "<tr><td>Query ran successfully but returned 0 matches. Try loosening filter criteria.</td></tr>";
        return;
    }
    
    // Headers
    columns.forEach(col => {
        const th = document.createElement("th");
        th.textContent = col;
        theadTr.appendChild(th);
    });
    
    // Rows
    results.forEach(row => {
        const tr = document.createElement("tr");
        columns.forEach(col => {
            const td = document.createElement("td");
            const val = row[col];
            td.textContent = val !== null ? val : 'NULL';
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function setupChartOptions(columns) {
    const xSelect = document.getElementById("chartXSelect");
    const ySelect = document.getElementById("chartYSelect");
    
    xSelect.innerHTML = "";
    ySelect.innerHTML = "";
    
    columns.forEach(col => {
        const optX = document.createElement("option");
        optX.value = col;
        optX.textContent = col;
        xSelect.appendChild(optX);
        
        const optY = document.createElement("option");
        optY.value = col;
        optY.textContent = col;
        ySelect.appendChild(optY);
    });
    
    // Choose sensible defaults:
    // Categorical / First column for X, Numeric for Y if possible
    if (columns.length >= 2) {
        xSelect.selectedIndex = 0;
        ySelect.selectedIndex = 1;
        
        // Look for standard numeric cols to pre-select for Y axis
        if (activeQueryResults && activeQueryResults.length > 0) {
            const first = activeQueryResults[0];
            for (let i = 0; i < columns.length; i++) {
                const val = first[columns[i]];
                if (typeof val === 'number') {
                    ySelect.selectedIndex = i;
                    break;
                }
            }
        }
    }
    
    // Build initial chart
    buildAnalyticalChart();
}

function buildAnalyticalChart() {
    const xCol = document.getElementById("chartXSelect").value;
    const yCol = document.getElementById("chartYSelect").value;
    const chartType = document.getElementById("chartTypeSelect").value;
    
    if (!activeQueryResults || activeQueryResults.length === 0 || !xCol || !yCol) return;
    
    const ctx = document.getElementById("analyticsChart").getContext("2d");
    
    // Extract labels and values
    const labels = activeQueryResults.map(r => String(r[xCol]));
    const data = activeQueryResults.map(r => {
        const val = parseFloat(r[yCol]);
        return isNaN(val) ? 0 : val;
    });
    
    // Destroy old instance
    if (myChart) {
        myChart.destroy();
    }
    
    // Color schemes
    const chartThemeColors = {
        cyan: 'rgba(0, 242, 254, 0.7)',
        cyanBorder: '#00f2fe',
        blue: 'rgba(79, 172, 254, 0.7)',
        blueBorder: '#4facfe',
        multi: [
            'rgba(0, 242, 254, 0.7)',
            'rgba(79, 172, 254, 0.7)',
            'rgba(16, 185, 129, 0.7)',
            'rgba(245, 158, 11, 0.7)',
            'rgba(239, 68, 68, 0.7)',
            'rgba(139, 92, 246, 0.7)'
        ],
        multiBorders: [
            '#00f2fe', '#4facfe', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'
        ]
    };
    
    let bgColors = chartThemeColors.blue;
    let borderColors = chartThemeColors.blueBorder;
    
    if (chartType === 'pie') {
        bgColors = chartThemeColors.multi;
        borderColors = chartThemeColors.multiBorders;
    }
    
    myChart = new Chart(ctx, {
        type: chartType,
        data: {
            labels: labels,
            datasets: [{
                label: yCol.replace('_', ' ').toUpperCase(),
                data: data,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: chartType === 'bar' ? 4 : 0,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#94a3b8', font: { family: 'Inter' } }
                }
            },
            scales: chartType !== 'pie' ? {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
                }
            } : {}
        }
    });
}

function resizeChart() {
    if (myChart) {
        myChart.resize();
    }
}

function loadStrategicInsights() {
    const list = document.getElementById("insights-bullets-list");
    const loader = document.getElementById("insights-loading");
    
    list.innerHTML = "";
    loader.style.display = "flex";
    
    fetch("/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sql_query: activeQuerySql,
            results: activeQueryResults
        })
    })
    .then(r => r.json())
    .then(data => {
        loader.style.display = "none";
        
        if (data.error) {
            const li = document.createElement("li");
            li.textContent = "AI insights could not be compiled. Local rule backup active.";
            list.appendChild(li);
            return;
        }
        
        const bullets = data.insights || [];
        if (bullets.length === 0) {
            list.innerHTML = "<li>No specific patterns observed in this slice of data.</li>";
            return;
        }
        
        bullets.forEach((bullet, index) => {
            const li = document.createElement("li");
            li.style.animation = `fadeIn 0.4s ease forwards ${index * 0.1}s`;
            li.style.opacity = 0; // Fade in on sequence
            li.innerHTML = bullet.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            list.appendChild(li);
        });
    })
    .catch(() => {
        loader.style.display = "none";
        list.innerHTML = "<li>Insights engine timed out. Please check local connectivity.</li>";
    });
}

function exportToCSV(rows) {
    if (rows.length === 0) return;
    
    const headers = Object.keys(rows[0]);
    const csvContent = [
        headers.join(','), // Headers line
        ...rows.map(row => 
            headers.map(h => {
                let cell = row[h] !== null ? String(row[h]) : '';
                // Escape quotes
                cell = cell.replace(/"/g, '""');
                // Wrap in quotes if contains comma
                if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
                    cell = `"${cell}"`;
                }
                return cell;
            }).join(',')
        )
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `analysis_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Dataset exported as CSV successfully!", "success");
}

// ==========================================================
// SQL SCHEMA INSPECTOR
// ==========================================================
function initSchemaTab() {
    document.getElementById("btn-refresh-schema").addEventListener("click", loadSchemas);
}

function loadSchemas() {
    const container = document.getElementById("schema-grid-container");
    const emptyState = document.getElementById("schema-empty");
    
    container.innerHTML = "";
    emptyState.style.display = "none";
    
    fetch("/schema")
        .then(r => r.json())
        .then(data => {
            const tables = data.tables || {};
            const keys = Object.keys(tables);
            
            if (keys.length === 0) {
                emptyState.style.display = "flex";
                return;
            }
            
            keys.forEach(table => {
                const columns = tables[table];
                
                const card = document.createElement("div");
                card.className = "schema-table-card";
                
                let colsHTML = "";
                columns.forEach(col => {
                    const pkIcon = col.primary_key ? '<i class="fa-solid fa-key" title="Primary Key"></i> ' : '';
                    colsHTML += `
                        <div class="schema-col-item">
                            <span class="schema-col-name">${pkIcon}${col.name}</span>
                            <span class="schema-col-type">${col.type.toUpperCase()}</span>
                        </div>
                    `;
                });
                
                card.innerHTML = `
                    <div class="schema-table-header">
                        <h4><i class="fa-solid fa-table"></i> ${table}</h4>
                        <span class="badge">${columns.length} columns</span>
                    </div>
                    <div class="schema-cols-list">
                        ${colsHTML}
                    </div>
                `;
                container.appendChild(card);
            });
        })
        .catch(() => {
            emptyState.style.display = "flex";
        });
}

// ==========================================================
// AUDIT TIMELINE HISTORY
// ==========================================================
function initHistoryTab() {
    document.getElementById("btn-clear-history").addEventListener("click", () => {
        if (!confirm("Are you sure you want to delete all audit execution records? This cannot be undone.")) return;
        
        fetch("/clear_history", { method: "POST" })
            .then(r => r.json())
            .then(data => {
                showToast(data.message || "History cleared.", "success");
                loadHistory();
            });
    });
}

function loadHistory() {
    const timeline = document.getElementById("history-timeline-list");
    timeline.innerHTML = '<li style="color:var(--color-text-muted); font-size: 13px;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching audit records...</li>';
    
    fetch("/history")
        .then(r => r.json())
        .then(data => {
            timeline.innerHTML = "";
            const history = data.history || [];
            
            // Filter out any audit entries referencing the example/internal table
            const historyFiltered = history.filter(item => {
                try {
                    const d = item.details || {};
                    if (d.table_name === 'orders_test' || d.table_name === 'test_orders') return false;
                    if (typeof d.sql_query === 'string' && (d.sql_query.includes('orders_test') || d.sql_query.includes('test_orders'))) return false;
                } catch (e) {}
                return true;
            });

            if (historyFiltered.length === 0) {
                timeline.innerHTML = '<li style="color:var(--color-text-dim); font-size:12px; padding:20px 0; text-align:center;">Timeline log is clear. Staged table records will register here.</li>';
                return;
            }
            
            historyFiltered.forEach(item => {
                const li = document.createElement("li");
                
                // Map class type based on action
                let actClass = "query";
                let actionIcon = '<i class="fa-solid fa-terminal"></i>';
                let detailsHTML = "";
                
                const formattedTime = new Date(item.timestamp).toLocaleString();
                
                if (item.action === "Upload") {
                    actClass = "upload";
                    actionIcon = '<i class="fa-solid fa-cloud-arrow-up"></i>';
                    detailsHTML = `<p>Uploaded <strong>${item.details.filename}</strong> containing <strong>${item.details.rows.toLocaleString()} rows</strong> and <strong>${item.details.columns_count} columns</strong>.</p>`;
                } else if (item.action === "Clean & Stage") {
                    actClass = "clean";
                    actionIcon = '<i class="fa-solid fa-broom"></i>';
                    detailsHTML = `<p>Cleaned and staged table <code>${item.details.table_name}</code> (<strong>${item.details.rows.toLocaleString()} clean rows</strong>).<br>Enabled operations: <span style="color:var(--color-text-main)">${item.details.operations.join(", ") || 'None'}</span></p>`;
                } else if (item.action === "NL Query") {
                    actClass = "query";
                    actionIcon = '<i class="fa-solid fa-terminal"></i>';
                    detailsHTML = `
                        <p style="margin-bottom: 6px;">Question: <em style="color:#ffffff">"${item.details.nl_query}"</em> on table <code>${item.details.table_name}</code></p>
                        <div style="font-family:monospace; background:rgba(0,0,0,0.2); padding:6px; border-radius:4px; font-size:11px; overflow-x:auto;">
                            <code style="color:var(--accent-primary)">${item.details.sql_query}</code>
                        </div>
                        <p style="font-size:11px; color:var(--color-text-dim); margin-top:4px;">Returned ${item.details.rows_returned} record(s).</p>
                    `;
                } else if (item.action === "Generate Insights") {
                    actClass = "insights";
                    actionIcon = '<i class="fa-solid fa-brain"></i>';
                    detailsHTML = `<p>Compiled <strong>${item.details.insights_count} intelligence summaries</strong> for query: <br><code style="font-size:11px; word-break: break-all;">${item.details.sql_query}</code></p>`;
                }
                
                li.className = `history-item ${actClass}`;
                li.innerHTML = `
                    <span class="history-marker"></span>
                    <div class="history-content">
                        <div class="history-item-header">
                            <span class="history-action-title">${actionIcon} &nbsp; ${item.action}</span>
                            <span class="history-time">${formattedTime}</span>
                        </div>
                        <div class="history-details">
                            ${detailsHTML}
                        </div>
                    </div>
                `;
                timeline.appendChild(li);
            });
        })
        .catch(() => {
            timeline.innerHTML = '<li style="color:var(--accent-danger);">Failed to retrieve audit log from server.</li>';
        });
}
