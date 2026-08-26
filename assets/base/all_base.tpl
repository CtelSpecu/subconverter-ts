# Clash base template — minimal default for subconverter-ts
# Used as default base for clash target when fetch fails or no external base provided.
# See spec.md §11, §13, Appendix C.

port: 7890
socks-port: 7891
allow-lan: false
mode: rule
log-level: info
external-controller: 127.0.0.1:9090
proxies:
proxy-groups:
rules:
