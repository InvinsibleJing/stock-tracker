/**
 * 股票交易记录 - Google Sheets API (v5.3)
 *
 * v5.3 更新（不等量做T）：
 * - doT函数新增 sellQty/buyQty/sellPrice/buyPrice 参数
 * - 不等量做T时：交易记录amount存差价法盈亏（展示用），成本冲减用现金流法
 * - 不等量做T时：持仓量 = 原持仓 - 卖出量 + 买入量
 * - 兼容旧逻辑：不传sellQty/buyQty时走原等量做T逻辑
 *
 * 历史版本说明见原文件头注释
 */

var SHEET_NAME = '交易记录';
var HOLDING_SHEET_NAME = '当前持仓';
var NOTES_SHEET_NAME = '备忘笔记';
var NOTES_HEADERS = ['id', 'date', 'code', 'content', 'createdAt'];
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
      // ===== 备忘笔记相关 =====
      case 'getNotes':
        result = getNotes();
        break;
      case 'addNote':
        result = addNote(e.parameter);
        break;
      case 'updateNote':
        result = updateNote(e.parameter);
        break;
      case 'deleteNote':
        result = deleteNote(e.parameter.id);
        break;
      case 'searchNotes':
        result = searchNotes(e.parameter.keyword);
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

  sheet.appendRow([id, date, code, tag, quantity, amount, note, tIndex, status, source, fees]);

  // 日期列和代码列存为文本（防止002600变成2600）
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 2).setNumberFormat('@STRING@');
  sheet.getRange(lastRow, 3).setNumberFormat('@STRING@');

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
      cell.setValue(cellValue);
      if (field === 'date' || field === 'code') cell.setNumberFormat('@STRING@');
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

  sheet.appendRow([id, date, code, tag, quantity, note, buyPrice, accountType, lastAddDate, lastAddQty]);

  // 日期列和代码列存为文本（防止002600变成2600）
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 2).setNumberFormat('@STRING@');
  sheet.getRange(lastRow, 3).setNumberFormat('@STRING@');

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
      cell.setValue(cellValue);
      if (field === 'date' || field === 'code') cell.setNumberFormat('@STRING@');
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
        cell.setValue(cellValue);
        if (field === 'date' || field === 'code') cell.setNumberFormat('@STRING@');
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
  tradeSheet.appendRow([tradeId, todayStr, holding.code, holding.tag, clearQty, amount, finalNote, 0, 'closed', 'clear', fees]);
  var tLastRow = tradeSheet.getLastRow();
  tradeSheet.getRange(tLastRow, 2).setNumberFormat('@STRING@');
  tradeSheet.getRange(tLastRow, 3).setNumberFormat('@STRING@');

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
  tradeSheet.appendRow([tradeId, todayStr, holding.code, holding.tag, doTQty, amount, tNote, tIndex, 'open', 'doT', fees]);
  var tLastRow = tradeSheet.getLastRow();
  tradeSheet.getRange(tLastRow, 2).setNumberFormat('@STRING@');
  tradeSheet.getRange(tLastRow, 3).setNumberFormat('@STRING@');

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
      tradeSheet.getRange(2, 3, tradeLastRow - 1, 1).setNumberFormat('@STRING@');
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
      holdSheet.getRange(2, 3, holdLastRow - 1, 1).setNumberFormat('@STRING@');
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

// ===== 备忘笔记相关功能 =====

// 获取备忘笔记工作表（自动创建）
function getNotesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NOTES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(NOTES_SHEET_NAME);
    sheet.appendRow(NOTES_HEADERS);
    return sheet;
  }

  // 检查表头是否正确
  var lastCol = sheet.getLastColumn();
  if (lastCol < NOTES_HEADERS.length) {
    sheet.getRange(1, 1, 1, NOTES_HEADERS.length).setValues([NOTES_HEADERS]);
  }

  return sheet;
}

// 查询所有笔记
function getNotes() {
  var sheet = getNotesSheet();
  var data = sheet.getDataRange().getValues();
  var notes = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      notes.push({
        id: String(data[i][0]),
        date: String(data[i][1] || ''),
        code: String(data[i][2] || ''),
        content: String(data[i][3] || ''),
        createdAt: String(data[i][4] || '')
      });
    }
  }
  return { success: true, data: notes };
}

