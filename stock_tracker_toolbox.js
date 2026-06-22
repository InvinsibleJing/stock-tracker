// ===== 工具箱 JS =====

// ===== 工具箱 Tab 切换 =====
var currentToolboxTab = 'calendar';
var calYear = null, calMonth = null;
var calSelectedDate = null;

function switchToolboxTab(name) {
  currentToolboxTab = name;
  document.querySelectorAll('.toolbox-tab').forEach(function(t){ t.classList.remove('active'); });
  var map = { calendar:'tb-cal', holdings:'tb-hold', notes:'tb-note', bazi:'tb-bazi' };
  var cls = map[name];
  if(cls){
    var el = document.querySelector('.toolbox-tab.' + cls);
    if(el) el.classList.add('active');
  }
  document.getElementById('toolboxCalendar').style.display = name==='calendar' ? 'block' : 'none';
  document.getElementById('toolboxHoldings').style.display = name==='holdings' ? 'block' : 'none';
  document.getElementById('toolboxNotes').style.display = name==='notes' ? 'block' : 'none';
  var baziEl = document.getElementById('toolboxBazi');
  if(baziEl) baziEl.style.display = name==='bazi' ? 'block' : 'none';
  if(name==='calendar') renderCalendar();
  if(name==='holdings') renderHoldingsAnalysis();
  if(name==='notes') renderNotes();
  if(name==='bazi') initBaziTab();
}

// ===== 盈亏日历 =====
function initCalYearMonth() {
  if(calYear !== null && calMonth !== null) return;
  var now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}

