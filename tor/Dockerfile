FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tor curl python3 ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --system --create-home --uid 10001 onion
COPY --chown=onion:onion sidecar.py /opt/onion/sidecar.py
COPY --chown=onion:onion torrc /etc/tor/torrc
USER onion
WORKDIR /home/onion
ENV TOR_SOCKS_PROXY=127.0.0.1:9050 TOR_RESEARCH_BIND=127.0.0.1
CMD ["sh","-c","tor -f /etc/tor/torrc & exec python3 /opt/onion/sidecar.py"]