// 添加笔记
function addNote(params) {
  var sheet = getNotesSheet();
  var id = String(new Date().getTime());
  var date = params.date || '';
  var code = params.code || '';
  var content = params.content || '';
  var createdAt = new Date().toISOString();

  sheet.appendRow([id, date, code, content, createdAt]);

  return { success: true, id: id };
}

// 更新笔记
function updateNote(params) {
  var sheet = getNotesSheet();
  var id = params.id;
  var field = params.field;
  var value = params.value;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };

  // 列号映射（1-based）：date=2, code=3, content=4, createdAt=5
  var colMap = { date: 2, code: 3, content: 4 };
  var col = colMap[field];
  if (!col) return { success: true };

  // 只读取ID列定位行
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sheet.getRange(i + 2, col).setValue(value);
      break;
    }
  }
  return { success: true };
}

// 删除笔记
function deleteNote(id) {
  var sheet = getNotesSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true };

  // 只读取ID列定位行
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      break;
    }
  }
  return { success: true };
}

// 搜索笔记
function searchNotes(keyword) {
  var sheet = getNotesSheet();
  var data = sheet.getDataRange().getValues();
  var notes = [];

  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;

    var date = String(data[i][1] || '');
    var code = String(data[i][2] || '');
    var content = String(data[i][3] || '');

    // 如果有关键词，进行模糊匹配
    if (keyword && keyword !== '') {
      var kw = keyword.toLowerCase();
      if (date.toLowerCase().indexOf(kw) === -1 &&
          code.toLowerCase().indexOf(kw) === -1 &&
          content.toLowerCase().indexOf(kw) === -1) {
        continue;
      }
    }

    notes.push({
      id: String(data[i][0]),
      date: date,
      code: code,
      content: content,
      createdAt: String(data[i][4] || '')
    });
  }

  return { success: true, data: notes };
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

  sheet.appendRow([id, year, name, code, market, signer, qty, profit, expense]);

  // 转债代码存为文本（防止前导零丢失，如 113692 不会被当成数字）
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 4).setNumberFormat('@');

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

// ============================================================
// 【一次性手动导入函数】—— 不通过 Web App，仅在 GAS 编辑器里
//  选中本函数后点「▶ 运行」执行一次即可，无需重新部署 GAS。
//  数据来源：用户 Notion 导出的 CSV，按年分批给，我逐年追加到
//            BOND_IMPORT_DATA 数组里，用户每年 Run 一次即可。
//  字段映射：name/code/market/signer/qty/profit/expense 照 CSV 原样；
//            market: 深→深市, 沪→沪市；未卖的盈利/支出为空→0。
//  【安全】只清空「本次 BOND_IMPORT_DATA 包含的年份」对应的旧行，
//            其他年份的数据原样保留，绝不会弄丢已导入的历史数据。
// ============================================================

