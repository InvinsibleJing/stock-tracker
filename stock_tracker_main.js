
// ===== 配置 =====
var API_URL = localStorage.getItem('stock_api_url') || 'https://script.google.com/macros/s/AKfycbzEUvaFoT8HMmg1S9vZpY6wQvCUQ4KrJJvN1fThfgJn5xztvplzP0Ay8mfkXxU0lkJdWg/exec';
var MAX_RETRIES = 3;
var RETRY_DELAY = 2000;
var trades = [];
var holdings = [];
var isLoading = false;
var isLoadingHoldings = false;
var trendChart = null;
var currentPeriod = 'week';
var isOnline = navigator.onLine;
var deferredPrompt = null; // PWA 安装事件
var acSelectedIndex = -1; // 联想下拉选中索引
var acResults = []; // 当前联想结果
var holdAcSelectedIndex = -1; // 持仓联想下拉选中索引
var holdAcResults = []; // 持仓联想结果
var pendingClearId = ''; // 待清仓的持仓ID
var pendingDoTId = ''; // 待做T的持仓ID
var selectedTIndex = 1; // 当前选中的做T序号
var selectedClearPos = 'full'; // 清仓仓位选择：full/half/third/custom
var selectedClearBatches = 1; // 清仓次数：1=一次全清, 2=分2次清
var selectedCompAcc = 'normal'; // 补录弹窗账户类型
var selectedCompBatches = 1; // 补录弹窗清仓次数
var compAcSelectedIndex = -1; // 补录联想下拉选中索引
var compAcResults = []; // 补录联想结果
var selectedDoTPos = 'full'; // 做T仓位选择：full/half/third/custom
var doTReversed = false; // 做T价格顺序是否调换（true=正T：买回价在前）
var selectedAccountType = 'normal'; // 当前选中的账户类型：normal=正常账户 margin=两融账户

// ===== 手续费计算 =====
// 判断是否为沪市股票（代码6开头）
function isShanghai(code) {
  if (!code) return false;
  var c = String(code).trim();
  return c.charAt(0) === '6';
}

/**
 * 计算单笔交易的手续费
 * @param {number} price - 成交价格
 * @param {number} qty - 成交数量
 * @param {boolean} isSell - 是否为卖出（印花税只在卖出时收）
 * @param {string} accType - 账户类型 'normal' | 'margin'
 * @param {string} stockCode - 股票代码（用于判断沪/深市）
 * @returns {object} { total, commission, stampTax, transferFee }
 */
function calcFees(price, qty, isSell, accType, stockCode) {
  if (!accType || isNaN(price) || isNaN(qty)) return { total: 0, commission: 0, stampTax: 0, transferFee: 0 };
  var amount = price * qty;
  if (amount <= 0) return { total: 0, commission: 0, stampTax: 0, transferFee: 0 };

  var sh = isShanghai(stockCode);
  var commission = 0, stampTax = 0, transferFee = 0;

  if (accType === 'margin') {
    // 两融账户：佣金固定5元/笔
    commission = 5;
    // 过户费：沪市双向收取
    transferFee = sh ? Math.round(amount * 0.00001 * 100) / 100 : 0; // 0.001%
    // 印花税：卖出时收取 0.05%
    if (isSell) stampTax = Math.round(amount * 0.0005 * 100) / 100;
  } else {
    // 正常账户（万一免五）：佣金 0.01%，无最低
    commission = Math.round(amount * 0.0001 * 100) / 100;
    // 过户费：沪市双向收取
    transferFee = sh ? Math.round(amount * 0.00001 * 100) / 100 : 0; // 0.001%
    // 印花税：卖出时收取 0.05%（2025年下调后）
    if (isSell) stampTax = Math.round(amount * 0.0005 * 100) / 100;
  }

  var total = Math.round((commission + stampTax + transferFee) * 100) / 100;
  return { total: total, commission: commission, stampTax: stampTax, transferFee: transferFee };
}

/** 生成持仓成本价 tooltip（买入价格 + 手续费明细） */
function getBuyPriceTip(h) {
  var bp = parseFloat(h.buyPrice) || 0;
  if (bp === 0) return '';
  var qty = h.quantity || 0;
  var accType = h.accountType || 'normal';
  // 用含费成本价反推近似成交价：手续费 = calcFees(成交价, qty, false, accType, h.code)
  // 正向：含费成本价 = (成交价 * qty + 手续费) / qty
  // 近似：直接按含费成本价算手续费（误差极小）
  var estFees = calcFees(bp, qty, false, accType, h.code);
  var rawPrice = bp - estFees.total / qty;
  rawPrice = Math.round(rawPrice * 1000) / 1000;
  var tip = '买入价格约：' + rawPrice.toFixed(3) + ' 元<br>';
  tip += '买入手续费：' + estFees.total.toFixed(2) + ' 元';
  if (estFees.commission > 0) tip += '（佣金' + estFees.commission.toFixed(2) + (estFees.transferFee > 0 ? ' + 过户费' + estFees.transferFee.toFixed(2) : '') + '）';
  return tip;
}

/** 格式化费用明细文本 */
function feeDetailText(fees) {
  if (fees.total === 0) return '';
  var parts = [];
  if (fees.commission > 0) parts.push('佣金' + fees.commission.toFixed(2));
  if (fees.stampTax > 0) parts.push('印花税' + fees.stampTax.toFixed(2));
  if (fees.transferFee > 0) parts.push('过户费' + fees.transferFee.toFixed(2));
  return '（' + parts.join(' + ') + '）';
}

/** 生成交易记录手续费 tooltip 文本 */
function getFeesTooltip(trade) {
  var fee = parseFloat(trade.fees) || 0;
  if (fee <= 0) return '';
  var source = trade.source || '';
  var note = trade.note || '';
  var code = trade.code || '';
  var isMargin = note.indexOf('[两融]') !== -1;
  var isSH = code.charAt(0) === '6';
  var parts = [];
  
  if (source === 'clear') {
    if (isMargin) parts.push('佣金 5.00 元');
    else parts.push('佣金 ≈成交额×0.01%（万一免五）');
    parts.push('印花税 0.05%');
    if (isSH) parts.push('过户费 0.001%（沪市）');
  } else if (source === 'doT') {
    if (isMargin) parts.push('佣金 10.00 元（买卖各5元）');
    else parts.push('佣金 ≈成交额×0.01%×2（万一免五）');
    parts.push('印花税 0.05%（卖出）');
    if (isSH) parts.push('过户费 0.001%×2（沪市）');
  } else {
    parts.push('手动添加');
  }
  
  return '手续费 ¥' + fee.toFixed(2) + '<br>构成：' + parts.join(' + ');
}

// ===== PWA 注册 =====
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').then(function(reg){
    console.log('Service Worker 注册成功', reg.scope);
  }).catch(function(err){
    console.log('Service Worker 注册失败', err);
  });
}

// ===== PWA 安装提示 =====
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  deferredPrompt = e;
  // 延迟3秒显示安装提示（如果用户未点击"以后再说"）
  setTimeout(function(){
    var dismissed = localStorage.getItem('install_dismissed');
    if(deferredPrompt && dismissed !== todayStr()){
      document.getElementById('installBanner').classList.add('show');
    }
  }, 3000);
});

function installPWA(){
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(function(result){
    deferredPrompt = null;
    document.getElementById('installBanner').classList.remove('show');
  });
}

function dismissInstall(){
  document.getElementById('installBanner').classList.remove('show');
  // 当天不再提示
  localStorage.setItem('install_dismissed', todayStr());
}

window.addEventListener('appinstalled', function(){
  document.getElementById('installBanner').classList.remove('show');
  deferredPrompt = null;
});

// ===== 离线检测 =====
window.addEventListener('online', function(){
  isOnline = true;
  document.getElementById('offlineTip').classList.remove('show');
  loadAll(); // 恢复联网时自动同步
});

window.addEventListener('offline', function(){
  isOnline = false;
  document.getElementById('offlineTip').classList.add('show');
  showStatus('offline','📴 离线模式 | 显示缓存数据');
});

// 获取本地日期字符串（YYYY-MM-DD），避免UTC时区偏移
function todayStr(){
  var n=new Date();
  return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0');
}

// ===== 初始化 =====
window.addEventListener('DOMContentLoaded', function(){
  var _inpDate = document.getElementById('inpDate');
  if(_inpDate) _inpDate.value = todayStr();

  // 点击页面其他地方关闭联想下拉
  document.addEventListener('click', function(e){
    if(!e.target.closest('.autocomplete-wrap')){
      document.getElementById('acList').classList.remove('show');
      document.getElementById('holdAcList').classList.remove('show');
      document.getElementById('compAcList').classList.remove('show');
    }
  });

  // 日期输入框：点击任意位置弹出日期选择器
  document.addEventListener('click', function(e){
    var t = e.target;
    if(t.tagName === 'INPUT' && t.type === 'date'){
      setTimeout(function(){
        try { if(t.showPicker) t.showPicker(); } catch(e){}
      }, 10);
    }
  });

  // ===== 事件委托：交易记录表 =====
  document.getElementById('tbBody').addEventListener('click', function(e){
    var target = e.target;
    if(target.classList.contains('del-btn') && target.getAttribute('data-action')==='deleteTrade'){
      deleteTrade(target.getAttribute('data-id'));
      return;
    }
    var td = target.closest('.editable');
    if(td && td.getAttribute('data-id') && td.getAttribute('data-field')){
      beginEdit(td, td.getAttribute('data-id'), td.getAttribute('data-field'));
    }
  });

  // ===== 事件委托：交易记录卡片（移动端） =====
  document.getElementById('tradeCard').addEventListener('click', function(e){
    var target = e.target;
    if((target.classList.contains('trade-card-del') || target.classList.contains('del-btn')) && target.getAttribute('data-action')==='deleteTrade'){
      deleteTrade(target.getAttribute('data-id'));
      return;
    }
    var span = target.closest('.editable');
    if(span && span.getAttribute('data-id') && span.getAttribute('data-field')){
      beginEdit(span, span.getAttribute('data-id'), span.getAttribute('data-field'));
    }
  });

  // ===== 事件委托：持仓表 =====
  document.getElementById('holdBody').addEventListener('click', function(e){
    var target = e.target;
    if(target.classList.contains('btn-clear') && target.getAttribute('data-action')==='clearHolding'){
      openClearHolding(target.getAttribute('data-id'));
      return;
    }
    if(target.classList.contains('btn-dot') && target.getAttribute('data-action')==='doT'){
      openDoT(target.getAttribute('data-id'));
      return;
    }
    if(target.classList.contains('btn-add-more') && target.getAttribute('data-action')==='addMore'){
      openAddMore(target.getAttribute('data-id'));
      return;
    }
    if(target.classList.contains('btn-del-h') && target.getAttribute('data-action')==='deleteHolding'){
      deleteHolding(target.getAttribute('data-id'));
      return;
    }
    var td = target.closest('.editable');
    if(td && td.getAttribute('data-id') && td.getAttribute('data-field')){
      beginEditHolding(td, td.getAttribute('data-id'), td.getAttribute('data-field'));
    }
  });

  // ===== 事件委托：持仓卡片（移动端） =====
  document.getElementById('holdCard').addEventListener('click', function(e){
    var target = e.target;
    if(target.getAttribute('data-action')==='clearHolding'){
      openClearHolding(target.getAttribute('data-id'));
      return;
    }
    if(target.getAttribute('data-action')==='doT'){
      openDoT(target.getAttribute('data-id'));
      return;
    }
    if(target.getAttribute('data-action')==='addMore'){
      openAddMore(target.getAttribute('data-id'));
      return;
    }
    if(target.getAttribute('data-action')==='deleteHolding'){
      deleteHolding(target.getAttribute('data-id'));
      return;
    }
    var span = target.closest('.editable');
    if(span && span.getAttribute('data-id') && span.getAttribute('data-field')){
      beginEditHolding(span, span.getAttribute('data-id'), span.getAttribute('data-field'));
    }
  });

  // ===== 做T弹窗 T1~T5 按钮事件 =====
  document.getElementById('doTIndexGroup').addEventListener('click', function(e){
    var btn = e.target.closest('.t-index-btn');
    if(!btn) return;
    document.querySelectorAll('#doTIndexGroup .t-index-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    selectedTIndex = parseInt(btn.getAttribute('data-idx')) || 1;
  });

  // ===== 账户类型选择按钮事件 =====
  document.getElementById('accountTypeGroup').addEventListener('click', function(e){
    var btn = e.target.closest('.acc-type-btn');
    if(!btn) return;
    document.querySelectorAll('#accountTypeGroup .acc-type-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    selectedAccountType = btn.getAttribute('data-acc') || 'normal';
    // 记住用户选择，刷新不丢失
    try{ localStorage.setItem('stock_account_type', selectedAccountType); }catch(e){}
    // 切换账户时立即筛选持仓列表
    renderHoldings();
  });

  // 恢复上次选择的账户类型
  var savedAccType = localStorage.getItem('stock_account_type');
  if(savedAccType && (savedAccType==='normal'||savedAccType==='margin')){
    selectedAccountType = savedAccType;
    document.querySelectorAll('#accountTypeGroup .acc-type-btn').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-acc')===savedAccType);
    });
  }

  // ===== 清仓弹窗 仓位按钮事件 =====
  setupPosGroup('clearPosGroup', 'clearCustomQty', 'clearQtyDisplay', function(pos){
    selectedClearPos = pos;
    autoCalcClearProfit();
    // 根据仓位类型更新提示文字
    var desc = document.getElementById('clearDesc');
    if(pos === 'full'){
      desc.innerHTML = '将该持仓清仓，盈亏将记录到交易记录中。<b>请填写该股票的真实总盈亏金额</b>，此金额即为该股票全周期的最终结果。';
    } else {
      desc.innerHTML = '部分清仓，盈亏将记录到交易记录中。<b>请填写本次清仓部分的真实盈亏金额</b>（仅本次操作的盈亏，非全部持仓的总盈亏）。';
    }
  });

  // ===== 清仓弹窗 清仓次数按钮事件 =====
  document.getElementById('clearBatchGroup').addEventListener('click', function(e){
    var btn = e.target.closest('.pos-btn');
    if(!btn) return;
    document.querySelectorAll('#clearBatchGroup .pos-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    selectedClearBatches = parseInt(btn.getAttribute('data-batch')) || 1;
    autoCalcClearProfit();
  });

  // ===== 补录弹窗 账户类型按钮 =====
  document.getElementById('completeAccGroup').addEventListener('click', function(e){
    var btn = e.target.closest('.acc-type-btn');
    if(!btn) return;
    document.querySelectorAll('#completeAccGroup .acc-type-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    selectedCompAcc = btn.getAttribute('data-acc') || 'normal';
    // 显示/隐藏清仓次数（仅两融）
    document.getElementById('compBatchWrap').style.display = (selectedCompAcc === 'margin') ? 'block' : 'none';
    autoCalcCompProfit();
  });

  // ===== 补录弹窗 清仓次数按钮 =====
  document.getElementById('compBatchGroup').addEventListener('click', function(e){
    var btn = e.target.closest('.pos-btn');
    if(!btn) return;
    document.querySelectorAll('#compBatchGroup .pos-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    selectedCompBatches = parseInt(btn.getAttribute('data-batch')) || 1;
    // 显示/隐藏第二次清仓价格
    var show2 = selectedCompBatches === 2;
    document.getElementById('compSellPrice2Wrap').style.display = show2 ? '' : 'none';
    document.getElementById('compSellPrice').parentElement.querySelector('label').textContent = show2 ? '第一次清仓价格（元）' : '清仓价格（元）';
    autoCalcCompProfit();
  });

  // ===== 做T弹窗 仓位按钮事件 =====
  setupPosGroup('doTPosGroup', 'doTCustomQty', 'doTQtyDisplay', function(pos){ selectedDoTPos = pos; autoCalcDoTProfit(); });

  if(!isOnline){
    document.getElementById('offlineTip').classList.add('show');
    loadCachedData();
  } else {
    loadAll();
  }

  // 跨终端同步：页面从不可见变为可见时，立即同步一次（零配额消耗）
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && isOnline) _silentSync();
  });

  // 跨终端自动同步：每30秒静默拉取一次，有变化才刷新
  setInterval(function(){
    if(!document.hidden && isOnline) _silentSync();
  }, 30000);

  // 当前时间（每秒刷新）
  updateCurrentTime();
  setInterval(updateCurrentTime, 1000);
});

