/**
 * 股票交易记录 - Google Sheets API (v5.3)
 *
 * ── 版本更新记录 ──────────────────────────────────────────────────────
 *
 * v5.3  (早期) 不等量做T支持
 *   - doT函数新增 sellQty/buyQty/sellPrice/buyPrice 参数
 *   - 不等量做T：amount存差价法盈亏(展示用)，成本冲减用现金流法
 *   - 不等量做T：持仓量 = 原持仓 - 卖出量 + 买入量
 *   - 兼容旧逻辑：不传sellQty/buyQty时走原等量做T逻辑
 *
 * v5.3.1 (2026-07-12) 清理「备忘笔记」功能
 *   - 删除 NOTES_SHEET_NAME/NOTES_HEADERS 常量、doGet 中 5 个备忘 case
 *   - 删除 getNotesSheet/getNotes/addNote/updateNote/deleteNote/searchNotes 函数
 *   - 新增一次性函数 deleteNotesSheet()（Run 一次删除 Google Sheet 中「备忘笔记」sheet，已执行）
 *   - 前端「快速备忘」子Tab此前已删除；交易/持仓的 note 备注字段保留
 *
 * v5.3.2 (2026-07-12) 清理一次性/死代码
 *   - 删除 BOND_IMPORT_DATA、BOND_IMPORT_2022_RAW、getAllBondImportData、importBondsFromData、sortBondSheet、deleteNotesSheet
 *   - 可转债模块核心功能(列表/增删改)保留，与股票交易数据完全隔离
 *
 * v5.3.3 (2026-07-12) 修复股票代码前导0丢失  ★本次改动
 *   - 根因：appendRow 先写值，Sheets 立即把 "000001" 当成数字解析，前导0 在写入瞬间永久丢失；事后设格式无法找回
 *   - addHolding / addTrade / clearHolding / doT / addBond：改为「先 appendRow 创建行，再 setNumberFormat('@') 设文本格式，最后以 setValue 文本重写 code/date 列」(双保险)
 *   - updateTrade / updateHolding / updateHoldingBatch：setValue 前先 setNumberFormat('@')（目标行已存在，预设置格式有效）
 *   - 全文非标准格式 '@STRING@' 统一改为标准文本格式 '@'
 *   - 保留一次性修复函数 fixLegacyRecords / fixStockCodeFormat（不改、不删）
 * ───────────────────────────────────────────────────────────────────────
 */

var SHEET_NAME = '交易记录';
var HOLDING_SHEET_NAME = '当前持仓';
var MARGIN_SHEET_NAME = '融资余额';
var MARGIN_HEADERS = ['date', 'balance'];

// 可转债打新收益（独立 sheet，与股票交易完全隔离）
var BOND_SHEET_NAME = '可转债';
var BOND_HEADERS = ['id', 'year', 'name', 'code', 'market', 'signer', 'qty', 'profit', 'expense'];

// 交易记录期望的表头（v5.2新增fees列）
var EXPECTED_HEADERS = ['id', 'date', 'code', 'tag', 'quantity', 'amount', 'note', 'tIndex', 'status', 'source', 'fees'];
// 持仓期望的表头（v5.0新增buyPrice列，v5.1新增accountType列，v5.3新增lastAddDate/lastAddQty列）
var HOLDING_HEADERS = ['id', 'date', 'code', 'tag', 'quantity', 'note', 'buyPrice', 'accountType', 'lastAddDate', 'lastAddQty'];

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(EXPECTED_HEADERS);
    // 标记迁移已完成
    PropertiesService.getScriptProperties().setProperty('trade_migrated', 'v4.1');
    return sheet;
  }

  // 只在未标记迁移完成时检查表头（避免每次请求都读取表头）
  var props = PropertiesService.getScriptProperties();
  var migrated = props.getProperty('trade_migrated');
  if (!migrated || migrated < 'v4.1') {
    var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var needsMigration = false;

    // 情况1：旧版7列（无tIndex和status）
    if (headerRow.length === 7 && headerRow[0] === 'id' && headerRow[1] === 'date' && headerRow[6] === 'note') {
      needsMigration = true;
    }

    // 情况2：旧版4列 [id, date, amount, note]
    if (headerRow.length === 4 && headerRow[0] === 'id' && headerRow[1] === 'date' && headerRow[2] === 'amount' && headerRow[3] === 'note') {
      needsMigration = true;
    }

    // 情况3：旧版6列
    if (headerRow.length === 6) {
      needsMigration = true;
    }

    // 情况4：旧版9列（有tIndex和status，无source）
    if (headerRow.length === 9 && headerRow[0] === 'id' && headerRow[7] === 'tIndex' && headerRow[8] === 'status') {
      needsMigration = true;
    }

    // 情况5：任何列数不足11的情况（兜底）
    if (headerRow.length < EXPECTED_HEADERS.length && headerRow.length > 0 && !needsMigration) {
      needsMigration = true;
    }

    if (needsMigration) {
      migrateSheet(sheet, headerRow);
    }

    // 标记迁移已完成
    props.setProperty('trade_migrated', 'v5.2');
  }

  return sheet;
}