function selectCalDate(dateStr) {
  document.querySelectorAll('.calendar-grid .selected').forEach(function(el){
    el.classList.remove('selected');
  });
  var cells = document.querySelectorAll('.calendar-grid .cal-day-cell');
  for(var i = 0; i < cells.length; i++) {
    if(cells[i].getAttribute('data-date') === dateStr) {
      cells[i].classList.add('selected');
      break;
    }
  }
  calSelectedDate = dateStr;
  showCalDetail(dateStr);
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
    if(ds === todayStr && calSelectedDate === null) cls += ' selected';  // 默认选中今天
    if(ds === calSelectedDate) cls += ' selected';  // 用户选中的日期
    if(weekday === 5) cls += ' sat'; // 周六
    if(weekday === 6) cls += ' sun'; // 周日
    // 构建日期格子HTML（含盈亏金额角标）
    var inner = '<span class="cal-day-num">' + d + '</span>';
    if(profit !== undefined && profit !== 0) {
      var amtSign = profit > 0 ? '+' : '';
      var amtCls = profit > 0 ? 'cal-amount-profit' : 'cal-amount-loss';
      // 大金额缩写：超过10000显示w
      var amtText = Math.abs(profit) >= 10000 ? (profit / 10000).toFixed(1) + 'w' : (amtSign + profit.toFixed(0));
      inner += '<span class="cal-amount ' + amtCls + '">' + amtText + '</span>';
    }
    html += '<div class="' + cls + '" data-date="' + ds + '" onclick="selectCalDate(\'' + ds + '\')">' + inner + '</div>';
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
  calSelectedDate = null;
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

// ===== 快速备忘（GAS 后端）=====
var notes = [];
var noteEditingId = null; // 正在编辑的笔记ID
var noteToDelete = null;  // 待删除的笔记ID
var notesLoaded = false;  // 是否已从GAS加载过

// 预加载：页面打开后后台加载笔记数据
function preloadNotes() {
  loadNotes(function() { notesLoaded = true; });
}
// 备忘条目颜色池（循环使用）
var NOTE_COLORS = [
  { border: '#e67e22', time: '#d35400', code: '#e67e22' },  // 橙色
  { border: '#3498db', time: '#2980b9', code: '#3498db' },  // 蓝色
  { border: '#27ae60', time: '#1e8449', code: '#27ae60' },  // 绿色
  { border: '#9b59b6', time: '#8e44ad', code: '#9b59b6' },  // 紫色
  { border: '#e74c3c', time: '#c0392b', code: '#e74c3c' },  // 红色
  { border: '#f39c12', time: '#d68910', code: '#f39c12' },  // 金黄
  { border: '#1abc9c', time: '#16a085', code: '#1abc9c' },  // 青绿
  { border: '#34495e', time: '#2c3e50', code: '#34495e' },  // 深灰
];

// 从 GAS 加载笔记
function loadNotes(callback) {
  var url = API_URL + '?action=getNotes&callback=?';
  fetchJsonp(url, function(res) {
    if(res.success) {
      notes = res.data || [];
    } else {
      notes = [];
    }
    if(callback) callback();
  });
}

// 保存笔记（新增或编辑）
function saveNoteRemote(params, callback) {
  var url = API_URL + '?action=' + params.action + '&callback=?';
  delete params.action;
  url += '&' + Object.keys(params).map(function(k){ return k + '=' + encodeURIComponent(params[k] || ''); }).join('&');
  fetchJsonp(url, function(res) {
    if(callback) callback(res);
  });
}

function renderNotes() {
  // 默认日期设为今天
  var dateInput = document.getElementById('noteDate');
  if(dateInput && !dateInput.value) {
    var now = new Date();
    dateInput.value = now.getFullYear() + '-' +
      String(now.getMonth()+1).padStart(2,'0') + '-' +
      String(now.getDate()).padStart(2,'0');
  }
  // 如果是编辑模式，直接用本地数据渲染（不需要等GAS）
  var useLocalData = !!noteEditingId;

  function doRender() {
    var list = document.getElementById('notesList');
    if(notes.length === 0) {
      list.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0">暂无备忘，在上方输入添加。</p>';
      return;
    }
    var sorted = notes.slice().sort(function(a,b){ return (b.createdAt || b.date).localeCompare(a.createdAt || a.date); });
    var html = '';
    for(var i = 0; i < sorted.length; i++) {
      var n = sorted[i];
      var isEditing = (noteEditingId === n.id);
      // 每条记录用不同颜色
      var colorSet = NOTE_COLORS[i % NOTE_COLORS.length];
      // 格式化创建时间：年月日 时分秒
      var timeStr = formatNoteTime(n.createdAt);
      // 股票名称
      var stockNameStr = n.code ? getStockName(n.code) : '';
      html += '<div class="note-item" data-id="' + escapeHtml(n.id || '') + '" style="border-left-color:' + colorSet.border + '">';
      html += '<div class="note-item-content">';
      html += '<div class="note-item-date" style="color:' + colorSet.time + '">' + escapeHtml(timeStr) + '</div>';
      if(stockNameStr) {
        html += '<div class="note-item-code" style="color:' + colorSet.code + '">📌 ' + escapeHtml(stockNameStr) + '</div>';
      }
      if(isEditing) {
        // 编辑模式：显示输入框+按钮同行
        html += '<div class="note-item-edit">';
        html += '<input type="text" class="note-edit-input" id="noteEditInput" value="' + escapeHtml(n.content || '') + '" onkeydown="if(event.key===\'Enter\')saveNoteEdit(\'' + escapeHtml(n.id) + '\')" />';
        html += '<div class="note-edit-btns">';
        html += '<button class="note-edit-cancel" onclick="cancelNoteEdit()">取消</button>';
        html += '<button class="note-edit-save" onclick="saveNoteEdit(\'' + escapeHtml(n.id) + '\')">保存</button>';
        html += '</div>';
        html += '</div>';
      } else {
        // 查看模式：显示内容+操作按钮
        html += '<div class="note-item-text">' + escapeHtml(n.content || '') + '</div>';
      }
      html += '</div>';
      if(!isEditing) {
        html += '<div class="note-item-actions">';
        html += '<button class="note-item-edit-btn" onclick="editNote(\'' + escapeHtml(n.id) + '\')" title="编辑">✎</button>';
        html += '<button class="note-btn-del" onclick="deleteNote(\'' + escapeHtml(n.id) + '\')" title="删除">删除</button>';
        html += '</div>';
      }
      html += '</div>';
    }
    list.innerHTML = html;
    // 如果是编辑模式，聚焦输入框
    if(noteEditingId) {
      var editInput = document.getElementById('noteEditInput');
      if(editInput) { editInput.focus(); }
    }
  }
  // 非编辑模式才从GAS加载（如果还没加载过）
  if(!useLocalData) {
    if(notesLoaded && notes.length > 0) {
      // 已预加载，直接用本地数据渲染
      doRender();
    } else {
      // 还没加载或数据为空，加载后渲染
      loadNotes(function() { notesLoaded = true; doRender(); });
      // 显示加载中提示
      document.getElementById('notesList').innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0">正在加载...</p>';
    }
  } else {
    doRender();
  }
}

// 格式化日期值：处理GAS可能返回的Date对象或ISO字符串 → YYYY-MM-DD
function formatDateVal(val) {
  if (!val) return '';
  // 已经是简单格式 YYYY-MM-DD 或 YYYY/MM/DD
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(val)) {
    return val.replace(/\//g, '-');
  }
  // Date 对象或 ISO 字符串，用 formatNoteTime 截取日期部分
  try {
    var d = new Date(val);
    if (isNaN(d.getTime())) return val;
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  } catch(e) { return val; }
}

// 格式化笔记创建时间：2026-06-19 20:02:08
function formatNoteTime(isoStr) {
  if(!isoStr) return '';
  try {
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
    return y + '-' + m + '-' + day + ' ' + h + ':' + min + ':' + s;
  } catch(e) { return isoStr; }
}

function addNote() {
  var dateInput = document.getElementById('noteDate');
  var codeInput = document.getElementById('noteCode');
  var textInput = document.getElementById('noteInput');
  var date = dateInput.value;
  var rawCode = codeInput ? codeInput.value.trim() : '';
  var text = textInput.value.trim();
  if(!date) { alert('请选择日期'); return; }
  if(!text) { alert('请输入备忘内容'); return; }
  // 如果用户输入的是中文/非纯数字，尝试反向查找代码；否则直接用输入值
  var code = rawCode;
  if(rawCode && !/^\d{6}$/.test(rawCode)) {
    code = findCodeByName(rawCode) || rawCode;
  }
  // 乐观更新：立即添加到本地数据并渲染
  var now = new Date();
  var tempId = 'tmp_' + Date.now();
  notes.push({ id: tempId, date: date, code: code, content: text, createdAt: now.toISOString() });
  textInput.value = '';
  if(codeInput) codeInput.value = '';
  // 立即用本地数据渲染
  var list = document.getElementById('notesList');
  var sorted = notes.slice().sort(function(a,b){ return (b.createdAt || b.date).localeCompare(a.createdAt || a.date); });
  var html = '';
  for(var i = 0; i < sorted.length; i++) {
    var n = sorted[i];
    var colorSet = NOTE_COLORS[i % NOTE_COLORS.length];
    var timeStr = formatNoteTime(n.createdAt);
    var stockNameStr = n.code ? getStockName(n.code) : '';
    html += '<div class="note-item" data-id="' + escapeHtml(n.id || '') + '" style="border-left-color:' + colorSet.border + '">';
    html += '<div class="note-item-content">';
    html += '<div class="note-item-date" style="color:' + colorSet.time + '">' + escapeHtml(timeStr) + '</div>';
    if(stockNameStr) {
      html += '<div class="note-item-code" style="color:' + colorSet.code + '">📌 ' + escapeHtml(stockNameStr) + '</div>';
    }
    html += '<div class="note-item-text">' + escapeHtml(n.content || '') + '</div>';
    html += '</div>';
    html += '<div class="note-item-actions">';
    html += '<button class="note-item-edit-btn" onclick="editNote(\'' + escapeHtml(n.id) + '\')" title="编辑">✎</button>';
    html += '<button class="note-btn-del" onclick="deleteNote(\'' + escapeHtml(n.id) + '\')" title="删除">删除</button>';
    html += '</div>';
    html += '</div>';
  }
  list.innerHTML = html;
  // 后台静默同步到GAS
  saveNoteRemote({ action: 'addNote', date: date, code: code, content: text }, function(res) {
    if(res.success && res.id) {
      // 用真实ID替换临时ID
      for(var j = 0; j < notes.length; j++) {
        if(notes[j].id === tempId) { notes[j].id = res.id; break; }
      }
    } else {
      alert('保存失败：' + (res.error || '未知错误'));
      // 回滚：移除刚加的记录
      for(var k = notes.length - 1; k >= 0; k--) {
        if(notes[k].id === tempId) { notes.splice(k, 1); break; }
      }
      loadNotes(function() { renderNotes(); });
    }
  });
}

// 通过名称反向查找股票代码
function findCodeByName(name) {
  if(typeof STOCK_DICT === 'undefined') return null;
  var q = (name || '').trim();
  for(var code in STOCK_DICT) {
    var item = STOCK_DICT[code];
    if (item && item[0] === q) return code;
  }
  return null;
}

function editNote(id) {
  noteEditingId = id;
  renderNotes();
}

function saveNoteEdit(id) {
  var editInput = document.getElementById('noteEditInput');
  if(!editInput) return;
  var newContent = editInput.value.trim();
  if(!newContent) { alert('备忘内容不能为空'); return; }
  // 乐观更新：先更新本地数据并退出编辑模式
  for(var i = 0; i < notes.length; i++) {
    if(notes[i].id === id) { notes[i].content = newContent; break; }
  }
  noteEditingId = null;
  // 立即用本地数据重新渲染
  var list = document.getElementById('notesList');
  var sorted = notes.slice().sort(function(a,b){ return (b.createdAt || b.date).localeCompare(a.createdAt || a.date); });
  var html = '';
  for(var j = 0; j < sorted.length; j++) {
    var n = sorted[j];
    var colorSet = NOTE_COLORS[j % NOTE_COLORS.length];
    var timeStr = formatNoteTime(n.createdAt);
    var stockNameStr = n.code ? getStockName(n.code) : '';
    html += '<div class="note-item" data-id="' + escapeHtml(n.id || '') + '" style="border-left-color:' + colorSet.border + '">';
    html += '<div class="note-item-content">';
    html += '<div class="note-item-date" style="color:' + colorSet.time + '">' + escapeHtml(timeStr) + '</div>';
    if(stockNameStr) {
      html += '<div class="note-item-code" style="color:' + colorSet.code + '">📌 ' + escapeHtml(stockNameStr) + '</div>';
    }
    html += '<div class="note-item-text">' + escapeHtml(n.content || '') + '</div>';
    html += '</div>';
    html += '<div class="note-item-actions">';
    html += '<button class="note-item-edit-btn" onclick="editNote(\'' + escapeHtml(n.id) + '\')" title="编辑">✎</button>';
    html += '<button class="note-btn-del" onclick="deleteNote(\'' + escapeHtml(n.id) + '\')" title="删除">删除</button>';
    html += '</div>';
    html += '</div>';
  }
  list.innerHTML = html;
  // 后台静默同步到GAS
  saveNoteRemote({ action: 'updateNote', id: id, field: 'content', value: newContent }, function(res) {
    if(!res.success) {
      alert('保存失败：' + (res.error || '未知错误'));
      // 回滚：重新加载
      loadNotes(function() { renderNotes(); });
    }
  });
}

function cancelNoteEdit() {
  noteEditingId = null;
  // 用本地数据直接渲染，不请求GAS
  var list = document.getElementById('notesList');
  var sorted = notes.slice().sort(function(a,b){ return (b.createdAt || b.date).localeCompare(a.createdAt || a.date); });
  if(sorted.length === 0) {
    list.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0">暂无备忘，在上方输入添加。</p>';
    return;
  }
  var html = '';
  for(var i = 0; i < sorted.length; i++) {
    var n = sorted[i];
    var colorSet = NOTE_COLORS[i % NOTE_COLORS.length];
    var timeStr = formatNoteTime(n.createdAt);
    var stockNameStr = n.code ? getStockName(n.code) : '';
    html += '<div class="note-item" data-id="' + escapeHtml(n.id || '') + '" style="border-left-color:' + colorSet.border + '">';
    html += '<div class="note-item-content">';
    html += '<div class="note-item-date" style="color:' + colorSet.time + '">' + escapeHtml(timeStr) + '</div>';
    if(stockNameStr) {
      html += '<div class="note-item-code" style="color:' + colorSet.code + '">📌 ' + escapeHtml(stockNameStr) + '</div>';
    }
    html += '<div class="note-item-text">' + escapeHtml(n.content || '') + '</div>';
    html += '</div>';
    html += '<div class="note-item-actions">';
    html += '<button class="note-item-edit-btn" onclick="editNote(\'' + escapeHtml(n.id) + '\')" title="编辑">✎</button>';
    html += '<button class="note-btn-del" onclick="deleteNote(\'' + escapeHtml(n.id) + '\')" title="删除">删除</button>';
    html += '</div>';
    html += '</div>';
  }
  list.innerHTML = html;
}

function deleteNote(id) {
  noteToDelete = id;
  document.getElementById('deleteNoteModal').classList.add('active');
}

function submitDeleteNote() {
  if(!noteToDelete) return;
  var delId = noteToDelete;
  // 立即关闭弹窗
  noteToDelete = null;
  var modal = document.getElementById('deleteNoteModal');
  if(modal) modal.classList.remove('active');
  // 乐观更新：立即从本地数据中移除并重新渲染
  for(var i = notes.length - 1; i >= 0; i--) {
    if(notes[i].id === delId) { notes.splice(i, 1); break; }
  }
  var list = document.getElementById('notesList');
  var sorted = notes.slice().sort(function(a,b){ return (b.createdAt || b.date).localeCompare(a.createdAt || a.date); });
  if(sorted.length === 0) {
    list.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0">暂无备忘，在上方输入添加。</p>';
  } else {
    var html = '';
    for(var j = 0; j < sorted.length; j++) {
      var n = sorted[j];
      var colorSet = NOTE_COLORS[j % NOTE_COLORS.length];
      var timeStr = formatNoteTime(n.createdAt);
      var stockNameStr = n.code ? getStockName(n.code) : '';
      html += '<div class="note-item" data-id="' + escapeHtml(n.id || '') + '" style="border-left-color:' + colorSet.border + '">';
      html += '<div class="note-item-content">';
      html += '<div class="note-item-date" style="color:' + colorSet.time + '">' + escapeHtml(timeStr) + '</div>';
      if(stockNameStr) {
        html += '<div class="note-item-code" style="color:' + colorSet.code + '">📌 ' + escapeHtml(stockNameStr) + '</div>';
      }
      html += '<div class="note-item-text">' + escapeHtml(n.content || '') + '</div>';
      html += '</div>';
      html += '<div class="note-item-actions">';
      html += '<button class="note-item-edit-btn" onclick="editNote(\'' + escapeHtml(n.id) + '\')" title="编辑">✎</button>';
      html += '<button class="note-btn-del" onclick="deleteNote(\'' + escapeHtml(n.id) + '\')" title="删除">删除</button>';
      html += '</div>';
      html += '</div>';
    }
    list.innerHTML = html;
  }
  // 后台静默同步到GAS（用saveNoteRemote统一格式）
  saveNoteRemote({ action: 'deleteNote', id: delId }, function(res) {
    if(!res.success) {
      alert('删除失败：' + (res.error || '未知错误'));
      loadNotes(function() { renderNotes(); });
    }
  });
}

function closeDeleteNote() {
  noteToDelete = null;
  var modal = document.getElementById('deleteNoteModal');
  if(modal) modal.classList.remove('active');
}

// 搜索笔记
function searchNotes() {
  var keywordInput = document.getElementById('noteSearch');
  if(!keywordInput) return;
  var keyword = keywordInput.value.trim();
  if(!keyword) {
    // 搜索框为空：直接调用renderNotes，它会从notes渲染
    renderNotes();
    return;
  }
  // 有搜索词：用本地notes数据做前端过滤，不请求GAS
  var kw = keyword.toLowerCase();
  var filtered = notes.filter(function(n){
    var dateStr = (n.date || '').toLowerCase();
    var codeStr = (n.code || '').toLowerCase();
    var contentStr = (n.content || '').toLowerCase();
    return dateStr.indexOf(kw) !== -1 || codeStr.indexOf(kw) !== -1 || contentStr.indexOf(kw) !== -1;
  });
  var list = document.getElementById('notesList');
  if(filtered.length === 0) {
    list.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0">未找到匹配的备忘。</p>';
    return;
  }
  var sorted = filtered.slice().sort(function(a,b){ return (b.createdAt || b.date).localeCompare(a.createdAt || a.date); });
  var html = '<p style="color:#e67e22;font-size:12px;padding:8px 0;">搜索结果：' + sorted.length + ' 条</p>';
  for(var i = 0; i < sorted.length; i++) {
    var n = sorted[i];
    var colorSet = NOTE_COLORS[i % NOTE_COLORS.length];
    var timeStr = formatNoteTime(n.createdAt);
    var stockNameStr = n.code ? getStockName(n.code) : '';
    html += '<div class="note-item" data-id="' + escapeHtml(n.id || '') + '" style="border-left-color:' + colorSet.border + '">';
    html += '<div class="note-item-content">';
    html += '<div class="note-item-date" style="color:' + colorSet.time + '">' + escapeHtml(timeStr) + '</div>';
    if(stockNameStr) {
      html += '<div class="note-item-code" style="color:' + colorSet.code + '">📌 ' + escapeHtml(stockNameStr) + '</div>';
    }
    html += '<div class="note-item-text">' + escapeHtml(n.content || '') + '</div>';
    html += '</div>';
    html += '<div class="note-item-actions">';
    html += '<button class="note-item-edit-btn" onclick="editNote(\'' + escapeHtml(n.id) + '\')" title="编辑">✎</button>';
    html += '<button class="note-btn-del" onclick="deleteNote(\'' + escapeHtml(n.id) + '\')" title="删除">删除</button>';
    html += '</div>';
    html += '</div>';
  }
  list.innerHTML = html;
}

// 清除搜索
function clearNoteSearch() {
  var keywordInput = document.getElementById('noteSearch');
  if(keywordInput) keywordInput.value = '';
  renderNotes();
}

// JSONP 辅助函数
function fetchJsonp(url, callback) {
  var callbackName = 'jsonp_callback_' + Date.now();
  var script = document.createElement('script');
  script.src = url.replace('callback=?', 'callback=' + callbackName);
  window[callbackName] = function(data) {
    delete window[callbackName];
    document.body.removeChild(script);
    callback(data);
  };
  document.body.appendChild(script);
}

// 页面加载后预加载笔记数据
setTimeout(preloadNotes, 500);

// ===== 当月运势 / 八字排盘 =====
var baziDateType = 'solar'; // 'solar' 或 'lunar'
var baziCache = null; // 缓存计算结果

function initBaziTab() {
  // 初始化时辰按钮网格点击事件
  var grid = document.getElementById('baziHourGrid');
  if(grid) {
    grid.addEventListener('click', function(e) {
      var opt = e.target.closest('.bazi-hour-opt');
      if(!opt) return;
      grid.querySelectorAll('.bazi-hour-opt').forEach(function(el){ el.classList.remove('selected'); });
      opt.classList.add('selected');
      document.getElementById('baziBirthHour').value = opt.getAttribute('data-val');
    });
  }

  // 从 localStorage 恢复上次输入
  try {
    var saved = JSON.parse(localStorage.getItem('baziLastInput') || '{}');
    if(saved.year) document.getElementById('baziYear').value = saved.year;
    if(saved.month) document.getElementById('baziMonth').value = saved.month;
    if(saved.day) document.getElementById('baziDay').value = saved.day;
    if(saved.hour !== undefined && saved.hour !== '') {
      document.getElementById('baziBirthHour').value = saved.hour;
      var hGrid = document.getElementById('baziHourGrid');
      if(hGrid) {
        hGrid.querySelectorAll('.bazi-hour-opt').forEach(function(el){
          el.classList.toggle('selected', el.getAttribute('data-val') === String(saved.hour));
        });
      }
    }
    if(saved.gender) document.getElementById('baziGender').value = saved.gender;
    if(saved.dateType) setBaziDateType(saved.dateType);
    if(saved.isLeapMonth) document.getElementById('baziIsLeapMonth').value = saved.isLeapMonth;
  } catch(e) { /* 忽略 */ }
}

function setBaziDateType(type) {
  baziDateType = type;
  document.querySelectorAll('.bazi-type-btn').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-type') === type);
  });
  document.getElementById('baziLunarExtraRow').style.display = type === 'lunar' ? '' : 'none';
  // 切换日期类型时清空日期，避免混淆
  var yInput = document.getElementById('baziYear');
  if(yInput && (yInput.value || document.getElementById('baziMonth').value || document.getElementById('baziDay').value)) {
    yInput.value = '';
    document.getElementById('baziMonth').value = '';
    document.getElementById('baziDay').value = '';
    // 隐藏结果区域
    var resultSec = document.getElementById('baziResultSection');
    if(resultSec) resultSec.style.display = 'none';
  }
}