function updateCurrentTime(){
  var el = document.getElementById('currentTimeStr');
  if(!el) return;
  var n = new Date();
  el.textContent = String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
  // 时辰（23-1子, 1-3丑, 3-5寅 ... 每2小时一个时辰）
  var h = n.getHours();
  var shiChenNames = ['子时','丑时','寅时','卯时','辰时','巳时','午时','未时','申时','酉时','戌时','亥时'];
  // 23:00-00:59 -> 子时(0); 01:00-02:59 -> 丑时(1) ...
  var idx = Math.floor((h + 1) / 2) % 12;
  var scEl = document.getElementById('currentShiChen');
  if(scEl) scEl.textContent = shiChenNames[idx];
}

// ===== 本地缓存数据（离线兜底） =====
function cacheData(data){
  try{ localStorage.setItem('stock_cache', JSON.stringify(data)); }catch(e){}
}

function loadCachedData(){
  try{
    var cached = localStorage.getItem('stock_cache');
    if(cached){
      trades = JSON.parse(cached);
      renderTable(); updateStats();
      showStatus('offline','📴 离线模式 | '+trades.length+' 条缓存记录');
    } else {
      showStatus('offline','📴 离线模式 | 无缓存数据');
    }
  }catch(e){
    showStatus('offline','📴 离线模式 | 无缓存数据');
  }
}

// ===== 状态 =====
function showStatus(type,msg){
  var bar = document.getElementById('statusBar');
  bar.className = 'status-bar ' + (type==='ok'?'status-ok':type==='err'?'status-err':type==='offline'?'status-offline':'status-load');
  bar.textContent = msg;
}

// ===== Tab 切换 =====
function switchTab(name){
  // 找到对应的主tab（不是周期tab）
  var mainTabs = document.querySelectorAll('.container > .tabs .tab');

  document.getElementById('tabToolbox').style.display = name==='toolbox'?'block':'none';
  document.getElementById('tabTable').style.display = name==='table'?'block':'none';
  document.getElementById('tabAnalysis').style.display = name==='analysis'?'block':'none';

  // 更新tab样式
  var tabBtns = document.querySelectorAll('.container > .tabs .tab');
  tabBtns.forEach(function(t){ t.classList.remove('active'); });
  if(name==='toolbox'){ tabBtns[0].classList.add('active'); switchToolboxTab('calendar'); }
  if(name==='table') tabBtns[1].classList.add('active');
  if(name==='analysis') tabBtns[2].classList.add('active');

  if(name==='analysis') renderAnalysis();
  if(name==='table'){ renderTable(); renderHoldings(); }
  if(name==='toolbox') switchToolboxTab('calendar');
}

// ===== 股票联想搜索 =====
function getStockName(code) {
  if (!code || typeof STOCK_DICT === 'undefined') return code || '';
  var entry = STOCK_DICT[code];
  if (entry) return entry[0];
  // 兼容被 Sheets 去掉前导零的代码（如 2600 → 002600）
  var padded = String(code).padStart(6, '0');
  entry = STOCK_DICT[padded];
  return entry ? entry[0] : code;
}

function onCodeInput() {
  var input = document.getElementById('inpCode');
  var val = input.value.trim().toLowerCase();
  var list = document.getElementById('acList');

  if (!val || typeof STOCK_DICT === 'undefined') {
    list.classList.remove('show');
    acResults = [];
    acSelectedIndex = -1;
    return;
  }

  acResults = [];
  var count = 0;
  for (var code in STOCK_DICT) {
    if (count >= 30) break;
    var name = STOCK_DICT[code][0];
    var py = STOCK_DICT[code][1];
    if (code.indexOf(val) === 0 || py.indexOf(val) === 0) {
      acResults.push({ code: code, name: name, pinyin: py });
      count++;
    }
  }

  if (acResults.length === 0) {
    list.classList.remove('show');
    acSelectedIndex = -1;
    return;
  }

  acSelectedIndex = -1;
  renderAcList();
  list.classList.add('show');
}

function renderAcList() {
  var list = document.getElementById('acList');
  var html = '';
  for (var i = 0; i < acResults.length; i++) {
    var r = acResults[i];
    var selected = i === acSelectedIndex ? ' style="background:#f0f7ff"' : '';
    html += '<div class="autocomplete-item"' + selected + ' onclick="selectAcItem(' + i + ')" data-index="' + i + '">';
    html += '<span class="ac-name">' + escapeHtml(r.name) + '</span>';
    html += '<span class="ac-code">' + r.code + '</span>';
    html += '</div>';
  }
  list.innerHTML = html;
}

// 根据股票代码自动识别板块
function autoDetectTag(code) {
  if (!code) return;
  var c = code.replace(/\s/g, '');
  var tag = '';
  if (c.indexOf('30') === 0) tag = '创业板';
  else if (c.indexOf('68') === 0) tag = '科创板';
  else if (c.indexOf('60') === 0 || c.indexOf('00') === 0) tag = '主板';
  if (tag) document.getElementById('inpTag').value = tag;
}

function selectAcItem(index) {
  var r = acResults[index];
  document.getElementById('inpCode').value = r.code;
  autoDetectTag(r.code);
  document.getElementById('acList').classList.remove('show');
  acSelectedIndex = -1;
  acResults = [];
}

function onCodeKeydown(e) {
  var list = document.getElementById('acList');
  if (!list.classList.contains('show') || acResults.length === 0) {
    if (e.key === 'Enter') addTrade();
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acSelectedIndex = Math.min(acSelectedIndex + 1, acResults.length - 1);
    renderAcList();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acSelectedIndex = Math.max(acSelectedIndex - 1, -1);
    renderAcList();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (acSelectedIndex >= 0) {
      selectAcItem(acSelectedIndex);
    } else {
      document.getElementById('acList').classList.remove('show');
      addTrade();
    }
  } else if (e.key === 'Escape') {
    list.classList.remove('show');
    acSelectedIndex = -1;
  }
}

// ===== 设置 =====
// ===== 设置 =====
function openSettings(){ document.getElementById('settingsModal').classList.add('active'); document.getElementById('inpApiUrl').value=API_URL; }
function closeSettings(){ document.getElementById('settingsModal').classList.remove('active'); }
function saveSettings(){
  var url=document.getElementById('inpApiUrl').value.trim();
  if(!url){ alert('请输入API URL！'); return; }
  API_URL=url; localStorage.setItem('stock_api_url',url);
  closeSettings(); showStatus('load','⏳ 正在连接...'); loadTrades();
}

// ===== API（GAS JSONP + 自动重试） =====
function apiCall(params, callback, _retries){
  if(!API_URL){ showStatus('err','⚠️ 未配置云端数据库'); return; }
  var retries = typeof _retries === 'number' ? _retries : 0;
  var callbackName = 'cb_'+Date.now()+'_'+Math.floor(Math.random()*10000);
  params.callback = callbackName;
  var parts=[];
  for(var k in params){ parts.push(encodeURIComponent(k)+'='+encodeURIComponent(params[k])); }
  var url = API_URL + '?' + parts.join('&');

  window[callbackName] = function(data){ delete window[callbackName]; document.head.removeChild(script); callback(data); };
  var script = document.createElement('script');
  script.src = url;
  script.onerror = function(){
    delete window[callbackName];
    if(script.parentNode) document.head.removeChild(script);
    if(retries < MAX_RETRIES - 1){
      var next = retries + 1;
      showStatus('load','⏳ 连接失败，第 '+next+'/'+(MAX_RETRIES-1)+' 次重试...');
      setTimeout(function(){ apiCall(params, callback, next); }, RETRY_DELAY);
    } else {
      showStatus('err','❌ 网络错误（已重试 '+(MAX_RETRIES-1)+' 次）');
      callback({success:false,error:'网络错误'});
    }
  };
  var timer = setTimeout(function(){
    if(window[callbackName]){
      delete window[callbackName];
      if(script.parentNode) document.head.removeChild(script);
      if(retries < MAX_RETRIES - 1){
        var next = retries + 1;
        showStatus('load','⏳ 响应超时，第 '+next+'/'+(MAX_RETRIES-1)+' 次重试...');
        setTimeout(function(){ apiCall(params, callback, next); }, RETRY_DELAY);
      } else {
        showStatus('err','❌ 请求超时（已重试 '+(MAX_RETRIES-1)+' 次）');
        callback({success:false,error:'请求超时'});
      }
    }
  }, 15000);
  var origCb = window[callbackName];
  window[callbackName] = function(data){ clearTimeout(timer); origCb(data); };
  document.head.appendChild(script);
}

function loadAll(){
  _tradesLoaded=false; _holdingsLoaded=false;
  loadTrades();
  loadHoldings();
}

// ===== 跨终端自动同步（页面可见时触发） =====

// 检查是否有未同步的乐观更新（tmp_ 开头的ID）
function _hasPendingOptimistic(){
  for(var i=0;i<trades.length;i++){ if(trades[i].id && trades[i].id.indexOf('tmp_')===0) return true; }
  for(var i=0;i<holdings.length;i++){ if(holdings[i].id && holdings[i].id.indexOf('tmp_')===0) return true; }
  return false;
}

// 简单比较两个数据数组是否相同（比ID和长度）
function _dataChanged(oldArr, newArr, idField){
  if(oldArr.length !== newArr.length) return true;
  // 按ID排序后逐条对比，用 JSON 比对内容变化
  var oldSorted = oldArr.slice().sort(function(a,b){ return String(a.id).localeCompare(String(b.id)); });
  var newSorted = newArr.slice().sort(function(a,b){ return String(a.id).localeCompare(String(b.id)); });
  for(var i=0;i<oldSorted.length;i++){
    if(JSON.stringify(oldSorted[i]) !== JSON.stringify(newSorted[i])) return true;
  }
  return false;
}

// 静默同步：后台拉取数据，有变化才刷新UI
function _silentSync(){
  // 有未同步的乐观更新时跳过，避免覆盖
  if(_hasPendingOptimistic()) return;
  // 离线时跳过
  if(!isOnline) return;

  apiCall({action:'list'}, function(res){
    if(res && res.success && res.data){
      var newTrades = res.data;
      apiCall({action:'listHoldings'}, function(res2){
        if(res2 && res2.success && res2.data){
          var newHoldings = res2.data;
          var tradesChanged = _dataChanged(trades, newTrades);
          var holdingsChanged = _dataChanged(holdings, newHoldings);
          if(tradesChanged || holdingsChanged){
            trades = newTrades;
            holdings = newHoldings;
            cacheData(trades);
            try{ localStorage.setItem('stock_holdings_cache', JSON.stringify(holdings)); }catch(e){}
            refreshUI();
            _checkSyncStatus();
          }
        }
      });
    }
  });

  // 同时静默同步备忘笔记
  apiCall({action:'getNotes'}, function(res){
    if(res && res.success && res.data){
      var newNotes = res.data;
      var notesChanged = _dataChanged(notes, newNotes);
      if(notesChanged){
        notes = newNotes;
        try{ localStorage.setItem('stock_notes_cache', JSON.stringify(notes)); }catch(e){}
        // 如果当前在备忘Tab，刷新显示
        var toolboxNotes = document.getElementById('toolboxNotes');
        if(toolboxNotes && toolboxNotes.style.display !== 'none'){
          renderNotes();
        }
      }
    }
  });
}

// ===== 乐观更新辅助函数 =====
// 生成临时ID（以 tmp_ 开头，云端同步成功后会被真ID替换）
var _tmpIdCounter = 0;
function genTempId(){ return 'tmp_' + Date.now() + '_' + (++_tmpIdCounter); }

// 刷新界面（交易记录表 + 统计 + 持仓表）
function refreshUI(){
  renderTable(); updateStats(); renderHoldings();
  cacheData(trades);
  try{ localStorage.setItem('stock_holdings_cache', JSON.stringify(holdings)); }catch(e){}
}

// 乐观更新失败时的回滚处理
function rollbackOptimistic(savedTrades, savedHoldings, msg){
  trades = savedTrades;
  holdings = savedHoldings;
  refreshUI();
  showStatus('err', msg || '❌ 操作失败，已回滚');
}



function _checkSyncStatus(){
  // 等两者都加载完再显示合并状态
  if(_tradesLoaded && _holdingsLoaded){
    var t = (trades||[]).length;
    var h = (holdings||[]).length;
    showStatus('ok','✅ 云端同步成功 | '+h+'条持仓 | '+t+'条记录');
  }
}

function loadTrades(){
  // 第一步：立即显示缓存数据（<100ms，不等待GAS）
  var cached = localStorage.getItem('stock_cache');
  if(cached){
    try {
      trades = JSON.parse(cached);
      renderTable(); updateStats();
      showStatus('load','🔄 本地数据已加载，正在同步云端...');
    } catch(e) {
      trades = [];
      showStatus('load','⏳ 正在同步数据...');
    }
  } else {
    showStatus('load','⏳ 正在同步数据...');
  }
  
  // 第二步：后台静默同步GAS（2-3s后返回，有变化才重绘）
  isLoading = true;
  apiCall({action:'list'}, function(res){
    isLoading = false;
    if(res && res.success){
      var newData = res.data || [];
      // 简单判断：数量不同或有新ID才重绘（避免无变化也闪屏）
      var needRender = (newData.length !== trades.length);
      if(!needRender && newData.length > 0){
        // 数量相同，再比一下第一条的ID
        var oldIds = {};
        for(var i=0;i<trades.length;i++){ oldIds[trades[i].id]=1; }
        for(var j=0;j<newData.length;j++){
          if(!oldIds[newData[j].id]){ needRender=true; break; }
        }
      }
      if(needRender){
        trades = newData;
        cacheData(trades);
        renderTable(); updateStats();
      }
      _tradesLoaded = true; _checkSyncStatus();
    } else {
      _tradesLoaded = true; _checkSyncStatus();
    }
  });
}

function loadHoldings(){
  // 第一步：立即显示缓存数据
  var cached = localStorage.getItem('stock_holdings_cache');
  if(cached){
    try {
      holdings = JSON.parse(cached);
      renderHoldings();
    } catch(e) { /* ignore */ }
  }
  
  // 第二步：后台静默同步GAS
  isLoadingHoldings = true;
  apiCall({action:'listHoldings'}, function(res){
    isLoadingHoldings = false;
    if(res && res.success){
      var newData = res.data || [];
      // 只有数据有变化才重新渲染
      var needRender = (newData.length !== holdings.length);
      if(!needRender && newData.length > 0){
        var oldIds = {};
        for(var i=0;i<holdings.length;i++){ oldIds[holdings[i].id]=1; }
        for(var j=0;j<newData.length;j++){
          if(!oldIds[newData[j].id]){ needRender=true; break; }
        }
      }
      if(needRender){
        holdings = newData;
        try{ localStorage.setItem('stock_holdings_cache', JSON.stringify(holdings)); }catch(e){}
        renderHoldings();
      }
      _holdingsLoaded = true; _checkSyncStatus();
    } else {
      _holdingsLoaded = true; _checkSyncStatus();
    }
  });
}

