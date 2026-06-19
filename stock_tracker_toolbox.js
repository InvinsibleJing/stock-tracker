// ===== 工具箱 JS =====

// ===== 工具箱 Tab 切换 =====
var currentToolboxTab = 'calendar';
var calYear = null, calMonth = null;

function switchToolboxTab(name) {
  currentToolboxTab = name;
  document.querySelectorAll('.toolbox-tab').forEach(function(t){ t.classList.remove('active'); });
  // 给当前选中的tab加回active
  var map = { calendar:'tb-cal', holdings:'tb-hold', notes:'tb-note' };
  var cls = map[name];
  if(cls){
    var el = document.querySelector('.toolbox-tab.' + cls);
    if(el) el.classList.add('active');
  }
  document.getElementById('toolboxCalendar').style.display = name==='calendar' ? 'block' : 'none';
  document.getElementById('toolboxHoldings').style.display = name==='holdings' ? 'block' : 'none';
  document.getElementById('toolboxNotes').style.display = name==='notes' ? 'block' : 'none';
  if(name==='calendar') renderCalendar();
  if(name==='holdings') renderHoldingsAnalysis();
  if(name==='notes') renderNotes();
}

// ===== 盈亏日历 =====
function initCalYearMonth() {
  if(calYear !== null && calMonth !== null) return;
  var now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}

function renderCalendar() {
  initCalYearMonth();
  var monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  document.getElementById('calMonthLabel').textContent = calYear + '年 ' + monthNames[calMonth];

  var firstDay = new Date(calYear, calMonth, 1);
  var lastDay = new Date(calYear, calMonth + 1, 0);
  // getDay(): 0=周日,1=周一...6=周六 → 转为周一=0: (getDay()+6)%7
  var startWeekday = (firstDay.getDay() + 6) % 7;
  var daysInMonth = lastDay.getDate();

  // 按日期聚合盈亏（排除做T）
  var dayProfit = {};
  for(var i = 0; i < trades.length; i++) {
    var t = trades[i];
    if(t.tIndex > 0) continue;
    var d = t.date;
    if(!dayProfit[d]) dayProfit[d] = 0;
    dayProfit[d] += (t.amount || 0);
  }

  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

  var html = '';
  // 星期头：周一~周日
  var weekdays = ['一','二','三','四','五','六','日'];
  for(var i = 0; i < 7; i++) {
    var thCls = 'cal-day-header';
    if(i === 5) thCls += ' sat'; // 周六
    if(i === 6) thCls += ' sun'; // 周日
    html += '<div class="' + thCls + '">' + weekdays[i] + '</div>';
  }

  // 月初留空（前面补空白格子）
  for(var i = 0; i < startWeekday; i++) {
    html += '<div class="cal-day-cell empty"></div>';
  }

  // 当月日期
  for(var d = 1; d <= daysInMonth; d++) {
    // 计算这天是星期几（0=周一...6=周日）
    var weekday = (startWeekday + d - 1) % 7;
    var ds = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var profit = dayProfit[ds];
    var cls = 'cal-day-cell';
    if(profit > 0) cls += ' profit';      // 盈利→红色
    else if(profit < 0) cls += ' loss';    // 亏损→绿色
    else cls += ' no-trade';
    if(ds === todayStr) cls += ' today';
    if(profit !== undefined && profit !== 0) cls += ' has-trade';
    if(weekday === 5) cls += ' sat'; // 周六
    if(weekday === 6) cls += ' sun'; // 周日
    // 构建日期格子HTML（含盈亏金额角标）
    var inner = '<span class="cal-day-num">' + d + '</span>';
    if(profit !== undefined && profit !== 0) {
      var amtSign = profit > 0 ? '+' : '';
      var amtCls = profit > 0 ? 'cal-amount-profit' : 'cal-amount-loss';
      // 大金额缩写：超过1000显示k
      var amtText = Math.abs(profit) >= 10000 ? (profit / 10000).toFixed(1) + 'w' : (amtSign + profit.toFixed(0));
      inner += '<span class="cal-amount ' + amtCls + '">' + amtText + '</span>';
    }
    html += '<div class="' + cls + '" onclick="showCalDetail(\'' + ds + '\')">' + inner + '</div>';
  }

  // 计算本月总计盈亏
  var monthTotal = 0;
  for(var d = 1; d <= daysInMonth; d++) {
    var mds = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    monthTotal += (dayProfit[mds] || 0);
  }

  // 月末留空（后面补空白格子，保持7列对齐）
  var totalCells = startWeekday + daysInMonth;
  var remain = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for(var i = 0; i < remain; i++) {
    html += '<div class="cal-day-cell empty"></div>';
  }

  document.getElementById('calendarGrid').innerHTML = html;
  document.getElementById('calendarDetail').style.display = 'none';

  // 显示本月总计盈亏
  var totalEl = document.getElementById('calMonthTotal');
  if(totalEl) {
    var totalSign = monthTotal >= 0 ? '+' : '';
    var totalCls = monthTotal >= 0 ? 'profit' : 'loss';
    totalEl.innerHTML = '<span class="cal-total-label">本月共计盈亏金额：</span><span class="cal-total-value ' + totalCls + '">' + totalSign + monthTotal.toFixed(2) + ' 元</span>';
    totalEl.style.display = 'block';
  }
}

