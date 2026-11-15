/*
 * 拼多多果园 · 任务版（Loon）
 * 改造自 fmz200/wool_scripts Scripts/pinduoduo/pdd_fruit.js
 *
 * 与原版的差异：
 * 1. CK 不再读 process.env.PDD_TOKENS，改读插件抓取的 $persistentStore['ddgyck']
 * 2. 外层包 IIFE：原文件顶层有 return，Loon 的全局作用域里是语法错误
 * 3. 补 $.UA：原版 getPostRequest 里 "User-Agent": $.UA 是 undefined
 * 4. 去掉浇水段：浇水交给 pdd_guoyuan_loon.js 的并发连浇，这里只做任务，
 *    避免两个脚本同时浇水互相打架
 * 5. 加 270s 收尾守卫，防止某个请求不回包把整次 cron 挂住
 */
(function () {
  var __rawDone = (typeof $done === 'function') ? $done : null;
  if (__rawDone) {
    var __hit = false;
    try {
      $done = function (t) { if (__hit) return; __hit = true; return __rawDone(t); };
    } catch (e) {}
    setTimeout(function () {
      if (__hit) return;
      __hit = true;
      try { console.log('\n⏱️ 超过 270s 未收尾，强制结束'); } catch (e) {}
      try { __rawDone({}); } catch (e) {}
    }, 270000);
  }
})();

