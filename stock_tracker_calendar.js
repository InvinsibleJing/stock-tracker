// ===== 中国农历算法（1900-2100）=====
var GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
var ZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
var SHENGXIAO = ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'];
var WUXING = ['木','木','火','火','土','土','金','金','水','水']; // 天干对应五行
var YUE_LING = ['寅','卯','辰','巳','午','未','申','酉','戌','亥','子','丑']; // 月令地支

// 农历数据 1900-2100，每项4位hex，bit0-3:闰月月份(0=无)，bit4-15:农历月大小(1=30天,0=29天)，bit16-19:闰月大小
var LUNAR_INFO = [
0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2, //1900-1909
0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977, //1910-1919
0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970, //1920-1929
0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950, //1930-1939
0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557, //1940-1949
0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0, //1950-1959
0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0, //1960-1969
0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6, //1970-1979
0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570, //1980-1989
0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0, //1990-1999
0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5, //2000-2009
0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930, //2010-2019
0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530, //2020-2029
0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45, //2030-2039
0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0, //2040-2049
0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0, //2050-2059
0x092e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4, //2060-2069
0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0, //2070-2079
0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160, //2080-2089
0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a4d0,0x0d150,0x0f252, //2090-2099
0x0d520
];

function lunarInfoYear(y){ return LUNAR_INFO[y-1900]; }

function leapMonth(y){
  var info = lunarInfoYear(y);
  return info & 0xf; // bit0-3
}

function leapDays(y){
  if(leapMonth(y)){
    return (lunarInfoYear(y) & 0x10000) ? 30 : 29;
  }
  return 0;
}

function monthDays(y,m){
  // m: 1-12
  if(m > 12 || m < 1) return -1;
  var info = lunarInfoYear(y);
  // bit4-15: 12 bits for 12 months (bit4=month1)
  return (info & (0x10000>>m)) ? 30 : 29;
}

function solarToLunar(yy,mm,dd){
  // 基准：1900年1月31日 = 农历1900年正月初一
  var baseDate = new Date(1900,0,31);
  var objDate = new Date(yy,mm-1,dd);
  var offset = Math.floor((objDate - baseDate)/86400000);
  if(offset < 0) return null;

  var y = 1900, temp = 0, leap = 0;
  for(y=1900; y<2101 && offset>0; y++){
    temp = lYearDays(y);
    offset -= temp;
  }
  if(offset < 0){ offset += temp; y--; }

  leap = leapMonth(y);
  var isLeap = false;

  for(var m=1; m<13 && offset>0; m++){
    if(leap>0 && m===(leap+1) && !isLeap){
      --m;
      isLeap = true;
      temp = leapDays(y);
    } else {
      temp = monthDays(y,m);
    }
    if(isLeap && m===(leap+1)) isLeap = false;
    offset -= temp;
  }

  if(offset===0 && leap>0 && m===leap+1){
    if(isLeap){
      isLeap = false;
    } else {
      isLeap = true;
      --m;
    }
  }
  if(offset < 0){ offset += temp; --m; }

  var lunarY = y, lunarM = m, lunarD = offset + 1;
  return {year:lunarY, month:lunarM, day:lunarD, isLeap:isLeap};
}

function lYearDays(y){
  var sum = 348; // 12*29
  var info = lunarInfoYear(y);
  for(var i=0x8000; i>0x8; i>>=1){ sum += (info & i) ? 1 : 0; }
  return sum + leapDays(y);
}

var LUNAR_MONTH_NAME = ['正','二','三','四','五','六','七','八','九','十','冬','腊'];
var LUNAR_DAY_NAME = ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十',
  '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
  '廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];

function getLunarMonthStr(m){ return LUNAR_MONTH_NAME[m-1]+'月'; }
function getLunarDayStr(d){ return LUNAR_DAY_NAME[d-1]; }

// ===== 干支计算 =====
// 基准：2000-01-01 戊午日 (戊=4, 午=6, 甲=0, 子=0)
var _GZ_BASE_DATE = new Date(2000, 0, 1);
var _GZ_BASE_STEM = 4; // 戊
var _GZ_BASE_BRANCH = 6; // 午

