
// ===== 版本记录 =====
// 2026-07-21 持仓止损告警灯：新增「告警」列；现价跌破成本价≥3%亮💡(黄)、≥5%亮🚨(红)；悬停显示「已跌 -X%（成本价 Y，现价 Z）」。仅桌面持仓表，移动端不加。

// ===== 配置 =====
var API_URL = localStorage.getItem('stock_api_url') || 'https://script.google.com/macros/s/AKfycbyOwq1kdea7UHOjX4srOV5wjy1n2V5a4mVwIokyzbUm5PQ1rEQ5muROc3ChhUOYzR-y-A/exec';
var MAX_RETRIES = 3;
var RETRY_DELAY = 2000;
var trades = [];
var holdings = [];
var currentPrices = {}; // 持仓实时价格缓存 { code: { close: Number } }
var isLoading = false;
var isLoadingHoldings = false;
var trendChart = null;
var marginChart = null;
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
  setupPosGroup('doTPosGroup', 'doTCustomQty', 'doTQtyDisplay', function(pos){
    selectedDoTPos = pos;
    // 不等量区域显示/隐藏
    var unequalArea = document.getElementById('doTUnequalArea');
    if(unequalArea) unequalArea.style.display = (pos === 'unequal') ? 'block' : 'none';
    // 选非不等量时清空不等量输入框
    if(pos !== 'unequal'){
      var sq = document.getElementById('doTSellQty');
      var bq = document.getElementById('doTBuyQty');
      if(sq) sq.value = '';
      if(bq) bq.value = '';
    }
    autoCalcDoTProfit();
  });

  if(!isOnline){
    document.getElementById('offlineTip').classList.add('show');
    loadCachedData();
  } else {
    loadAll();
  }

  // 跨终端同步：页面从不可见变为可见时，立即同步一次（已临时关闭，避免频繁切页触发过多拉取）
  // document.addEventListener('visibilitychange', function(){
  //   if(!document.hidden && isOnline) _silentSync();
  // });

  // 跨终端自动同步：每5分钟静默拉取一次，有变化才刷新
  setInterval(function(){
    if(!document.hidden && isOnline) _silentSync();
  }, 300000);

  // 融资余额刷新按钮
  setupMarginRefreshBtn();

  // 当前时间（每秒刷新）
  updateCurrentTime();
  setInterval(updateCurrentTime, 1000);

  // 恢复上次停留的一级 Tab（F5 不跳回交易列表）
  var _savedTab = null;
  try { _savedTab = localStorage.getItem('stock_active_tab'); } catch(e){}
  var _validTabs = ['toolbox','table','analysis','bond'];
  if (_savedTab && _validTabs.indexOf(_savedTab) !== -1) {
    switchTab(_savedTab);
  } else {
    switchTab('table');
  }
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
  document.getElementById('tabBond').style.display = name==='bond'?'block':'none';

  // 更新tab样式
  var tabBtns = document.querySelectorAll('.container > .tabs .tab');
  tabBtns.forEach(function(t){ t.classList.remove('active'); });
  if(name==='toolbox'){ tabBtns[0].classList.add('active'); switchToolboxTab('calendar'); }
  if(name==='table') tabBtns[1].classList.add('active');
  if(name==='analysis') tabBtns[2].classList.add('active');
  if(name==='bond') tabBtns[3].classList.add('active');

  if(name==='analysis') renderAnalysis();
  if(name==='table'){ renderTable(); renderHoldings(); }
  if(name==='toolbox') switchToolboxTab('calendar');
  if(name==='bond') openBondTab();
  try { localStorage.setItem('stock_active_tab', name); } catch(e){}
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

// ===== 股票字典搜索：建一次索引 + 前缀匹配（供 4 处复用）=====
var _stockDictIdx = null;
function buildStockDictIndex() {
  if (_stockDictIdx) return;
  _stockDictIdx = { all: [], byCode1: {}, byPy1: {} };
  if (typeof STOCK_DICT === 'undefined') return;
  for (var code in STOCK_DICT) {
    var arr = STOCK_DICT[code];
    var rec = { code: code, name: arr[0], pinyin: (arr[1] || '') };
    _stockDictIdx.all.push(rec);
    var c1 = code.charAt(0);
    (_stockDictIdx.byCode1[c1] = _stockDictIdx.byCode1[c1] || []).push(rec);
    var p1 = rec.pinyin.charAt(0);
    if (p1) (_stockDictIdx.byPy1[p1] = _stockDictIdx.byPy1[p1] || []).push(rec);
  }
}
function searchStockDict(query, limit) {
  buildStockDictIndex();
  var val = (query || '').trim().toLowerCase();
  var res = [];
  if (!val || !_stockDictIdx) return res;
  limit = limit || 30;
  var c1 = val.charAt(0);
  var pools = [];
  if (_stockDictIdx.byCode1[c1]) pools.push(_stockDictIdx.byCode1[c1]);
  if (_stockDictIdx.byPy1[c1]) pools.push(_stockDictIdx.byPy1[c1]);
  if (pools.length === 0) pools.push(_stockDictIdx.all);
  for (var p = 0; p < pools.length; p++) {
    var pool = pools[p];
    for (var i = 0; i < pool.length; i++) {
      var it = pool[i];
      if (it.code.indexOf(val) === 0 || it.pinyin.indexOf(val) === 0) {
        res.push({ code: it.code, name: it.name, pinyin: it.pinyin });
        if (res.length >= limit) return res;
      }
    }
  }
  return res;
}