(function () {
const $ = new Env('拼多多果园-任务');
// const notify = $.isNode() ? require('./sendNotifySp') : '';
$.shareWids = []
$.lackCardIds = []
$.giftRecords = []
$.lackMsg = ''
$.helpFlag = true // 获取助力码
$.taskList = [36155, 36164, 36125, 37464, 37509, 36013, 36007, 36167, 36132]
$.UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
var __CK = ''
try {
    if (typeof $persistentStore !== 'undefined' && $persistentStore) __CK = $persistentStore.read('ddgyck') || ''
} catch (e) {}
__CK = String(__CK).trim()
var cookieArr = []
if (__CK) {
    if (__CK.indexOf('@') > -1) cookieArr = __CK.split('@')
    else if (__CK.indexOf('\n') > -1) cookieArr = __CK.split('\n')
    else cookieArr = [__CK]
}
cookieArr = cookieArr.map(function (x) {
    var v = String(x).replace(/^\s*PDDAccessToken\s*=\s*/i, '').trim()
    // 兼容 pdd_guoyuan 用的 "token#anti-token" 格式，这里只要 AccessToken
    if (v.indexOf('#') > -1) v = v.split('#')[0]
    return v
}).filter(function (x) { return !!x })
if (!cookieArr.length) {
    console.log('未发现有效 Cookie（ddgyck 为空）：先在拼多多 App 打开一次果园，让插件抓到 AccessToken')
    if (typeof $done === 'function') $done({})
    return
}

console.log(`\n🔧 任务版 v2（诊断：本次只采集接口返回，不批量领取）`)
console.log(`\n==========共发现${cookieArr.length}个账号==========\n`)
$.index = 0
$.message = ''
!(async () => {
    for (let i = 0; i < cookieArr.length; i++) {
        cookie = cookieArr[i]
        $.redualWater = 0
        $.stealStatus = true
        if (cookie.indexOf('&') > -1) {
            $.accessToken = cookie.split('&')[0]
            $.remark = cookie.split('&')[1]
        } else {
            $.accessToken = cookie
            $.remark = '匿名用户'
        }
        console.log(`\n🔄 当前进行第${i + 1}个账号，用户备注：${$.remark}`)
        await missionList()
        for (let missionKey in $.missionList) {
            if ($.taskList.indexOf(missionKey) == -1) {
                $.taskList.push(missionKey)
            }
        }
        await reward()
        console.log(`\n========常规任务=========`)
        for (let missionKey of $.taskList) {
            $.taskType = missionKey
            console.log(`🎯 去完成任务${$.taskType}`)
            await completeMission()
        }
        console.log(`\n========打卡任务=========`)
        await applyActivity()
        // console.log(`🎯 开始获取好友列表`)
        // await getFriends()
        // if ($.friendList.length > 0) {
        //     for (let friendInfo of $.friendList) {
        //         let isSteal = friendInfo.steal_water_status == null ? false : true
        //         $.stealedName = friendInfo.nickname
        //         $.friendUid = friendInfo.uid
        //         if (isSteal === true) await stealWater()
        //         if ($.stealStatus === false) {
        //             break
        //         }
        //         await $.wait(1000)
        //     }
        // }
        console.log(`\n========开宝箱任务=========`)
        for (let z = 1; z < 6; z++) {
            $.boxOrder = z
            await openBox()
        }
        // 浇水交给 pdd_guoyuan_loon.js（并发连浇），这里不重复浇，
        // 否则两个 cron 会同时扣水、互相把对方的 tubetoken 顶掉
        console.log(`\n========浇水任务（由果园主脚本负责）=========`)
    }

})()
    .catch((e) => {
        $.log('', `❌ ${$.name}, 失败! 原因: ${e}!`, '')
    })
    .finally(() => {
        $.done();
    })

function missionList() {
    let url = 'https://mobile.yangkeduo.com/proxy/api/api/manor-query/tag/mission/list?pdduid=0'
    let body = {
        "mission_tag": "HOME_GAIN_WATER_MISSION_LIST_EXTRA",
        "fun_pl": 10,
        "tubetoken": ""
    }
    let myRequest = getPostRequest(url, body);
    return new Promise(async resolve => {
        $.post(myRequest, (err, resp, data) => {
            try {
                dataObj = JSON.parse(data)
                if (dataObj.error_code) {
                    console.log("💥 获取任务列表失败！")
                } else {
                    console.log(`\n✅ 获取任务列表成功！`)
                    $.missionList = dataObj.mission_list
                }
            } catch (e) {
                // console.log(data);
                console.log(e, resp)
            } finally {
                resolve();
            }
        })
    })
}

function completeMission() {
    let url = 'https://mobile.yangkeduo.com/proxy/api/api/manor/mission/complete/gain?ts=1671003202054&pdduid=0'
    let body = {
        "mission_type": $.taskType,
        "gain_time": 1,
        "no_reward": false,
        "fun_pl": 10,
        "tubetoken": ""
    }
    let myRequest = getPostRequest(url, body);
    return new Promise(async resolve => {
        $.post(myRequest, (err, resp, data) => {
            try {
                dataObj = JSON.parse(data)
                if (dataObj.error_code) {
                    console.log(`🚫 任务完成失败：${dataObj.error_msg}`)
                } else {
                    if (dataObj.result == null) {
                        console.log(`💧 任务完成：获得${dataObj.reward_list[0].reward_amount}g水滴，当前水滴${dataObj.water_amount}g`)
                    } else {
                        console.log(`🚫 该任务已经完成过了~`)
                    }
                }
            } catch (e) {
                // console.log(data);
                console.log(e, resp)
            } finally {
                resolve();
            }
        })
    })
}

function water() {
    let url = 'https://mobile.yangkeduo.com/proxy/api/api/manor/water/cost?pdduid=1'
    let body = {
        "fun_id": "xcx_home_page",
        "product_scene": 0,
        "lower_end_device": false,
        "fun_pl": 10,
        "location_auth": false,
        "screen_token": "",
        "mission_type": 0,
        "tubetoken": "",
        "atw": true,
        "can_trigger_random_mission": true
    }
    let myRequest = getPostRequest(url, body);
    return new Promise(async resolve => {
        $.post(myRequest, (err, resp, data) => {
            try {
                dataObj = JSON.parse(data)
                if (dataObj.error_code) {
                    console.log(`🚫 浇水失败：${dataObj.error_msg}`)
                } else {
                    $.redualWater = dataObj.now_water_amount
                    $.progress_text = dataObj.product.progress_text
                    $.activity_water_amount = dataObj.accumulate_water_vo.activity_water_amount
                    console.log(`🧊 浇水成功，还有${$.progress_text}%成熟，剩余${$.redualWater}滴水，明日可领取${$.activity_water_amount}滴水`)
                }
            } catch (e) {
                // console.log(data);
                console.log(e, resp)
            } finally {
                resolve();
            }
        })
    })
}

function applyActivity() {
    let url = 'https://mobile.yangkeduo.com/proxy/api/api/manor/common/apply/activity?pdduid=9188599218'
    let body = {
        "type": 18,
        "fun_pl": 10,
        "tubetoken": ""
    }
    let myRequest = getPostRequest(url, body);
    return new Promise(async resolve => {
        $.post(myRequest, (err, resp, data) => {
            try {
                dataObj = JSON.parse(data)
                if (dataObj.success == true) {
                    console.log(`✅ 获取打卡集水滴任务成功`)
                    console.log(`💧 已连续打卡${dataObj.continuous_check_in_to_collect_water_vo.finished_count}天，打卡${dataObj.continuous_check_in_to_collect_water_vo.total_count}天可获得奖励`)
                } else {
                    console.log(`🚫 未获取到打卡集水滴任务`)
                }
            } catch (e) {
                // console.log(data);
                console.log(e, resp)
            } finally {
                resolve();
            }
        })
    })
}

function openBox() {
    let url = 'https://mobile.yangkeduo.com/proxy/api/api/manor/withered/open/box?pdduid=9188599218'
    let body = {
        "box_order": $.boxOrder,
        "tubetoken": "",
        "fun_pl": 10
    }
    let myRequest = getPostRequest(url, body);
    return new Promise(async resolve => {
        $.post(myRequest, (err, resp, data) => {
            try {
                dataObj = JSON.parse(data)
                if (dataObj.error_code) {
                    console.log(`🚫 获取宝箱信息失败：${dataObj.error_msg}`)
                } else {
                    if (dataObj.status == 3) {
                        console.log(`🚫 获取宝箱信息失败`)
                    } else {
                        console.log(`💧 收取宝箱成功：收获${dataObj.reward_list[0].reward_amount}滴水`)
                    }
                }
            } catch (e) {
                // console.log(data);
                console.log(e, resp)
            } finally {
                resolve();
            }
        })
    })
}


function getFriends() {
    let url = 'https://mobile.yangkeduo.com/proxy/api/api/manor-query/friend/list/page?pdduid=1'
    let body = {
        "page_num": 1,
        "fun_pl": 10,
        "tubetoken": ""
    }
    let myRequest = getPostRequest(url, body);
    return new Promise(async resolve => {
        $.post(myRequest, (err, resp, data) => {
            try {
                dataObj = JSON.parse(data)
                if (dataObj.error_code) {
                    console.log(`🚫 获取好友列表失败：${dataObj.error_msg}`)
                    if (dataObj.error_msg.indexOf('上限') > -1 || dataObj.error_msg.indexOf('异常') > -1) {
                        $.stealStatus = false
                    }
                } else {
                    $.friendList = dataObj.friend_list || []
                }
            } catch (e) {
                // console.log(data);
                console.log(e, resp)
            } finally {
                resolve();
            }
        })
    })
}

function stealWater() {
    let url = 'https://mobile.yangkeduo.com/proxy/api/api/manor/steal/water?pdduid=1'
    let body = {
        // "steal_type": 1,
        "fun_pl": 10,
        "friend_uid": $.friendUid,
        "tubetoken": ""
    }
    let myRequest = getPostRequest(url, body);
    return new Promise(async resolve => {
        $.post(myRequest, (err, resp, data) => {
            try {
                dataObj = JSON.parse(data)
                if (dataObj.error_code) {
                    console.log(`🚫 偷水失败：${dataObj.error_msg}`)
                } else {
                    console.log(`💧 偷水成功：偷取好友【${$.stealedName}】${dataObj.steal_amount}滴水，剩余${dataObj.water_amount}滴水`)
                }
            } catch (e) {
                // console.log(data);
                console.log(e, resp)
            } finally {
                resolve();
            }
        })
    })
}

function reward() {
    let url = 'https://mobile.yangkeduo.com/proxy/api/api/manor/gain/accumulate/water/reward?pdduid='
    let body = {
        "fun_pl": 10,
        "tubetoken": ""
    }
    let myRequest = getPostRequest(url, body);
    return new Promise(async resolve => {
        $.post(myRequest, (err, resp, data) => {
            try {
                dataObj = JSON.parse(data)
                if (dataObj.error_code) {
                    console.log(`🚫 获取前一日奖励失败：${dataObj.error_msg}`)
                } else {
                    console.log(`💧 获取前一日奖励成功：${dataObj.acculate_water_vo.reward_amount}滴水`)
                }
            } catch (e) {
                // console.log(data);
                console.log(e, resp)
            } finally {
                resolve();
            }
        })
    })
}

function getPostRequest(url, body, method = "POST") {
    let headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "close",
        "User-Agent": $.UA,
        "Content-Type": "application/json;charset=UTF-8",
        "Host": "mobile.yangkeduo.com",
        "Origin": "https://mobile.yangkeduo.com",
        "AccessToken": $.accessToken
    }
    return { url: url, method: method, headers: headers, body: JSON.stringify(body), timeout: 30000 };
}

function uuid(x = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") {
    return x.replace(/[xy]/g, function (x) {
        const r = 16 * Math.random() | 0, n = "x" === x ? r : 3 & r | 8;
        return n.toString(36)
    })
}

// prettier-ignore
function Env(t, e) { "undefined" != typeof process && JSON.stringify(process.env).indexOf("GITHUB") > -1 && process.exit(0); class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise((e, i) => { s.call(this, t, (t, s, r) => { t ? i(t) : e(s) }) }) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } isNode() { return "undefined" != typeof module && !!module.exports } isQuanX() { return "undefined" != typeof $task } isSurge() { return "undefined" != typeof $httpClient && "undefined" == typeof $loon } isLoon() { return "undefined" != typeof $loon } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; const i = this.getdata(t); if (i) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise(e => { this.get({ url: t }, (t, s, i) => e(i)) }) } runScript(t, e) { return new Promise(s => { let i = this.getdata("@chavy_boxjs_userCfgs.httpapi"); i = i ? i.replace(/\n/g, "").trim() : i; let r = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); r = r ? 1 * r : 20, r = e && e.timeout ? e.timeout : r; const [o, h] = i.split("@"), n = { url: `http://${h}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: r }, headers: { "X-Key": o, Accept: "*/*" } }; this.post(n, (t, e, i) => s(i)) }).catch(t => this.logErr(t)) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e); if (!s && !i) return {}; { const i = s ? t : e; try { return JSON.parse(this.fs.readFileSync(i)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), r = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, r) : i ? this.fs.writeFileSync(e, r) : this.fs.writeFileSync(t, r) } } lodash_get(t, e, s) { const i = e.replace(/\[(\d+)\]/g, ".$1").split("."); let r = t; for (const t of i) if (r = Object(r)[t], void 0 === r) return s; return r } lodash_set(t, e, s) { return Object(t) !== t ? t : (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}, t)[e[e.length - 1]] = s, t) } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, i] = /^@(.*?)\.(.*?)$/.exec(t), r = s ? this.getval(s) : ""; if (r) try { const t = JSON.parse(r); e = t ? this.lodash_get(t, i, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, i, r] = /^@(.*?)\.(.*?)$/.exec(e), o = this.getval(i), h = i ? "null" === o ? null : o || "{}" : "{}"; try { const e = JSON.parse(h); this.lodash_set(e, r, t), s = this.setval(JSON.stringify(e), i) } catch (e) { const o = {}; this.lodash_set(o, r, t), s = this.setval(JSON.stringify(o), i) } } else s = this.setval(t, e); return s } getval(t) { return this.isSurge() || this.isLoon() ? $persistentStore.read(t) : this.isQuanX() ? $prefs.valueForKey(t) : this.isNode() ? (this.data = this.loaddata(), this.data[t]) : this.data && this.data[t] || null } setval(t, e) { return this.isSurge() || this.isLoon() ? $persistentStore.write(t, e) : this.isQuanX() ? $prefs.setValueForKey(t, e) : this.isNode() ? (this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0) : this.data && this.data[e] || null } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"]), this.isSurge() || this.isLoon() ? (this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, (t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status), e(t, s, i) })) : this.isQuanX() ? (this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => e(t))) : this.isNode() && (this.initGotEnv(t), this.got(t).on("redirect", (t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } }).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => { const { message: s, response: i } = t; e(s, i, i && i.body) })) } post(t, e = (() => { })) { if (t.body && t.headers && !t.headers["Content-Type"] && (t.headers["Content-Type"] = "application/x-www-form-urlencoded"), t.headers && delete t.headers["Content-Length"], this.isSurge() || this.isLoon()) this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.post(t, (t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status), e(t, s, i) }); else if (this.isQuanX()) t.method = "POST", this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => e(t)); else if (this.isNode()) { this.initGotEnv(t); const { url: s, ...i } = t; this.got.post(s, i).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => { const { message: s, response: i } = t; e(s, i, i && i.body) }) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let i = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length))); return t } msg(e = t, s = "", i = "", r) { const o = t => { if (!t) return t; if ("string" == typeof t) return this.isLoon() ? t : this.isQuanX() ? { "open-url": t } : this.isSurge() ? { url: t } : void 0; if ("object" == typeof t) { if (this.isLoon()) { let e = t.openUrl || t.url || t["open-url"], s = t.mediaUrl || t["media-url"]; return { openUrl: e, mediaUrl: s } } if (this.isQuanX()) { let e = t["open-url"] || t.url || t.openUrl, s = t["media-url"] || t.mediaUrl; return { "open-url": e, "media-url": s } } if (this.isSurge()) { let e = t.url || t.openUrl || t["open-url"]; return { url: e } } } }; if (this.isMute || (this.isSurge() || this.isLoon() ? $notification.post(e, s, i, o(r)) : this.isQuanX() && $notify(e, s, i, o(r))), !this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { const s = !this.isSurge() && !this.isQuanX() && !this.isLoon(); s ? this.log("", `❗️${this.name}, 错误!`, t.stack) : this.log("", `❗️${this.name}, 错误!`, t) } wait(t) { return new Promise(e => setTimeout(e, t)) } done(t = {}) { const e = (new Date).getTime(), s = (e - this.startTime) / 1e3; this.log("", `🔔${this.name}, 结束! 🕛 ${s} 秒`), this.log(), (this.isSurge() || this.isQuanX() || this.isLoon()) && $done(t) } }(t, e) }

/* ==================== 诊断增强：覆盖上面的原函数 ==================== */

function __rawStr(data, n) {
    var s = '';
    try { s = typeof data === 'string' ? data : JSON.stringify(data); } catch (e) { s = String(data); }
    if (!s) s = '(空)';
    return s.length > n ? s.slice(0, n) + '…' : s;
}

function __pick(obj, keys) {
    var out = [];
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (obj && typeof obj === 'object' && obj[k] !== undefined && obj[k] !== null) {
            var v = obj[k];
            if (typeof v === 'object') { try { v = JSON.stringify(v); } catch (e) { v = '[obj]'; } }
            out.push(k + '=' + v);
        }
    }
    return out.join(' ');
}

var __PROBE_KEYS = ['mission_type', 'mission_id', 'id', 'status', 'state', 'mission_status',
    'cnt', 'need_cnt', 'current_cnt', 'target_cnt', 'finish_count', 'need_count',
    'progress', 'reward_amount', 'water_amount', 'mission_name', 'title', 'name', 'desc', 'type'];

function __probeComplete(missionType, done) {
    var now = Date.now();
    var plan = [
        ['A manor/mission/complete/gain', 'https://mobile.yangkeduo.com/proxy/api/api/manor/mission/complete/gain?ts=' + now + '&pdduid=0'],
        ['B manor/mission/complete', 'https://mobile.yangkeduo.com/proxy/api/api/manor/mission/complete?ts=' + now + '&pdduid=0']
    ];
    var i = 0;
    function step() {
        if (i >= plan.length) { if (done) done(); return; }
        var it = plan[i++];
        var body = { mission_type: missionType, gain_time: 1, no_reward: false, fun_pl: 10, tubetoken: '' };
        $.post(getPostRequest(it[1], body), function (err, resp, data) {
            try {
                if (err) {
                    console.log('  🧪 ' + it[0] + ' → 请求失败 ' + err);
                } else {
                    var d = {};
                    try { d = JSON.parse(data) || {}; } catch (e) { d = null; }
                    if (!d) {
                        console.log('  🧪 ' + it[0] + ' → 非 JSON 返回: ' + __rawStr(data, 200));
                    } else if (d.error_code) {
                        console.log('  🧪 ' + it[0] + ' → code=' + d.error_code + ' ' + (d.error_msg || ''));
                    } else {
                        console.log('  🧪 ' + it[0] + ' → ✅ 通过 code=0 原始: ' + __rawStr(data, 320));
                    }
                }
            } catch (e) {
                console.log('  🧪 ' + it[0] + ' → 异常 ' + e.message);
            } finally {
                step();
            }
        });
    }
    step();
}

function missionList() {
    // 原版这里写死 9 个 2022 年的任务 ID，逐个调 complete 必然失败，直接清空
    $.taskList = [];
    return new Promise(function (resolve) {
        var tags = ['HOME_GAIN_WATER_MISSION_LIST_EXTRA', 'HOME_GAIN_WATER_MISSION_LIST'];
        var i = 0;
        var firstType = null;
        function probeAll() {
            $.missionList = {};   // 诊断模式：让主流程的批量领取空转
            if (firstType === null) {
                console.log('\n📋 任务列表为空，跳过入口探测');
                resolve();
                return;
            }
            console.log('\n🧪 入口探测：用任务 ' + firstType + ' 各发 1 次，判断是入口问题还是权限问题');
            __probeComplete(firstType, function () {
                console.log('\nℹ️ 诊断模式：本次不批量领取。上面两行 code 决定下一版怎么改');
                resolve();
            });
        }
        function step() {
            if (i >= tags.length) { probeAll(); return; }
            var tag = tags[i++];
            var short = tag.indexOf('EXTRA') > -1 ? 'EXTRA' : 'BASE';
            var url = 'https://mobile.yangkeduo.com/proxy/api/api/manor-query/tag/mission/list?pdduid=0';
            var body = { mission_tag: tag, fun_pl: 10, tubetoken: '' };
            $.post(getPostRequest(url, body), function (err, resp, data) {
                try {
                    if (err) {
                        console.log('💥 任务列表[' + short + '] 请求失败: ' + err);
                    } else {
                        var d = null;
                        try { d = JSON.parse(data); } catch (e) { d = null; }
                        if (!d) {
                            console.log('💥 任务列表[' + short + '] 非 JSON: ' + __rawStr(data, 200));
                        } else if (d.error_code) {
                            console.log('💥 任务列表[' + short + '] code=' + d.error_code + ' ' + (d.error_msg || ''));
                        } else {
                            var ml = d.mission_list || {};
                            var isArr = Object.prototype.toString.call(ml) === '[object Array]';
                            var objs = isArr ? ml : Object.keys(ml).map(function (k) { return ml[k]; });
                            var keys = isArr ? objs.map(function (o) { return o && o.mission_type; }) : Object.keys(ml);
                            console.log('\n📋 任务列表[' + short + '] ' + objs.length + ' 个');
                            for (var j = 0; j < objs.length && j < 8; j++) {
                                console.log('  ' + (keys[j] || '?') + ' | ' + (__pick(objs[j], __PROBE_KEYS) || '(没有已知字段)'));
                            }
                            if (objs.length > 8) console.log('  …还有 ' + (objs.length - 8) + ' 个');
                            if (objs.length) {
                                var f = objs[0] || {};
                                console.log('  🔑 全部字段名: ' + Object.keys(f).join(', '));
                                if (firstType === null) firstType = (f.mission_type || keys[0]);
                            }
                            console.log('  📄 原始: ' + __rawStr(ml, 700));
                        }
                    }
                } catch (e) {
                    console.log('💥 任务列表[' + short + '] 异常: ' + e.message);
                } finally {
                    step();
                }
            });
        }
        step();
    });
}

function completeMission() {
    // 诊断模式下主流程不会进来；万一进来也不重复发请求
    return Promise.resolve();
}

function reward() {
    return new Promise(function (resolve) {
        var url = 'https://mobile.yangkeduo.com/proxy/api/api/manor/gain/accumulate/water/reward?pdduid=0';
        var body = { fun_pl: 10, tubetoken: '' };
        $.post(getPostRequest(url, body), function (err, resp, data) {
            try {
                if (err) {
                    console.log('🚫 前一日奖励: 请求失败 ' + err);
                } else {
                    var d = null;
                    try { d = JSON.parse(data); } catch (e) { d = null; }
                    if (!d) {
                        console.log('🚫 前一日奖励: 非 JSON ' + __rawStr(data, 200));
                    } else if (d.error_code) {
                        console.log('🚫 前一日奖励 code=' + d.error_code + ' ' + (d.error_msg || ''));
                    } else {
                        var v = d.acculate_water_vo || d.accumulate_water_vo || null;
                        var amt = v && v.reward_amount;
                        if (amt === undefined || amt === null) {
                            console.log('⚠️ 前一日奖励: code=0 但没有奖励字段（今天可能没有可领的）');
                            console.log('   原始: ' + __rawStr(d, 320));
                        } else {
                            console.log('💧 前一日奖励: ' + amt + ' 滴水');
                        }
                    }
                }
            } catch (e) {
                console.log('⚠️ 前一日奖励异常: ' + e.message);
            } finally {
                resolve();
            }
        });
    });
}

function applyActivity() {
    return new Promise(function (resolve) {
        var url = 'https://mobile.yangkeduo.com/proxy/api/api/manor/common/apply/activity?pdduid=0';
        var body = { type: 18, fun_pl: 10, tubetoken: '' };
        $.post(getPostRequest(url, body), function (err, resp, data) {
            try {
                if (err) {
                    console.log('🚫 打卡: 请求失败 ' + err);
                } else {
                    var d = null;
                    try { d = JSON.parse(data); } catch (e) { d = null; }
                    if (!d) {
                        console.log('🚫 打卡: 非 JSON ' + __rawStr(data, 200));
                    } else if (d.success === true && d.continuous_check_in_to_collect_water_vo) {
                        var v = d.continuous_check_in_to_collect_water_vo;
                        console.log('✅ 打卡成功：已连续 ' + v.finished_count + ' 天，满 ' + v.total_count + ' 天有奖励');
                    } else if (d.error_code) {
                        console.log('🚫 打卡 code=' + d.error_code + ' ' + (d.error_msg || ''));
                    } else {
                        console.log('⚠️ 打卡: 无 error_code 但 success≠true（这个活动大概率已下线）');
                        console.log('   原始: ' + __rawStr(d, 320));
                    }
                }
            } catch (e) {
                console.log('⚠️ 打卡异常: ' + e.message);
            } finally {
                resolve();
            }
        });
    });
}

function openBox() {
    if ($.boxOrder > 1) return Promise.resolve();   // 5 个宝箱只探第 1 个
    return new Promise(function (resolve) {
        var url = 'https://mobile.yangkeduo.com/proxy/api/api/manor/withered/open/box?pdduid=0';
        var body = { box_order: 1, tubetoken: '', fun_pl: 10 };
        $.post(getPostRequest(url, body), function (err, resp, data) {
            try {
                if (err) {
                    console.log('📦 宝箱: 请求失败 ' + err);
                } else {
                    var d = null;
                    try { d = JSON.parse(data); } catch (e) { d = null; }
                    if (!d) {
                        console.log('📦 宝箱: 非 JSON ' + __rawStr(data, 200));
                    } else if (d.error_code) {
                        console.log('📦 宝箱 code=' + d.error_code + ' ' + (d.error_msg || ''));
                    } else {
                        console.log('📦 宝箱 code=0 status=' + d.status + ' 原始: ' + __rawStr(d, 320));
                    }
                }
            } catch (e) {
                console.log('⚠️ 宝箱异常: ' + e.message);
            } finally {
                resolve();
            }
        });
    });
}

})();