function getYearGanZhi(lunarY){
  var stemIdx = (lunarY - 4) % 10; if(stemIdx<0) stemIdx+=10;
  var branchIdx = (lunarY - 4) % 12; if(branchIdx<0) branchIdx+=12;
  return {gan:GAN[stemIdx], zhi:ZHI[branchIdx], ganElem:WUXING[stemIdx], zhiAnimal:SHENGXIAO[branchIdx]};
}

function getMonthGanZhi(yy, mm, dd){
  // 干支月以节气划分，不是以农历月划分
  // 立春→寅月(1), 惊蛰→卯月(2), 清明→辰月(3), 立夏→巳月(4),
  // 芒种→午月(5), 小暑→未月(6), 立秋→申月(7), 白露→酉月(8),
  // 寒露→戌月(9), 立冬→亥月(10), 大雪→子月(11), 小寒→丑月(12)
  // 各节气近似公历日期（取中间值）
  var stDates = [
    [1,6],   // 小寒 → 丑月开始
    [2,4],   // 立春 → 寅月开始
    [3,6],   // 惊蛰 → 卯月开始
    [4,5],   // 清明 → 辰月开始
    [5,6],   // 立夏 → 巳月开始
    [6,6],   // 芒种 → 午月开始
    [7,7],   // 小暑 → 未月开始
    [8,8],   // 立秋 → 申月开始
    [9,8],   // 白露 → 酉月开始
    [10,8],  // 寒露 → 戌月开始
    [11,7],  // 立冬 → 亥月开始
    [12,7]   // 大雪 → 子月开始
  ];
  // 确定当前处于哪个干支月
  // 干支月序(1=寅, 2=卯, ..., 12=丑)
  var gzMonth = 12; // 默认丑月
  for(var i = stDates.length - 1; i >= 0; i--){
    var stM = stDates[i][0], stD = stDates[i][1];
    if(mm > stM || (mm === stM && dd >= stD)){
      // 找到了，此节气开始的干支月
      // 小寒(1月)→丑月=12, 立春(2月)→寅月=1, ..., 大雪(12月)→子月=11
      gzMonth = i === 0 ? 12 : i;
      break;
    }
  }

  // 年干：干支年从立春开始，立春前仍属上一年
  var lichunM = stDates[1][0], lichunD = stDates[1][1]; // 立春约2月4日
  var yearForStem = yy;
  if(mm < lichunM || (mm === lichunM && dd < lichunD)){
    yearForStem = yy - 1;
  }
  var yearStemIdx = (yearForStem - 4) % 10; if(yearStemIdx < 0) yearStemIdx += 10;

  // 月干公式（五虎遁）：甲己年丙寅月起, 乙庚年戊寅月起, 丙辛年庚寅月起, 丁壬年壬寅月起, 戊癸年甲寅月起
  var monthStemBase = ((yearStemIdx % 5) * 2 + 2) % 10;
  // 寅月序=1, 干支月序从1开始
  var monthStemIdx = (monthStemBase + gzMonth - 1) % 10;

  // 月支：寅=2, 卯=3, ..., 丑=1
  var monthBranchIdx = (gzMonth + 1) % 12;

  return {gan:GAN[monthStemIdx], zhi:ZHI[monthBranchIdx], ganElem:WUXING[monthStemIdx], zhiAnimal:SHENGXIAO[monthBranchIdx]};
}

function getDayGanZhi(yy,mm,dd){
  var d = new Date(yy, mm-1, dd);
  var diff = Math.round((d - _GZ_BASE_DATE) / 86400000);
  var dayStemIdx = (_GZ_BASE_STEM + diff % 10 + 10) % 10;
  var dayBranchIdx = (_GZ_BASE_BRANCH + diff % 12 + 12) % 12;
  return {gan:GAN[dayStemIdx], zhi:ZHI[dayBranchIdx], ganElem:WUXING[dayStemIdx], zhiAnimal:SHENGXIAO[dayBranchIdx]};
}

