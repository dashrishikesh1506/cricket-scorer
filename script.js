/* ============== DATA LAYER (talks to Python backend) ============== */
let DB = { matches: [] };
let currentMatchId = null;

async function loadDataFromServer(){
  try{
    const res = await fetch('/api/data');
    DB = await res.json();
  }catch(e){
    console.error('Could not load data from server', e);
    alert('Could not connect to the Python server. Make sure app.py is running.');
  }
}

function saveData(data){
  fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).catch(e => console.error('Save failed', e));
}

/* ============== NAVIGATION ============== */
function goTo(viewId){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.querySelectorAll('nav button').forEach(b=>{
    b.classList.toggle('active', b.dataset.view === viewId);
  });
  if(viewId === 'homeView') renderHome();
  if(viewId === 'historyView') renderHistory();
  if(viewId === 'statsView') renderStats();
  if(viewId === 'liveView' && currentMatchId) renderLive();
}
document.querySelectorAll('nav button').forEach(b=>{
  b.addEventListener('click', ()=>goTo(b.dataset.view));
});

/* ============== HELPERS ============== */
function uid(){ return 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }
function splitPlayers(str){
  return str.split(',').map(s=>s.trim()).filter(Boolean);
}
function ballsToOvers(balls){
  const o = Math.floor(balls/6);
  const b = balls%6;
  return `${o}.${b}`;
}
function strikeRate(runs, balls){
  if(balls===0) return '0.0';
  return ((runs/balls)*100).toFixed(1);
}
function economy(runs, balls){
  if(balls===0) return '0.00';
  return (runs/(balls/6)).toFixed(2);
}
function findMatch(id){
  return DB.matches.find(m=>m.id===id);
}

/* ============== CREATE MATCH ============== */
function createMatch(){
  const teamAName = document.getElementById('teamAName').value.trim() || 'Team A';
  const teamBName = document.getElementById('teamBName').value.trim() || 'Team B';
  const teamAPlayers = splitPlayers(document.getElementById('teamAPlayers').value);
  const teamBPlayers = splitPlayers(document.getElementById('teamBPlayers').value);
  const oversLimit = parseInt(document.getElementById('oversLimit').value) || 20;
  const battingFirst = document.getElementById('battingFirst').value;

  if(teamAPlayers.length < 2 || teamBPlayers.length < 2){
    alert('Please add at least 2 players for each team.');
    return;
  }

  const battingTeamName = battingFirst === 'A' ? teamAName : teamBName;
  const bowlingTeamName = battingFirst === 'A' ? teamBName : teamAName;

  const match = {
    id: uid(),
    date: new Date().toISOString(),
    teamA: { name: teamAName, players: teamAPlayers },
    teamB: { name: teamBName, players: teamBPlayers },
    oversLimit: oversLimit,
    status: 'setup',
    currentInningsIndex: 0,
    innings: [ makeInnings(battingTeamName, bowlingTeamName) ],
    result: null
  };
  DB.matches.push(match);
  saveData(DB);
  currentMatchId = match.id;

  populateOpenSetup(match);
}

function makeInnings(battingTeam, bowlingTeam){
  return {
    battingTeam, bowlingTeam,
    totalRuns:0, totalWickets:0, totalBalls:0,
    batsmen:{},
    bowlers:{},
    battingOrder:[],
    overHistory:[],
    currentOverEvents:[],
    striker:null, nonStriker:null, bowler:null,
    lastBowler:null,
    closed:false
  };
}

/* ============== OPENERS SETUP ============== */
function populateOpenSetup(match){
  const innings = match.innings[0];
  const battingPlayers = (match.teamA.name === innings.battingTeam ? match.teamA.players : match.teamB.players);
  const bowlingPlayers = (match.teamA.name === innings.bowlingTeam ? match.teamA.players : match.teamB.players);

  fillSelect('openStriker', battingPlayers);
  fillSelect('openNonStriker', battingPlayers);
  fillSelect('openBowler', bowlingPlayers);
  document.getElementById('openBowlTeamLabel').textContent = innings.bowlingTeam;

  if(battingPlayers.length>1) document.getElementById('openNonStriker').selectedIndex = 1;

  document.getElementById('openSetupModal').classList.add('active');
}
function fillSelect(id, arr){
  const sel = document.getElementById(id);
  sel.innerHTML = arr.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
}
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function confirmOpeners(){
  const match = findMatch(currentMatchId);
  const striker = document.getElementById('openStriker').value;
  const nonStriker = document.getElementById('openNonStriker').value;
  const bowler = document.getElementById('openBowler').value;
  if(striker === nonStriker){ alert('Striker and non-striker must be different players.'); return; }

  const innings = match.innings[0];
  innings.striker = striker;
  innings.nonStriker = nonStriker;
  innings.bowler = bowler;
  initBatsman(innings, striker);
  initBatsman(innings, nonStriker);
  initBowler(innings, bowler);
  match.status = 'live';
  saveData(DB);
  closeModal('openSetupModal');
  goTo('liveView');
}

