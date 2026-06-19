// ===== 工具箱 JS =====

// ===== 工具箱 Tab 切换 =====
var currentToolboxTab = 'calendar';
var calYear = null, calMonth = null;
var calSelectedDate = null;

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
    // 用户可能输入的是名称，查找对应代码
    code = findCodeByName(rawCode) || rawCode;
  }
  // 保存到 GAS
  saveNoteRemote({ action: 'addNote', date: date, code: code, content: text }, function(res) {
    if(res.success) {
      textInput.value = '';
      if(codeInput) codeInput.value = '';
      renderNotes();
    } else {
      alert('保存失败：' + (res.error || '未知错误'));
    }
  });
}

// 通过名称反向查找股票代码
function findCodeByName(name) {
  if(typeof stockDict === 'undefined') return null;
  for(var code in stockDict) {
    if(stockDict[code] === name) return code;
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
  var url = API_URL + '?action=deleteNote&id=' + encodeURIComponent(noteToDelete) + '&callback=?';
  fetchJsonp(url, function(res) {
    noteToDelete = null;
    closeDeleteNote();
    if(res.success) {
      renderNotes();
    } else {
      alert('删除失败：' + (res.error || '未知错误'));
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
    // 如果搜索框为空，显示所有笔记
    renderNotes();
    return;
  }
  var url = API_URL + '?action=searchNotes&keyword=' + encodeURIComponent(keyword) + '&callback=?';
  fetchJsonp(url, function(res) {
    if(res.success) {
      notes = res.data || [];
      // 渲染搜索结果
      var list = document.getElementById('notesList');
      if(notes.length === 0) {
        list.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px 0">未找到匹配的备忘。</p>';
        return;
      }
      var sorted = notes.slice().sort(function(a,b){ return (b.createdAt || b.date).localeCompare(a.createdAt || a.date); });
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
    } else {
      alert('搜索失败：' + (res.error || '未知错误'));
    }
  });
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