// ===== 交易代码联想（带防抖）=====
var _onCodeInputTimer = null;
function onCodeInput() {
  if (_onCodeInputTimer) clearTimeout(_onCodeInputTimer);
  _onCodeInputTimer = setTimeout(_doCodeInput, 150);
}
function _doCodeInput() {
  var input = document.getElementById('inpCode');
  var val = input.value.trim().toLowerCase();
  var list = document.getElementById('acList');

  if (!val || typeof STOCK_DICT === 'undefined') {
    list.classList.remove('show');
    acResults = [];
    acSelectedIndex = -1;
    return;
  }

  acResults = searchStockDict(val, 30);

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
  updateUndoBtn();
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
    updateUndoBtn();
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
      // 内容级比较：同ID、同条数但字段值变了（如行内编辑金额/备注）也能检出
      var needRender = _dataChanged(trades, newData);
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
      // 只有数据有变化才重新渲染（内容级比较，避免补仓等"同ID同条数但字段变化"被漏判）
      var needRender = _dataChanged(holdings, newData);
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
      editAcResults=searchStockDict(v,15);editAcIndex=-1;
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

  // 预计算部分清仓编号：按股票独立编号、按时间顺序（最早的=部1）
  // 用于交易列表中小徽章显示
  var partialClearNumMap = {};
  var sortedChrono = trades.slice().sort(function(a,b){ return new Date(a.date)-new Date(b.date); });
  var perStockCount = {};
  for(var i=0;i<sortedChrono.length;i++){
    var ct = sortedChrono[i];
    if(isPartialClearTrade(ct)){
      var cc = ct.code||'';
      if(!perStockCount[cc]) perStockCount[cc] = 0;
      perStockCount[cc]++;
      partialClearNumMap[ct.id] = perStockCount[cc];
    }
  }

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
      if(!isPnlExcluded(gTrades[k])) gProfit += gTrades[k].amount;
      gFees += (parseFloat(gTrades[k].fees)||0);
    }
    var gCls = gProfit >= 0 ? 'profit' : 'loss';
    var gSign = gProfit >= 0 ? '+' : '';
    var gOpen = gi === 0; // 默认展开最新月份

    // 桌面端：月份标题行
    html+='<tr class="month-header" data-month="'+g.month+'" onclick="toggleMonth(this)" style="cursor:pointer;background:#c9d4df">';
    html+='<td colspan="5" style="padding:10px 12px;text-align:left;font-weight:600;font-size:13px;color:#2c3e50">';
    html+='<span class="month-toggle" style="display:inline-block;width:18px;transition:transform 0.2s">'+(gOpen?'▼':'▶')+'</span> ';
    html+=escapeHtml(g.label)+' <span style="color:#888;font-weight:400">'+gCount+'条</span>';
    html+='</td>';
    html+='<td class="'+gCls+'" style="font-weight:600;text-align:center">'+gSign+gProfit.toFixed(2)+'</td>';
    html+='<td style="color:#8e44ad;font-weight:600;text-align:center">'+(gFees>0?gFees.toFixed(2):'-')+'</td>';
    html+='<td colspan="3"></td>';
    html+='</tr>';

    // ===== 按日期分组 =====
    var dayGroups = [];
    var curDay = '';
    for(var di=0;di<gTrades.length;di++){
      var dt = gTrades[di].date; // "2026-07-02"
      if(dt !== curDay){
        curDay = dt;
        dayGroups.push({ day: dt, label: dt.substring(5).replace('-','月')+'日', trades: [] });
      }
      dayGroups[dayGroups.length-1].trades.push(gTrades[di]);
    }

    // 桌面端的行样式（按月份隐藏）
    var rowStyle = gOpen ? '' : ' style="display:none"';

    for(var di=0;di<dayGroups.length;di++){
      var dg = dayGroups[di];
      seq = 0; // 每个交易日序号从 1 重新开始
      var dgTrades = dg.trades;
      var dgCount = dgTrades.length;
      var dgProfit = 0;
      for(var dk=0;dk<dgTrades.length;dk++){
        if(!isPnlExcluded(dgTrades[dk])) dgProfit += dgTrades[dk].amount;
      }
      var dgCls = dgProfit >= 0 ? 'profit' : 'loss';
      var dgSign = dgProfit >= 0 ? '+' : '';

      // 日期标题行（列结构与月份标题行完全一致，保证三角在同一垂直线）
      html+='<tr class="day-header day-row-'+g.month+'" data-day="'+dg.day+'" data-month="'+g.month+'"'+rowStyle+' onclick="toggleDay(this)">';
      // 第1格 colspan=5，与月份第一格同宽 → 三角绝对对齐
      html+='<td colspan="5" style="padding:8px 12px 8px 36px;cursor:pointer;background:#eef2f5;border-bottom:1px solid #ddd;text-align:left">';
      html+='<span class="day-toggle" style="display:inline-block;width:16px;font-size:12px;transition:transform 0.2s;color:#7f8c8d;margin-right:6px">▼</span> ';
      html+='<span style="font-weight:600;font-size:12px;color:#34495e">'+escapeHtml(dg.label)+'</span>';
      html+='<span style="color:#999;font-weight:400;font-size:11px;margin-left:6px">'+dgCount+'笔</span>';
      if(dgProfit !== 0){
        html+='<span class="'+dgCls+'" style="font-weight:600;font-size:11px;margin-left:10px">'+dgSign+dgProfit.toFixed(2)+'</span>';
      }
      html+='</td>';
      // 第2格：盈亏列（与月份第2格同宽）
      html+='<td style="background:#eef2f5;border-bottom:1px solid #ddd"></td>';
      // 第3格：手续费列（与月份第3格同宽）
      html+='<td style="background:#eef2f5;border-bottom:1px solid #ddd"></td>';
      // 第4格：colspan=3，与月份最后一格同宽
      html+='<td colspan="3" style="background:#eef2f5;border-bottom:1px solid #ddd"></td>';
      html+='</tr>';

      // ===== 当天交易记录 =====
      for(var j=0;j<dgTrades.length;j++){
      seq++;
      var t=dgTrades[j], ip=t.amount>0, cls=ip?'profit':'loss', sign=t.amount>=0?'+':'';
      var rawNote = (t.note||'').replace('[正常]','').replace('[两融]','').replace('[补录]','').trim();
      var noteShow=escapeHtml(rawNote||'-');
      var tagClass=t.tag==='创业板'?'tag-gem':t.tag==='科创板'?'tag-star':'tag-main';
      var stockName=escapeHtml(getStockName(t.code))||'-';

      // T 标徽章
      var tIdx = t.tIndex || 0;
      var tBadgeHtml = '';
      if(tIdx > 0){
        var tBadgeCls = ip ? 't-badge-profit' : 't-badge-loss';
        tBadgeHtml = '<span class="t-badge '+tBadgeCls+'">T'+tIdx+'</span>';
        var tNote = t.note || '';
        if(tNote.indexOf('[两融]')!==-1){
          tBadgeHtml += '<span class="acc-badge acc-margin" style="font-size:10px">两融</span>';
        } else if(tNote.indexOf('[正常]')!==-1){
          tBadgeHtml += '<span class="acc-badge acc-normal" style="font-size:10px">正常</span>';
        }
      }

      // 清仓来源徽章（部分清仓用「部」+编号，与做T的T徽章样式统一）
      var sourceHtml = '';
      var tSource = t.source || '';
      if(tSource === 'clear'){
        var pNum = partialClearNumMap[t.id];
        if(pNum){
          var pBadgeCls = ip ? 't-badge-profit' : 't-badge-loss';
          sourceHtml = '<span class="t-badge '+pBadgeCls+'">部清'+pNum+'</span>';
        } else {
          sourceHtml = '<span class="source-clear">清仓</span>';
        }
        var cNote = t.note || '';
        if(cNote.indexOf('[两融]')!==-1){
          sourceHtml += '<span class="acc-badge acc-margin" style="font-size:10px;margin-left:4px">两融</span>';
        } else if(cNote.indexOf('[正常]')!==-1){
          sourceHtml += '<span class="acc-badge acc-normal" style="font-size:10px;margin-left:4px">正常</span>';
        }
      }

      // 手续费显示 + tooltip
      var feesShow = (t.fees && t.fees > 0) ? t.fees.toFixed(2) : '-';
      var feesTooltip = (t.fees && t.fees > 0) ? getFeesTooltip(t) : '';

      // 桌面端表格行
      html+='<tr class="month-row-'+g.month+' day-row-'+dg.day+'"'+rowStyle+'>';
      html+='<td>'+seq+'</td>';
      html+='<td class="editable" data-id="'+t.id+'" data-field="date">'+formatDate(t.date)+'</td>';
      html+='<td style="text-align:left">'+stockName+tBadgeHtml+sourceHtml+'</td>';
      html+='<td class="editable" data-id="'+t.id+'" data-field="tag"><span class="tag '+tagClass+'">'+(t.tag||'主板')+'</span></td>';
      html+='<td class="editable" data-id="'+t.id+'" data-field="quantity">'+(t.quantity?t.quantity+'股':'-')+'</td>';
      html+='<td class="editable '+cls+'" data-id="'+t.id+'" data-field="amount">'+sign+t.amount.toFixed(2)+'</td>';
      html+='<td class="editable" data-id="'+t.id+'" data-field="fees" style="color:#7f8c8d">'+feesShow+(feesTooltip?'<div class="tooltip-box">'+feesTooltip+'</div>':'')+'</td>';
      html+='<td class="'+cls+'">'+(ip?'成功':'失败')+'</td>';
      html+='<td class="editable" data-id="'+t.id+'" data-field="note">'+noteShow+'</td>';
      html+='<td><button class="del-btn" data-id="'+t.id+'" data-action="deleteTrade">删除</button></td>';
      html+='</tr>';

      // 移动端卡片
      cardHtml+='<div class="trade-card-item month-row-'+g.month+' day-row-'+dg.day+'"'+rowStyle+'>';
      cardHtml+='<div class="trade-card-header">';
      cardHtml+='<span class="trade-card-name">'+stockName+tBadgeHtml+sourceHtml+'</span>';
      cardHtml+='<span class="trade-card-amount '+(ip?'red':'green')+'">'+sign+t.amount.toFixed(2)+'</span>';
      cardHtml+='</div>';
      cardHtml+='<div class="trade-card-row"><span class="label">日期</span><span class="editable" data-id="'+t.id+'" data-field="date">'+formatDate(t.date)+'</span></div>';
      cardHtml+='<div class="trade-card-row"><span class="label">数量</span><span class="editable" data-id="'+t.id+'" data-field="quantity">'+(t.quantity?t.quantity+'股':'-')+'</span></div>';
      if(t.fees && t.fees > 0) cardHtml+='<div class="trade-card-row"><span class="label">手续费</span><span style="color:#7f8c8d">'+t.fees.toFixed(2)+'</span></div>';
      cardHtml+='<div class="trade-card-row"><span class="label">备注</span><span class="editable" data-id="'+t.id+'" data-field="note">'+noteShow+'</span></div>';
      cardHtml+='<div class="trade-card-footer">';
      cardHtml+='<span class="tag '+tagClass+'">'+(t.tag||'主板')+'</span>';
      cardHtml+='<span class="'+(ip?'red':'green')+'" style="font-size:12px;font-weight:500">'+(ip?'✅ 成功':'❌ 失败')+'</span>';
      cardHtml+='<button class="trade-card-del" data-id="'+t.id+'" data-action="deleteTrade">删除</button>';
      cardHtml+='</div>';
      cardHtml+='</div>';
      } // end day trades loop (j)
    } // end day groups loop (di)
  } // end month groups loop (gi)
  tbody.innerHTML=html;
  cardEl.innerHTML=cardHtml;
  // 恢复月份折叠状态
  restoreMonthCollapseState();
}

// 切换月份折叠（桌面端行 + 移动端卡片同步，日期折叠状态有记忆）
function toggleMonth(el){
  var month = el.getAttribute('data-month');
  var rows = document.querySelectorAll('.month-row-'+month);
  var dayHeaders = document.querySelectorAll('.day-header[data-month="'+month+'"]');
  var toggle = el.querySelector('.month-toggle');
  var isOpen = toggle.textContent === '▼';
  if(isOpen){
    // 折叠：隐藏所有行和日期标题，不改日期图标状态（保留记忆）
    for(var i=0;i<rows.length;i++){
      rows[i].style.display = 'none';
    }
    for(var i=0;i<dayHeaders.length;i++){
      dayHeaders[i].style.display = 'none';
    }
  } else {
    // 展开：先显示所有行和日期标题
    for(var i=0;i<rows.length;i++){
      rows[i].style.display = '';
    }
    for(var i=0;i<dayHeaders.length;i++){
      dayHeaders[i].style.display = '';
    }
    // 按每个日期的图标状态恢复：图标为▶的日期，隐藏其下记录行
    for(var i=0;i<dayHeaders.length;i++){
      var dt = dayHeaders[i].querySelector('.day-toggle');
      if(dt && dt.textContent === '▶'){
        var d = dayHeaders[i].getAttribute('data-day');
        var dRows = document.querySelectorAll('.day-row-'+d);
        for(var j=0;j<dRows.length;j++){
          if(!dRows[j].classList.contains('day-header')){
            dRows[j].style.display = 'none';
          }
        }
      }
    }
  }
  toggle.textContent = isOpen ? '▶' : '▼';
  saveCollapseState();
}

// 切换日期折叠（桌面端行 + 移动端卡片同步）
function toggleDay(el){
  var day = el.getAttribute('data-day');
  var rows = document.querySelectorAll('.day-row-'+day);
  var toggle = el.querySelector('.day-toggle');
  var isOpen = toggle.textContent === '▼';
  for(var i=0;i<rows.length;i++){
    // 跳过day-header本身（class同时包含day-row-）
    if(rows[i].classList.contains('day-header')) continue;
    rows[i].style.display = isOpen ? 'none' : '';
  }
  toggle.textContent = isOpen ? '▶' : '▼';
  // 持久化折叠状态
  saveCollapseState();
}

// 保存折叠状态到localStorage（月份+日期）
function saveCollapseState(){
  var monthHeaders = document.querySelectorAll('.month-header');
  var dayHeaders = document.querySelectorAll('.day-header');
  var mState = {};
  var dState = {};
  for(var i=0;i<monthHeaders.length;i++){
    var m = monthHeaders[i].getAttribute('data-month');
    var t = monthHeaders[i].querySelector('.month-toggle');
    if(t) mState[m] = (t.textContent === '▶'); // true=收缩, false=展开
  }
  for(var i=0;i<dayHeaders.length;i++){
    var d = dayHeaders[i].getAttribute('data-day');
    var t = dayHeaders[i].querySelector('.day-toggle');
    if(t) dState[d] = (t.textContent === '▶'); // true=收缩, false=展开
  }
  try{ localStorage.setItem('month_collapse', JSON.stringify(mState)); }catch(e){}
  try{ localStorage.setItem('day_collapse', JSON.stringify(dState)); }catch(e){}
}