// ===== 添加 =====
function addTrade(){
  if(isLoading){ alert('数据加载中'); return; }
  var date=document.getElementById('inpDate').value;
  var code=document.getElementById('inpCode').value.trim();
  var tag=document.getElementById('inpTag').value;
  var quantity=parseInt(document.getElementById('inpQuantity').value)||0;
  var amount=parseFloat(document.getElementById('inpAmount').value);
  var note=document.getElementById('inpNote').value.trim();
  if(!date||isNaN(amount)){ alert('请填写交易日期和盈利金额！'); return; }

  // 乐观更新：先在前端添加
  var tmpId = genTempId();
  var savedTrades = JSON.parse(JSON.stringify(trades));
  trades.push({id:tmpId, date:date, code:code, tag:tag, quantity:quantity, amount:amount, note:note, tIndex:0, status:'closed', source:'manual'});
  refreshUI();
  showStatus('ok','✅ 已添加');

  // 后台同步
  apiCall({action:'add',date:date,code:code,tag:tag,quantity:quantity,amount:amount,note:note}, function(res){
    if(res&&res.success){
      document.getElementById('inpCode').value='';
      document.getElementById('inpQuantity').value='';
      document.getElementById('inpAmount').value='';
      document.getElementById('inpNote').value='';
      // 用云端真ID替换临时ID，并重新渲染UI（更新onclick中的ID引用）
      for(var i=0;i<trades.length;i++){
        if(trades[i].id===tmpId){ trades[i].id=res.id; break; }
      }
      cacheData(trades);
      refreshUI();
      _checkSyncStatus();
    } else {
      rollbackOptimistic(savedTrades, holdings, '❌ 添加失败：'+(res?res.error:''));
    }
  });
}

// ===== 删除 =====
function deleteTrade(id){
  if(isLoading) return;
  var t=null;
  for(var i=0;i<trades.length;i++){ if(String(trades[i].id)===String(id)){ t=trades[i]; break; } }
  if(!t) return;
  pendingDeleteTradeId=id;
  document.getElementById('delTradeStockName').textContent=escapeHtml(getStockName(t.code))||t.code;
  document.getElementById('deleteTradeModal').classList.add('active');
}
function closeDeleteTrade(){ document.getElementById('deleteTradeModal').classList.remove('active'); pendingDeleteTradeId=''; }

function submitDeleteTrade(){
  var id = pendingDeleteTradeId;
  closeDeleteTrade();

  // 乐观更新：先从前端删除
  var savedTrades = JSON.parse(JSON.stringify(trades));
  trades = trades.filter(function(t){ return String(t.id) !== String(id); });
  refreshUI();
  showStatus('ok','✅ 已删除');

  // 后台同步
  apiCall({action:'delete',id:id}, function(res){
    if(!res||!res.success){
      trades = savedTrades;
      refreshUI();
      showStatus('err','❌ 删除失败');
    } else {
      _checkSyncStatus();
    }
  });
}

// ===== 清空 =====

// ===== 行内编辑 =====
function beginEdit(cell, id, field){
  if(cell.classList.contains('editor')) return;
  var trade=null;
  for(var i=0;i<trades.length;i++){ if(String(trades[i].id)===String(id)){ trade=trades[i]; break; } }
  if(!trade) return;

  var oldHtml=cell.innerHTML;
  cell.classList.add('editor');
  cell.innerHTML='';

  var input;
  if(field==='date'){
    input=document.createElement('input'); input.type='date';
    input.value=formatDate(trade.date); input.className='editor-date';
    setTimeout(function(){ if(input.showPicker) try{input.showPicker();}catch(e){} },80);
  } else if(field==='amount'){
    input=document.createElement('input'); input.type='number'; input.step='0.01';
    input.value=trade.amount;
  } else if(field==='quantity'){
    input=document.createElement('input'); input.type='number'; input.step='100';
    input.value=trade.quantity || '';
  } else if(field==='fees'){
    input=document.createElement('input'); input.type='number'; input.step='0.01';
    input.value=trade.fees || 0;
  } else if(field==='code'){
    input=document.createElement('input'); input.type='text';
    input.value=trade.code||'';
    input.placeholder='输入代码或首字母';
    // 行内编辑时的联想支持
    var editAc=document.createElement('div');
    editAc.className='autocomplete-list';
    editAc.style.position='absolute';
    var editAcResults=[];
    var editAcIndex=-1;
    input.addEventListener('input',function(){
      var v=input.value.trim().toLowerCase();
      if(!v||typeof STOCK_DICT==='undefined'){editAc.classList.remove('show');editAcResults=[];return;}
      editAcResults=[];editAcIndex=-1;var cnt=0;
      for(var c in STOCK_DICT){
        if(cnt>=15)break;
        var n=STOCK_DICT[c][0],py=STOCK_DICT[c][1];
        if(c.indexOf(v)===0||py.indexOf(v)===0){editAcResults.push({code:c,name:n});cnt++;}
      }
      if(editAcResults.length===0){editAc.classList.remove('show');return;}
      var ah='';
      for(var j=0;j<editAcResults.length;j++){
        ah+='<div class="autocomplete-item" data-idx="'+j+'"><span class="ac-name">'+escapeHtml(editAcResults[j].name)+'</span><span class="ac-code">'+editAcResults[j].code+'</span></div>';
      }
      editAc.innerHTML=ah;
      editAc.classList.add('show');
      editAc.querySelectorAll('.autocomplete-item').forEach(function(item){
        item.addEventListener('mousedown',function(ev){
          ev.preventDefault();
          var idx=parseInt(item.getAttribute('data-idx'));
          input.value=editAcResults[idx].code;
          editAc.classList.remove('show');
        });
      });
    });
    cell.style.position='relative';
    cell.appendChild(editAc);
    input.addEventListener('blur',function(){ setTimeout(function(){editAc.classList.remove('show');},150); });
  } else if(field==='tag'){
    input=document.createElement('select'); input.className='editor-select';
    ['主板','创业板','科创板'].forEach(function(t){
      var opt=document.createElement('option'); opt.value=t; opt.textContent=t;
      if((trade.tag||'主板')===t) opt.selected=true;
      input.appendChild(opt);
    });
  } else {
    input=document.createElement('input'); input.type='text';
    input.value=trade.note||'';
    setTimeout(function(){ input.setSelectionRange(input.value.length,input.value.length); },80);
  }

  cell.appendChild(input);
  input.focus();

  function finish(){
    var v=input.value.trim();
    if(field==='amount'&&v===''){ cancel(); return; }
    if(field==='quantity'&&v===''){ v='0'; }

    // 乐观更新：先在前端修改
    var savedTrades = JSON.parse(JSON.stringify(trades));
    var oldVal;
    for(var i=0;i<trades.length;i++){
      if(String(trades[i].id)===String(id)){
        oldVal = trades[i][field];
        if(field==='amount') trades[i].amount = parseFloat(v);
        else if(field==='quantity') trades[i].quantity = parseInt(v)||0;
        else if(field==='fees') trades[i].fees = parseFloat(v)||0;
        else if(field==='code') trades[i].code = v;
        else if(field==='tag') trades[i].tag = v;
        else if(field==='date') trades[i].date = v;
        else if(field==='note') trades[i].note = v;
        break;
      }
    }
    cell.classList.remove('editor');
    refreshUI();
    showStatus('ok','✅ 已保存');

    // 后台同步
    apiCall({action:'update',id:id,field:field,value:v}, function(res){
      if(!res||!res.success){
        // 回滚
        for(var j=0;j<trades.length;j++){
          if(String(trades[j].id)===String(id)){
            trades[j][field] = oldVal;
            break;
          }
        }
        refreshUI();
        showStatus('err','❌ 保存失败');
      } else {
        _checkSyncStatus();
      }
    });
  }
  function cancel(){ cell.classList.remove('editor'); cell.innerHTML=oldHtml; }

  input.addEventListener('blur',function(){ setTimeout(finish,120); });
  input.addEventListener('keydown',function(e){
    if(e.key==='Enter'){ e.preventDefault(); input.blur(); }
    if(e.key==='Escape') cancel();
  });
  if(input.tagName==='SELECT'){
    input.addEventListener('change',function(){ input.blur(); });
  }
}

// ===== 渲染表格 =====
function renderTable(){
  var tbody=document.getElementById('tbBody');
  var cardEl=document.getElementById('tradeCard');
  var msg=document.getElementById('emptyMsg');
  if(trades.length===0){ tbody.innerHTML=''; cardEl.innerHTML=''; msg.style.display='block'; return; }
  msg.style.display='none';

  trades.sort(function(a,b){ var dd=new Date(b.date)-new Date(a.date); if(dd!==0) return dd; return b.id.localeCompare(a.id); });

  // 按月份分组（YYYY-MM）
  var groups = [];
  var curMonth = '';
  for(var i=0;i<trades.length;i++){
    var t = trades[i];
    var m = t.date.substring(0,7); // "2026-06"
    if(m !== curMonth){
      curMonth = m;
      groups.push({ month: m, label: m.replace('-','年')+'月', trades: [] });
    }
    groups[groups.length-1].trades.push(t);
  }

  var html='';
  var cardHtml='';
  var seq = 0;

  for(var gi=0;gi<groups.length;gi++){
    var g = groups[gi];
    var gTrades = g.trades;
  // 计算该月统计（排除做T记录，与顶部总盈亏口径一致）
    var gCount = gTrades.length;
    var gProfit = 0, gFees = 0;
    for(var k=0;k<gTrades.length;k++){
      if((gTrades[k].tIndex||0)===0) gProfit += gTrades[k].amount;
      gFees += (parseFloat(gTrades[k].fees)||0);
    }
    var gCls = gProfit >= 0 ? 'profit' : 'loss';
    var gSign = gProfit >= 0 ? '+' : '';
    var gOpen = gi === 0; // 默认展开最新月份

    // 桌面端：月份标题行（盈亏对齐盈亏列，手续费对齐手续费列）
    html+='<tr class="month-header" data-month="'+g.month+'" onclick="toggleMonth(this)" style="cursor:pointer;background:#f0f4f8">';
    html+='<td colspan="5" style="padding:10px 12px;text-align:left;font-weight:600;font-size:13px;color:#2c3e50">';
    html+='<span class="month-toggle" style="display:inline-block;width:18px;transition:transform 0.2s">'+(gOpen?'▼':'▶')+'</span> ';
    html+=escapeHtml(g.label)+' <span style="color:#888;font-weight:400">'+gCount+'条</span>';
    html+='</td>';
    html+='<td class="'+gCls+'" style="font-weight:600;text-align:center">'+gSign+'¥'+Math.abs(gProfit).toFixed(2)+'</td>';
    html+='<td style="color:#8e44ad;font-weight:600;text-align:center">'+(gFees>0?'¥'+gFees.toFixed(2):'-')+'</td>';
    html+='<td colspan="3"></td>';
    html+='</tr>';

    // 桌面端的行样式（按月份隐藏）
    var rowStyle = gOpen ? '' : ' style="display:none"';

    for(var j=0;j<gTrades.length;j++){
      seq++;
      var t=gTrades[j], ip=t.amount>0, cls=ip?'profit':'loss', sign=t.amount>=0?'+':'';
    var rawNote = (t.note||'').replace('[正常]','').replace('[两融]','').replace('[补录]','').trim();
    var noteShow=escapeHtml(rawNote||'-');
    var noteForOnclick=(t.note||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var tagClass=t.tag==='创业板'?'tag-gem':t.tag==='科创板'?'tag-star':'tag-main';
    var stockName=escapeHtml(getStockName(t.code))||'-';

    // T 标徽章：做T记录显示 T1~T5，盈利红色，亏损绿色
    var tIdx = t.tIndex || 0;
    var tBadgeHtml = '';
    if(tIdx > 0){
      var tBadgeCls = ip ? 't-badge-profit' : 't-badge-loss';
      tBadgeHtml = '<span class="t-badge '+tBadgeCls+'">T'+tIdx+'</span>';
      // 做T记录显示账户徽章（从备注中解析[正常]/[两融]）
      var tNote = t.note || '';
      if(tNote.indexOf('[两融]')!==-1){
        tBadgeHtml += '<span class="acc-badge acc-margin" style="font-size:10px">两融</span>';
      } else if(tNote.indexOf('[正常]')!==-1){
        tBadgeHtml += '<span class="acc-badge acc-normal" style="font-size:10px">正常</span>';
      }
    }

    // 清仓来源徽章（绿色，标识该记录由清仓操作产生）
    var sourceHtml = '';
    var tSource = t.source || '';
    if(tSource === 'clear'){
      sourceHtml = '<span class="source-clear">清仓</span>';
      // 清仓记录显示账户徽章（从备注中解析[正常]/[两融]）
      var cNote = t.note || '';
      if(cNote.indexOf('[两融]')!==-1){
        sourceHtml += '<span class="acc-badge acc-margin" style="font-size:10px;margin-left:4px">两融</span>';
      } else if(cNote.indexOf('[正常]')!==-1){
        sourceHtml += '<span class="acc-badge acc-normal" style="font-size:10px;margin-left:4px">正常</span>';
      }
    }

    // 手续费显示 + tooltip
    var feesShow = (t.fees && t.fees > 0) ? '¥' + t.fees.toFixed(2) : '-';
    var feesTooltip = (t.fees && t.fees > 0) ? getFeesTooltip(t) : '';

    // 桌面端表格行
    html+='<tr class="month-row-'+g.month+'"'+rowStyle+'>';
    html+='<td>'+seq+'</td>';
    html+='<td class="editable" data-id="'+t.id+'" data-field="date">'+formatDate(t.date)+'</td>';
    html+='<td class="editable" data-id="'+t.id+'" data-field="code" style="text-align:left">'+stockName+tBadgeHtml+sourceHtml+'</td>';
    html+='<td class="editable" data-id="'+t.id+'" data-field="tag"><span class="tag '+tagClass+'">'+(t.tag||'主板')+'</span></td>';
    html+='<td class="editable" data-id="'+t.id+'" data-field="quantity">'+(t.quantity?t.quantity+'股':'-')+'</td>';
    html+='<td class="editable '+cls+'" data-id="'+t.id+'" data-field="amount">'+sign+'¥'+t.amount.toFixed(2)+'</td>';
    html+='<td class="editable" data-id="'+t.id+'" data-field="fees" style="color:#7f8c8d">'+feesShow+(feesTooltip?'<div class="tooltip-box">'+feesTooltip+'</div>':'')+'</td>';
    html+='<td class="'+cls+'">'+(ip?'成功':'失败')+'</td>';
    html+='<td class="editable" data-id="'+t.id+'" data-field="note">'+noteShow+'</td>';
    html+='<td><button class="del-btn" data-id="'+t.id+'" data-action="deleteTrade">删除</button></td>';
    html+='</tr>';

    // 移动端卡片（按月份分组包裹）
    cardHtml+='<div class="trade-card-item month-row-'+g.month+'"'+rowStyle+'>';
    cardHtml+='<div class="trade-card-header">';
    cardHtml+='<span class="trade-card-name">'+stockName+tBadgeHtml+sourceHtml+'</span>';
    cardHtml+='<span class="trade-card-amount '+(ip?'red':'green')+'">'+sign+'¥'+t.amount.toFixed(2)+'</span>';
    cardHtml+='</div>';
    cardHtml+='<div class="trade-card-row"><span class="label">日期</span><span class="editable" data-id="'+t.id+'" data-field="date">'+formatDate(t.date)+'</span></div>';
    cardHtml+='<div class="trade-card-row"><span class="label">数量</span><span class="editable" data-id="'+t.id+'" data-field="quantity">'+(t.quantity?t.quantity+'股':'-')+'</span></div>';
    if(t.fees && t.fees > 0) cardHtml+='<div class="trade-card-row"><span class="label">手续费</span><span style="color:#7f8c8d">¥'+t.fees.toFixed(2)+'</span></div>';
    cardHtml+='<div class="trade-card-row"><span class="label">备注</span><span class="editable" data-id="'+t.id+'" data-field="note">'+noteShow+'</span></div>';
    cardHtml+='<div class="trade-card-footer">';
    cardHtml+='<span class="tag '+tagClass+'">'+(t.tag||'主板')+'</span>';
    cardHtml+='<span class="'+(ip?'red':'green')+'" style="font-size:12px;font-weight:500">'+(ip?'✅ 成功':'❌ 失败')+'</span>';
    cardHtml+='<button class="trade-card-del" data-id="'+t.id+'" data-action="deleteTrade">删除</button>';
    cardHtml+='</div>';
    cardHtml+='</div>';
    } // end group trades loop
  } // end groups loop
  tbody.innerHTML=html;
  cardEl.innerHTML=cardHtml;
  // 恢复月份折叠状态
  restoreMonthCollapseState();
}

// 切换月份折叠（桌面端行 + 移动端卡片同步）
function toggleMonth(el){
  var month = el.getAttribute('data-month');
  var rows = document.querySelectorAll('.month-row-'+month);
  var toggle = el.querySelector('.month-toggle');
  var isOpen = toggle.textContent === '▼';
  for(var i=0;i<rows.length;i++){
    rows[i].style.display = isOpen ? 'none' : '';
  }
  toggle.textContent = isOpen ? '▶' : '▼';
  // 持久化折叠状态
  saveMonthCollapseState();
}

// 保存月份折叠状态到localStorage
function saveMonthCollapseState(){
  var headers = document.querySelectorAll('.month-header');
  var state = {};
  for(var i=0;i<headers.length;i++){
    var m = headers[i].getAttribute('data-month');
    var t = headers[i].querySelector('.month-toggle');
    if(t) state[m] = (t.textContent === '▶'); // true=收缩, false=展开
  }
  try{ localStorage.setItem('month_collapse', JSON.stringify(state)); }catch(e){}
}

// 从localStorage恢复月份折叠状态（在renderTable后调用）
function restoreMonthCollapseState(){
  var raw;
  try{ raw = localStorage.getItem('month_collapse'); }catch(e){ return; }
  if(!raw) return;
  var state;
  try{ state = JSON.parse(raw); }catch(e){ return; }
  for(var m in state){
    if(state[m] === true){ // 需要收缩
      var rows = document.querySelectorAll('.month-row-'+m);
      var header = document.querySelector('.month-header[data-month="'+m+'"]');
      for(var j=0;j<rows.length;j++){ rows[j].style.display = 'none'; }
      if(header){
        var toggle = header.querySelector('.month-toggle');
        if(toggle) toggle.textContent = '▶';
      }
    }
  }
}

// ===== 统计 =====
function updateStats(){
  // 只统计非做T记录（tIndex===0），做T盈亏不计入总盈亏
  var closedTrades = trades.filter(function(t){ return (t.tIndex || 0) === 0; });
  var total=closedTrades.length,sc=0,tp=0,maxWin=0,maxLoss=0;
  for(var i=0;i<closedTrades.length;i++){
    if(closedTrades[i].amount>0) sc++;
    tp+=closedTrades[i].amount;
    if(closedTrades[i].amount>maxWin) maxWin=closedTrades[i].amount;
    if(closedTrades[i].amount<maxLoss) maxLoss=closedTrades[i].amount;
  }
  var rate=total>0?(sc/total*100).toFixed(1):0;
  document.getElementById('stTotal').textContent=total;
  document.getElementById('stRate').textContent=rate+'%';
  var el=document.getElementById('stProfit');
  el.textContent=(tp>=0?'+':'')+'¥'+tp.toFixed(2);
  el.className='card-val '+(tp>=0?'red':'green');
  document.getElementById('stMaxWin').textContent='+'+maxWin.toFixed(2);
  document.getElementById('stMaxLoss').textContent=maxLoss.toFixed(2);
  // 手续费总额
  var tf=0;
  for(var j=0;j<trades.length;j++){ tf+=(parseFloat(trades[j].fees)||0); }
  document.getElementById('stFees').textContent='¥'+tf.toFixed(2);
}

// ===== 数据分析 =====
function renderAnalysis(){
  renderTrendChart();
  renderCatStats();
  renderStockSummary();
  renderPeriodTable();
}

// 趋势图（排除做T记录）
function renderTrendChart(){
  var closedTrades = trades.filter(function(t){ return (t.tIndex || 0) === 0; });
  var sorted=closedTrades.slice().sort(function(a,b){ return new Date(a.date)-new Date(b.date); });
  // 按天汇总盈亏
  var dayMap={};
  var dayOrder=[];
  for(var i=0;i<sorted.length;i++){
    var d=sorted[i].date;
    if(!dayMap[d]){ dayMap[d]=0; dayOrder.push(d); }
    dayMap[d]+=sorted[i].amount;
  }
  var labels=[], data=[], cum=0;
  for(var i=0;i<dayOrder.length;i++){
    cum+=dayMap[dayOrder[i]];
    labels.push(formatDate(dayOrder[i]));
    data.push(parseFloat(cum.toFixed(2)));
  }

  var ctx=document.getElementById('trendChart').getContext('2d');
  if(trendChart) trendChart.destroy();

  trendChart=new Chart(ctx,{
    type:'line',
    data:{
      labels:labels,
      datasets:[{
        label:'累计盈亏（¥）',
        data:data,
        borderColor:'#3498db',
        backgroundColor:'rgba(52,152,219,0.1)',
        fill:true,
        tension:0.3,
        pointRadius:3,
        pointBackgroundColor:function(ctx){
          return ctx.raw>=0?'#e74c3c':'#27ae60';
        }
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label:function(ctx){ return '累计盈亏：'+(ctx.raw>=0?'+':'')+ctx.raw.toFixed(2)+'元'; }
          }
        }
      },
      scales:{
        y:{
          ticks:{ callback:function(v){ return '¥'+v; } }
        },
        x:{
          ticks:{ maxRotation:45, font:{size:10} }
        }
      }
    }
  });
}

