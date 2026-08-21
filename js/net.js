// WebSocket-Client für den Mehrspieler-Modus.

export class Net {
  constructor() { this.ws = null; this.handlers = {}; this.myId = null; this.token = null; }

  on(type, fn) { this.handlers[type] = fn; return this; }

  // Basis-Adresse eines Spiel-Servers in eine WebSocket-URL übersetzen.
  static wsUrl(base) {
    if (!base) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${location.host}/ws`;
    }
    let s = String(base).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(s)) {
      // nackte Adresse: lokale IPs über http/ws, alles andere über https/wss
      const local = /^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(s);
      s = (local ? 'http://' : 'https://') + s;
    }
    const u = new URL(s);
    return `${u.protocol === 'http:' ? 'ws:' : 'wss:'}//${u.host}/ws`;
  }

  connect(base) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(Net.wsUrl(base));
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 6000);
      ws.onopen = () => { clearTimeout(timeout); this.ws = ws; resolve(); };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('Verbindung fehlgeschlagen')); };
      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'you') { this.myId = msg.id; if (msg.token) this.token = msg.token; }
        (this.handlers[msg.t] || (() => {}))(msg);
      };
      ws.onclose = () => { this.ws = null; (this.handlers._close || (() => {}))(); };
    });
  }

  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  get connected() { return !!this.ws && this.ws.readyState === 1; }
  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; } }
}