// ===== 二十四节气 =====
function getSolarTerm(yy,mm,dd){
  // 近似值表（公历月份对应节气，简化显示）
  var stDates = {
    1:[6,20], 2:[4,19], 3:[6,21], 4:[5,20], 5:[6,21], 6:[6,21],
    7:[7,23], 8:[7,23], 9:[8,23], 10:[8,23], 11:[7,22], 12:[7,22]
  };
  var stNames = [
    ['小寒','大寒'],['立春','雨水'],['惊蛰','春分'],['清明','谷雨'],
    ['立夏','小满'],['芒种','夏至'],['小暑','大暑'],['立秋','处暑'],
    ['白露','秋分'],['寒露','霜降'],['立冬','小雪'],['大雪','冬至']
  ];
  var pair = stDates[mm];
  var names = stNames[mm-1];
  if(dd===pair[0]) return names[0];
  if(dd===pair[1]) return names[1];
  return '';
}

// ===== 五行配色 =====
var ELEM_COLORS = {'木':'#27ae60','火':'#e74c3c','土':'#8B6914','金':'#c9a800','水':'#2980b9'};
// 地支对应的五行：子水丑土寅木卯木辰土巳火午火未土申金酉金戌土亥水
var ZHI_ELEM = ['水','土','木','木','土','火','火','土','金','金','土','水'];

// ===== 时辰干支 =====
// 时辰地支：子(23-1),丑(1-3),寅(3-5),卯(5-7),辰(7-9),巳(9-11),午(11-13),未(13-15),申(15-17),酉(17-19),戌(19-21),亥(21-23)
// 五鼠遁：甲己日起甲子, 乙庚日起丙子, 丙辛日起戊子, 丁壬日起庚子, 戊癸日起壬子
function getHourGanZhi(yy, mm, dd, hh){
  // 时辰地支序号（子=0, 丑=1, ..., 亥=11）
  var hourBranchIdx;
  // 时辰地支：子(23-1),丑(1-3),寅(3-5),卯(5-7),辰(7-9),巳(9-11),午(11-13),未(13-15),申(15-17),酉(17-19),戌(19-21),亥(21-23)
  var hourBranchIdx;
  if(hh >= 23 || hh < 1) hourBranchIdx = 0;
  else if(hh >= 1 && hh < 3) hourBranchIdx = 1;
  else if(hh >= 3 && hh < 5) hourBranchIdx = 2;
  else if(hh >= 5 && hh < 7) hourBranchIdx = 3;
  else if(hh >= 7 && hh < 9) hourBranchIdx = 4;
  else if(hh >= 9 && hh < 11) hourBranchIdx = 5;
  else if(hh >= 11 && hh < 13) hourBranchIdx = 6;
  else if(hh >= 13 && hh < 15) hourBranchIdx = 7;
  else if(hh >= 15 && hh < 17) hourBranchIdx = 8;
  else if(hh >= 17 && hh < 19) hourBranchIdx = 9;
  else if(hh >= 19 && hh < 21) hourBranchIdx = 10;
  else hourBranchIdx = 11;

  // 夜子时(23-1点)：日干用当日（命理主流：夜子时仍属当日）
  var dGz = getDayGanZhi(yy, mm, dd);
  var dayStemIdx = GAN.indexOf(dGz.gan);
  // 五鼠遁：时干起始
  var hourStemBase = (dayStemIdx % 5) * 2;
  var hourStemIdx = (hourStemBase + hourBranchIdx) % 10;
  return {gan:GAN[hourStemIdx], zhi:ZHI[hourBranchIdx], ganElem:WUXING[hourStemIdx]};
}

// 周数计算（ISO周：周一为一周开始，第1周是包含该年第一个周四的那周）
function getWeekNumber(yy, mm, dd){
  var d = new Date(yy, mm-1, dd);
  // 周四偏移法
  var dayNum = d.getDay() || 7; // 周日=7
  d.setDate(d.getDate() + 4 - dayNum);
  var yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(( (d - yearStart) / 86400000 + 1 ) / 7);
}