// 分类统计（排除做T记录）
function renderCatStats(){
  var cats={};
  for(var i=0;i<trades.length;i++){
    if((trades[i].tIndex || 0) > 0) continue; // 跳过做T记录
    var tag=trades[i].tag||'主板';
    if(!cats[tag]) cats[tag]={total:0,success:0,profit:0};
    cats[tag].total++;
    if(trades[i].amount>0) cats[tag].success++;
    cats[tag].profit+=trades[i].amount;
  }

  var html='';
  var tagMap={'主板':{cls:'cat-main',color:'#3498db'},'创业板':{cls:'cat-gem',color:'#e67e22'},'科创板':{cls:'cat-star',color:'#8e44ad'}};

  ['主板','创业板','科创板'].forEach(function(tag){
    var c=cats[tag]||{total:0,success:0,profit:0};
    var m=tagMap[tag];
    var rate=c.total>0?(c.success/c.total*100).toFixed(1):0;
    html+='<div class="cat-card '+m.cls+'">';
    html+='<div class="cat-title" style="color:'+m.color+'">'+tag+'</div>';
    html+='<div class="cat-row"><span>交易次数</span><span>'+c.total+'</span></div>';
    html+='<div class="cat-row"><span>成功次数</span><span>'+c.success+'</span></div>';
    html+='<div class="cat-row"><span>成功率</span><span style="font-weight:bold">'+rate+'%</span></div>';
    html+='<div class="cat-row"><span>总盈亏</span><span style="font-weight:bold;color:'+(c.profit>=0?'#e74c3c':'#27ae60')+'">'+(c.profit>=0?'+':'')+c.profit.toFixed(2)+'</span></div>';
    html+='</div>';
  });

  document.getElementById('catStats').innerHTML=html;
}

// 股票综合盈亏（做T记录不计入盈亏，仅展示做T次数）
function renderStockSummary(){
  if(trades.length===0 && holdings.length===0){
    document.getElementById('stockSummaryTable').innerHTML='<tr><td style="padding:20px;color:#999">暂无数据</td></tr>';
    return;
  }

  // 按股票代码分组：非做T记录参与盈亏计算，做T记录单独统计次数
  var groups={};
  var tGroups={}; // 做T记录分组（用于展示T次数，不参与盈亏）
  for(var i=0;i<trades.length;i++){
    var code=trades[i].code||'';
    var tIdx = trades[i].tIndex || 0;

    if(tIdx > 0){
      // 做T记录：只计数和计金额用于展示，不参与盈亏
      if(!tGroups[code]) tGroups[code]={trades:0,profit:0,items:[]};
      tGroups[code].trades++;
      tGroups[code].profit+=trades[i].amount;
      tGroups[code].items.push(trades[i]);
      continue;
    }

    // 非做T记录（清仓/手动添加）：参与盈亏计算
    if(!groups[code]) groups[code]={trades:0,success:0,profit:0,firstDate:trades[i].date,lastDate:trades[i].date};
    groups[code].trades++;
    if(trades[i].amount>0) groups[code].success++;
    groups[code].profit+=trades[i].amount;
    if(trades[i].date<groups[code].firstDate) groups[code].firstDate=trades[i].date;
    if(trades[i].date>groups[code].lastDate) groups[code].lastDate=trades[i].date;
  }

  // 合并：有做T但无清仓的股票也要展示；同时在holdings中的标记为"持仓中"
  var holdingCodes = {};
  for(var i=0;i<holdings.length;i++){
    holdingCodes[holdings[i].code] = true;
  }
  var allCodes = {};
  for(var c in groups) allCodes[c] = true;
  for(var c in tGroups) allCodes[c] = true;
  // 持仓中但没有任何交易记录的股票也要展示
  for(var c in holdingCodes) allCodes[c] = true;

  // 分类：盈利、亏损、持仓中、持平
  var profitKeys = [], lossKeys = [], holdingKeys = [], flatKeys = [];
  for(var c in allCodes){
    if(holdingCodes[c]){
      holdingKeys.push(c);
    } else if(groups[c]){
      if(groups[c].profit > 0) profitKeys.push(c);
      else if(groups[c].profit < 0) lossKeys.push(c);
      else flatKeys.push(c);
    } else {
      // 只有做T记录，无盈亏
      flatKeys.push(c);
    }
  }

  // 排序：持仓中按代码，已清仓按最后日期从近到远
  holdingKeys.sort();
  profitKeys.sort(function(a,b){ return groups[b].lastDate.localeCompare(groups[a].lastDate); });
  lossKeys.sort(function(a,b){ return groups[b].lastDate.localeCompare(groups[a].lastDate); });
  flatKeys.sort(function(a,b){ return (groups[b]&&groups[b].lastDate||'0000').localeCompare(groups[a]&&groups[a].lastDate||'0000'); });

  // 计算汇总
  var totalStocks=Object.keys(allCodes).length;
  var profitStocks=profitKeys.length, lossStocks=lossKeys.length, holdingStocks=holdingKeys.length, flatStocks=flatKeys.length;
  var totalProfit=0;
  for(var c in groups) totalProfit+=groups[c].profit;

  // 从localStorage恢复折叠状态
  var collapseState = {};
  try {
    var raw = localStorage.getItem('stock_group_collapse');
    if(raw) collapseState = JSON.parse(raw);
  } catch(e){}

  var html='<thead><tr><th style="width:5%;text-align:center">序号</th><th style="width:28%;text-align:left;padding-left:8px">股票名称</th><th style="width:10%;text-align:center">做T次数</th><th style="width:10%;text-align:center">操作次数</th><th style="width:10%;text-align:center">成功次数</th><th style="width:12%;text-align:center">操作成功率</th><th style="width:13%;text-align:right;padding-right:8px">综合盈亏</th><th style="width:12%;text-align:center">结果</th></tr></thead><tbody>';

  // 汇总行
  var stockRate=totalStocks>0?(profitStocks/totalStocks*100).toFixed(1):0;
  html+='<tr style="background:#f0f4f8;font-weight:bold">';
  html+='<td></td>';
  html+='<td style="text-align:left;padding-left:8px">📊 合计（'+totalStocks+'只股票）</td>';
  html+='<td>-</td><td>-</td><td>-</td><td>-</td>';
  html+='<td class="'+(totalProfit>=0?'profit':'loss')+'" style="text-align:right;padding-right:8px">'+(totalProfit>=0?'+':'')+totalProfit.toFixed(2)+'</td>';
  html+='<td style="color:'+(stockRate>=50?'#e74c3c':'#27ae60')+'">胜率 '+stockRate+'%</td>';
  html+='</tr>';

  // 渲染一个分组
  function renderGroup(keys, groupType, groupLabel, groupColor){
    if(keys.length===0) return '';
    var isOpen = !collapseState[groupType]; // true=展开, false=折叠
    var groupHtml = '';

    // 分组标题行（可点击折叠）
    groupHtml+='<tr class="stock-group-header" data-group="'+groupType+'" onclick="toggleStockGroup(this)" style="cursor:pointer;background:#f8f9fa">';
    groupHtml+='<td colspan="8" style="padding:8px 12px;text-align:left;font-weight:600;font-size:13px;color:'+groupColor+'">';
    groupHtml+='<span class="stock-group-toggle" style="display:inline-block;width:18px;transition:transform 0.2s">'+(isOpen?'▼':'▶')+'</span> ';
    groupHtml+=groupLabel+'（'+keys.length+'只）';
    groupHtml+='</td>';
    groupHtml+='</tr>';

    // 该组的股票行
    for(var i=0;i<keys.length;i++){
      var k = keys[i];
      var g = groups[k] || {trades:0,success:0,profit:0};
      var tg = tGroups[k] || {trades:0,profit:0};
      var name=getStockName(k);
      var isHolding = !!holdingCodes[k];
      var opRate=g.trades>0?(g.success/g.trades*100).toFixed(1):0;
      var cls=g.profit>=0?'profit':'loss';
      var result, resultColor;
      if(isHolding){
        result='🔄 持仓中';
        resultColor='#856404';
        cls='';
      } else {
        result=g.profit>0?'✅ 盈利':g.profit<0?'❌ 亏损':'➖ 持平';
        resultColor=g.profit>0?'#e74c3c':g.profit<0?'#27ae60':'#999';
      }

      // 做T次数标签
      var tCountHtml = tg.trades > 0 ? ('<span style="color:#8e44ad;font-weight:600">T×'+tg.trades+'</span>') : '-';

      var rowStyle = isOpen ? '' : 'display:none;';
      var bgStyle = isHolding ? 'background:#fffbf0;' : '';
      var rankNum = i + 1; // 分组内独立序号
      groupHtml+='<tr class="stock-group-row stock-group-'+groupType+'" style="'+bgStyle+rowStyle+'">';
      groupHtml+='<td style="color:#999;text-align:center;font-size:12px">'+rankNum+'</td>';
      groupHtml+='<td style="text-align:left;padding-left:8px"><b>'+escapeHtml(name)+'</b><span style="color:#aaa;font-size:11px;margin-left:6px">'+String(k).padStart(6,'0')+'</span>'+(isHolding?'<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px;background:#fff3cd;color:#856404">持仓中</span>':'')+'</td>';
      groupHtml+='<td>'+tCountHtml+'</td>';
      groupHtml+='<td style="text-align:center">'+g.trades+'</td>';
      groupHtml+='<td style="text-align:center">'+g.success+'</td>';
      groupHtml+='<td style="text-align:center">'+opRate+'%</td>';
      groupHtml+='<td class="'+cls+'" style="text-align:right;padding-right:8px">'+(isHolding?'—':((g.profit>=0?'+':'')+g.profit.toFixed(2)))+'</td>';
      groupHtml+='<td style="color:'+resultColor+'">'+result+'</td>';
      groupHtml+='</tr>';
    }

    return groupHtml;
  }

  // 按分组顺序渲染：持仓中 → 盈利 → 亏损 → 持平
  html += renderGroup(holdingKeys, 'holding', '🔄 持仓中', '#856404');
  html += renderGroup(profitKeys, 'profit', '📈 盈利', '#e74c3c');
  html += renderGroup(lossKeys, 'loss', '📉 亏损', '#27ae60');
  html += renderGroup(flatKeys, 'flat', '➖ 持平', '#999');

  html+='</tbody>';
  document.getElementById('stockSummaryTable').innerHTML=html;
}

// 切换股票分组折叠（类似交易记录的月份折叠）
function toggleStockGroup(el){
  var group = el.getAttribute('data-group');
  var rows = document.querySelectorAll('.stock-group-'+group);
  var toggle = el.querySelector('.stock-group-toggle');
  var isOpen = toggle.textContent === '▼';
  for(var i=0;i<rows.length;i++){
    rows[i].style.display = isOpen ? 'none' : '';
  }
  toggle.textContent = isOpen ? '▶' : '▼';
  // 持久化折叠状态
  saveStockGroupCollapseState();
}