// 迁移旧数据
function migrateSheet(sheet, oldHeaders) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  // 旧版4列 [id, date, amount, note] → 新版10列
  if (oldHeaders.length === 4 && oldHeaders[0] === 'id' && oldHeaders[1] === 'date' && oldHeaders[2] === 'amount' && oldHeaders[3] === 'note') {
    // 在 date 列后面插入3列（code, tag, quantity）
    sheet.insertColumnsAfter(2, 3);
    // 在 note 列后面插入3列（tIndex, status, source）
    sheet.insertColumnsAfter(7, 3);
    // 更新表头（10列）
    sheet.getRange(1, 1, 1, 10).setValues([EXPECTED_HEADERS]);
    // 给旧数据填充默认值
    if (lastRow > 1) {
      sheet.getRange(2, 3, lastRow - 1, 1).setValue(''); // code
      sheet.getRange(2, 4, lastRow - 1, 1).setValue('主板'); // tag
      sheet.getRange(2, 5, lastRow - 1, 1).setValue(0); // quantity
      sheet.getRange(2, 8, lastRow - 1, 1).setValue(0); // tIndex
      sheet.getRange(2, 9, lastRow - 1, 1).setValue('closed'); // status
      sheet.getRange(2, 10, lastRow - 1, 1).setValue('manual'); // source
    }
    Logger.log('已自动迁移：4列 → 10列');
  }
  // 旧版6列 [id,date,code,tag,amount,note] → 新版10列
  else if (oldHeaders.length === 6 && oldHeaders[0] === 'id' && oldHeaders[1] === 'date' && oldHeaders[2] === 'code' && oldHeaders[3] === 'tag' && oldHeaders[4] === 'amount' && oldHeaders[5] === 'note') {
    // 在 tag 列（第4列）后面插入1列（quantity）
    sheet.insertColumnsAfter(4, 1);
    // 在 note 列后面插入3列（tIndex, status, source）
    sheet.insertColumnsAfter(8, 3);
    // 更新表头（10列）
    sheet.getRange(1, 1, 1, 10).setValues([EXPECTED_HEADERS]);
    // 给旧数据填充默认值
    if (lastRow > 1) {
      sheet.getRange(2, 5, lastRow - 1, 1).setValue(0); // quantity
      sheet.getRange(2, 8, lastRow - 1, 1).setValue(0); // tIndex
      sheet.getRange(2, 9, lastRow - 1, 1).setValue('closed'); // status
      sheet.getRange(2, 10, lastRow - 1, 1).setValue('manual'); // source
    }
    Logger.log('已自动迁移：6列 → 10列');
  }
  // 旧版7列（有quantity，无tIndex/status/source）→ 新版10列
  else if (oldHeaders.length === 7 && oldHeaders[0] === 'id' && oldHeaders[1] === 'date' && oldHeaders[6] === 'note') {
    // 在 note 列后面插入3列（tIndex, status, source）
    sheet.insertColumnsAfter(7, 3);
    // 更新表头（10列）
    sheet.getRange(1, 1, 1, 10).setValues([EXPECTED_HEADERS]);
    // 给旧数据填充默认值
    if (lastRow > 1) {
      sheet.getRange(2, 8, lastRow - 1, 1).setValue(0); // tIndex
      sheet.getRange(2, 9, lastRow - 1, 1).setValue('closed'); // status
      sheet.getRange(2, 10, lastRow - 1, 1).setValue('manual'); // source
    }
    Logger.log('已自动迁移：7列 → 10列');
  }
  // 旧版9列（有tIndex和status，无source）→ 新版10列
  else if (oldHeaders.length === 9 && oldHeaders[0] === 'id' && oldHeaders[7] === 'tIndex' && oldHeaders[8] === 'status') {
    // 在 status 列后面插入1列（source）
    sheet.insertColumnsAfter(9, 1);
    // 更新表头
    sheet.getRange(1, 1, 1, 10).setValues([EXPECTED_HEADERS]);
    // 给旧数据填充默认值
    if (lastRow > 1) {
      sheet.getRange(2, 10, lastRow - 1, 1).setValue('manual');
    }
    Logger.log('已自动迁移：9列 → 10列（新增source列）');
  }
  // 情况6：旧版10列（有source，无fees）→ 新版11列
  if (headerRow.length === 10 && headerRow[0] === 'id' && headerRow[9] === 'source') {
    // 在 source 列后面插入1列（fees）
    sheet.insertColumnsAfter(10, 1);
    // 更新表头（11列）
    sheet.getRange(1, 1, 1, 11).setValues([EXPECTED_HEADERS]);
    // 给旧数据填充默认值0
    if (lastRow > 1) {
      sheet.getRange(2, 11, lastRow - 1, 1).setValue(0);
    }
    Logger.log('已自动迁移：10列 → 11列（新增fees列）');
  }
  else {
    // 其他情况：直接重写表头并确保列数足够
    if (lastCol < EXPECTED_HEADERS.length) {
      sheet.insertColumnsAfter(lastCol, EXPECTED_HEADERS.length - lastCol);
    }
    sheet.getRange(1, 1, 1, EXPECTED_HEADERS.length).setValues([EXPECTED_HEADERS]);
    // 如果旧数据没有source值，填充默认值
    if (lastRow > 1 && lastCol < EXPECTED_HEADERS.length) {
      var sourceCol = sheet.getRange(2, 10, lastRow - 1, 1);
      var sourceValues = sourceCol.getValues();
      for (var i = 0; i < sourceValues.length; i++) {
        if (!sourceValues[i][0]) {
          sourceValues[i][0] = 'manual';
        }
      }
      sourceCol.setValues(sourceValues);
    }
    Logger.log('已修复表头并补充source列');
  }
}

