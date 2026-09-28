/* PMON Interpreter: all values are expected to be microseconds, as declared by the file. */
const $ = (selector) => document.querySelector(selector);
const els = { file: $('#file-input'), sample: $('#sample-button'), help: $('#help-button'), dialog: $('#help-dialog'), dialogTitle: $('#dialog-title'), dialogContent: $('#dialog-content'), dialogClose: $('#dialog-close'), drop: $('#drop-zone'), empty: $('#empty-state'), dashboard: $('#dashboard'), info: $('#file-info'), cards: $('#summary-cards'), category: $('#category-chart'), categoryDescription: $('#category-description'), shareHeader: $('#share-header'), hotspots: $('#hotspot-chart'), outliers: $('#outlier-list'), insights: $('#insights'), type: $('#type-filter'), search: $('#search'), sort: $('#sort-by'), table: $('#operation-table'), count: $('#row-count'), liveSelect: $('#live-snapshot-select'), liveStatus: $('#live-snapshot-status'), saveSnapshot: $('#save-snapshot-button'), tabs: document.querySelectorAll('.tab'), overviewTab: $('#overview-tab'), compareTab: $('#compare-tab'), baselineSelect: $('#baseline-select'), candidateSelect: $('#candidate-select'), baselineFile: $('#baseline-file'), candidateFile: $('#candidate-file'), compareButton: $('#compare-button'), compareStatus: $('#compare-status'), compareNote: $('#compare-note'), compareResults: $('#compare-results'), compareCards: $('#compare-cards'), compareType: $('#compare-type'), compareSearch: $('#compare-search'), compareTable: $('#compare-table'), compareCount: $('#compare-count'), clearSnapshots: $('#clear-snapshots') };
let model;
const snapshots = new Map();
// Guards the "newest two exports" auto-selection so the 15-second refresh
// never overwrites snapshots the user picked in the compare tab.
let compareTouched = false;
let compareAutoSelected = false;
const n = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const us = (v) => v >= 1000 ? `${n.format(v / 1000)} ms` : `${n.format(v)} µs`;
const duration = (v) => v >= 1e6 ? `${n.format(v / 1e6)} s` : us(v);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function validate(data) {
  if (!data || !Array.isArray(data.metrics) || !Number.isFinite(data.fullTickCount)) throw new Error('This does not look like a PMON total file: expected metrics and fullTickCount.');
  if (!data.metrics.some(m => Array.isArray(m.rows))) throw new Error('The PMON file has no measurable rows.');
}
function makeModel(data) {
  validate(data);
  // "Total" is a set of overlapping timing scopes, not an exclusive work category.
  // Keep it out of rankings/accounting so FullTick does not drown out actionable work.
  const categories = data.metrics.filter(m => Array.isArray(m.rows) && Number.isFinite(m.totalTime));
  const rows = categories.flatMap(m => m.rows.map((r, index) => ({...r, id: `${m.type}:${index}`, key: `${m.type}\u0000${r.name}`, type:m.type, totalTime:+r.totalTime || 0, count:+r.count || 0, avgTime:+r.avgTime || 0, minTime:+r.minTime || 0, maxTime:+r.maxTime || 0, timePerTick:+r.timePerTick || 0, callsPerTick:+r.callsPerTick || 0, percent:+r.percent || 0 })));
  return { data, categories, rows, tickAvg: data.fullTickTotalTime / data.fullTickCount, aiShare: data.updateAiTotalTime / data.fullTickTotalTime * 100 };
}
function bars(target, items, label, value, color) {
  const max = Math.max(...items.map(value), 1);
  target.innerHTML = items.map(x => `<div class="bar-row"><span class="bar-label" title="${esc(label(x))}">${esc(label(x))}</span><div class="bar-track"><div class="bar-fill" style="width:${value(x)/max*100}%;${color?`background:${color}`:''}"></div></div><span class="bar-value">${esc(x.text || '')}</span></div>`).join('');
}
function render(data, source) {
  model = makeModel(data); model.source = source; const {data:d, categories, rows} = model;
  snapshots.set('current', model);
  els.empty.hidden = true; els.dashboard.hidden = false;
  const percentScope = d.mode === 'tick' ? 'full-tick' : 'UpdateAI';
  els.categoryDescription.innerHTML = `Share of recorded <code>${percentScope === 'full-tick' ? 'FullTick' : 'UpdateAI'}</code> timing by category.`;
  els.shareHeader.textContent = `${percentScope} share ⓘ`;
  els.shareHeader.dataset.tooltip = `Share of recorded ${percentScope} timing in this ${d.mode || 'total'} export.`;
  els.info.textContent = `${source}  ·  generated ${d.generatedAtUtc || 'at an unknown time'}  ·  ${d.mode || 'unknown'} mode  ·  ${rows.length.toLocaleString()} operations`;
  const card = (label, value, sub) => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  els.cards.innerHTML = [
    card('FullTick samples', n.format(d.fullTickCount), `${duration(d.fullTickTotalTime)} cumulative interval`),
    card('Average FullTick interval', us(model.tickAvg), 'cadence between UpdateAI calls; not CPU time'),
    card('AI time / tick', us(d.updateAiTotalTime/d.fullTickCount), `${n.format(model.aiShare)}% of FullTick interval`),
    card('Measured AI categories', `${n.format(categories.reduce((s,x)=>s+(x.totalTime||0),0) / (d.updateAiTotalTime||1) * 100)}%`, 'of UpdateAI total time'),
    card('Slowest observed', us(Math.max(...rows.map(r=>r.maxTime))), 'single operation invocation')
  ].join('');
  const cat = categories.filter(c => c.totalTime).map(c => ({...c, text:`${n.format(c.percent || c.totalTime/(d.updateAiTotalTime||1)*100)}%`})).sort((a,b)=>b.totalTime-a.totalTime);
  bars(els.category, cat, x=>x.type, x=>x.totalTime);
  const hot = [...rows].sort((a,b)=>b.timePerTick-a.timePerTick).slice(0,8).map(x=>({...x,text:`${us(x.timePerTick)} / tick`}));
  bars(els.hotspots, hot, x=>`${x.type}: ${x.name}`, x=>x.timePerTick);
  const out = rows.filter(r=>r.avgTime > 0 && r.count >= 5).map(r=>({...r,ratio:r.maxTime/r.avgTime})).sort((a,b)=>b.ratio-a.ratio).slice(0,8);
  els.outliers.innerHTML = out.map((r,i)=>`<div class="rank-item"><span class="rank-num">#${i+1}</span><span class="rank-name" title="${esc(r.name)}">${esc(r.name)} <span class="category">${esc(r.type)}</span></span><span class="outlier">${n.format(r.ratio)}× · ${us(r.maxTime)}</span></div>`).join('') || '<p>No repeatable outliers found.</p>';
  renderInsights();
  els.type.innerHTML = '<option value="all">All categories</option>' + categories.map(c=>`<option value="${esc(c.type)}">${esc(c.type)}</option>`).join('');
  renderTable();
  refreshCompareChoices();
}
function renderInsights() {
  const {data:d, rows, tickAvg, aiShare} = model;
  const worst = [...rows].sort((a,b)=>b.timePerTick-a.timePerTick)[0];
  const frequent = [...rows].sort((a,b)=>b.callsPerTick-a.callsPerTick)[0];
  const spike = [...rows].filter(r=>r.avgTime).map(r=>({...r,ratio:r.maxTime/r.avgTime})).sort((a,b)=>b.ratio-a.ratio)[0];
  const notes = [
    ['<b>FullTick averages '+us(tickAvg)+'</b> between successive <code>UpdateAI</code> calls. The monitor finishes that scope on the following call, so this is a cadence/interval measurement rather than CPU time.', false],
    ['<b>'+esc(worst.name)+'</b> ('+esc(worst.type)+') is the largest measured steady cost: <b>'+us(worst.timePerTick)+' per FullTick sample</b> ('+n.format(worst.percent)+'% of the export denominator).', false],
    ['<b>'+esc(frequent.name)+'</b> runs <b>'+n.format(frequent.callsPerTick)+' times per FullTick sample</b>. For Trigger and Value rows, inspect the configured check interval before treating high frequency as a defect.', frequent.callsPerTick > 1],
    ['<b>'+esc(spike.name)+'</b> has a <b>'+n.format(spike.ratio)+'×</b> max/average spread ('+us(spike.maxTime)+' max). Inspect it for exceptional paths before assuming its average is representative.', spike.ratio > 50],
    ['Profiled categories account for <b>'+n.format(rows.reduce((s,r)=>s+r.totalTime,0)/(d.updateAiTotalTime||1)*100)+'%</b> of UpdateAI timing. The remainder may be uninstrumented work or overlapping timing scopes.', aiShare > 10]
  ];
  els.insights.innerHTML = notes.map(([text,warn])=>`<li class="${warn?'warn':''}">${text}</li>`).join('');
}
function renderTable() {
  if (!model) return;
  const query=els.search.value.trim().toLowerCase(), type=els.type.value, key=els.sort.value;
  const filtered=model.rows.filter(r=>(type==='all'||r.type===type)&&(`${r.name} ${r.type}`.toLowerCase().includes(query))).sort((a,b)=>b[key]-a[key]);
  els.count.textContent=`${filtered.length.toLocaleString()} of ${model.rows.length.toLocaleString()} operations · sorted by ${key.replace(/([A-Z])/g,' $1')}`;
  els.table.innerHTML=filtered.map(r=>`<tr data-row-id="${esc(r.id)}"><td title="${esc(r.name)}"><span class="category" title="${esc(categoryTips[r.type] || 'Instrumented playerbot work.')}">${esc(r.type)}</span>${esc(r.name)}</td><td>${duration(r.totalTime)}</td><td>${n.format(r.percent)}%</td><td>${us(r.timePerTick)}</td><td>${n.format(r.callsPerTick)}</td><td>${us(r.avgTime)}</td><td>${us(r.minTime)} — ${us(r.maxTime)}</td><td>${n.format(r.count)}</td></tr>`).join('') || '<tr><td colspan="8">No operations match this filter.</td></tr>';
}
async function loadFile(file) { try { render(JSON.parse(await file.text()), file.name); } catch(e) { alert(`Could not load file: ${e.message}`); } }
els.file.addEventListener('change', e=>e.target.files[0] && loadFile(e.target.files[0]));
els.sample.addEventListener('click', async()=>{try { const r=await fetch('sample-pmon_total.json'); if(!r.ok) throw new Error('Start the local server described in README.md.'); render(await r.json(),'included sample-pmon_total.json'); } catch(e) { alert(e.message); }});
['dragenter','dragover'].forEach(e=>els.drop.addEventListener(e,ev=>{ev.preventDefault();els.drop.classList.add('drag')}));
['dragleave','drop'].forEach(e=>els.drop.addEventListener(e,ev=>{ev.preventDefault();els.drop.classList.remove('drag')}));
els.drop.addEventListener('drop', e=>e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]));
els.drop.addEventListener('click',()=>els.file.click());
[els.type,els.search,els.sort].forEach(el=>el.addEventListener('input',renderTable));