// 保存股票分组折叠状态到localStorage
function saveStockGroupCollapseState(){
  var headers = document.querySelectorAll('.stock-group-header');
  var state = {};
  for(var i=0;i<headers.length;i++){
    var g = headers[i].getAttribute('data-group');
    var t = headers[i].querySelector('.stock-group-toggle');
    if(t) state[g] = (t.textContent === '▶'); // true=收缩, false=展开
  }
  try{ localStorage.setItem('stock_group_collapse', JSON.stringify(state)); }catch(e){}
}

// 周期统计
function switchPeriod(period, el){
  currentPeriod=period;
  // 更新tab样式
  var tabs=el.parentElement.querySelectorAll('.tab');
  tabs.forEach(function(t){t.classList.remove('active');});
  el.classList.add('active');
  renderPeriodTable();
}

function renderPeriodTable(){
  if(trades.length===0){
    document.getElementById('periodTable').innerHTML='<tr><td style="padding:20px;color:#999">暂无数据</td></tr>';
    return;
  }

  // 按周期分组（排除做T记录）
  var groups={};
  var keyLabels={}; // 排序key -> 显示标签
  for(var i=0;i<trades.length;i++){
    if((trades[i].tIndex || 0) > 0) continue; // 跳过做T记录
    var d=new Date(trades[i].date);
    var key, label;
    if(currentPeriod==='week'){
      // 计算是当月第几周（周一作为每周起始）
      var firstDayOfMon=new Date(d.getFullYear(), d.getMonth(), 1);
      var firstDayWeekday=firstDayOfMon.getDay()||7; // 1=周一, 7=周日
      var weekNum=Math.ceil((d.getDate()+firstDayWeekday-1)/7);
      key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+weekNum;
      label=d.getFullYear()+'年'+(d.getMonth()+1)+'月份第'+weekNum+'周';
    } else {
      key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      label=d.getFullYear()+'年'+(d.getMonth()+1)+'月份';
    }
    keyLabels[key]=label;
    if(!groups[key]) groups[key]={total:0,success:0,profit:0};
    groups[key].total++;
    if(trades[i].amount>0) groups[key].success++;
    groups[key].profit+=trades[i].amount;
  }

  // 排序（从新到旧）
  var keys=Object.keys(groups).sort().reverse();

  var html='<thead><tr><th>时段</th><th>交易次数</th><th>成功次数</th><th>成功率</th><th>总盈亏</th></tr></thead><tbody>';
  for(var i=0;i<keys.length;i++){
    var g=groups[keys[i]];
    var rate=g.total>0?(g.success/g.total*100).toFixed(1):0;
    var cls=g.profit>=0?'profit':'loss';
    html+='<tr>';
    html+='<td>'+keyLabels[keys[i]]+'</td>';
    html+='<td>'+g.total+'</td>';
    html+='<td>'+g.success+'</td>';
    html+='<td>'+rate+'%</td>';
    html+='<td class="'+cls+'">'+(g.profit>=0?'+':'')+'¥'+g.profit.toFixed(2)+'</td>';
    html+='</tr>';
  }
  html+='</tbody>';
  document.getElementById('periodTable').innerHTML=html;
}

// ===== 持仓联想搜索 =====
function onHoldCodeInput() {
  var input = document.getElementById('holdCode');
  var val = input.value.trim().toLowerCase();
  var list = document.getElementById('holdAcList');

  if (!val || typeof STOCK_DICT === 'undefined') {
    list.classList.remove('show');
    holdAcResults = [];
    holdAcSelectedIndex = -1;
    return;
  }

  holdAcResults = [];
  var count = 0;
  for (var code in STOCK_DICT) {
    if (count >= 30) break;
    var name = STOCK_DICT[code][0];
    var py = STOCK_DICT[code][1];
    if (code.indexOf(val) === 0 || py.indexOf(val) === 0) {
      holdAcResults.push({ code: code, name: name, pinyin: py });
      count++;
    }
  }

  if (holdAcResults.length === 0) {
    list.classList.remove('show');
    holdAcSelectedIndex = -1;
    return;
  }

  holdAcSelectedIndex = -1;
  renderHoldAcList();
  list.classList.add('show');
}

function renderHoldAcList() {
  var list = document.getElementById('holdAcList');
  var html = '';
  for (var i = 0; i < holdAcResults.length; i++) {
    var r = holdAcResults[i];
    var selected = i === holdAcSelectedIndex ? ' style="background:#f0f7ff"' : '';
    html += '<div class="autocomplete-item"' + selected + ' onclick="selectHoldAcItem(' + i + ')" data-index="' + i + '">';
    html += '<span class="ac-name">' + escapeHtml(r.name) + '</span>';
    html += '<span class="ac-code">' + r.code + '</span>';
    html += '</div>';
  }
  list.innerHTML = html;
}

function selectHoldAcItem(index) {
  var r = holdAcResults[index];
  document.getElementById('holdCode').value = r.code;
  autoDetectTagHold(r.code);
  document.getElementById('holdAcList').classList.remove('show');
  holdAcSelectedIndex = -1;
  holdAcResults = [];
}

function onHoldCodeKeydown(e) {
  var list = document.getElementById('holdAcList');
  if (!list.classList.contains('show') || holdAcResults.length === 0) {
    if (e.key === 'Enter') submitAddHolding();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    holdAcSelectedIndex = Math.min(holdAcSelectedIndex + 1, holdAcResults.length - 1);
    renderHoldAcList();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    holdAcSelectedIndex = Math.max(holdAcSelectedIndex - 1, -1);
    renderHoldAcList();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (holdAcSelectedIndex >= 0) {
      selectHoldAcItem(holdAcSelectedIndex);
    } else {
      document.getElementById('holdAcList').classList.remove('show');
      submitAddHolding();
    }
  } else if (e.key === 'Escape') {
    list.classList.remove('show');
    holdAcSelectedIndex = -1;
  }
}

function autoDetectTagHold(code) {
  if (!code) return;
  var c = code.replace(/\s/g, '');
  var tag = '';
  if (c.indexOf('30') === 0) tag = '创业板';
  else if (c.indexOf('68') === 0) tag = '科创板';
  else if (c.indexOf('60') === 0 || c.indexOf('00') === 0) tag = '主板';
  if (tag) document.getElementById('holdTag').value = tag;
}

// ===== 持仓弹窗 =====
function openAddHolding(){
  document.getElementById('addHoldingModal').classList.add('active');
  document.getElementById('holdDate').value = todayStr();
  document.getElementById('holdCode').value = '';
  document.getElementById('holdTag').value = '主板';
  document.getElementById('holdQty').value = '';
  document.getElementById('holdBuyPrice').value = '';
  document.getElementById('holdNote').value = '';
  setTimeout(function(){ document.getElementById('holdCode').focus(); },100);
}
function closeAddHolding(){
  document.getElementById('addHoldingModal').classList.remove('active');
  document.getElementById('holdCode').disabled = false;
  document.getElementById('holdMergeHint').style.display = 'none';
  document.querySelector('#addHoldingModal .modal h2').textContent = '📌 添加持仓';
}

function openAddMore(id){
  var holding = null;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(id)){ holding=holdings[i]; break; }
  }
  if(!holding) return;
  document.getElementById('addHoldingModal').classList.add('active');
  document.getElementById('holdDate').value = todayStr();
  document.getElementById('holdCode').value = holding.code;
  document.getElementById('holdCode').disabled = true;
  document.getElementById('holdTag').value = holding.tag || '主板';
  document.getElementById('holdQty').value = '';
  document.getElementById('holdBuyPrice').value = '';
  document.getElementById('holdNote').value = '';
  // 触发补仓提示
  document.getElementById('holdMergeHint').style.display = 'block';
  document.getElementById('holdMergeHint').innerHTML = '🔔 补仓 ' + getStockName(holding.code) + '（当前持仓 '+ (holding.quantity||0) +' 股，成本价 ' + (parseFloat(holding.buyPrice)||0).toFixed(3) + ' 元）';
  document.getElementById('addHoldFeeHint').style.display = 'none';
  // 标题改为补仓
  document.querySelector('#addHoldingModal .modal h2').textContent = '📥 补仓 - ' + getStockName(holding.code);
  setTimeout(function(){ document.getElementById('holdQty').focus(); },100);
}

function submitAddHolding(){
  var date=document.getElementById('holdDate').value;
  var code=document.getElementById('holdCode').value.trim();
  var tag=document.getElementById('holdTag').value;
  var quantity=parseInt(document.getElementById('holdQty').value);
  var rawPrice=parseFloat(document.getElementById('holdBuyPrice').value)||0;
  var note=document.getElementById('holdNote').value.trim();
  if(!date||!code||isNaN(quantity)||quantity<=0){ alert('请填写交易日期、股票代码和买入数量！'); return; }

  // 买入手续费
  var buyFees = calcFees(rawPrice, quantity, false, selectedAccountType, code);
  var totalCost = rawPrice * quantity + buyFees.total;
  var buyPrice = Math.round(totalCost / quantity * 1000) / 1000;

  // 检测是否已持仓（同代码+同账户类型 → 补仓合并）
  var existingIdx = -1;
  for(var i=0;i<holdings.length;i++){
    if(holdings[i].code===code && (holdings[i].accountType||'normal')===selectedAccountType){
      existingIdx=i; break;
    }
  }

  closeAddHolding();

  if(existingIdx>=0){
    // ===== 补仓：合并到现有持仓 =====
    var old = holdings[existingIdx];
    var oldQty = old.quantity || 0;
    var oldBP = parseFloat(old.buyPrice) || rawPrice;
    var newQty = oldQty + quantity;
    // 加权平均成本价（含本次手续费）
    var newBP = Math.round(((oldQty * oldBP + rawPrice * quantity + buyFees.total) / newQty) * 1000) / 1000;
    var savedHoldings = JSON.parse(JSON.stringify(holdings));
    holdings[existingIdx].quantity = newQty;
    holdings[existingIdx].buyPrice = newBP;
    holdings[existingIdx].date = date;
    if(note) holdings[existingIdx].note = (holdings[existingIdx].note ? holdings[existingIdx].note+'; ' : '') + note;
    refreshUI();
    showStatus('ok','✅ 补仓成功：' + getStockName(code) + ' ' + oldQty + '→'+newQty + '股，成本价更新为' + newBP.toFixed(3) + '元');

    // 后台同步
    apiCall({action:'updateHolding',id:old.id,field:'quantity',value:newQty}, function(r1){
      if(r1&&r1.success){
        apiCall({action:'updateHolding',id:old.id,field:'buyPrice',value:newBP}, function(r2){
          if(r2&&r2.success){
            apiCall({action:'updateHolding',id:old.id,field:'date',value:date}, function(r3){
              if(r3&&r3.success){
                try{ localStorage.setItem('stock_holdings_cache', JSON.stringify(holdings)); }catch(e){}
                _checkSyncStatus();
              }else{rollbackOptimistic(trades,savedHoldings,'❌ 补仓失败：'+(r3?r3.error:''));}
            });
          }else{rollbackOptimistic(trades,savedHoldings,'❌ 补仓失败：'+(r2?r2.error:''));}
        });
      }else{rollbackOptimistic(trades,savedHoldings,'❌ 补仓失败：'+(r1?r1.error:''));}
    });
  } else {
    // ===== 新持仓 =====
    var tmpId = genTempId();
    var savedHoldings = JSON.parse(JSON.stringify(holdings));
    holdings.push({id:tmpId, date:date, code:code, tag:tag, quantity:quantity, note:note, buyPrice:buyPrice, accountType:selectedAccountType});
    refreshUI();
    showStatus('ok','✅ 持仓已添加（成本价含买入手续费' + buyFees.total.toFixed(2) + '元）');

    apiCall({action:'addHolding',date:date,code:code,tag:tag,quantity:quantity,note:note,buyPrice:buyPrice,accountType:selectedAccountType}, function(res){
      if(res&&res.success){
        for(var i=0;i<holdings.length;i++){
          if(holdings[i].id===tmpId){ holdings[i].id=res.id; break; }
        }
        try{ localStorage.setItem('stock_holdings_cache', JSON.stringify(holdings)); }catch(e){}
        refreshUI();
        _checkSyncStatus();
      } else {
        rollbackOptimistic(trades, savedHoldings, '❌ 添加持仓失败：'+(res?res.error:''));
      }
    });
  }
}

// ===== 仓位选择工具函数 =====
function setupPosGroup(groupId, customInputId, displayId, onPosChange){
  var group = document.getElementById(groupId);
  var customInput = document.getElementById(customInputId);
  var display = document.getElementById(displayId);

  group.addEventListener('click', function(e){
    var btn = e.target.closest('.pos-btn');
    if(!btn) return;
    group.querySelectorAll('.pos-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    customInput.value = '';
    onPosChange(btn.getAttribute('data-pos'));
    updateQtyDisplay(display, btn.getAttribute('data-pos'), 0, groupId);
  });

  customInput.addEventListener('input', function(){
    group.querySelectorAll('.pos-btn').forEach(function(b){ b.classList.remove('active'); });
    if(customInput.value){
      onPosChange('custom');
      updateQtyDisplay(display, 'custom', parseInt(customInput.value) || 0, groupId);
    } else {
      // 输入框清空，恢复选中"全部"
      var fullBtn = group.querySelector('[data-pos="full"]');
      if(fullBtn){ fullBtn.classList.add('active'); }
      onPosChange('full');
      updateQtyDisplay(display, 'full', 0, groupId);
    }
  });
}

// ===== 自动计算盈亏 =====
// 清仓：盈亏 = (卖出价 - 成本价) × 清仓数量
function autoCalcClearProfit(){
  var sellPrice = parseFloat(document.getElementById('clearSellPrice').value);
  var id = pendingClearId;
  var holding = null;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(id)){ holding=holdings[i]; break; }
  }
  if(!holding || !holding.buyPrice || isNaN(sellPrice)) return;

  // 计算实际清仓数量
  var customQty = parseInt(document.getElementById('clearCustomQty').value) || 0;
  var actualQty = calcActualQty(holding.quantity, selectedClearPos, customQty);
  if(actualQty <= 0 || actualQty > holding.quantity) actualQty = holding.quantity;

  // 基础价差盈亏（buyPrice已是含费成本价）
  var profit = (sellPrice - holding.buyPrice) * actualQty;

  // 只扣除卖出手续费（买入手续费已摊入成本价）
  // 两融账户分2次清仓时，佣金多算一次（每笔固定5元），印花税/过户费不变（按总金额比例）
  var accType = holding.accountType || 'normal';
  var batches = (accType === 'margin') ? selectedClearBatches : 1;
  var sellFees = calcFees(sellPrice, actualQty, true, accType, holding.code);
  if(batches === 2){
    // 分2次：佣金 × 2，印花税和过户费不变
    sellFees.total = Math.round((sellFees.commission * 2 + sellFees.stampTax + sellFees.transferFee) * 100) / 100;
    sellFees.commission = Math.round(sellFees.commission * 2 * 100) / 100;
  }
  profit = profit - sellFees.total;
  profit = Math.round(profit * 100) / 100; // 保留2位小数

  document.getElementById('clearAmount').value = profit;
  document.getElementById('clearAutoCalcHint').style.display = 'block';
  var hintText = '✅ 本次卖出手续费 ' + sellFees.total.toFixed(2) + ' 元';
  if(sellFees.total > 0) hintText += feeDetailText(sellFees);
  if(batches === 2) hintText += '（分2次清，佣金×2）';
  document.getElementById('clearAutoCalcHint').innerHTML = hintText;
}