// 处理 GET 请求
function doGet(e) {
  var action = e.parameter.action || 'list';
  var callback = e.parameter.callback;

  try {
    var result;
    switch (action) {
      case 'list':
        result = listTrades();
        break;
      case 'add':
        result = addTrade(e.parameter);
        break;
      case 'delete':
        result = deleteTrade(e.parameter.id);
        break;
      case 'update':
        result = updateTrade(e.parameter);
        break;
      case 'clear':
        result = clearAll();
        break;
      case 'migrate':
        // 手动触发迁移
        var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
        if (sheet) {
          var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          migrateSheet(sheet, h);
          result = { success: true, message: '迁移完成' };
        } else {
          result = { success: false, error: '找不到工作表' };
        }
        break;
      // ===== 持仓相关 =====
      case 'listHoldings':
        result = listHoldings();
        break;
      case 'addHolding':
        result = addHolding(e.parameter);
        break;
      case 'deleteHolding':
        result = deleteHolding(e.parameter.id);
        break;
      case 'updateHolding':
        result = updateHolding(e.parameter);
        break;
      case 'updateHoldingBatch':
        result = updateHoldingBatch(e.parameter);
        break;
      case 'clearHolding':
        result = clearHolding(e.parameter);
        break;
      case 'doT':
        result = doT(e.parameter);
        break;
      case 'fixLegacy':
        result = fixLegacyRecords();
        break;
      case 'fixCodeFormat':
        result = fixStockCodeFormat();
        break;
      // ===== 融资余额数据 =====
      case 'marginData':
        result = fetchMarginData();
        break;
      case 'refreshMargin':
        result = refreshMarginFromJin10();
        break;
      // ===== 账户余额相关 =====
      case 'getBalance':
        result = getBalance();
        break;
      case 'setBalance':
        result = setBalance(e.parameter);
        break;
      // ===== 可转债打新收益 =====
      case 'listBonds':
        result = listBonds();
        break;
      case 'addBond':
        result = addBond(e.parameter);
        break;
      case 'updateBond':
        result = updateBond(e.parameter);
        break;
      case 'deleteBond':
        result = deleteBond(e.parameter.id);
        break;
      default:
        result = { success: false, error: '未知操作' };
    }

    var json = JSON.stringify(result);
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    var errorJson = JSON.stringify({ success: false, error: err.toString() });
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + errorJson + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(errorJson)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 查询所有记录
function listTrades() {
  var sheet = getSheet(); // 自动检测并迁移
  var data = sheet.getDataRange().getValues();
  var trades = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      trades.push({
        id: String(data[i][0]),
        date: String(data[i][1]),
        code: String(data[i][2] || ''),
        tag: String(data[i][3] || '主板'),
        quantity: parseInt(data[i][4]) || 0,
        amount: parseFloat(data[i][5]),
        note: String(data[i][6] || ''),
        tIndex: parseInt(data[i][7]) || 0,
        status: String(data[i][8] || 'closed'),
        source: String(data[i][9] || 'manual'),
        fees: parseFloat(data[i][10]) || 0
      });
    }
  }
  return { success: true, data: trades };
}

// 添加记录
function addTrade(params) {
  var sheet = getSheet(); // 自动检测并迁移
  var id = String(new Date().getTime());
  var date = params.date || '';
  var code = params.code || '';
  var tag = params.tag || '主板';
  var quantity = parseInt(params.quantity) || 0;
  var amount = parseFloat(params.amount) || 0;
  var note = params.note || '';
  var tIndex = parseInt(params.tIndex) || 0;
  var status = params.status || 'closed';
  var source = params.source || 'manual';
  var fees = parseFloat(params.fees) || 0;

  // 先 appendRow 创建行，再设文本格式，最后以文本重写 date/code
  // 顺序不能反：对不存在的行预设置格式不会生效，appendRow 之后格式才能正确落到该行
  sheet.appendRow([id, date, code, tag, quantity, amount, note, tIndex, status, source, fees]);
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 2).setNumberFormat('@'); // date 列
  sheet.getRange(lastRow, 3).setNumberFormat('@'); // code 列
  sheet.getRange(lastRow, 2).setValue(date); // 以文本重写，双保险确保前导0不丢
  sheet.getRange(lastRow, 3).setValue(code);

  return { success: true, id: id };
}

// 删除记录
function deleteTrade(id) {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };
  // 只读取ID列（第1列），减少数据传输量
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      break;
    }
  }
  return { success: true };
}

// 更新记录
function updateTrade(params) {
  var sheet = getSheet();
  var id = params.id;
  var field = params.field;
  var value = params.value;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };

  // 列号映射（1-based）：date=2, code=3, tag=4, quantity=5, amount=6, note=7, tIndex=8, status=9, source=10, fees=11
  var colMap = { date: 2, code: 3, tag: 4, quantity: 5, amount: 6, note: 7, tIndex: 8, status: 9, source: 10, fees: 11 };
  var col = colMap[field];
  if (!col) return { success: true };

  // 只读取ID列定位行
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var cellValue = value;
      if (field === 'amount') cellValue = parseFloat(value);
      if (field === 'quantity') cellValue = parseInt(value) || 0;
      var cell = sheet.getRange(i + 2, col);
      if (field === 'date' || field === 'code') cell.setNumberFormat('@');
      cell.setValue(cellValue);
      break;
    }
  }
  return { success: true };
}