function calPrevMonth() {
  calMonth--;
  if(calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
}

function calNextMonth() {
  calMonth++;
  if(calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
}

function calGoTodayMonth() {
  var now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  renderCalendar();
}

function showCalDetail(dateStr) {
  var detail = document.getElementById('calendarDetail');
  detail.style.display = 'block';
  document.getElementById('calDetailTitle').textContent = dateStr + ' 交易详情';

  var dayTrades = [];
  for(var i = 0; i < trades.length; i++) {
    if(trades[i].date === dateStr && trades[i].tIndex === 0) {
      dayTrades.push(trades[i]);
    }
  }

  var html = '';
  if(dayTrades.length === 0) {
    html = '<p style="color:#999;font-size:13px;padding:8px 0">当天无已完结交易记录。</p>';
  } else {
    var total = 0;
    for(var i = 0; i < dayTrades.length; i++) {
      var t = dayTrades[i];
      var name = getStockName(t.code);
      var amt = t.amount || 0;
      total += amt;
      var cls = amt >= 0 ? 'profit' : 'loss';
      var sign = amt >= 0 ? '+' : '';
      html += '<div class="cal-detail-row">';
      html += '<span class="cal-detail-label">' + escapeHtml(name) + '</span>';
      html += '<span class="cal-detail-value ' + cls + '">' + sign + amt.toFixed(2) + ' 元</span>';
      html += '</div>';
    }
    html += '<div class="cal-detail-row" style="border-top:2px solid #ddd;padding-top:8px;margin-top:4px">';
    html += '<span class="cal-detail-label"><b>合计</b></span>';
    var totalCls = total >= 0 ? 'profit' : 'loss';
    var totalSign = total >= 0 ? '+' : '';
    html += '<span class="cal-detail-value ' + totalCls + '"><b>' + totalSign + total.toFixed(2) + ' 元</b></span>';
    html += '</div>';
  }
  document.getElementById('calDetailContent').innerHTML = html;
}

// ===== 持仓分析 =====
var tagPieChartInstance = null;
var accPieChartInstance = null;
var profitBarChartInstance = null;

function renderHoldingsAnalysis() {
  // 1. 板块分布饼图
  var tagCount = {};
  for(var i = 0; i < holdings.length; i++) {
    var tag = holdings[i].tag || '未分类';
    tagCount[tag] = (tagCount[tag] || 0) + 1;
  }
  var tagLabels = Object.keys(tagCount);
  var tagData = tagLabels.map(function(k){ return tagCount[k]; });
  var tagColors = ['#3498db','#e67e22','#2ecc71','#9b59b6','#e74c3c','#1abc9c','#f39c12','#34495e'];

  if(tagPieChartInstance) tagPieChartInstance.destroy();
  var ctx1 = document.getElementById('tagPieChart').getContext('2d');
  tagPieChartInstance = new Chart(ctx1, {
    type: 'pie',
    data: { labels: tagLabels, datasets: [{ data: tagData, backgroundColor: tagColors.slice(0, tagLabels.length) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });

  // 2. 账户分布饼图
  var accCount = { normal: 0, margin: 0 };
  for(var i = 0; i < holdings.length; i++) {
    var acc = holdings[i].accountType || 'normal';
    accCount[acc] = (accCount[acc] || 0) + 1;
  }
  var accLabels = [];
  var accData = [];
  var accColors = [];
  if((accCount.normal || 0) > 0) { accLabels.push('正常账户'); accData.push(accCount.normal); accColors.push('#3498db'); }
  if((accCount.margin || 0) > 0) { accLabels.push('两融账户'); accData.push(accCount.margin); accColors.push('#e67e22'); }

  if(accPieChartInstance) accPieChartInstance.destroy();
  var ctx2 = document.getElementById('accPieChart').getContext('2d');
  accPieChartInstance = new Chart(ctx2, {
    type: 'pie',
    data: { labels: accLabels, datasets: [{ data: accData, backgroundColor: accColors }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });

  // 3. 持仓成本条形图
  var stockLabels = [];
  var stockCosts = [];
  for(var i = 0; i < holdings.length; i++) {
    var h = holdings[i];
    var name = getStockName(h.code);
    stockLabels.push(name);
    stockCosts.push(((h.buyPrice || 0) * (h.quantity || 0)).toFixed(2));
  }

  if(profitBarChartInstance) profitBarChartInstance.destroy();
  var ctx3 = document.getElementById('profitBarChart').getContext('2d');
  profitBarChartInstance = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: stockLabels,
      datasets: [{ label: '持仓成本（元）', data: stockCosts, backgroundColor: '#3498db' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

// ===== 快速备忘 =====
var notes = [];
var NOTES_KEY = 'stock_notes';

function loadNotes() {
  try {
    var data = localStorage.getItem(NOTES_KEY);
    notes = data ? JSON.parse(data) : [];
  } catch(e) { notes = []; }
}

function saveNotes() {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function renderNotes() {
  loadNotes();
  var list = document.getElementById('notesList');
  if(notes.length === 0) {
    list.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0">暂无备忘，在上方输入添加。</p>';
    return;
  }
  var sorted = notes.slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  var html = '';
  for(var i = 0; i < sorted.length; i++) {
    var n = sorted[i];
    html += '<div class="note-item" data-id="' + escapeHtml(n.id || '') + '">';
    html += '<div class="note-item-content">';
    html += '<div class="note-item-date">' + escapeHtml(n.date) + '</div>';
    html += '<div class="note-item-text">' + escapeHtml(n.text) + '</div>';
    html += '</div>';
    html += '<button class="note-item-del" onclick="deleteNote(\'' + (n.id || '') + '\')" title="删除">✕</button>';
    html += '</div>';
  }
  list.innerHTML = html;
}

function addNote() {
  var dateInput = document.getElementById('noteDate');
  var textInput = document.getElementById('noteInput');
  var date = dateInput.value;
  var text = textInput.value.trim();
  if(!date) { alert('请选择日期'); return; }
  if(!text) { alert('请输入备忘内容'); return; }
  loadNotes();
  notes.push({ date: date, text: text, id: 'n_' + Date.now() });
  saveNotes();
  renderNotes();
  textInput.value = '';
}

function deleteNote(id) {
  if(!confirm('确定删除这条备忘吗？')) return;
  loadNotes();
  for(var i = 0; i < notes.length; i++) {
    if(notes[i].id === id) { notes.splice(i, 1); break; }
  }
  saveNotes();
  renderNotes();
}
