/**
 * 拼多多果园凭据抓取 v2
 *
 * 触发：http-request（只读 header，不改请求）
 *
 * 保存 4 个键：
 *   ddgyck       纯 PDDAccessToken（兼容旧浇水脚本，它把这个值塞进 accesstoken 头）
 *   pdd_orchard_cookie    完整 Cookie 串（BeRich 的 pdd_orchard.js 直接读这个键）
 *   pdd_orchard_uid       pdd_user_id
 *   pdd_orchard_tubetoken tubetoken
 *
 * 为什么必须存完整 Cookie：
 *   2026 版果园接口（manor/mission/list、manor/mission/draw）不再认 AccessToken 头，
 *   改为校验 Cookie 里的 PDDAccessToken + pdd_user_id，缺一个就返回 40001。
 */

var KEY_TOKEN = 'ddgyck';
var KEY_COOKIE = 'pdd_orchard_cookie';
var KEY_UID = 'pdd_orchard_uid';
var KEY_TUBE = 'pdd_orchard_tubetoken';

var req = (typeof $request !== 'undefined' && $request) || {};
var headers = req.headers || {};
var url = req.url || '';

function h(name) {
    for (var k in headers) {
        if (k.toLowerCase() === name.toLowerCase()) return headers[k];
    }
    return '';
}

function read(k) {
    try { return $persistentStore.read(k); } catch (e) { return null; }
}

function write(k, v) {
    try { return $persistentStore.write(v, k); } catch (e) { return false; }
}

function parseCookie(s) {
    var m = {};
    if (!s) return m;
    s.split(';').forEach(function (item) {
        var i = item.indexOf('=');
        if (i > 0) {
            var k = item.slice(0, i).trim();
            var v = item.slice(i + 1).trim();
            if (k) m[k] = v;
        }
    });
    return m;
}

var cookie = h('Cookie') || h('cookie') || '';

// ---------- 1. token ----------
var token = h('PDDAccessToken') || h('AccessToken') || h('accessToken') || '';
if (!token) {
    var mt = cookie.match(/PDDAccessToken=([^;,\s]+)/);
    if (mt) token = mt[1];
}
token = String(token || '').replace(/^PDDAccessToken\s*=\s*/i, '').trim();

// ---------- 2. uid ----------
var uid = '';
var mu = cookie.match(/pdd_user_id=(\d+)/) || url.match(/[?&]pdduid=(\d+)/);
if (mu) uid = mu[1];

// ---------- 3. tubetoken ----------
var tube = '';
var mtu = cookie.match(/tubetoken=([^;,\s]+)/);
if (mtu) tube = mtu[1];

// ---------- 4. 累积 Cookie ----------
// 一次请求通常只带部分 cookie，多次拦截合并成完整串
if (cookie) {
    var oldMap = parseCookie(read(KEY_COOKIE) || '');
    var newMap = parseCookie(cookie);
    for (var k in newMap) {
        if (newMap[k]) oldMap[k] = newMap[k];
    }
    if (token) oldMap['PDDAccessToken'] = token;
    if (uid) oldMap['pdd_user_id'] = uid;
    var parts = [];
    for (var kk in oldMap) parts.push(kk + '=' + oldMap[kk]);
    var merged = parts.join('; ');
    if (merged.length <= 4000) {
        var oldCookie = read(KEY_COOKIE) || '';
        if (oldCookie !== merged) write(KEY_COOKIE, merged);
    }
}

// ---------- 5. 落库 ----------
var changed = [];

if (token) {
    var oldTok = String(read(KEY_TOKEN) || '').replace(/^PDDAccessToken\s*=\s*/i, '');
    if (oldTok !== token) {
        write(KEY_TOKEN, token);
        changed.push('token');
    }
}

if (uid) {
    var oldUid = String(read(KEY_UID) || '');
    if (oldUid !== uid) {
        write(KEY_UID, uid);
        changed.push('uid');
    }
}

if (tube) {
    var oldTube = String(read(KEY_TUBE) || '');
    if (oldTube !== tube) {
        write(KEY_TUBE, tube);
        changed.push('tubetoken');
    }
}

// ---------- 6. 日志 / 通知 ----------
var haveCookie = !!(read(KEY_COOKIE) || '');
var okUid = String(read(KEY_UID) || '');
var okTok = String(read(KEY_TOKEN) || '');

if (token && uid && changed.length) {
    console.log('✅ 凭据已更新: ' + changed.join(', ') + ' / uid=' + uid);
    $notification.post(
        '拼多多果园',
        '凭据已就绪',
        'UID ' + uid + '\nToken ' + token.slice(0, 10) + '…'
    );
} else if (token && !uid) {
    console.log('⚠️ 只抓到 token，没有 pdd_user_id（新任务接口需要它）');
} else if (changed.length) {
    console.log('✅ 已更新: ' + changed.join(', '));
} else {
    console.log('凭据无变化');
}

console.log('当前状态: uid=' + (okUid || '无') + ' token=' + (okTok ? okTok.slice(0, 8) + '…' : '无') + ' cookie=' + haveCookie);

// http-request 脚本必须 $done，否则被拦截的请求会挂住
$done({});