// 清空所有
function clearAll() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  return { success: true };
}

// ===== 持仓相关功能 =====

// 获取持仓工作表（自动创建+迁移）
function getHoldingSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(HOLDING_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(HOLDING_SHEET_NAME);
    sheet.appendRow(HOLDING_HEADERS);
    return sheet;
  }

  // 检查是否需要迁移
  var lastCol = sheet.getLastColumn();
  if (lastCol < HOLDING_HEADERS.length) {
    if (lastCol === 6) {
      // 旧版6列，在note列后插入buyPrice+accountType两列
      sheet.insertColumnsAfter(6, 2);
      sheet.getRange(1, 7).setValue('buyPrice');
      sheet.getRange(1, 8).setValue('accountType');
      // 再插入lastAddDate+lastAddQty两列
      sheet.insertColumnsAfter(8, 2);
      sheet.getRange(1, 9).setValue('lastAddDate');
      sheet.getRange(1, 10).setValue('lastAddQty');
    } else if (lastCol === 7) {
      // 旧版7列，在buyPrice列后插入accountType列
      sheet.insertColumnsAfter(7, 1);
      sheet.getRange(1, 8).setValue('accountType');
      // 再插入lastAddDate+lastAddQty两列
      sheet.insertColumnsAfter(8, 2);
      sheet.getRange(1, 9).setValue('lastAddDate');
      sheet.getRange(1, 10).setValue('lastAddQty');
      // 旧数据accountType默认normal
      var dataLastRow = sheet.getLastRow();
      if (dataLastRow > 1) {
        sheet.getRange(2, 8, dataLastRow - 1, 1).setValue('normal');
      }
    } else if (lastCol === 8) {
      // 旧版8列（有accountType，无lastAddDate/lastAddQty）
      sheet.insertColumnsAfter(8, 2);
      sheet.getRange(1, 9).setValue('lastAddDate');
      sheet.getRange(1, 10).setValue('lastAddQty');
    } else {
      // 其他情况：补齐列数
      var diff = HOLDING_HEADERS.length - lastCol;
      sheet.insertColumnsAfter(lastCol, diff);
      sheet.getRange(1, 1, 1, HOLDING_HEADERS.length).setValues([HOLDING_HEADERS]);
    }
    Logger.log('持仓表已迁移：' + lastCol + '列 → ' + HOLDING_HEADERS.length + '列');
  }

  return sheet;
}

// 查询所有持仓
function listHoldings() {
  var sheet = getHoldingSheet();
  var data = sheet.getDataRange().getValues();
  var holdings = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      holdings.push({
        id: String(data[i][0]),
        date: String(data[i][1]),
        code: String(data[i][2] || ''),
        tag: String(data[i][3] || '主板'),
        quantity: parseInt(data[i][4]) || 0,
        note: String(data[i][5] || ''),
        buyPrice: parseFloat(data[i][6]) || 0,
        accountType: String(data[i][7] || 'normal'),
        lastAddDate: String(data[i][8] || ''),
        lastAddQty: parseInt(data[i][9]) || 0
      });
    }
  }
  return { success: true, data: holdings };
}

// 添加持仓
function addHolding(params) {
  var sheet = getHoldingSheet();
  var id = String(new Date().getTime());
  var date = params.date || '';
  var code = params.code || '';
  var tag = params.tag || '主板';
  var quantity = parseInt(params.quantity) || 0;
  var note = params.note || '';
  var buyPrice = parseFloat(params.buyPrice) || 0;
  var accountType = params.accountType || 'normal';
  var lastAddDate = params.lastAddDate || '';
  var lastAddQty = parseInt(params.lastAddQty) || 0;

  // 先 appendRow 创建行，再设文本格式，最后以文本重写 date/code
  // 顺序不能反：对不存在的行预设置格式不会生效，appendRow 之后格式才能正确落到该行
  sheet.appendRow([id, date, code, tag, quantity, note, buyPrice, accountType, lastAddDate, lastAddQty]);
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 2).setNumberFormat('@'); // date 列
  sheet.getRange(lastRow, 3).setNumberFormat('@'); // code 列
  sheet.getRange(lastRow, 2).setValue(date); // 以文本重写，双保险确保前导0不丢
  sheet.getRange(lastRow, 3).setValue(code);

  return { success: true, id: id };
}

// 删除持仓
function deleteHolding(id) {
  var sheet = getHoldingSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };
  // 只读取ID列（第1列），减少数据传输量
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      break;
    }
  }
  return { success: true };
}

// 更新持仓
function updateHolding(params) {
  var sheet = getHoldingSheet();
  var id = params.id;
  var field = params.field;
  var value = params.value;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };

  // 列号映射（1-based）：date=2, code=3, tag=4, quantity=5, note=6, buyPrice=7, accountType=8, lastAddDate=9, lastAddQty=10
  var colMap = { date: 2, code: 3, tag: 4, quantity: 5, note: 6, buyPrice: 7, accountType: 8, lastAddDate: 9, lastAddQty: 10 };
  var col = colMap[field];
  if (!col) return { success: true };

  // 只读取ID列定位行
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var cellValue = value;
      if (field === 'quantity') cellValue = parseInt(value) || 0;
      if (field === 'buyPrice') cellValue = parseFloat(value) || 0;
      var cell = sheet.getRange(i + 2, col);
      if (field === 'date' || field === 'code') cell.setNumberFormat('@');
      cell.setValue(cellValue);
      break;
    }
  }
  return { success: true };
}

