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

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return json(500, { error: { message: "TAVILY_API_KEY not set" } });
  }

  const {
    query,
    max_results = 6,
    search_depth = "basic",
    include_domains,
    exclude_domains,
    time_range,
  } = payload || {};

  if (!query) {
    return json(400, { error: { message: "Missing query" } });
  }

  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results,
        search_depth,
        include_domains,
        exclude_domains,
        time_range,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return json(r.status, { error: data.error || data });
    }

    return json(200, {
      query,
      results: data.results || [],
      response_time: data.response_time,
      request_id: data.request_id,
    });
  } catch (err) {
    return json(500, { error: { message: err.message || "Server error" } });
  }
};