function snapshotLabel(snapshot, fallback) {
  return `${snapshot.data.generatedAtUtc || fallback} — ${fallback}`;
}
function addSnapshotOption(select, key, label) {
  if (![...select.options].some(option => option.value === key)) select.add(new Option(label, key));
}
function refreshCompareChoices() {
  if (!model) return;
  snapshots.set('current', model);
  const currentLabel = snapshotLabel(model, model.source || 'Current overview snapshot');
  const candidateCurrent = [...els.candidateSelect.options].find(option => option.value === 'current');
  if (candidateCurrent) candidateCurrent.textContent = currentLabel;
  addSnapshotOption(els.baselineSelect, 'current', currentLabel);
}
async function discoverSnapshots() {
  try {
    const listing = await fetch('pmon-exports/');
    if (!listing.ok) throw new Error(`HTTP ${listing.status}`);
    const page = new DOMParser().parseFromString(await listing.text(), 'text/html');
    const files = [...page.querySelectorAll('a')].map(link => ({name:decodeURIComponent(link.getAttribute('href') || ''), live:link.dataset.live === 'true'})).filter(file => /\.json$/i.test(file.name) && !file.name.includes('/'));
    // Drop options whose files no longer exist on the server so stale entries don't accumulate.
    const validRemote = new Set(files.map(file => `remote:${file.name}`));
    for (const select of [els.baselineSelect, els.candidateSelect]) {
      [...select.options].forEach(option => {
        if (option.value.startsWith('remote:') && !validRemote.has(option.value)) {
          select.remove(option.index);
          snapshots.delete(option.value);
        }
      });
    }
    const loaded = await Promise.all(files.map(async file => {
      try { return [file.name, makeModel(await (await fetch(`pmon-exports/${encodeURIComponent(file.name)}`)).json()), file.live]; } catch { return null; }
    }));
    const ordered = loaded.filter(Boolean).sort((a,b) => (a[1].data.generatedAt || 0) - (b[1].data.generatedAt || 0));
    const previousLiveSelection = els.liveSelect.value;
    els.liveSelect.innerHTML = '<option value="live">Follow newest live file</option>';
    ordered.forEach(([name, snapshot, isLive]) => {
      const key = `remote:${name}`; snapshot.source = name; snapshot.isLive = isLive; snapshots.set(key, snapshot);
      addSnapshotOption(els.liveSelect, key, snapshotLabel(snapshot, name));
      const liveOption = [...els.liveSelect.options].find(option => option.value === key);
      if (liveOption) liveOption.dataset.live = String(isLive);
      addSnapshotOption(els.baselineSelect, key, snapshotLabel(snapshot, name));
      addSnapshotOption(els.candidateSelect, key, snapshotLabel(snapshot, name));
    });
    els.liveSelect.value = [...els.liveSelect.options].some(option => option.value === previousLiveSelection) ? previousLiveSelection : 'live';
    const liveNames = ordered.filter(item => item[2]).map(item => item[0]);
    els.liveStatus.textContent = ordered.length ? `${liveNames.length} live file${liveNames.length === 1 ? '' : 's'}, ${ordered.length-liveNames.length} archived · newest: ${ordered.at(-1)[0]}` : 'No valid pmon*.json files found yet';
    updateSaveSnapshotButton();
    if (ordered.length) els.compareNote.innerHTML = `Discovered <b>${ordered.length}</b> JSON snapshot${ordered.length === 1 ? '' : 's'} from <code>pmon-exports/</code>. The timestamp inside each JSON is used for its label; uploads work too.`;
    if (ordered.length >= 2 && !compareTouched && !compareAutoSelected) {
      // The newest two exports are ready to compare without manual selection.
      // Only applied once, and never after the user has chosen anything themselves.
      els.baselineSelect.value = `remote:${ordered.at(-2)[0]}`;
      els.candidateSelect.value = `remote:${ordered.at(-1)[0]}`;
      compareAutoSelected = true;
      compareSnapshots();
    }
  } catch { els.liveStatus.textContent = 'Live PMON directory is unavailable'; }
}
async function loadCompareFile(file, slot) {
  try {
    const snapshot = makeModel(JSON.parse(await file.text())); snapshot.source = file.name;
    const key = `upload:${slot}`; snapshots.set(key, snapshot);
    const select = slot === 'baseline' ? els.baselineSelect : els.candidateSelect;
    addSnapshotOption(select, key, snapshotLabel(snapshot, file.name)); select.value = key;
    compareTouched = true;
  } catch (error) { alert(`Could not load comparison file: ${error.message}`); }
}
function deltaClass(value, missing) { return missing ? 'delta-new' : value < 0 ? 'delta-good' : value > 0 ? 'delta-bad' : 'delta-flat'; }
function deltaValue(value, formatter, missing, removed) {
  if (missing) return `<span class="delta-new">${removed ? 'Not recorded' : 'New'}</span>`;
  return `<span class="${deltaClass(value)}">${value > 0 ? '+' : ''}${formatter(value)}</span>`;
}
function compareCard(label, before, after, formatter) {
  const delta = after - before;
  return `<div class="card"><div class="label">${label}</div><div class="value ${deltaClass(delta)}">${delta > 0 ? '+' : ''}${formatter(delta)}</div><div class="sub">${formatter(before)} → ${formatter(after)}</div></div>`;
}
function compareSnapshots() {
  const baseline = snapshots.get(els.baselineSelect.value), candidate = snapshots.get(els.candidateSelect.value);
  if (!baseline || !candidate) { els.compareStatus.textContent = 'Select both snapshots'; els.compareResults.hidden = true; return; }
  const sameMode = baseline.data.mode === candidate.data.mode;
  els.compareStatus.textContent = sameMode ? `${baseline.data.mode || 'unknown'} mode · lower is better` : 'Warning: different export modes';
  els.compareNote.innerHTML = sameMode ? `Baseline: <b>${esc(baseline.source)}</b> → candidate: <b>${esc(candidate.source)}</b>. Green means lower measured cost; red means higher. New or missing operations are marked separately because workload may have changed.` : '<b>Modes differ.</b> Compare tick-mode exports with tick-mode exports, or total-mode exports with total-mode exports, for reliable percentages. Time-per-tick values remain displayed.';
  const categoryTime = item => item.categories.reduce((sum, category) => sum + (category.totalTime || 0), 0) / (item.data.fullTickCount || 1);
  els.compareCards.innerHTML = [
    compareCard('Average full tick', baseline.tickAvg, candidate.tickAvg, us),
    compareCard('AI time / full tick', baseline.data.updateAiTotalTime / baseline.data.fullTickCount, candidate.data.updateAiTotalTime / candidate.data.fullTickCount, us),
    compareCard('Instrumented work / tick', categoryTime(baseline), categoryTime(candidate), us),
    `<div class="card"><div class="label">Operation coverage</div><div class="value">${n.format(candidate.rows.length)}</div><div class="sub">${n.format(baseline.rows.length)} baseline operations</div></div>`
  ].join('');
  const before = new Map(baseline.rows.map(row => [row.key, row]));
  const after = new Map(candidate.rows.map(row => [row.key, row]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  const compared = [...keys].map(key => { const left = before.get(key), right = after.get(key); return { left, right, row: right || left, delta: (right?.timePerTick || 0) - (left?.timePerTick || 0) }; }).sort((a,b) => b.delta - a.delta);
  els.compareResults.hidden = false;
  els.compareType.innerHTML = '<option value="all">All categories</option>' + [...new Set(compared.map(item => item.row.type))].sort().map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
  els.compareTable.dataset.items = JSON.stringify(compared.map(item => ({ key: item.row.key })));
  renderComparison(compared);
}
function renderComparison(provided) {
  const baseline = snapshots.get(els.baselineSelect.value), candidate = snapshots.get(els.candidateSelect.value);
  if (!baseline || !candidate) return;
  const before = new Map(baseline.rows.map(row => [row.key, row])), after = new Map(candidate.rows.map(row => [row.key, row]));
  const items = provided || [...new Set([...before.keys(), ...after.keys()])].map(key => { const left = before.get(key), right = after.get(key); return { left, right, row: right || left, delta: (right?.timePerTick || 0) - (left?.timePerTick || 0) }; }).sort((a,b) => b.delta - a.delta);
  const query = els.compareSearch.value.trim().toLowerCase(), type = els.compareType.value;
  const filtered = items.filter(item => (type === 'all' || item.row.type === type) && `${item.row.type} ${item.row.name}`.toLowerCase().includes(query));
  els.compareCount.textContent = `${filtered.length.toLocaleString()} matching operations · sorted by time-per-tick regression`;
  const cell = (left, right, field, formatter) => { const missing = !left || !right; return missing ? deltaValue(0, formatter, true, !right) : deltaValue(right[field] - left[field], formatter); };
  els.compareTable.innerHTML = filtered.map(item => { const {left, right, row} = item; return `<tr><td><span class="category" title="${esc(categoryTips[row.type] || 'Instrumented playerbot work.')}">${esc(row.type)}</span>${esc(row.name)}</td><td>${left ? us(left.timePerTick) : '—'}</td><td>${right ? us(right.timePerTick) : '—'}</td><td>${cell(left, right, 'timePerTick', us)}</td><td>${cell(left, right, 'avgTime', us)}</td><td>${cell(left, right, 'callsPerTick', v => n.format(v))}</td></tr>`; }).join('') || '<tr><td colspan="6">No operations match this filter.</td></tr>';
}
els.tabs.forEach(tab => tab.addEventListener('click', () => { const compare = tab.dataset.tab === 'compare'; els.tabs.forEach(item => item.classList.toggle('active', item === tab)); els.overviewTab.hidden = compare; els.compareTab.hidden = !compare; }));
els.baselineFile.addEventListener('change', event => event.target.files[0] && loadCompareFile(event.target.files[0], 'baseline'));
els.candidateFile.addEventListener('change', event => event.target.files[0] && loadCompareFile(event.target.files[0], 'candidate'));
els.compareButton.addEventListener('click', compareSnapshots);
[els.baselineSelect, els.candidateSelect].forEach(select => select.addEventListener('change', () => { compareTouched = true; }));
// Client-side reset of the snapshot pickers only; files in the server's PMON directory are untouched.
function clearSnapshots() {
  snapshots.clear();
  if (model) snapshots.set('current', model);
  els.liveSelect.innerHTML = '<option value="live">Follow newest live file</option>';
  els.baselineSelect.innerHTML = '<option value="">Select a snapshot…</option>';
  els.candidateSelect.innerHTML = '<option value="current">Current overview snapshot</option>';
  compareTouched = false;
  compareAutoSelected = false;
  els.compareResults.hidden = true;
  els.compareStatus.textContent = 'Load a baseline and candidate';
  els.compareTable.dataset.items = '';
  discoverSnapshots();
}
els.clearSnapshots.addEventListener('click', clearSnapshots);
function updateSaveSnapshotButton() {
  const option = els.liveSelect.selectedOptions[0];
  const canSave = option?.value === 'live' || option?.dataset.live === 'true';
  els.saveSnapshot.disabled = !canSave;
  els.saveSnapshot.title = canSave ? 'Copy the selected live PMON export into the configured snapshot archive' : 'Select a live PMON export to archive it';
}
els.liveSelect.addEventListener('change', () => {
  const selected = els.liveSelect.value;
  updateSaveSnapshotButton();
  if (selected === 'live') { refreshLiveSnapshots(true); return; }
  const snapshot = snapshots.get(selected);
  if (snapshot) render(snapshot.data, snapshot.source);
});
els.saveSnapshot.addEventListener('click', async () => {
  const option = els.liveSelect.selectedOptions[0];
  const body = option?.value.startsWith('remote:') ? {filename: option.value.slice('remote:'.length)} : {};
  els.saveSnapshot.disabled = true;
  els.liveStatus.textContent = 'Saving selected PMON export…';
  try {
    const response = await fetch('api/snapshot', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), cache:'no-store'});
    const responseText = await response.text();
    let result = {};
    try { result = JSON.parse(responseText); } catch { result = {message:responseText.replace(/<[^>]*>/g, ' ').trim()}; }
    if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
    await discoverSnapshots();
    els.liveStatus.textContent = `Saved ${result.source} as ${result.saved}`;
  } catch (error) {
    els.liveStatus.textContent = `Snapshot failed: ${error.message}`;
  } finally { updateSaveSnapshotButton(); }
});
[els.compareType, els.compareSearch].forEach(element => element.addEventListener('input', () => renderComparison()));

