/**
 * 拼多多果园 - Quantumult X 自动浇水领水滴脚本
 * 版本: v1.1.0 (根据 2026 最新 Python 修复版适配)
 * 改进: 
 *   1. 适配最新偷水/抢水逻辑：包含防空值判断、机器人防狗咬机制与 3 次同一狗位重试。
 *   2. 增强任务列表解析：支持多种奖励类型提取、先自动接受未开启任务再批量领取水滴。
 *   3. 优化首页与水滴查询：更完善的错误码捕捉 (40001 Cookie 过期提示) 与 tubetoken 自动续期。
 *   4. Cookie 智能增量拼接：收窄重写规则至 mobile.yangkeduo.com，安全保存 PDDAccessToken 及全套凭据。
 * 
 * [rewrite_local]
 * ^https?:\/\/mobile\.yangkeduo\.com\/ url script-request-header https://raw.githubusercontent.com/5jwoj/BeRich/main/pdd_orchard.js
 * 
 * [task_local]
 * 0 8,12,18 * * * https://raw.githubusercontent.com/5jwoj/BeRich/main/pdd_orchard.js, tag=拼多多果园, enabled=true
 * 
 * [mitm]
 * hostname = mobile.yangkeduo.com, *.yangkeduo.com
 *
 * ---- Loon 改造说明（hweiei）----
 * 原文件来自 https://github.com/5jwoj/BeRich/blob/main/pdd_orchard.js
 * 只做了环境适配，业务逻辑未改。浇水/偷水已关闭：
 *   浇水 → 由 pdd_guoyuan_loon.js 负责（并发连浇，能浇到 100g 保留线）
 *   偷水 → 好友接口风控风险高，默认不碰
 */

/* ==================== Loon 适配层 v2 ====================
 * 原文件是 Quantumult X 脚本，这里把 QuanX 专有对象接到 Loon：
 *   $task.fetch → $httpClient[get|post|put|delete]
 *   $prefs      → $persistentStore
 *   $notify     → $notification.post
 *
 * ★ 关键：Loon 的这三个对象是运行时注入的变量，不一定是 globalThis 的属性。
 *   所以一律用顶层 var 直接引用（同作用域可见），绝不走 window/globalThis。
 */
var __LOON_PS = (typeof $persistentStore !== 'undefined' && $persistentStore) || null;
var __LOON_NT = (typeof $notification !== 'undefined' && $notification) || null;
var __LOON_HC = (typeof $httpClient !== 'undefined' && $httpClient) || null;

function __safeDone(v) {
    try { if (typeof $done === 'function') $done(v || {}); } catch (e) { }
}

var $prefs = {
    valueForKey: function (k) {
        try { return __LOON_PS ? __LOON_PS.read(k) : null; } catch (e) { return null; }
    },
    setValueForKey: function (v, k) {
        try { return __LOON_PS ? __LOON_PS.write(v, k) : false; } catch (e) { return false; }
    }
};

var $notify = function (title, subtitle, body) {
    try {
        if (__LOON_NT && typeof __LOON_NT.post === 'function') {
            __LOON_NT.post(String(title || ''), String(subtitle || ''), String(body || ''));
        }
    } catch (e) { }
};

var $task = {
    fetch: function (opts) {
        return new Promise(function (resolve, reject) {
            if (!__LOON_HC) { reject(new Error('$httpClient 不可用')); return; }
            var method = String(opts.method || 'GET').toLowerCase();
            var fn = (typeof __LOON_HC[method] === 'function') ? __LOON_HC[method] : __LOON_HC.get;
            if (typeof fn !== 'function') { reject(new Error('$httpClient.' + method + ' 不存在')); return; }
            var req = { url: opts.url, headers: opts.headers || {} };
            if (opts.body !== undefined && opts.body !== null) req.body = opts.body;
            fn.call(__LOON_HC, req, function (err, resp, data) {
                if (err) { reject(new Error(String(err))); return; }
                var code = resp ? (resp.statusCode || resp.status || 0) : 0;
                resolve({ statusCode: code, headers: (resp && resp.headers) || {}, body: data });
            });
        });
    }
};

