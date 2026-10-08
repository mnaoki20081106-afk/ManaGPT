# manaGPT Research + Onion Safety Roadmap

## Available now: public web research
Authenticated POST /api/research with {"query":"..."}. The mobile interface now has a research panel.
Requires BRAVE_SEARCH_API_KEY stored as a Cloudflare Worker Secret and GROQ_API_KEY.
Searches up to eight HTTPS web results per query; optional deep mode performs two queries and deduplicates up to twelve sources and returns source URLs, snippets and an evidence-grounded answer.
This is snippet-based research, not independent fact verification or full-page analysis. The system validates cited source IDs but cannot verify whether a cited snippet actually supports a generated claim.
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

## Operational readiness
1. Deploy Cloudflare Worker (requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in GitHub Actions secrets).
2. Set Cloudflare Worker Secrets GROQ_API_KEY, MANAGPT_ACCESS_TOKEN, and BRAVE_SEARCH_API_KEY.
3. Set GITHUB_TOKEN and GITHUB_REPOSITORY to enable the separate coding agent.
4. Run one live public-web query with full-text enabled; verify the citation URLs, response quality, and billing limits.
5. Do not advertise onion access as live until the isolated Tor connector passes egress isolation tests.

## Full-text network boundaries
The reader only accepts HTTPS URLs returned by the search provider, rejects localhost, private IP literals, custom ports, credentials, redirects and non-HTML content, and caps response size and duration. It does not resolve and verify DNS addresses before connecting, so it is not a general-purpose hardened SSRF sandbox. Do not add arbitrary user-supplied URL fetching without stronger network isolation.