function initBatsman(innings, name){
  if(!innings.batsmen[name]){
    innings.batsmen[name] = { runs:0, balls:0, fours:0, sixes:0, out:false, howOut:'', order: innings.battingOrder.length+1 };
    innings.battingOrder.push(name);
  }
}
function initBowler(innings, name){
  if(!innings.bowlers[name]){
    innings.bowlers[name] = { balls:0, runs:0, wickets:0, maidens:0, currentOverRuns:0 };
  }
}

/* ============== LIVE SCORING ============== */
function getCurrentMatch(){ return findMatch(currentMatchId); }

function resumeMatch(){
  const live = DB.matches.find(m=>m.status==='live' || m.status==='innings_break');
  if(live){ currentMatchId = live.id; goTo('liveView'); }
}

function renderLive(){
  const match = getCurrentMatch();
  const c = document.getElementById('liveContent');
  if(!match){ c.innerHTML = '<div class="empty">No live match. Start a new one!</div>'; return; }

  if(match.status === 'complete'){
    c.innerHTML = renderCompletedSummary(match) +
      `<div class="card"><button class="btn" onclick="goTo('historyView')">View Full Scorecard</button> <button class="btn secondary" onclick="currentMatchId=null;goTo('newMatchView')">Start Another Match</button></div>`;
    return;
  }

  const inn = match.innings[match.currentInningsIndex];
  const target = match.currentInningsIndex===1 ? match.innings[0].totalRuns+1 : null;

  let html = '';
  html += `<div class="score-banner">
    <div>
      <div class="sub">${escapeHtml(inn.battingTeam)} batting ${target?`(target ${target})`:''}</div>
      <div class="big">${inn.totalRuns}/${inn.totalWickets} <span style="font-size:16px;font-weight:400;">(${ballsToOvers(inn.totalBalls)} ov)</span></div>
    </div>
    <div style="text-align:right;">
      <div class="sub">Overs limit: ${match.oversLimit}</div>
      <div class="sub">Run rate: ${inn.totalBalls? (inn.totalRuns/(inn.totalBalls/6)).toFixed(2):'0.00'}</div>
      ${target? `<div class="sub">Need ${Math.max(target-inn.totalRuns,0)} from ${Math.max(match.oversLimit*6-inn.totalBalls,0)} balls</div>`:''}
    </div>
  </div>`;

  html += `<div class="card"><h2>Batting</h2><table>
    <tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
    ${inn.battingOrder.map(name=>{
      const b = inn.batsmen[name];
      const tag = name===inn.striker?' *':(name===inn.nonStriker?'':'');
      const status = b.out ? `<span class="muted">(${b.howOut})</span>` : (name===inn.striker||name===inn.nonStriker? '' : '<span class="muted">yet to bat</span>');
      if(!b.out && name!==inn.striker && name!==inn.nonStriker) return '';
      return `<tr><td>${escapeHtml(name)}${tag} ${status}</td><td>${b.runs}</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${strikeRate(b.runs,b.balls)}</td></tr>`;
    }).join('')}
  </table></div>`;

  const bowler = inn.bowlers[inn.bowler];
  html += `<div class="card"><h2>Bowling</h2><table>
    <tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr>
    <tr><td>${escapeHtml(inn.bowler)} *</td><td>${ballsToOvers(bowler.balls)}</td><td>${bowler.runs}</td><td>${bowler.wickets}</td><td>${economy(bowler.runs,bowler.balls)}</td></tr>
  </table>
  <div class="over-history">${inn.currentOverEvents.map(e=>`<span class="${e.cls}">${e.label}</span>`).join('')}</div>
  </div>`;

  html += `<div class="card">
    <h2>Score this ball</h2>
    <div class="ball-buttons">
      ${[0,1,2,3,4,5,6].map(r=>`<button onclick="scoreBall(${r})" class="${r===4||r===6?'extra':''}">${r}</button>`).join('')}
    </div>
    <div class="ball-buttons">
      <button class="extra" onclick="scoreExtra('wide')">Wide</button>
      <button class="extra" onclick="scoreExtra('noball')">No Ball</button>
      <button class="extra" onclick="scoreExtra('bye')">Bye</button>
      <button class="extra" onclick="scoreExtra('legbye')">Leg Bye</button>
      <button class="wicket" onclick="openWicketModal()">Wicket</button>
    </div>
    <button class="btn secondary small" onclick="undoLastBall()" style="margin-top:8px;">↶ Undo Last Ball</button>
    <button class="btn danger small" onclick="endInningsManually()" style="margin-top:8px;margin-left:8px;">End Innings</button>
  </div>`;

  c.innerHTML = html;
}

