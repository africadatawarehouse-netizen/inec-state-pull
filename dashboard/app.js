const LOGO_URL = "/assets/africa-data-warehouse-logo.png";
const MAP_URL = "/assets/maps/state_lga_boundaries.geojson";
const STATES = {
  FCT: {
    label: "FCT",
    title: "FCT Area Council Election Results",
    dataUrl: "/output/FCT/pu_results.csv",
    excelUrl: "/output/FCT/results.xlsx",
    csvUrl: "/output/FCT/pu_results.csv",
    cardSubtitle: "FCT Area Council Election Results",
  },
  Ekiti: {
    label: "Ekiti",
    title: "Ekiti Governorship Election Results",
    dataUrl: "/output/Ekiti/pu_results.csv",
    excelUrl: "/output/Ekiti/results.xlsx",
    csvUrl: "/output/Ekiti/pu_results.csv",
    cardSubtitle: "Ekiti Governorship Election Results",
  },
  Osun: {
    label: "Osun",
    title: "Osun Governorship Election Results",
    dataUrl: "/output/Osun/pu_results.csv",
    excelUrl: "/output/Osun/results.xlsx",
    csvUrl: "/output/Osun/pu_results.csv",
    cardSubtitle: "Osun Governorship Election Results",
  },
};

const metaColumns = new Set([
  "State",
  "LGA",
  "Election ID",
  "Election Name",
  "Election Date",
  "Ward",
  "Ward Code",
  "Ward ID",
  "Polling Unit",
  "PU Code",
  "PU ID",
  "Polling Unit ID",
  "Result Updated Time",
  "Session",
  "Ballots Issued",
  "Ballots Used",
  "Invalid Votes",
  "Result Info PU",
  "Total Accredited",
  "Total Registered",
  "Valid Votes",
  "Image File",
  "Image URL",
]);

const state = {
  selectedState: "FCT",
  rows: [],
  partyColumns: [],
  logo: null,
  mapData: null,
};

const els = {
  pageTitle: document.querySelector("#pageTitle"),
  stateSelect: document.querySelector("#stateSelect"),
  excelDownload: document.querySelector("#excelDownload"),
  csvDownload: document.querySelector("#csvDownload"),
  lgaSelect: document.querySelector("#lgaSelect"),
  wardSelect: document.querySelector("#wardSelect"),
  puSelect: document.querySelector("#puSelect"),
  registeredTotal: document.querySelector("#registeredTotal"),
  accreditedTotal: document.querySelector("#accreditedTotal"),
  validTotal: document.querySelector("#validTotal"),
  puTotal: document.querySelector("#puTotal"),
  uploadProgressText: document.querySelector("#uploadProgressText"),
  uploadProgressFill: document.querySelector("#uploadProgressFill"),
  totalPuCount: document.querySelector("#totalPuCount"),
  uploadedPuCount: document.querySelector("#uploadedPuCount"),
  uploadedPuPercent: document.querySelector("#uploadedPuPercent"),
  scopeTitle: document.querySelector("#scopeTitle"),
  scopeSubtitle: document.querySelector("#scopeSubtitle"),
  partyChart: document.querySelector("#partyChart"),
  partyList: document.querySelector("#partyList"),
  winnerText: document.querySelector("#winnerText"),
  lgaMap: document.querySelector("#lgaMap"),
  mapLegend: document.querySelector("#mapLegend"),
  mapStatus: document.querySelector("#mapStatus"),
  lgaTable: document.querySelector("#lgaTable"),
  lgaCount: document.querySelector("#lgaCount"),
  puDetail: document.querySelector("#puDetail"),
  documentStatus: document.querySelector("#documentStatus"),
  viewCardBtn: document.querySelector("#viewCardBtn"),
  viewNumberCardBtn: document.querySelector("#viewNumberCardBtn"),
  cardCanvas: document.querySelector("#cardCanvas"),
  numberCardCanvas: document.querySelector("#numberCardCanvas"),
  cardPreviewModal: document.querySelector("#cardPreviewModal"),
  cardPreviewTitle: document.querySelector("#cardPreviewTitle"),
  cardPreviewImage: document.querySelector("#cardPreviewImage"),
  closeCardPreviewBtn: document.querySelector("#closeCardPreviewBtn"),
  downloadPreviewCardBtn: document.querySelector("#downloadPreviewCardBtn"),
  loginPromptModal: document.querySelector("#loginPromptModal"),
  closeLoginPromptBtn: document.querySelector("#closeLoginPromptBtn"),
};