// 批量更新持仓（原子操作，一次调用更新多个字段）
function updateHoldingBatch(params) {
  var sheet = getHoldingSheet();
  var id = params.id;
  var fields = params.fields ? params.fields.split(',') : [];
  var values = params.values ? params.values.split(',') : [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };

  // 列号映射（1-based）：date=2, code=3, tag=4, quantity=5, note=6, buyPrice=7, accountType=8, lastAddDate=9, lastAddQty=10
  var colMap = { date: 2, code: 3, tag: 4, quantity: 5, note: 6, buyPrice: 7, accountType: 8, lastAddDate: 9, lastAddQty: 10 };

  // 只读取ID列定位行
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      for (var j = 0; j < fields.length; j++) {
        var field = fields[j].trim();
        var value = values[j] ? values[j].trim() : '';
        var col = colMap[field];
        if (!col) continue;

        var cellValue = value;
        if (field === 'quantity' || field === 'lastAddQty') cellValue = parseInt(value) || 0;
        if (field === 'buyPrice') cellValue = parseFloat(value) || 0;

        var cell = sheet.getRange(i + 2, col);
        if (field === 'date' || field === 'code') cell.setNumberFormat('@');
        cell.setValue(cellValue);
      }
      break;
    }
  }
  return { success: true };
}

// 清仓：将持仓转为交易记录，然后删除该持仓
function clearHolding(params) {
  var holdingId = params.id;
  var amount = parseFloat(params.amount) || 0;
  var tradeNote = params.note || '';
  var clearQty = parseInt(params.quantity) || 0;
  var isPartial = parseInt(params.isPartial) === 1;
  var fees = parseFloat(params.fees) || 0;

  // 1. 从持仓中找到该记录（只读取必要数据）
  var hSheet = getHoldingSheet();
  var lastRow = hSheet.getLastRow();
  if (lastRow < 2) return { success: false, error: '持仓记录不存在' };

  var hData = hSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var holding = null;
  var holdingRow = -1;

  for (var i = 0; i < hData.length; i++) {
    if (String(hData[i][0]) === String(holdingId)) {
      holding = {
        id: String(hData[i][0]),
        date: String(hData[i][1]),
        code: String(hData[i][2] || ''),
        tag: String(hData[i][3] || '主板'),
        quantity: parseInt(hData[i][4]) || 0,
        note: String(hData[i][5] || ''),
        buyPrice: parseFloat(hData[i][6]) || 0,
        accountType: String(hData[i][7] || 'normal')
      };
      holdingRow = i + 2;
      break;
    }
  }

  if (!holding) {
    return { success: false, error: '持仓记录不存在' };
  }

  // 计算实际清仓数量（优先使用前端传来的数量）
  if (clearQty <= 0) clearQty = holding.quantity;
  if (clearQty > holding.quantity) clearQty = holding.quantity;
  var actualIsPartial = clearQty < holding.quantity;

  // 兼容性处理：如果前端传来 isPartial=1 但实际计算结果为全仓，以实际为准
  // 反之亦然，确保前后端逻辑一致

  // 2. 添加到交易记录（日期用今天，不要用持仓日期）
  var tradeId = String(new Date().getTime());
  var tradeSheet = getSheet();
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  var finalNote = tradeNote || holding.note || '';
  if (actualIsPartial) {
    finalNote = (finalNote ? finalNote + ' ' : '') + '部分清仓' + clearQty + '/' + holding.quantity + '股';
  }
  // 先 appendRow 创建行，再设文本格式，最后以文本重写 date/code
  tradeSheet.appendRow([tradeId, todayStr, holding.code, holding.tag, clearQty, amount, finalNote, 0, 'closed', 'clear', fees]);
  var tLastRow = tradeSheet.getLastRow();
  tradeSheet.getRange(tLastRow, 2).setNumberFormat('@'); // date 列
  tradeSheet.getRange(tLastRow, 3).setNumberFormat('@'); // code 列
  tradeSheet.getRange(tLastRow, 2).setValue(todayStr); // 以文本重写，双保险确保前导0不丢
  tradeSheet.getRange(tLastRow, 3).setValue(holding.code);

  if (actualIsPartial) {
    // 部分清仓：更新持仓数量（成本价不变，因为剩余股的成本单价不变）
    var newQty = holding.quantity - clearQty;
    hSheet.getRange(holdingRow, 5).setValue(newQty);
    return { success: true, tradeId: tradeId, wasPartial: true, newQuantity: newQty };
  } else {
    // 全部清仓：删除持仓（不再标记做T为已完结，前端按tIndex过滤统计）
    hSheet.deleteRow(holdingRow);
    return { success: true, tradeId: tradeId, wasPartial: false };
  }
}

