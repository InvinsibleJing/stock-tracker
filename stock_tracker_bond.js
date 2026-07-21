// ===== 可转债打新收益模块（v1）=====
// 与股票交易系统完全隔离：独立 sheet、独立统计、独立 Tab
// 复用主程序的 apiCall / escapeHtml 等全局函数（需在 stock_tracker_main.js 之后加载）

var bonds = [];
var BOND_YEAR_KEY = 'stock_bond_year';
try {
  var _savedYear = parseInt(localStorage.getItem(BOND_YEAR_KEY));
  bondYear = isNaN(_savedYear) ? new Date().getFullYear() : _savedYear;
} catch (e) {
  bondYear = new Date().getFullYear();
}
var bondEditingId = null;
var bondDeleteId = null;
var BOND_SIGNERS_KEY = 'stock_bond_signers';

// ===== 常用中签人（localStorage 记忆） =====
function getBondSigners() {
  try { return JSON.parse(localStorage.getItem(BOND_SIGNERS_KEY) || '[]'); } catch (e) { return []; }
}
function addBondSigner(name) {
  name = (name || '').trim();
  if (!name) return;
  var list = getBondSigners();
  if (list.indexOf(name) === -1) {
    list.push(name);
    try { localStorage.setItem(BOND_SIGNERS_KEY, JSON.stringify(list)); } catch (e) {}
  }
}
function refreshBondSignerList() {
  var dl = document.getElementById('bondSignerList');
  if (!dl) return;
  var list = getBondSigners();
  var html = '';
  for (var i = 0; i < list.length; i++) {
    html += '<option value="' + escapeHtml(list[i]) + '"></option>';
  }
  dl.innerHTML = html;
}

// ===== 数据加载 =====
function loadBonds(callback) {
  // 先读本地缓存并立即渲染（离线/弱网也能秒开），随后用云端数据覆盖
  try {
    var cache = localStorage.getItem('stock_bonds_cache');
    if (cache) { bonds = JSON.parse(cache) || []; if (callback) callback(); }
  } catch (e) {}
  apiCall({ action: 'listBonds' }, function (res) {
    if (res && res.success && res.data) {
      bonds = res.data || [];
      try { localStorage.setItem('stock_bonds_cache', JSON.stringify(bonds)); } catch (e) {}
    }
    if (callback) callback();
  });
}

function openBondTab() {
  loadBonds(renderBonds);
}

// ===== 工具函数 =====
function fmtMoney(v) {
  var n = Math.round((v || 0) * 100) / 100;
  var s = n.toFixed(2);
  var parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}
function setBondText(id, txt) {
  var el = document.getElementById(id);
  if (el) el.textContent = txt;
}