// 构建干支显示HTML（无生肖，用|分隔）
function buildGanzhiHtml(yGz, mGz, dGz){
  var pc = '#aaa'; // 括号颜色（中性）
  var bc = '#333'; // 年月日颜色（黑色）
  var pipe = '<span class="gz-pipe">|</span>';

  // 地支五行
  var yzIdx = yGz.zhi ? ZHI.indexOf(yGz.zhi) : -1;
  var mzIdx = mGz.zhi ? ZHI.indexOf(mGz.zhi) : -1;
  var dzIdx = dGz.zhi ? ZHI.indexOf(dGz.zhi) : -1;
  var yZhiElem = yzIdx >= 0 ? ZHI_ELEM[yzIdx] : '';
  var mZhiElem = mzIdx >= 0 ? ZHI_ELEM[mzIdx] : '';
  var dZhiElem = dzIdx >= 0 ? ZHI_ELEM[dzIdx] : '';

  function gzPart(gan, ganElem, zhi, zhiElem, label){
    var gc = ELEM_COLORS[ganElem] || '#333';
    var zc = ELEM_COLORS[zhiElem] || '#333';
    var gec = ELEM_COLORS[ganElem] || '#333';
    var zec = ELEM_COLORS[zhiElem] || '#333';
    return '<span class="gz-seg">'
      + '<span style="color:'+gc+'">'+gan+'</span>'
      + '<span style="color:'+pc+'">（</span>'
      + '<span style="color:'+gec+'">'+ganElem+'</span>'
      + '<span style="color:'+pc+'">）</span>'
      + '<span style="color:'+zc+'">'+zhi+'</span>'
      + '<span style="color:'+pc+'">（</span>'
      + '<span style="color:'+zec+'">'+zhiElem+'</span>'
      + '<span style="color:'+pc+'">）</span>'
      + '<span style="color:'+bc+'">'+label+'</span>'
      + '</span>';
  }

  return gzPart(yGz.gan, yGz.ganElem, yGz.zhi, yZhiElem, '年')
    + pipe
    + gzPart(mGz.gan, mGz.ganElem, mGz.zhi, mZhiElem, '月')
    + pipe
    + gzPart(dGz.gan, dGz.ganElem, dGz.zhi, dZhiElem, '日');
}


// 构建时辰显示HTML（天干+地支都带五行属性和颜色，与干支行一致）
function buildHourGzHtml(hGz){
  var pc = '#aaa';
  var gc = ELEM_COLORS[hGz.ganElem] || '#333';
  var gec = ELEM_COLORS[hGz.ganElem] || '#333';
  var zIdx = hGz.zhi ? ZHI.indexOf(hGz.zhi) : -1;
  var zElem = zIdx >= 0 ? ZHI_ELEM[zIdx] : '';
  var zc = ELEM_COLORS[zElem] || '#333';
  var zec = ELEM_COLORS[zElem] || '#333';

  return '<span style="color:'+gc+'">'+hGz.gan+'</span>'
    + '<span style="color:'+pc+'">（</span>'
    + '<span style="color:'+gec+'">'+hGz.ganElem+'</span>'
    + '<span style="color:'+pc+'">）</span>'
    + '<span style="color:'+zc+'">'+hGz.zhi+'</span>'
    + '<span style="color:'+pc+'">（</span>'
    + '<span style="color:'+zec+'">'+zElem+'</span>'
    + '<span style="color:'+pc+'">）</span>时';
}