var BOND_IMPORT_DATA = [
  { year: 2026, name: '尚太转债', code: '127112', market: '深市', signer: '丁宇航', qty: 10, profit: 570, expense: 100 },
  { year: 2026, name: '尚太转债', code: '127112', market: '深市', signer: '张靖',   qty: 10, profit: 570, expense: 0 },
  { year: 2026, name: '统联转债', code: '118066', market: '沪市', signer: '陈兆阳', qty: 10, profit: 360, expense: 120 },
  { year: 2026, name: '统联转债', code: '118066', market: '沪市', signer: '于诗魁', qty: 10, profit: 380, expense: 0 },
  { year: 2026, name: '长高转债', code: '127113', market: '深市', signer: '张靖',   qty: 10, profit: 470, expense: 0 },
  { year: 2026, name: '春风转债', code: '113704', market: '沪市', signer: '于诗魁', qty: 10, profit: 570, expense: 0 },
  { year: 2026, name: '南芯转债', code: '118070', market: '沪市', signer: '于诗魁', qty: 10, profit: 0,   expense: 0 },
  { year: 2026, name: '宝钛转债', code: '110101', market: '沪市', signer: '陈兆阳', qty: 10, profit: 0,   expense: 0 },
  { year: 2026, name: '宝钛转债', code: '110101', market: '沪市', signer: '靖鹏新', qty: 10, profit: 0,   expense: 0 },
  { year: 2026, name: '宜化转债', code: '127114', market: '深市', signer: '靖艳昭', qty: 10, profit: 0,   expense: 0 },
  // ===== 2023 年（67 条，格式规范，含代码/市场/中签人/支出）=====
  { year: 2023, name: "天合转债", code: "118031", market: "沪市", signer: "张超", qty: 10, profit: 170, expense: 0 },
  { year: 2023, name: "爱玛转债", code: "113666", market: "沪市", signer: "张超", qty: 10, profit: 370, expense: 0 },
  { year: 2023, name: "爱玛转债", code: "113666", market: "沪市", signer: "靖艳秋", qty: 10, profit: 350, expense: 0 },
  { year: 2023, name: "天合转债", code: "118031", market: "沪市", signer: "井洪涛", qty: 10, profit: 170, expense: 0 },
  { year: 2023, name: "天合转债", code: "118031", market: "沪市", signer: "李日升", qty: 10, profit: 170, expense: 0 },
  { year: 2023, name: "爱玛转债", code: "113666", market: "沪市", signer: "李日升", qty: 10, profit: 370, expense: 0 },
  { year: 2023, name: "爱玛转债", code: "113666", market: "沪市", signer: "靖艳昭", qty: 10, profit: 350, expense: 0 },
  { year: 2023, name: "天合转债", code: "118031", market: "沪市", signer: "陈兆阳", qty: 10, profit: 0, expense: 0 },
  { year: 2023, name: "精测转债", code: "123176", market: "深市", signer: "李日升", qty: 10, profit: 300, expense: 0 },
  { year: 2023, name: "新港转债", code: "111013", market: "沪市", signer: "靖艳秋", qty: 10, profit: 573, expense: 0 },
  { year: 2023, name: "亚科转债", code: "127082", market: "深市", signer: "陈兆阳", qty: 10, profit: 180, expense: 0 },
  { year: 2023, name: "神马转债", code: "110093", market: "沪市", signer: "张超", qty: 10, profit: 185, expense: 0 },
  { year: 2023, name: "华特转债", code: "118033", market: "沪市", signer: "张靖", qty: 10, profit: 573, expense: 0 },
  { year: 2023, name: "华特转债", code: "118033", market: "沪市", signer: "井洪涛", qty: 10, profit: 560, expense: 0 },
  { year: 2023, name: "海顺转债", code: "123183", market: "深市", signer: "张靖", qty: 10, profit: 210, expense: 0 },
  { year: 2023, name: "海顺转债", code: "123183", market: "深市", signer: "张洪涛", qty: 10, profit: 210, expense: 0 },
  { year: 2023, name: "山路转债", code: "127083", market: "深市", signer: "田园", qty: 10, profit: 186, expense: 0 },
  { year: 2023, name: "柳工转2", code: "127084", market: "深市", signer: "田园", qty: 10, profit: 248, expense: 0 },
  { year: 2023, name: "柳工转2", code: "127084", market: "深市", signer: "张超", qty: 10, profit: 200, expense: 0 },
  { year: 2023, name: "道氏转2", code: "123190", market: "深市", signer: "谭思宇", qty: 10, profit: 98, expense: 0 },
  { year: 2023, name: "道氏转2", code: "123190", market: "深市", signer: "井洪涛", qty: 10, profit: 110, expense: 0 },
  { year: 2023, name: "道氏转2", code: "123190", market: "深市", signer: "张超", qty: 10, profit: 100, expense: 300 },
  { year: 2023, name: "道氏转2", code: "123190", market: "深市", signer: "李柠月", qty: 10, profit: 120, expense: 0 },
  { year: 2023, name: "蓝晓转2", code: "123195", market: "深市", signer: "田园", qty: 10, profit: 360, expense: 0 },
  { year: 2023, name: "正元转债", code: "123196", market: "深市", signer: "靖鹏新", qty: 10, profit: 360, expense: 0 },
  { year: 2023, name: "晶能转债", code: "118034", market: "沪市", signer: "陈兆阳", qty: 10, profit: 200, expense: 100 },
  { year: 2023, name: "晶能转债", code: "118034", market: "沪市", signer: "靖鹏新", qty: 10, profit: 200, expense: 0 },
  { year: 2023, name: "晶能转债", code: "118034", market: "沪市", signer: "靖艳秋", qty: 10, profit: 200, expense: 0 },
  { year: 2023, name: "晶能转债", code: "118034", market: "沪市", signer: "于诗魁", qty: 10, profit: 200, expense: 0 },
  { year: 2023, name: "金埔转债", code: "123198", market: "深市", signer: "张超", qty: 10, profit: 358, expense: 0 },
  { year: 2023, name: "金埔转债", code: "123198", market: "深市", signer: "陈兆阳", qty: 10, profit: 348, expense: 0 },
  { year: 2023, name: "恒邦转债", code: "127086", market: "深市", signer: "田园", qty: 10, profit: 230, expense: 0 },
  { year: 2023, name: "恒邦转债", code: "127086", market: "深市", signer: "谭思宇", qty: 10, profit: 230, expense: 0 },
  { year: 2023, name: "力合转债", code: "118036", market: "沪市", signer: "李柠月", qty: 10, profit: 270, expense: 100 },
  { year: 2023, name: "晶澳传债", code: "127089", market: "深市", signer: "陈兆阳", qty: 10, profit: 170, expense: 0 },
  { year: 2023, name: "晶澳传债", code: "127089", market: "深市", signer: "靖艳秋", qty: 10, profit: 170, expense: 0 },
  { year: 2023, name: "晶澳传债", code: "127089", market: "深市", signer: "张靖", qty: 10, profit: 170, expense: 0 },
  { year: 2023, name: "福蓉转债", code: "113672", market: "沪市", signer: "谭思宇", qty: 10, profit: 660, expense: 0 },
  { year: 2023, name: "福蓉转债", code: "113672", market: "沪市", signer: "李易东", qty: 10, profit: 720, expense: 0 },
  { year: 2023, name: "众和转债", code: "110094", market: "沪市", signer: "李日升", qty: 10, profit: 250, expense: 0 },
  { year: 2023, name: "晶澳传债", code: "127089", market: "深市", signer: "靖艳昭", qty: 10, profit: 60, expense: 0 },
  { year: 2023, name: "孩王转债", code: "123208", market: "深市", signer: "谭思宇", qty: 10, profit: 230, expense: 0 },
  { year: 2023, name: "燃23转", code: "113067", market: "沪市", signer: "张超", qty: 10, profit: 180, expense: 0 },
  { year: 2023, name: "燃23转", code: "113067", market: "沪市", signer: "靖艳秋", qty: 10, profit: 190, expense: 0 },
  { year: 2023, name: "燃23转", code: "113067", market: "沪市", signer: "李易东", qty: 10, profit: 180, expense: 0 },
  { year: 2023, name: "燃23转", code: "113067", market: "沪市", signer: "李日升", qty: 10, profit: 180, expense: 0 },
  { year: 2023, name: "东宝转债", code: "123214", market: "深市", signer: "谭思宇", qty: 10, profit: 195, expense: 0 },
  { year: 2023, name: "铭利转债", code: "123215", market: "深市", signer: "谭思宇", qty: 10, profit: 173, expense: 0 },
  { year: 2023, name: "双良转债", code: "110095", market: "沪市", signer: "丁宇航", qty: 10, profit: 154, expense: 0 },
  { year: 2023, name: "双良转债", code: "110095", market: "沪市", signer: "井洪涛", qty: 10, profit: 154, expense: 0 },
  { year: 2023, name: "富仕转债", code: "123217", market: "深市", signer: "田园", qty: 10, profit: 230, expense: 0 },
  { year: 2023, name: "奥维转债", code: "118042", market: "沪市", signer: "于诗魁", qty: 10, profit: 186, expense: 0 },
  { year: 2023, name: "新23转债", code: "113675", market: "沪市", signer: "陈兆阳", qty: 10, profit: 300, expense: 300 },
  { year: 2023, name: "中富转债", code: "123226", market: "深市", signer: "陈兆阳", qty: 10, profit: 280, expense: 0 },
  { year: 2023, name: "章鼓转债", code: "127093", market: "深市", signer: "田园", qty: 10, profit: 560, expense: 0 },
  { year: 2023, name: "震裕转债", code: "123228", market: "深市", signer: "靖艳秋", qty: 10, profit: 185, expense: 0 },
  { year: 2023, name: "震裕转债", code: "123228", market: "深市", signer: "王雪娇", qty: 10, profit: 200, expense: 0 },
  { year: 2023, name: "国城转债", code: "127019", market: "深市", signer: "于诗魁", qty: 10, profit: -3, expense: 0 },
  { year: 2023, name: "国城转债", code: "127019", market: "深市", signer: "靖艳秋", qty: 10, profit: -3, expense: 0 },
  { year: 2023, name: "国城转债", code: "127019", market: "深市", signer: "陈兆阳", qty: 10, profit: -3, expense: 0 },
  { year: 2023, name: "欧晶转债", code: "127098", market: "深市", signer: "张超", qty: 10, profit: 205, expense: 0 },
  { year: 2023, name: "盛航转债", code: "127099", market: "深市", signer: "张靖", qty: 10, profit: 178, expense: 0 },
  { year: 2023, name: "中能转债", code: "123234", market: "深市", signer: "靖艳秋", qty: 10, profit: 220, expense: 0 },
  { year: 2023, name: "亿田转债", code: "123235", market: "深市", signer: "井洪涛", qty: 10, profit: 230, expense: 0 },
  { year: 2023, name: "豪鹏转债", code: "127101", market: "深市", signer: "丁宇航", qty: 10, profit: 198, expense: 200 },
  { year: 2023, name: "博23转债", code: "113069", market: "沪市", signer: "李易东", qty: 10, profit: 187, expense: 0 },
  { year: 2023, name: "博23转债", code: "113069", market: "沪市", signer: "张洪涛", qty: 10, profit: 185, expense: 0 },
  { year: 2024, name: "东南转债", code: "127103", market: "深市", signer: "谭思宇", qty: 10, profit: 80, expense: 0 },
  { year: 2024, name: "佳禾转债", code: "123237", market: "深市", signer: "井洪涛", qty: 10, profit: 44, expense: 0 },
  { year: 2024, name: "楚天转债", code: "123240", market: "深市", signer: "王雪娇", qty: 10, profit: 130, expense: 0 },
  { year: 2024, name: "龙星转债", code: "127105", market: "深市", signer: "靖艳昭", qty: 10, profit: 18, expense: 0 },
  { year: 2024, name: "升24转债", code: "113685", market: "沪市", signer: "靖艳秋", qty: 10, profit: 60, expense: 0 },
  { year: 2024, name: "升24转债", code: "113685", market: "沪市", signer: "丁宇航", qty: 10, profit: 60, expense: 0 },
  { year: 2024, name: "升24转债", code: "113685", market: "沪市", signer: "李易东", qty: 10, profit: 60, expense: 0 },
  { year: 2024, name: "安乃达", code: "603350", market: "沪市", signer: "张靖", qty: 500, profit: 10218, expense: 0 },
  { year: 2024, name: "利杨转债", code: "118048", market: "沪市", signer: "靖艳昭", qty: 10, profit: 230, expense: 0 },
  { year: 2024, name: "赛龙转债", code: "123242", market: "深市", signer: "靖艳昭", qty: 10, profit: 885, expense: 0 },
  { year: 2024, name: "严牌转债", code: "123243", market: "深市", signer: "靖鹏新", qty: 10, profit: 350, expense: 0 },
  { year: 2024, name: "豫光转债", code: "110096", market: "沪市", signer: "田园", qty: 10, profit: 60, expense: 0 },
  { year: 2024, name: "万凯转债", code: "123247", market: "深市", signer: "张超", qty: 10, profit: -68, expense: 0 },
  { year: 2024, name: "万凯转债", code: "123247", market: "深市", signer: "陈兆阳", qty: 10, profit: -68, expense: 0 },
  { year: 2024, name: "万凯转债", code: "123247", market: "深市", signer: "李柠月", qty: 10, profit: -68, expense: 0 },
  { year: 2024, name: "万凯转债", code: "123247", market: "深市", signer: "靖鹏新", qty: 10, profit: -68, expense: 0 },
  { year: 2024, name: "万凯转债", code: "123247", market: "深市", signer: "李日升", qty: 10, profit: -68, expense: 0 },
  { year: 2024, name: "万凯转债", code: "123247", market: "深市", signer: "谭思宇", qty: 10, profit: -68, expense: 0 },
  { year: 2024, name: "万凯转债", code: "123247", market: "深市", signer: "王雪娇", qty: 10, profit: -68, expense: 0 },
  { year: 2024, name: "万凯转债", code: "123247", market: "深市", signer: "靖艳昭", qty: 10, profit: -68, expense: 0 },
  { year: 2024, name: "航宇转债", code: "118050", market: "沪市", signer: "王跃", qty: 10, profit: 0, expense: 0 },
  { year: 2024, name: "英博转债", code: "123249", market: "深市", signer: "张靖", qty: 10, profit: 500, expense: 0 },
  { year: 2024, name: "和邦转债", code: "113691", market: "沪市", signer: "陈兆阳", qty: 10, profit: 20, expense: 20 },
  { year: 2024, name: "和邦转债", code: "113691", market: "沪市", signer: "靖鹏新", qty: 10, profit: 17, expense: 0 },
  { year: 2024, name: "和邦转债", code: "113691", market: "沪市", signer: "田园", qty: 10, profit: 20, expense: 0 },
  { year: 2024, name: "和邦转债", code: "113691", market: "沪市", signer: "于诗魁", qty: 10, profit: 17, expense: 0 },
  { year: 2024, name: "和邦转债", code: "113691", market: "沪市", signer: "靖艳昭", qty: 10, profit: 17, expense: 0 },
  { year: 2024, name: "嘉益转债", code: "123250", market: "深市", signer: "李柠月", qty: 10, profit: 170, expense: 100 },
  { year: 2024, name: "领益转债", code: "127107", market: "深市", signer: "丁宇航", qty: 10, profit: 239, expense: 100 },
  { year: 2024, name: "皓元转债", code: "118051", market: "沪市", signer: "田园", qty: 10, profit: 190, expense: 0 },
  { year: 2025, name: "华医转债", code: "123251", market: "深市", signer: "李日升", qty: 10, profit: 70, expense: 0 },
  { year: 2025, name: "渝水转债", code: "113070", market: "沪市", signer: "靖鹏新", qty: 10, profit: 200, expense: 0 },
  { year: 2025, name: "渝水转债", code: "113070", market: "沪市", signer: "靖艳秋", qty: 10, profit: 200, expense: 0 },
  { year: 2025, name: "渝水转债", code: "113070", market: "沪市", signer: "李日升", qty: 20, profit: 400, expense: 0 },
  { year: 2025, name: "永贵转债", code: "123253", market: "深市", signer: "张超", qty: 10, profit: 180, expense: 0 },
  { year: 2025, name: "永贵转债", code: "123253", market: "深市", signer: "田园", qty: 10, profit: 180, expense: 0 },
  { year: 2025, name: "亿纬转债", code: "123254", market: "深市", signer: "陈兆阳", qty: 10, profit: 140, expense: 0 },
  { year: 2025, name: "亿纬转债", code: "123254", market: "深市", signer: "靖艳秋", qty: 10, profit: 140, expense: 0 },
  { year: 2025, name: "亿纬转债", code: "123254", market: "深市", signer: "谭思宇", qty: 10, profit: 140, expense: 0 },
  { year: 2025, name: "亿纬转债", code: "123254", market: "深市", signer: "王雪娇", qty: 10, profit: 140, expense: 0 },
  { year: 2025, name: "太能转债", code: "127108", market: "深市", signer: "李易东", qty: 10, profit: 100, expense: 0 },
  { year: 2025, name: "太能转债", code: "127108", market: "深市", signer: "谭思宇", qty: 10, profit: 100, expense: 0 },
  { year: 2025, name: "太能转债", code: "127108", market: "深市", signer: "于诗魁", qty: 10, profit: 100, expense: 0 },
  { year: 2025, name: "太能转债", code: "127108", market: "深市", signer: "王跃", qty: 10, profit: 100, expense: 0 },
  { year: 2025, name: "清源转债", code: "113694", market: "沪市", signer: "靖艳秋", qty: 10, profit: 160, expense: 0 },
  { year: 2025, name: "伟测转债", code: "118055", market: "沪市", signer: "丁宇航", qty: 10, profit: 250, expense: 0 },
  { year: 2025, name: "路维转债", code: "118056", market: "沪市", signer: "张洪涛", qty: 10, profit: 350, expense: 0 },
  { year: 2025, name: "伯25转债", code: "113696", market: "沪市", signer: "李易东", qty: 10, profit: 290, expense: 0 },
  { year: 2025, name: "金威转债", code: "127111", market: "深市", signer: "张洪涛", qty: 10, profit: 380, expense: 0 },
  { year: 2025, name: "应流转债", code: "113697", market: "沪市", signer: "靖鹏新", qty: 10, profit: 530, expense: 0 },
  { year: 2025, name: "福能转债", code: "110099", market: "沪市", signer: "张超", qty: 10, profit: 420, expense: 0 },
  { year: 2025, name: "福能转债", code: "110099", market: "沪市", signer: "靖鹏新", qty: 10, profit: 430, expense: 0 },
  { year: 2025, name: "福能转债", code: "110099", market: "沪市", signer: "靖艳昭", qty: 10, profit: 420, expense: 0 },
  { year: 2025, name: "锦浪转债", code: "123259", market: "深市", signer: "于诗魁", qty: 10, profit: 450, expense: 0 },
  { year: 2025, name: "颀中转债", code: "118059", market: "沪市", signer: "张洪涛", qty: 10, profit: 430, expense: 0 },
  { year: 2025, name: "瑞可转债", code: "118060", market: "沪市", signer: "靖艳昭", qty: 10, profit: 560, expense: 0 },
  { year: 2025, name: "神宇转债", code: "123262", market: "深市", signer: "靖艳秋", qty: 10, profit: 480, expense: 0 },
  { year: 2025, name: "神宇转债", code: "123262", market: "深市", signer: "于诗魁", qty: 10, profit: 470, expense: 0 },
  { year: 2025, name: "鼎捷转债", code: "123263", market: "深市", signer: "于诗魁", qty: 10, profit: 480, expense: 0 }
];