const VERSION = "v1.1.0-loon.6";
let __missionStat = { total: 0, claim: 0, accept: 0 };
const LOG_PREFIX = `[拼多多果园 ${VERSION}]`;
const DEBUG = true;

const MANOR_BASE = "https://mobile.yangkeduo.com/proxy/api/api";
const UA = "Mozilla/5.0 (Linux; Android 10; Pixel 3 Build/QQ2A.200305.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.106 Mobile Safari/537.36 wxwork/3.0.28 MicroMessenger/6.3.25 Language/zh NetType/WIFI org.telegram.messenger";

const isRequest = (typeof $request !== "undefined") && $request
  && typeof $request.url === "string" && $request.url.length > 0;

// 跨平台存储适配器 (QuanX $prefs / Surge & Loon $persistentStore)
const storage = {
  get: (key) => {
    if (__LOON_PS) {
      try { const v = __LOON_PS.read(key); if (v !== null && v !== undefined) return v; } catch (e) { }
    }
    try {
      if (typeof $prefs !== "undefined" && $prefs && typeof $prefs.valueForKey === "function") {
        return $prefs.valueForKey(key);
      }
    } catch (e) { }
    return null;
  },
  set: (val, key) => {
    if (__LOON_PS) {
      try { return __LOON_PS.write(val, key); } catch (e) { }
    }
    try {
      if (typeof $prefs !== "undefined" && $prefs && typeof $prefs.setValueForKey === "function") {
        return $prefs.setValueForKey(val, key);
      }
    } catch (e) { }
    return false;
  }
};

function log(msg, detail = null) {
  if (!DEBUG) return;
  let time = '';
  try { time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }); }
  catch (e) { time = new Date().toISOString().replace('T', ' ').slice(0, 19); }
  if (detail !== null) {
    let s;
    if (typeof detail === 'object') {
      try { s = JSON.stringify(detail); } catch (e) { s = String(detail); }
      if (s.length > 500) s = s.slice(0, 500) + ` …(共${s.length}字)`;
    } else {
      s = String(detail);
    }
    console.log(`${LOG_PREFIX} [${time}] ${msg} ${s}`);
  } else {
    console.log(`${LOG_PREFIX} [${time}] ${msg}`);
  }
}

// Cookie 工具函数
function parseCookieStr(str) {
  const map = {};
  if (!str) return map;
  str.split(';').forEach(item => {
    const eqIdx = item.indexOf('=');
    if (eqIdx > 0) {
      const k = item.slice(0, eqIdx).trim();
      const v = item.slice(eqIdx + 1).trim();
      if (k) map[k] = v;
    }
  });
  return map;
}

function stringifyCookieMap(map) {
  return Object.keys(map).map(k => `${k}=${map[k]}`).join('; ');
}