// ============================================================
// 做T函数（v5.3 - 支持不等量做T）
// ============================================================
// 不等量做T（sellQty != buyQty）：
//   - 交易记录 amount = 差价法盈亏（前端算好传来，展示用）
//   - 持仓量更新 = 原持仓 - sellQty + buyQty
//   - 成本冲减用现金流法 = sellPrice×sellQty - buyPrice×buyQty - fees
// 等量做T（不传sellQty/buyQty 或 sellQty=0）：
//   - 走原逻辑，amount直接冲减成本，持仓量不变
function doT(params) {
  var holdingId = params.id;
  var amount = parseFloat(params.amount) || 0; // 差价法展示盈亏（不等量时）
  var tNote = params.note || '';
  var tIndex = parseInt(params.tIndex) || 1;
  var doTQty = parseInt(params.quantity) || 0;
  var fees = parseFloat(params.fees) || 0;

  // 不等量做T参数
  var sellQty = parseInt(params.sellQty) || 0;
  var buyQty = parseInt(params.buyQty) || 0;
  var sellPrice = parseFloat(params.sellPrice) || 0;
  var buyPrice = parseFloat(params.buyPrice) || 0;
  var isUnequal = (sellQty > 0 && buyQty > 0);

  // 1. 从持仓中找到该记录（只读取必要数据）
  var hSheet = getHoldingSheet();
  var lastRow = hSheet.getLastRow();
  if (lastRow < 2) return { success: false, error: '持仓记录不存在' };

  var hData = hSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var holding = null;
  var holdingRow = -1;

  for (var i = 0; i < hData.length; i++) {
    if (String(hData[i][0]) === String(holdingId)) {
      holding = {
        id: String(hData[i][0]),
        date: String(hData[i][1]),
        code: String(hData[i][2] || ''),
        tag: String(hData[i][3] || '主板'),
        quantity: parseInt(hData[i][4]) || 0,
        note: String(hData[i][5] || ''),
        buyPrice: parseFloat(hData[i][6]) || 0,
        accountType: String(hData[i][7] || 'normal')
      };
      holdingRow = i + 2;
      break;
    }
  }

  if (!holding) {
    return { success: false, error: '持仓记录不存在' };
  }

  // 计算实际做T数量（等量模式）
  if (!isUnequal) {
    if (doTQty <= 0) doTQty = holding.quantity;
    if (doTQty > holding.quantity) doTQty = holding.quantity;
  }

  // 2. 添加到交易记录，标记T序号和未完结状态
  var tradeId = String(new Date().getTime());
  var tradeSheet = getSheet();
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  // 先 appendRow 创建行，再设文本格式，最后以文本重写 date/code
  tradeSheet.appendRow([tradeId, todayStr, holding.code, holding.tag, doTQty, amount, tNote, tIndex, 'open', 'doT', fees]);
  var tLastRow = tradeSheet.getLastRow();
  tradeSheet.getRange(tLastRow, 2).setNumberFormat('@'); // date 列
  tradeSheet.getRange(tLastRow, 3).setNumberFormat('@'); // code 列
  tradeSheet.getRange(tLastRow, 2).setValue(todayStr); // 以文本重写，双保险确保前导0不丢
  tradeSheet.getRange(tLastRow, 3).setValue(holding.code);

  // 3. 更新持仓
  if (isUnequal) {
    // ===== 不等量做T：现金流法冲减成本 + 更新持仓量 =====
    var newQuantity = holding.quantity - sellQty + buyQty;

    // 现金流法盈亏（用于成本冲减，不用前端传来的amount）
    var cashFlowProfit = sellPrice * sellQty - buyPrice * buyQty - fees;

    if (holding.buyPrice > 0 && newQuantity > 0) {
      var uTotalCost = holding.buyPrice * holding.quantity;
      var uNewTotalCost = uTotalCost - cashFlowProfit;
      if (uNewTotalCost < 0) uNewTotalCost = 0;
      var newBuyPrice = uNewTotalCost / newQuantity;
      if (newBuyPrice < 0) newBuyPrice = 0;
      newBuyPrice = Math.round(newBuyPrice * 1000) / 1000;

      // 更新持仓量（第5列）和成本价（第7列）
      hSheet.getRange(holdingRow, 5).setValue(newQuantity);
      hSheet.getRange(holdingRow, 7).setValue(newBuyPrice);
      return { success: true, tradeId: tradeId, newBuyPrice: newBuyPrice, newQuantity: newQuantity };
    } else {
      // 只更新持仓量
      hSheet.getRange(holdingRow, 5).setValue(newQuantity);
      return { success: true, tradeId: tradeId, newQuantity: newQuantity };
    }
  } else {
    // ===== 等量做T：原有逻辑 =====
    // 更新持仓成本价：新成本 = (旧总成本 - 做T盈利) / 持仓数量
    if (holding.buyPrice > 0 && holding.quantity > 0) {
      var totalCost = holding.buyPrice * holding.quantity;
      var newTotalCost = totalCost - amount; // amount正=盈利→成本降低
      var newBuyPrice = newTotalCost / holding.quantity;
      // 成本价不能为负
      if (newBuyPrice < 0) newBuyPrice = 0;
      hSheet.getRange(holdingRow, 7).setValue(Math.round(newBuyPrice * 1000) / 1000); // 保留3位小数
      return { success: true, tradeId: tradeId, newBuyPrice: newBuyPrice };
    }

    return { success: true, tradeId: tradeId };
  }
}