function onBaziDateChange() {
  // 日期变更时可做额外校验（暂无）
}

/**
 * 农历转公历（简化近似版，用于排八字）
 * 使用查表法反推：已知农历年月日 → 公历年月日
 * 由于完整农历转公历较复杂，这里采用迭代法
 */
function lunarToSolarApprox(lunarY, lunarM, lunarD, isLeap) {
  // 迭代法：从该农历月份可能对应的公历日期范围搜索
  var startD = new Date(lunarY, 0, 1);
  var endD = new Date(lunarY + 1, 0, 1);
  var targetStr = lunarY + '-' + String(lunarM).padStart(2,'0') + '-' + String(lunarD).padStart(2,'0');

  for(var d = new Date(startD); d < endD; d.setDate(d.getDate() + 1)) {
    var yy = d.getFullYear(), mm = d.getMonth() + 1, dd = d.getDate();
    var lunar = solarToLunar(yy, mm, dd);
    if(!lunar) continue;
    if(lunar.year === lunarY && lunar.month === lunarM && lunar.day === lunarD && lunar.isLeap === isLeap) {
      return { year: yy, month: mm, day: dd };
    }
  }
  return null;
}

/**
 * 计算十神
 * 日干为基准（日主），判断其他干支的十神属性
 */
function getShiShen(dayGanIdx, targetGanIdx) {
  // 同我者为比劫（与日干五行相同）
  // 我生者食伤（日干所生）
  // 我克者财（日干所克）
  // 克我者官杀（克日干）
  // 生我者印枭（生日干）
  var dw = [0,1,2,3,4,5,6,7,8,9]; // 五行序号映射: 甲乙=木(0,1), 丙丁=火(2,3), 戊己=土(4,5), 庚辛=金(6,7), 壬癸=水(8,9)
  function ganWuxing(idx) { return Math.floor(idx / 2); }
  var me = ganWuxing(dayGanIdx);
  var other = ganWuxing(targetGanIdx);

  // 五行生克关系：木0→火1→土2→金3→水4→木0
  // 同五行：比劫
  if(me === other) return '比劫';
  // 我生（+1 or +2 mod 5 for fire/earth special case... 简化用相生关系）
  if((me + 1) % 5 === other || (me + 2) % 5 === other && me===0 && other===2) return '食伤';
  if((me + 2) % 5 === other) return '食伤';
  // 我克（木克土, 土克水, 水克火, 火克金, 金克木）: +3
  if((me + 3) % 5 === other) return '财';
  // 克我: +4
  if((me + 4) % 5 === other) return '官杀';
  // 生我: -1
  if((me + 4) % 5 === other || (me + 3) % 5 === other && false) return '印枭';

  // 更精确的十神判断
  var shishenMap = [
    // 日干=甲(0)
    ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印'],
    // 日干=乙(1)
    ['劫财','比肩','伤官','食神','正财','偏财','正官','七杀','正印','偏印'],
    // 日干=丙(2)
    ['食神','伤官','比肩','劫财','偏印','正印','七杀','正官','偏财','正财'],
    // 日干=丁(3)
    ['伤官','食神','劫财','比肩','正印','偏印','正官','七杀','正财','偏财'],
    // 日干=戊(4)
    ['偏印','正印','劫财','比肩','七杀','正官','偏财','正财','食神','伤官'],
    // 日干=己(5)
    ['正印','偏印','比肩','劫财','正官','七杀','正财','偏财','伤官','食神'],
    // 日干=庚(6)
    ['七杀','正官','偏印','正印','比肩','劫财','食神','伤官','偏财','正财'],
    // 日干=辛(7)
    ['正官','七杀','正印','偏印','劫财','比肩','伤官','食神','正财','偏财'],
    // 日干=壬(8)
    ['偏财','正财','食神','伤官','比肩','劫财','偏印','正印','七杀','正官'],
    // 日干=癸(9)
    ['正财','偏财','伤官','食神','劫财','比肩','正印','偏印','正官','七杀']
  ];
  return shishenMap[dayGanIdx][targetGanIdx];
}