// ===== 1. Cookie 抓取（Rewrite 模式：智能融合累积） =====
function getCookie() {
  log(`>>> 拦截到 yangkeduo 请求 (${VERSION}) <<<`);
  if (!$request || !$request.headers) {
    __safeDone({});
    return;
  }

  const url = $request.url || "";
  const headers = $request.headers;
  log("拦截请求 URL:", url);

  // 提取 Header 中的 Cookie
  let cookieHeader = "";
  for (let key in headers) {
    if (key.toLowerCase() === "cookie") {
      cookieHeader = headers[key];
      break;
    }
  }

  log("Header Cookie:", cookieHeader || "(无)");

  // 读取以往积累的 Cookie map
  const oldCookieStr = storage.get("pdd_orchard_cookie") || "";
  const cookieMap = parseCookieStr(oldCookieStr);

  // 将本次拦截到的新 Cookie 增量合并
  const newMap = parseCookieStr(cookieHeader);
  for (let k in newMap) {
    cookieMap[k] = newMap[k];
  }

  // 从 URL query 中解析 pdduid
  const uidInUrl = url.match(/[?&]pdduid=(\d+)/);
  if (uidInUrl && !cookieMap["pdd_user_id"]) {
    cookieMap["pdd_user_id"] = uidInUrl[1];
  }

  const pdduid = cookieMap["pdd_user_id"] || (uidInUrl ? uidInUrl[1] : null);
  const token = cookieMap["PDDAccessToken"];
  const tubetoken = cookieMap["tubetoken"];

  const fullCookieStr = stringifyCookieMap(cookieMap);

  // 保存合并后完整凭据
  storage.set(fullCookieStr, "pdd_orchard_cookie");
  if (pdduid) storage.set(pdduid, "pdd_orchard_uid");
  if (tubetoken) storage.set(tubetoken, "pdd_orchard_tubetoken");

  log(`[凭据累积]\nUID: ${pdduid || "未获取"}\nPDDAccessToken: ${token ? token.slice(0, 12) + '...' : '❌ 未获取'}\nTubeToken: ${tubetoken ? tubetoken.slice(0, 10) + '...' : '❌ 未获取'}`);

  if (pdduid && token) {
    const lastNotified = storage.get("pdd_orchard_notified");
    if (lastNotified !== pdduid + token.slice(0, 8)) {
      storage.set(pdduid + token.slice(0, 8), "pdd_orchard_notified");
      $notify(
        `拼多多果园 ${VERSION} 🎉`,
        "完整 Cookie 抓取成功！",
        `用户ID: ${pdduid}\n包含 PDDAccessToken 的全套凭据已就绪！`
      );
    }
  } else {
    log("[提示] Cookie 凭据持续累积中，尚缺少 PDDAccessToken...");
  }

  __safeDone({});
}

// ===== 2. 封装 QuanX 原生 HTTP 请求 =====
function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const reqOpts = {
      url: options.url,
      method: options.method || "POST",
      headers: (function () {
        const h = Object.assign({
          "User-Agent": UA,
          "Accept": "application/json, text/plain, */*",
          "Content-Type": "application/json;charset=UTF-8",
          "Origin": "https://mobile.yangkeduo.com",
          "Referer": "https://mobile.yangkeduo.com/garden_index_lz_0.html",
        }, options.headers || {});
        // 真实 H5 请求同时带 AccessToken 头；只给 Cookie 时某些接口会判「用户状态异常」
        const mt = String(h.Cookie || "").match(/PDDAccessToken=([^;,\s]+)/);
        if (mt && !h.AccessToken) h.AccessToken = mt[1];
        return h;
      })(),
      body: typeof options.body === "object" ? JSON.stringify(options.body) : options.body
    };

    log(`[HTTP] ${reqOpts.method} ${reqOpts.url}`);

    $task.fetch(reqOpts).then(
      response => {
        log(`[HTTP Response] Status: ${response.statusCode}`);
        let resData = response.body;
        try { resData = JSON.parse(response.body); } catch (e) {}
        resolve(resData);
      },
      reason => {
        log(`[HTTP Error]`, reason);
        reject(reason);
      }
    );
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== 3. 果园自动化业务逻辑 =====

async function getWater(pdduid, cookieStr) {
  const url = `${MANOR_BASE}/manor-gateway/manor/query/user/water?pdduid=${pdduid}&is_back=1`;
  try {
    const res = await httpRequest({ url, headers: { "Cookie": cookieStr }, body: {} });
    return (res && typeof res.water_amount === "number") ? res.water_amount : 0;
  } catch (e) { return 0; }
}