function recordOverEvent(label, cls){
  const match = getCurrentMatch();
  const inn = match.innings[match.currentInningsIndex];
  inn.currentOverEvents.push({label, cls: cls||''});
}

function pushHistorySnapshot(){
  const match = getCurrentMatch();
  match._lastSnapshot = JSON.parse(JSON.stringify(match.innings[match.currentInningsIndex]));
}

function undoLastBall(){
  const match = getCurrentMatch();
  if(!match._lastSnapshot){ alert('Nothing to undo.'); return; }
  match.innings[match.currentInningsIndex] = match._lastSnapshot;
  match._lastSnapshot = null;
  saveData(DB);
  renderLive();
}

function scoreBall(runs){
  pushHistorySnapshot();
  const match = getCurrentMatch();
  const inn = match.innings[match.currentInningsIndex];
  const bat = inn.batsmen[inn.striker];
  const bowl = inn.bowlers[inn.bowler];

  bat.runs += runs;
  bat.balls += 1;
  if(runs===4) bat.fours++;
  if(runs===6) bat.sixes++;

  bowl.runs += runs;
  bowl.balls += 1;

  inn.totalRuns += runs;
  inn.totalBalls += 1;

  recordOverEvent(runs.toString(), runs>=4?'boundary':'');

  if(runs%2===1) swapStrike(inn);

  afterBall(match, inn);
}

function scoreExtra(type){
  pushHistorySnapshot();
  const match = getCurrentMatch();
  const inn = match.innings[match.currentInningsIndex];
  const bowl = inn.bowlers[inn.bowler];

  if(type==='wide' || type==='noball'){
    inn.totalRuns += 1;
    bowl.runs += 1;
    recordOverEvent(type==='wide'?'Wd':'Nb','extra');
  } else if(type==='bye' || type==='legbye'){
    inn.totalRuns += 1;
    inn.totalBalls += 1;
    bowl.balls += 1;
    const bat = inn.batsmen[inn.striker];
    bat.balls += 1;
    recordOverEvent(type==='bye'?'B':'Lb','extra');
    swapStrike(inn);
  }

  afterBall(match, inn, type==='wide'||type==='noball');
}

function swapStrike(inn){
  const tmp = inn.striker;
  inn.striker = inn.nonStriker;
  inn.nonStriker = tmp;
}

function afterBall(match, inn, skipOverCheck){
  saveData(DB);

  const allOut = (inn.totalWickets >= teamPlayerCount(match, inn.battingTeam) - 1);
  const oversDone = inn.totalBalls >= match.oversLimit*6;
  const target = match.currentInningsIndex===1 ? match.innings[0].totalRuns+1 : null;
  const chased = target && inn.totalRuns >= target;

  if(allOut || oversDone || chased){
    closeInnings(match);
    return;
  }

  if(!skipOverCheck && inn.totalBalls>0 && inn.totalBalls % 6 === 0){
    inn.lastBowler = inn.bowler;
    inn.overHistory.push(inn.currentOverEvents);
    inn.currentOverEvents = [];
    swapStrike(inn);
    saveData(DB);
    openBowlerModal(match, inn);
    return;
  }

  renderLive();
}

function teamPlayerCount(match, teamName){
  if(match.teamA.name === teamName) return match.teamA.players.length;
  if(match.teamB.name === teamName) return match.teamB.players.length;
  return 11;
}

