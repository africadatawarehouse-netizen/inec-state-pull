const STORAGE_KEY = "adw_manual_election_csv";
const SAMPLE_URL = `/output/pu_results.csv?v=${Date.now()}`;

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
  rows: [],
  partyColumns: [],
};

const els = {
  csvFile: document.querySelector("#csvFile"),
  csvText: document.querySelector("#csvText"),
  feedStatus: document.querySelector("#feedStatus"),
  loadFeedBtn: document.querySelector("#loadFeedBtn"),
  sampleFeedBtn: document.querySelector("#sampleFeedBtn"),
  clearFeedBtn: document.querySelector("#clearFeedBtn"),
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

function fillSelect(select, values, current = "All") {
  select.innerHTML = "";
  ["All", ...values].forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = values.includes(current) ? current : "All";
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
  const totals = { registered: 0, accredited: 0, valid: 0, invalid: 0, parties: {} };
  rows.forEach((row) => {
    totals.registered += num(row["Total Registered"]);
    totals.accredited += num(row["Total Accredited"]);
    totals.valid += num(row["Valid Votes"]);
    totals.invalid += num(row["Invalid Votes"]);
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

function refreshFilters() {
  const lga = els.lgaSelect.value || "All";
  const ward = els.wardSelect.value || "All";
  const wardRows = lga === "All" ? state.rows : state.rows.filter((row) => row.LGA === lga);
  fillSelect(els.wardSelect, unique(wardRows.map((row) => row.Ward)), ward);
  const selectedWard = els.wardSelect.value || "All";
  const puRows = wardRows.filter((row) => selectedWard === "All" || row.Ward === selectedWard);
  fillSelect(els.puSelect, unique(puRows.map((row) => row["PU Code"])), els.puSelect.value);
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
  els.scopeTitle.textContent = parts.length ? parts.join(" / ") : "Manual Feed Results";
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
      return `
        <div class="party-row">
          <div class="party-code">${item.party}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(item.votes / maxVotes) * 100}%;background:${colors[index % colors.length]}"></div></div>
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
  const row = rows[0] || {};
  const href = row["Image URL"] || "";
  els.documentStatus.textContent = href ? "Result sheet available" : "No result-sheet URL in selected row";
  const items = [
    ["Polling Unit", row["Polling Unit"] || ""],
    ["PU Code", row["PU Code"] || ""],
    ["Ward", row.Ward || ""],
    ["LGA", row.LGA || ""],
    ["Ballots Issued", fmt(row["Ballots Issued"])],
    ["Invalid Votes", fmt(row["Invalid Votes"])],
  ];
  els.puDetail.innerHTML = items.map((item) => `<div class="detail-item"><span>${item[0]}</span><strong>${item[1]}</strong></div>`).join("");
  if (href) {
    els.puDetail.insertAdjacentHTML("beforeend", `<div class="detail-item"><span>Result Sheet</span><a href="${href}" target="_blank" rel="noreferrer">Open file</a></div>`);
  }
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

function loadCsv(text, sourceLabel) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("No rows found in CSV.");
  state.rows = rows;
  state.partyColumns = Object.keys(rows[0]).filter((key) => !metaColumns.has(key));
  localStorage.setItem(STORAGE_KEY, text);
  fillSelect(els.lgaSelect, unique(state.rows.map((row) => row.LGA)));
  els.feedStatus.textContent = `${sourceLabel}: ${rows.length.toLocaleString()} rows, ${unique(rows.map((row) => row.LGA)).length} LGAs`;
  render();
}

els.csvFile.addEventListener("change", async () => {
  const file = els.csvFile.files[0];
  if (!file) return;
  const text = await file.text();
  els.csvText.value = text;
  loadCsv(text, file.name);
});

els.loadFeedBtn.addEventListener("click", () => {
  try {
    loadCsv(els.csvText.value, "Manual paste");
  } catch (error) {
    els.feedStatus.textContent = error.message;
  }
});

els.sampleFeedBtn.addEventListener("click", async () => {
  try {
    const text = await fetch(SAMPLE_URL).then((response) => response.text());
    els.csvText.value = text;
    loadCsv(text, "Current FCT CSV");
  } catch (error) {
    els.feedStatus.textContent = error.message;
  }
});

els.clearFeedBtn.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  els.csvText.value = "";
  state.rows = [];
  state.partyColumns = [];
  fillSelect(els.lgaSelect, []);
  fillSelect(els.wardSelect, []);
  fillSelect(els.puSelect, []);
  render();
  els.feedStatus.textContent = "Manual feed cleared";
});

els.lgaSelect.addEventListener("change", render);
els.wardSelect.addEventListener("change", render);
els.puSelect.addEventListener("change", render);
window.addEventListener("resize", () => renderChart(aggregate(getFilteredRows())));

const saved = localStorage.getItem(STORAGE_KEY);
if (saved) {
  els.csvText.value = saved;
  loadCsv(saved, "Saved manual feed");
} else {
  fillSelect(els.lgaSelect, []);
  fillSelect(els.wardSelect, []);
  fillSelect(els.puSelect, []);
  render();
}
