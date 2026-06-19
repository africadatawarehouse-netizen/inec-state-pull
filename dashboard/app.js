const LOGO_URL = "/assets/africa-data-warehouse-logo.png";
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
  scopeTitle: document.querySelector("#scopeTitle"),
  scopeSubtitle: document.querySelector("#scopeSubtitle"),
  partyChart: document.querySelector("#partyChart"),
  partyList: document.querySelector("#partyList"),
  winnerText: document.querySelector("#winnerText"),
  lgaTable: document.querySelector("#lgaTable"),
  lgaCount: document.querySelector("#lgaCount"),
  puDetail: document.querySelector("#puDetail"),
  documentStatus: document.querySelector("#documentStatus"),
  downloadCardBtn: document.querySelector("#downloadCardBtn"),
  cardCanvas: document.querySelector("#cardCanvas"),
};

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

function fillSelect(select, values, current = "All") {
  select.innerHTML = "";
  ["All", ...values].forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "All" ? "All" : value;
    select.appendChild(option);
  });
  select.value = values.includes(current) ? current : "All";
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
  fillSelect(
    els.puSelect,
    unique(puRows.map((row) => row["PU Code"])).map((code) => {
      const found = puRows.find((row) => row["PU Code"] === code);
      return found ? `${code}` : code;
    }),
    els.puSelect.value,
  );
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
  if (els.puSelect.value !== "All") parts.push(els.puSelect.value);
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
  const row = pu || rows[0] || {};
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
  canvas.width = 1400;
  canvas.height = 1800;

  const parties = sortedParties(totals).slice(0, 6);
  const leader = parties[0] || { party: "N/A", votes: 0 };
  const runnerUp = parties[1] || { party: "N/A", votes: 0 };
  const scope = getScopeDetails(rows);
  const leadMargin = Math.max(leader.votes - runnerUp.votes, 0);
  const turnout = percent(totals.accredited, totals.registered);
  const validShare = percent(totals.valid, totals.accredited);
  const leaderShare = percent(leader.votes, totals.valid);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, 1400, 1800);
  gradient.addColorStop(0, "#071014");
  gradient.addColorStop(0.42, "#10292c");
  gradient.addColorStop(1, "#f8fbfa");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1400, 1800);

  ctx.fillStyle = "rgba(39, 185, 211, 0.18)";
  ctx.beginPath();
  ctx.arc(1180, 190, 250, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(216, 151, 32, 0.16)";
  ctx.beginPath();
  ctx.arc(190, 1160, 320, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(700, 940);
  ctx.rotate(-0.36);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.font = "900 118px system-ui";
  ctx.fillText("AFRICA DATA WAREHOUSE", 0, 0);
  ctx.restore();

  if (state.logo) ctx.drawImage(state.logo, 70, 70, 94, 94);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = "800 34px system-ui";
  ctx.fillText("Africa Data Warehouse", 184, 112);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "500 22px system-ui";
  ctx.fillText("Election Intelligence Result Card", 184, 148);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.84)";
  ctx.font = "800 24px system-ui";
  ctx.fillText(scope.level.toUpperCase(), 1320, 104);
  ctx.font = "500 20px system-ui";
  ctx.fillText(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), 1320, 138);

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 70px system-ui";
  wrapText(ctx, scope.title, 72, 280, 850, 78, 2);
  ctx.fillStyle = "rgba(255,255,255,0.74)";
  ctx.font = "500 26px system-ui";
  wrapText(ctx, scope.subtitle, 76, 430, 900, 34, 2);

  const leaderColor = partyColor(leader.party);
  ctx.fillStyle = "#ffffff";
  drawRoundRect(ctx, 72, 530, 1256, 520, 38);
  ctx.fill();
  ctx.fillStyle = "#f2f7f7";
  drawRoundRect(ctx, 98, 556, 1204, 468, 30);
  ctx.fill();

  ctx.fillStyle = leaderColor;
  ctx.beginPath();
  ctx.arc(278, 760, 132, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "900 64px system-ui";
  ctx.fillText(leader.party, 278, 780);

  ctx.textAlign = "left";
  ctx.fillStyle = "#607174";
  ctx.font = "800 24px system-ui";
  ctx.fillText("LEADING PARTY", 460, 650);
  ctx.fillStyle = "#162326";
  ctx.font = "900 108px system-ui";
  ctx.fillText(leader.party, 460, 760);
  ctx.fillStyle = leaderColor;
  ctx.font = "900 74px system-ui";
  ctx.fillText(fmt(leader.votes), 460, 850);
  ctx.fillStyle = "#607174";
  ctx.font = "600 28px system-ui";
  ctx.fillText(`${leaderShare} of valid votes`, 460, 895);

  ctx.fillStyle = "#162326";
  ctx.font = "800 30px system-ui";
  ctx.fillText(`Lead margin: ${fmt(leadMargin)}`, 460, 958);
  ctx.fillStyle = "#607174";
  ctx.font = "500 23px system-ui";
  ctx.fillText(`Runner-up: ${runnerUp.party} (${fmt(runnerUp.votes)})`, 460, 994);

  const metricCards = [
    ["Valid Votes", fmt(totals.valid), "#162326"],
    ["Accredited", fmt(totals.accredited), "#1f7a4d"],
    ["Registered", fmt(totals.registered), "#5863a3"],
    ["Polling Units", rows.length.toLocaleString(), "#d89720"],
    ["Invalid Votes", fmt(totals.invalid), "#b7433f"],
    ["Turnout", turnout, "#27b9d3"],
  ];
  metricCards.forEach((metric, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 72 + col * 426;
    const y = 1108 + row * 180;
    ctx.fillStyle = "#ffffff";
    drawRoundRect(ctx, x, y, 390, 142, 24);
    ctx.fill();
    ctx.fillStyle = metric[2];
    ctx.font = "900 42px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(metric[1], x + 28, y + 68);
    ctx.fillStyle = "#607174";
    ctx.font = "800 19px system-ui";
    ctx.fillText(metric[0].toUpperCase(), x + 28, y + 108);
  });

  const maxVotes = Math.max(...parties.map((item) => item.votes), 1);
  ctx.fillStyle = "#162326";
  ctx.font = "900 30px system-ui";
  ctx.fillText("TOP PARTY TOTALS", 72, 1512);
  parties.forEach((item, index) => {
    const y = 1570 + index * 42;
    const color = partyColor(item.party, index);
    ctx.fillStyle = color;
    ctx.font = "900 24px system-ui";
    ctx.fillText(item.party, 72, y);
    ctx.fillStyle = "rgba(22,35,38,0.12)";
    drawRoundRect(ctx, 190, y - 25, 760, 18, 9);
    ctx.fill();
    ctx.fillStyle = color;
    drawRoundRect(ctx, 190, y - 25, 760 * (item.votes / maxVotes), 18, 9);
    ctx.fill();
    ctx.fillStyle = "#162326";
    ctx.textAlign = "right";
    ctx.font = "800 24px system-ui";
    ctx.fillText(fmt(item.votes), 1294, y);
    ctx.textAlign = "left";
  });

  ctx.fillStyle = "#607174";
  ctx.font = "500 20px system-ui";
  ctx.fillText("Source: INEC IReV public result uploads. Generated by Africa Data Warehouse.", 72, 1740);
  ctx.textAlign = "right";
  ctx.fillText("africadatawarehouse.org", 1328, 1740);
}