async function getHomePage(pdduid, cookieStr, tubetoken) {
  log("--- [1/6] 刷新果园首页数据 ---");
  const url = `${MANOR_BASE}/manor-query/proxy/home/page?pdduid=${pdduid}`;
  const body = {
    "mission_type": 0, "fun_id": "wechat_app_home",
    "message_source": null, "page_type": "HOME_PAGE",
    "push_source_mission_type": 0, "fruit_config_version": "",
    "unlock_scene_version": "", "app_home_click_icon_type": null,
    "tubetoken": tubetoken, "push_act_source": null,
    "need_show_home_popup": true, "fun_pl": 2
  };

  try {
    const res = await httpRequest({ url, headers: { "Cookie": cookieStr }, body });
    const _h = (res && res.user_manor_info) || {};
    log(`[首页] 响应摘要: error=${res ? res.error_code : 'null'} uid=${_h.uid || '-'} water=${_h.water_amount !== undefined ? _h.water_amount : '-'} level=${_h.product ? _h.product.level : '-'}`);
    if (!res || res.error_code || !_h.uid) { log("[首页] 原始响应:", res); }
    if (res && res.error_code === 40001) {
      log("[错误] 40001 - Cookie 无效或 PDDAccessToken 缺失/过期！");
      return { newToken: null, water: 0 };
    }
    // 2026 版把真实数据包在 user_manor_info 里，顶层只有 server_time。
    // 旧逻辑直接读 res.water_amount / res.tubetoken 永远拿到 undefined。
    const info = (res && res.user_manor_info) || res || {};
    const realUid = info.uid || (res && res.uid) || null;
    const newToken = info.tubetoken || (res && res.tubetoken) || tubetoken;
    const water = (typeof info.water_amount === 'number') ? info.water_amount
                : ((res && typeof res.water_amount === 'number') ? res.water_amount : 0);
    log(`[首页成功] uid: ${realUid || '未返回'} | 水滴: ${water} | TubeToken: ${newToken ? String(newToken).slice(0, 10) + '...' : '无'}`);
    return { newToken, water, uid: realUid };
  } catch (e) {
    log("[首页异常]", e);
    return { newToken: null, water: 0 };
  }
}

async function dailyCheckin(pdduid, cookieStr, tubetoken) {
  log("--- [2/6] 每日签到 ---");
  try {
    const res = await httpRequest({
      url: `${MANOR_BASE}/manor/common/apply/activity?pdduid=${pdduid}`,
      headers: { "Cookie": cookieStr },
      body: { "type": 201811, "params": { "ui_id": 3, "type": 2 }, "fun_id": "wechat_app_home", "tubetoken": tubetoken, "fun_pl": 2 }
    });
    log(`[签到] error=${res ? res.error_code : 'null'} success=${res ? res.success : '-'} msg=${(res && res.error_msg) || '-'}`);
    if (res && res.error_code) { log("[签到] 原始响应:", res); }
    if (res && res.success) { log("[签到] 成功！"); return true; }
    log("[签到] 今日已签到:", res ? res.error_msg : "");
    return false;
  } catch (e) { log("[签到异常]", e); return false; }
}

async function waterTree(pdduid, cookieStr, tubetoken, maxTimes = 50) {
  log("--- [3/6] 自动浇水 ---");
  let water = await getWater(pdduid, cookieStr);
  log(`当前水滴: ${water}`);
  if (water < 10) { log("水滴不足10，跳过浇水"); return 0; }

  const count = Math.min(maxTimes, Math.floor(water / 10));
  let watered = 0;

  for (let i = 0; i < count; i++) {
    try {
      const res = await httpRequest({
        url: `${MANOR_BASE}/manor/water/cost?pdduid=${pdduid}`,
        headers: { "Cookie": cookieStr },
        body: {
          "atw": true, "location_auth": false, "last_stay_time": 10 + i * 4,
          "can_trigger_random_mission": false, "product_scene": 0, "minor": false,
          "ext_params": { "can_trigger201824": true }, "mission_type": 0,
          "cost_water_amount": 10, "merge_cost": false, "fun_id": "wechat_app_home",
          "lower_end_device": false, "cost_water_competition_in_scene_icon": false,
          "is_small_screen": true, "tubetoken": tubetoken, "fun_pl": 2
        }
      });
      const left = (res && typeof res.now_water_amount === "number") ? res.now_water_amount : null;
      if (left !== null && left < water) {
        water = left; watered++;
        log(`[浇水] 第 ${watered}/${count} 次，剩余: ${left}`);
        if (left < 10) break;
        await sleep(300);
      } else { log("[浇水] 扣水失败或停止:", res); break; }
    } catch (e) { log("[浇水异常]", e); break; }
  }

  const finalWater = await getWater(pdduid, cookieStr);
  log(`[浇水完成] 共 ${watered} 次，最终水滴: ${finalWater}`);
  return watered;
}