// 纳音五行（六十甲子 → 三十纳音）
var NAYIN_NAMES = [
  '海中金','炉中火','大林木','路旁土','剑锋金',
  '山头火','涧下水','城头土','白蜡金','杨柳木',
  '泉中水','屋上土','霹雳火','松柏木','长流水',
  '沙中金','山下火','平地木','壁上土','金箔金',
  '覆灯火','天河水','大驿土','钗钏金','桑柘木',
  '大溪水','沙中土','天上火','石榴木','大海水'
];
// 纳音对应的五行属性（与NAYIN_NAMES一一对应）
var NAYIN_ELEM = ['金','火','木','土','金','火','水','土','金','木','水','土','火','木','水','金','火','木','土','金','火','水','土','金','木','水','土','火','木','水'];
// 纳音形象比喻（与NAYIN_NAMES一一对应）
var NAYIN_DESC = [
  '深藏海底之金，沉潜隐匿',
  '炉中冶炼之火，炽烈温养',
  '森林茂盛之木，枝叶繁茂',
  '路边尘土之土，承载万物',
  '剑锋锐利之金，刚强果断',
  '山巅燃烧之火，势不可挡',
  '山涧溪流之水，清澈绵长',
  '城墙坚固之土，稳重厚实',
  '白蜡柔润之金，光泽内敛',
  '杨柳柔韧之木，随风而动',
  '泉水涌出之水，源源不断',
  '屋瓦覆盖之土，遮风挡雨',
  '雷电霹雳之火，迅猛爆发',
  '松柏常青之木，坚韧不凋',
  '江河奔流之水，滔滔不绝',
  '沙里淘洗之金，珍贵难得',
  '山间薪柴之火，温暖持久',
  '平原广袤之木，根深叶茂',
  '墙壁依附之土，稳固支撑',
  '金箔轻薄之金，华美精致',
  '灯盏明亮之火，照亮四方',
  '天河浩瀚之水，广阔无垠',
  '大路通衢之土，通达四方',
  '钗钏装饰之金，精美典雅',
  '桑柘坚韧之木，可作良材',
  '溪涧汇聚之水，清冽甘甜',
  '沙洲堆积之土，聚散无常',
  '太阳照耀之火，普照大地',
  '石榴结实之木，坚硬有果',
  '汪洋浩渺之水，深不可测'
];

function getDayNayin(gan, zhi){
  // 找到干支在六十甲子中的位置(0-59)
  var ganIdx = GAN.indexOf(gan);
  var zhiIdx = ZHI.indexOf(zhi);
  if(ganIdx < 0 || zhiIdx < 0) return {name:'', elem:''};
  var idx = (ganIdx - zhiIdx + 10) % 10; // 地支从寅开始偏移
  // 更直接的方法：遍历60甲子找匹配
  for(var i=0;i<60;i++){
    var g = GAN[i%10];
    var z = ZHI[i%12];
    if(g===gan && z===zhi){
      return {name: NAYIN_NAMES[Math.floor(i/2)], elem: NAYIN_ELEM[Math.floor(i/2)], desc: NAYIN_DESC[Math.floor(i/2)]};
    }
  }
  return {name:'', elem:''};
}

// ===== 二十四节气计算 =====
var JIEQI_NAMES = ['小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'];
// 对应太阳黄经角度: 小寒285°, 大寒300°, ..., 冬至270°
var JIEQI_ANGLES = [285,300,315,330,345,0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270];

function _jdFromDate(y,m,d){
  if(m<=2){ y--; m+=12; }
  var A=Math.floor(y/100), B=2-A+Math.floor(A/4);
  return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+B-1524.5;
}

function _sunLongitude(jd){
  var T=(jd-2451545.0)/36525.0;
  var L0=280.46646+36000.76983*T+0.0003032*T*T;
  var M=357.52911+35999.05029*T-0.0001537*T*T;
  var Mrad=M*Math.PI/180;
  var C=(1.914602-0.004817*T-0.000014*T*T)*Math.sin(Mrad)
       +(0.019993-0.000101*T)*Math.sin(2*Mrad)
       +0.000289*Math.sin(3*Mrad);
  var lng=L0+C;
  var omega=125.04-1934.136*T;
  lng=lng-0.00569-0.00478*Math.sin(omega*Math.PI/180);
  return ((lng%360)+360)%360;
}

