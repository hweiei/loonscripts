/**
 * 拼多多果园 Token 抓取（修复版）
 *
 * 作用：从拼多多的任意请求头里取出 PDDAccessToken，写入本地存储的 ddgyck，供果园脚本读取
 * 触发：http-request，只读 header，不修改请求（requires-body=false）
 * 修复点：
 *   1. 原脚本 /PDDAccessToken=.+?/ 是非贪婪且无终止符，只会匹配到 1 个字符（PDDAccessToken=1）
 *   2. 额外支持独立请求头 PDDAccessToken，部分版本不走 Cookie
 *   3. token 没变化时不重复写入，避免每次请求都刷存储和通知
 */

const KEY = 'ddgyck';

const headers = (typeof $request !== 'undefined' && $request.headers) || {};
const cookie = headers['Cookie'] || headers['cookie'] || '';

let token = '';

// 1) 独立的 PDDAccessToken 请求头
const headerToken = headers['PDDAccessToken'] || headers['pddaccesstoken'] ||
    headers['AccessToken'] || headers['accessToken'];
if (headerToken) {
  const v = String(headerToken).trim();
  if (v) token = `PDDAccessToken=${v}`;
}

// 2) Cookie 里的 PDDAccessToken=xxx，取到分号为止
if (!token) {
  const m = cookie.match(/PDDAccessToken=([^;,\s]+)/);
  if (m && m[1]) token = `PDDAccessToken=${m[1]}`;
}

if (token) {
  const old = $persistentStore.read(KEY);
  if (old !== token) {
    $persistentStore.write(token, KEY);
    console.log(`✅ 已保存到 ${KEY}: ${token}`);
    $notification.post('拼多多果园', 'Token 获取成功', token.slice(0, 48));
  } else {
    console.log('Token 未变化，跳过写入');
  }
} else {
  console.log('本次请求头里没有 PDDAccessToken');
}

// http-request 脚本必须调用 $done，否则被拦截的请求会一直挂起
$done({});
