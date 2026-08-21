// WebSocket-Client für den Mehrspieler-Modus.

export class Net {
  constructor() { this.ws = null; this.handlers = {}; this.myId = null; this.token = null; }

  on(type, fn) { this.handlers[type] = fn; return this; }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
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