/** 获取十神显示名称（简化版） */
function getShiShenDisplay(dayGanIdx, targetGanIdx, gender) {
  var ss = getShiShen(dayGanIdx, targetGanIdx);
  // 阴阳区分：同性为偏，异性为正
  var isSameParity = (dayGanIdx % 2) === (targetGanIdx % 2);
  var prefix = isSameParity ? '偏' : '正';
  var detailMap = {
    '比劫': isSameParity ? '比肩' : '劫财',
    '食伤': isSameParity ? '食神' : '伤官',
    '财':   isSameParity ? '偏财' : '正财',
    '官杀': isSameParity ? '七杀' : '正官',
    '印枭': isSameParity ? '偏印' : '正印'
  };
  return detailMap[ss] || ss;
}

/** 排八字主函数 */
function calcBazi() {
  try {
  // 从三个输入框读取年月日
  var yyStr = document.getElementById('baziYear').value;
  var mmStr = document.getElementById('baziMonth').value;
  var ddStr = document.getElementById('baziDay').value;

  if(!yyStr || !mmStr || !ddStr){ alert('请填写完整的出生日期（年/月/日）'); return; }

  var yy = parseInt(yyStr), mm = parseInt(mmStr), dd = parseInt(ddStr);

  if(isNaN(yy) || isNaN(mm) || isNaN(dd)){ alert('日期格式不正确，请检查'); return; }
  if(yy < 1900 || yy > 2030){ alert('年份应在1900-2030之间'); return; }
  if(mm < 1 || mm > 12){ alert('月份应在1-12之间'); return; }
  if(dd < 1 || dd > 31){ alert('日期应在1-31之间'); return; }

  var hourIdx = document.getElementById('baziBirthHour').value;
  hourIdx = hourIdx === '' ? -1 : parseInt(hourIdx);

  var gender = document.getElementById('baziGender').value;

  // 如果是农历模式，先转公历
  if(baziDateType === 'lunar') {
    var isLeap = document.getElementById('baziIsLeapMonth').value === 'true';
    var solar = lunarToSolarApprox(yy, mm, dd, isLeap);
    if(!solar){ alert('无法转换该农历日期到公历，请检查日期是否正确'); return; }
    yy = solar.year; mm = solar.month; dd = solar.day;
  }

  // 计算四柱
  var yGz = getYearGanZhi(solarToLunar(yy,mm,dd).year); // 年柱按农历年
  var mGz = getMonthGanZhi(yy, mm, dd);
  var dGz = getDayGanZhi(yy, mm, dd);
  var hGz = hourIdx >= 0 ? getHourGanZhi(yy, mm, dd, hourIdx === 0 ? 23 : hourIdx * 2 - 1) : null; // 时柱：传时辰起始小时数

  // 日干索引（核心）
  var dayGanIdx = GAN.indexOf(dGz.gan);

  // 构建缓存结果
  var result = {
    inputType: baziDateType,
    birthDate: yy + '-' + String(mm).padStart(2,'0') + '-' + String(dd).padStart(2,'0'),
    gender: gender,
    solarDate: { y: yy, m: mm, d: dd },
    pillars: {
      year: yGz,
      month: mGz,
      day: dGz,
      hour: hGz
    },
    dayGanIdx: dayGanIdx,
    hourIdx: hourIdx
  };

  // 计算五行统计
  result.wuxingStats = calcWuxingStats(result.pillars);

  // 计算大运
  result.dayun = calcDayun(result);

  // 当前运势
  result.currentFortune = calcCurrentFortune(result);

  // 性格分析
  result.personality = analyzePersonality(result);

  baziCache = result;
  renderBaziResult(result);

  // 保存输入到 localStorage，下次自动恢复
  try {
    localStorage.setItem('baziLastInput', JSON.stringify({
      year: document.getElementById('baziYear').value,
      month: document.getElementById('baziMonth').value,
      day: document.getElementById('baziDay').value,
      hour: document.getElementById('baziBirthHour').value,
      gender: document.getElementById('baziGender').value,
      dateType: baziDateType,
      isLeapMonth: document.getElementById('baziIsLeapMonth') ? document.getElementById('baziIsLeapMonth').value : 'false'
    }));
  } catch(e2) { /* 忽略存储失败 */ }
  } catch(e) {
    alert('排八字出错：' + (e.message || e) + '\n行号：' + (e.lineNumber || '未知') + '\n请按F12打开控制台查看详细错误');
    console.error('calcBazi error:', e);
  }
}

/** 统计四柱五行数量 */
function calcWuxingStats(pillars) {
  var stats = { '木':0, '火':0, '土':0, '金':0, '水':0 };
  var allItems = [
    {gan: pillars.year.gan, zhi: pillars.year.zhi},
    {gan: pillars.month.gan, zhi: pillars.month.zhi},
    {gan: pillars.day.gan, zhi: pillars.day.zhi}
  ];
  if(pillars.hour){
    allItems.push({gan: pillars.hour.gan, zhi: pillars.hour.zhi});
  }

  allItems.forEach(function(item){
    // 天干五行
    var gIdx = GAN.indexOf(item.gan);
    if(gIdx >= 0) stats[WUXING[gIdx]]++;
    // 地支五行
    var zIdx = ZHI.indexOf(item.zhi);
    if(zIdx >= 0) stats[ZHI_ELEM[zIdx]]++;
  });
  return stats;
}

