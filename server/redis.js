'use strict';

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function cmd(args) {
  if (!URL_ || !TOKEN) {
    const e = new Error('The Redis database is not connected to this Vercel project.');
    e.status = 500;
    throw e;
  }
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || 'Redis error');
  return json.result;
}

module.exports = { cmd };