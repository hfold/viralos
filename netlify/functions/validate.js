const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: { message: "Method not allowed" } });
  }

  let payload = null;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: { message: "Invalid JSON body" } });
  }

  const { platform, urls } = payload || {};
  if (!Array.isArray(urls)) {
    return json(400, { error: { message: "Missing urls array" } });
  }

  // Only validate TikTok via oEmbed; other platforms pass-through
  if (platform !== "TikTok") {
    return json(200, { validUrls: urls });
  }

  const valid = [];
  for (const url of urls.slice(0, 12)) {
    try {
      const oembed = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      const resp = await fetch(oembed, { method: "GET" });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data && data.title) valid.push(url);
    } catch (e) {
      // ignore
    }
  }

  return json(200, { validUrls: valid });
};