/** 渲染八字结果 */
function renderBaziResult(r) {
  document.getElementById('baziResultSection').style.display = '';

  // 四柱表格
  var dayGanIdx = r.dayGanIdx;
  var h = '';
  h += '<table class="bazi-four-pillars"><tr>';
  h += '<th>年柱</th><th>月柱</th><th>日柱</th>' + (r.pillars.hour ? '<th>时柱</th>' : '') + '</tr><tr>';

  // 年柱
  h += '<td><div class="bazi-pillar-cell">';
  h += '<span class="bazi-gan-text" style="color:' + (ELEM_COLORS[r.pillars.year.ganElem]||'#333') + '">' + r.pillars.year.gan + '</span>';
  h += '<span class="bazi-zhi-text" style="color:' + (ELEM_COLORS[ZHI_ELEM[ZHI.indexOf(r.pillars.year.zhi)]]||'#333') + '">' + r.pillars.year.zhi + '</span>';
  h += '<span class="bazi-elem-tag bazi-elem-' + r.pillars.year.ganElem + '">' + r.pillars.year.ganElem + '</span>';
  h += '<span class="bazi-shishen">' + getShiShenDisplay(dayGanIdx, GAN.indexOf(r.pillars.year.gan), r.gender) + '</span>';
  h += '</div></td>';

  // 月柱
  h += '<td><div class="bazi-pillar-cell">';
  h += '<span class="bazi-gan-text" style="color:' + (ELEM_COLORS[r.pillars.month.ganElem]||'#333') + '">' + r.pillars.month.gan + '</span>';
  h += '<span class="bazi-zhi-text" style="color:' + (ELEM_COLORS[ZHI_ELEM[ZHI.indexOf(r.pillars.month.zhi)]]||'#333') + '">' + r.pillars.month.zhi + '</span>';
  h += '<span class="bazi-elem-tag bazi-elem-' + r.pillars.month.ganElem + '">' + r.pillars.month.ganElem + '</span>';
  h += '<span class="bazi-shishen">' + getShiShenDisplay(dayGanIdx, GAN.indexOf(r.pillars.month.gan), r.gender) + '</span>';
  h += '</div></td>';

  // 日柱（日主加粗标识）
  h += '<td><div class="bazi-pillar-cell" style="background:#f0f7ff;border-radius:8px;padding:6px;">';
  h += '<span class="bazi-gan-text" style="color:' + (ELEM_COLORS[r.pillars.day.ganElem]||'#333') + '">' + r.pillars.day.gan + '</span> <small style="color:#2980b9;font-size:11px">【日主】</small>';
  h += '<span class="bazi-zhi-text" style="color:' + (ELEM_COLORS[ZHI_ELEM[ZHI.indexOf(r.pillars.day.zhi)]]||'#333') + '">' + r.pillars.day.zhi + '</span>';
  h += '<span class="bazi-elem-tag bazi-elem-' + r.pillars.day.ganElem + '">' + r.pillars.day.ganElem + '</span>';
  h += '<span class="bazi-shishen">日主</span>';
  h += '</div></td>';

  // 时柱
  if(r.pillars.hour) {
    h += '<td><div class="bazi-pillar-cell">';
    h += '<span class="bazi-gan-text" style="color:' + (ELEM_COLORS[r.pillars.hour.ganElem]||'#333') + '">' + r.pillars.hour.gan + '</span>';
    h += '<span class="bazi-zhi-text" style="color:' + (ELEM_COLORS[ZHI_ELEM[ZHI.indexOf(r.pillars.hour.zhi)]]||'#333') + '">' + r.pillars.hour.zhi + '</span>';
    h += '<span class="bazi-elem-tag bazi-elem-' + r.pillars.hour.ganElem + '">' + r.pillars.hour.ganElem + '</span>';
    h += '<span class="bazi-shishen">' + getShiShenDisplay(dayGanIdx, GAN.indexOf(r.pillars.hour.gan), r.gender) + '</span>';
    h += '</div></td>';
  }

  h += '</tr></table>';
  document.getElementById('baziFourPillars').innerHTML = h;

  // 五行统计条形图
  var total = r.wuxingStats['木'] + r.wuxingStats['火'] + r.wuxingStats['土'] + r.wuxingStats['金'] + r.wuxingStats['水'];
  var maxCt = 1;
  for(var k in r.wuxingStats) { if(r.wuxingStats[k] > maxCt) maxCt = r.wuxingStats[k]; }
  var wh = '';
  var wxKeys = ['木','火','土','金','水'];
  var wxColors = {'木':'#27ae60','火':'#e74c3c','土':'#B8860B','金':'#d4a017','水':'#2980b9'};
  wxKeys.forEach(function(key) {
    var ct = r.wuxingStats[key];
    var pct = total > 0 ? Math.round(ct / total * 100) : 0;
    var barW = maxCt > 0 ? Math.max(ct / maxCt * 80, 16) : 16;
    wh += '<div class="bazi-wx-item"><div class="bazi-wx-bar" style="width:'+barW+'px;background:'+wxColors[key]+'">'+ct+'</div><div class="bazi-wx-label">'+key+' '+pct+'%</div></div>';
  });
  document.getElementById('baziWuxingStats').innerHTML = wh;

  // 性格分析
  document.getElementById('baziPersonality').innerHTML = r.personality.html;

  // 大运
  document.getElementById('baziDayun').innerHTML = r.dayun.html;

  // 当前运势
  document.getElementById('baziCurrentFortune').innerHTML = r.currentFortune.html;
}

/** 分析性格特点 */
function analyzePersonality(r) {
  var ws = r.wuxingStats;
  var dayGan = r.pillars.day.gan;
  var dayZhi = r.pillars.day.zhi;
  var dayGanIdx = r.dayGanIdx;
  var dayWx = r.pillars.day.ganElem;
  var traits = [];

  // 日主五行性格基础
  var basePersonalities = {
    '木': ['心地善良、富有同情心', '正直向上、有进取心', '性格直爽、不喜欢拐弯抹角', '注重精神层面的满足', '有时过于固执、不够灵活'],
    '火': ['热情开朗、待人真诚', '行动力强、有领导才能', '急躁易怒、缺乏耐心', '重视礼貌、有正义感', '情绪波动较大、喜怒形于色'],
    '土': ['诚信稳重、值得信赖', '包容性强、善于协调', '做事踏实、有条理', '有时过于保守、不愿冒险', '重感情、念旧情'],
    '金': ['果断坚毅、意志坚定', '讲义气、重承诺', '追求完美、有洁癖倾向', '言辞犀利、容易得罪人', '外冷内热、不善于表达情感'],
    '水': ['智慧灵活、反应敏捷', '适应能力强、善于变通', '心思细腻、想象力丰富', '有时优柔寡断、缺乏决断', '喜静不喜动、内心世界丰富']
  };

  var bp = basePersonalities[dayWx] || [];
  traits.push({ title: '日主「' + dayGan + '」' + dayWx + '性人格特质', items: bp });

  // 五行强弱分析
  var total = ws['木']+ws['火']+ws['土']+ws['金']+ws['水'];
  var strong = [], weak = [];
  var _wxK = ['木','火','土','金','水'];
  _wxK.forEach(function(k) {
    if(ws[k] >= 2) strong.push(k + '(' + ws[k] + ')');
    else if(ws[k] === 0) weak.push(k + '(缺)');
  });

  if(strong.length > 0) {
    traits.push({
      title: '五行优势（较旺）',
      items: strong.map(function(s){ return s + '偏旺，相关特质更加明显'; })
    });
  }
  if(weak.length > 0) {
    traits.push({
      title: '五行缺失/不足',
      items: weak.map(function(s){ return '建议通过颜色、方位、饮食等方式补' + s.charAt(0); })
    });
  }

  // 十神组合性格
  var ssItems = [];
  var monthSs = getShiShenDisplay(dayGanIdx, GAN.indexOf(r.pillars.month.gan), r.gender);
  var yearSs = getShiShenDisplay(dayGanIdx, GAN.indexOf(r.pillars.year.gan), r.gender);

  if(monthSs === '正财' || monthSs === '偏财') ssItems.push('月柱见财星，务实求财意识强，理财观念较好');
  if(monthSs === '正官' || monthSs === '七杀') ssItems.push('月柱见官杀星，事业心强，有责任感和管理能力');
  if(monthSs === '食神' || monthSs === '伤官') ssItems.push('月柱见食伤星，聪明伶俐，表达能力强，创造力丰富');
  if(monthSs === '正印' || monthSs === '偏印') ssItems.push('月柱见印枭星，好学深思，思想深邃，适合学术研究');

  if(yearSs === '正财' || yearSs === '偏财') ssItems.push('年柱见财星，家境通常不错或早年有财运');
  if(yearSs === '正官' || yearSs === '七杀') ssItems.push('年柱见官杀星，家教严格或有家族传统约束');
  if(ssItems.length > 0) {
    traits.push({ title: '十神格局特点', items: ssItems });
  }

  // 地支藏干影响（简化）
  var zhiChars = {
    '子':['癸'],'丑':['己','辛','癸'],'寅':['甲','丙','戊'],'卯':['乙'],
    '辰':['戊','乙','癸'],'巳':['丙','庚','戊'],'午':['丁','己'],'未':['己','丁','乙'],
    '申':['庚','壬','戊'],'酉':['辛'],'戌':['戊','辛','丁'],'亥':['壬','甲']
  };
  var hiddenStems = zhiChars[dayZhi] || [];

  var html = '';
  traits.forEach(function(t) {
    html += '<div class="bazi-trait-title">' + t.title + '</div>';
    html += '<ul class="bazi-trait-list">';
    t.items.forEach(function(item) {
      html += '<li>' + item + '</li>';
    });
    html += '</ul>';
  });

  // 添加综合建议
  html += '<div class="bazi-trait-title">📌 综合建议</div>';
  html += '<ul class="bazi-trait-list">';
  if(strong.indexOf('火') >= 0 || strong.indexOf('木') >= 0) {
    html += '<li>适合从事需要热情和创造力的工作，如销售、教育、创意设计等</li>';
  }
  if(strong.indexOf('金') >= 0 || strong.indexOf('土') >= 0) {
    html += '<li>适合从事需要执行力和规划的工作，如金融、管理、工程等</li>';
  }
  if(strong.indexOf('水') >= 0) {
    html += '<li>适合从事需要智慧和沟通的工作，如咨询、传媒、研究等</li>';
  }
  if(weak.length > 0) {
    html += '<li>五行有缺，可通过日常习惯调整平衡（如穿着对应颜色的衣物、在相应方位活动等）</li>';
  }
  html += '<li>以上分析仅供参考娱乐，命运掌握在自己手中，努力才是改变命运的关键</li>';
  html += '</ul>';

  return { html: html, traits: traits };
}

