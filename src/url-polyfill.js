// QuickJS has no `URL` global. Pele calls `new URL()` in one place, for http and https links
// whose scheme it has already checked, and only reads and sets `protocol` and `hostname` and
// calls `toString()`. This covers that use following the WHATWG URL standard: lowercasing,
// default port removal, dot-segment resolution and percent-encoding.
// Not covered: IDN hosts (left as written instead of punycoded), IPv4 normalization and base URLs.
if (typeof globalThis.URL === 'undefined') {
  const RE_URL = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#\\]*)([^?#]*)(\?[^#]*)?(#.*)?$/;
  const DEFAULT_PORT = { 'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443, 'ftp:': 21 };
  // Code points each part percent-encodes, from the standard. `%` is never re-encoded.
  const PATH_SET = /[\u0000- \u007f-￿"#<>?`{}]/g;
  const QUERY_SET = /[\u0000- \u007f-￿"#<>']/g;
  const FRAGMENT_SET = /[\u0000- \u007f-￿"<>`]/g;
  const FORBIDDEN_HOST = /[\u0000- \u007f#%/<>?@\\^|]/;

  function pct(c) {
    const code = c.charCodeAt(0);
    if (code < 0x80) return '%' + code.toString(16).toUpperCase().padStart(2, '0');
    try {
      return encodeURIComponent(c);
    } catch {
      return c; // a lone surrogate
    }
  }
  const encode = (s, set) => s.replace(set, pct);

  function resolvePath(path) {
    const out = [];
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const low = seg.toLowerCase();
      const last = i === segments.length - 1;
      if (low === '.' || low === '%2e') {
        if (last) out.push('');
      } else if (low === '..' || low === '.%2e' || low === '%2e.' || low === '%2e%2e') {
        if (out.length) out.pop();
        if (last) out.push('');
      } else out.push(seg);
    }
    return '/' + out.join('/');
  }

  class URL {
    #protocol;
    #username = '';
    #password = '';
    #hostname;
    #port = '';
    #pathname;
    #search;
    #hash;

    constructor(url) {
      const m = RE_URL.exec(String(url));
      if (!m) throw new TypeError('Invalid URL');
      this.#protocol = m[1].toLowerCase() + ':';
      let authority = m[2];
      const at = authority.lastIndexOf('@');
      if (at >= 0) {
        const [user, ...pass] = authority.slice(0, at).split(':');
        this.#username = user;
        this.#password = pass.join(':');
        authority = authority.slice(at + 1);
      }
      let host = authority;
      let port = '';
      const colon = authority.lastIndexOf(':');
      if (colon >= 0 && !authority.endsWith(']')) {
        host = authority.slice(0, colon);
        port = authority.slice(colon + 1);
      }
      if (port !== '' && !/^\d+$/.test(port)) throw new TypeError('Invalid URL');
      if (port !== '') port = String(parseInt(port, 10));
      if (port !== '' && Number(port) > 65535) throw new TypeError('Invalid URL');
      try {
        host = decodeURIComponent(host);
      } catch {
        throw new TypeError('Invalid URL');
      }
      if (!host || (FORBIDDEN_HOST.test(host) && !host.startsWith('['))) throw new TypeError('Invalid URL');
      this.#hostname = host.toLowerCase();
      this.#port = port;
      this.#pathname = encode(resolvePath(m[3].replace(/\\/g, '/') || '/'), PATH_SET);
      this.#search = m[4] && m[4] !== '?' ? '?' + encode(m[4].slice(1), QUERY_SET) : '';
      this.#hash = m[5] && m[5] !== '#' ? '#' + encode(m[5].slice(1), FRAGMENT_SET) : '';
    }

    get protocol() {
      return this.#protocol;
    }
    set protocol(v) {
      v = String(v).toLowerCase().replace(/:$/, '');
      if (/^[a-z][a-z0-9+.-]*$/.test(v)) this.#protocol = v + ':';
    }
    get hostname() {
      return this.#hostname;
    }
    set hostname(v) {
      v = String(v).toLowerCase();
      if (v && !FORBIDDEN_HOST.test(v)) this.#hostname = v;
    }
    get port() {
      return this.#port !== '' && Number(this.#port) === DEFAULT_PORT[this.#protocol] ? '' : this.#port;
    }
    get host() {
      const port = this.port;
      return port ? `${this.#hostname}:${port}` : this.#hostname;
    }
    get username() {
      return this.#username;
    }
    get password() {
      return this.#password;
    }
    get pathname() {
      return this.#pathname;
    }
    get search() {
      return this.#search;
    }
    get hash() {
      return this.#hash;
    }
    get origin() {
      return `${this.#protocol}//${this.host}`;
    }
    get href() {
      const auth = this.#username || this.#password ? `${this.#username}${this.#password ? ':' + this.#password : ''}@` : '';
      return `${this.#protocol}//${auth}${this.host}${this.#pathname}${this.#search}${this.#hash}`;
    }
    toString() {
      return this.href;
    }
    toJSON() {
      return this.href;
    }
  }

  globalThis.URL = URL;
}