/* ============== WICKET HANDLING ============== */
function openWicketModal(){
  const match = getCurrentMatch();
  const inn = match.innings[match.currentInningsIndex];
  const battingPlayers = (match.teamA.name === inn.battingTeam ? match.teamA.players : match.teamB.players);
  const remaining = battingPlayers.filter(p => !inn.batsmen[p] || !inn.batsmen[p].out).filter(p => p!==inn.striker && p!==inn.nonStriker);
  fillSelect('nextBatsman', remaining.length? remaining : ['(none - all out)']);
  document.getElementById('wicketModal').classList.add('active');
}
function closeModal(id){ document.getElementById(id).classList.remove('active'); }

function confirmWicket(){
  pushHistorySnapshot();
  const match = getCurrentMatch();
  const inn = match.innings[match.currentInningsIndex];
  const dismissal = document.getElementById('dismissalType').value;
  const nextBatsman = document.getElementById('nextBatsman').value;
  const bowl = inn.bowlers[inn.bowler];

  const outBatsman = inn.striker;
  inn.batsmen[outBatsman].out = true;
  inn.batsmen[outBatsman].howOut = dismissal + (dismissal==='Run Out'?'':` b ${inn.bowler}`);
  inn.batsmen[outBatsman].balls += 1;

  bowl.balls += 1;
  if(dismissal !== 'Run Out') bowl.wickets += 1;

  inn.totalWickets += 1;
  inn.totalBalls += 1;
  recordOverEvent('W','w');

  closeModal('wicketModal');

  const allOut = (inn.totalWickets >= teamPlayerCount(match, inn.battingTeam) - 1);
  if(allOut){
    saveData(DB);
    closeInnings(match);
    return;
  }

  if(nextBatsman && nextBatsman !== '(none - all out)'){
    initBatsman(inn, nextBatsman);
    inn.striker = nextBatsman;
  }

  afterBall(match, inn);
}

/* ============== BOWLER CHANGE ============== */
function openBowlerModal(match, inn){
  const bowlingPlayers = (match.teamA.name === inn.bowlingTeam ? match.teamA.players : match.teamB.players);
  const eligible = bowlingPlayers.filter(p=>p!==inn.lastBowler);
  fillSelect('nextBowler', eligible.length? eligible : bowlingPlayers);
  document.getElementById('bowlerModal').classList.add('active');
}
function confirmNextBowler(){
  const match = getCurrentMatch();
  const inn = match.innings[match.currentInningsIndex];
  const bowler = document.getElementById('nextBowler').value;
  inn.bowler = bowler;
  initBowler(inn, bowler);
  closeModal('bowlerModal');
  saveData(DB);
  renderLive();
}

/* ============== INNINGS / MATCH END ============== */
function endInningsManually(){
  if(confirm('End this innings now?')){
    const match = getCurrentMatch();
    closeInnings(match);
  }
}

function closeInnings(match){
  const inn = match.innings[match.currentInningsIndex];
  inn.overHistory.push(inn.currentOverEvents);
  inn.closed = true;
  saveData(DB);

  if(match.currentInningsIndex === 0){
    match.status = 'innings_break';
    saveData(DB);
    openInningsBreak(match);
  } else {
    finishMatch(match);
  }
}

function openInningsBreak(match){
  const inn1 = match.innings[0];
  document.getElementById('inningsBreakTitle').textContent = `${inn1.battingTeam} innings complete`;
  document.getElementById('inningsBreakSummary').textContent =
    `${inn1.battingTeam} scored ${inn1.totalRuns}/${inn1.totalWickets} in ${ballsToOvers(inn1.totalBalls)} overs. ${inn1.bowlingTeam} need ${inn1.totalRuns+1} to win.`;

  const battingTeam2 = inn1.bowlingTeam;
  const bowlingTeam2 = inn1.battingTeam;
  const battingPlayers = (match.teamA.name === battingTeam2 ? match.teamA.players : match.teamB.players);
  const bowlingPlayers = (match.teamA.name === bowlingTeam2 ? match.teamA.players : match.teamB.players);

  fillSelect('i2Striker', battingPlayers);
  fillSelect('i2NonStriker', battingPlayers);
  fillSelect('i2Bowler', bowlingPlayers);
  if(battingPlayers.length>1) document.getElementById('i2NonStriker').selectedIndex = 1;

  document.getElementById('inningsBreakModal').classList.add('active');
}