function _findSolarTermJD(year, angle){
  // 估算该节气所在的大致JD
  // 春分(angle=0)在3月20日左右，每15°约15.2天
  var idx = JIEQI_ANGLES.indexOf(angle);
  // 基准：春分约3月20日
  var baseMonth = 3, baseDay = 20;
  if(idx >= 0){
    // 从春分(第5个节气，index=5)算偏移
    var offsetFromChunfen = idx - 5;
    // 转换为天数偏移
    var dayOffset = offsetFromChunfen * 15.218;
    var estJD = _jdFromDate(year, baseMonth, baseDay) + dayOffset;
    // 如果估算在1月1日之前，用下一年算
    if(estJD < _jdFromDate(year,1,1) - 5) estJD += 365;
    if(estJD > _jdFromDate(year,12,31) + 5) estJD -= 365;
  } else {
    return 0;
  }
  // 迭代求精
  var jd = estJD;
  for(var i=0;i<50;i++){
    var lng = _sunLongitude(jd);
    var diff = angle - lng;
    if(diff>180) diff-=360;
    if(diff<-180) diff+=360;
    if(Math.abs(diff)<0.0001) break;
    jd += diff / 0.9856;
  }
  return jd;
}

function getSolarTermInfo(y,m,d){
  // 返回 {current:'芒种', dayInTerm:9, next:'夏至', daysToNext:8}
  var todayJDN = Math.floor(_jdFromDate(y,m,d) + 8/24 + 0.5); // 北京时区JDN
  var bestCurrent = null, bestNext = null;
  // 遍历今年和前后一年的节气，找当前和下一个
  for(var yr=y-1; yr<=y+1; yr++){
    for(var i=0;i<24;i++){
      var termJD = _findSolarTermJD(yr, JIEQI_ANGLES[i]);
      var termJDN = Math.floor(termJD + 8/24 + 0.5); // 北京时区节气日
      if(termJDN <= todayJDN){
        if(!bestCurrent || termJDN > bestCurrent.day){
          bestCurrent = {name:JIEQI_NAMES[i], day:termJDN, jd:termJD};
        }
      } else {
        if(!bestNext || termJDN < bestNext.day){
          bestNext = {name:JIEQI_NAMES[i], day:termJDN, jd:termJD};
        }
      }
    }
  }
  var dayInTerm = bestCurrent ? (todayJDN - bestCurrent.day + 1) : 0;
  var daysToNext = bestNext ? (bestNext.day - todayJDN) : 0;
  return {
    current: bestCurrent ? bestCurrent.name : '',
    dayInTerm: dayInTerm,
    next: bestNext ? bestNext.name : '',
    daysToNext: daysToNext
  };
}

// ===== 下一个干支月计算 =====
// 干支月以节气划分：小寒→丑月, 立春→寅月, 惊蛰→卯月, 清明→辰月,
// 立夏→巳月, 芒种→午月, 小暑→未月, 立秋→申月, 白露→酉月,
// 寒露→戌月, 立冬→亥月, 大雪→子月
function getNextGzMonthInfo(y, m, d){
  var monthStartTerms = ['立春','惊蛰','清明','立夏','芒种','小暑','立秋','白露','寒露','立冬','大雪','小寒'];
  var currentGzMonth = getMonthGanZhi(y, m, d);
  var currentZhi = currentGzMonth.zhi;
  var curIdx = YUE_LING.indexOf(currentZhi);
  if(curIdx < 0) return null;
  var nextIdx = (curIdx + 1) % 12;
  var startTermName = monthStartTerms[nextIdx];
  var termAngle = JIEQI_ANGLES[JIEQI_NAMES.indexOf(startTermName)];
  var todayJDN = Math.floor(_jdFromDate(y, m, d) + 8/24 + 0.5);
  for(var si = 0; si < 2; si++){
    var sy = y + si;
    var jd = _findSolarTermJD(sy, termAngle);
    var jdn = Math.floor(jd + 8/24 + 0.5);
    if(jdn > todayJDN){
      var ms = Math.round((jd + 8/24 - 2440587.5) * 86400000);
      var dt = new Date(ms);
      var ny = dt.getUTCFullYear(), nm = dt.getUTCMonth()+1, nd = dt.getUTCDate();
      var nextGz = getMonthGanZhi(ny, nm, nd);
      return { name: nextGz.gan + nextGz.zhi + '月', daysToNext: jdn - todayJDN };
    }
  }
  return null;
}

// ===== 日历显示 =====
var calCurrentDate = new Date();

