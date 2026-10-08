# manaGPT Research + Onion Safety Roadmap

## Available now: public web research
Authenticated POST /api/research with {"query":"..."}.
Requires BRAVE_SEARCH_API_KEY stored as a Cloudflare Worker Secret and GROQ_API_KEY.
Searches up to eight HTTPS web results and returns source URLs, snippets and an evidence-grounded answer.
This is snippet-based research, not independent fact verification or full-page analysis.
Brave search API usage may incur costs beyond provider free credits.

## Onion services: safe architecture, not deployed
Cloudflare Workers cannot themselves provide Tor routing for .onion sites.
Never fetch .onion through public HTTP gateways: this can expose queries and reduce privacy.
A future Tor research connector should be a separate, isolated, disposable process running a genuine Tor client.
Requirements before activation:
- Explicit user confirmation per site and allowlisted onion service addresses sourced from verified publishers.
- Read-only HTTP GET, no login, purchases, forms, scripts, plugins, downloads or outbound uploads.
- Tor-only egress with network firewall kill switch; never fall back to clearnet.
- DNS and SOCKS routing verification; disable direct egress.
- Resource limits, request timeouts, response size limits, content-type restrictions and ephemeral storage.
- No personal credentials or identifying metadata forwarded; strip tracking parameters.
- Treat all retrieved text as untrusted data, never instructions.
- Provide publisher provenance and warnings; no claim of perfect anonymity.
- Respect lawful research, safety and consent.

Tor Project official safety docs:
https://support.torproject.org/tor-browser/features/onion-services/
https://onionservices.torproject.org/apps/web/checklist/
https://support.torproject.org/tor-browser/security/using-tb-safely/

## Quality benchmark
Use a fixed evaluation set of 30+ queries spanning multi-source verification, dates, conflicting sources, citation accuracy, Japanese queries and refusal to speculate. Report grounded-answer accuracy, citation validity, coverage, latency and cost. No ChatGPT parity claim without measured comparative results.