function startSecondInnings(){
  const match = getCurrentMatch();
  const inn1 = match.innings[0];
  const battingTeam2 = inn1.bowlingTeam;
  const bowlingTeam2 = inn1.battingTeam;

  const striker = document.getElementById('i2Striker').value;
  const nonStriker = document.getElementById('i2NonStriker').value;
  const bowler = document.getElementById('i2Bowler').value;
  if(striker === nonStriker){ alert('Striker and non-striker must be different.'); return; }

  const inn2 = makeInnings(battingTeam2, bowlingTeam2);
  inn2.striker = striker;
  inn2.nonStriker = nonStriker;
  inn2.bowler = bowler;
  initBatsman(inn2, striker);
  initBatsman(inn2, nonStriker);
  initBowler(inn2, bowler);

  match.innings.push(inn2);
  match.currentInningsIndex = 1;
  match.status = 'live';
  saveData(DB);
  closeModal('inningsBreakModal');
  renderLive();
}

function finishMatch(match){
  const inn1 = match.innings[0], inn2 = match.innings[1];
  let result;
  if(inn2.totalRuns > inn1.totalRuns){
    result = `${inn2.battingTeam} won by ${teamPlayerCount(match, inn2.battingTeam)-1-inn2.totalWickets} wickets`;
  } else if(inn1.totalRuns > inn2.totalRuns){
    result = `${inn1.battingTeam} won by ${inn1.totalRuns-inn2.totalRuns} runs`;
  } else {
    result = 'Match tied';
  }
  match.result = result;
  match.status = 'complete';
  saveData(DB);
  renderLive();
}

function renderCompletedSummary(match){
  const inn1 = match.innings[0], inn2 = match.innings[1];
  return `<div class="card">
    <h2>Match Complete 🏆</h2>
    <p><strong>${escapeHtml(match.result)}</strong></p>
    <p>${escapeHtml(inn1.battingTeam)}: ${inn1.totalRuns}/${inn1.totalWickets} (${ballsToOvers(inn1.totalBalls)} ov)<br>
    ${escapeHtml(inn2.battingTeam)}: ${inn2.totalRuns}/${inn2.totalWickets} (${ballsToOvers(inn2.totalBalls)} ov)</p>
  </div>`;
}

/* ============== HOME / HISTORY RENDER ============== */
function renderHome(){
  const liveMatch = DB.matches.find(m=>m.status==='live'||m.status==='innings_break');
  document.getElementById('resumeBtn').style.display = liveMatch ? 'inline-block' : 'none';

  const recent = [...DB.matches].reverse().slice(0,5);
  const el = document.getElementById('recentMatchesList');
  if(recent.length===0){ el.innerHTML = '<div class="empty">No matches yet. Start your first match!</div>'; return; }
  el.innerHTML = recent.map(m=>matchListItemHtml(m)).join('');
}

function matchListItemHtml(m){
  const dateStr = new Date(m.date).toLocaleDateString();
  let scoreLine = '';
  if(m.innings[0]){
    scoreLine = `${m.innings[0].battingTeam} ${m.innings[0].totalRuns}/${m.innings[0].totalWickets}`;
    if(m.innings[1]) scoreLine += ` vs ${m.innings[1].battingTeam} ${m.innings[1].totalRuns}/${m.innings[1].totalWickets}`;
  }
  const statusTag = m.status==='complete' ? `<span class="tag">${escapeHtml(m.result||'Complete')}</span>` : `<span class="tag live">LIVE</span>`;
  return `<div class="match-list-item" onclick="openFromHistory('${m.id}')">
    <div><strong>${escapeHtml(m.teamA.name)} vs ${escapeHtml(m.teamB.name)}</strong><br><span class="muted">${dateStr} · ${scoreLine}</span></div>
    ${statusTag}
  </div>`;
}

function openFromHistory(id){
  const m = findMatch(id);
  if(m.status==='complete'){
    showScorecard(m);
    goTo('historyView');
  } else {
    currentMatchId = id;
    goTo('liveView');
  }
}

function renderHistory(){
  const el = document.getElementById('historyList');
  if(DB.matches.length===0){ el.innerHTML='<div class="empty">No matches recorded yet.</div>'; return; }
  el.innerHTML = [...DB.matches].reverse().map(m=>matchListItemHtml(m)).join('');
  document.getElementById('scorecardCard').style.display='none';
}