function updateCalendar(){
  var y = calCurrentDate.getFullYear();
  var m = calCurrentDate.getMonth()+1;
  var d = calCurrentDate.getDate();
  var hh = calCurrentDate.getHours();
  var wd = calCurrentDate.getDay();
  var weekDays = ['日','一','二','三','四','五','六'];

  // 公历
  var weekNum = getWeekNumber(y, m, d);
  document.getElementById('calGregorian').textContent = y+'年'+m+'月'+d+'日';
  document.getElementById('calWeekday').textContent = '星期'+weekDays[wd] + '  第' + weekNum + '周';

  // 农历
  var lunar = solarToLunar(y,m,d);
  if(lunar){
    var lStr = getLunarMonthStr(lunar.month)+getLunarDayStr(lunar.day);
    if(lunar.isLeap) lStr = '闰'+lStr;

    var yGz = getYearGanZhi(y);
    var mGz = getMonthGanZhi(y, m, d);
    var dGz = getDayGanZhi(y,m,d);
    var hGz = getHourGanZhi(y, m, d, hh);

    // 干支行
    document.getElementById('calGanzhi').innerHTML = buildGanzhiHtml(yGz, mGz, dGz);

    // 干支序位（六十甲子中的位置，1-based）+ 天干/地支各按五行着色
    var yStemIdx = GAN.indexOf(yGz.gan), yBranchIdx = ZHI.indexOf(yGz.zhi);
    var yGzPos = ((6 * yStemIdx - 5 * yBranchIdx) % 60 + 60) % 60 + 1;
    var mStemIdx = GAN.indexOf(mGz.gan), mBranchIdx = ZHI.indexOf(mGz.zhi);
    var mGzPos = ((6 * mStemIdx - 5 * mBranchIdx) % 60 + 60) % 60 + 1;
    // 年干支颜色
    var yGanC = ELEM_COLORS[yGz.ganElem] || '#333';
    var yZhiElem = yBranchIdx >= 0 ? ZHI_ELEM[yBranchIdx] : '';
    var yZhiC = ELEM_COLORS[yZhiElem] || '#333';
    // 月干支颜色
    var mGanC = ELEM_COLORS[mGz.ganElem] || '#333';
    var mZhiElem = mBranchIdx >= 0 ? ZHI_ELEM[mBranchIdx] : '';
    var mZhiC = ELEM_COLORS[mZhiElem] || '#333';
    document.getElementById('calGzPos').innerHTML =
      '<span style="color:'+yGanC+'">'+yGz.gan+'</span><span style="color:'+yZhiC+'">'+yGz.zhi+'</span><span style="color:'+yGanC+'">·'+yGzPos+'/60</span>' +
      '<span style="color:#ccc;margin:0 8px">|</span>' +
      '<span style="color:'+mGanC+'">'+mGz.gan+'</span><span style="color:'+mZhiC+'">'+mGz.zhi+'</span><span style="color:'+mGanC+'">·'+mGzPos+'/60</span>';

    // 时辰 + 农历日期 + 五行统计（仅当天显示时辰）
    var now = new Date();
    var isToday = (y === now.getFullYear() && m === now.getMonth()+1 && d === now.getDate());
    if(isToday){
      document.getElementById('calHourGz').innerHTML = buildHourGzHtml(hGz);
    } else {
      document.getElementById('calHourGz').textContent = '';
    }
    document.getElementById('calLunarFull').textContent = lStr;
    // 纳音五行
    var ny = getDayNayin(dGz.gan, dGz.zhi);
    if(ny.name){
      var nc = ELEM_COLORS[ny.elem] || '#e67e22';
      document.getElementById('calWuxingSummary').innerHTML = '<span style="color:'+nc+';font-weight:600">'+ny.name+'</span>'
        + '<span style="color:#888;font-weight:400;margin-left:6px">— '+ny.desc+'</span>';
    } else {
      document.getElementById('calWuxingSummary').textContent = '';
    }
  }

  // 二十四节气
  var jqInfo = getSolarTermInfo(y, m, d);
  if(jqInfo.current){
    document.getElementById('calJqCurrent').textContent = jqInfo.current + '第' + jqInfo.dayInTerm + '天';
  }
  if(jqInfo.next){
    document.getElementById('calJqNext').textContent = '距' + jqInfo.next + '还有' + jqInfo.daysToNext + '天';
  }

  // 下一个干支月倒计时
  var nextGzMonth = getNextGzMonthInfo(y, m, d);
  if(nextGzMonth){
    document.getElementById('calNextGzMonth').textContent = '距' + nextGzMonth.name + '还有' + nextGzMonth.daysToNext + '天';
  } else {
    document.getElementById('calNextGzMonth').textContent = '';
  }

}