async function handleMissions(pdduid, cookieStr, tubetoken) {
  log("--- [4/6] 任务处理 ---");
  const rp = {};
  for (let i = 1; i <= 8; i++) rp[String(i)] = { "needRefresh": true };

  try {
    const MTYPES = [38160,38242,38090,38451,37859,38428,38500,38501,38502,38503,38504,38505,38600,38601,38700,38701,38800,38900,37900,37950,38000,38050,38100,38150];
    const RP = { "act201015EntryInfo": rp, "act201036EntryInfo": rp };
    const strategies = [
      { n: "A原版", b: { "activity_id_list": [201015, 201036], "mission_types": MTYPES, "request_params": RP, "lower_end_device": false, "tubetoken": tubetoken, "fun_pl": 2 } },
      { n: "B无activity_id_list", b: { "mission_types": MTYPES, "request_params": RP, "lower_end_device": false, "tubetoken": tubetoken, "fun_pl": 2 } },
      { n: "C无request_params", b: { "activity_id_list": [201015, 201036], "mission_types": MTYPES, "lower_end_device": false, "tubetoken": tubetoken, "fun_pl": 2 } },
      { n: "D只留tubetoken", b: { "tubetoken": tubetoken, "fun_pl": 2 } },
      { n: "E空body", b: {} }
    ];
    let res = null;
    for (let si = 0; si < strategies.length; si++) {
      const st = strategies[si];
      res = await httpRequest({
        url: `${MANOR_BASE}/manor/mission/list?pdduid=${pdduid}`,
        headers: { "Cookie": cookieStr },
        body: st.b
      });
      const ec = res ? res.error_code : "null";
      const nAct = (res && res.activity_vo_map) ? Object.keys(res.activity_vo_map).length : 0;
      const nMis = (res && res.mission_list) ? (Array.isArray(res.mission_list) ? res.mission_list.length : Object.keys(res.mission_list).length) : 0;
      log(`[任务探测] ${st.n} → error=${ec} 活动=${nAct} 任务=${nMis} msg=${(res && res.error_msg) || "-"}`);
      if (res && !res.error_code) break;
      if (si < strategies.length - 1) await sleep(900);
    }

    const actMap = (res && res.activity_vo_map) ? res.activity_vo_map : {};
    const tasks = [];
    Object.keys(actMap).forEach(aid => {
      const mlist = actMap[aid].mission_list || {};
      Object.keys(mlist).forEach(mid => {
        const m = mlist[mid];
        let rwd = 0, rtype = "";
        const rewardInfo = m.reward_info || [];
        for (const ri of rewardInfo) {
          if (ri.reward_type === 1) {
            rwd = ri.min_reward_amount || 0;
            rtype = "水滴";
            break;
          }
        }
        if (!rwd && rewardInfo.length > 0) {
          for (const ri of rewardInfo) {
            rwd = ri.min_reward_amount || 0;
            rtype = `T${ri.reward_type || '?'}`;
            break;
          }
        }
        tasks.push({
          activity_id: parseInt(aid),
          mission_id: parseInt(mid),
          is_draw: m.is_draw || false,
          is_open: m.is_open || false,
          finished_count: m.finished_count || 0,
          reward_amount: rwd,
          reward_type: rtype
        });
      });
    });

    const canClaim = tasks.filter(t => !t.is_draw && t.is_open && t.finished_count >= 1);
    const needAccept = tasks.filter(t => !t.is_draw && !t.is_open && t.finished_count >= 1);
    log(`[任务] 共${tasks.length}个，可领取${canClaim.length}，待接受${needAccept.length}`);
    __missionStat = { total: tasks.length, claim: canClaim.length, accept: needAccept.length };
    if (!tasks.length) { log("[任务] 原始响应:", res); }

    for (const t of needAccept) {
      log(`[接受任务] act=${t.activity_id} id=${t.mission_id}`);
      await httpRequest({
        url: `${MANOR_BASE}/manor/mission/accept?pdduid=${pdduid}`,
        headers: { "Cookie": cookieStr },
        body: { "mission_id": t.mission_id, "activity_id": t.activity_id, "tubetoken": tubetoken, "fun_pl": 2 }
      });
      await sleep(500);
    }

    let total = 0;
    for (const t of canClaim) {
      const dr = await httpRequest({
        url: `${MANOR_BASE}/manor/mission/draw?pdduid=${pdduid}`,
        headers: { "Cookie": cookieStr },
        body: { "mission_id": t.mission_id, "activity_id": t.activity_id, "tubetoken": tubetoken, "fun_pl": 2 }
      });
      if (dr && dr.success) {
        const amt = dr.water || dr.reward_amount || t.reward_amount;
        total += amt;
        log(`[领取成功] act=${t.activity_id} id=${t.mission_id}: +${amt} ${t.reward_type}`);
      } else {
        log(`[领取失败] act=${t.activity_id} id=${t.mission_id}: ${dr ? dr.error_msg : ''}`);
      }
      await sleep(500);
    }
    return total;
  } catch (e) { log("[任务异常]", e); return 0; }
}