function showScorecard(match){
  document.getElementById('scorecardCard').style.display='block';
  document.getElementById('scorecardTitle').textContent = `${match.teamA.name} vs ${match.teamB.name} — ${match.result||'In progress'}`;
  let html = '';
  match.innings.forEach(inn=>{
    html += `<h3>${escapeHtml(inn.battingTeam)} — ${inn.totalRuns}/${inn.totalWickets} (${ballsToOvers(inn.totalBalls)} ov)</h3>`;
    html += `<table><tr><th>Batsman</th><th>Dismissal</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>`;
    inn.battingOrder.forEach(name=>{
      const b = inn.batsmen[name];
      html += `<tr><td>${escapeHtml(name)}</td><td class="muted">${b.out? b.howOut : 'not out'}</td><td>${b.runs}</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${strikeRate(b.runs,b.balls)}</td></tr>`;
    });
    html += `</table><br>`;
    html += `<table><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr>`;
    Object.keys(inn.bowlers).forEach(name=>{
      const bw = inn.bowlers[name];
      html += `<tr><td>${escapeHtml(name)}</td><td>${ballsToOvers(bw.balls)}</td><td>${bw.runs}</td><td>${bw.wickets}</td><td>${economy(bw.runs,bw.balls)}</td></tr>`;
    });
    html += `</table><br>`;
  });
  document.getElementById('scorecardContent').innerHTML = html;
}

/* ============== PLAYER STATS VIEW ============== */
let statsTab = 'batting';
function switchStatTab(tab){
  statsTab = tab;
  document.querySelectorAll('.player-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  renderStats();
}

function renderStats(){
  const battingAgg = {};
  const bowlingAgg = {};

  DB.matches.forEach(m=>{
    m.innings.forEach(inn=>{
      Object.keys(inn.batsmen).forEach(name=>{
        const b = inn.batsmen[name];
        if(!battingAgg[name]) battingAgg[name] = {runs:0,balls:0,fours:0,sixes:0,innings:0,outs:0,best:0};
        const agg = battingAgg[name];
        agg.runs += b.runs; agg.balls += b.balls; agg.fours += b.fours; agg.sixes += b.sixes;
        agg.innings += 1;
        if(b.out) agg.outs += 1;
        if(b.runs > agg.best) agg.best = b.runs;
      });
      Object.keys(inn.bowlers).forEach(name=>{
        const bw = inn.bowlers[name];
        if(!bowlingAgg[name]) bowlingAgg[name] = {balls:0,runs:0,wickets:0,innings:0};
        const agg = bowlingAgg[name];
        agg.balls += bw.balls; agg.runs += bw.runs; agg.wickets += bw.wickets;
        agg.innings += 1;
      });
    });
  });

  const el = document.getElementById('statsContent');
  if(statsTab==='batting'){
    const names = Object.keys(battingAgg);
    if(names.length===0){ el.innerHTML='<div class="empty">No batting data yet.</div>'; return; }
    names.sort((a,b)=>battingAgg[b].runs-battingAgg[a].runs);
    el.innerHTML = `<table><tr><th>Player</th><th>Inn</th><th>Runs</th><th>Best</th><th>Avg</th><th>SR</th><th>4s</th><th>6s</th></tr>
      ${names.map(n=>{
        const a = battingAgg[n];
        const avg = a.outs>0 ? (a.runs/a.outs).toFixed(1) : a.runs.toFixed(1);
        return `<tr><td>${escapeHtml(n)}</td><td>${a.innings}</td><td>${a.runs}</td><td>${a.best}</td><td>${avg}</td><td>${strikeRate(a.runs,a.balls)}</td><td>${a.fours}</td><td>${a.sixes}</td></tr>`;
      }).join('')}
    </table>`;
  } else {
    const names = Object.keys(bowlingAgg);
    if(names.length===0){ el.innerHTML='<div class="empty">No bowling data yet.</div>'; return; }
    names.sort((a,b)=>bowlingAgg[b].wickets-bowlingAgg[a].wickets);
    el.innerHTML = `<table><tr><th>Player</th><th>Inn</th><th>Overs</th><th>Runs</th><th>Wkts</th><th>Econ</th></tr>
      ${names.map(n=>{
        const a = bowlingAgg[n];
        return `<tr><td>${escapeHtml(n)}</td><td>${a.innings}</td><td>${ballsToOvers(a.balls)}</td><td>${a.runs}</td><td>${a.wickets}</td><td>${economy(a.runs,a.balls)}</td></tr>`;
      }).join('')}
    </table>`;
  }
}

/* ============== INIT ============== */
loadDataFromServer().then(() => {
  renderHome();
});