function calGoToday(){
  calCurrentDate = new Date();
  updateCalendar();
}

function calGoPrevDay(){
  var d = calCurrentDate;
  calCurrentDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  updateCalendar();
}

function calGoNextDay(){
  var d = calCurrentDate;
  calCurrentDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  updateCalendar();
}

// ===== 日期选择器 =====
var dpYear, dpMonth;

function openDatePicker(){
  dpYear = calCurrentDate.getFullYear();
  dpMonth = calCurrentDate.getMonth()+1;
  renderDatePicker();
  document.getElementById('datePickerModal').classList.add('active');
}

function closeDatePicker(){
  document.getElementById('datePickerModal').classList.remove('active');
}

function dpPrevMonth(){
  dpMonth--;
  if(dpMonth<1){ dpMonth=12; dpYear--; }
  renderDatePicker();
}

function dpNextMonth(){
  dpMonth++;
  if(dpMonth>12){ dpMonth=1; dpYear++; }
  renderDatePicker();
}

function renderDatePicker(){
  var today = new Date();
  var selY = calCurrentDate.getFullYear();
  var selM = calCurrentDate.getMonth()+1;
  var selD = calCurrentDate.getDate();

  document.getElementById('dpMonthYear').textContent = dpYear+'年'+dpMonth+'月';

  // 计算当月第一天是星期几
  var firstDay = new Date(dpYear, dpMonth-1, 1).getDay();
  // 当月天数
  var daysInMonth = new Date(dpYear, dpMonth, 0).getDate();
  // 上月天数
  var prevDays = new Date(dpYear, dpMonth-1, 0).getDate();

  var html = '';
  var weekdays = ['日','一','二','三','四','五','六'];
  weekdays.forEach(function(w){ html += '<div style="font-weight:600;color:#999;font-size:12px">'+w+'</div>'; });

  // 上月补齐
  for(var i=firstDay-1; i>=0; i--){
    var pd = prevDays - i;
    html += '<div class="date-picker-day other-month">'+pd+'</div>';
  }

  // 当月
  for(var d=1; d<=daysInMonth; d++){
    var isToday = (d===today.getDate() && dpMonth===today.getMonth()+1 && dpYear===today.getFullYear());
    var isSelected = (d===selD && dpMonth===selM && dpYear===selY);
    var cls = 'date-picker-day';
    if(isToday) cls += ' today';
    if(isSelected) cls += ' selected';

    // 农历日期提示
    var solarTerm = getSolarTerm(dpYear, dpMonth, d);
    var tipHtml = '';
    if(solarTerm){
      tipHtml = '<div style="font-size:9px;color:#e67e22;line-height:1.2">' + solarTerm + '</div>';
    } else {
      var lunar2 = solarToLunar(dpYear, dpMonth, d);
      if(lunar2){
        tipHtml = '<div style="font-size:9px;color:#c0392b;line-height:1.2">' + getLunarDayStr(lunar2.day) + '</div>';
      }
    }

    html += '<div class="' + cls + '" onclick="dpSelectDay(' + d + ')">' + d + tipHtml + '</div>';
  }

  // 下月补齐
  var totalCells = firstDay + daysInMonth;
  var remain = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for(var i=1; i<=remain; i++){
    html += '<div class="date-picker-day other-month">'+i+'</div>';
  }

  document.getElementById('dpDays').innerHTML = html;
}

function dpSelectDay(d){
  calCurrentDate = new Date(dpYear, dpMonth-1, d);
  updateCalendar();
  closeDatePicker();
}

// 初始化日历
window.addEventListener('DOMContentLoaded', function(){
  updateCalendar();
});