async function stealFromFriends(pdduid, cookieStr, tubetoken) {
  log("--- [5/6] 偷水滴 ---");
  try {
    const listRes = await httpRequest({
      url: `${MANOR_BASE}/manor-query/friend/list/page?pdduid=${pdduid}`,
      headers: { "Cookie": cookieStr },
      body: { "page_num": 1, "tubetoken": tubetoken, "fun_pl": 2 }
    });

    const friendListRaw = (listRes && Array.isArray(listRes.friend_list)) ? listRes.friend_list : [];
    const friends = [];
    for (const f of friendListRaw) {
      if (!f || typeof f !== 'object') continue;
      const stealStatus = f.steal_water_status || {};
      if (stealStatus.status === 2) {
        friends.push({
          uid: f.uid,
          nickname: f.nickname || "未知好友",
          amount: f.amount || 0
        });
      }
    }

    const chanceRes = await httpRequest({
      url: `${MANOR_BASE}/manor/steal/chance/lack?pdduid=${pdduid}`,
      headers: { "Cookie": cookieStr },
      body: { "tubetoken": tubetoken, "fun_pl": 2 }
    });
    const stealInfo = (chanceRes && chanceRes.activity_vo_map) ? (chanceRes.activity_vo_map["201423"] || {}) : {};
    const restChance = typeof stealInfo.rest_chance === 'number' ? stealInfo.rest_chance : 0;
    const robotsRaw = Array.isArray(stealInfo.robots) ? stealInfo.robots : [];
    const robots = [];
    for (const r of robotsRaw) {
      if (!r || typeof r !== 'object') continue;
      robots.push({
        uid: r.uid,
        nickname: r.nickname || "机器人",
        amount: r.water || 0
      });
    }

    const allTargets = [...friends, ...robots];
    log(`[偷水] 剩余次数:${restChance}, 可偷好友:${friends.length}, 机器人:${robots.length}`);
    if (!allTargets.length) { log("[偷水] 没有可偷的目标"); return 0; }

    const maxSteals = restChance > 0 ? Math.min(restChance, allTargets.length) : allTargets.length;
    log(`[偷水] 开始偷水，最多 ${maxSteals} 次...`);

    let totalStolen = 0;
    let stealCount = 0;

    for (let i = 0; i < maxSteals; i++) {
      const t = allTargets[i];
      if (t.amount <= 0) continue;

      const dog = Math.floor(Math.random() * 3) + 1;
      let stolen = 0;

      for (let retry = 0; retry < 3; retry++) {
        const sr = await httpRequest({
          url: `${MANOR_BASE}/manor/steal/water?pdduid=${pdduid}`,
          headers: { "Cookie": cookieStr },
          body: { "friend_uid": t.uid, "steal_type": 10, "dog_status": dog, "tubetoken": tubetoken, "fun_pl": 2 }
        });
        const resObj = (sr && typeof sr === 'object') ? sr : {};
        const amt = resObj.steal_amount || 0;
        const bitten = resObj.bitten_water || 0;

        if (amt > 0) {
          stolen = amt;
          break;
        }
        if (bitten > 0) {
          log(`  [被狗咬] ${t.nickname} 同狗位(${dog})重试 #${retry + 1}...`);
          await sleep(150);
          continue;
        }
        await sleep(150);
      }

      if (stolen > 0) {
        totalStolen += stolen;
        stealCount++;
        log(`[偷水成功] uid=${t.uid} ${t.nickname} (狗位 ${dog}): +${stolen} 滴`);
      } else {
        log(`[偷水未成] uid=${t.uid} ${t.nickname} (狗位 ${dog})`);
      }
      await sleep(300);
    }

    log(`[偷水完成] 共偷 ${stealCount} 次，获得 ${totalStolen} 水滴`);
    return totalStolen;
  } catch (e) { log("[偷水异常]", e); return 0; }
}