// ===== 渲染 =====
function renderBonds() {
  // 年份下拉：2022（你开始统计的年份）~ 当前年，并纳入数据中出现的年份
  var sel = document.getElementById('bondYearSelect');
  if (sel) {
    var cur = new Date().getFullYear();
    var minYear = 2022;
    for (var i = 0; i < bonds.length; i++) {
      var y = parseInt(bonds[i].year);
      if (!isNaN(y) && y < minYear) minYear = y;
    }
    var years = [];
    for (var y2 = minYear; y2 <= cur; y2++) years.push(y2);
    if (years.indexOf(bondYear) === -1) years.push(bondYear);
    years.sort(function (a, b) { return a - b; });
    var opts = '';
    for (var k = 0; k < years.length; k++) {
      opts += '<option value="' + years[k] + '"' + (years[k] === bondYear ? ' selected' : '') + '>' + years[k] + '年</option>';
    }
    sel.innerHTML = opts;
  }
  refreshBondSignerList();

  // 过滤当前年份
  var list = [];
  for (var j = 0; j < bonds.length; j++) {
    if (parseInt(bonds[j].year) === bondYear) list.push(bonds[j]);
  }

  // 统计（仅当年）
  var totalProfit = 0, totalExpense = 0;
  for (var p = 0; p < list.length; p++) {
    totalProfit += parseFloat(list[p].profit) || 0;
    totalExpense += parseFloat(list[p].expense) || 0;
  }
  var net = totalProfit - totalExpense;
  setBondText('bondTotalProfit', '¥' + fmtMoney(totalProfit));
  setBondText('bondTotalExpense', '¥' + fmtMoney(totalExpense));
  var netEl = document.getElementById('bondNetProfit');
  setBondText('bondNetProfit', (net >= 0 ? '¥' : '-¥') + fmtMoney(Math.abs(net)));
  if (netEl) netEl.className = 'card-val ' + (net >= 0 ? 'red' : 'green');
  setBondText('bondCount', list.length);

  var body = document.getElementById('bondBody');
  var empty = document.getElementById('bondEmpty');
  if (!body) return;
  if (list.length === 0) {
    body.innerHTML = '';
    if (empty) empty.style.display = 'block';
  } else {
    if (empty) empty.style.display = 'none';
    var html = '';
    for (var r = 0; r < list.length; r++) {
      var b = list[r];
      html += '<tr data-id="' + escapeHtml(b.id) + '">';
      html += '<td>' + (r + 1) + '</td>';
      var bondNameCls = ((parseFloat(b.profit) || 0) === 0) ? ' class="bond-unlisted"' : '';
      html += '<td' + bondNameCls + '>' + escapeHtml(b.name || '') + '</td>';
      html += '<td>' + escapeHtml(b.code || '') + '</td>';
      html += '<td>' + escapeHtml(b.market || '') + '</td>';
      html += '<td>' + escapeHtml(b.signer || '') + '</td>';
      html += '<td>' + escapeHtml(String(b.qty || '')) + '</td>';
      html += '<td class="red">' + fmtMoney(parseFloat(b.profit) || 0) + '</td>';
      html += '<td>' + fmtMoney(parseFloat(b.expense) || 0) + '</td>';
      html += '<td><button class="note-item-edit-btn" onclick="editBond(\'' + escapeHtml(b.id) + '\')" title="编辑">✎</button> <button class="note-btn-del" onclick="openDeleteBond(\'' + escapeHtml(b.id) + '\')">删除</button></td>';
      html += '</tr>';
    }
    body.innerHTML = html;
  }
}

function onBondYearChange() {
  var sel = document.getElementById('bondYearSelect');
  if (sel) bondYear = parseInt(sel.value) || new Date().getFullYear();
  // 记住选中的年份，刷新后不再跳回当前年
  try { localStorage.setItem(BOND_YEAR_KEY, String(bondYear)); } catch (e) {}
  renderBonds();
}

// ===== 添加 / 编辑弹窗 =====
function openBondModal() {
  bondEditingId = null;
  document.getElementById('bondModalTitle').textContent = '添加可转债中签';
  document.getElementById('bondName').value = '';
  document.getElementById('bondCode').value = '';
  document.getElementById('bondMarket').value = '沪市';
  document.getElementById('bondQty').value = '10';
  document.getElementById('bondSigner').value = '';
  document.getElementById('bondProfit').value = '';
  document.getElementById('bondExpense').value = '';
  document.getElementById('bondModal').style.display = 'flex';
  document.getElementById('bondName').focus();
}
function closeBondModal() {
  document.getElementById('bondModal').style.display = 'none';
}