/**
 * 计算大运
 * 起运规则：以出生日到下一个节气（立春/惊蛰等）的天数除以3，得出起运年龄
 * 阳男阴女：顺排大运；阴男阳女：逆排大运
 */
function calcDayun(r) {
  var yy = r.solarDate.y, mm = r.solarDate.m, dd = r.solarDate.d;
  var dayGanIdx = r.dayGanIdx;
  var gender = r.gender;
  var isYangDay = (dayGanIdx % 2 === 0); // 甲丙戊壬为阳干

  // 判定顺逆
  var isForward; // 顺排=true, 逆排=false
  if(isYangDay && gender === 'male') isForward = true;
  else if(!isYangDay && gender === 'female') isForward = true;
  else isForward = false;

  // 月柱地支索引
  var monthZhiIdx = ZHI.indexOf(r.pillars.month.zhi);

  // 起运年龄（简化算法：约每三天折合一岁）
  // 实际应计算到下一个节气的天数 / 3
  var startAge = 3; // 默认约3岁起运（简化）

  // 大运列表
  var dayuns = [];
  var curMonthZhiIdx = monthZhiIdx;
  var curMonthGanIdx = GAN.indexOf(r.pillars.month.gan);

  for(var i = 0; i < 8; i++) {
    if(isForward) {
      curMonthZhiIdx = (curMonthZhiIdx + 1) % 12;
      curMonthGanIdx = (curMonthGanIdx + 1) % 10;
    } else {
      curMonthZhiIdx = (curMonthZhiIdx + 11) % 12;
      curMonthGanIdx = (curMonthGanIdx + 9) % 10;
    }

    var ageStart = startAge + i * 10;
    var ageEnd = ageStart + 9;
    var dy = r.solarDate.y + ageStart;
    var gan = GAN[curMonthGanIdx], zhi = ZHI[curMonthZhiIdx];
    var ganElem = WUXING[curMonthGanIdx];
    var zhiElem = ZHI_ELEM[curMonthZhiIdx];

    // 判断当前所处大运
    var nowYear = new Date().getFullYear();
    var currentAge = nowYear - r.solarDate.y;
    var statusClass = '', statusText = '';
    if(currentAge >= ageStart && currentAge <= ageEnd) {
      statusClass = 'bazi-dayun-current'; statusText = ' ← 当前';
    } else if(currentAge > ageEnd) {
      statusClass = 'bazi-dayun-past'; statusText = ' 已过';
    } else {
      statusClass = 'bazi-dayun-future'; statusText = '';
    }

    dayuns.push({
      gan: gan, zhi: zhi, ganElem: ganElem, zhiElem: zhiElem,
      ageStart: ageStart, ageEnd: ageEnd, years: dy,
      statusClass: statusClass, statusText: statusText,
      order: i + 1
    });
  }

  // 渲染HTML
  var html = '<table class="bazi-dayun-table"><tr><th>序号</th><th>大运</th><th>五行</th><th>起止年龄</th><th>公历年段</th><th>状态</th></tr>';
  dayuns.forEach(function(d) {
    html += '<tr>';
    html += '<td>' + d.order + '</td>';
    html += '<td style="font-size:16px;font-weight:700;letter-spacing:2px">' + d.gan + d.zhi + '</td>';
    html += '<td><span class="bazi-elem-tag bazi-elem-' + d.ganElem + '">' + d.ganElem + '/' + d.zhiElem + '</span></td>';
    html += '<td>' + d.ageStart + ' - ' + d.ageEnd + '岁</td>';
    html += '<td>' + d.years + ' - ' + (d.years + 9) + '年</td>';
    html += '<td class="' + d.statusClass + '">' + d.ageStart + '岁' + d.statusText + '</td>';
    html += '</tr>';
  });
  html += '</table>';
  html += '<p style="font-size:12px;color:#999;margin-top:8px">注：起运年龄和大运排列为简化算法，精确起运需结合节气推算。仅供参考。</p>';

  return { html: html, list: dayuns, startAge: startAge, isForward: isForward };
}