// ===== 添加持仓手续费提示 =====
function autoCalcBuyFees(){
  var price = parseFloat(document.getElementById('holdBuyPrice').value);
  var qty = parseInt(document.getElementById('holdQty').value);
  var hint = document.getElementById('addHoldFeeHint');
  var mergeHint = document.getElementById('holdMergeHint');
  var code = document.getElementById('holdCode').value.trim();
  if(isNaN(price) || isNaN(qty) || price <= 0 || qty <= 0){
    hint.style.display = 'none';
    mergeHint.style.display = 'none';
    return;
  }
  // 检测是否已持仓（补仓模式）
  if(code){
    for(var i=0;i<holdings.length;i++){
      if(holdings[i].code===code && (holdings[i].accountType||'normal')===selectedAccountType){
        var old = holdings[i];
        var newQty = (old.quantity||0) + qty;
        var oldBP = parseFloat(old.buyPrice) || price;
        var buyFees = calcFees(price, qty, false, selectedAccountType, code);
        var newBP = Math.round(((old.quantity * oldBP + price * qty + buyFees.total) / newQty) * 1000) / 1000;
        mergeHint.style.display = 'block';
        mergeHint.innerHTML = '🔔 补仓模式：将合并到现有持仓 ' + getStockName(code) + '（' + (old.quantity||0) + '→<b>' + newQty + '</b>股，成本价 ' + oldBP.toFixed(3) + '→<b>' + newBP.toFixed(3) + '</b>元）';
        hint.style.display = 'none';
        return;
      }
    }
  }
  mergeHint.style.display = 'none';
  var fees = calcFees(price, qty, false, selectedAccountType, code);
  if(fees.total === 0){
    hint.style.display = 'none';
    return;
  }
  var parts = [];
  if(fees.commission > 0) parts.push('佣金' + fees.commission.toFixed(2) + '元');
  if(fees.transferFee > 0) parts.push('过户费' + fees.transferFee.toFixed(2) + '元');
  hint.style.display = 'block';
  hint.innerHTML = '💰 预计买入手续费 <b>' + fees.total.toFixed(2) + '</b> 元（' + parts.join(' + ') + '），将摊入成本价';
}

// ===== 补录已完结交易 =====
function openAddComplete(){
  document.getElementById('compDate').value = todayStr();
  document.getElementById('compCode').value = '';
  document.getElementById('compTag').value = '主板';
  document.getElementById('compQty').value = '';
  document.getElementById('compBuyPrice').value = '';
  document.getElementById('compSellPrice').value = '';
  document.getElementById('compSellPrice2').value = '';
  document.getElementById('compSellPrice2Wrap').style.display = 'none';
  document.getElementById('compSellPrice').parentElement.querySelector('label').textContent = '清仓价格（元）';
  document.getElementById('compAmount').value = '';
  document.getElementById('compNote').value = '';
  document.getElementById('compAutoCalcHint').style.display = 'none';
  selectedCompAcc = localStorage.getItem('stock_account_type') || 'normal';
  var isMargin = selectedCompAcc === 'margin';
  selectedCompBatches = 1;
  document.querySelectorAll('#completeAccGroup .acc-type-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-acc')===selectedCompAcc); });
  document.getElementById('compBatchWrap').style.display = isMargin ? 'block' : 'none';
  document.querySelectorAll('#compBatchGroup .pos-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-batch')==='1'); });
  document.getElementById('addCompleteModal').classList.add('active');
  setTimeout(function(){ document.getElementById('compCode').focus(); },100);
}

function closeAddComplete(){ document.getElementById('addCompleteModal').classList.remove('active'); }

function autoDetectTagComp(code){
  if(!code) return;
  var c = String(code).trim();
  var sel = document.getElementById('compTag');
  if(c.charAt(0)==='3') sel.value = '创业板';
  else if(c.substring(0,2)==='68') sel.value = '科创板';
  else if(c.charAt(0)==='6') sel.value = '主板';
  else sel.value = '主板';
}

function autoCalcCompProfit(){
  var buyPrice = parseFloat(document.getElementById('compBuyPrice').value);
  var sellPrice = parseFloat(document.getElementById('compSellPrice').value);
  var qty = parseInt(document.getElementById('compQty').value);
  if(isNaN(buyPrice) || isNaN(sellPrice) || isNaN(qty) || qty <= 0) return;
  
  var code = document.getElementById('compCode').value.trim();
  var accType = selectedCompAcc;
  var batches = (accType === 'margin') ? selectedCompBatches : 1;
  
  // 买入手续费（一次性买入，只有一笔）
  var buyFees = calcFees(buyPrice, qty, false, accType, code);
  
  var sellFees; // 总卖出手续费
  var profit;   // 总盈亏
  var ht;
  
  if(batches === 2){
    var sellPrice2 = parseFloat(document.getElementById('compSellPrice2').value);
    if(isNaN(sellPrice2)) return;
    var halfQty = Math.floor(qty / 2);
    var halfQty2 = qty - halfQty;
    
    // 两次卖出手续费分开算（佣金各5元）
    var sellFees1 = calcFees(sellPrice, halfQty, true, accType, code);
    var sellFees2 = calcFees(sellPrice2, halfQty2, true, accType, code);
    sellFees = {
      total: Math.round((sellFees1.total + sellFees2.total) * 100) / 100,
      commission: Math.round((sellFees1.commission + sellFees2.commission) * 100) / 100,
      stampTax: Math.round((sellFees1.stampTax + sellFees2.stampTax) * 100) / 100,
      transferFee: Math.round((sellFees1.transferFee + sellFees2.transferFee) * 100) / 100
    };
    
    profit = (sellPrice - buyPrice) * halfQty + (sellPrice2 - buyPrice) * halfQty2;
    profit = profit - buyFees.total - sellFees.total;
    profit = Math.round(profit * 100) / 100;
    
    ht = '💰 买入手续费 ' + buyFees.total.toFixed(2) + ' 元' + feeDetailText(buyFees);
    ht += ' + 第1次卖出手续费 ' + sellFees1.total.toFixed(2) + ' 元' + feeDetailText(sellFees1);
    ht += ' + 第2次卖出手续费 ' + sellFees2.total.toFixed(2) + ' 元' + feeDetailText(sellFees2);
    ht += '，实际盈亏：' + (profit>=0?'+':'') + profit.toFixed(2) + ' 元';
  } else {
    // 一次全清
    sellFees = calcFees(sellPrice, qty, true, accType, code);
    
    profit = (sellPrice - buyPrice) * qty - buyFees.total - sellFees.total;
    profit = Math.round(profit * 100) / 100;
    
    ht = '💰 买入手续费 ' + buyFees.total.toFixed(2) + ' 元' + feeDetailText(buyFees);
    ht += ' + 卖出手续费 ' + sellFees.total.toFixed(2) + ' 元' + feeDetailText(sellFees);
    ht += '，实际盈亏：' + (profit>=0?'+':'') + profit.toFixed(2) + ' 元';
  }
  
  document.getElementById('compAmount').value = profit;
  var hint = document.getElementById('compAutoCalcHint');
  hint.style.display = 'block';
  hint.innerHTML = ht;
}

function submitAddComplete(){
  var date = document.getElementById('compDate').value;
  var code = document.getElementById('compCode').value.trim();
  var tag = document.getElementById('compTag').value;
  var qty = parseInt(document.getElementById('compQty').value) || 0;
  var buyPrice = parseFloat(document.getElementById('compBuyPrice').value) || 0;
  var sellPrice = parseFloat(document.getElementById('compSellPrice').value) || 0;
  var amount = parseFloat(document.getElementById('compAmount').value);
  var note = document.getElementById('compNote').value.trim();
  
  if(!date || !code){ alert('请填写交易日期和股票代码！'); return; }
  if(qty <= 0){ alert('请填写买入数量！'); return; }
  if(isNaN(amount)){ alert('请填写盈亏金额，或输入买卖价格自动计算！'); return; }
  
  // 计算手续费
  var accType = selectedCompAcc;
  var batches = (accType === 'margin') ? selectedCompBatches : 1;
  var buyFees = calcFees(buyPrice, qty, false, accType, code);
  var feesTotal;
  if(batches === 2){
    var sellPrice2 = parseFloat(document.getElementById('compSellPrice2').value) || 0;
    var halfQty = Math.floor(qty / 2);
    var halfQty2 = qty - halfQty;
    var sellFees1 = calcFees(sellPrice, halfQty, true, accType, code);
    var sellFees2 = calcFees(sellPrice2, halfQty2, true, accType, code);
    feesTotal = Math.round((buyFees.total + sellFees1.total + sellFees2.total) * 100) / 100;
  } else {
    var sellFees = calcFees(sellPrice, qty, true, accType, code);
    feesTotal = Math.round((buyFees.total + sellFees.total) * 100) / 100;
  }
  
  // 备注加账户标记
  var clearAccLabel = (accType === 'margin') ? '两融' : '正常';
  var finalNote = (note ? note + ' ' : '') + '[补录]['+clearAccLabel+']';
  
  // 乐观更新
  var savedTrades = JSON.parse(JSON.stringify(trades));
  var tmpTradeId = genTempId();
  trades.push({id:tmpTradeId, date:date, code:code, tag:tag, quantity:qty, amount:amount, note:finalNote, tIndex:0, status:'closed', source:'clear', fees:feesTotal});
  
  // 按日期排序
  trades.sort(function(a,b){ var dd=new Date(b.date)-new Date(a.date); if(dd!==0) return dd; return b.id.localeCompare(a.id); });
  
  closeAddComplete();
  cacheData(trades);
  refreshUI();
  showStatus('ok','✅ 已补录「'+getStockName(code)+'」清仓，盈亏'+amount.toFixed(2)+'元');
  
  // 后台同步
  apiCall({action:'add',date:date,code:code,tag:tag,quantity:qty,amount:amount,note:finalNote,tIndex:0,status:'closed',source:'clear',fees:feesTotal}, function(res){
    if(res&&res.success){
      for(var j=0;j<trades.length;j++){
        if(trades[j].id===tmpTradeId){ trades[j].id=res.id; break; }
      }
      cacheData(trades);
      refreshUI();
      _checkSyncStatus();
    } else {
      trades = savedTrades;
      refreshUI();
      showStatus('err','❌ 补录失败，请重试');
    }
  });
}

// ===== 补录弹窗 代码联想 =====
function onCompCodeInput(){
  var input = document.getElementById('compCode');
  var list = document.getElementById('compAcList');
  var v = input.value.trim().toLowerCase();
  if(!v || typeof STOCK_DICT === 'undefined'){ list.classList.remove('show'); compAcResults=[]; return; }
  
  compAcResults=[]; compAcSelectedIndex=-1; var cnt=0;
  for(var code in STOCK_DICT){
    if(cnt>=8) break;
    var name = STOCK_DICT[code][0];
    var py = STOCK_DICT[code][1];
    if(code.indexOf(v)===0 || py.indexOf(v)===0){
      compAcResults.push({code:code,name:name,pinyin:py}); cnt++;
    }
  }
  if(compAcResults.length===0){ list.classList.remove('show'); return; }
  
  list.innerHTML='';
  for(var i=0;i<compAcResults.length;i++){
    var div=document.createElement('div');
    div.className='autocomplete-item';
    div.innerHTML='<span class="ac-name">'+escapeHtml(compAcResults[i].name)+'</span><span class="ac-code">'+compAcResults[i].code+'</span>';
    div.addEventListener('mousedown',function(e){
      var idx=compAcResults.indexOf(this._compResult);
      if(idx>=0){
        document.getElementById('compCode').value = compAcResults[idx].code;
        autoDetectTagComp(compAcResults[idx].code);
      }
      list.classList.remove('show');
    });
    div._compResult = compAcResults[i];
    list.appendChild(div);
  }
  list.classList.add('show');
  compAcSelectedIndex=-1;
}

function onCompCodeKeydown(e){
  var list=document.getElementById('compAcList');
  if(!list.classList.contains('show')) return;
  if(e.key==='ArrowDown'){ e.preventDefault(); compAcSelectedIndex=Math.min(compAcSelectedIndex+1,compAcResults.length-1); highlightCompAc(); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); compAcSelectedIndex=Math.max(compAcSelectedIndex-1,0); highlightCompAc(); }
  else if(e.key==='Enter'){ e.preventDefault();
    if(compAcSelectedIndex>=0&&compAcSelectedIndex<compAcResults.length){
      document.getElementById('compCode').value = compAcResults[compAcSelectedIndex].code;
      autoDetectTagComp(compAcResults[compAcSelectedIndex].code);
      list.classList.remove('show');
    }
  }
}

function highlightCompAc(){
  var list=document.getElementById('compAcList');
  var items=list.querySelectorAll('.autocomplete-item');
  for(var i=0;i<items.length;i++){
    items[i].style.background = i===compAcSelectedIndex ? '#f0f7ff' : '';
  }
}

// 做T：盈亏 = (卖出价 - 买回价) × 做T数量 - 卖出手续费 - 买回手续费
function autoCalcDoTProfit(){
  var sellPrice = parseFloat(document.getElementById('doTSellPrice').value);
  var buyBackPrice = parseFloat(document.getElementById('doTBuyBackPrice').value);
  if(isNaN(sellPrice) || isNaN(buyBackPrice)) return;

  var id = pendingDoTId;
  var holding = null;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(id)){ holding=holdings[i]; break; }
  }

  // 计算实际做T数量
  var customQty = parseInt(document.getElementById('doTCustomQty').value) || 0;
  var actualQty = holding ? calcActualQty(holding.quantity, selectedDoTPos, customQty) : 0;
  if(actualQty <= 0 || (holding && actualQty > holding.quantity)) actualQty = holding ? holding.quantity : 0;

  // 基础价差盈亏
  // 反T（默认）：doTSellPrice=卖出价，doTBuyBackPrice=买回价 → 盈亏 = 卖出价 - 买回价
  // 正T（doTReversed）：doTSellPrice=买入价，doTBuyBackPrice=卖出价 → 盈亏 = 卖出价 - 买入价
  var profit;
  if(doTReversed){
    profit = (buyBackPrice - sellPrice) * actualQty; // 正T
  } else {
    profit = (sellPrice - buyBackPrice) * actualQty; // 反T
  }

  // 扣除手续费（卖出时 + 买回/买入时）
  var accType = holding ? (holding.accountType || 'normal') : 'normal';
  var sellFees, buyBackFees;
  if(doTReversed){
    // 正T：先买后卖 → doTSellPrice是买入价，doTBuyBackPrice是卖出价
    buyBackFees = calcFees(sellPrice, actualQty, false, accType, holding ? holding.code : ''); // 买入手续费
    sellFees = calcFees(buyBackPrice, actualQty, true, accType, holding ? holding.code : ''); // 卖出手续费
  } else {
    // 反T：先卖后买
    sellFees = calcFees(sellPrice, actualQty, true, accType, holding ? holding.code : '');
    buyBackFees = calcFees(buyBackPrice, actualQty, false, accType, holding ? holding.code : '');
  }
  profit = profit - sellFees.total - buyBackFees.total;
  profit = Math.round(profit * 100) / 100;
  document.getElementById('doTAmount').value = profit;
  document.getElementById('doTAutoCalcHint').style.display = 'block';
  var totalFees = Math.round((sellFees.total + buyBackFees.total) * 100) / 100;
  var tip = '✅';
  if(sellFees.total > 0 || buyBackFees.total > 0){
    tip += ' 卖出手续费 ' + sellFees.total.toFixed(2) + ' 元' + feeDetailText(sellFees);
    if(buyBackFees.total > 0) tip += ' + 买回手续费 ' + buyBackFees.total.toFixed(2) + ' 元' + feeDetailText(buyBackFees);
  }
  document.getElementById('doTAutoCalcHint').innerHTML = tip;
}

// 根据仓位类型和持仓数量计算实际操作股数
function calcActualQty(totalQty, posType, customQty){
  if(posType === 'full') return totalQty;
  if(posType === 'half') return Math.floor(totalQty / 2);
  if(posType === 'third') return Math.floor(totalQty / 3);
  if(posType === 'custom') return customQty || 0;
  return totalQty;
}