// 2022 年为最早年份，原始记录不规范：无代码/市场/中签人/支出，名称多为简记。
// 简写格式 [名称, 中签数量, 盈利金额]；导入时自动去空格、名称补「转债」，
// code/market/signer 留空，expense=0，year 固定 2022。
var BOND_IMPORT_2022_RAW = [
  ['美锦转债',10,115],['浙22转债',10,243],['博汇转债',10,264],['奕瑞转债',10,273],['齐鲁转债',10,-40],
  ['华自转债',10,20],['金田转债',10,60],['杭银转债',10,110],['温氏转债',10,24],['乐普转债',10,100],
  ['东财转债',10,267],['中装转债',10,0],['绿茵转债',10,49],['南银转债',20,360],['嘉美转债',2,43],
  ['江丰转债',10,15],['中特转债',10,137],['博22转债',10,273],['道通转债',10,379],['火星转债',10,173],
  ['锂科转债',10,289],['福22转债',10,182],['正海转债',10,223],['齐鲁转债',10,-50],['首华转债',10,123],
  ['兴业转债',10,99],['成银转债',10,209],['中银转债',10,65],['药石转债',10,298],['美锦转债',10,113],
  ['浙22转债',10,244],['天业转债',10,185],['天赐转债',10,217],['东杰转债',10,317],['兴业转债',10,99],
  ['中特',10,135],['中银',10,65],['禾丰',10,144],['淮22',10,280],['齐鲁',10,-50],
  ['三花',10,310],['南银',10,182],['北港',10,131],['国泰',10,610],['贵燃',10,197],
  ['兴业',20,200],['双箭',10,151],['美锦',10,115],['精工',10,171],['国微',10,430],
  ['嘉美',10,200],['升21',10,360],['兴业',10,101],['中特',10,113],['中银',10,66],
  ['九强',10,286],['国泰',10,750],['康泰',10,196],['闻泰',10,290],['宏发',10,350],
  ['华翔',10,313],['兴业',10,102],['隆基',20,520],['精装',10,259],['成银',10,213],
  ['重银',10,5],['中银',10,65],['博22',10,274],['上银',10,0],['常银',20,369],
  ['兴业',10,100],['通22',10,330],['重银',10,47],['美锦',10,115],['蒙泰',10,420],
  ['立昂',10,290],['兴业',10,100],['中特',10,139],['中银',10,66],['美锦',10,115],
  ['巨星',10,250],['中银',10,66],['永22',10,364],['升21',10,351],['兴业',10,103],
  ['隆基',10,261],['中银',10,66],['贵轮',10,140],['天业',10,188],['常银',10,187],
  ['漱玉',10,175],['上22',10,193],['中银',10,66],['美锦',10,115],['康泰',10,350],
  ['泉峰',10,400],['希望',10,280],['兴业',10,103],['明新',10,175],['裕兴',10,99],
  ['湘佳',10,307],['淮22',10,280],['百川',10,265],['希望2',10,334],['城市',10,247],
  ['锦浪',10,376],['中特',10,107],['重银',10,10],['九强',10,286],['欧22',10,346],
  ['中宠',10,160],['齐鲁',10,-43],['兴业',10,98],['隆22',10,260],['中银',10,66],
  ['美锦',10,114],['拓普',10,467],['常银',10,187]
];