// 从localStorage恢复折叠状态（月份+日期，在renderTable后调用）
// 两步：先恢复日期图标，再恢复月份状态，展开时按日期图标重新隐藏记录行
function restoreMonthCollapseState(){
  var raw, dRaw;
  try{ raw = localStorage.getItem('month_collapse'); }catch(e){ return; }
  if(!raw) return;
  var mState;
  try{ mState = JSON.parse(raw); }catch(e){ return; }
  try{ dRaw = localStorage.getItem('day_collapse'); }catch(e){}
  var dState = {};
  try{ if(dRaw) dState = JSON.parse(dRaw); }catch(e){}

  // 第一步：恢复所有日期图标（先设图标，再根据图标隐藏行）
  var dayHeaders = document.querySelectorAll('.day-header');
  for(var i=0;i<dayHeaders.length;i++){
    var d = dayHeaders[i].getAttribute('data-day');
    var dt = dayHeaders[i].querySelector('.day-toggle');
    if(dt) dt.textContent = (dState[d] === true) ? '▶' : '▼';
  }

  // 第二步：恢复月份折叠状态
  for(var m in mState){
    var header = document.querySelector('.month-header[data-month="'+m+'"]');
    if(!header) continue;
    var toggle = header.querySelector('.month-toggle');
    if(mState[m] === true){
      // 月份需收缩：隐藏所有行和日期标题
      var rows = document.querySelectorAll('.month-row-'+m);
      var dh = document.querySelectorAll('.day-header[data-month="'+m+'"]');
      for(var j=0;j<rows.length;j++){ rows[j].style.display = 'none'; }
      for(var k=0;k<dh.length;k++){ dh[k].style.display = 'none'; }
      if(toggle) toggle.textContent = '▶';
    } else {
      // 月份需展开：先全部显示，再按日期图标状态隐藏已折叠的日期
      var rows = document.querySelectorAll('.month-row-'+m);
      var dh = document.querySelectorAll('.day-header[data-month="'+m+'"]');
      for(var j=0;j<rows.length;j++){ rows[j].style.display = ''; }
      for(var k=0;k<dh.length;k++){ dh[k].style.display = ''; }
      for(var k=0;k<dh.length;k++){
        var dt = dh[k].querySelector('.day-toggle');
        if(dt && dt.textContent === '▶'){
          var d = dh[k].getAttribute('data-day');
          var dRows = document.querySelectorAll('.day-row-'+d);
          for(var j=0;j<dRows.length;j++){
            if(!dRows[j].classList.contains('day-header')){
              dRows[j].style.display = 'none';
            }
          }
        }
      }
      if(toggle) toggle.textContent = '▼';
    }
  }
}

// ===== 盈亏统计排除规则 =====
// 做T(tIndex>0) 与 部分清仓(isPartial=1) 均不计入总盈亏：
//   - 做T：盈亏已通过冲减成本价体现在持仓成本
//   - 部分清仓：盈亏已通过现金流法冲减成本价体现在剩余持仓成本（与做T口径一致）
// 部分清仓识别：优先用 isPartial 字段；历史数据无该字段时，按 source=clear 且备注含「部分清仓」兼容识别
function isDoTTrade(t){ return (t.tIndex || 0) > 0; }
function isPartialClearTrade(t){
  if(t.isPartial === 1 || t.isPartial === true) return true;
  if(t.source === 'clear' && t.note && String(t.note).indexOf('部分清仓') !== -1) return true;
  return false;
}
function isPnlExcluded(t){ return isDoTTrade(t) || isPartialClearTrade(t); }

// ===== 统计 =====
function updateStats(){
  // 只统计计入总盈亏的记录（排除做T与部分清仓）
  var closedTrades = trades.filter(function(t){ return !isPnlExcluded(t); });
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
  el.textContent=(tp>=0?'+':'')+tp.toFixed(2);
  el.className='card-val '+(tp>=0?'red':'green');
  document.getElementById('stMaxWin').textContent='+'+maxWin.toFixed(2);
  document.getElementById('stMaxLoss').textContent=maxLoss.toFixed(2);
  // 手续费总额
  var tf=0;
  for(var j=0;j<trades.length;j++){ tf+=(parseFloat(trades[j].fees)||0); }
  document.getElementById('stFees').textContent=tf.toFixed(2);
  // 持仓盈亏 = 全部持仓（正常账户 + 两融账户）浮动盈亏合计，遍历全部 holdings 不区分账户
  var hpTotal = 0;
  for(var k=0;k<holdings.length;k++){
    var hk=holdings[k];
    var padded=(hk.code||'').padStart(6,'0');
    var cp2=currentPrices[padded];
    if(cp2 && cp2.close>0 && hk.buyPrice>0 && hk.quantity>0){
      hpTotal+=(cp2.close-hk.buyPrice)*hk.quantity;
    }
  }
  var hpEl=document.getElementById('stHoldPnl');
  hpEl.textContent=(hpTotal>=0?'+':'')+hpTotal.toFixed(2);
  hpEl.style.color=hpTotal>=0?'#e74c3c':'#27ae60';
}

// ===== 抓取持仓实时价格（腾讯财经API）=====
function fetchStockPrices(){
  var codes = [];
  for(var i=0;i<holdings.length;i++){
    var c = (holdings[i].code||'').padStart(6,'0');
    if(!c) continue;
    var prefix = c.substring(0,1);
    var market = (prefix==='6')?'sh':'sz';
    codes.push(market + c);
  }
  if(codes.length===0) return;
  var url = 'https://qt.gtimg.cn/q=' + codes.join(',');
  var btn = document.getElementById('btnRefreshPrice');
  if(btn) btn.disabled = true;
  fetch(url).then(function(r){ return r.text(); }).then(function(text){
    // 解析腾讯API返回格式：v_sh600000="名称~开盘~昨收~当前价~最高~最低~...";
    var lines = text.trim().split('\n');
    for(var i=0;i<lines.length;i++){
      var line = lines[i];
      var m = line.match(/^v_([a-z0-9]+)="([^"]*)"/);
      if(!m) continue;
      var key = m[1]; // sh600000
      var parts = m[2].split('~');
      var code6 = key.substring(2); // 600000
      // 补齐前导零到6位，和holdings.code对齐
      var padded = code6.padStart(6,'0');
      // parts[3] = 当前价
      var close = parseFloat(parts[3]) || 0;
      currentPrices[padded] = { close: close };
    }
    // 存入localStorage持久化
    try { localStorage.setItem('stock_current_prices', JSON.stringify(currentPrices)); } catch(e){}
    renderHoldings(); // 内部末尾已触发 updateStats() 刷新统计卡片（持仓盈亏）
    if(btn) btn.disabled = false;
  }).catch(function(){
    console.warn('抓取价格失败');
    if(btn) btn.disabled = false;
  });
}

// 从localStorage恢复缓存价格并渲染
function loadCachedPrices(){
  try {
    var cached = localStorage.getItem('stock_current_prices');
    if(cached){ currentPrices = JSON.parse(cached) || {}; }
  } catch(e){ currentPrices = {}; }
}

// 交易日15:01自动刷新价格
(function(){
  var _lp = 0;
  setInterval(function(){
    var now = new Date();
    var h = now.getHours(), m = now.getMinutes();
    // 工作日(1-5) 15:01~15:05 触发一次
    if(now.getDay()>=1 && now.getDay()<=5 && h===15 && m>=1 && m<=5){
      var ymd = now.getFullYear()*10000+(now.getMonth()+1)*100+now.getDate();
      if(_lp!==ymd){ _lp=ymd; fetchStockPrices(); }
    }
  }, 30000); // 每30秒检查一次
})();

// 页面加载：先恢复缓存价格并渲染，然后自动刷新价格
loadCachedPrices();
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', function(){ renderHoldings(); fetchStockPrices(); });
} else {
  renderHoldings();
  fetchStockPrices();
}

function renderAnalysis(){
  fetchMarginChartData();
  renderTrendChart();
  renderCatStats();
  renderStockSummary();
  renderPeriodTable();
}

// 趋势图过滤模式（默认全部）
var trendRangeMode = 'all';
var trendDateStart = '';
var trendDateEnd = '';

function onTrendRangeChange(){
  var mode = document.getElementById('trendRangeMode').value;
  trendRangeMode = mode;
  var customInputs = document.getElementById('trendCustomInputs');
  if(mode === 'custom'){
    customInputs.style.display = '';
    // 默认设置为数据范围内的首尾
    var closedTrades = trades.filter(function(t){ return !isPnlExcluded(t); });
    if(closedTrades.length > 0){
      var sorted = closedTrades.slice().sort(function(a,b){ return new Date(a.date)-new Date(b.date); });
      var startEl = document.getElementById('trendDateStart');
      var endEl = document.getElementById('trendDateEnd');
      if(!startEl.value) startEl.value = sorted[0].date;
      if(!endEl.value) endEl.value = sorted[sorted.length-1].date;
      trendDateStart = startEl.value;
      trendDateEnd = endEl.value;
    }
    renderTrendChart();
  } else {
    customInputs.style.display = 'none';
    renderTrendChart();
  }
}

function onTrendDateChange(){
  trendDateStart = document.getElementById('trendDateStart').value;
  trendDateEnd = document.getElementById('trendDateEnd').value;
  if(trendDateStart && trendDateEnd) renderTrendChart();
}