/** 生成个性化总评 */
function generateOverallSummary(r, analyses, yganzhi, mganzhi) {
  var ws = r.wuxingStats;
  var dayWx = r.pillars.day.ganElem;
  var yearGanWx = yganzhi.ganElem;
  var yearZhiWx = ZHI_ELEM[ZHI.indexOf(yganzhi.zhi)];

  // 日主强弱
  var total = ws['木']+ws['火']+ws['土']+ws['金']+ws['水'];
  var isStrong = ws[dayWx] >= 2;

  // 流年天干与日主关系
  var shengWo = {'木':'水','火':'木','土':'火','金':'土','水':'金'};
  var keWo = {'木':'土','火':'金','土':'水','金':'木','水':'火'};
  var woKe = {'木':'金','火':'水','土':'木','金':'火','水':'土'};
  var woSheng = {'木':'火','火':'土','土':'金','金':'水','水':'木'};
  var rel = (yearGanWx===dayWx?'同类':shengWo[dayWx]===yearGanWx?'生我':keWo[dayWx]===yearGanWx?'克我':woKe[dayWx]===yearGanWx?'我克':'我生');

  // 地支关系
  var zhiRel = getZhiRelation(ZHI.indexOf(r.pillars.day.zhi), ZHI.indexOf(yganzhi.zhi));

  // 当前大运
  var now = new Date();
  var age = now.getFullYear() - r.solarDate.y;
  var curDu = null;
  if(r.dayun && r.dayun.list) {
    r.dayun.list.forEach(function(d){ if(age>=d.ageStart && age<=d.ageEnd) curDu=d; });
  }

  // 缺失五行是否被流年补上
  var missing = [];
  ['木','火','土','金','水'].forEach(function(k){ if(ws[k]===0) missing.push(k); });
  var filling = missing.length > 0 && (missing.indexOf(yearGanWx)>=0 || missing.indexOf(yearZhiWx)>=0);

  var lines = [];

  if(rel === '生我' || rel === '同类') {
    if(isStrong) {
      lines.push('流年' + yganzhi.gan + yganzhi.zhi + '对您<strong style="color:#e74c3c">' + (rel==='同类'?'帮身过旺':'印星过重') + '</strong>，日主已偏旺需注意');
      lines.push('建议：宜主动付出、投资置业或学习新技能转化能量。忌贪多冒进、盲目扩张。');
    } else {
      lines.push('流年' + yganzhi.gan + yganzhi.zhi + '<strong style="color:#27ae60">生助增强</strong>日主，是难得的发力之年！');
      lines.push('建议：宜大胆行动、争取晋升、拓展人脉、启动重要计划。把握机遇，积极进取！');
    }
  } else if(rel === '克我') {
    if(isStrong) {
      lines.push('流年' + yganzhi.gan + yganzhi.zhi + '<strong style="color:#27ae60">官星克制</strong>日主，对偏旺的命局起到调节作用');
      lines.push('建议：这是"压力变动力"的好年份，宜接受挑战、考职晋升、规范自身。贵人多在长辈和领导中。');
    } else {
      lines.push('流年' + yganzhi.gan + yganzhi.zhi + '<strong style="color:#c0392b">七杀攻身</strong>，今年压力较大，需注意健康和人际关系');
      lines.push('建议：以稳为主，不宜激进投资或冒险决策。多做运动增强体魄，遇事冷静三思。修身养性待时机。');
    }
  } else if(rel === '我克') {
    if(isStrong) {
      lines.push('流年' + yganzhi.gan + yganzhi.zhi + '为<strong style="color:#27ae60">财星</strong>，日主有力能担财，<strong style="color:#d4a017">财运较佳</strong>！');
      lines.push('建议：适合理财投资、拓展副业、谈生意合作。但注意不要因追求利益而透支身体。');
    } else {
      lines.push('流年为财星但日主偏弱，<strong style="color:#e67e22">求财辛苦</strong>，需量力而行');
      lines.push('建议：可小试牛刀但不宜大额投入。先稳固基础再谋发展，合作优于单干。');
    }
  } else { // 我生 - 食伤
    lines.push('流年' + yganzhi.gan + yganzhi.zhi + '为<strong>食伤</strong>之星，利于才华展示、创意输出、表达沟通');
    lines.push('建议：适合学习新技能、写作创作、演讲培训、自媒体运营等。灵感充沛的一年！' + (isStrong?'但需收敛锋芒，避免口舌是非。':''));
  }

  // 叠加地支冲合信息
  if(zhiRel === '六冲') {
    lines.push('<strong style="color:#c0392b">⚠️ 注意：流年地支与日支相冲</strong>，年内可能有变动（居住/工作/感情），提前做好预案。');
  } else if(zhiRel === '六合' || zhiRel === '三合') {
    lines.push('<strong style="color:#27ae60">✅ 吉：流年地支与日支构成' + zhiRel + '</strong>，人际和谐，易得暗中相助。');
  } else if(zhiRel === '相刑') {
    lines.push('<span style="color:#e67e22">⚡ 提醒：流年与日支相刑</span>，注意文书合同细节，避免纠纷。');
  }

  // 大运叠加
  if(curDu) {
    var duWxMatch = (curDu.ganElem === yearGanWx || curDu.zhiElem === yearZhiWx);
    if(duWxMatch) {
      lines.push('当前大运「' + curDu.gan + curDu.zhi + '」与流年五行相合，运势有<strong style="color:#27ae60">加成效应</strong>。');
    } else {
      lines.push('叠加当前大运「' + curDu.gan + curDu.zhi + '」(' + curDu.ageStart + '-' + curDu.ageEnd + '岁)的影响。');
    }
  }

  // 缺失五行补充
  if(filling) {
    var fillElems = [];
    if(missing.indexOf(yearGanWx) >= 0) fillElems.push(yearGanWx);
    if(missing.indexOf(yearZhiWx) >= 0) fillElems.push(yearZhiWx);
    lines.push('<strong style="color:#2980b9">🌱 补益：</strong>您的八字缺' + fillElems.join('/') + '，流年正好补上，是难得的平衡之年。');
  }

  return '<ul style="text-align:left;margin:6px 0 0 18px;padding:0;line-height:1.9"><li>' + lines.join('</li><li>') + '</li></ul>';
}

/** 计算当前流年流月影响 */
function calcCurrentFortune(r) {
  var now = new Date();
  var ny = now.getFullYear(), nm = now.getMonth() + 1, nd = now.getDate();

  // 流年干支
  var nl = solarToLunar(ny, nm, nd);
  var yganzhi = getYearGanZhi(nl.year);
  var mganzhi = getMonthGanZhi(ny, nm, nd);
  var dganzhi = getDayGanZhi(ny, nm, nd);

  // 年份卡片HTML
  var html = '<div class="bazi-cf-header">';
  html += '<div class="bazi-cf-year-card">';
  html += '<div class="bazi-cf-label">📅 流年</div>';
  html += '<div class="bazi-cf-value">' + yganzhi.gan + yganzhi.zhi + '年</div>';
  html += '<div style="font-size:12px;opacity:0.8;margin-top:4px">' + nl.year + '年 · ' + SHENGXIAO[ZHI.indexOf(yganzhi.zhi)] + '年</div>';
  html += '</div>';
  html += '<div class="bazi-cf-month-card">';
  html += '<div class="bazi-cf-label">📆 流月</div>';
  html += '<div class="bazi-cf-value">' + mganzhi.gan + mganzhi.zhi + '月</div>';
  html += '<div style="font-size:12px;opacity:0.8;margin-top:4px">' + YUE_LING_NAME[(ZHI.indexOf(mganzhi.zhi)+10)%12] || '' + '</div>';
  html += '</div>';
  html += '</div>';

  // 详细分析
  html += '<div class="bazi-cf-detail">';
  var analyses = [];

  // 1. 流年天干对日主的影响
  var yearGanIdx = GAN.indexOf(yganzhi.gan);
  var yearSS = getShiShenDisplay(r.dayGanIdx, yearGanIdx, r.gender);
  analyses.push({ text: '流年天干「' + yganzhi.gan + '」是您的<strong>' + yearSS + '</strong>', good: ['正财','偏财','正印','偏印','食神','伤官'].indexOf(yearSS) >= 0 });

  // 2. 流年地支与日支的关系
  var dayZhiIdx = ZHI.indexOf(r.pillars.day.zhi);
  var yearZhiIdx = ZHI.indexOf(yganzhi.zhi);
  var zhiRelation = getZhiRelation(dayZhiIdx, yearZhiIdx);
  if(zhiRelation) {
    analyses.push({ text: '流年地支「' + yganzhi.zhi + '」与日支「' + r.pillars.day.zhi + '」构成<strong>' + zhiRelation + '</strong>', good: ['六合','三合'].indexOf(zhiRelation) >= 0 });
  }

  // 3. 流年对五行的补益/克制
  var yearGanWx = WUXING[yearGanIdx];
  var yearZhiWx = ZHI_ELEM[yearZhiIdx];

  var myWx = r.pillars.day.ganElem;
  if(yearGanWx === myWx) {
    analyses.push({ text: '流年天干五行「' + yearGanWx + '」与日主同类，<strong>帮身增强</strong>，自身能量得到加强', good: true });
  }

  // 五行生克检查
  var shengWo = {'木':'水','火':'木','土':'火','金':'土','水':'金'};
  var keWo = {'木':'土','火':'金','土':'水','金':'木','水':'火'};
  if(shengWo[myWx] === yearGanWx) {
    analyses.push({ text: '流年天干「' + yearGanWx + '」<strong>生助</strong>日主「' + myWx + '」，有贵人相助之象', good: true });
  }
  if(keWo[myWx] === yearGanWx) {
    analyses.push({ text: '流年天干「' + yearGanWx + '」<strong>克制</strong>日主「' + myWx + '」，压力稍大但也是锻炼机会', good: false });
  }

  // 4. 流月影响
  var monthGanIdx = GAN.indexOf(mganzhi.gan);
  var monthSS = getShiShenDisplay(r.dayGanIdx, monthGanIdx, r.gender);
  analyses.push({ text: '当月天干「' + mganzhi.gan + '」为<strong>' + monthSS + '</strong>，本月重心与此相关', neutral: true });

  // 5. 当前大运叠加
  if(r.dayun && r.dayun.list) {
    var currentDAge = ny - r.solarDate.y;
    var currentDu = null;
    r.dayun.list.forEach(function(d) {
      if(currentDAge >= d.ageStart && currentDAge <= d.ageEnd) currentDu = d;
    });
    if(currentDu) {
      analyses.push({ text: '当前正处于<strong>「' + currentDu.gan + currentDu.zhi + '」大运</strong>(' + currentDu.ageStart + '-' + currentDu.ageEnd + '岁)，大运五行「' + currentDu.ganElem + '/' + currentDu.zhiElem + '」是长期运势基调', neutral: true });
    }
  }

  // 输出分析结果
  analyses.forEach(function(a) {
    var cls = a.good ? 'bazi-cf-good' : (a.neutral ? 'bazi-cf-neutral' : 'bazi-cf-bad');
    html += '<div class="bazi-cf-item">' + a.text.replace(/>([^<]+)</g, '><span class="' + cls + '">$1</span><') + '</div>';
  });

  html += '</div>'; // end cf-detail

  // 总评（基于八字数据动态生成）
  var overall = generateOverallSummary(r, analyses, yganzhi, mganzhi);
  html += '<div style="text-align:center;margin-top:14px;padding:12px;background:#f8f9fa;border-radius:8px;font-size:14px"><strong>总评：</strong>' + overall + '</div>';
  html += '<p style="font-size:11px;color:#bbb;text-align:center;margin-top:8px">以上分析基于传统命理学简化模型，仅供娱乐参考。命运由自己创造！</p>';

  return { html: html, year: yganzhi, month: mganzhi };
}