// 汇总所有待导入数据（2026 完整格式 + 2022 简写展开）
function getAllBondImportData() {
  var all = BOND_IMPORT_DATA.slice();
  for (var i = 0; i < BOND_IMPORT_2022_RAW.length; i++) {
    var r = BOND_IMPORT_2022_RAW[i];
    var nm = String(r[0]).replace(/^\s+|\s+$/g, '');
    if (nm.indexOf('转债') === -1) nm = nm + '转债';
    all.push({ year: 2022, name: nm, code: '', market: '', signer: '', qty: r[1], profit: r[2], expense: 0 });
  }
  return all;
}

function importBondsFromData() {
  var sheet = getBondSheet();
  var IMPORT = getAllBondImportData();
  // 收集本次要导入的年份，只清空这些年份的旧数据，保留其他年份
  var yearSet = {};
  for (var i = 0; i < IMPORT.length; i++) {
    yearSet[IMPORT[i].year] = true;
  }
  var years = Object.keys(yearSet);
  // 删除这些年份已有的行（按 year 列匹配，列2）
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var rows = sheet.getRange(2, 1, lastRow - 1, BOND_HEADERS.length).getValues();
    for (var r = rows.length - 1; r >= 0; r--) {
      if (years.indexOf(String(rows[r][1])) !== -1) {
        sheet.deleteRow(r + 2);
      }
    }
  }
  // 写入本次数据
  var count = 0;
  for (var j = 0; j < IMPORT.length; j++) {
    var d = IMPORT[j];
    var id = String(new Date().getTime()) + '_' + j;
    sheet.appendRow([id, d.year, d.name, String(d.code), d.market, d.signer, d.qty, d.profit, d.expense]);
    var rr = sheet.getLastRow();
    sheet.getRange(rr, 4).setNumberFormat('@'); // 代码列存为文本，防前导零丢失
    count++;
  }
  return { success: true, imported: count };
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