// 批量修复历史记录：补全两融账户手续费 + [两融]标记
function fixLegacyRecords() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, message: '无数据' };
  
  var data = sheet.getDataRange().getValues();
  var count = 0;
  
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    
    var source = String(data[i][9] || '');
    var note = String(data[i][6] || '');
    var fees = parseFloat(data[i][10]) || 0;
    var newFees = -1; // -1 表示不改
    
    // 补全手续费（两融佣金，强制覆盖）
    if (source === 'clear') {
      newFees = 5; // 卖出一笔佣金
    } else if (source === 'doT') {
      newFees = 10; // 买入+卖出两笔佣金
    }
    
    if (newFees >= 0 && fees !== newFees) {
      sheet.getRange(i + 1, 11).setValue(newFees);
      count++;
    }
    
    // 补全 [两融] 标记
    if ((source === 'clear' || source === 'doT') 
        && note.indexOf('[两融]') === -1 
        && note.indexOf('[正常]') === -1) {
      var newNote = note + '[两融]';
      sheet.getRange(i + 1, 7).setValue(newNote);
      count++;
    }
  }
  
  return { success: true, fixed: count };
}

// 修复股票代码格式：将被 Sheets 当成数字去掉前导零的代码补回（如 2600 → 002600）
function fixStockCodeFormat() {
  var results = {};
  
  // 修复交易表
  var tradeSheet = getSheet();
  var tradeLastRow = tradeSheet.getLastRow();
  if (tradeLastRow >= 2) {
    var tData = tradeSheet.getRange(2, 3, tradeLastRow - 1, 1).getValues();
    var tFixed = 0;
    for (var i = 0; i < tData.length; i++) {
      var code = String(tData[i][0] || '');
      var padded = code.padStart(6, '0');
      if (code !== padded && /^\d+$/.test(code)) {
        tradeSheet.getRange(i + 2, 3).setValue(padded);
        tFixed++;
      }
    }
    // 整列设为文本格式
    if (tFixed > 0 || tradeLastRow >= 2) {
      tradeSheet.getRange(2, 3, tradeLastRow - 1, 1).setNumberFormat('@');
    }
    results.trades = tFixed;
  }
  
  // 修复持仓表
  var holdSheet = getHoldingSheet();
  var holdLastRow = holdSheet.getLastRow();
  if (holdLastRow >= 2) {
    var hData = holdSheet.getRange(2, 3, holdLastRow - 1, 1).getValues();
    var hFixed = 0;
    for (var j = 0; j < hData.length; j++) {
      var code = String(hData[j][0] || '');
      var padded = code.padStart(6, '0');
      if (code !== padded && /^\d+$/.test(code)) {
        holdSheet.getRange(j + 2, 3).setValue(padded);
        hFixed++;
      }
    }
    if (hFixed > 0 || holdLastRow >= 2) {
      holdSheet.getRange(2, 3, holdLastRow - 1, 1).setNumberFormat('@');
    }
    results.holdings = hFixed;
  }
  
  return { success: true, data: results };
}

function markHoldingTTradesClosed(code) {
  var tradeSheet = getSheet();
  var lastRow = tradeSheet.getLastRow();
  if (lastRow < 2) return;

  // 读取code列(3)和status列(9)
  var data = tradeSheet.getRange(2, 3, lastRow - 1, 1).getValues();
  var statusData = tradeSheet.getRange(2, 9, lastRow - 1, 1).getValues();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === String(code) && String(statusData[i][0]) === 'open') {
      tradeSheet.getRange(i + 2, 9).setValue('closed');
    }
  }
}

// ===== 可转债打新收益（独立 sheet 存储，与股票交易完全隔离） =====

function getBondSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BOND_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BOND_SHEET_NAME);
    sheet.appendRow(BOND_HEADERS);
    return sheet;
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol < BOND_HEADERS.length) {
    sheet.getRange(1, 1, 1, BOND_HEADERS.length).setValues([BOND_HEADERS]);
  }
  return sheet;
}

function listBonds() {
  var sheet = getBondSheet();
  var data = sheet.getDataRange().getValues();
  var arr = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      arr.push({
        id: String(data[i][0]),
        year: parseInt(data[i][1]) || 0,
        name: String(data[i][2] || ''),
        code: String(data[i][3] || ''),
        market: String(data[i][4] || ''),
        signer: String(data[i][5] || ''),
        qty: parseInt(data[i][6]) || 0,
        profit: parseFloat(data[i][7]) || 0,
        expense: parseFloat(data[i][8]) || 0
      });
    }
  }
  return { success: true, data: arr };
}

function addBond(params) {
  var sheet = getBondSheet();
  var id = String(new Date().getTime());
  var year = parseInt(params.year) || new Date().getFullYear();
  var name = params.name || '';
  var code = params.code || '';
  var market = params.market || '';
  var signer = params.signer || '';
  var qty = parseInt(params.qty) || 0;
  var profit = parseFloat(params.profit) || 0;
  var expense = parseFloat(params.expense) || 0;

  // 先 appendRow 创建行，再设文本格式，最后以文本重写 code
  sheet.appendRow([id, year, name, code, market, signer, qty, profit, expense]);
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 4).setNumberFormat('@'); // code 列
  sheet.getRange(lastRow, 4).setValue(code); // 以文本重写，双保险确保前导0不丢

  return { success: true, id: id };
}

function updateBond(params) {
  var sheet = getBondSheet();
  var id = params.id;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };

  // 列号映射（1-based）：year=2, name=3, code=4, market=5, signer=6, qty=7, profit=8, expense=9
  var colMap = { year: 2, name: 3, code: 4, market: 5, signer: 6, qty: 7, profit: 8, expense: 9 };
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      for (var f in colMap) {
        if (params[f] === undefined) continue;
        var col = colMap[f];
        var cv = params[f];
        if (f === 'year' || f === 'qty') cv = parseInt(cv) || 0;
        if (f === 'profit' || f === 'expense') cv = parseFloat(cv) || 0;
        var cell = sheet.getRange(i + 2, col);
        cell.setValue(cv);
        if (f === 'code') cell.setNumberFormat('@');
      }
      break;
    }
  }
  return { success: true };
}

