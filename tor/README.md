# manaGPT Tor research sidecar (prototype)

This is an **opt-in standalone Tor v3 onion HTML reader**, not yet wired into Cloudflare or the manaGPT chat UI. It is not a guarantee of anonymity or a full sandbox.

## Start locally

```sh
export TOR_RESEARCH_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(40))')"
docker build -t managpt-onion ./tor
docker run --rm --name managpt-onion --network bridge --read-only \
  --tmpfs /home/onion/tor-data:uid=10001,gid=10001 \
  --tmpfs /tmp:uid=10001,gid=10001 \
  -e TOR_RESEARCH_TOKEN="$TOR_RESEARCH_TOKEN" \
  -e TOR_RESEARCH_BIND=0.0.0.0 \
  -p 127.0.0.1:8765:8765 managpt-onion
```

**Important:** The image defaults to binding the HTTP API to 127.0.0.1 **inside the container**. For host port publishing, set `TOR_RESEARCH_BIND=0.0.0.0` **inside the container** while retaining the host-side `127.0.0.1:8765` binding. Never expose the API on a public interface.

```sh
curl --fail -X POST http://127.0.0.1:8765/fetch \
 -H "Authorization: Bearer $TOR_RESEARCH_TOKEN" \
 -H 'Content-Type: application/json' \
 -d '{"url":"http://<verified-56-character-v3-onion-address>/"}'
```

Use only addresses published by the service operator. The sidecar rejects non-v3-onion URLs, URL credentials, ports, redirects, and non-HTML responses. It uses `curl --socks5-hostname` to resolve onion names through Tor, and never falls back to direct HTTP within its request code. Output is limited and unauthenticated callers are rejected.

**Security limitations:** Docker's default bridge network does **not** enforce Tor-only egress for every process. This prototype therefore must not be described as a verified kill-switch or a high-assurance anonymity system. Before public deployment, isolate it in a dedicated VM/network namespace with firewall rules allowing only Tor daemon egress, test DNS and traffic leakage, restrict inbound access, add abuse controls, and conduct an independent security review. Do not expose the sidecar publicly or forward user credentials.

The sidecar intentionally does not fetch arbitrary clearnet sites, execute JavaScript, download files, follow redirects, or perform login/post/payment operations.