function downloadCard() {
  const rows = getFilteredRows();
  const totals = aggregate(rows);
  drawCard(rows, totals);
  const link = document.createElement("a");
  link.download = `${els.scopeTitle.textContent.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_result_card.png`;
  link.href = els.cardCanvas.toDataURL("image/png");
  link.click();
}

function render() {
  refreshFilters();
  const rows = getFilteredRows();
  const totals = renderSummary(rows);
  renderChart(totals);
  renderPartyList(totals);
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
  els.excelDownload.href = config.excelUrl;
  els.csvDownload.href = config.csvUrl;
  els.stateSelect.value = stateKey;

  const csvText = await fetch(`${config.dataUrl}?v=${Date.now()}`).then((res) => {
    if (!res.ok) throw new Error(`${config.label} data file is not available yet.`);
    return res.text();
  });
  state.rows = parseCsv(csvText);
  state.partyColumns = Object.keys(state.rows[0] || {}).filter((key) => !metaColumns.has(key));

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
els.puSelect.addEventListener("change", () => render());
els.downloadCardBtn.addEventListener("click", downloadCard);
window.addEventListener("resize", () => renderChart(aggregate(getFilteredRows())));

boot().catch((error) => {
  document.body.innerHTML = `<main class="app-shell"><div class="panel"><div class="panel-head"><h1>Unable to load dashboard data</h1><p>${error.message}</p></div></div></main>`;
});