function saveBond() {
  var name = document.getElementById('bondName').value.trim();
  var code = document.getElementById('bondCode').value.trim();
  var market = document.getElementById('bondMarket').value;
  var qty = parseInt(document.getElementById('bondQty').value) || 10;
  var signer = document.getElementById('bondSigner').value.trim();
  var profit = parseFloat(document.getElementById('bondProfit').value) || 0;
  var expense = parseFloat(document.getElementById('bondExpense').value) || 0;

  if (!name) { alert('请输入转债名称'); return; }
  if (!signer) { alert('请输入中签人'); return; }

  // 记住常用中签人
  addBondSigner(signer);

  if (bondEditingId) {
    // 编辑：先乐观更新本地，再后台同步
    for (var i = 0; i < bonds.length; i++) {
      if (bonds[i].id === bondEditingId) {
        bonds[i].year = bondYear; bonds[i].name = name; bonds[i].code = code;
        bonds[i].market = market; bonds[i].signer = signer; bonds[i].qty = qty;
        bonds[i].profit = profit; bonds[i].expense = expense;
        break;
      }
    }
    renderBonds();
    closeBondModal();
    apiCall({ action: 'updateBond', id: bondEditingId, year: bondYear, name: name, code: code, market: market, signer: signer, qty: qty, profit: profit, expense: expense }, function (res) {
      if (!res || !res.success) {
        alert('保存失败，请重试');
        loadBonds(renderBonds);
      } else {
        try { localStorage.setItem('stock_bonds_cache', JSON.stringify(bonds)); } catch (e) {}
      }
    });
  } else {
    // 新增：乐观更新（临时 id），同步成功后替换为真实 id
    var tempId = 'tmp_' + Date.now();
    var rec = { id: tempId, year: bondYear, name: name, code: code, market: market, signer: signer, qty: qty, profit: profit, expense: expense };
    bonds.push(rec);
    renderBonds();
    closeBondModal();
    apiCall({ action: 'addBond', year: bondYear, name: name, code: code, market: market, signer: signer, qty: qty, profit: profit, expense: expense }, function (res) {
      if (res && res.success && res.id) {
        rec.id = res.id;
        try { localStorage.setItem('stock_bonds_cache', JSON.stringify(bonds)); } catch (e) {}
      } else {
        // 回滚
        var kept = [];
        for (var i = 0; i < bonds.length; i++) { if (bonds[i].id !== tempId) kept.push(bonds[i]); }
        bonds = kept;
        renderBonds();
        alert('添加失败，请重试');
      }
    });
  }
}

function editBond(id) {
  var b = null;
  for (var i = 0; i < bonds.length; i++) { if (bonds[i].id === id) { b = bonds[i]; break; } }
  if (!b) return;
  bondEditingId = id;
  document.getElementById('bondModalTitle').textContent = '编辑可转债中签';
  document.getElementById('bondName').value = b.name || '';
  document.getElementById('bondCode').value = b.code || '';
  document.getElementById('bondMarket').value = b.market || '沪市';
  document.getElementById('bondQty').value = String(b.qty || 10);
  document.getElementById('bondSigner').value = b.signer || '';
  document.getElementById('bondProfit').value = b.profit || 0;
  document.getElementById('bondExpense').value = b.expense || 0;
  document.getElementById('bondModal').style.display = 'flex';
}

// ===== 删除 =====
function openDeleteBond(id) {
  bondDeleteId = id;
  document.getElementById('deleteBondModal').style.display = 'flex';
}
function closeDeleteBond() {
  document.getElementById('deleteBondModal').style.display = 'none';
}
function submitDeleteBond() {
  var id = bondDeleteId;
  if (!id) return;
  var backup = [];
  for (var i = 0; i < bonds.length; i++) backup.push(bonds[i]);
  var kept = [];
  for (var j = 0; j < bonds.length; j++) { if (bonds[j].id !== id) kept.push(bonds[j]); }
  bonds = kept;
  renderBonds();
  closeDeleteBond();
  apiCall({ action: 'deleteBond', id: id }, function (res) {
    if (!res || !res.success) {
      bonds = backup;
      renderBonds();
      alert('删除失败，请重试');
    } else {
      try { localStorage.setItem('stock_bonds_cache', JSON.stringify(bonds)); } catch (e) {}
    }
  });
}