// ===== 4. Task 模式主入口 =====
async function main() {
  log(`>>> 开始执行拼多多果园定时任务 (${VERSION}) <<<`);

  // ---- 启动自检：环境对象是否就位 ----
  log(`[自检] persistentStore=${__LOON_PS ? "ok" : "缺失"} notification=${__LOON_NT ? "ok" : "缺失"} httpClient=${__LOON_HC ? "ok" : "缺失"} done=${typeof $done === "function" ? "ok" : "缺失"}`);

  // ---- 启动自检：每个存储键的命中情况 ----
  const probe = ["pdd_orchard_cookie", "pdd_orchard_uid", "pdd_orchard_tubetoken", "ddgyck", "ddgyuid"];
  const probeOut = probe.map(k => {
    const v = storage.get(k);
    return `${k}=${v ? (String(v).length + "字节") : "空"}`;
  }).join(" | ");
  log(`[自检] ${probeOut}`);

  let cookieStr = storage.get("pdd_orchard_cookie");
  let pdduid = storage.get("pdd_orchard_uid");
  let tubetoken = storage.get("pdd_orchard_tubetoken") || "";

  // ---- 兜底 1：没有完整 Cookie 时，用 ddgyck（纯 token）拼最小 Cookie ----
  if (!cookieStr) {
    const rawTok = storage.get("ddgyck");
    if (rawTok) {
      const tk = String(rawTok).replace(/^PDDAccessToken\s*=\s*/i, "").trim();
      const ud = pdduid || storage.get("ddgyuid") || storage.get("pdd_user_id") || "";
      if (tk) {
        cookieStr = "PDDAccessToken=" + tk + (ud ? "; pdd_user_id=" + ud : "");
        log(`[兜底] 用 ddgyck 重建 Cookie（token ${tk.slice(0, 8)}…，uid ${ud || "缺"}）`);
      }
    }
  }

  if (!cookieStr) {
    log(`[终止] 没有任何凭据。请在拼多多 App / 微信小程序里进入「多多果园」逛一次，让抓取规则存下 Cookie。`);
    $notify(`拼多多果园 ${VERSION} ❌`, "没有凭据", "打开拼多多 → 多多果园 点一下\n看到「凭据已就绪」通知后再跑");
    __safeDone({}); return;
  }

  if (!pdduid) {
    const m = String(cookieStr).match(/pdd_user_id=(\d+)/);
    if (m) pdduid = m[1];
  }

  if (!pdduid) {
    // 实测：接口只校验 Cookie 里的 PDDAccessToken，pdduid 传空/不传都只回 40001（登录失效），
    // 不会因为缺 pdduid 报参数错误。所以这里不再硬性终止，先跑，跑通了再回填 uid。
    pdduid = "";
    log(`[警告] 没有 pdd_user_id，用空值继续（服务端只认 PDDAccessToken，不影响领取）`);
  }

  if (cookieStr.indexOf("PDDAccessToken") === -1) {
    log(`[终止] Cookie 里缺少 PDDAccessToken。`);
    $notify(`拼多多果园 ${VERSION} ⚠️`, "凭据不完整", "缺少 PDDAccessToken\n请在拼多多 → 多多果园 重新抓一次");
    __safeDone({}); return;
  }

  log(`[初始化] UID: ${pdduid} | Cookie ${String(cookieStr).length} 字节`);

  const { newToken, water: startWater, uid: realUid } = await getHomePage(pdduid, cookieStr, tubetoken);
  if (realUid && String(realUid) !== String(pdduid)) {
    pdduid = String(realUid);
    storage.set(pdduid, "pdd_orchard_uid");
    storage.set(pdduid, "ddgyuid");
    if (String(cookieStr).indexOf("pdd_user_id") === -1) {
      cookieStr = String(cookieStr) + "; pdd_user_id=" + pdduid;
      storage.set(cookieStr, "pdd_orchard_cookie");
    }
    log(`[回填] 从响应拿到真实 uid=${pdduid}，已写入存储，下次启动不再为空`);
  }
  if (newToken === null) {
    $notify(`拼多多果园 ${VERSION} ❌`, "Cookie 已失效", "请在微信中重新进入多多果园抓取最新凭据");
    __safeDone({}); return;
  }
  if (newToken && newToken !== tubetoken) {
    tubetoken = newToken;
    storage.set(tubetoken, "pdd_orchard_tubetoken");
  }

  const checkinOk = await dailyCheckin(pdduid, cookieStr, tubetoken);
  await sleep(800);
  // 浇水交给 pdd_guoyuan_loon.js（3-4 路并发，能浇到保留线），这里不重复浇
  const wateredTimes = -1;
  await sleep(800);
  const claimedWater = await handleMissions(pdduid, cookieStr, tubetoken);
  await sleep(800);
  // 偷水默认关闭：好友接口是风控重灾区，需要时把下面一行换成注释前的调用
  const stolenWater = -1;

  const finalWater = await getWater(pdduid, cookieStr);
  const msg = `UID: ${pdduid}\n水滴: ${startWater} → ${finalWater}\n任务: 共${__missionStat.total}个/可领${__missionStat.claim}个/领到${claimedWater}g\n签到: ${checkinOk ? "已签" : "未签"}`;
  log("--- [6/6] 完成 ---", msg);
  $notify(`拼多多果园 ${VERSION} 🎉`, `水滴余额: ${finalWater}`, msg);
  __safeDone({});
}

// ===== 5. 入口 =====
if (isRequest) {
  getCookie();
} else {
  main().catch(err => {
    log("[致命错误]", err);
    $notify(`拼多多果园 ${VERSION} ❌`, "运行异常", String(err));
    __safeDone({});
  });
}