// 趋势图（排除做T记录与部分清仓）
function renderTrendChart(){
  var closedTrades = trades.filter(function(t){ return !isPnlExcluded(t); });
  var sorted=closedTrades.slice().sort(function(a,b){ return new Date(a.date)-new Date(b.date); });

  // 自定义时间范围过滤
  if(trendRangeMode === 'custom' && trendDateStart && trendDateEnd){
    sorted = sorted.filter(function(t){
      return t.date >= trendDateStart && t.date <= trendDateEnd;
    });
  }

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
          ticks:{
            callback:function(v){
              var isMilestone = v>0 && v%10000===0;
              var prefix = isMilestone ? '🏆 ¥' : '¥';
              return prefix+v;
            },
            color:function(ctx){
              var v=ctx.tick&&ctx.tick.value;
              return (v>0 && v%10000===0) ? '#e74c3c' : '#666';
            },
            font:function(ctx){
              var v=ctx.tick&&ctx.tick.value;
              return (v>0 && v%10000===0) ? {weight:'bold',size:12} : {size:11};
            }
          },
          grid:{
            color:function(ctx){
              if(ctx.tick && ctx.tick.value>0 && ctx.tick.value%10000===0) return '#e74c3c';
              return '#e0e0e0';
            },
            lineWidth:function(ctx){
              if(ctx.tick && ctx.tick.value>0 && ctx.tick.value%10000===0) return 2;
              return 1;
            }
          }
        },
        x:{
          ticks:{ maxRotation:45, font:{size:10} }
        }
      }
    }
  });
}

// 融资余额刷新按钮
function setupMarginRefreshBtn() {
  var btn = document.getElementById('refreshMarginBtn');
  var status = document.getElementById('refreshMarginStatus');
  if (!btn) return;

  btn.addEventListener('click', function() {
    var api = API_URL;

    btn.disabled = true;
    btn.textContent = '⏳ 更新中...';
    status.style.display = 'none';

    var url = api + '?action=refreshMargin&callback=marginRefreshCb';
    var script = document.createElement('script');
    script.src = url;
    script.onerror = function() {
      btn.disabled = false;
      btn.textContent = '🔄 刷新数据';
      status.textContent = '❌ 网络错误';
      status.style.color = '#e74c3c';
      status.style.display = 'inline';
      document.body.removeChild(script);
    };
    window.marginRefreshCb = function(res) {
      delete window.marginRefreshCb;
      document.body.removeChild(script);
      btn.disabled = false;
      btn.textContent = '🔄 刷新数据';

      if (res && res.success) {
        if (res.added > 0) {
          status.textContent = '✅ 新增 ' + res.added + ' 条，最新 ' + res.date + ' = ' + res.balance + '亿元';
        } else {
          status.textContent = '✅ 已是最新：' + res.date + ' = ' + res.balance + '亿元';
        }
        status.style.color = '#27ae60';
        status.style.display = 'inline';
        // 清除缓存，重新拉取图表
        localStorage.removeItem('margin_cache');
        fetchMarginChartData();
      } else {
        status.textContent = '❌ ' + ((res && res.error) || '未知错误');
        status.style.color = '#e74c3c';
        status.style.display = 'inline';
      }
    };
    document.body.appendChild(script);
  });
}

// 融资余额趋势图（双Y轴：左=融资余额 亿，右=上证指数）
function fetchMarginChartData() {
  var api = API_URL;
  if (!api) return;

  // 先用缓存数据瞬间渲染
  var cacheKey = 'margin_cache';
  var cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      var cacheData = JSON.parse(cached);
      if (cacheData && cacheData.length) {
        renderMarginChart(cacheData);
      }
    } catch(e) {}
  }

  // 再拉取最新数据（后台更新）
  var url = api + '?action=marginData&callback=marginCb';
  var script = document.createElement('script');
  script.src = url;
  script.onerror = function() { console.warn('融资余额数据加载失败'); };
  window.marginCb = function(res) {
    delete window.marginCb;
    document.body.removeChild(script);
    if (res && res.success && res.data) {
      // 与缓存比较，有变化才更新
      var fresh = JSON.stringify(res.data);
      if (fresh !== cached) {
        localStorage.setItem(cacheKey, fresh);
        renderMarginChart(res.data);
      }
    }
  };
  document.body.appendChild(script);
}

function renderMarginChart(data) {
  if (!data || data.length === 0) return;

  var labels = [];
  var marginData = [];

  // 只展示最近365天（滚动一年窗口，截止到昨天收盘）
  var today = new Date();
  var yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  var endDate = yesterday.toISOString().slice(0, 10);
  var oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  var cutoff = oneYearAgo.toISOString().slice(0, 10);

  for (var i = 0; i < data.length; i++) {
    if (data[i].date < cutoff || data[i].date > endDate) continue;
    labels.push(data[i].date);
    marginData.push(data[i].balance);
  }

  var ctx = document.getElementById('marginChart');
  if (!ctx) return;
  ctx = ctx.getContext('2d');
  if (marginChart) marginChart.destroy();

  marginChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '融资余额（亿元）',
        data: marginData,
        borderColor: '#e74c3c',
        backgroundColor: 'rgba(231,76,60,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#e74c3c',
        yAxisID: 'y',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ctx.dataset.label + '：' + ctx.raw + '亿元';
            }
          }
        }
      },
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: '融资余额（亿元）', font: {size:11} },
          ticks: {
            font: {size:10}
          },
          grid: { color: '#e8e8e8' }
        },
        x: {
          ticks: { maxRotation: 45, font: {size:9}, autoSkip: true, maxTicksLimit: 20 }
        }
      }
    },
    plugins: [{
      id: 'line30000',
      afterDraw: function(chart) {
        var yScale = chart.scales['y'];
        var yPixel = yScale.getPixelForValue(30000);
        if (yPixel < chart.chartArea.top || yPixel > chart.chartArea.bottom) return;
        var ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.moveTo(chart.chartArea.left, yPixel);
        ctx.lineTo(chart.chartArea.right, yPixel);
        ctx.stroke();
        ctx.restore();
      }
    }]
  });
}


