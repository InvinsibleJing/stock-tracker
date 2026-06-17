// Vercel Serverless Function — 反向代理到 Supabase
// 因为 supabase.co 项目子域名在国内 DNS 无法解析，此函数作为中转

const SUPABASE_HOST = 'tbxfeikdvoplmlxdunjpj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRieGZlaWtkdm9wbG1sZHVuanBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NTgyNDEsImV4cCI6MjA5NzIzNDI0MX0.-b7ykb_UMIDzveI4sdfhDJYlRZ-AwR54lMbMtxWriow';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 路径提取: /api/proxy/rest/v1/trades → rest/v1/trades
  const urlParts = req.url.split('?')[0].split('/');
  const proxyIdx = urlParts.indexOf('proxy');
  const pathSegments = proxyIdx >= 0 ? urlParts.slice(proxyIdx + 1) : [];
  const forwardPath = pathSegments.join('/');
  const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const supabaseUrl = `https://${SUPABASE_HOST}/${forwardPath}${query}`;

  try {
    const proxyHeaders = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };
    // 转发 Prefer 头（Supabase 用 return=representation）
    const prefer = req.headers['prefer'] || req.headers['Prefer'];
    if (prefer) proxyHeaders['Prefer'] = prefer;

    const fetchOpts = {
      method: req.method,
      headers: proxyHeaders
    };
    // POST/PUT/PATCH 带 Body
    if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOpts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const upstream = await fetch(supabaseUrl, fetchOpts);
    const contentType = upstream.headers.get('content-type') || '';

    // 根据内容类型返回
    if (contentType.includes('application/json')) {
      const data = await upstream.json();
      return res.status(upstream.status).json(data);
    }
    const text = await upstream.text();
    res.status(upstream.status).send(text);
  } catch (error) {
    res.status(502).json({ error: '代理失败: ' + error.message });
  }
}
