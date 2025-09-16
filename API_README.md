# Graph API Quickstart (Demo Server)

0) Base + runtime
- BASE: `http://34.192.99.41:8099`
- PREFIX: none
- Proxy: none (Uvicorn direct)
- CORS: `*`

Note: Port 8099 appears closed to the public; health and calls below were run on the server loopback (`127.0.0.1`). To call from Electron locally, either open the security group to your IP or tunnel.

---

1) Health

Command
```bash
curl -i http://34.192.99.41:8099/healthz
```

Observed (server loopback)
```bash
HTTP/1.1 200 OK
date: Tue, 16 Sep 2025 13:05:16 GMT
server: uvicorn
content-length: 15
content-type: application/json

{"status":"ok"}
```

---

2) Resolve endpoints

Person by name
```bash
curl -i --get http://34.192.99.41:8099/resolve/person --data-urlencode q=david