// 分类统计（排除做T记录）
function renderCatStats(){
  var cats={};
  for(var i=0;i<trades.length;i++){
    if(isPnlExcluded(trades[i])) continue; // 跳过做T与部分清仓
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

    // 部分清仓：和做T一样不计入任何统计（盈亏已通过冲减成本价体现在剩余持仓），仅保留在交易记录列表
    if(isPartialClearTrade(trades[i])){
      continue;
    }

    // 普通完结记录（全部清仓/手动添加）：参与盈亏计算
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
  html+='<tr style="background:#c9d4df;font-weight:bold">';
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
    if(isPnlExcluded(trades[i])) continue; // 跳过做T与部分清仓
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
// ===== 持仓代码联想（带防抖）=====
var _onHoldCodeInputTimer = null;
function onHoldCodeInput() {
  if (_onHoldCodeInputTimer) clearTimeout(_onHoldCodeInputTimer);
  _onHoldCodeInputTimer = setTimeout(_doHoldCodeInput, 150);
}
function _doHoldCodeInput() {
  var input = document.getElementById('holdCode');
  var val = input.value.trim().toLowerCase();
  var list = document.getElementById('holdAcList');

  if (!val || typeof STOCK_DICT === 'undefined') {
    list.classList.remove('show');
    holdAcResults = [];
    holdAcSelectedIndex = -1;
    return;
  }

  holdAcResults = searchStockDict(val, 30);

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
    // 补仓：记录最近一次补仓日期和数量（用于可用数量计算）
    if(holdings[existingIdx].lastAddDate === date){
      holdings[existingIdx].lastAddQty = (holdings[existingIdx].lastAddQty||0) + quantity;
    } else {
      holdings[existingIdx].lastAddDate = date;
      holdings[existingIdx].lastAddQty = quantity;
    }
    if(note) holdings[existingIdx].note = (holdings[existingIdx].note ? holdings[existingIdx].note+'; ' : '') + note;
    refreshUI();
    fetchStockPrices();
    showStatus('ok','✅ 补仓成功：' + getStockName(code) + ' ' + oldQty + '→'+newQty + '股，成本价更新为' + newBP.toFixed(3) + '元');

    // 后台同步：批量更新 quantity、buyPrice、lastAddDate、lastAddQty（原子操作，杜绝竞态）
    apiCall({action:'updateHoldingBatch',id:old.id,
      fields:'quantity,buyPrice,lastAddDate,lastAddQty',
      values:newQty+','+newBP+','+date+','+holdings[existingIdx].lastAddQty,
      addPrice:rawPrice,addDate:date,addQty:quantity}, function(r){
      if(r&&r.success){
        try{ localStorage.setItem('stock_holdings_cache', JSON.stringify(holdings)); }catch(e){}
        _checkSyncStatus();
      }else{rollbackOptimistic(trades,savedHoldings,'❌ 补仓失败：'+(r?r.error:''));}
    });
  } else {
    // ===== 新持仓 =====
    var tmpId = genTempId();
    var savedHoldings = JSON.parse(JSON.stringify(holdings));
    holdings.push({id:tmpId, date:date, code:code, tag:tag, quantity:quantity, note:note, buyPrice:buyPrice, accountType:selectedAccountType, lastAddDate:date, lastAddQty:quantity});
    refreshUI();
    fetchStockPrices();
    showStatus('ok','✅ 持仓已添加（成本价含买入手续费' + buyFees.total.toFixed(2) + '元）');

    apiCall({action:'addHolding',date:date,code:code,tag:tag,quantity:quantity,note:note,buyPrice:buyPrice,accountType:selectedAccountType,lastAddDate:date,lastAddQty:quantity}, function(res){
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
  trades.push({id:tmpTradeId, date:date, code:code, tag:tag, quantity:qty, amount:amount, note:finalNote, tIndex:0, status:'closed', source:'clear', fees:feesTotal, isPartial:0});
  
  // 按日期排序
  trades.sort(function(a,b){ var dd=new Date(b.date)-new Date(a.date); if(dd!==0) return dd; return b.id.localeCompare(a.id); });
  
  closeAddComplete();
  cacheData(trades);
  refreshUI();
  showStatus('ok','✅ 已补录「'+getStockName(code)+'」清仓，盈亏'+amount.toFixed(2)+'元');
  
  // 后台同步
  apiCall({action:'add',date:date,code:code,tag:tag,quantity:qty,amount:amount,note:finalNote,tIndex:0,status:'closed',source:'clear',fees:feesTotal,isPartial:0}, function(res){
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

  // ===== 不等量做T：差价法计算展示盈亏，现金流法提示成本冲减 =====
  if(selectedDoTPos === 'unequal'){
    var uSellQty = parseInt(document.getElementById('doTSellQty').value) || 0;
    var uBuyQty = parseInt(document.getElementById('doTBuyQty').value) || 0;

    // 更新数量显示
    updateQtyDisplay(document.getElementById('doTQtyDisplay'), 'unequal', 0, 'doTPosGroup');

    if(uSellQty <= 0 || uBuyQty <= 0) return; // 数量未填完，不计算

    var uAccType = holding ? (holding.accountType || 'normal') : 'normal';
    var uStockCode = holding ? holding.code : '';

    // 确定实际卖出价/买入价和数量（区分正T/反T）
    var uSellPrice, uBuyPrice, uSellQtyActual, uBuyQtyActual;
    if(doTReversed){
      // 正T：doTSellPrice=买入价，doTBuyBackPrice=卖出价
      uBuyPrice = sellPrice;
      uSellPrice = buyBackPrice;
      uBuyQtyActual = uSellQty;  // doTSellQty输入框对应买入
      uSellQtyActual = uBuyQty;  // doTBuyQty输入框对应卖出
    } else {
      // 反T：doTSellPrice=卖出价，doTBuyBackPrice=买回价
      uSellPrice = sellPrice;
      uBuyPrice = buyBackPrice;
      uSellQtyActual = uSellQty;
      uBuyQtyActual = uBuyQty;
    }

    // 差价法（展示用）：等量部分 × 价差
    var equalQty = Math.min(uSellQtyActual, uBuyQtyActual);
    var priceDiff = uSellPrice - uBuyPrice; // 正=盈利
    var displayProfit = priceDiff * equalQty;

    // 手续费（按实际卖出/买入数量分别计算）
    var uSellFees = calcFees(uSellPrice, uSellQtyActual, true, uAccType, uStockCode);
    var uBuyFees = calcFees(uBuyPrice, uBuyQtyActual, false, uAccType, uStockCode);
    displayProfit = displayProfit - uSellFees.total - uBuyFees.total;
    displayProfit = Math.round(displayProfit * 100) / 100;

    document.getElementById('doTAmount').value = displayProfit;
    document.getElementById('doTAutoCalcHint').style.display = 'block';

    var uTotalFees = Math.round((uSellFees.total + uBuyFees.total) * 100) / 100;
    var uTip = '✅ <b>不等量做T（差价法展示）</b>';
    uTip += '<br>等量部分：' + equalQty + '股 × 价差' + (priceDiff >= 0 ? '+' : '') + priceDiff.toFixed(3) + ' = ' + Math.round(priceDiff * equalQty * 100) / 100 + '元';
    if(uTotalFees > 0){
      uTip += '<br>手续费：卖出' + uSellFees.total.toFixed(2) + ' + 买入' + uBuyFees.total.toFixed(2) + ' = ' + uTotalFees.toFixed(2) + '元';
    }
    uTip += '<br>💰 成本冲减用现金流法：' + uSellPrice + '×' + uSellQtyActual + ' - ' + uBuyPrice + '×' + uBuyQtyActual + ' - ' + uTotalFees + ' = <b style="color:#e67e22">' + (Math.round((uSellPrice * uSellQtyActual - uBuyPrice * uBuyQtyActual - uTotalFees) * 100) / 100) + '元</b>';
    document.getElementById('doTAutoCalcHint').innerHTML = uTip;
    return;
  }

  // ===== 等量做T：原有逻辑 =====
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
  } else if(posType === 'unequal'){
    // 不等量做T：读取卖出/买入数量
    var sellQty = parseInt(document.getElementById('doTSellQty').value) || 0;
    var buyQty = parseInt(document.getElementById('doTBuyQty').value) || 0;
    if(sellQty > 0 || buyQty > 0){
      var newQty = totalQty - sellQty + buyQty;
      displayEl.textContent = '卖出' + sellQty + '股 / 买入' + buyQty + '股 → 新持仓' + newQty + '股（原' + totalQty + '股）';
    } else {
      displayEl.textContent = '请输入卖出/买入数量（当前持仓' + totalQty + '股）';
    }
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
  // 部分清仓的「部分清仓+数量」由 GAS clearHolding 统一追加（前端不重复加，避免 duplicate 如「部分清仓[两融] 部分清仓500/1000股」）
  // 清仓备注末尾加账户标记，用于显示账户徽章
  var clearAccLabel = (accType === 'margin') ? '两融' : '正常';
  finalNote += '['+clearAccLabel+']';
  trades.push({id:tmpTradeId, date:todayStr, code:holding.code, tag:holding.tag, quantity:actualQty, amount:amount, note:finalNote, tIndex:0, status:'closed', source:'clear', fees:feesTotal, isPartial:isPartial?1:0});

  if(isPartial){
    // 部分清仓：减少持仓数量 + 现金流法冲减成本价（与做T冲减口径一致，避免前后端不一致）
    for(var i=0;i<holdings.length;i++){
      if(String(holdings[i].id)===String(id)){
        var remainQty = holdings[i].quantity - actualQty;
        var oldTotalCost = holdings[i].buyPrice * holdings[i].quantity;
        // 现金流法：新总成本 = 原总成本 - (卖出所得 - 卖出手续费)
        var cashFlowProfit = sellPrice * actualQty - feesTotal;
        var newTotalCost = oldTotalCost - cashFlowProfit;
        if(newTotalCost < 0) newTotalCost = 0;
        var newBuyPrice = remainQty > 0 ? (newTotalCost / remainQty) : 0;
        if(newBuyPrice < 0) newBuyPrice = 0;
        holdings[i].buyPrice = Math.round(newBuyPrice * 1000) / 1000;
        holdings[i].quantity = remainQty;
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
  apiCall({action:'clearHolding',id:id,amount:amount,note:finalNote,quantity:actualQty,isPartial:isPartial?1:0,fees:feesTotal,sellPrice:sellPrice}, function(res){
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
  // 重置不等量输入区
  var unequalArea = document.getElementById('doTUnequalArea');
  if(unequalArea) unequalArea.style.display = 'none';
  var doTSellQtyInput = document.getElementById('doTSellQty');
  var doTBuyQtyInput = document.getElementById('doTBuyQty');
  if(doTSellQtyInput) doTSellQtyInput.value = '';
  if(doTBuyQtyInput) doTBuyQtyInput.value = '';
  updateQtyDisplay(document.getElementById('doTQtyDisplay'), 'full', 0, 'doTPosGroup');

  // 自动检测该持仓已做T次数（按code+账户类型+建仓日期分开计数）
  // 只统计建仓日期（h.date）之后的做T记录，清仓后再买入应从T1重新开始
  var accLabel = (h.accountType || 'normal') === 'margin' ? '两融' : '正常';
  var maxT = 0;
  for(var i=0;i<trades.length;i++){
    if(trades[i].code === h.code && trades[i].tIndex > 0 && trades[i].source === 'doT'){
      // 持仓有建仓日期时，只统计建仓日之后的做T记录（清仓后再买入不继承上一轮的T序号）
      if(h.date && trades[i].date < h.date) continue;
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
  // 不等量做T时，同步交换卖出/买入数量的label和value
  var sellQtyEl = document.getElementById('doTSellQty');
  var buyQtyEl = document.getElementById('doTBuyQty');
  if(sellQtyEl && buyQtyEl && selectedDoTPos === 'unequal'){
    var sellLabel = sellQtyEl.previousElementSibling;
    var buyLabel = buyQtyEl.previousElementSibling;
    if(sellLabel && buyLabel){
      var tmpLabel = sellLabel.textContent;
      sellLabel.textContent = buyLabel.textContent;
      buyLabel.textContent = tmpLabel;
    }
    var tmpVal = sellQtyEl.value;
    sellQtyEl.value = buyQtyEl.value;
    buyQtyEl.value = tmpVal;
  }
  autoCalcDoTProfit();
}
function closeDoT(){ document.getElementById('doTModal').classList.remove('active'); pendingDoTId=''; }

function submitDoT(){
  var amount=parseFloat(document.getElementById('doTAmount').value);
  var note=document.getElementById('doTNote').value.trim();
  if(isNaN(amount)){ alert('请填写做T盈亏金额！'); return; }

  var id = pendingDoTId;

  var holding = null;
  for(var i=0;i<holdings.length;i++){
    if(String(holdings[i].id)===String(id)){ holding=holdings[i]; break; }
  }
  if(!holding) return;

  var accType = holding.accountType || 'normal';
  var accLabel = accType === 'margin' ? '两融' : '正常';
  var inputSellPrice = parseFloat(document.getElementById('doTSellPrice').value) || 0;
  var inputBuyBackPrice = parseFloat(document.getElementById('doTBuyBackPrice').value) || 0;

  // ===== 不等量做T：差价法展示 + 现金流法冲减成本 =====
  if(selectedDoTPos === 'unequal'){
    var uSellQty = parseInt(document.getElementById('doTSellQty').value) || 0;
    var uBuyQty = parseInt(document.getElementById('doTBuyQty').value) || 0;
    if(uSellQty <= 0){ alert('请填写卖出数量！'); return; }
    if(uBuyQty <= 0){ alert('请填写买入数量！'); return; }
    if(uSellQty > holding.quantity){ alert('卖出数量不能超过持仓数量（'+holding.quantity+'股）！'); return; }

    // 确定实际卖出/买入的价格和数量（区分正T/反T）
    var uSellPriceActual, uBuyPriceActual, uSellQtyActual, uBuyQtyActual;
    if(doTReversed){
      // 正T：doTSellPrice=买入价，doTBuyBackPrice=卖出价
      uBuyPriceActual = inputSellPrice;
      uSellPriceActual = inputBuyBackPrice;
      uBuyQtyActual = uSellQty;  // doTSellQty输入框对应买入
      uSellQtyActual = uBuyQty;  // doTBuyQty输入框对应卖出
    } else {
      // 反T：doTSellPrice=卖出价，doTBuyBackPrice=买回价
      uSellPriceActual = inputSellPrice;
      uBuyPriceActual = inputBuyBackPrice;
      uSellQtyActual = uSellQty;
      uBuyQtyActual = uBuyQty;
    }

    // 手续费（按实际卖出/买入数量分别计算）
    var uSellFees = calcFees(uSellPriceActual, uSellQtyActual, true, accType, holding.code);
    var uBuyFees = calcFees(uBuyPriceActual, uBuyQtyActual, false, accType, holding.code);
    var uDoTFees = Math.round((uSellFees.total + uBuyFees.total) * 100) / 100;

    // 现金流法盈亏（用于成本冲减，前端不展示这个数）
    var cashFlowProfit = uSellPriceActual * uSellQtyActual - uBuyPriceActual * uBuyQtyActual - uDoTFees;
    cashFlowProfit = Math.round(cashFlowProfit * 100) / 100;

    // 构建备注：不等量做T格式
    var uAbsAmt = Math.abs(amount).toFixed(2);
    var uDoTNote = 'T'+selectedTIndex+' ' + (amount >= 0 ? '盈利'+uAbsAmt+'元' : '亏损'+uAbsAmt+'元') + '，不等量T';
    if(note) uDoTNote += '（' + note + '）';
    // 备注末尾加账户标记，用于显示账户徽章
    uDoTNote += '['+accLabel+']';

    // 乐观更新
    var uSavedTrades = JSON.parse(JSON.stringify(trades));
    var uSavedHoldings = JSON.parse(JSON.stringify(holdings));

    var uTmpTradeId = genTempId();
    var uToday = new Date();
    var uTodayStr = uToday.getFullYear() + '-' + String(uToday.getMonth() + 1).padStart(2, '0') + '-' + String(uToday.getDate()).padStart(2, '0');
    // 交易记录：amount=差价法展示盈亏，quantity=卖出量，fees=实际总手续费
    trades.push({id:uTmpTradeId, date:uTodayStr, code:holding.code, tag:holding.tag, quantity:uSellQtyActual, amount:amount, note:uDoTNote, tIndex:selectedTIndex, status:'open', source:'doT', fees:uDoTFees});

    // 乐观更新：持仓量 + 成本价（现金流法冲减）
    var uNewQty = holding.quantity - uSellQtyActual + uBuyQtyActual;
    if(holding.buyPrice > 0 && uNewQty > 0){
      var uTotalCost = holding.buyPrice * holding.quantity;
      var uNewTotalCost = uTotalCost - cashFlowProfit;
      if(uNewTotalCost < 0) uNewTotalCost = 0;
      var uNewBuyPrice = uNewTotalCost / uNewQty;
      if(uNewBuyPrice < 0) uNewBuyPrice = 0;
      holding.buyPrice = Math.round(uNewBuyPrice * 1000) / 1000;
    }
    holding.quantity = uNewQty;

    closeDoT();
    refreshUI();
    showStatus('ok','✅ 不等量做T'+selectedTIndex+'已记录（卖'+uSellQtyActual+'买'+uBuyQtyActual+'，展示盈亏'+amount+'元）');

    // 后台同步：传sellQty/buyQty/sellPrice/buyPrice，后端用现金流法冲减
    apiCall({action:'doT',id:id,amount:amount,note:uDoTNote,tIndex:selectedTIndex,quantity:uSellQtyActual,fees:uDoTFees,
             sellQty:uSellQtyActual,buyQty:uBuyQtyActual,sellPrice:uSellPriceActual,buyPrice:uBuyPriceActual}, function(res){
      if(res&&res.success){
        if(res.tradeId){
          for(var j=0;j<trades.length;j++){
            if(trades[j].id===uTmpTradeId){ trades[j].id=res.tradeId; break; }
          }
          cacheData(trades);
        }
        // 后端返回新的成本价和持仓量，同步到前端
        for(var k=0;k<holdings.length;k++){
          if(String(holdings[k].id)===String(id)){
            if(res.newBuyPrice !== undefined) holdings[k].buyPrice = res.newBuyPrice;
            if(res.newQuantity !== undefined) holdings[k].quantity = res.newQuantity;
            break;
          }
        }
        try{ localStorage.setItem('stock_holdings_cache', JSON.stringify(holdings)); }catch(e){}
        refreshUI();
        _checkSyncStatus();
      } else {
        rollbackOptimistic(uSavedTrades, uSavedHoldings, '❌ 做T记录失败：'+(res?res.error:''));
      }
    });
    return;
  }

  // ===== 等量做T：原有逻辑 =====
  // 计算实际做T数量
  var customQty = parseInt(document.getElementById('doTCustomQty').value) || 0;
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
  doTNote += '['+accLabel+']';

  // 计算做T手续费（卖出+买回）
  var sellPrice = inputSellPrice;
  var buyBackPrice = inputBuyBackPrice;
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

  // 后台同步（等量做T：buyQty=quantity）
  apiCall({action:'doT',id:id,amount:amount,note:doTNote,tIndex:selectedTIndex,quantity:actualQty,buyQty:actualQty,fees:doTFees}, function(res){
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
      editAcResults=searchStockDict(v,15);
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
  var totalPnl = 0;
  var hasAnyPnl = false;
  var seq = 0;

  // 按建仓月份分组（YYYY-MM） —— 独立命名空间 hold-，不与交易记录冲突
  var groups = [];
  var curMonth = '';
  for(var i=0;i<filtered.length;i++){
    var h0 = filtered[i];
    var m0 = h0.date.substring(0,7);
    if(m0 !== curMonth){
      curMonth = m0;
      groups.push({ month: m0, label: m0.replace('-','年')+'月', holdings: [] });
    }
    groups[groups.length-1].holdings.push(h0);
  }

  for(var gi=0;gi<groups.length;gi++){
    var g = groups[gi];
    var gOpen = gi === 0;
    var rowStyle = gOpen ? '' : ' style="display:none"';
    var gProfit = 0;
    var gHtml = '';
    var gCount = g.holdings.length;

    var dayGroups = [];
    var curDay = '';
    for(var k=0;k<g.holdings.length;k++){
      var hh = g.holdings[k];
      if(hh.date !== curDay){
        curDay = hh.date;
        dayGroups.push({ day: hh.date, label: hh.date.substring(5).replace('-','月')+'日', holdings: [], profit: 0 });
      }
      dayGroups[dayGroups.length-1].holdings.push(hh);
    }

    for(var di=0;di<dayGroups.length;di++){
      var dg = dayGroups[di];
      var dgProfit = 0;
      var dgHtml = '';
      seq = 0;

      for(var j=0;j<dg.holdings.length;j++){
        seq++;
        var h=dg.holdings[j];
        var tagClass=h.tag==='创业板'?'tag-gem':h.tag==='科创板'?'tag-star':'tag-main';
        var stockName=escapeHtml(getStockName(h.code))||'-';
        var buyPriceShow = h.buyPrice ? (parseFloat(h.buyPrice).toFixed(3)) : '-';
        var totalQty = h.quantity || 0;
        var todayBuyQty = 0;
        if(h.date === today){
          todayBuyQty = totalQty;
        } else if(h.lastAddDate === today){
          todayBuyQty = (h.lastAddQty || 0);
        }
        var todayDoTQty = 0;
        for(var j2=0;j2<trades.length;j2++){
          var tr=trades[j2];
          if(tr.code===h.code && tr.source==='doT' && tr.status==='open' && tr.date===today){
            todayDoTQty += (tr.buyQty || tr.quantity || 0);
          }
        }
        var availableQty = Math.max(0, totalQty - todayBuyQty - todayDoTQty);
        var availColor = availableQty === 0 ? '#e74c3c' : (availableQty < totalQty ? '#e67e22' : '#27ae60');
        var availShow = '<span style="color:'+availColor+';font-weight:600">'+availableQty+'</span><span style="color:#666">/'+totalQty+'</span>';

        var paddedCode = (h.code||'').padStart(6,'0');
        var cp = currentPrices[paddedCode];
        var priceShow = (cp && cp.close > 0) ? parseFloat(cp.close).toFixed(3) : '-';
        var pnl = '';
        var pnlVal = 0;
        if(cp && cp.close > 0 && h.buyPrice > 0 && h.quantity > 0){
          pnlVal = (cp.close - h.buyPrice) * h.quantity;
          totalPnl += pnlVal;
          gProfit += pnlVal;
          dgProfit += pnlVal;
          hasAnyPnl = true;
          var pnlCls = pnlVal >= 0 ? 'red' : 'green';
          var pnlSign = pnlVal >= 0 ? '+' : '';
          pnl = '<span class="'+pnlCls+'" style="font-weight:600">'+pnlSign+pnlVal.toFixed(2)+'</span>';
        } else {
          pnl = '-';
        }

        // 止损告警灯（-3%~-5% 黄灯💡，≥-5% 红灯🚨）
        var alertHtml = '';
        if(cp && cp.close > 0 && h.buyPrice > 0 && h.quantity > 0){
          var dropPct = (h.buyPrice - cp.close) / h.buyPrice;
          if(dropPct >= 0.03){
            var alPctTxt = (dropPct*100).toFixed(1);
            var alIcon = dropPct >= 0.05 ? '🚨' : '💡';
            var alCls = dropPct >= 0.05 ? 'alert-red' : 'alert-yellow';
            var alTip = '已跌 -'+alPctTxt+'%（成本价 '+parseFloat(h.buyPrice).toFixed(2)+'，现价 '+parseFloat(cp.close).toFixed(2)+'）';
            alertHtml = '<span class="alert-light '+alCls+'" title="'+alTip+'">'+alIcon+'</span>';
          }
        }

        var rowHtml='';
        rowHtml+='<tr class="hold-month-row-'+g.month+' hold-day-row-'+dg.day+'"'+rowStyle+'>';
        rowHtml+='<td>'+seq+'</td>';
        rowHtml+='<td class="editable" data-id="'+h.id+'" data-field="date">'+formatDate(h.date)+'</td>';
        rowHtml+='<td style="cursor:pointer" onclick="toggleHoldingDetail(this,\''+h.id+'\',\''+(h.code||'')+'\')"><span class="hold-toggle" id="hold-toggle-'+h.id+'" style="display:none;font-size:10px;margin-right:4px;color:#7f8c8d">▸</span>'+stockName+'</td>';
        rowHtml+='<td class="editable" data-id="'+h.id+'" data-field="tag"><span class="tag '+tagClass+'">'+(h.tag||'主板')+'</span></td>';
        rowHtml+='<td class="editable" data-id="'+h.id+'" data-field="quantity">'+h.quantity+'股</td>';
        rowHtml+='<td class="editable" data-id="'+h.id+'" data-field="buyPrice">'+buyPriceShow+'<div class="tooltip-box">'+getBuyPriceTip(h)+'</div></td>';
        rowHtml+='<td>'+availShow+'</td>';
        rowHtml+='<td>'+priceShow+'</td>';
        rowHtml+='<td>'+pnl+'</td>';
        rowHtml+='<td class="alert-cell">'+alertHtml+'</td>';
        // 持仓时长（从建仓日期算起）
        var holdDays = Math.floor((new Date(today) - new Date(h.date)) / 86400000);
        rowHtml+='<td style="color:#7f8c8d;font-size:12px">'+holdDays+'天</td>';
        rowHtml+='<td style="text-align:right">';
        rowHtml+='<button class="op-btn btn-clear" data-id="'+h.id+'" data-action="clearHolding">清仓</button>';
        rowHtml+='<button class="op-btn btn-dot" data-id="'+h.id+'" data-action="doT">做T</button>';
        rowHtml+='<button class="op-btn btn-add-more" data-id="'+h.id+'" data-action="addMore">补仓</button>';
        rowHtml+='<button class="op-btn btn-del-h" data-id="'+h.id+'" data-action="deleteHolding">删除</button>';
        rowHtml+='</td>';
        rowHtml+='</tr>';
        // 建仓/补仓明细展开行
        rowHtml+='<tr class="hold-detail-row hold-month-row-'+g.month+' hold-day-row-'+dg.day+'" id="hold-detail-'+h.id+'" data-loaded="0" style="display:none"><td colspan="12"><div class="hold-detail-content" style="padding:8px 16px;font-size:12px;color:#7f8c8d;text-align:center">点击股票名称旁的 ▸ 展开明细</div></td></tr>';
        dgHtml += rowHtml;

        cardHtml+='<div class="hold-card-item hold-month-row-'+g.month+' hold-day-row-'+dg.day+'"'+rowStyle+'>';
        cardHtml+='<div class="hold-card-header">';
        cardHtml+='<span class="hold-card-name">'+stockName+'</span>';
        cardHtml+='<span class="tag '+tagClass+'">'+(h.tag||'主板')+'</span>';
        cardHtml+='</div>';
        cardHtml+='<div class="hold-card-row"><span class="label">买入日期</span><span class="editable" data-id="'+h.id+'" data-field="date">'+formatDate(h.date)+'</span></div>';
        cardHtml+='<div class="hold-card-row"><span class="label">持有数量</span><span class="editable" data-id="'+h.id+'" data-field="quantity">'+h.quantity+'股</span></div>';
        cardHtml+='<div class="hold-card-row"><span class="label">成本价</span><span class="editable" data-id="'+h.id+'" data-field="buyPrice">'+buyPriceShow+'<div class="tooltip-box">'+getBuyPriceTip(h)+'</div></span></div>';
        cardHtml+='<div class="hold-card-row"><span class="label">可用/持仓</span><span>'+availShow+'</span></div>';
        var mCp = currentPrices[paddedCode];
        var mPriceShow = (mCp && mCp.close > 0) ? parseFloat(mCp.close).toFixed(3) : '-';
        var mPnlHtml = '-';
        if(mCp && mCp.close > 0 && h.buyPrice > 0 && h.quantity > 0){
          var mPnlVal = (mCp.close - h.buyPrice) * h.quantity;
          var mCls = mPnlVal >= 0 ? 'red' : 'green';
          var mSign = mPnlVal >= 0 ? '+' : '';
          mPnlHtml = '<span class="'+mCls+'" style="font-weight:600">'+mSign+mPnlVal.toFixed(2)+'</span>';
        }
        var priceCls = (mCp && mCp.close > 0 && h.buyPrice > 0 && mCp.close > h.buyPrice) ? 'red' : 'green';
        var priceHtml = mPriceShow!=='-' ? '<span class="'+priceCls+'">'+mPriceShow+'</span>' : '-';
        cardHtml+='<div class="hold-card-row"><span class="label">收盘价</span><span>'+priceHtml+'</span></div>';
        cardHtml+='<div class="hold-card-row"><span class="label">当前盈亏</span><span>'+mPnlHtml+'</span></div>';
        cardHtml+='<div class="hold-card-footer">';
        cardHtml+='<button class="op-btn btn-clear" data-id="'+h.id+'" data-action="clearHolding" style="background:#e67e22;color:white">清仓</button>';
        cardHtml+='<button class="op-btn btn-dot" data-id="'+h.id+'" data-action="doT" style="background:#8e44ad;color:white">做T</button>';
        cardHtml+='<button class="op-btn btn-add-more" data-id="'+h.id+'" data-action="addMore" style="background:#27ae60;color:white">补仓</button>';
        cardHtml+='<button class="op-btn btn-del-h" data-id="'+h.id+'" data-action="deleteHolding" style="background:#e74c3c;color:white">删除</button>';
        cardHtml+='</div>';
        cardHtml+='</div>';
      }

      var dgCls = dgProfit >= 0 ? 'red' : 'green';
      var dgSign = dgProfit >= 0 ? '+' : '';
      gHtml += '<tr class="hold-day-header hold-month-row-'+g.month+'" data-day="'+dg.day+'" data-month="'+g.month+'"'+rowStyle+' onclick="toggleHoldDay(this)">';
      gHtml += '<td colspan="8" class="hdr-bg-day" style="padding:8px 12px 8px 36px;cursor:pointer;border-bottom:1px solid #ddd;text-align:left">';
      gHtml += '<span class="hold-day-toggle" style="display:inline-block;width:16px;font-size:12px;transition:transform 0.2s;color:#7f8c8d;margin-right:6px">▼</span> ';
      gHtml += '<span style="font-weight:600;font-size:12px;color:#34495e">'+escapeHtml(dg.label)+'</span>';
      gHtml += '<span style="color:#999;font-weight:400;font-size:11px;margin-left:6px">'+dg.holdings.length+'笔</span>';
      if(dgProfit !== 0){
        gHtml += '<span class="'+dgCls+'" style="font-weight:600;font-size:11px;margin-left:10px">'+dgSign+dgProfit.toFixed(2)+'</span>';
      }
      gHtml += '</td>';
      gHtml += '<td class="hdr-bg-day" style="border-bottom:1px solid #ddd"></td>';
      gHtml += '<td class="hdr-bg-day" style="border-bottom:1px solid #ddd"></td>';
      gHtml += '<td class="hdr-bg-day" style="border-bottom:1px solid #ddd"></td>';
      gHtml += '<td class="hdr-bg-day" style="border-bottom:1px solid #ddd"></td>';
      gHtml += '</tr>';
      gHtml += dgHtml;
    }

    var gCls = gProfit >= 0 ? 'red' : 'green';
    var gSign = gProfit >= 0 ? '+' : '';
    html += '<tr class="hold-month-header" data-month="'+g.month+'" onclick="toggleHoldMonth(this)" style="cursor:pointer;background:#c9d4df">';
    html += '<td colspan="8" class="hdr-bg-month" style="padding:10px 12px;text-align:left;font-weight:600;font-size:13px;color:#2c3e50">';
    html += '<span class="hold-month-toggle" style="display:inline-block;width:18px;transition:transform 0.2s">'+(gOpen?'▼':'▶')+'</span> ';
    html += escapeHtml(g.label)+' <span style="color:#888;font-weight:400">'+gCount+'笔</span>';
    html += '</td>';
    html += '<td class="'+gCls+' hdr-bg-month" style="font-weight:600;text-align:center">'+gSign+gProfit.toFixed(2)+'</td>';
    html += '<td class="hdr-bg-month"></td>';
    html += '<td class="hdr-bg-month"></td>';
    html += '<td class="hdr-bg-month"></td>';
    html += '</tr>';
    html += gHtml;
  }

  if(hasAnyPnl){
    var totalCls = totalPnl >= 0 ? 'red' : 'green';
    var totalSign = totalPnl >= 0 ? '+' : '';
    html += '<tr style="background:#c9d4df;font-weight:bold;border-top:2px solid #2c6e49">';
    html += '<td colspan="8" class="hdr-bg-month" style="text-align:right;padding:10px 12px;color:#2c3e50;font-size:14px">综合盈亏：</td>';
    html += '<td class="'+totalCls+' hdr-bg-month" style="font-size:16px;padding:10px 8px">' + totalSign + totalPnl.toFixed(2) + '</td>';
    html += '<td class="hdr-bg-month"></td>';
    html += '<td class="hdr-bg-month"></td>';
    html += '<td class="hdr-bg-month"></td>';
    html += '</tr>';
  }

  if(hasAnyPnl){
    var totalCls2 = totalPnl >= 0 ? 'red' : 'green';
    var totalSign2 = totalPnl >= 0 ? '+' : '';
    cardHtml += '<div class="hold-card-item" style="background:#c9d4df;border:2px solid #2c6e49;margin-top:8px">';
    cardHtml += '<div class="hold-card-header">';
    cardHtml += '<span class="hold-card-name" style="font-size:15px;color:#2c3e50">综合盈亏</span>';
    cardHtml += '<span class="' + totalCls2 + '" style="font-size:18px;font-weight:700">' + totalSign2 + totalPnl.toFixed(2) + '</span>';
    cardHtml += '</div>';
    cardHtml += '</div>';
  }

  tbody.innerHTML=html;
  cardEl.innerHTML=cardHtml;
  restoreHoldCollapseState();
  updateStats(); // 持仓表渲染完（价格已就绪），刷新统计卡片的持仓盈亏
}

function toggleHoldMonth(el){
  var month = el.getAttribute('data-month');
  var rows = document.querySelectorAll('.hold-month-row-'+month+':not(.hold-detail-row)');
  var dayHeaders = document.querySelectorAll('.hold-day-header[data-month="'+month+'"]');
  var toggle = el.querySelector('.hold-month-toggle');
  var isOpen = toggle.textContent === '▼';
  if(isOpen){
    for(var i=0;i<rows.length;i++){ rows[i].style.display = 'none'; }
    for(var i=0;i<dayHeaders.length;i++){ dayHeaders[i].style.display = 'none'; }
  } else {
    for(var i=0;i<rows.length;i++){ rows[i].style.display = ''; }
    for(var i=0;i<dayHeaders.length;i++){ dayHeaders[i].style.display = ''; }
    for(var i=0;i<dayHeaders.length;i++){
      var dt = dayHeaders[i].querySelector('.hold-day-toggle');
      if(dt && dt.textContent === '▶'){
        var d = dayHeaders[i].getAttribute('data-day');
        var dRows = document.querySelectorAll('.hold-day-row-'+d+':not(.hold-detail-row)');
        for(var j=0;j<dRows.length;j++){
          if(!dRows[j].classList.contains('hold-day-header')){ dRows[j].style.display = 'none'; }
        }
      }
    }
  }
  toggle.textContent = isOpen ? '▶' : '▼';
  saveHoldCollapseState();
}

function toggleHoldDay(el){
  var day = el.getAttribute('data-day');
  var rows = document.querySelectorAll('.hold-day-row-'+day);
  var toggle = el.querySelector('.hold-day-toggle');
  var isOpen = toggle.textContent === '▼';
  for(var i=0;i<rows.length;i++){
    if(rows[i].classList.contains('hold-day-header')) continue;
    rows[i].style.display = isOpen ? 'none' : '';
  }
  toggle.textContent = isOpen ? '▶' : '▼';
  saveHoldCollapseState();
}

function saveHoldCollapseState(){
  var monthHeaders = document.querySelectorAll('.hold-month-header');
  var dayHeaders = document.querySelectorAll('.hold-day-header');
  var mState = {};
  var dState = {};
  for(var i=0;i<monthHeaders.length;i++){
    var m = monthHeaders[i].getAttribute('data-month');
    var t = monthHeaders[i].querySelector('.hold-month-toggle');
    if(t) mState[m] = (t.textContent === '▶');
  }
  for(var i=0;i<dayHeaders.length;i++){
    var d = dayHeaders[i].getAttribute('data-day');
    var t = dayHeaders[i].querySelector('.hold-day-toggle');
    if(t) dState[d] = (t.textContent === '▶');
  }
  try{ localStorage.setItem('hold_month_collapse', JSON.stringify(mState)); }catch(e){}
  try{ localStorage.setItem('hold_day_collapse', JSON.stringify(dState)); }catch(e){}
}

function restoreHoldCollapseState(){
  var raw, dRaw;
  try{ raw = localStorage.getItem('hold_month_collapse'); }catch(e){ return; }
  if(!raw) return;
  var mState;
  try{ mState = JSON.parse(raw); }catch(e){ return; }
  try{ dRaw = localStorage.getItem('hold_day_collapse'); }catch(e){}
  var dState = {};
  try{ if(dRaw) dState = JSON.parse(dRaw); }catch(e){}

  var dayHeaders = document.querySelectorAll('.hold-day-header');
  for(var i=0;i<dayHeaders.length;i++){
    var d = dayHeaders[i].getAttribute('data-day');
    var dt = dayHeaders[i].querySelector('.hold-day-toggle');
    if(dt) dt.textContent = (dState[d] === true) ? '▶' : '▼';
  }

  for(var m in mState){
    var header = document.querySelector('.hold-month-header[data-month="'+m+'"]');
    if(!header) continue;
    var toggle = header.querySelector('.hold-month-toggle');
    if(mState[m] === true){
      var rows = document.querySelectorAll('.hold-month-row-'+m+':not(.hold-detail-row)');
      var dh = document.querySelectorAll('.hold-day-header[data-month="'+m+'"]');
      for(var j=0;j<rows.length;j++){ rows[j].style.display = 'none'; }
      for(var k=0;k<dh.length;k++){ dh[k].style.display = 'none'; }
      if(toggle) toggle.textContent = '▶';
    } else {
      var rows = document.querySelectorAll('.hold-month-row-'+m+':not(.hold-detail-row)');
      var dh = document.querySelectorAll('.hold-day-header[data-month="'+m+'"]');
      for(var j=0;j<rows.length;j++){ rows[j].style.display = ''; }
      for(var k=0;k<dh.length;k++){ dh[k].style.display = ''; }
      for(var k=0;k<dh.length;k++){
        var dt = dh[k].querySelector('.hold-day-toggle');
        if(dt && dt.textContent === '▶'){
          var d = dh[k].getAttribute('data-day');
          var dRows = document.querySelectorAll('.hold-day-row-'+d+':not(.hold-detail-row)');
          for(var jj=0;jj<dRows.length;jj++){
            if(!dRows[jj].classList.contains('hold-day-header')){ dRows[jj].style.display = 'none'; }
          }
        }
      }
    }
  }
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

// ===== 撤销操作（Undo）=====
var _undoLatestDesc = ''; // 最新一条可撤销操作的描述（用于确认框）

function updateUndoBtn(){
  var btn = document.getElementById('btnUndo');
  if(!btn) return;
  apiCall({action:'checkUndo'}, function(res){
    if(res && res.success){
      if(res.count > 0){
        // 将描述里的6位股票代码替换为股票名称（更易读）
        var desc = res.latestDesc || '';
        desc = desc.replace(/(\d{6})/g, function(m){
          var name = getStockName(m);
          return name ? name : m;
        });
        _undoLatestDesc = desc;
        btn.disabled = false;
        btn.innerHTML = '🕐 撤销 <span style="background:rgba(255,255,255,0.3);padding:1px 6px;border-radius:10px;font-size:10px">' + res.count + '</span>';
      } else {
        btn.disabled = true;
        btn.innerHTML = '🕐 撤销';
      }
    } else {
      btn.disabled = true;
      btn.innerHTML = '🕐 撤销';
    }
  });
}

function undoLast(){
  if(!_undoLatestDesc){ showStatus('err','没有可撤销的操作'); return; }
  var descEl = document.getElementById('undoConfirmDesc');
  if(descEl) descEl.textContent = _undoLatestDesc;
  document.getElementById('undoConfirmModal').classList.add('active');
}

function closeUndoConfirm(){
  document.getElementById('undoConfirmModal').classList.remove('active');
}

function confirmUndoAction(){
  closeUndoConfirm();
  showStatus('loading','🔄 正在撤销...');
  apiCall({action:'undo'}, function(res){
    if(res && res.success){
      showStatus('ok','✅ ' + (res.message || '撤销成功'));
      loadAll();
    } else {
      showStatus('err','❌ 撤销失败：' + (res ? (res.error || '') : '服务器无响应'));
    }
  });
}

// ===== 持仓建仓/补仓明细展开 =====
function toggleHoldingDetail(nameEl, holdingId, code) {
  var detailRow = document.getElementById('hold-detail-' + holdingId);
  if (!detailRow) return;
  var toggleEl = document.getElementById('hold-toggle-' + holdingId);
  
  if (detailRow.dataset.loaded === '1') {
    var showing = detailRow.style.display !== 'none';
    detailRow.style.display = showing ? 'none' : '';
    if (toggleEl) toggleEl.textContent = showing ? '▸' : '▾';
    return;
  }
  
  var contentEl = detailRow.querySelector('.hold-detail-content');
  if (contentEl) contentEl.innerHTML = '<span style="color:#95a5a6">加载中...</span>';
  detailRow.style.display = '';
  if (toggleEl) toggleEl.textContent = '▾';
  
  apiCall({action:'listPositionDetails', holdingId: holdingId}, function(res) {
    if (!res || !res.success) {
      if (contentEl) contentEl.innerHTML = '<span style="color:#e74c3c">加载失败</span>';
      return;
    }
    var data = res.data || [];
    detailRow.dataset.loaded = '1';
    
    if (data.length === 0) {
      if (contentEl) contentEl.innerHTML = '<span style="color:#bdc3c7">暂无建仓/补仓明细（此功能上线前的旧持仓不追溯历史）</span>';
      return;
    }
    
    // 仅显示箭头当有多条记录（建仓+至少一次补仓），单条记录不值得展开
    if (data.length >= 2 && toggleEl) {
      toggleEl.style.display = 'inline';
    }
    
    var tbl = '<table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e8eaed">';
    tbl += '<thead><tr style="background:#f5f6f7">';
    tbl += '<th style="padding:4px 8px;border:1px solid #e8eaed;text-align:center">序号</th>';
    tbl += '<th style="padding:4px 8px;border:1px solid #e8eaed;text-align:center">日期</th>';
    tbl += '<th style="padding:4px 8px;border:1px solid #e8eaed;text-align:center">操作</th>';
    tbl += '<th style="padding:4px 8px;border:1px solid #e8eaed;text-align:center">数量</th>';
    tbl += '<th style="padding:4px 8px;border:1px solid #e8eaed;text-align:center">价格</th>';
    tbl += '<th style="padding:4px 8px;border:1px solid #e8eaed;text-align:right">金额</th>';
    tbl += '</tr></thead><tbody>';
    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      var amt = (d.qty || 0) * (d.price || 0);
      tbl += '<tr style="' + (i%2===0?'background:#fff':'background:#fafbfc') + '">';
      tbl += '<td style="padding:4px 8px;border:1px solid #e8eaed;text-align:center">' + (i+1) + '</td>';
      tbl += '<td style="padding:4px 8px;border:1px solid #e8eaed;text-align:center">' + escapeHtml(d.date || '-') + '</td>';
      tbl += '<td style="padding:4px 8px;border:1px solid #e8eaed;text-align:center;font-weight:600;color:' + (d.action==='建仓'?'#3498db':'#27ae60') + '">' + escapeHtml(d.action || '建仓') + '</td>';
      tbl += '<td style="padding:4px 8px;border:1px solid #e8eaed;text-align:center">' + (d.qty||0) + '股</td>';
      tbl += '<td style="padding:4px 8px;border:1px solid #e8eaed;text-align:center">' + (parseFloat(d.price)||0).toFixed(3) + '</td>';
      tbl += '<td style="padding:4px 8px;border:1px solid #e8eaed;text-align:right">' + amt.toFixed(2) + '</td>';
      tbl += '</tr>';
    }
    tbl += '</tbody></table>';
    if (contentEl) contentEl.innerHTML = tbl;
  });
}