function deleteBond(id) {
  var sheet = getBondSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      break;
    }
  }
  return { success: true };
}





// ===== 融资余额数据（Google Sheets 存储） =====

function getMarginSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MARGIN_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MARGIN_SHEET_NAME);
    sheet.appendRow(MARGIN_HEADERS);
  }
  return sheet;
}

function fetchMarginData() {
  var sheet = getMarginSheet();
  var data = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var d = data[i][0];
    var dateStr;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      dateStr = d;
    } else {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      dateStr = y + '-' + m + '-' + day;
    }
    result.push({ date: dateStr, balance: Number(data[i][1]) || 0 });
  }
  result.sort(function(a, b) { return a.date.localeCompare(b.date); });
  return { success: true, data: result };
}

// 从金十数据 API 实时抓取并更新融资余额
function refreshMarginFromJin10() {
  try {
    // 上海
    var respSH = UrlFetchApp.fetch('https://cdn.jin10.com/data_center/reports/fs_1.json', { muteHttpExceptions: true });
    var shData = JSON.parse(respSH.getContentText());
    // 深圳
    var respSZ = UrlFetchApp.fetch('https://cdn.jin10.com/data_center/reports/fs_2.json', { muteHttpExceptions: true });
    var szData = JSON.parse(respSZ.getContentText());

    var shValues = shData.values;
    var szValues = szData.values;

    // 读取 Sheet 现有日期
    var sheet = getMarginSheet();
    var data = sheet.getDataRange().getValues();
    var existingDates = {};
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var ds;
      if (typeof data[i][0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data[i][0])) {
        ds = data[i][0];
      } else {
        var y = data[i][0].getFullYear();
        var m = String(data[i][0].getMonth() + 1).padStart(2, '0');
        var d = String(data[i][0].getDate()).padStart(2, '0');
        ds = y + '-' + m + '-' + d;
      }
      existingDates[ds] = true;
    }

    // 找到 Sheet 中最新的日期，只补这之后的数据
    var lastExistingDate = '';
    var existingKeys = Object.keys(existingDates).sort();
    if (existingKeys.length > 0) {
      lastExistingDate = existingKeys[existingKeys.length - 1];
    }

    // values[index]: [融资买入额, 融资余额, 融券卖出量, 融券余量, 融券余额, 融资融券余额]
    // 智能补全：只处理 Sheet 最后日期之后的数据（不回溯历史）
    var allDates = Object.keys(shValues).sort();  // 按日期升序
    var addedCount = 0;
    var updatedCount = 0;
    var latestDate = '';
    var latestBalance = 0;

    for (var j = 0; j < allDates.length; j++) {
      var date = allDates[j];
      if (!szValues[date]) continue;  // 沪深必须都有数据
      if (lastExistingDate && date < lastExistingDate) continue;  // 跳过历史数据

      var shBalance = Number(shValues[date][1]);
      var szBalance = Number(szValues[date][1]);
      var total = Math.round((shBalance + szBalance) / 1e8);

      latestDate = date;
      latestBalance = total;

      if (existingDates[date]) {
        // 更新已有日期（覆盖最新余额）
        for (var r = 1; r < data.length; r++) {
          var match = data[r][0];
          if (typeof match === 'string' && match === date) {
            sheet.getRange(r + 1, 2).setValue(total);
            break;
          }
        }
        updatedCount++;
      } else {
        sheet.appendRow([date, total]);
        existingDates[date] = true;
        addedCount++;
      }
    }

    // 按日期排序（新追加的行可能乱序）
    if (addedCount > 0) {
      var allData = sheet.getDataRange().getValues();
      var header = allData[0];
      var rows = allData.slice(1);
      rows.sort(function(a, b) {
        var da = typeof a[0] === 'string' ? a[0] : '';
        var db = typeof b[0] === 'string' ? b[0] : '';
        return da.localeCompare(db);
      });
      var sorted = [header];
      for (var k = 0; k < rows.length; k++) {
        sorted.push(rows[k]);
      }
      sheet.getRange(1, 1, sorted.length, 2).setValues(sorted);
    }

    return {
      success: true,
      date: latestDate,
      balance: latestBalance,
      added: addedCount,
      updated: updatedCount
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ===== 账户余额相关功能 =====

// 获取账户余额（从 PropertiesService 读取）
function getBalance() {
  var props = PropertiesService.getScriptProperties();
  var normalBalance = parseFloat(props.getProperty('balance_normal')) || 0;
  var marginBalance = parseFloat(props.getProperty('balance_margin')) || 0;
  return { success: true, data: { normal: normalBalance, margin: marginBalance } };
}

// 设置账户余额
function setBalance(params) {
  var accType = params.accountType || 'normal';
  var balance = parseFloat(params.balance) || 0;
  if (balance < 0) balance = 0;
  var key = 'balance_' + accType;
  PropertiesService.getScriptProperties().setProperty(key, balance.toFixed(2));
  return { success: true, accountType: accType, balance: balance };
}