// 更新仓位显示提示
function updateQtyDisplay(displayEl, posType, customQty, groupId){
  // 找到对应的持仓数量
  var holdingId = '';
  if(groupId === 'clearPosGroup') holdingId = pendingClearId;
  else if(groupId === 'doTPosGroup') holdingId = pendingDoTId;

  var holding = null;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(holdingId)){ holding=holdings[i]; break; }
  }
  if(!holding){ displayEl.textContent=''; return; }

  var totalQty = holding.quantity || 0;
  var actualQty = calcActualQty(totalQty, posType, customQty);

  if(posType === 'full'){
    displayEl.textContent = '操作数量：' + totalQty + ' 股（全部仓位）';
  } else if(posType === 'half'){
    displayEl.textContent = '操作数量：' + actualQty + ' 股（' + totalQty + ' 的 1/2）';
  } else if(posType === 'third'){
    displayEl.textContent = '操作数量：' + actualQty + ' 股（' + totalQty + ' 的 1/3）';
  } else {
    displayEl.textContent = '操作数量：' + (customQty || '?') + ' 股（自定义）';
  }
}

// ===== 清仓弹窗 =====
function openClearHolding(id){
  var h=null;
  for(var i=0;i<holdings.length;i++){ if(String(holdings[i].id)===String(id)){ h=holdings[i]; break; } }
  if(!h) return;
  pendingClearId=id;
  document.getElementById('clearStockName').textContent=escapeHtml(getStockName(h.code))||h.code;
  document.getElementById('clearSellPrice').value='';
  document.getElementById('clearAmount').value='';
  document.getElementById('clearNote').value='';
  document.getElementById('clearAutoCalcHint').style.display='none';
  // 显示成本价提示
  if(h.buyPrice){
    var accLabel = (h.accountType || 'normal') === 'margin' ? '两融账户' : '正常账户';
    document.getElementById('clearDesc').innerHTML='持仓成本价：<b style="color:#e74c3c">'+parseFloat(h.buyPrice).toFixed(3)+'</b> 元（'+accLabel+'）。选择仓位并输入卖出价格后，盈亏将<strong>自动扣除手续费</strong>。';
  } else {
    document.getElementById('clearDesc').innerHTML='将该持仓清仓，盈亏将记录到交易记录中。未设置成本价，请手动填写盈亏金额。';
  }
  // 重置仓位选择为"全部"
  selectedClearPos = 'full';
  document.querySelectorAll('#clearPosGroup .pos-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-pos')==='full'); });
  // 重置清仓次数 + 两融账户显示次数选项
  selectedClearBatches = 1;
  var isMargin = (h.accountType || 'normal') === 'margin';
  document.getElementById('clearBatchWrap').style.display = isMargin ? 'block' : 'none';
  document.querySelectorAll('#clearBatchGroup .pos-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-batch')==='1'); });
  document.getElementById('clearCustomQty').value = '';
  updateQtyDisplay(document.getElementById('clearQtyDisplay'), 'full', 0, 'clearPosGroup');
  document.getElementById('clearHoldingModal').classList.add('active');
  setTimeout(function(){ document.getElementById('clearSellPrice').focus(); },100);
}
function closeClearHolding(){ document.getElementById('clearHoldingModal').classList.remove('active'); pendingClearId=''; }

function submitClearHolding(){
  var amount=parseFloat(document.getElementById('clearAmount').value);
  var note=document.getElementById('clearNote').value.trim();
  if(isNaN(amount)){ alert('请填写盈亏金额！'); return; }

  var id = pendingClearId;

  // 计算实际清仓数量
  var customQty = parseInt(document.getElementById('clearCustomQty').value) || 0;
  var holding = null;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(id)){ holding=holdings[i]; break; }
  }
  if(!holding) return;

  var actualQty = calcActualQty(holding.quantity, selectedClearPos, customQty);
  if(actualQty <= 0){ alert('清仓数量不能为0！'); return; }
  if(actualQty > holding.quantity){ actualQty = holding.quantity; }
  var isPartial = actualQty < holding.quantity; // 是否部分清仓

  // 乐观更新
  var savedTrades = JSON.parse(JSON.stringify(trades));
  var savedHoldings = JSON.parse(JSON.stringify(holdings));

  // 计算卖出手续费（用于存入交易记录）—— 必须用卖出价，不能用成本价
  var accType = holding.accountType || 'normal';
  var sellPrice = parseFloat(document.getElementById('clearSellPrice').value) || 0;
  var batches = (accType === 'margin') ? selectedClearBatches : 1;
  var sellFees = calcFees(sellPrice, actualQty, true, accType, holding.code);
  if(batches === 2){
    sellFees.total = Math.round((sellFees.commission * 2 + sellFees.stampTax + sellFees.transferFee) * 100) / 100;
    sellFees.commission = Math.round(sellFees.commission * 2 * 100) / 100;
  }
  var feesTotal = Math.round(sellFees.total * 100) / 100;

  // 添加到交易记录
  var tmpTradeId = genTempId();
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  var finalNote = note || holding.note || '';
  if(isPartial){
     finalNote = (finalNote ? finalNote + ' ' : '') + '部分清仓' + actualQty + '/' + holding.quantity + '股';
  }
  // 清仓备注末尾加账户标记，用于显示账户徽章
  var clearAccLabel = (accType === 'margin') ? '两融' : '正常';
  finalNote += '['+clearAccLabel+']';
  trades.push({id:tmpTradeId, date:todayStr, code:holding.code, tag:holding.tag, quantity:actualQty, amount:amount, note:finalNote, tIndex:0, status:'closed', source:'clear', fees:feesTotal});

  if(isPartial){
    // 部分清仓：减少持仓数量，不移除持仓
    for(var i=0;i<holdings.length;i++){
      if(String(holdings[i].id)===String(id)){
        holdings[i].quantity = holdings[i].quantity - actualQty;
        break;
      }
    }
  } else {
    // 全部清仓：从持仓中移除（做T记录不再标记已完结，因为统计按tIndex过滤）
    holdings = holdings.filter(function(h){ return String(h.id) !== String(id); });
  }

  closeClearHolding();
  refreshUI();
  showStatus('ok','✅ 清仓成功，' + actualQty + '股已记录');

  // 后台同步
  apiCall({action:'clearHolding',id:id,amount:amount,note:finalNote,quantity:actualQty,isPartial:isPartial?1:0,fees:feesTotal}, function(res){
    if(res&&res.success){
      if(res.tradeId){
        for(var j=0;j<trades.length;j++){
          if(trades[j].id===tmpTradeId){ trades[j].id=res.tradeId; break; }
        }
        cacheData(trades);
      }
      // 部分清仓成功后，必须重新从服务器加载持仓列表以确认一致性
      // 防止后端（可能是旧版代码）将部分清仓当作全仓处理导致前后端不同步
      if(isPartial){
        apiCall({action:'listHoldings'}, function(hRes){
          if(hRes&&hRes.success&&hRes.data){
            var found=false;
            for(var k=0;k<hRes.data.length;k++){ if(String(hRes.data[k].id)===String(id)){ found=true; break; } }
            if(!found){
              // 后端已经删除了该持仓（说明后端当作全仓处理了）
              // 前端需要修正：移除本地持仓，提示用户刷新
              holdings = holdings.filter(function(h){ return String(h.id) !== String(id); });
              showStatus('err','⚠️ 检测到云端持仓已被清除，数据已自动同步');
            } else {
              // 后端还有该持仓，更新本地数量和成本价为后端实际值
              for(var m=0;m<holdings.length;m++){
                if(String(holdings[m].id)===String(id)){
                  for(var n=0;n<hRes.data.length;n++){
                    if(String(hRes.data[n].id)===String(id)){
                      holdings[m].quantity = hRes.data[n].quantity;
                      if(hRes.data[n].buyPrice) holdings[m].buyPrice = hRes.data[n].buyPrice;
                      if(hRes.data[n].accountType) holdings[m].accountType = hRes.data[n].accountType;
                      break;
                    }
                  }
                  break;
                }
              }
            }
            cacheData(trades);
            refreshUI();
            _checkSyncStatus();
          }
        });
      } else {
        refreshUI();
        _checkSyncStatus();
      }
    } else {
      var errMsg = res ? (res.error || '') : '';
      // 特殊处理："持仓记录不存在" 错误
      // 这通常意味着后端在之前的某次操作中已经删除了该持仓（可能后端是旧版代码，
      // 将部分清仓误判为全仓清仓并删除了持仓行），而前端乐观更新还保留着本地持仓
      if(errMsg.indexOf('持仓记录不存在') !== -1 && !isPartial){
        // 全仓清仓时发现后端没有该持仓 → 说明交易记录可能已经在之前被写入
        // 策略：保留本次添加的交易记录（乐观更新的trade），移除本地持仓标记，重新加载全部数据
        showStatus('err','⚠️ 云端持仓记录不存在，正在重新同步数据...');
        // 保留乐观添加的trade（tmpTradeId），但需要重新加载来获取真ID
        loadAll(); // 重新从服务器加载所有数据，覆盖本地状态
      } else {
        rollbackOptimistic(savedTrades, savedHoldings, '❌ 清仓失败：'+errMsg);
      }
    }
  });
}

// ===== 做T弹窗 =====
function openDoT(id){
  var h=null;
  for(var i=0;i<holdings.length;i++){ if(String(holdings[i].id)===String(id)){ h=holdings[i]; break; } }
  if(!h) return;
  pendingDoTId=id;
  document.getElementById('doTStockName').textContent=escapeHtml(getStockName(h.code))||h.code;
  document.getElementById('doTSellPrice').value='';
  document.getElementById('doTBuyBackPrice').value='';
  document.getElementById('doTAmount').value='';
  document.getElementById('doTNote').value='';
  document.getElementById('doTAutoCalcHint').style.display='none';
  // 重置仓位选择为"全部"
  selectedDoTPos = 'full';
  document.querySelectorAll('#doTPosGroup .pos-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-pos')==='full'); });
  document.getElementById('doTCustomQty').value = '';
  updateQtyDisplay(document.getElementById('doTQtyDisplay'), 'full', 0, 'doTPosGroup');

  // 自动检测该持仓已做T次数（按code+账户类型分开计数）
  // 判断方式：做T备注中包含"[正常]"或"[两融]"标识
  var accLabel = (h.accountType || 'normal') === 'margin' ? '两融' : '正常';
  var maxT = 0;
  for(var i=0;i<trades.length;i++){
    if(trades[i].code === h.code && trades[i].tIndex > 0 && trades[i].source === 'doT'){
      // 通过备注中的账户标记来区分是否属于当前账户类型
      if(trades[i].note.indexOf('['+accLabel+']') !== -1){
        if(trades[i].tIndex > maxT) maxT = trades[i].tIndex;
      }
    }
  }
  var nextT = Math.min(maxT + 1, 5);
  selectedTIndex = nextT;
  document.querySelectorAll('#doTIndexGroup .t-index-btn').forEach(function(b){
    b.classList.toggle('active', parseInt(b.getAttribute('data-idx')) === nextT);
  });

  document.getElementById('doTModal').classList.add('active');
  setTimeout(function(){ document.getElementById('doTSellPrice').focus(); },100);
  // 重置调换状态
  doTReversed = false;
  document.querySelector('#doTField1 label').textContent = '卖出价格（元）';
  document.querySelector('#doTField2 label').textContent = '买入价格（元）';
  var badge = document.getElementById('doTTypeBadge');
  badge.textContent = '反T';
  badge.classList.remove('reversed');
}
function swapDoTPrices(){
  doTReversed = !doTReversed;
  var label1 = document.querySelector('#doTField1 label');
  var label2 = document.querySelector('#doTField2 label');
  var tmp = label1.textContent;
  label1.textContent = label2.textContent;
  label2.textContent = tmp;
  var v1 = document.getElementById('doTSellPrice').value;
  var v2 = document.getElementById('doTBuyBackPrice').value;
  document.getElementById('doTSellPrice').value = v2;
  document.getElementById('doTBuyBackPrice').value = v1;
  var badge = document.getElementById('doTTypeBadge');
  if(doTReversed){
    badge.textContent = '正T';
    badge.classList.add('reversed');
  } else {
    badge.textContent = '反T';
    badge.classList.remove('reversed');
  }
  autoCalcDoTProfit();
}
function closeDoT(){ document.getElementById('doTModal').classList.remove('active'); pendingDoTId=''; }

function submitDoT(){
  var amount=parseFloat(document.getElementById('doTAmount').value);
  var note=document.getElementById('doTNote').value.trim();
  if(isNaN(amount)){ alert('请填写做T盈亏金额！'); return; }

  var id = pendingDoTId;

  // 计算实际做T数量
  var customQty = parseInt(document.getElementById('doTCustomQty').value) || 0;
  var holding = null;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(id)){ holding=holdings[i]; break; }
  }
  if(!holding) return;

  var actualQty = calcActualQty(holding.quantity, selectedDoTPos, customQty);
  if(actualQty <= 0){ alert('做T数量不能为0！'); return; }
  if(actualQty > holding.quantity){ actualQty = holding.quantity; }

  // 构建备注：做T盈利/亏损金额 + T序号 + 仓位信息 + 可选逻辑
  var absAmt = Math.abs(amount).toFixed(2);
  var doTNote = 'T'+selectedTIndex+' ' + (amount >= 0 ? '盈利'+absAmt+'元' : '亏损'+absAmt+'元');
  if(actualQty < holding.quantity){
    doTNote += ' ' + actualQty + '/' + holding.quantity + '股';
  }
  if(note) doTNote += '（' + note + '）';
  // 做T备注末尾加账户标记，用于T序号按账户分开计数
  var accLabel = (holding.accountType || 'normal') === 'margin' ? '两融' : '正常';
  doTNote += '['+accLabel+']';

  // 计算做T手续费（卖出+买回）
  var accType = holding.accountType || 'normal';
  var sellPrice = parseFloat(document.getElementById('doTSellPrice').value) || 0;
  var buyBackPrice = parseFloat(document.getElementById('doTBuyBackPrice').value) || 0;
  var sellFees = calcFees(sellPrice, actualQty, true, accType, holding.code);
  var buyBackFees = calcFees(buyBackPrice, actualQty, false, accType, holding.code);
  var doTFees = Math.round((sellFees.total + buyBackFees.total) * 100) / 100;

  // 乐观更新：先在前端添加交易记录（持仓不变）
  var savedTrades = JSON.parse(JSON.stringify(trades));
  var savedHoldings = JSON.parse(JSON.stringify(holdings));

  var tmpTradeId = genTempId();
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  trades.push({id:tmpTradeId, date:todayStr, code:holding.code, tag:holding.tag, quantity:actualQty, amount:amount, note:doTNote, tIndex:selectedTIndex, status:'open', source:'doT', fees:doTFees});

  // 乐观更新：做T后自动更新持仓成本价
  if(holding.buyPrice > 0 && holding.quantity > 0){
    var totalCost = holding.buyPrice * holding.quantity;
    var newTotalCost = totalCost - amount;
    var newBuyPrice = newTotalCost / holding.quantity;
    if(newBuyPrice < 0) newBuyPrice = 0;
    holding.buyPrice = Math.round(newBuyPrice * 1000) / 1000;
  }

  closeDoT();
  refreshUI();
  showStatus('ok','✅ 做T'+selectedTIndex+'已记录（'+actualQty+'股）');

  // 后台同步
  apiCall({action:'doT',id:id,amount:amount,note:doTNote,tIndex:selectedTIndex,quantity:actualQty,fees:doTFees}, function(res){
    if(res&&res.success){
      // 用云端真ID替换临时ID
      if(res.tradeId){
        for(var j=0;j<trades.length;j++){
          if(trades[j].id===tmpTradeId){ trades[j].id=res.tradeId; break; }
        }
        cacheData(trades);
      }
      // 后端返回新的成本价，同步到前端
      if(res.newBuyPrice !== undefined){
        for(var k=0;k<holdings.length;k++){
          if(String(holdings[k].id)===String(id)){
            holdings[k].buyPrice = res.newBuyPrice;
            break;
          }
        }
      }
      try{ localStorage.setItem('stock_holdings_cache', JSON.stringify(holdings)); }catch(e){}
      refreshUI();
      _checkSyncStatus();
    } else {
      rollbackOptimistic(savedTrades, savedHoldings, '❌ 做T记录失败：'+(res?res.error:''));
    }
  });
}