/** 地支关系判定 */
function getZhiRelation(zhi1, zhi2) {
  // 六合：子丑-寅亥-卯戌-辰酉-巳午-未申
  var liuhe = [[0,1],[2,11],[3,10],[4,9],[5,8],[6,7]];
  for(var i = 0; i < liuhe.length; i++) {
    if((zhi1 === liuhe[i][0] && zhi2 === liuhe[i][1]) || (zhi1 === liuhe[i][1] && zhi2 === liuhe[i][0])) return '六合';
  }
  // 六冲：子午-丑未-寅申-卯酉-辰戌-巳亥
  var liuchong = [[0,6],[1,7],[2,8],[3,9],[4,10],[5,11]];
  for(var j = 0; j < liuchong.length; j++) {
    if((zhi1 === liuchong[j][0] && zhi2 === liuchong[j][1]) || (zhi1 === liuchong[j][1] && zhi2 === liuchong[j][0])) return '六冲';
  }
  // 三合（简化）：申子辰、寅午戌、巳酉丑、亥卯未
  var sanhe = [[4,0,8],[2,6,10],[5,9,1],[11,3,7]];
  for(var k = 0; k < sanhe.length; k++) {
    if(sanhe[k].indexOf(zhi1) >= 0 && sanhe[k].indexOf(zhi2) >= 0) return '三合';
  }
  // 相刑（简化）：寅巳申、丑戌未、子卯
  var xiangxing = [[2,6,8],[1,10,4],[0,3]];
  for(var m = 0; m < xiangxing.length; m++) {
    if(xiangxing[m].indexOf(zhi1) >= 0 && xiangxing[m].indexOf(zhi2) >= 0) return '相刑';
  }
  // 相害（简化）
  var xianghai = [[0,8],[1,6],[2,10],[3,9],[4,8],[5,7]];
  for(var n = 0; n < xianghai.length; n++) {
    if(xianghai[n].indexOf(zhi1)>=0 && xianghai[n].indexOf(zhi2)>=0) return '相害';
  }
  return null; // 无特殊关系
}

/** 保存八字到IMA知识库 */
function saveBaziToIMA() {
  if(!baziCache) { alert('请先排八字'); return; }

  var r = baziCache;
  var genderText = r.gender === 'male' ? '男' : '女';

  var md = '# 🔮 八字排盘报告\n\n';
  md += '**生成时间**：' + new Date().toLocaleString() + '\n\n';
  md += '---\n\n';

  md += '## 👤 基本信息\n\n';
  md += '| 项目 | 内容 |\n|------|------|\n';
  md += '| 出生日期 | ' + r.birthDate + '（' + (r.inputType==='lunar'?'农历':'公历') + '）' + ' |\n';
  md += '| 公历日期 | ' + r.solarDate.y + '-' + String(r.solarDate.m).padStart(2,'0') + '-' + String(r.solarDate.d).padStart(2,'0') + ' |\n';
  md += '| 性别 | ' + genderText + ' |\n';

  md += '\n## 🎯 四柱八字\n\n';
  md += '| | 年柱 | 月柱 | 日柱' + (r.pillars.hour?' | 时柱':'') + ' |\n';
  md += '|---|------|------|------' + (r.pillars.hour?'|------':'') + ' |\n';
  md += '| 天干 | ' + r.pillars.year.gan + ' | ' + r.pillars.month.gan + ' | **' + r.pillars.day.gan + '**' + (r.pillars.hour?' | '+r.pillars.hour.gan:'') + ' |\n';
  md += '| 地支 | ' + r.pillars.year.zhi + ' | ' + r.pillars.month.zhi + ' | **' + r.pillars.day.zhi + '**' + (r.pillars.hour?' | '+r.pillars.hour.zhi:'') + ' |\n';
  md += '| 五行 | ' + r.pillars.year.ganElem + ' | ' + r.pillars.month.ganElem + ' | **' + r.pillars.day.ganElem + '**' + (r.pillars.hour?' | '+r.pillars.hour.ganElem:'') + ' |\n';

  md += '\n### 五行统计\n\n';
  var wxNames = ['木','火','土','金','水'];
  md += '| 木 | 火 | 土 | 金 | 水 |\n';
  md += '|----|----|----|----|----|\n';
  md += '| ' + r.wuxingStats['木'] + ' | ' + r.wuxingStats['火'] + ' | ' + r.wuxingStats['土'] + ' | ' + r.wuxingStats['金'] + ' | ' + r.wuxingStats['水'] + ' |\n';

  md += '\n## 💡 性格特点分析\n\n';
  md += r.personality.html.replace(/<\/?span[^>]*>/g, '').replace(/<\/?ul[^>]*>/g, '').replace(/<\/?li[^>]*>/g, '\n- ').replace(/<\/?[a-zA-Z][^>]*>/g, '');

  md += '\n## 📊 大运走势\n\n';
  md += '起运年龄：约 **' + r.dayun.startAge + '** 岁\n';
  md += r.dayun.isForward ? '大运方向：**顺排**（阳男/阴女）\n' : '大运方向：**逆排**（阴男/阳女）\n\n';
  md += '| 序号 | 大运 | 五行 | 年龄 | 公历年段 | 状态 |\n';
  md += '|------|------|------|------|----------|------|\n';
  r.dayun.list.forEach(function(d) {
    md += '| ' + d.order + ' | ' + d.gan + d.zhi + ' | ' + d.ganElem+'/'+d.zhiElem + ' | ' + d.ageStart + '-' + d.ageEnd + ' | ' + d.years + '-' + (d.years+9) + ' | ' + (d.statusClass==='bazi-dayun-current'?'📍当前':(d.statusClass==='bazi-dayun-past'?'已过':'未来')) + ' |\n';
  });

  md += '\n## 🌟 当前运势影响\n\n';
  md += '- **流年**：' + r.currentFortune.year.gan + r.currentFortune.year.zhi + '年\n';
  md += '- **流月**：' + r.currentFortune.month.gan + r.currentFortune.month.zhi + '月\n\n';
  md += '> ⚠️ 以上内容基于传统命理学简化算法生成，仅供娱乐参考。\n';
  md += '> 命运始终掌握在自己手中，努力奋斗才是改变人生的关键！\n';

  // 通过IMA MCP保存
  saveBaziMarkdown(md, r.birthDate);
}

var saveBaziMarkdown = saveBaziMarkdown || function(md, birthDate) {
  var statusEl = document.getElementById('baziSaveStatus');
  statusEl.style.display = '';
  statusEl.className = 'bazi-save-status';
  statusEl.innerHTML = '⏳ 正在保存到知识库...';

  // 检查IMA MCP是否可用
  if(typeof mcp__ima_mcp !== 'undefined') {
    try {
      var title = '八字排盘_' + birthDate + '_' + new Date().toISOString().slice(0,10);
      // 尝试调用IMA MCP创建笔记
      mcp__ima_mcp__create_note({
        title: title,
        content: md,
        folderId: ''
      }).then(function(resp) {
        statusEl.className = 'bazi-save-status success';
        statusEl.innerHTML = '✅ 已成功保存到IMA知识库！（标题：' + title + '）';
      }).catch(function(err) {
        statusEl.className = 'bazi-save-status error';
        statusEl.innerHTML = '❌ 保存失败：' + (err.message || JSON.stringify(err)) + '<br><span style="font-size:11px">提示：请确认IMA连接正常，或手动复制下方内容保存</span>';
        showBaziFallbackSave(md);
      });
    } catch(e) {
      showBaziFallbackSave(md);
    }
  } else {
    showBaziFallbackSave(md);
  }
};

function showBaziFallbackSave(md) {
  // 如果IMA不可用，提供复制功能
  var statusEl = document.getElementById('baziSaveStatus');
  statusEl.className = 'bazi-save-status error';
  statusEl.innerHTML = '❌ IMA连接不可用，请手动复制下方内容<br><textarea id="baziMdOutput" rows="8" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px">' + md.replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</textarea><br><button class="btn btn-blue" onclick="var t=document.getElementById(\'baziMdOutput\');t.select();document.execCommand(\'copy\');this.textContent=\'已复制!\'" style="margin-top:4px;padding:5px 14px;font-size:12px">📋 复制Markdown</button>';
}
