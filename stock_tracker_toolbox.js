// ===== 工具箱 JS =====

// ===== 工具箱 Tab 切换 =====
var currentToolboxTab = 'calendar';
var calYear = null, calMonth = null;
var calSelectedDate = null;

function switchToolboxTab(name) {
  currentToolboxTab = name;
  document.querySelectorAll('.toolbox-tab').forEach(function(t){ t.classList.remove('active'); });
  var map = { calendar:'tb-cal', holdings:'tb-hold' };
  var cls = map[name];
  if(cls){
    var el = document.querySelector('.toolbox-tab.' + cls);
    if(el) el.classList.add('active');
  }
  document.getElementById('toolboxCalendar').style.display = name==='calendar' ? 'block' : 'none';
  document.getElementById('toolboxHoldings').style.display = name==='holdings' ? 'block' : 'none';
  if(name==='calendar') renderCalendar();
  if(name==='holdings') renderHoldingsAnalysis();
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

  // 按日期聚合盈亏（排除做T）+ 收集当天做T盈亏（用于左下角标记，不计入总盈亏）
  var dayProfit = {};
  var dayDoTMap = {};
  for(var i = 0; i < trades.length; i++) {
    var t = trades[i];
    if(t.tIndex > 0) {
      // 做T记录：按录入顺序收集当天做T盈亏，最后一条即最近一次（落在左下角）
      if(!dayDoTMap[t.date]) dayDoTMap[t.date] = [];
      dayDoTMap[t.date].push(t.amount || 0);
      continue;
    }
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
    // 左下角做T标记（按录入顺序：第一次在上，最后一次锚定左下角）
    var doTList = dayDoTMap[ds] || [];
    if(doTList.length > 0) {
      var dotHtml = '<div class="cal-dot-badge">';
      for(var k = 0; k < doTList.length; k++) {
        var damt = doTList[k];
        var dcls = damt >= 0 ? 'cal-dot-profit' : 'cal-dot-loss';
        var dsign = damt >= 0 ? '+' : '';
        var damtText = Math.abs(damt) >= 10000 ? (damt / 10000).toFixed(1) + 'w' : (dsign + damt.toFixed(0));
        dotHtml += '<span class="cal-dot-item ' + dcls + '">T:' + damtText + '</span>';
      }
      dotHtml += '</div>';
      inner += dotHtml;
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

  // 正常交易（tIndex === 0）
  var dayTrades = [];
  for(var i = 0; i < trades.length; i++) {
    if(trades[i].date === dateStr && trades[i].tIndex === 0) {
      dayTrades.push(trades[i]);
    }
  }

  // 若无正常交易，则展示做T记录
  var dayDoTTrades = [];
  if(dayTrades.length === 0) {
    for(var i = 0; i < trades.length; i++) {
      if(trades[i].date === dateStr && trades[i].tIndex > 0) {
        dayDoTTrades.push(trades[i]);
      }
    }
  }

  var html = '';
  if(dayTrades.length === 0 && dayDoTTrades.length === 0) {
    html = '<p style="color:#999;font-size:13px;padding:8px 0">当天无完结交易记录。</p>';
  } else {
    var list = dayTrades.length > 0 ? dayTrades : dayDoTTrades;
    var isDoT = dayTrades.length === 0 && dayDoTTrades.length > 0;
    var total = 0;
    for(var i = 0; i < list.length; i++) {
      var t = list[i];
      var name = getStockName(t.code);
      var amt = t.amount || 0;
      total += amt;
      var cls = amt >= 0 ? 'profit' : 'loss';
      var sign = amt >= 0 ? '+' : '';
      var prefix = isDoT ? '<span style="color:#888;font-size:11px;margin-right:4px">T</span>' : '';
      html += '<div class="cal-detail-row">';
      html += '<span class="cal-detail-label">' + prefix + escapeHtml(name) + '</span>';
      html += '<span class="cal-detail-value ' + cls + '">' + sign + amt.toFixed(2) + ' 元</span>';
      html += '</div>';
    }
    html += '<div class="cal-detail-row" style="border-top:2px solid #ddd;padding-top:8px;margin-top:4px">';
    html += '<span class="cal-detail-label"><b>合计</b></span>';
    var totalCls = total >= 0 ? 'profit' : 'loss';
    var totalSign = total >= 0 ? '+' : '';
    html += '<span class="cal-detail-value ' + totalCls + '"><b>' + totalSign + total.toFixed(2) + ' 元</b></span>';
    html += '</div>';
    if(isDoT) {
      html += '<p style="color:#aaa;font-size:11px;padding-top:6px;margin:0">（做T盈亏不计入总盈亏统计）</p>';
    }
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