// ===== 删除持仓 =====
var pendingDeleteHoldId = ''; // 待删除的持仓ID
var pendingDeleteTradeId = ''; // 待删除的交易记录ID

function deleteHolding(id){
  if(isLoadingHoldings) return;
  var h=null;
  for(var i=0;i<holdings.length;i++){ if(String(holdings[i].id)===String(id)){ h=holdings[i]; break; } }
  if(!h) return;
  pendingDeleteHoldId=id;
  document.getElementById('delHoldStockName').textContent=escapeHtml(getStockName(h.code))||h.code;
  document.getElementById('deleteHoldingModal').classList.add('active');
}
function closeDeleteHolding(){ document.getElementById('deleteHoldingModal').classList.remove('active'); pendingDeleteHoldId=''; }

function submitDeleteHolding(){
  var id = pendingDeleteHoldId;

  // 乐观更新：先从前端删除
  var savedHoldings = JSON.parse(JSON.stringify(holdings));
  holdings = holdings.filter(function(h){ return String(h.id) !== String(id); });
  closeDeleteHolding();
  refreshUI();
  showStatus('ok','✅ 持仓已删除');

  // 后台同步
  apiCall({action:'deleteHolding',id:id}, function(res){
    if(!res||!res.success){
      holdings = savedHoldings;
      refreshUI();
      showStatus('err','❌ 删除持仓失败');
    } else {
      _checkSyncStatus();
    }
  });
}

// ===== 持仓行内编辑 =====
function beginEditHolding(cell, id, field){
  if(cell.classList.contains('editor')) return;
  var h=null;
  for(var i=0;i<holdings.length;i++){ if(String(holdings[i].id)===String(id)){ h=holdings[i]; break; } }
  if(!h) return;

  var oldHtml=cell.innerHTML;
  cell.classList.add('editor');
  cell.innerHTML='';

  var input;
  if(field==='date'){
    input=document.createElement('input'); input.type='date';
    input.value=formatDate(h.date); input.className='editor-date';
    setTimeout(function(){ if(input.showPicker) try{input.showPicker();}catch(e){} },80);
  } else if(field==='quantity'){
    input=document.createElement('input'); input.type='number'; input.step='100';
    input.value=h.quantity;
  } else if(field==='buyPrice'){
    input=document.createElement('input'); input.type='number'; input.step='0.001';
    input.value=h.buyPrice||'';
    input.placeholder='输入成本价';
  } else if(field==='code'){
    input=document.createElement('input'); input.type='text';
    input.value=h.code||'';
    input.placeholder='输入代码或首字母';
    var editAc=document.createElement('div');
    editAc.className='autocomplete-list';
    editAc.style.position='absolute';
    var editAcResults=[];
    input.addEventListener('input',function(){
      var v=input.value.trim().toLowerCase();
      if(!v||typeof STOCK_DICT==='undefined'){editAc.classList.remove('show');editAcResults=[];return;}
      editAcResults=[];var cnt=0;
      for(var c in STOCK_DICT){
        if(cnt>=15)break;
        var n=STOCK_DICT[c][0],py=STOCK_DICT[c][1];
        if(c.indexOf(v)===0||py.indexOf(v)===0){editAcResults.push({code:c,name:n});cnt++;}
      }
      if(editAcResults.length===0){editAc.classList.remove('show');return;}
      var ah='';
      for(var j=0;j<editAcResults.length;j++){
        ah+='<div class="autocomplete-item" data-idx="'+j+'"><span class="ac-name">'+escapeHtml(editAcResults[j].name)+'</span><span class="ac-code">'+editAcResults[j].code+'</span></div>';
      }
      editAc.innerHTML=ah;
      editAc.classList.add('show');
      editAc.querySelectorAll('.autocomplete-item').forEach(function(item){
        item.addEventListener('mousedown',function(ev){
          ev.preventDefault();
          var idx=parseInt(item.getAttribute('data-idx'));
          input.value=editAcResults[idx].code;
          editAc.classList.remove('show');
        });
      });
    });
    cell.style.position='relative';
    cell.appendChild(editAc);
    input.addEventListener('blur',function(){ setTimeout(function(){editAc.classList.remove('show');},150); });
  } else if(field==='tag'){
    input=document.createElement('select'); input.className='editor-select';
    ['主板','创业板','科创板'].forEach(function(t){
      var opt=document.createElement('option'); opt.value=t; opt.textContent=t;
      if((h.tag||'主板')===t) opt.selected=true;
      input.appendChild(opt);
    });
  } else {
    input=document.createElement('input'); input.type='text';
    input.value=h.note||'';
    setTimeout(function(){ input.setSelectionRange(input.value.length,input.value.length); },80);
  }

  cell.appendChild(input);
  input.focus();

  function finish(){
    var v=input.value.trim();
    if(field==='quantity'&&v===''){ cancel(); return; }

    // 乐观更新：先在前端修改
    var savedHoldings = JSON.parse(JSON.stringify(holdings));
    var oldVal;
    for(var i=0;i<holdings.length;i++){
      if(String(holdings[i].id)===String(id)){
        oldVal = holdings[i][field];
        if(field==='quantity') holdings[i].quantity = parseInt(v)||0;
        else if(field==='buyPrice') holdings[i].buyPrice = parseFloat(v)||0;
        else if(field==='code') holdings[i].code = v;
        else if(field==='tag') holdings[i].tag = v;
        else if(field==='date') holdings[i].date = v;
        else if(field==='note') holdings[i].note = v;
        break;
      }
    }
    cell.classList.remove('editor');
    refreshUI();
    showStatus('ok','✅ 已保存');

    // 后台同步
    apiCall({action:'updateHolding',id:id,field:field,value:v}, function(res){
      if(!res||!res.success){
        // 回滚
        for(var j=0;j<holdings.length;j++){
          if(String(holdings[j].id)===String(id)){
            holdings[j][field] = oldVal;
            break;
          }
        }
        refreshUI();
        showStatus('err','❌ 保存失败');
      } else {
        _checkSyncStatus();
      }
    });
  }
  function cancel(){ cell.classList.remove('editor'); cell.innerHTML=oldHtml; }

  input.addEventListener('blur',function(){ setTimeout(finish,120); });
  input.addEventListener('keydown',function(e){
    if(e.key==='Enter'){ e.preventDefault(); input.blur(); }
    if(e.key==='Escape') cancel();
  });
  if(input.tagName==='SELECT'){
    input.addEventListener('change',function(){ input.blur(); });
  }
}

// ===== 渲染持仓表格 =====
function renderHoldings(){
  var tbody=document.getElementById('holdBody');
  var cardEl=document.getElementById('holdCard');
  var msg=document.getElementById('holdEmpty');

  // 根据当前选中的账户类型筛选持仓
  var filtered = holdings.filter(function(h) {
    return (h.accountType || 'normal') === selectedAccountType;
  });

  if(filtered.length===0){ tbody.innerHTML=''; cardEl.innerHTML=''; msg.style.display='block'; return; }
  msg.style.display='none';

  filtered.sort(function(a,b){ var dd=new Date(b.date)-new Date(a.date); if(dd!==0) return dd; return b.id.localeCompare(a.id); });

  var today = todayStr();
  var html='';
  var cardHtml='';
  for(var i=0;i<filtered.length;i++){
    var h=filtered[i];
    var tagClass=h.tag==='创业板'?'tag-gem':h.tag==='科创板'?'tag-star':'tag-main';
    var stockName=escapeHtml(getStockName(h.code))||'-';
    var buyPriceShow = h.buyPrice ? (parseFloat(h.buyPrice).toFixed(3)) : '-';
    var accType = h.accountType || 'normal';
    var accBadge = '<span class="acc-badge '+(accType==='margin'?'acc-margin':'acc-normal')+'">'+(accType==='margin'?'两融':'正常')+'</span>';

    // 计算可用/持仓
    var totalQty = h.quantity || 0;
    var availableQty;
    if(h.date === today){
      // T日买入，当天不可用
      availableQty = 0;
    } else {
      // T+1后可用，但今日做T的open记录会占用可用额度
      var todayDoTQty = 0;
      for(var j=0;j<trades.length;j++){
        var tr=trades[j];
        if(tr.code===h.code && tr.source==='doT' && tr.status==='open' && tr.date===today){
          todayDoTQty += (tr.quantity||0);
        }
      }
      availableQty = Math.max(0, totalQty - todayDoTQty);
    }
    var availColor = availableQty === 0 ? '#e74c3c' : (availableQty < totalQty ? '#e67e22' : '#27ae60');
    var availShow = '<span style="color:'+availColor+';font-weight:600">'+availableQty+'</span><span style="color:#666">/'+totalQty+'</span>';

    // 桌面端表格行
    html+='<tr>';
    html+='<td>'+(i+1)+'</td>';
    html+='<td class="editable" data-id="'+h.id+'" data-field="date">'+formatDate(h.date)+'</td>';
    html+='<td class="editable" data-id="'+h.id+'" data-field="code" style="text-align:left">'+stockName+accBadge+'</td>';
    html+='<td class="editable" data-id="'+h.id+'" data-field="tag"><span class="tag '+tagClass+'">'+(h.tag||'主板')+'</span></td>';
    html+='<td class="editable" data-id="'+h.id+'" data-field="quantity">'+h.quantity+'股</td>';
    html+='<td class="editable" data-id="'+h.id+'" data-field="buyPrice">'+buyPriceShow+'<div class="tooltip-box">'+getBuyPriceTip(h)+'</div></td>';
    html+='<td>'+availShow+'</td>';
    html+='<td style="text-align:right">';
    html+='<button class="op-btn btn-clear" data-id="'+h.id+'" data-action="clearHolding">清仓</button>';
    html+='<button class="op-btn btn-dot" data-id="'+h.id+'" data-action="doT">做T</button>';
    html+='<button class="op-btn btn-add-more" data-id="'+h.id+'" data-action="addMore">补仓</button>';
    html+='<button class="op-btn btn-del-h" data-id="'+h.id+'" data-action="deleteHolding">删除</button>';
    html+='</td>';
    html+='</tr>';

    // 移动端卡片
    cardHtml+='<div class="hold-card-item">';
    cardHtml+='<div class="hold-card-header">';
    cardHtml+='<span class="hold-card-name">'+stockName+accBadge+'</span>';
    cardHtml+='<span class="tag '+tagClass+'">'+(h.tag||'主板')+'</span>';
    cardHtml+='</div>';
    cardHtml+='<div class="hold-card-row"><span class="label">买入日期</span><span class="editable" data-id="'+h.id+'" data-field="date">'+formatDate(h.date)+'</span></div>';
    cardHtml+='<div class="hold-card-row"><span class="label">持有数量</span><span class="editable" data-id="'+h.id+'" data-field="quantity">'+h.quantity+'股</span></div>';
    cardHtml+='<div class="hold-card-row"><span class="label">成本价</span><span class="editable" data-id="'+h.id+'" data-field="buyPrice">'+buyPriceShow+'<div class="tooltip-box">'+getBuyPriceTip(h)+'</div></span></div>';
    cardHtml+='<div class="hold-card-row"><span class="label">可用/持仓</span><span>'+availShow+'</span></div>';
    cardHtml+='<div class="hold-card-footer">';
    cardHtml+='<button class="op-btn btn-clear" data-id="'+h.id+'" data-action="clearHolding" style="background:#e67e22;color:white">清仓</button>';
    cardHtml+='<button class="op-btn btn-dot" data-id="'+h.id+'" data-action="doT" style="background:#8e44ad;color:white">做T</button>';
    cardHtml+='<button class="op-btn btn-add-more" data-id="'+h.id+'" data-action="addMore" style="background:#27ae60;color:white">补仓</button>';
    cardHtml+='<button class="op-btn btn-del-h" data-id="'+h.id+'" data-action="deleteHolding" style="background:#e74c3c;color:white">删除</button>';
    cardHtml+='</div>';
    cardHtml+='</div>';
  }
  tbody.innerHTML=html;
  cardEl.innerHTML=cardHtml;
}

// ===== 工具 =====
function escapeHtml(s){ if(!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatDate(d){
  if(!d) return '';
  var s=String(d).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var date=new Date(s);
  if(isNaN(date.getTime())) return s;
  return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
}

// ===== 分红（红利入账）=====
function openDividend(){
  var modal = document.getElementById('dividendModal');
  var sel = document.getElementById('dividendStockSelect');
  sel.innerHTML = '<option value="">-- 请选择 --</option>';
  for(var i=0;i<holdings.length;i++){
    var h = holdings[i];
    var label = getStockName(h.code) + '（' + h.code + '）';
    var accType = h.accountType || 'normal';
    if(accType === 'margin') label += ' [两融]';
    var opt = document.createElement('option');
    opt.value = h.id;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  document.getElementById('dividendQtyDisplay').textContent = '-';
  document.getElementById('dividendCostDisplay').textContent = '-';
  document.getElementById('dividendAmount').value = '';
  document.getElementById('dividendPreview').style.display = 'none';
  modal.classList.add('active');
}

function closeDividend(){
  document.getElementById('dividendModal').classList.remove('active');
}

function onDividendStockChange(){
  var sel = document.getElementById('dividendStockSelect');
  var id = sel.value;
  if(!id){ return; }
  var h = null;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(id)){ h=holdings[i]; break; }
  }
  if(!h) return;
  document.getElementById('dividendQtyDisplay').textContent = h.quantity || 0;
  document.getElementById('dividendCostDisplay').textContent = (parseFloat(h.buyPrice)||0).toFixed(3);
  autoCalcDividend();
}

function autoCalcDividend(){
  var amount = parseFloat(document.getElementById('dividendAmount').value);
  var sel = document.getElementById('dividendStockSelect');
  var id = sel.value;
  if(!id || isNaN(amount) || amount <= 0){
    document.getElementById('dividendPreview').style.display = 'none';
    return;
  }
  var h = null;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(id)){ h=holdings[i]; break; }
  }
  if(!h) return;
  var qty = h.quantity || 0;
  if(qty <= 0) return;
  var perShare = Math.round(amount / qty * 100) / 100;
  var oldCost = parseFloat(h.buyPrice) || 0;
  var newCost = Math.round((oldCost - perShare) * 1000) / 1000;
  var preview = document.getElementById('dividendPreview');
  preview.style.display = 'block';
  preview.innerHTML = '✅ 每股红利 ¥' + perShare.toFixed(2) + '，新成本价 = ' + oldCost.toFixed(3) + ' − ' + perShare.toFixed(2) + ' = <b>' + newCost.toFixed(3) + '</b> 元';
}

function submitDividend(){
  var sel = document.getElementById('dividendStockSelect');
  var id = sel.value;
  var amount = parseFloat(document.getElementById('dividendAmount').value);
  if(!id){ alert('请选择持仓股票！'); return; }
  if(isNaN(amount) || amount <= 0){ alert('请输入红利入账金额！'); return; }

  var h = null, hIdx = -1;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(id)){ h=holdings[i]; hIdx=i; break; }
  }
  if(!h){ alert('持仓记录不存在！'); return; }

  var qty = h.quantity || 0;
  if(qty <= 0){ alert('持仓数量为0！'); return; }
  var perShare = Math.round(amount / qty * 100) / 100;
  var oldCost = parseFloat(h.buyPrice) || 0;
  var newCost = Math.round((oldCost - perShare) * 1000) / 1000;

  closeDividend();

  // 乐观更新
  var savedHoldings = JSON.parse(JSON.stringify(holdings));
  holdings[hIdx].buyPrice = newCost;
  refreshUI();
  showStatus('ok', '✅ 红利入账成功：' + getStockName(h.code) + ' 成本价 ' + oldCost.toFixed(3) + ' → ' + newCost.toFixed(3) + ' 元');

  // 后台同步
  apiCall({action:'updateHolding',id:id,field:'buyPrice',value:newCost}, function(res){
    if(!res||!res.success){
      holdings = savedHoldings;
      refreshUI();
      showStatus('err','❌ 红利入账失败');
    } else {
      try{ localStorage.setItem('stock_holdings_cache', JSON.stringify(holdings)); }catch(e){}
      _checkSyncStatus();
    }
  });
}