let previewCardType = "number";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);

  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function stateFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const candidate = parts[1] || "FCT";
  const match = Object.keys(STATES).find((key) => key.toLowerCase() === candidate.toLowerCase());
  return match || "FCT";
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value) {
  return Math.round(num(value)).toLocaleString();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function getFilteredRows() {
  const lga = els.lgaSelect.value;
  const ward = els.wardSelect.value;
  const pu = els.puSelect.value;
  return state.rows.filter((row) => {
    if (lga !== "All" && row.LGA !== lga) return false;
    if (ward !== "All" && row.Ward !== ward) return false;
    if (pu !== "All" && row["PU Code"] !== pu) return false;
    return true;
  });
}

function aggregate(rows) {
  const totals = {
    registered: 0,
    accredited: 0,
    valid: 0,
    invalid: 0,
    issued: 0,
    used: 0,
    parties: {},
  };

  rows.forEach((row) => {
    totals.registered += num(row["Total Registered"]);
    totals.accredited += num(row["Total Accredited"]);
    totals.valid += num(row["Valid Votes"]);
    totals.invalid += num(row["Invalid Votes"]);
    totals.issued += num(row["Ballots Issued"]);
    totals.used += num(row["Ballots Used"]);
    state.partyColumns.forEach((party) => {
      totals.parties[party] = (totals.parties[party] || 0) + num(row[party]);
    });
  });

  return totals;
}

function sortedParties(totals) {
  return Object.entries(totals.parties)
    .map(([party, votes]) => ({ party, votes }))
    .filter((item) => item.votes > 0)
    .sort((a, b) => b.votes - a.votes || a.party.localeCompare(b.party));
}

function hasUploadedResult(row) {
  const fields = ["Image URL", "Image File", "Result Updated Time", "Result Info PU"];
  return fields.some((field) => {
    const value = String(row[field] || "").trim().toLowerCase();
    return value && value !== "nan" && value !== "none" && value !== "null";
  });
}

function renderUploadProgress(rows) {
  const total = rows.length;
  const uploaded = rows.filter(hasUploadedResult).length;
  const uploadedPercent = total ? (uploaded / total) * 100 : 0;
  els.uploadProgressText.textContent = `${uploaded.toLocaleString()} of ${total.toLocaleString()} uploaded`;
  els.uploadProgressFill.style.width = `${Math.min(uploadedPercent, 100).toFixed(2)}%`;
  els.totalPuCount.textContent = total.toLocaleString();
  els.uploadedPuCount.textContent = uploaded.toLocaleString();
  els.uploadedPuPercent.textContent = `${uploadedPercent.toFixed(1)}%`;
}

function fillSelect(select, values, current = "All") {
  select.innerHTML = "";
  ["All", ...values].forEach((value) => {
    const optionValue = typeof value === "object" ? value.value : value;
    const optionLabel = typeof value === "object" ? value.label : value;
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue === "All" ? "All" : optionLabel;
    select.appendChild(option);
  });
  const availableValues = values.map((value) => (typeof value === "object" ? value.value : value));
  select.value = availableValues.includes(current) ? current : "All";
}

function fillStateSelect(current) {
  els.stateSelect.innerHTML = "";
  Object.entries(STATES).forEach(([key, config]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = config.label;
    els.stateSelect.appendChild(option);
  });
  els.stateSelect.value = current;
}

function refreshFilters(changed) {
  const lga = els.lgaSelect.value || "All";
  const ward = els.wardSelect.value || "All";
  const wardRows = lga === "All" ? state.rows : state.rows.filter((row) => row.LGA === lga);

  if (changed !== "ward" && changed !== "pu") {
    fillSelect(els.wardSelect, unique(wardRows.map((row) => row.Ward)), ward);
  }

  const selectedWard = els.wardSelect.value || "All";
  const puRows = wardRows.filter((row) => selectedWard === "All" || row.Ward === selectedWard);
  const puNameCounts = puRows.reduce((counts, row) => {
    const name = row["Polling Unit"] || row["PU Code"] || "Unnamed Polling Unit";
    counts[name] = (counts[name] || 0) + 1;
    return counts;
  }, {});
  const puOptions = unique(puRows.map((row) => row["PU Code"])).map((code) => {
    const found = puRows.find((row) => row["PU Code"] === code) || {};
    const name = found["Polling Unit"] || code;
    return {
      value: code,
      label: puNameCounts[name] > 1 ? `${name} (${code})` : name,
    };
  });
  fillSelect(
    els.puSelect,
    puOptions,
    els.puSelect.value,
  );
}

function syncPuSelects(value) {
  els.puSelect.value = value;
  document.querySelectorAll("[data-detail-pu-select]").forEach((select) => {
    select.value = value;
  });
}

function selectedPuRow() {
  const pu = els.puSelect.value;
  if (pu === "All") return null;
  return state.rows.find((row) => row["PU Code"] === pu) || null;
}

function renderSummary(rows) {
  const totals = aggregate(rows);
  els.registeredTotal.textContent = fmt(totals.registered);
  els.accreditedTotal.textContent = fmt(totals.accredited);
  els.validTotal.textContent = fmt(totals.valid);
  els.puTotal.textContent = rows.length.toLocaleString();

  const parts = [];
  if (els.lgaSelect.value !== "All") parts.push(els.lgaSelect.value);
  if (els.wardSelect.value !== "All") parts.push(els.wardSelect.value);
  if (els.puSelect.value !== "All") parts.push(els.puSelect.selectedOptions[0]?.textContent || els.puSelect.value);
  els.scopeTitle.textContent = parts.length ? parts.join(" / ") : "FCT Results";
  if (!parts.length) els.scopeTitle.textContent = `${state.selectedState} Results`;
  els.scopeSubtitle.textContent = `${rows.length.toLocaleString()} polling unit record${rows.length === 1 ? "" : "s"}`;
  return totals;
}

function renderPartyList(totals) {
  const parties = sortedParties(totals);
  const maxVotes = Math.max(...parties.map((item) => item.votes), 1);
  els.winnerText.textContent = parties[0] ? `${parties[0].party} leads with ${fmt(parties[0].votes)}` : "";
  els.partyList.innerHTML = parties
    .map((item, index) => {
      const colors = ["#27b9d3", "#1f7a4d", "#d89720", "#b7433f"];
      const width = (item.votes / maxVotes) * 100;
      return `
        <div class="party-row">
          <div class="party-code">${item.party}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${colors[index % colors.length]}"></div></div>
          <div class="party-votes">${fmt(item.votes)}</div>
        </div>
      `;
    })
    .join("");
}

function renderChart(totals) {
  const canvas = els.partyChart;
  const ctx = canvas.getContext("2d");
  const parties = sortedParties(totals).slice(0, 8);
  const dpr = window.devicePixelRatio || 1;
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.max(900, Math.floor(box.width * dpr));
  canvas.height = Math.max(420, Math.floor(box.height * dpr));
  ctx.scale(dpr, dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const left = 64;
  const right = 26;
  const bottom = 60;
  const top = 26;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxVotes = Math.max(...parties.map((item) => item.votes), 1);
  const colors = ["#27b9d3", "#1f7a4d", "#d89720", "#b7433f", "#476a6f", "#7d5a38", "#5863a3", "#8d4776"];
  const barWidth = chartWidth / Math.max(parties.length, 1) - 14;

  ctx.strokeStyle = "#d9e1e3";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, top + chartHeight);
  ctx.lineTo(left + chartWidth, top + chartHeight);
  ctx.stroke();

  parties.forEach((item, index) => {
    const barHeight = (item.votes / maxVotes) * (chartHeight - 20);
    const x = left + index * (chartWidth / parties.length) + 8;
    const y = top + chartHeight - barHeight;
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#182022";
    ctx.font = "700 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(item.party, x + barWidth / 2, top + chartHeight + 24);
    ctx.fillStyle = "#647174";
    ctx.font = "12px system-ui";
    ctx.fillText(fmt(item.votes), x + barWidth / 2, Math.max(y - 8, 14));
  });
}

function renderLgaTable() {
  const grouped = new Map();
  state.rows.forEach((row) => {
    const key = row.LGA || "Unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  const rows = [...grouped.entries()].map(([lga, items]) => {
    const totals = aggregate(items);
    const leader = sortedParties(totals)[0];
    return { lga, items, totals, leader };
  });
  rows.sort((a, b) => a.lga.localeCompare(b.lga));
  els.lgaCount.textContent = `${rows.length} LGA${rows.length === 1 ? "" : "s"}`;
  els.lgaTable.innerHTML = `
    <table>
      <thead><tr><th>LGA</th><th>PU</th><th>Accredited</th><th>Valid</th><th>Leader</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${row.lga}</td>
                <td>${row.items.length.toLocaleString()}</td>
                <td>${fmt(row.totals.accredited)}</td>
                <td>${fmt(row.totals.valid)}</td>
                <td>${row.leader ? `${row.leader.party} ${fmt(row.leader.votes)}` : ""}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPuDetail(rows) {
  const pu = selectedPuRow();
  if (!pu) {
    els.documentStatus.textContent = "Select a polling unit to view details";
    const detailOptions = els.puSelect.innerHTML;
    els.puDetail.innerHTML = `
      <div class="detail-empty">
        <strong>Select a polling unit</strong>
        <p>Choose a specific PU here to show the result sheet, vote metadata, and PU-level details.</p>
        <label class="detail-select-label">
          Polling Unit
          <select data-detail-pu-select>${detailOptions}</select>
        </label>
      </div>
    `;
    const detailSelect = els.puDetail.querySelector("[data-detail-pu-select]");
    detailSelect.value = els.puSelect.value;
    detailSelect.addEventListener("change", () => {
      syncPuSelects(detailSelect.value);
      render();
    });
    return;
  }
  const row = pu;
  const imageFile = row["Image File"] || "";
  const externalImage = row["Image URL"] || "";
  const localImage = imageFile ? `/downloads/${imageFile.replaceAll("\\", "/")}` : "";
  const imageHref = externalImage || localImage;
  els.documentStatus.textContent = imageHref ? "Result sheet available" : "No result-sheet file recorded";
  const items = [
    ["Polling Unit", row["Polling Unit"] || ""],
    ["PU Code", row["PU Code"] || ""],
    ["Ward", row.Ward || ""],
    ["LGA", row.LGA || ""],
    ["Ballots Issued", fmt(row["Ballots Issued"])],
    ["Ballots Used", fmt(row["Ballots Used"])],
    ["Invalid Votes", fmt(row["Invalid Votes"])],
    ["Updated Time", row["Result Updated Time"] || ""],
  ];

  els.puDetail.innerHTML = items
    .map((item) => `<div class="detail-item"><span>${item[0]}</span><strong>${item[1]}</strong></div>`)
    .join("");

  if (imageHref) {
    els.puDetail.insertAdjacentHTML(
      "beforeend",
      `<div class="detail-item"><span>Result Sheet</span><a href="${imageHref}" target="_blank" rel="noreferrer">Open file</a></div>`,
    );
  }
}

function percent(part, whole) {
  if (!whole) return "0.0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function getScopeDetails(rows) {
  const selectedPu = selectedPuRow();
  if (selectedPu) {
    return {
      level: "Polling Unit",
      title: selectedPu["Polling Unit"] || selectedPu["PU Code"] || "Polling Unit",
      subtitle: `${selectedPu.LGA || state.selectedState} / ${selectedPu.Ward || ""} / ${selectedPu["PU Code"] || ""}`,
    };
  }
  if (els.wardSelect.value !== "All") {
    return {
      level: "Ward",
      title: els.wardSelect.value,
      subtitle: `${els.lgaSelect.value} LGA, ${state.selectedState}`,
    };
  }
  if (els.lgaSelect.value !== "All") {
    return {
      level: "LGA",
      title: `${els.lgaSelect.value} LGA`,
      subtitle: `${state.selectedState} ${STATES[state.selectedState].cardSubtitle}`,
    };
  }
  return {
    level: "State",
    title: `${state.selectedState} State`,
    subtitle: STATES[state.selectedState].cardSubtitle,
  };
}

function partyColor(code, index = 0) {
  const colors = {
    APC: "#14924a",
    PDP: "#d62f35",
    LP: "#c41230",
    ADC: "#254aa5",
    SDP: "#1f7a4d",
    APGA: "#f0b323",
    NNPP: "#2f80ed",
    ADP: "#7b4fc9",
  };
  const fallback = ["#27b9d3", "#1f7a4d", "#d89720", "#b7433f", "#5863a3", "#8d4776"];
  return colors[code] || fallback[index % fallback.length];
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replaceAll("&", "AND")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function featureCoordinates(feature) {
  const coords = feature.geometry.coordinates;
  return feature.geometry.type === "Polygon" ? [coords] : coords;
}

function collectPoints(feature) {
  return featureCoordinates(feature).flat(2);
}

function pathForFeature(feature, project) {
  return featureCoordinates(feature)
    .map((polygon) =>
      polygon
        .map((ring) =>
          ring
            .map((point, index) => {
              const [x, y] = project(point);
              return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ") + " Z",
        )
        .join(" "),
    )
    .join(" ");
}

function centroidForFeature(feature, project) {
  const points = collectPoints(feature).map(project);
  const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return points.length ? [sum[0] / points.length, sum[1] / points.length] : [0, 0];
}

function renderMap() {
  const features = (state.mapData?.features || []).filter((feature) => feature.properties.state === state.selectedState);
  if (!features.length) {
    els.lgaMap.innerHTML = "";
    els.mapLegend.innerHTML = "";
    els.mapStatus.textContent = "No boundary file loaded";
    return;
  }

  const grouped = new Map();
  state.rows.forEach((row) => {
    const key = normalizeName(row.LGA);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const stats = new Map();
  grouped.forEach((items, key) => {
    const totals = aggregate(items);
    const leader = sortedParties(totals)[0] || { party: "No data", votes: 0 };
    const uploaded = items.filter(hasUploadedResult).length;
    stats.set(key, { items, totals, leader, uploaded });
  });

  const points = features.flatMap(collectPoints);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = 900;
  const height = 520;
  const pad = 24;
  const scale = Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const project = ([x, y]) => [offsetX + (x - minX) * scale, height - offsetY - (y - minY) * scale];

  const selectedLga = normalizeName(els.lgaSelect.value);
  const paths = features
    .map((feature, index) => {
      const lga = feature.properties.lga;
      const key = normalizeName(lga);
      const item = stats.get(key);
      const color = item?.leader?.party ? partyColor(item.leader.party, index) : "#dfe8ea";
      const selected = selectedLga !== "ALL" && selectedLga === key;
      const [cx, cy] = centroidForFeature(feature, project);
      const label = lga.length > 14 ? lga.replace(/\s+/g, "\n") : lga;
      return `
        <path class="${selected ? "is-selected" : ""}" d="${pathForFeature(feature, project)}" fill="${color}" opacity="${item ? "0.82" : "0.42"}" data-lga="${lga}">
          <title>${lga}${item ? `: ${item.leader.party} leads with ${fmt(item.leader.votes)} votes` : ": no data yet"}</title>
        </path>
        <text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle">${label}</text>
      `;
    })
    .join("");

  els.lgaMap.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${state.selectedState} LGA map">${paths}</svg>`;
  els.lgaMap.querySelectorAll("path[data-lga]").forEach((path) => {
    path.addEventListener("click", () => {
      const lga = path.getAttribute("data-lga");
      if ([...els.lgaSelect.options].some((option) => normalizeName(option.value) === normalizeName(lga))) {
        els.lgaSelect.value = [...els.lgaSelect.options].find((option) => normalizeName(option.value) === normalizeName(lga)).value;
        els.wardSelect.value = "All";
        els.puSelect.value = "All";
        render();
      }
    });
  });

  const legendItems = [...stats.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, item], index) => {
      const lga = item.items[0]?.LGA || key;
      const percentUploaded = item.items.length ? (item.uploaded / item.items.length) * 100 : 0;
      return `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${partyColor(item.leader.party, index)}"></span>
          <strong>${lga}</strong>
          <span>${item.leader.party} · ${percentUploaded.toFixed(0)}%</span>
        </div>
      `;
    })
    .join("");
  els.mapLegend.innerHTML = `${legendItems || `<div class="legend-item"><span class="legend-swatch"></span><strong>No results yet</strong><span>0%</span></div>`}<p class="map-source">Boundaries: geoBoundaries / GRID3, CC BY 4.0</p>`;
  els.mapStatus.textContent = selectedLga === "ALL" ? "Click an LGA to drill down" : `${els.lgaSelect.value} selected`;
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((item, index) => {
    const suffix = index === maxLines - 1 && lines.length > maxLines ? "..." : "";
    ctx.fillText(`${item}${suffix}`, x, y + index * lineHeight);
  });
}

function drawCard(rows, totals) {
  const canvas = els.cardCanvas;
  const ctx = canvas.getContext("2d");
  canvas.width = 1200;
  canvas.height = 675;
  const parties = sortedParties(totals).slice(0, 5);
  const title = els.scopeTitle.textContent;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f7faf9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#182022";
  ctx.fillRect(0, 0, 1200, 112);

  if (state.logo) ctx.drawImage(state.logo, 42, 24, 64, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 32px system-ui";
  ctx.fillText("Africa Data Warehouse", 126, 52);
  ctx.font = "500 18px system-ui";
  ctx.fillText(STATES[state.selectedState].cardSubtitle, 126, 82);

  ctx.fillStyle = "rgba(39, 185, 211, 0.12)";
  ctx.font = "900 92px system-ui";
  ctx.translate(600, 360);
  ctx.rotate(-0.25);
  ctx.textAlign = "center";
  ctx.fillText("AFRICA DATA WAREHOUSE", 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  ctx.fillStyle = "#182022";
  ctx.textAlign = "left";
  ctx.font = "800 40px system-ui";
  ctx.fillText(title, 52, 178);
  ctx.font = "500 20px system-ui";
  ctx.fillStyle = "#647174";
  ctx.fillText(`${rows.length.toLocaleString()} polling unit record${rows.length === 1 ? "" : "s"}`, 52, 212);

  const metrics = [
    ["Registered", fmt(totals.registered)],
    ["Accredited", fmt(totals.accredited)],
    ["Valid Votes", fmt(totals.valid)],
    ["Invalid Votes", fmt(totals.invalid)],
  ];
  metrics.forEach((metric, index) => {
    const x = 52 + index * 276;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#d9e1e3";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, 252, 248, 118, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#647174";
    ctx.font = "700 17px system-ui";
    ctx.fillText(metric[0].toUpperCase(), x + 20, 292);
    ctx.fillStyle = "#182022";
    ctx.font = "800 34px system-ui";
    ctx.fillText(metric[1], x + 20, 340);
  });

  const maxVotes = Math.max(...parties.map((item) => item.votes), 1);
  parties.forEach((item, index) => {
    const y = 430 + index * 42;
    ctx.fillStyle = "#182022";
    ctx.font = "800 22px system-ui";
    ctx.fillText(item.party, 62, y);
    ctx.fillStyle = "#e9eef0";
    ctx.fillRect(150, y - 22, 700, 20);
    ctx.fillStyle = ["#27b9d3", "#1f7a4d", "#d89720", "#b7433f", "#476a6f"][index];
    ctx.fillRect(150, y - 22, 700 * (item.votes / maxVotes), 20);
    ctx.fillStyle = "#182022";
    ctx.textAlign = "right";
    ctx.fillText(fmt(item.votes), 1040, y);
    ctx.textAlign = "left";
  });

  ctx.fillStyle = "#647174";
  ctx.font = "16px system-ui";
  ctx.fillText("Source: INEC IReV public results data. Generated by Africa Data Warehouse.", 52, 636);
}

function drawNumberCard(rows, totals) {
  const canvas = els.numberCardCanvas;
  const ctx = canvas.getContext("2d");
  canvas.width = 1440;
  canvas.height = 1800;

  const allParties = sortedParties(totals);
  const leader = allParties[0] || { party: "N/A", votes: 0 };
  const runnerUp = allParties[1] || { party: "N/A", votes: 0 };
  const scope = getScopeDetails(rows);
  const leadMargin = Math.max(leader.votes - runnerUp.votes, 0);
  const turnout = percent(totals.accredited, totals.registered);
  const leaderShare = percent(leader.votes, totals.valid);
  const displayFont = '"Segoe UI Variable Display", "Aptos Display", "Bahnschrift", system-ui';
  const textFont = '"Aptos", "Segoe UI", system-ui';
  const ink = "#172224";
  const muted = "#5b6b6e";
  const line = "#dce6e8";
  const soft = "#f5f9f9";

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1440, 1800);

  ctx.strokeStyle = "#11191b";
  ctx.lineWidth = 18;
  ctx.strokeRect(28, 28, 1384, 1744);
  ctx.strokeStyle = "#27b9d3";
  ctx.lineWidth = 6;
  ctx.strokeRect(52, 52, 1336, 1696);

  if (state.logo) ctx.drawImage(state.logo, 72, 66, 118, 118);
  if (state.logo) {
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.drawImage(state.logo, 1000, 235, 285, 285);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(1125, 1250);
  ctx.rotate(-0.28);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(39, 185, 211, 0.10)";
  ctx.font = `900 70px ${displayFont}`;
  ctx.fillText("AFRICA DATA WAREHOUSE", 0, 0);
  ctx.restore();

  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.font = `900 40px ${displayFont}`;
  ctx.fillText("Africa Data Warehouse", 214, 112);
  ctx.fillStyle = muted;
  ctx.font = `600 24px ${textFont}`;
  ctx.fillText("Election Number Card", 214, 150);

  ctx.textAlign = "right";
  ctx.fillStyle = ink;
  ctx.font = `850 24px ${displayFont}`;
  ctx.fillText(scope.level.toUpperCase(), 1368, 104);
  ctx.fillStyle = muted;
  ctx.font = `500 20px ${textFont}`;
  ctx.fillText(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), 1368, 138);

  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(70, 195);
  ctx.lineTo(1370, 195);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.font = `900 72px ${displayFont}`;
  wrapText(ctx, scope.title, 72, 292, 1060, 76, 2);
  ctx.fillStyle = muted;
  ctx.font = `500 27px ${textFont}`;
  wrapText(ctx, scope.subtitle, 76, 430, 1060, 34, 2);

  const leaderColor = partyColor(leader.party);
  ctx.fillStyle = soft;
  drawRoundRect(ctx, 72, 505, 1296, 430, 28);
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = leaderColor;
  drawRoundRect(ctx, 112, 560, 250, 250, 28);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = `950 72px ${displayFont}`;
  ctx.fillText(leader.party, 237, 712);

  ctx.textAlign = "left";
  ctx.fillStyle = muted;
  ctx.font = `850 24px ${displayFont}`;
  ctx.fillText("LEADING PARTY", 420, 586);
  ctx.fillStyle = ink;
  ctx.font = `950 118px ${displayFont}`;
  ctx.fillText(leader.party, 420, 704);
  ctx.fillStyle = leaderColor;
  ctx.font = `950 104px ${displayFont}`;
  ctx.fillText(fmt(leader.votes), 420, 818);
  ctx.fillStyle = muted;
  ctx.font = `650 28px ${textFont}`;
  ctx.fillText(`${leaderShare} of valid votes`, 420, 866);

  ctx.fillStyle = ink;
  ctx.font = `850 30px ${displayFont}`;
  ctx.fillText(`Lead margin: ${fmt(leadMargin)}`, 420, 900);
  ctx.fillStyle = muted;
  ctx.font = `550 24px ${textFont}`;
  ctx.fillText(`Runner-up: ${runnerUp.party} (${fmt(runnerUp.votes)})`, 745, 900);

  const metricCards = [
    ["Valid Votes", fmt(totals.valid), ink],
    ["Accredited", fmt(totals.accredited), "#1f7a4d"],
    ["Registered", fmt(totals.registered), "#5863a3"],
    ["Polling Units", rows.length.toLocaleString(), "#d89720"],
    ["Invalid Votes", fmt(totals.invalid), "#b7433f"],
    ["Turnout", turnout, "#27b9d3"],
  ];
  metricCards.forEach((metric, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 72 + col * 438;
    const y = 982 + row * 166;
    ctx.fillStyle = "#ffffff";
    drawRoundRect(ctx, x, y, 400, 132, 18);
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = metric[2];
    ctx.font = `900 42px ${displayFont}`;
    ctx.textAlign = "left";
    ctx.fillText(metric[1], x + 28, y + 62);
    ctx.fillStyle = muted;
    ctx.font = `850 19px ${displayFont}`;
    ctx.fillText(metric[0].toUpperCase(), x + 28, y + 101);
  });

  const maxVotes = Math.max(...allParties.map((item) => item.votes), 1);
  ctx.fillStyle = "#ffffff";
  drawRoundRect(ctx, 72, 1345, 1296, 340, 22);
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.font = `900 30px ${displayFont}`;
  ctx.fillText("ALL PARTY RESULTS", 104, 1402);

  const columns = allParties.length > 18 ? 3 : 2;
  const rowsPerColumn = Math.ceil(allParties.length / columns) || 1;
  const rowHeight = Math.max(23, Math.min(42, Math.floor(240 / rowsPerColumn)));
  const rowFont = rowHeight < 28 ? 18 : rowHeight < 34 ? 21 : 24;
  const columnWidth = columns === 3 ? 418 : 630;
  const barX = columns === 3 ? 68 : 82;
  const barWidth = columns === 3 ? 170 : 280;
  const valueX = columns === 3 ? 372 : 560;
  allParties.forEach((item, index) => {
    const col = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const x = 104 + col * columnWidth;
    const y = 1460 + row * rowHeight;
    const color = partyColor(item.party, index);
    ctx.fillStyle = index % 2 === 0 ? "#f7faf9" : "#ffffff";
    drawRoundRect(ctx, x - 10, y - 25, columnWidth - 50, rowHeight - 4, 8);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = `900 ${rowFont}px ${displayFont}`;
    ctx.textAlign = "left";
    ctx.fillText(item.party, x, y);
    ctx.fillStyle = "#e8eff0";
    drawRoundRect(ctx, x + barX, y - 18, barWidth, 14, 7);
    ctx.fill();
    ctx.fillStyle = color;
    drawRoundRect(ctx, x + barX, y - 18, barWidth * (item.votes / maxVotes), 14, 7);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = "right";
    ctx.font = `850 ${rowFont}px ${displayFont}`;
    ctx.fillText(fmt(item.votes), x + valueX, y);
    ctx.textAlign = "left";
  });

  if (!allParties.length) {
    ctx.fillStyle = muted;
    ctx.font = `600 24px ${textFont}`;
    ctx.fillText("No party votes recorded for this selection yet.", 104, 1460);
  }

  ctx.fillStyle = muted;
  ctx.font = `500 20px ${textFont}`;
  ctx.fillText("Source: INEC IReV public result uploads. Generated by Africa Data Warehouse.", 72, 1740);
  ctx.textAlign = "right";
  ctx.fillText("africadatawarehouse.org", 1368, 1740);
}

function cardFileName(suffix) {
  return `${els.scopeTitle.textContent.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${suffix}.png`;
}

function renderCardCanvas(type) {
  const rows = getFilteredRows();
  const totals = aggregate(rows);
  if (type === "number") {
    drawNumberCard(rows, totals);
    return els.numberCardCanvas;
  }
  drawCard(rows, totals);
  return els.cardCanvas;
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function downloadCard() {
  downloadCanvas(renderCardCanvas("report"), cardFileName("result_card"));
}

function downloadNumberCard() {
  downloadCanvas(renderCardCanvas("number"), cardFileName("number_card"));
}

function viewCard(type) {
  previewCardType = type;
  const canvas = renderCardCanvas(type);
  els.cardPreviewTitle.textContent = type === "number" ? "Number Card Preview" : "Report Card Preview";
  els.cardPreviewImage.src = canvas.toDataURL("image/png");
  els.cardPreviewModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeCardPreview() {
  els.cardPreviewModal.hidden = true;
  els.cardPreviewImage.removeAttribute("src");
  document.body.style.overflow = "";
}

function showLoginPrompt() {
  els.loginPromptModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLoginPrompt() {
  els.loginPromptModal.hidden = true;
  document.body.style.overflow = "";
}

function downloadPreviewCard() {
  const canvas = renderCardCanvas(previewCardType);
  const suffix = previewCardType === "number" ? "number_card" : "result_card";
  downloadCanvas(canvas, cardFileName(suffix));
}

function render() {
  refreshFilters();
  const rows = getFilteredRows();
  renderUploadProgress(rows);
  const totals = renderSummary(rows);
  renderChart(totals);
  renderPartyList(totals);
  renderMap();
  renderLgaTable();
  renderPuDetail(rows);
}

async function boot() {
  state.selectedState = stateFromPath();
  fillStateSelect(state.selectedState);
  await loadStateData(state.selectedState);
}

async function loadStateData(stateKey) {
  state.selectedState = stateKey;
  const config = STATES[stateKey];
  els.pageTitle.textContent = config.title;
  els.excelDownload.dataset.protectedUrl = config.excelUrl;
  els.csvDownload.dataset.protectedUrl = config.csvUrl;
  els.stateSelect.value = stateKey;

  const csvText = await fetch(`${config.dataUrl}?v=${Date.now()}`).then((res) => {
    if (!res.ok) throw new Error(`${config.label} data file is not available yet.`);
    return res.text();
  });
  state.rows = parseCsv(csvText);
  state.partyColumns = Object.keys(state.rows[0] || {}).filter((key) => !metaColumns.has(key));

  if (!state.mapData) {
    state.mapData = await fetch(MAP_URL).then((res) => {
      if (!res.ok) throw new Error("Boundary map file is not available.");
      return res.json();
    });
  }

  if (!state.logo) {
    state.logo = new Image();
    state.logo.src = LOGO_URL;
    await new Promise((resolve) => {
      state.logo.onload = resolve;
      state.logo.onerror = resolve;
    });
  }

  fillSelect(els.lgaSelect, unique(state.rows.map((row) => row.LGA)));
  refreshFilters();
  render();
}

els.stateSelect.addEventListener("change", async () => {
  await loadStateData(els.stateSelect.value);
  window.history.replaceState({}, "", `/dashboard/${els.stateSelect.value}/`);
});
els.lgaSelect.addEventListener("change", () => render());
els.wardSelect.addEventListener("change", () => render());
els.puSelect.addEventListener("change", () => {
  syncPuSelects(els.puSelect.value);
  render();
});
els.viewCardBtn.addEventListener("click", () => viewCard("report"));
els.viewNumberCardBtn.addEventListener("click", () => viewCard("number"));
els.closeCardPreviewBtn.addEventListener("click", closeCardPreview);
els.downloadPreviewCardBtn.addEventListener("click", downloadPreviewCard);
els.excelDownload.addEventListener("click", (event) => {
  event.preventDefault();
  showLoginPrompt();
});
els.csvDownload.addEventListener("click", (event) => {
  event.preventDefault();
  showLoginPrompt();
});
els.cardPreviewModal.addEventListener("click", (event) => {
  if (event.target === els.cardPreviewModal) closeCardPreview();
});
els.closeLoginPromptBtn.addEventListener("click", closeLoginPrompt);
els.loginPromptModal.addEventListener("click", (event) => {
  if (event.target === els.loginPromptModal) closeLoginPrompt();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.cardPreviewModal.hidden) closeCardPreview();
  if (event.key === "Escape" && !els.loginPromptModal.hidden) closeLoginPrompt();
});
window.addEventListener("resize", () => renderChart(aggregate(getFilteredRows())));

boot().catch((error) => {
  document.body.innerHTML = `<main class="app-shell"><div class="panel"><div class="panel-head"><h1>Unable to load dashboard data</h1><p>${error.message}</p></div></div></main>`;
});
