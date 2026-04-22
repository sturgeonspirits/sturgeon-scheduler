export async function handler(event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
  const APPS_SCRIPT_KEY = process.env.APPS_SCRIPT_KEY;

  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        ok: false,
        error: "Missing APPS_SCRIPT_URL or APPS_SCRIPT_KEY in Netlify environment variables."
      })
    };
  }

  // Ensure the API key is attached to the URL for both GET and POST
  const url = `${APPS_SCRIPT_URL}${APPS_SCRIPT_URL.includes("?") ? "&" : "?"}key=${encodeURIComponent(APPS_SCRIPT_KEY)}`;

  try {
    // Handle GET requests (e.g., status checks)
    if (event.httpMethod === "GET") {
      const resp = await fetch(url, { method: "GET", redirect: "follow" });
      const text = await resp.text();
      return {
        statusCode: resp.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: text
      };
    }

    // Process POST requests (Shifts, Swaps, Auth)
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({ ok: false, error: "Method not allowed." })
      };
    }

    // Decode Netlify body if necessary
    let rawBody = event.body || "";
    if (event.isBase64Encoded && rawBody) {
      rawBody = Buffer.from(rawBody, "base64").toString("utf8");
    }

    // Forward the request to Google Apps Script
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody || "{}",
      redirect: "follow" // CRITICAL: Follows Google's 302 redirect to the content
    });

    const text = await resp.text();
    
    // Log response to Netlify Console for debugging
    console.log("Response from Google Apps Script:", text);

    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    const looksJson = ct.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[");
    
    // Wrap non-JSON responses to prevent frontend "invalid response" errors
    const outBody = looksJson ? text : JSON.stringify({ 
      ok: false, 
      error: "Non-JSON response from Google. Check Apps Script permissions.", 
      raw: text 
    });

    return {
      statusCode: resp.status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: outBody
    };
  } catch (err) {
    console.error("Netlify Function Error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({ ok: false, error: String(err?.message || err) })
    };
  }
}