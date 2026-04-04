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

  const { provider, prompt, system, useSearch, model } = payload || {};
  if (!provider || !prompt) {
    return json(400, { error: { message: "Missing provider or prompt" } });
  }

  try {
    if (provider === "anthropic") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return json(500, { error: { message: "ANTHROPIC_API_KEY not set" } });
      }

      const body = {
        model: model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: system || "",
        messages: [{ role: "user", content: prompt }],
      };
      if (useSearch) {
        body.tools = [{ type: "web_search_20250305", name: "web_search" }];
      }

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      const data = await resp.json();
      if (!resp.ok) {
        return json(resp.status, { error: data.error || data });
      }

      const text =
        data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "";
      return json(200, { text, raw: data });
    }

    if (provider === "gemini") {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return json(500, { error: { message: "GEMINI_API_KEY not set" } });
      }

      const modelName = model || process.env.GEMINI_MODEL || "gemini-1.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const contentText = system ? `${system}\n\n${prompt}` : prompt;
      const body = {
        contents: [{ role: "user", parts: [{ text: contentText }] }],
      };

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await resp.json();
      if (!resp.ok) {
        return json(resp.status, { error: data.error || data });
      }

      const text =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
      return json(200, { text, raw: data });
    }

    return json(400, { error: { message: `Unsupported provider: ${provider}` } });
  } catch (err) {
    return json(500, { error: { message: err.message || "Server error" } });
  }
};