const categoryTips = { Trigger: 'Engine ProcessTriggers → Trigger::Check → IsActive.', Value: 'CalculatedValue::Get → Calculate, subject to a check interval.', Action: 'Engine queue → ListenAndExecute → action Execute when eligible.', RndBot: 'RandomPlayerbotMgr/factory lifecycle work, scheduled separately.' };
const categoryHelp = {
  Trigger: '<b>Trigger</b> measures <code>Engine::ProcessTriggers()</code> around <code>Trigger::Check()</code>, which calls <code>IsActive()</code>. The engine de-duplicates the same Trigger object within one pass. <code>needCheck()</code> honours its interval; intervals below 2 run every pass, while an out-of-combat pending force-rebuff evaluates non-debuff buff triggers every pass. High calls/tick is therefore not automatically a regression.',
  Value: '<b>Value</b> measures <code>CalculatedValue::Calculate()</code>, not every value read. A check interval below 2 recalculates on every access; otherwise it recalculates only after that interval. A value name with a bracketed stack suffix identifies the action/trigger path that caused that calculation. Before caching or changing intervals, confirm the value is not intentionally freshness-sensitive.',
  Action: '<b>Action</b> is recorded only after the engine has initialised the action, passed <code>isUseful()</code>, multiplier checks, <code>isPossible()</code>, and any prerequisite scheduling. The timed scope contains <code>ListenAndExecute()</code>: execution listeners, <code>Action::Execute()</code> when allowed, result overrides, and after-listeners. It does not represent actions rejected earlier in the queue.',
  RndBot: '<b>RndBot</b> covers named work in <code>RandomPlayerbotMgr</code> and <code>PlayerbotFactory</code>, such as refresh, teleport, login setup, and character initialisation. RandomPlayerbotMgr is called from the module’s world-update hook and schedules its next run from <code>randomBotUpdateInterval</code> and online-bot focus. Treat rare factory/refresh spikes separately from continuous per-bot AI cost.'
};
const metricHelp = {
  total: ['Total time', 'Cumulative measured microseconds across the whole capture. It favours work that is both expensive and frequent.'],
  share: ['Percentage scope', 'In <code>total</code> exports, percent is the share of all recorded <code>PlayerbotAI::UpdateAIInternal</code> time. In <code>tick</code> exports, it is the share of <code>PlayerbotAIBase::FullTick</code> time.'],
  tick: ['Time per tick', 'Total time divided by the number of complete playerbot ticks. This is normally the clearest optimisation priority because it expresses steady cost per tick.'],
  frequency: ['Calls per tick', 'Invocation count divided by complete ticks. A high value suggests polling or repeated recomputation; reduce calls only when doing so preserves bot behaviour.'],
  average: ['Average time', 'Total time divided by calls. This identifies how expensive one completed invocation is; compare it with calls/tick before prioritising it.'],
  range: ['Minimum and maximum', 'The fastest and slowest measured calls. A max far above the average is an outlier worth reproducing under the relevant game state.'],
  count: ['Calls', 'Every instrumented operation completion increments this count, including calls that measured zero elapsed microseconds. Very low counts make averages and maxima less representative.']
};
function openHelp(title, html) { els.dialogTitle.textContent = title; els.dialogContent.innerHTML = html; els.dialog.showModal(); }
function sourceNote() { return '<p class="source">Verified against this checkout: <code>mod-playerbots/src/Bot/Debug/PerfMonitor.cpp</code>, <code>Bot/Engine/{PlayerbotAIBase,Engine,Value/Value,Trigger/Trigger}.cpp</code>, <code>Bot/PlayerbotAI.cpp</code>, <code>Bot/RandomPlayerbotMgr.cpp</code>, <code>Script/Playerbots.cpp</code>, plus AzerothCore <code>src/server/game/Entities/Player/PlayerUpdates.cpp</code>.</p>'; }
function openGeneralHelp() {
  openHelp('Using PMON safely', `<h3>Where this runs</h3><p>AzerothCore calls <code>OnPlayerAfterUpdate</code> at the end of <code>Player::Update</code>. The playerbots script then invokes that player’s <code>PlayerbotAI::UpdateAI(diff)</code>. This is why the export is per-bot update work, not a complete server-frame profiler.</p><h3>What FullTick actually measures</h3><p><code>PlayerbotAIBase::FullTick</code> starts at the beginning of <code>UpdateAI</code> but is finished at the beginning of the next <code>UpdateAI</code>. Its duration is therefore the interval between calls, including delay/scheduling time; it is the denominator for <b>time/tick</b>, not a CPU-time scope to optimise directly. <code>PlayerbotAI::UpdateAIInternal …</code> surrounds the internal path containing external event setup, due chat replies, commands, packet handlers, and <code>DoNextAction()</code>.</p><h3>Recommended comparable capture</h3><p>The module’s pull-request template recommends a fixed bot load: set <code>BotActiveAlone = 100</code> and <code>botActiveAloneSmartScale = 0</code>, wait for bots to log in, run <code>playerbot pmon toggle</code>, then run <code>playerbot pmon stack</code> five minutes later. Use <code>playerbot pmon reset</code> before each independent capture.</p><h3>Commands and output</h3><ul><li><code>playerbot pmon toggle</code> — enable/disable collection.</li><li><code>playerbot pmon reset</code> — clear cumulative samples.</li><li><code>playerbot pmon</code> — total-mode JSON; percentages use accumulated UpdateAIInternal time.</li><li><code>playerbot pmon tick</code> — tick-mode JSON; percentages use accumulated FullTick interval.</li><li><code>playerbot pmon stack</code> — total-mode JSON retaining stack-qualified names.</li></ul><h3>Do not add Total rows</h3><p>The Total metric contains overlapping scopes: FullTick contains UpdateAI work, while category rows can be nested beneath actions or triggers. This dashboard excludes Total rows from cost rankings and only uses their exported denominators.</p>${sourceNote()}`);
}
function openOperationHelp(row) {
  const scope = model.data.mode === 'tick' ? 'FullTick' : 'UpdateAIInternal';
  const stackHint = row.name.includes('[') ? '<p>The bracketed suffix is the recorded performance stack: it identifies the execution context that reached this operation. The same leaf can therefore appear more than once under different paths.</p>' : '';
  const confidence = row.count < 20 ? '<p><b>Interpret cautiously:</b> this has fewer than 20 samples, so its average and maximum may be dominated by a single event.</p>' : '';
  openHelp(`${row.type}: ${row.name}`, `<h3>What this measures</h3><p>${categoryHelp[row.type] || 'Instrumented playerbot work.'}</p>${stackHint}<h3>This capture</h3><ul><li><b>${us(row.timePerTick)} per tick</b> · ${n.format(row.percent)}% of recorded ${scope} timing</li><li><b>${us(row.avgTime)} average</b> across ${n.format(row.count)} calls (${n.format(row.callsPerTick)} calls/tick)</li><li><b>${us(row.minTime)} to ${us(row.maxTime)}</b> per call · ${duration(row.totalTime)} cumulative</li></ul>${confidence}<h3>Investigate next</h3><p>Start with the call site and its dependencies, then take a fresh, reset capture under the same load. Improve the highest time/tick work first; use max time to find exceptional paths rather than ranking by max alone.</p>${sourceNote()}`);
}
els.help.addEventListener('click', openGeneralHelp);
els.dialogClose.addEventListener('click', () => els.dialog.close());
els.dialog.addEventListener('click', e => { if (e.target === els.dialog) els.dialog.close(); });
document.querySelectorAll('.th-help').forEach(button => button.addEventListener('click', () => { const [title, text] = metricHelp[button.dataset.help]; openHelp(title, `<p>${text}</p>${sourceNote()}`); }));
els.table.addEventListener('click', e => { const tr = e.target.closest('tr[data-row-id]'); if (!tr || !model) return; const row = model.rows.find(r => r.id === tr.dataset.rowId); if (row) openOperationHelp(row); });

// The server resolves the newest export directly from its configured source/archive directories.
// Ignore errors when the dashboard is opened without the custom PMON server.
async function refreshLiveSnapshots(force = false) {
  try {
    const response = await fetch(`latest-pmon_total.json?refresh=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    // Do not replace a manually opened file; continuously update the live dashboard only.
    if (force || !model || model.source === 'live pmon_total.json') {
      if (force || !model || data.generatedAt !== model.data.generatedAt) render(data, 'live pmon_total.json');
    }
    await discoverSnapshots();
  } catch { /* Server may not be running when index.html is opened directly. */ }
}
refreshLiveSnapshots();
setInterval(refreshLiveSnapshots, 15000);
